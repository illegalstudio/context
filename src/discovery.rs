use crate::{
    config,
    database::Database,
    model::*,
    resolver::{Resolution, search_terms},
};
use anyhow::Result;
use ignore::gitignore::GitignoreBuilder;
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    path::Path,
};

#[derive(Default)]
struct Score {
    value: f64,
    reserved: bool,
    reasons: BTreeSet<String>,
}

fn add(
    scores: &mut BTreeMap<String, Score>,
    path: &str,
    amount: f64,
    reason: &str,
    reserved: bool,
) {
    let score = scores.entry(path.into()).or_default();
    if score.reasons.insert(reason.into()) {
        score.value += amount;
    }
    score.reserved |= reserved;
}

pub fn is_test(path: &str) -> bool {
    path.split('/')
        .any(|s| matches!(s, "test" | "tests" | "spec" | "specs" | "__tests__"))
        || path.contains(".test.")
        || path.contains(".spec.")
        || path.contains("_test.")
        || Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.ends_with("Test") || s.starts_with("test_"))
}

pub fn is_config(path: &str) -> bool {
    path.starts_with("config/")
        || path.contains(".config.")
        || path == ".env.example"
        || matches!(
            path.rsplit('/').next().unwrap_or(""),
            "package.json"
                | "composer.json"
                | "tsconfig.json"
                | "Cargo.toml"
                | "go.mod"
                | "pyproject.toml"
        )
}

pub fn match_file<'a>(hint: &str, paths: impl Iterator<Item = &'a String>) -> Vec<String> {
    let hint = hint.trim_start_matches('@').replace('\\', "/");
    let hint = hint.trim_start_matches("./");
    paths
        .filter(|path| {
            *path == hint
                || path.ends_with(&format!("/{hint}"))
                || hint.ends_with(&format!("/{path}"))
        })
        .cloned()
        .collect()
}

