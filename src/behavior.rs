use crate::{
    discovery::{is_config, is_test},
    frameworks::{FrameworkScope, scope_for},
    graph::Contribution,
    model::{Dependency, MatchEvidence},
};
use std::collections::{BTreeMap, BTreeSet};

fn identity(path: &str) -> Vec<String> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
    crate::terms::words(stem)
        .into_iter()
        .filter(|word| {
            !matches!(
                word.as_str(),
                "test" | "tests" | "spec" | "specs" | "controller" | "service" | "impl"
            )
        })
        .collect()
}

fn namespace(path: &str) -> BTreeSet<String> {
    path.rsplit_once('/')
        .into_iter()
        .flat_map(|(parent, _)| parent.split('/'))
        .map(str::to_lowercase)
        .filter(|part| {
            !matches!(
                part.as_str(),
                "src"
                    | "source"
                    | "sources"
                    | "main"
                    | "java"
                    | "test"
                    | "tests"
                    | "spec"
                    | "specs"
                    | "__tests__"
                    | "app"
                    | "lib"
                    | "feature"
                    | "unit"
            )
        })
        .collect()
}

/// Prefer a bounded set of direct behavior checks over generic test-name matches.
pub(crate) fn related(
    seeds: &[(String, f64)],
    paths: &BTreeSet<String>,
    dependencies: &[Dependency],
    scopes: &[FrameworkScope],
) -> Vec<Contribution> {
    let mut tests: BTreeMap<Vec<String>, Vec<&String>> = BTreeMap::new();
    let mut incoming: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut fanout: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for path in paths.iter().filter(|path| is_test(path)) {
        tests.entry(identity(path)).or_default().push(path);
    }
    for edge in dependencies.iter().filter(|edge| {
        is_test(&edge.source_path)
            && !is_test(&edge.target_path)
            && paths.contains(&edge.source_path)
            && paths.contains(&edge.target_path)
            && !matches!(edge.kind.as_str(), "class" | "runtime" | "config")
    }) {
        incoming
            .entry(&edge.target_path)
            .or_default()
            .insert(&edge.source_path);
        fanout
            .entry(&edge.source_path)
            .or_default()
            .insert(&edge.target_path);
    }
    let mut result = vec![];
    for (source, strength) in seeds
        .iter()
        .filter(|(path, _)| !is_test(path) && !is_config(path))
    {
        let mut matches = BTreeMap::<String, (f64, &str)>::new();
        for test in incoming.get(source.as_str()).into_iter().flatten() {
            let score = 3.2 / (1.0 + fanout[test].len() as f64 / 4.0).sqrt();
            matches.insert((*test).to_owned(), (score, "import"));
        }
        let key = identity(source);
        if !key.is_empty()
            && !key
                .iter()
                .all(|word| matches!(word.as_str(), "index" | "mod" | "utils" | "common" | "main"))
        {
            let source_namespace = namespace(source);
            for test in tests.get(&key).into_iter().flatten() {
                if scope_for(scopes, source).map(|scope| &scope.path)
                    != scope_for(scopes, test).map(|scope| &scope.path)
                {
                    continue;
                }
                let test_namespace = namespace(test);
                if !source_namespace.is_empty()
                    && !test_namespace.is_empty()
                    && source_namespace.is_disjoint(&test_namespace)
                {
                    continue;
                }
                let amount = if source_namespace.is_disjoint(&test_namespace) {
                    2.1
                } else {
                    2.8
                };
                let score = matches
                    .entry((*test).clone())
                    .or_insert((0.0, "counterpart"));
                if amount > score.0 {
                    *score = (amount, "counterpart");
                }
            }
        }
        let mut matches: Vec<_> = matches.into_iter().collect();
        matches.sort_by(|a, b| b.1.0.total_cmp(&a.1.0).then(a.0.cmp(&b.0)));
        for (path, (amount, relation)) in matches.into_iter().take(3) {
            result.push(Contribution {
                path,
                amount: amount * strength,
                evidence: MatchEvidence {
                    signal: "behavior_test".into(),
                    source_path: Some(source.clone()),
                    relation: Some(relation.into()),
                    hops: 1,
                    ..Default::default()
                },
            });
        }
    }
    result
}
