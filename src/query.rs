use crate::{
    config::{self, Config},
    database::Database,
    discovery, indexer,
    model::*,
    resolver, snippets,
    tokens::Tokenizer,
};
use anyhow::{Result, bail};
use serde::Serialize;
use std::{collections::BTreeMap, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub query: String,
    pub tokenizer: String,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    #[serde(flatten)]
    pub candidate: Candidate,
    pub symbols: Vec<Symbol>,
    pub excerpts: Vec<Excerpt>,
    pub omission_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Explanation {
    pub path: String,
    pub task: String,
    pub indexed: bool,
    pub selected: bool,
    pub status: String,
    pub rank: Option<usize>,
    pub score: f64,
    pub contributions: BTreeMap<String, f64>,
    pub reasons: Vec<String>,
    pub dependencies: Vec<ImportRelation>,
}

pub fn prepare(root: &Path, verify: bool) -> Result<(Config, Database)> {
    if root.join(".context").exists()
        && !root
            .join(".context")
            .canonicalize()?
            .starts_with(root.canonicalize()?)
    {
        bail!("Context data directory must be inside the project");
    }
    config::initialize(root, false)?;
    let config = config::load(root)?;
    let mut database = Database::open(root)?;
    indexer::index(root, &mut database, &config, verify)?;
    Ok((config, database))
}

pub fn search(
    root: &Path,
    database: &Database,
    config: &Config,
    query: &str,
    limit: usize,
) -> Result<SearchResult> {
    if limit == 0 || limit > 1000 {
        bail!("Search limit must be between 1 and 1000");
    }
    let options = PackOptions {
        task: Some(query.into()),
        max_files: limit,
        ..Default::default()
    };
    let resolution = resolver::resolve(root, &options)?;
    let candidates =
        discovery::discover(root, database, &resolution, &options, config.graph_depth)?;
    let tokenizer = Tokenizer::new(&config.tokenizer)?;
    let selected = snippets::select(
        root,
        database,
        &resolution,
        &candidates,
        config.max_lines_per_file.min(60),
        "",
        config.budget_tokens.min(8000),
        &tokenizer,
    )?;
    let symbols = database.symbols()?;
    let hits = candidates
        .into_iter()
        .map(|candidate| SearchHit {
            omission_reason: selected.omitted.get(&candidate.path).cloned(),
            symbols: symbols
                .iter()
                .filter(|s| s.file_path == candidate.path)
                .take(30)
                .cloned()
                .collect(),
            excerpts: selected
                .excerpts
                .iter()
                .filter(|e| e.path == candidate.path)
                .cloned()
                .collect(),
            candidate,
        })
        .collect();
    Ok(SearchResult {
        query: query.into(),
        tokenizer: config.tokenizer.clone(),
        hits,
    })
}

pub fn explain(
    root: &Path,
    database: &Database,
    config: &Config,
    path: &str,
    options: &PackOptions,
) -> Result<Explanation> {
    let files = database.files()?;
    let matches = discovery::match_file(path, files.keys());
    if matches.len() > 1 {
        bail!("File name is ambiguous; provide its project-relative path");
    }
    let path = matches
        .first()
        .cloned()
        .unwrap_or_else(|| path.trim_start_matches("./").replace('\\', "/"));
    let resolution = resolver::resolve(root, options)?;
    let selected = discovery::discover(root, database, &resolution, options, config.graph_depth)?;
    let all = discovery::discover(
        root,
        database,
        &resolution,
        &PackOptions {
            max_files: files.len().max(1),
            ..options.clone()
        },
        config.graph_depth,
    )?;
    let ranked = all.iter().enumerate().find(|(_, c)| c.path == path);
    let included = selected.iter().any(|c| c.path == path);
    let indexed = files.contains_key(&path);
    let mut exclusions = ignore::gitignore::GitignoreBuilder::new(root);
    for pattern in &options.exclude {
        exclusions.add_line(None, pattern)?;
    }
    let explicitly_excluded = exclusions
        .build()?
        .matched_path_or_any_parents(&path, false)
        .is_ignore();
    Ok(Explanation {
        task: resolution.task.raw,
        indexed,
        selected: included,
        status: if !indexed {
            "not_indexed"
        } else if explicitly_excluded {
            "excluded_by_pattern"
        } else if included {
            "selected"
        } else if ranked.is_some() {
            "below_file_limit"
        } else {
            "excluded_or_no_matching_signals"
        }
        .into(),
        rank: ranked.map(|(i, _)| i + 1),
        score: ranked.map_or(0.0, |(_, c)| c.score),
        contributions: ranked
            .map(|(_, c)| c.contributions.clone())
            .unwrap_or_default(),
        reasons: ranked.map(|(_, c)| c.reasons.clone()).unwrap_or_default(),
        dependencies: database
            .imports()?
            .into_iter()
            .filter(|e| e.source_path == path || e.target_path == path)
            .collect(),
        path,
    })
}
