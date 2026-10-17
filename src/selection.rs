use crate::{
    discovery::{is_config, is_test},
    frameworks::{FrameworkScope, scope_for},
    model::{Candidate, ResolvedTask},
    resolver::words,
};
use std::collections::{BTreeMap, BTreeSet};

fn features(
    candidate: &Candidate,
    scopes: &[FrameworkScope],
    selected: &BTreeSet<String>,
) -> BTreeSet<String> {
    let mut features = BTreeSet::new();
    if let Some(scope) = scope_for(scopes, &candidate.path) {
        features.insert(format!("scope:{}", scope.path));
    }
    let role = if is_test(&candidate.path) {
        "test"
    } else if is_config(&candidate.path) {
        "config"
    } else if candidate.path.ends_with(".md") {
        "docs"
    } else if candidate.path.contains("/Providers/") {
        "provider"
    } else if candidate.path.contains("/Controllers/") {
        "controller"
    } else if candidate.path.contains("/Models/") {
        "model"
    } else if candidate.path.contains("/pages/") || candidate.path.contains("/Pages/") {
        "page"
    } else {
        "implementation"
    };
    features.insert(format!("role:{role}"));
    let mut matched_terms = BTreeSet::new();
    for evidence in &candidate.evidence {
        if evidence.signal != "shared_symbol" {
            for term in &evidence.terms {
                features.insert(format!("query:{term}"));
                matched_terms.insert(term.as_str());
            }
        }
        if let Some(source) = &evidence.source_path
            && selected.contains(source)
            && evidence.signal.contains("dependency")
        {
            features.insert(format!("parent:{source}"));
            if evidence.hops == 1
                && evidence.signal == "outgoing_dependency"
                && evidence.relation.as_deref() != Some("class")
            {
                features.insert(format!("dependency:{}", candidate.path));
            }
            if matches!(evidence.relation.as_deref(), Some("runtime" | "config")) {
                features.insert(format!("runtime:{}", candidate.path));
            }
        }
    }
    if matched_terms.len() > 1 {
        features.insert(format!(
            "query_set:{}",
            matched_terms.into_iter().collect::<Vec<_>>().join("|")
        ));
    }
    features
}

pub fn scope_hints(task: &ResolvedTask, scopes: &[FrameworkScope]) -> BTreeSet<String> {
    let raw: BTreeSet<_> = task.raw_words.iter().collect();
    scopes
        .iter()
        .filter(|scope| {
            !is_test(&scope.path)
                && words(&scope.path).iter().any(|word| {
                    !matches!(
                        word.as_str(),
                        "app"
                            | "apps"
                            | "package"
                            | "packages"
                            | "src"
                            | "test"
                            | "tests"
                            | "rust"
                            | "typescript"
                            | "javascript"
                            | "php"
                            | "python"
                            | "go"
                            | "java"
                            | "ruby"
                            | "node"
                            | "nodejs"
                            | "laravel"
                            | "statamic"
                    ) && raw.contains(word)
                })
        })
        .map(|scope| scope.path.clone())
        .collect()
}

/// File limits are ceilings. Stop when remaining candidates add insufficient evidence.
pub fn choose(
    candidates: &[Candidate],
    task: &ResolvedTask,
    scopes: &[FrameworkScope],
    max: usize,
) -> Vec<Candidate> {
    if max == 0 {
        return vec![];
    }
    let mut selected: BTreeSet<String> = candidates
        .iter()
        .filter(|candidate| candidate.reserved)
        .take(max)
        .map(|candidate| candidate.path.clone())
        .collect();
    let mut covered = BTreeSet::new();
    for candidate in candidates
        .iter()
        .filter(|candidate| selected.contains(&candidate.path))
    {
        covered.extend(features(candidate, scopes, &selected));
    }
    let hints = scope_hints(task, scopes);
    let testing = task.domains.iter().any(|domain| domain == "testing");
    let top = candidates
        .iter()
        .filter(|candidate| !candidate.reserved)
        .map(|candidate| candidate.score)
        .fold(0.0, f64::max);
    let floor = (top * 0.1).max(0.55);
    let test_limit = (max / 5).max(1);
    let mut test_count = selected.iter().filter(|path| is_test(path)).count();
    let mut role_count: BTreeMap<&str, usize> = BTreeMap::new();
    loop {
        if selected.len() >= max {
            break;
        }
        let mut best: Option<(&Candidate, f64, BTreeSet<String>)> = None;
        for candidate in candidates
            .iter()
            .filter(|candidate| !selected.contains(&candidate.path) && candidate.score >= floor)
        {
            let test = is_test(&candidate.path);
            if test && !testing && test_count >= test_limit {
                continue;
            }
            let evidence = features(candidate, scopes, &selected);
            let fresh = evidence.difference(&covered).count() as f64;
            let mut novelty = 0.2 + 0.8 * fresh / evidence.len().max(1) as f64;
            if evidence.difference(&covered).any(|feature| {
                feature.starts_with("dependency:") || feature.starts_with("runtime:")
            }) {
                novelty = novelty.max(0.8);
            }
            let mut utility = candidate.score * novelty;
            if !hints.is_empty()
                && !scope_for(scopes, &candidate.path)
                    .is_some_and(|scope| hints.contains(&scope.path))
            {
                utility *= 0.4;
            }
            if candidate.evidence.iter().all(|e| {
                e.signal == "shared_symbol"
                    || e.signal == "domain"
                    || e.signal == "filename_association"
            }) {
                utility *= 0.35;
            }
            if testing && test {
                utility *= 1.0 + 0.15 / (1.0 + role_count.get("test").copied().unwrap_or(0) as f64);
            }
            if best.as_ref().is_none_or(|(old, score, _)| {
                utility > *score || utility == *score && candidate.path < old.path
            }) {
                best = Some((candidate, utility, evidence));
            }
        }
        let Some((candidate, utility, evidence)) = best else {
            break;
        };
        if utility < floor && !selected.is_empty() {
            break;
        }
        selected.insert(candidate.path.clone());
        covered.extend(evidence);
        let role = if is_test(&candidate.path) {
            test_count += 1;
            "test"
        } else if is_config(&candidate.path) {
            "config"
        } else {
            "implementation"
        };
        *role_count.entry(role).or_default() += 1;
    }
    candidates
        .iter()
        .filter(|candidate| selected.contains(&candidate.path))
        .cloned()
        .collect()
}
