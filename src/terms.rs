use rust_stemmers::{Algorithm, Stemmer};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Literal,
    Stem,
    Translation,
    Synonym,
}

impl Origin {
    pub fn label(self) -> &'static str {
        match self {
            Self::Literal => "literal",
            Self::Stem => "stem",
            Self::Translation => "translation",
            Self::Synonym => "synonym",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QueryTerm {
    pub term: String,
    pub origin: Origin,
    pub source: String,
    pub weight: f64,
}

struct Lexicon {
    translations: BTreeMap<String, BTreeSet<String>>,
    synonyms: BTreeMap<String, BTreeSet<String>>,
}

fn lexicon() -> &'static Lexicon {
    static LEXICON: OnceLock<Lexicon> = OnceLock::new();
    LEXICON.get_or_init(|| {
        let english = Stemmer::create(Algorithm::English);
        let italian = Stemmer::create(Algorithm::Italian);
        let pairs: Vec<(String, String)> =
            serde_json::from_str(include_str!("../resources/translations-it.json"))
                .expect("embedded translations");
        let mut translations: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (source, target) in pairs {
            translations.entry(source).or_default().insert(target);
        }
        let mut synonyms: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (data, it) in [
            (include_str!("../resources/synonyms-en.json"), false),
            (include_str!("../resources/synonyms-it.json"), true),
        ] {
            let groups: Vec<Vec<String>> = serde_json::from_str(data).expect("embedded synonyms");
            for group in groups {
                let mut stems = BTreeSet::new();
                for word in group {
                    let stem = if it {
                        italian.stem(&word).into_owned()
                    } else {
                        english.stem(&word).into_owned()
                    };
                    if it && let Some(targets) = translations.get(&stem) {
                        stems.extend(targets.iter().cloned());
                    } else {
                        stems.insert(stem);
                    }
                }
                for stem in &stems {
                    synonyms
                        .entry(stem.clone())
                        .or_default()
                        .extend(stems.iter().cloned());
                }
            }
        }
        Lexicon {
            translations,
            synonyms,
        }
    })
}

pub fn words(text: &str) -> Vec<String> {
    let mut separated = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut previous: Option<char> = None;
    while let Some(c) = chars.next() {
        if c.is_uppercase()
            && previous.is_some_and(|p| {
                p.is_lowercase()
                    || p.is_uppercase() && chars.peek().is_some_and(|n| n.is_lowercase())
            })
        {
            separated.push(' ');
        }
        separated.extend(c.to_lowercase());
        previous = Some(c);
    }
    separated
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 2)
        .map(str::to_owned)
        .collect()
}

/// Corpus normalization is lexical: it never introduces synonyms or translations.
pub fn search_terms(text: &str) -> Vec<String> {
    let english = Stemmer::create(Algorithm::English);
    let italian = Stemmer::create(Algorithm::Italian);
    let mut result = BTreeSet::new();
    for word in words(text) {
        result.insert(english.stem(&word).into_owned());
        result.insert(italian.stem(&word).into_owned());
        result.insert(word);
    }
    result.into_iter().collect()
}

pub fn query_terms(words: &[String]) -> Vec<QueryTerm> {
    let lexicon = lexicon();
    let english = Stemmer::create(Algorithm::English);
    let italian = Stemmer::create(Algorithm::Italian);
    let mut result: BTreeMap<String, QueryTerm> = BTreeMap::new();
    let insert = |result: &mut BTreeMap<String, QueryTerm>,
                  term: String,
                  origin: Origin,
                  source: &str,
                  weight: f64| {
        let value = QueryTerm {
            term: term.clone(),
            origin,
            source: source.into(),
            weight,
        };
        if result.get(&term).is_none_or(|old| {
            weight > old.weight
                || weight == old.weight && (origin, source) < (old.origin, old.source.as_str())
        }) {
            result.insert(term, value);
        }
    };
    for word in words {
        insert(&mut result, word.clone(), Origin::Literal, word, 1.0);
        let stem = english.stem(word).into_owned();
        insert(&mut result, stem.clone(), Origin::Stem, word, 0.75);
        let it_stem = italian.stem(word);
        if let Some(targets) = lexicon.translations.get(it_stem.as_ref()) {
            for target in targets {
                insert(
                    &mut result,
                    target.clone(),
                    Origin::Translation,
                    word,
                    if word == it_stem.as_ref() { 0.15 } else { 0.55 },
                );
            }
        }
        for (source, targets) in &lexicon.translations {
            if targets.contains(&stem) {
                insert(&mut result, source.clone(), Origin::Translation, word, 0.25);
            }
        }
    }
    for value in result.values().cloned().collect::<Vec<_>>() {
        if let Some(synonyms) = lexicon.synonyms.get(&value.term) {
            for term in synonyms {
                insert(
                    &mut result,
                    term.clone(),
                    Origin::Synonym,
                    &value.source,
                    value.weight * 0.35,
                );
            }
        }
    }
    result.into_values().collect()
}
