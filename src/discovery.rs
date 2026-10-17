use crate::{
    config,
    database::Database,
    model::*,
    resolver::{Resolution, search_terms},
};
use anyhow::Result;
use ignore::gitignore::GitignoreBuilder;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Default)]
struct Score {
    value: f64,
    reserved: bool,
    reasons: BTreeSet<String>,
    contributions: BTreeMap<String, f64>,
    evidence: Vec<MatchEvidence>,
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
        score.contributions.insert(reason.into(), amount);
    }
    score.reserved |= reserved;
}

pub fn is_test(path: &str) -> bool {
    path.split('/')
        .any(|s| matches!(s, "test" | "tests" | "spec" | "specs" | "__tests__" | "e2e"))
        || path.contains(".test.")
        || path.contains(".spec.")
        || path.contains("_test.")
        || Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.ends_with("Test") || s.starts_with("test_"))
}

pub fn is_config(path: &str) -> bool {
    path.split('/').any(|part| part == "config")
        || path.ends_with("bootstrap/app.php")
        || path.ends_with("bootstrap/providers.php")
        || path.contains(".config.")
        || path == ".env.example"
        || matches!(
            path.rsplit('/').next().unwrap_or(""),
            "package.json"
                | ".env.example"
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

fn matches(
    text: &str,
    query: &[crate::terms::QueryTerm],
) -> BTreeMap<crate::terms::Origin, Vec<crate::terms::QueryTerm>> {
    use crate::terms::Origin;
    let literal: BTreeSet<_> = crate::terms::words(text).into_iter().collect();
    let stems: BTreeSet<_> = search_terms(text).into_iter().collect();
    let mut best: BTreeMap<&str, &crate::terms::QueryTerm> = BTreeMap::new();
    for term in query {
        let found = match term.origin {
            Origin::Literal => literal.contains(&term.term),
            Origin::Stem => stems.contains(&term.term),
            _ => literal.contains(&term.term) || stems.contains(&term.term),
        };
        if found
            && best
                .get(term.source.as_str())
                .is_none_or(|old| term.weight > old.weight)
        {
            best.insert(&term.source, term);
        }
    }
    let mut groups: BTreeMap<Origin, Vec<crate::terms::QueryTerm>> = BTreeMap::new();
    for term in best.into_values() {
        groups.entry(term.origin).or_default().push(term.clone());
    }
    groups
}

fn record(
    scores: &mut BTreeMap<String, Score>,
    path: &str,
    amount: f64,
    reason: &str,
    evidence: MatchEvidence,
) {
    add(scores, path, amount, reason, false);
    scores
        .entry(path.into())
        .or_default()
        .evidence
        .push(evidence);
}

fn normalize(candidates: &mut [Candidate], highest: f64) {
    if highest > 0.0 {
        for candidate in candidates.iter_mut() {
            candidate.score /= highest;
            for amount in candidate.contributions.values_mut() {
                *amount /= highest;
            }
        }
    }
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.path.cmp(&b.path)));
}

pub fn rank(
    root: &Path,
    db: &Database,
    resolution: &Resolution,
    options: &PackOptions,
    graph_depth: usize,
) -> Result<Vec<Candidate>> {
    let mut candidates = build(root, db, resolution, options, graph_depth)?;
    let highest = candidates
        .iter()
        .map(|candidate| candidate.score)
        .fold(0.0, f64::max);
    normalize(&mut candidates, highest);
    Ok(candidates)
}

pub fn discover(
    root: &Path,
    db: &Database,
    resolution: &Resolution,
    options: &PackOptions,
    graph_depth: usize,
) -> Result<Vec<Candidate>> {
    let candidates = build(root, db, resolution, options, graph_depth)?;
    let scopes = db.framework_scopes()?.unwrap_or_default();
    let highest = candidates
        .iter()
        .map(|candidate| candidate.score)
        .fold(0.0, f64::max);
    let mut selected =
        crate::selection::choose(&candidates, &resolution.task, &scopes, options.max_files);
    normalize(&mut selected, highest);
    Ok(selected)
}

