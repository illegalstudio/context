use crate::{
    frameworks::{FrameworkScope, scope_for},
    model::{Dependency, MatchEvidence},
};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, BinaryHeap},
};

pub struct Contribution {
    pub path: String,
    pub amount: f64,
    pub evidence: MatchEvidence,
}
#[derive(Clone)]
struct Edge {
    target: String,
    kind: String,
    incoming: bool,
    weight: f64,
}
#[derive(PartialEq)]
struct Visit {
    path: String,
    origin: String,
    depth: usize,
    strength: f64,
}
impl Eq for Visit {}
impl Ord for Visit {
    fn cmp(&self, other: &Self) -> Ordering {
        self.strength
            .total_cmp(&other.strength)
            .then(other.path.cmp(&self.path))
            .then(other.depth.cmp(&self.depth))
            .then(other.origin.cmp(&self.origin))
    }
}
impl PartialOrd for Visit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn expand(
    edges: &[Dependency],
    seeds: &[(String, f64)],
    allowed: &BTreeSet<String>,
    depth: usize,
    setup_helpers: &BTreeSet<String>,
) -> Vec<Contribution> {
    if depth == 0 {
        return vec![];
    }
    let mut outgoing: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut incoming: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for edge in edges {
        outgoing
            .entry(&edge.source_path)
            .or_default()
            .insert(&edge.target_path);
        incoming
            .entry(&edge.target_path)
            .or_default()
            .insert(&edge.source_path);
    }
    let mut adjacency: BTreeMap<String, Vec<Edge>> = BTreeMap::new();
    for edge in edges {
        let confidence = match edge.kind.as_str() {
            "class" => 0.45,
            "blueprint" => 0.7,
            "view" | "inertia" => 0.95,
            "runtime" => 0.9,
            "config" => 0.95,
            _ => 1.0,
        };
        let fan_out = outgoing
            .get(edge.source_path.as_str())
            .map_or(0, BTreeSet::len) as f64;
        let fan_in = incoming
            .get(edge.target_path.as_str())
            .map_or(0, BTreeSet::len) as f64;
        adjacency
            .entry(edge.source_path.clone())
            .or_default()
            .push(Edge {
                target: edge.target_path.clone(),
                kind: edge.kind.clone(),
                incoming: false,
                weight: confidence / (1.0 + fan_out / 12.0 + fan_in / 16.0).sqrt(),
            });
        let reverse = if matches!(edge.kind.as_str(), "view" | "inertia") {
            0.95
        } else {
            0.5
        };
        adjacency
            .entry(edge.target_path.clone())
            .or_default()
            .push(Edge {
                target: edge.source_path.clone(),
                kind: edge.kind.clone(),
                incoming: true,
                weight: confidence * reverse / (1.0 + fan_in / 3.0).sqrt(),
            });
    }
    let mut queue = BinaryHeap::new();
    for (path, strength) in seeds {
        queue.push(Visit {
            path: path.clone(),
            origin: path.clone(),
            depth: 0,
            strength: *strength,
        });
    }
    let mut visited: BTreeMap<(String, usize), f64> = BTreeMap::new();
    let mut best: BTreeMap<(String, String), Contribution> = BTreeMap::new();
    while let Some(visit) = queue.pop() {
        if visit.depth >= depth || visited.len() >= 2000 {
            continue;
        }
        let key = (visit.path.clone(), visit.depth);
        if visited
            .get(&key)
            .is_some_and(|strength| *strength >= visit.strength)
        {
            continue;
        }
        visited.insert(key, visit.strength);
        for edge in adjacency.get(&visit.path).into_iter().flatten() {
            if edge.target == visit.origin || !allowed.contains(&edge.target) {
                continue;
            }
            // An imported setup utility does not establish the intent of its consumers.
            if edge.incoming
                && setup_helpers.contains(&visit.path)
                && crate::quality::is_test_path(&edge.target)
            {
                continue;
            }
            let strength = visit.strength * edge.weight * if visit.depth == 0 { 1.0 } else { 0.65 };
            if strength < 0.03 {
                continue;
            }
            let signal = if edge.incoming {
                "incoming_dependency"
            } else {
                "outgoing_dependency"
            }
            .to_owned();
            let key = (edge.target.clone(), signal.clone());
            let amount = 2.8 * strength;
            if best.get(&key).is_none_or(|old| amount > old.amount) {
                best.insert(
                    key,
                    Contribution {
                        path: edge.target.clone(),
                        amount,
                        evidence: MatchEvidence {
                            signal,
                            source_path: Some(visit.path.clone()),
                            relation: Some(edge.kind.clone()),
                            hops: visit.depth + 1,
                            ..Default::default()
                        },
                    },
                );
            }
            queue.push(Visit {
                path: edge.target.clone(),
                origin: visit.origin.clone(),
                depth: visit.depth + 1,
                strength,
            });
        }
    }
    best.into_values().collect()
}

pub fn shared_references(
    references: &BTreeMap<String, Vec<String>>,
    symbols: &BTreeMap<String, BTreeSet<String>>,
    seeds: &[(String, f64)],
    scopes: &[FrameworkScope],
    allowed: &BTreeSet<String>,
) -> Vec<Contribution> {
    let mut frequency: BTreeMap<&str, usize> = BTreeMap::new();
    for names in references.values() {
        for name in names {
            *frequency.entry(name).or_default() += 1;
        }
    }
    let mut best: BTreeMap<String, Contribution> = BTreeMap::new();
    for (source, strength) in seeds {
        for name in references.get(source).into_iter().flatten() {
            for target in symbols.get(name).into_iter().flatten() {
                if target == source
                    || !allowed.contains(target)
                    || scope_for(scopes, source).map(|s| &s.path)
                        != scope_for(scopes, target).map(|s| &s.path)
                {
                    continue;
                }
                let amount = 0.3 * strength
                    / (frequency.get(name.as_str()).copied().unwrap_or(1) as f64).sqrt();
                if best.get(target).is_none_or(|old| amount > old.amount) {
                    best.insert(
                        target.clone(),
                        Contribution {
                            path: target.clone(),
                            amount,
                            evidence: MatchEvidence {
                                signal: "shared_symbol".into(),
                                terms: vec![name.clone()],
                                source_path: Some(source.clone()),
                                relation: Some("lexical_reference".into()),
                                hops: 1,
                            },
                        },
                    );
                }
            }
        }
    }
    best.into_values().collect()
}