pub fn discover(
    root: &Path,
    db: &Database,
    resolution: &Resolution,
    options: &PackOptions,
    graph_depth: usize,
) -> Result<Vec<Candidate>> {
    let files = db.files()?;
    let symbols = db.symbols()?;
    let imports = db.imports()?;
    let refs = db.references()?;
    let git = db.git_signals()?;
    let task = &resolution.task;
    let mut scores: BTreeMap<String, Score> = BTreeMap::new();
    let mut exclusions = GitignoreBuilder::new(root);
    for pattern in &options.exclude {
        exclusions.add_line(None, pattern)?;
    }
    let exclusions = exclusions.build()?;
    let allowed = |path: &str| {
        if exclusions
            .matched_path_or_any_parents(path, false)
            .is_ignore()
        {
            return false;
        }
        if !options.include.is_empty() {
            if is_test(path) && !options.include.iter().any(|s| s == "tests") {
                return false;
            }
            if is_config(path) && !options.include.iter().any(|s| s == "config") {
                return false;
            }
            if path.ends_with(".md") && !options.include.iter().any(|s| s == "docs") {
                return false;
            }
        }
        true
    };
    for hint in &task.files_hint {
        for path in match_file(hint, files.keys())
            .into_iter()
            .filter(|path| allowed(path))
        {
            add(
                &mut scores,
                &path,
                12.0,
                "exact file match (explicitly mentioned)",
                true,
            );
        }
    }
    for entry in &resolution.stacktrace {
        for path in match_file(&entry.file, files.keys())
            .into_iter()
            .filter(|path| allowed(path))
        {
            add(&mut scores, &path, 10.0, "appears in stacktrace", true);
        }
    }
    for entry in &resolution.diff {
        if files.contains_key(&entry.file) && allowed(&entry.file) {
            add(
                &mut scores,
                &entry.file,
                6.0,
                "modified in current changes",
                false,
            );
        }
    }
    let raw_identifiers: BTreeSet<_> = task
        .raw
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .map(str::to_lowercase)
        .collect();
    let hints: BTreeSet<_> = task.symbols.iter().map(|s| s.to_lowercase()).collect();
    let keyword_set: BTreeSet<_> = task.keywords.iter().cloned().collect();
    let raw_terms: BTreeSet<_> = task
        .raw_words
        .iter()
        .flat_map(|word| search_terms(word))
        .collect();
    let mut symbol_files: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for symbol in &symbols {
        symbol_files
            .entry(symbol.name.clone())
            .or_default()
            .insert(symbol.file_path.clone());
        if !allowed(&symbol.file_path) {
            continue;
        }
        if hints.contains(&symbol.name.to_lowercase())
            || raw_identifiers.contains(&symbol.name.to_lowercase())
        {
            add(
                &mut scores,
                &symbol.file_path,
                8.0,
                "contains explicitly mentioned symbol (reserved)",
                true,
            );
        } else if search_terms(&symbol.name)
            .iter()
            .any(|term| raw_terms.contains(term))
        {
            add(
                &mut scores,
                &symbol.file_path,
                1.0,
                "contains matching symbol",
                false,
            );
        }
    }
    let mut path_terms: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut entity_files: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for path in files.keys().filter(|path| allowed(path)) {
        let terms: BTreeSet<_> = search_terms(path).into_iter().collect();
        let raw_count = terms.intersection(&raw_terms).count();
        let name = Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(path);
        let basename_terms: BTreeSet<_> = search_terms(name).into_iter().collect();
        let basename_count = basename_terms.intersection(&raw_terms).count();
        let expanded_count = terms.intersection(&keyword_set).count();
        if raw_count > 0 {
            add(
                &mut scores,
                path,
                (raw_count as f64).min(4.0) * 1.25 + (basename_count as f64).min(3.0) * 1.5,
                "path matches task words",
                false,
            );
        } else if expanded_count > 0 {
            add(
                &mut scores,
                path,
                (expanded_count as f64).min(3.0) * 0.45,
                "path matches expanded keywords",
                false,
            );
        }
        for term in &basename_terms {
            if entity_term(term) {
                entity_files
                    .entry(term.clone())
                    .or_default()
                    .insert(path.clone());
            }
        }
        path_terms.insert(path.clone(), terms);
    }
    let search = db.search(&task.keywords, 500)?;
    for (index, (path, _)) in search.iter().enumerate() {
        if allowed(path) {
            add(
                &mut scores,
                path,
                0.6 + 1.5 / (1.0 + index as f64 * 0.08),
                "contains matching keywords",
                false,
            );
        }
    }
    let mut adjacency: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for edge in &imports {
        adjacency
            .entry(&edge.source_path)
            .or_default()
            .insert(&edge.target_path);
        adjacency
            .entry(&edge.target_path)
            .or_default()
            .insert(&edge.source_path);
    }
    let mut seeds: Vec<_> = scores
        .iter()
        .filter(|(_, score)| score.value >= 3.0)
        .map(|(path, score)| (path.clone(), score.value))
        .collect();
    seeds.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    seeds.truncate(50);
    let seed_paths: BTreeSet<_> = seeds.iter().map(|(path, _)| path.clone()).collect();
    let mut visited = seed_paths.clone();
    let mut queue: VecDeque<_> = seeds.iter().map(|(path, _)| (path.clone(), 0)).collect();
    while let Some((path, depth)) = queue.pop_front() {
        if depth >= graph_depth || visited.len() >= 2000 {
            continue;
        }
        if let Some(neighbors) = adjacency.get(path.as_str()) {
            for neighbor in neighbors {
                if visited.len() >= 2000 {
                    break;
                }
                if !allowed(neighbor) {
                    continue;
                }
                if visited.insert((*neighbor).into()) {
                    add(
                        &mut scores,
                        neighbor,
                        1.2 * 0.6_f64.powi(depth as i32),
                        &format!("related via imports ({} hops)", depth + 1),
                        false,
                    );
                    queue.push_back(((*neighbor).into(), depth + 1));
                }
            }
        }
    }
    // Indexed references avoid reading candidate files again during discovery.
    for seed in &seed_paths {
        if let Some(names) = refs.get(seed) {
            for name in names {
                if let Some(paths) = symbol_files.get(name) {
                    for path in paths.iter().filter(|path| allowed(path)) {
                        if path != seed {
                            add(
                                &mut scores,
                                path,
                                1.3,
                                "referenced by a relevant file",
                                false,
                            );
                        }
                    }
                }
            }
        }
    }
    let frameworks = config::detect_frameworks(root)?;
    for seed in &seed_paths {
        let seed_name = Path::new(seed)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(seed);
        let entities: BTreeSet<_> = search_terms(seed_name)
            .into_iter()
            .filter(|term| entity_term(term))
            .collect();
        let mut related = BTreeSet::new();
        for entity in &entities {
            if let Some(paths) = entity_files.get(entity) {
                related.extend(paths.iter().cloned());
            }
        }
        for path in related {
            if path == *seed || !allowed(&path) {
                continue;
            }
            if is_test(&path) {
                add(
                    &mut scores,
                    &path,
                    1.6,
                    "test file for a relevant candidate",
                    false,
                );
            } else if frameworks.iter().any(|s| s == "laravel")
                || frameworks.iter().any(|s| s == "nodejs")
            {
                add(&mut scores, &path, 1.0, "related framework file", false);
            }
        }
        if frameworks.iter().any(|s| s == "statamic") {
            let components: Vec<_> = seed.split('/').collect();
            for (index, component) in components.iter().enumerate() {
                if matches!(*component, "collections" | "taxonomies" | "fieldsets")
                    && let Some(entity) = components.get(index + 1)
                {
                    let entity = entity.trim_end_matches(".yaml");
                    for path in files
                        .keys()
                        .filter(|path| allowed(path) && path.contains(entity))
                    {
                        if path != seed {
                            add(
                                &mut scores,
                                path,
                                1.4,
                                "related Statamic collection, blueprint or template",
                                false,
                            );
                        }
                    }
                }
            }
        }
    }
    // Find Node entry points for startup tasks even without a literal filename.
    if task
        .raw_words
        .iter()
        .any(|w| matches!(w.as_str(), "startup" | "server" | "avvio" | "port"))
    {
        for path in files.keys().filter(|path| {
            allowed(path)
                && matches!(
                    path.rsplit('/').next().unwrap_or(""),
                    "index.ts"
                        | "index.js"
                        | "main.ts"
                        | "main.js"
                        | "server.ts"
                        | "server.js"
                        | "main.rs"
                        | "main.go"
                )
        }) {
            add(
                &mut scores,
                path,
                4.0,
                "entry point for startup task",
                false,
            );
        }
    }
    if !seed_paths.is_empty() {
        for path in files.keys().filter(|path| allowed(path) && is_config(path)) {
            let directory = Path::new(path).parent().unwrap_or(Path::new(""));
            if directory.as_os_str().is_empty()
                || seed_paths
                    .iter()
                    .any(|seed| Path::new(seed).starts_with(directory))
            {
                add(
                    &mut scores,
                    path,
                    0.3,
                    "configuration for relevant files",
                    false,
                );
            }
        }
    }
    let domain_terms: BTreeMap<_, BTreeSet<_>> = config::domains(root, false)?
        .into_iter()
        .filter(|(_, domain, _)| task.domains.contains(&domain.name))
        .map(|(_, domain, _)| {
            (
                domain.name,
                search_terms(&domain.keywords.join(" "))
                    .into_iter()
                    .collect(),
            )
        })
        .collect();
    let mut candidates = vec![];
    for (path, mut score) in scores {
        if !files.contains_key(&path) || !allowed(&path) {
            continue;
        }
        let terms = path_terms.get(&path);
        let mut matched_weight = 0.0;
        for (domain, domain_terms) in &domain_terms {
            if terms.is_some_and(|terms| !terms.is_disjoint(domain_terms)) {
                matched_weight += task.domain_weights.get(domain).copied().unwrap_or(1.0);
                score.reasons.insert(format!("domain relevant ({domain})"));
            }
        }
        let total_weight: f64 = task.domain_weights.values().sum();
        if total_weight > 0.0 {
            score.value *= 1.0 + 0.35 * matched_weight / total_weight;
        }
        if let Some(signal) = git.get(&path)
            && signal.churn_score > 0.5
        {
            score.value *= 1.05;
            score.reasons.insert("high git activity (hotspot)".into());
        }
        candidates.push(Candidate {
            path,
            score: score.value,
            reasons: score.reasons.into_iter().collect(),
            reserved: score.reserved,
        });
    }
    candidates.sort_by(|a, b| {
        b.reserved
            .cmp(&a.reserved)
            .then(b.score.total_cmp(&a.score))
            .then(a.path.cmp(&b.path))
    });
    let max = options.max_files;
    // Reserve small quotas for relevant tests/configuration without wasting unused slots.
    let mut selected: BTreeSet<String> = candidates
        .iter()
        .filter(|c| c.reserved)
        .take(max)
        .map(|c| c.path.clone())
        .collect();
    if selected.len() < max && max >= 5 {
        for (predicate, quota) in [
            (is_test as fn(&str) -> bool, (max / 5).max(1)),
            (is_config as fn(&str) -> bool, (max / 10).max(1)),
        ] {
            for candidate in candidates
                .iter()
                .filter(|c| predicate(&c.path) && c.score >= 1.0)
                .take(quota)
            {
                if selected.len() < max {
                    selected.insert(candidate.path.clone());
                }
            }
        }
    }
    for candidate in &candidates {
        if selected.len() < max {
            selected.insert(candidate.path.clone());
        }
    }
    candidates.retain(|c| selected.contains(&c.path));
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.path.cmp(&b.path)));
    let highest = candidates.iter().map(|c| c.score).fold(0.0, f64::max);
    for candidate in &mut candidates {
        if highest > 0.0 {
            candidate.score /= highest;
        }
    }
    Ok(candidates)
}

fn entity_term(term: &str) -> bool {
    !matches!(
        term,
        "controller"
            | "servic"
            | "service"
            | "model"
            | "modul"
            | "module"
            | "index"
            | "test"
            | "spec"
            | "php"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "py"
            | "go"
            | "rs"
            | "dto"
            | "request"
            | "handler"
            | "middleware"
            | "repository"
            | "repositori"
            | "factori"
            | "factory"
            | "provider"
            | "create"
            | "creat"
            | "add"
            | "updat"
            | "edit"
            | "delet"
            | "list"
            | "config"
            | "valid"
            | "usercontroller"
    )
}
