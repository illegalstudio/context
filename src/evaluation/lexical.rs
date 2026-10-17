use crate::{
    database::Database,
    model::{Candidate, MatchEvidence},
    resolver::Resolution,
    terms::{Origin, QueryTerm},
};
use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet};

pub fn select(
    database: &Database,
    resolution: &Resolution,
    limit: usize,
) -> Result<Vec<Candidate>> {
    let terms: Vec<_> = resolution
        .task
        .raw_words
        .iter()
        .map(|word| QueryTerm {
            term: word.clone(),
            source: word.clone(),
            origin: Origin::Literal,
            weight: 1.0,
        })
        .collect();
    let mut scores = BTreeMap::<String, f64>::new();
    for (path, _, score) in database.search_with_provenance(&terms, 500)? {
        scores.insert(path, score);
    }
    let words: BTreeSet<_> = resolution.task.raw_words.iter().collect();
    for path in database.files()?.keys() {
        let matches = crate::terms::words(path)
            .iter()
            .filter(|word| words.contains(word))
            .count();
        if matches > 0 {
            *scores.entry(path.clone()).or_default() += matches as f64;
        }
    }
    let top = scores.values().copied().fold(0.0, f64::max).max(1.0);
    let mut candidates: Vec<_> = scores
        .into_iter()
        .map(|(path, score)| Candidate {
            path,
            score: score / top,
            reasons: vec!["literal path and content baseline".into()],
            contributions: BTreeMap::from([(
                "literal path and content baseline".into(),
                score / top,
            )]),
            evidence: vec![MatchEvidence {
                signal: "literal_baseline".into(),
                ..Default::default()
            }],
            reserved: false,
        })
        .collect();
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.path.cmp(&b.path)));
    candidates.truncate(limit);
    Ok(candidates)
}