fn build(
    root: &Path,
    db: &Database,
    resolution: &Resolution,
    options: &PackOptions,
    graph_depth: usize,
) -> Result<Vec<Candidate>> {
    use crate::terms::Origin;
    let files = db.files()?;
    let symbols = db.symbols()?;
    let generated = db.generated_files()?;
    let scopes = match db.framework_scopes()? {
        Some(scopes) => scopes,
        None => crate::frameworks::detect(root)?,
    };
    let task = &resolution.task;
    let query = if task.query_terms.is_empty() {
        crate::terms::query_terms(&task.raw_words)
    } else {
        task.query_terms.clone()
    };
    let mut scores: BTreeMap<String, Score> = BTreeMap::new();
    let mut exclusions = GitignoreBuilder::new(root);
    for pattern in &options.exclude {
        exclusions.add_line(None, pattern)?;
    }
    let exclusions = exclusions.build()?;
    let allowed = |path: &str| {
        !exclusions
            .matched_path_or_any_parents(path, false)
            .is_ignore()
            && (options.include.is_empty()
                || (!is_test(path) || options.include.iter().any(|s| s == "tests"))
                    && (!is_config(path) || options.include.iter().any(|s| s == "config"))
                    && (!path.ends_with(".md") || options.include.iter().any(|s| s == "docs")))
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
    let hints: BTreeSet<_> = task
        .symbols
        .iter()
        .map(|name| name.to_lowercase())
        .collect();
    let mut symbol_files: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut term_files: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for symbol in &symbols {
        symbol_files
            .entry(symbol.name.clone())
            .or_default()
            .insert(symbol.file_path.clone());
        for term in search_terms(&symbol.name) {
            term_files
                .entry(term)
                .or_default()
                .insert(symbol.file_path.clone());
        }
    }
    let mut symbol_matches: BTreeMap<(String, Origin), (f64, BTreeSet<String>)> = BTreeMap::new();
    for symbol in &symbols {
        if !allowed(&symbol.file_path) {
            continue;
        }
        if hints.contains(&symbol.name.to_lowercase()) {
            add(
                &mut scores,
                &symbol.file_path,
                8.0,
                "contains explicitly mentioned symbol (reserved)",
                true,
            );
        }
        for (origin, terms) in matches(&symbol.name, &query) {
            let amount: f64 = terms
                .iter()
                .map(|term| {
                    let frequency = term_files.get(&term.term).map_or(0, BTreeSet::len) as f64;
                    term.weight
                        * (((files.len() as f64 + 1.0) / (frequency + 1.0)).ln()
                            / (files.len() as f64 + 1.0).ln()
                            + 0.1)
                })
                .sum();
            let entry = symbol_matches
                .entry((symbol.file_path.clone(), origin))
                .or_default();
            entry.0 = entry.0.max(amount.min(1.0));
            entry.1.extend(terms.into_iter().map(|term| term.source));
        }
    }
    for ((path, origin), (amount, terms)) in symbol_matches {
        let reason = match origin {
            Origin::Literal => "contains matching symbol",
            Origin::Stem => "symbol matches task stems",
            Origin::Translation => "symbol matches translated query terms",
            Origin::Synonym => "symbol matches query synonyms",
        };
        record(
            &mut scores,
            &path,
            amount,
            reason,
            MatchEvidence {
                signal: format!("{}_symbol", origin.label()),
                terms: terms.into_iter().collect(),
                ..Default::default()
            },
        );
    }
    let definitions = config::domains_for_scopes(root, false, &scopes)?;
    let mut domain_terms = BTreeMap::new();
    let mut domain_sources = BTreeMap::new();
    for (source, domain, _) in definitions {
        if task.domains.contains(&domain.name) {
            domain_sources.insert(domain.name.clone(), source);
            domain_terms.insert(
                domain.name,
                search_terms(&domain.keywords.join(" "))
                    .into_iter()
                    .collect::<BTreeSet<_>>(),
            );
        }
    }
    let domain_applies = |domain: &str, path: &str| {
        domain_sources.get(domain).is_some_and(|source| {
            matches!(source.as_str(), "core" | "custom")
                || crate::frameworks::scope_for(&scopes, path)
                    .is_some_and(|scope| scope.frameworks.contains(source))
        })
    };
    let total_weight = task.domain_weights.values().sum::<f64>().max(1.0);
    let mut path_terms: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut path_frequency: BTreeMap<String, usize> = BTreeMap::new();
    for path in files.keys().filter(|path| allowed(path)) {
        let terms: BTreeSet<_> = search_terms(path).into_iter().collect();
        for term in &terms {
            *path_frequency.entry(term.clone()).or_default() += 1;
        }
        path_terms.insert(path.clone(), terms);
    }
    for path in files.keys().filter(|path| allowed(path)) {
        let basename = Path::new(path)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(path);
        let basename_terms: BTreeSet<_> = crate::terms::words(basename).into_iter().collect();
        let groups = matches(path, &query);
        let matched = !groups.is_empty();
        for (origin, terms) in groups {
            let amount: f64 = terms
                .iter()
                .map(|term| {
                    let frequency = path_frequency.get(&term.term).copied().unwrap_or(0) as f64;
                    let rarity = 0.25
                        + 0.75 * ((files.len() as f64 + 1.0) / (frequency + 1.0)).ln()
                            / (files.len() as f64 + 1.0).ln();
                    term.weight
                        * rarity
                        * (1.25
                            + if basename_terms.contains(&term.term) {
                                1.5
                            } else {
                                0.0
                            })
                })
                .sum();
            let reason = match origin {
                Origin::Literal => "path matches task words",
                Origin::Stem => "path matches task stems",
                Origin::Translation => "path matches translated query terms",
                Origin::Synonym => "path matches query synonyms",
            };
            record(
                &mut scores,
                path,
                amount.min(8.0),
                reason,
                MatchEvidence {
                    signal: format!("{}_path", origin.label()),
                    terms: terms.into_iter().map(|term| term.source).collect(),
                    ..Default::default()
                },
            );
        }
        if !matched {
            let amount: f64 = domain_terms
                .iter()
                .filter(|(domain, _)| domain_applies(domain, path))
                .map(|(domain, terms)| {
                    path_terms[path].intersection(terms).count().min(2) as f64
                        * task.domain_weights.get(domain).copied().unwrap_or(0.0)
                        / total_weight
                })
                .sum();
            if amount > 0.0 {
                record(
                    &mut scores,
                    path,
                    amount * 0.45,
                    "path matches task domains",
                    MatchEvidence {
                        signal: "domain".into(),
                        ..Default::default()
                    },
                );
            }
        }
    }
    for (path, origin, amount) in db.search_with_provenance(&query, 500)? {
        if allowed(&path) {
            record(
                &mut scores,
                &path,
                amount,
                &format!("content matches {} query terms", origin.label()),
                MatchEvidence {
                    signal: format!("{}_content", origin.label()),
                    ..Default::default()
                },
            );
        }
    }
    let dependencies = db.dependencies()?;
    let runtime_sources: BTreeSet<_> = dependencies
        .iter()
        .filter(|edge| matches!(edge.kind.as_str(), "runtime" | "config"))
        .map(|edge| edge.source_path.as_str())
        .collect();
    let scope_hints = crate::selection::scope_hints(task, &scopes);
    let highest = scores
        .values()
        .map(|score| score.value)
        .fold(0.0, f64::max)
        .max(1.0);
    let mut seeds: Vec<_> = scores
        .iter()
        .filter(|(path, score)| {
            allowed(path)
                && (!generated.contains(*path) || score.reserved)
                && (score.reserved
                    || score.value >= 1.5 && score.value >= highest * 0.35
                    || score.value >= 0.9 && runtime_sources.contains(path.as_str()))
                && (score.reserved
                    || scope_hints.is_empty()
                    || crate::frameworks::scope_for(&scopes, path)
                        .is_some_and(|scope| scope_hints.contains(&scope.path)))
        })
        .map(|(path, score)| (path.clone(), (score.value / highest).min(1.0)))
        .collect();
    seeds.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    seeds.truncate(24);
    let graph_allowed: BTreeSet<_> = files
        .keys()
        .filter(|path| {
            allowed(path)
                && (!generated.contains(*path) || scores.get(*path).is_some_and(|s| s.reserved))
        })
        .cloned()
        .collect();
    for contribution in crate::graph::expand(&dependencies, &seeds, &graph_allowed, graph_depth) {
        let reason = if contribution.evidence.signal == "outgoing_dependency" {
            "outgoing typed dependency"
        } else {
            "incoming typed dependency"
        };
        if contribution.evidence.hops == 1
            && contribution
                .evidence
                .source_path
                .as_ref()
                .is_some_and(|source| scores.get(source).is_some_and(|score| score.reserved))
        {
            scores
                .entry(contribution.path.clone())
                .or_default()
                .reasons
                .insert("direct import relationship to an explicit reference".into());
        }
        record(
            &mut scores,
            &contribution.path,
            contribution.amount,
            reason,
            contribution.evidence,
        );
    }
    if graph_depth > 0 {
        for contribution in crate::graph::shared_references(
            &db.references()?,
            &symbol_files,
            &seeds,
            &scopes,
            &graph_allowed,
        ) {
            record(
                &mut scores,
                &contribution.path,
                contribution.amount,
                "weak lexical symbol reference",
                contribution.evidence,
            );
        }
    }
    let mut entity_files: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for path in files.keys().filter(|path| allowed(path)) {
        for term in search_terms(
            Path::new(path)
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or(path),
        ) {
            if entity_term(&term) {
                entity_files.entry(term).or_default().insert(path.clone());
            }
        }
    }
    for (seed, strength) in &seeds {
        let scope = crate::frameworks::scope_for(&scopes, seed);
        let name = Path::new(seed)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(seed);
        for term in search_terms(name)
            .into_iter()
            .filter(|term| entity_term(term))
        {
            for path in entity_files.get(&term).into_iter().flatten() {
                if path == seed
                    || crate::frameworks::scope_for(&scopes, path).map(|scope| &scope.path)
                        != scope.map(|scope| &scope.path)
                {
                    continue;
                }
                let amount = 0.35 * strength / (entity_files[&term].len() as f64).sqrt();
                let reason = if is_test(path) {
                    "test file for a relevant candidate"
                } else {
                    "related framework file"
                };
                record(
                    &mut scores,
                    path,
                    amount,
                    reason,
                    MatchEvidence {
                        signal: "filename_association".into(),
                        source_path: Some(seed.clone()),
                        ..Default::default()
                    },
                );
            }
        }
    }
    if task
        .raw_words
        .iter()
        .any(|word| matches!(word.as_str(), "startup" | "server" | "avvio" | "port"))
    {
        let amount = if task.domains.iter().any(|domain| domain == "auth") {
            1.0
        } else {
            4.0
        };
        for path in files.keys().filter(|path| {
            allowed(path)
                && matches!(
                    path.rsplit('/').next(),
                    Some(
                        "index.ts"
                            | "index.js"
                            | "main.ts"
                            | "main.js"
                            | "server.ts"
                            | "server.js"
                            | "main.rs"
                            | "main.go"
                    )
                )
        }) {
            record(
                &mut scores,
                path,
                amount,
                "entry point for startup task",
                MatchEvidence {
                    signal: "entry_point".into(),
                    terms: vec!["startup".into()],
                    ..Default::default()
                },
            );
        }
    }
    let git = db.git_signals()?;
    let mut candidates = vec![];
    for (path, mut score) in scores {
        if !files.contains_key(&path) || !allowed(&path) {
            continue;
        }
        let mut matched_weight = 0.0;
        for (domain, terms) in &domain_terms {
            if domain_applies(domain, &path)
                && path_terms
                    .get(&path)
                    .is_some_and(|path| !path.is_disjoint(terms))
            {
                matched_weight += task.domain_weights.get(domain).copied().unwrap_or(0.0);
                score.reasons.insert(format!("domain relevant ({domain})"));
            }
        }
        let previous = score.value;
        score.value *= 1.0 + 0.2 * matched_weight / total_weight;
        score
            .contributions
            .insert("domain boost".into(), score.value - previous);
        if git
            .get(&path)
            .is_some_and(|signal| signal.churn_score > 0.5)
        {
            let previous = score.value;
            score.value *= 1.05;
            score
                .contributions
                .insert("git activity boost".into(), score.value - previous);
        }
        if !score.reserved && generated.contains(&path) {
            let previous = score.value;
            score.value *= 0.05;
            score.contributions.insert(
                "generated or minified asset penalty".into(),
                score.value - previous,
            );
            score
                .reasons
                .insert("generated or minified asset (deprioritized)".into());
        }
        candidates.push(Candidate {
            path,
            score: score.value,
            reasons: score.reasons.into_iter().collect(),
            contributions: score.contributions,
            evidence: score.evidence,
            reserved: score.reserved,
        });
    }
    candidates.sort_by(|a, b| {
        b.reserved
            .cmp(&a.reserved)
            .then(b.score.total_cmp(&a.score))
            .then(a.path.cmp(&b.path))
    });
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
