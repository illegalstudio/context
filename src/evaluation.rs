use crate::{
    config::Config, database::Database, discovery, indexer, model::PackOptions, pack, resolver,
    snippets, tokens::Tokenizer,
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::Path, time::Instant};

#[derive(Deserialize, Serialize)]
pub struct Dataset {
    pub cases: Vec<Case>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Case {
    pub name: String,
    pub root: String,
    pub task: String,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default = "evaluation_split")]
    pub split: String,
    pub expected_files: Vec<String>,
    #[serde(default)]
    pub forbidden_files: Vec<String>,
    #[serde(default)]
    pub expected_ranges: Vec<ExpectedRange>,
}

#[derive(Deserialize, Serialize)]
pub struct ExpectedRange {
    pub path: String,
    pub start: usize,
    pub end: usize,
}

fn evaluation_split() -> String {
    "eval".into()
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub precision: f64,
    pub recall: f64,
    pub recall_at5: f64,
    pub reciprocal_rank: f64,
    pub range_coverage: Option<f64>,
    pub forbidden_matches: usize,
    pub tokens: usize,
    pub useful_lines_per1000_tokens: Option<f64>,
    pub index_ms: f64,
    pub selection_ms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseReport {
    pub name: String,
    pub split: String,
    pub source_hash: String,
    pub source_revision: Option<String>,
    pub selected_files: Vec<String>,
    pub ranges: Vec<RangeReport>,
    pub metrics: Metrics,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RangeReport {
    pub path: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub version: String,
    pub tokenizer: String,
    pub max_files: usize,
    pub budget_tokens: usize,
    pub dataset_hash: String,
    pub cases: Vec<CaseReport>,
    pub summary: Metrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison: Option<serde_json::Value>,
}

fn matches(path: &str, expected: &str) -> bool {
    path == expected || path.ends_with(&format!("/{expected}"))
}

fn copy_project(source: &Path, target: &Path) -> Result<()> {
    let custom = source.join(".ctxignore").is_file();
    let mut walker = ignore::WalkBuilder::new(source);
    walker
        .standard_filters(false)
        .follow_links(false)
        .add_custom_ignore_filename(".ctxignore")
        .filter_entry(move |entry| {
            entry.depth() == 0
                || !matches!(entry.file_name().to_str(), Some(".git" | ".context"))
                    && (custom
                        || !matches!(
                            entry.file_name().to_str(),
                            Some(
                                "node_modules"
                                    | "vendor"
                                    | "target"
                                    | "dist"
                                    | "build"
                                    | ".venv"
                                    | "venv"
                            )
                        ))
        });
    for entry in walker.build() {
        let entry = entry?;
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let relative = entry.path().strip_prefix(source)?;
        let destination = target.join(relative);
        fs::create_dir_all(destination.parent().unwrap())?;
        fs::copy(entry.path(), destination)?;
    }
    Ok(())
}

fn snapshot_revision(source: &Path, target: &Path, revision: &str) -> Result<String> {
    let git_root = crate::git::run(source, &["rev-parse", "--show-toplevel"])?;
    if Path::new(std::str::from_utf8(&git_root)?.trim()).canonicalize()? != source.canonicalize()? {
        bail!("Revision evaluation requires a repository root");
    }
    let revision = format!("{revision}^{{commit}}");
    let commit = String::from_utf8(crate::git::run(
        source,
        &["rev-parse", "--verify", "--end-of-options", &revision],
    )?)?
    .trim()
    .to_owned();
    if commit.len() != 40 || !commit.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("Invalid Git commit");
    }
    let mut child = std::process::Command::new("git")
        .arg("-C")
        .arg(source)
        .args(["archive", "--format=tar", &commit])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    let extraction = (|| -> Result<()> {
        let mut archive = tar::Archive::new(child.stdout.take().context("Missing archive output")?);
        for entry in archive.entries()? {
            let mut entry = entry?;
            if entry.header().entry_type().is_file() && !entry.unpack_in(target)? {
                bail!("Unsafe source archive path");
            }
        }
        Ok(())
    })();
    if extraction.is_err() {
        let _ = child.kill();
    }
    let status = child.wait()?;
    extraction?;
    if !status.success() {
        bail!("Cannot archive Git revision");
    }
    Ok(commit)
}

pub fn load(path: &Path) -> Result<Dataset> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path)?)?;
    if let Some(groups) = value.as_array() {
        let mut cases = vec![];
        for group in groups {
            let root = group["codebase"]
                .as_str()
                .context("Legacy dataset group needs codebase")?;
            for scenario in group["scenarios"].as_array().context("Missing scenarios")? {
                let mut value = scenario.clone();
                value["root"] = root.into();
                cases.push(serde_json::from_value(value)?);
            }
        }
        Ok(Dataset { cases })
    } else {
        Ok(serde_json::from_value(value)?)
    }
}

pub fn evaluate(
    dataset: &Dataset,
    projects: &Path,
    config: &Config,
    split: &str,
) -> Result<Report> {
    if !matches!(split, "train" | "eval" | "all") {
        bail!("Split must be train, eval or all");
    }
    if dataset.cases.len() > 10_000 {
        bail!("Evaluation dataset exceeds 10000 cases");
    }
    let projects = projects.canonicalize()?;
    let temporary = tempfile::Builder::new()
        .prefix("context-evaluation-")
        .tempdir()?;
    let tokenizer = Tokenizer::new(&config.tokenizer)?;
    let mut reports = vec![];
    for (index, case) in dataset.cases.iter().enumerate() {
        if !matches!(case.split.as_str(), "train" | "eval") {
            bail!("Invalid split for {}", case.name);
        }
        if split != "all" && case.split != split {
            continue;
        }
        if case.expected_files.is_empty() {
            bail!("Expected files are required for {}", case.name);
        }
        let expected: BTreeSet<_> = case.expected_files.iter().collect();
        if expected.len() != case.expected_files.len() {
            bail!("Duplicate expected file in {}", case.name);
        }
        let source = projects
            .join(&case.root)
            .canonicalize()
            .with_context(|| format!("Missing evaluation project {}", case.root))?;
        if !source.starts_with(&projects) {
            bail!("Evaluation project is outside --projects");
        }
        let root = temporary.path().join(index.to_string());
        fs::create_dir_all(&root)?;
        let source_revision = if let Some(revision) = &case.revision {
            Some(snapshot_revision(&source, &root, revision)?)
        } else {
            copy_project(&source, &root)?;
            None
        };
        let mut database = Database::open(&root)?;
        let started = Instant::now();
        indexer::index(&root, &mut database, config, false)?;
        let source_hash = blake3::hash(&serde_json::to_vec(&(
            database
                .files()?
                .into_iter()
                .map(|(path, file)| (path, file.hash))
                .collect::<Vec<_>>(),
            database.state("project_map")?,
        ))?)
        .to_hex()
        .to_string();
        let index_ms = started.elapsed().as_secs_f64() * 1000.0;
        let options = PackOptions {
            task: Some(case.task.clone()),
            max_files: config.max_files,
            budget_tokens: config.budget_tokens,
            ..Default::default()
        };
        let started = Instant::now();
        let resolution = resolver::resolve(&root, &options)?;
        let candidates =
            discovery::discover(&root, &database, &resolution, &options, config.graph_depth)?;
        let header = pack::header(&resolution.task, &candidates);
        let selected = snippets::select(
            &root,
            &database,
            &resolution,
            &candidates,
            config.max_lines_per_file,
            &header,
            config.budget_tokens,
            &tokenizer,
        )?;
        let mut prompt = header;
        for excerpt in &selected.excerpts {
            prompt.push_str(&pack::excerpt_markdown(excerpt));
        }
        let tokens = tokenizer.count(&prompt);
        let selection_ms = started.elapsed().as_secs_f64() * 1000.0;
        let paths: Vec<_> = candidates.into_iter().map(|c| c.path).collect();
        let hits = paths
            .iter()
            .filter(|p| expected.iter().any(|e| matches(p, e)))
            .count();
        let recall = expected
            .iter()
            .filter(|e| paths.iter().any(|p| matches(p, e)))
            .count() as f64
            / expected.len() as f64;
        let recall_at5 = expected
            .iter()
            .filter(|e| paths.iter().take(5).any(|p| matches(p, e)))
            .count() as f64
            / expected.len() as f64;
        let mut wanted = BTreeSet::new();
        for range in &case.expected_ranges {
            if range.start == 0 || range.end < range.start || range.end - range.start > 100_000 {
                bail!("Invalid expected range for {}", case.name);
            }
            for line in range.start..=range.end {
                wanted.insert((range.path.as_str(), line));
            }
        }
        let covered = wanted
            .iter()
            .filter(|(path, line)| {
                selected
                    .excerpts
                    .iter()
                    .any(|e| matches(&e.path, path) && e.start_line <= *line && *line <= e.end_line)
            })
            .count();
        let range_coverage = (!wanted.is_empty()).then(|| covered as f64 / wanted.len() as f64);
        let metrics = Metrics {
            precision: if paths.is_empty() {
                0.0
            } else {
                hits as f64 / paths.len() as f64
            },
            recall,
            recall_at5,
            reciprocal_rank: paths
                .iter()
                .position(|p| expected.iter().any(|e| matches(p, e)))
                .map_or(0.0, |i| 1.0 / (i + 1) as f64),
            range_coverage,
            forbidden_matches: paths
                .iter()
                .filter(|p| case.forbidden_files.iter().any(|e| matches(p, e)))
                .count(),
            tokens,
            useful_lines_per1000_tokens: range_coverage
                .map(|_| covered as f64 * 1000.0 / tokens.max(1) as f64),
            index_ms,
            selection_ms,
        };
        reports.push(CaseReport {
            name: case.name.clone(),
            split: case.split.clone(),
            source_hash,
            source_revision,
            selected_files: paths,
            ranges: selected
                .excerpts
                .into_iter()
                .map(|e| RangeReport {
                    path: e.path,
                    start: e.start_line,
                    end: e.end_line,
                })
                .collect(),
            metrics,
        });
    }
    if reports.is_empty() {
        bail!("No evaluation cases match split {split}");
    }
    let n = reports.len() as f64;
    let range_reports: Vec<_> = reports
        .iter()
        .filter(|r| r.metrics.range_coverage.is_some())
        .collect();
    let summary = Metrics {
        precision: reports.iter().map(|r| r.metrics.precision).sum::<f64>() / n,
        recall: reports.iter().map(|r| r.metrics.recall).sum::<f64>() / n,
        recall_at5: reports.iter().map(|r| r.metrics.recall_at5).sum::<f64>() / n,
        reciprocal_rank: reports
            .iter()
            .map(|r| r.metrics.reciprocal_rank)
            .sum::<f64>()
            / n,
        range_coverage: (!range_reports.is_empty()).then(|| {
            range_reports
                .iter()
                .filter_map(|r| r.metrics.range_coverage)
                .sum::<f64>()
                / range_reports.len() as f64
        }),
        forbidden_matches: reports.iter().map(|r| r.metrics.forbidden_matches).sum(),
        tokens: reports.iter().map(|r| r.metrics.tokens).sum(),
        useful_lines_per1000_tokens: (!range_reports.is_empty()).then(|| {
            range_reports
                .iter()
                .filter_map(|r| r.metrics.useful_lines_per1000_tokens)
                .sum::<f64>()
                / range_reports.len() as f64
        }),
        index_ms: reports.iter().map(|r| r.metrics.index_ms).sum::<f64>() / n,
        selection_ms: reports.iter().map(|r| r.metrics.selection_ms).sum::<f64>() / n,
    };
    Ok(Report {
        version: env!("CARGO_PKG_VERSION").into(),
        tokenizer: config.tokenizer.clone(),
        max_files: config.max_files,
        budget_tokens: config.budget_tokens,
        dataset_hash: blake3::hash(&serde_json::to_vec(dataset)?)
            .to_hex()
            .to_string(),
        cases: reports,
        summary,
        comparison: None,
    })
}

pub fn compare(report: &mut Report, baseline: &Report) -> Result<()> {
    let identity = |r: &Report| {
        r.cases
            .iter()
            .map(|c| {
                (
                    c.name.clone(),
                    c.split.clone(),
                    c.source_hash.clone(),
                    c.source_revision.clone(),
                )
            })
            .collect::<BTreeSet<_>>()
    };
    if report.dataset_hash != baseline.dataset_hash || identity(report) != identity(baseline) {
        bail!("Baseline must contain the same evaluation cases and splits");
    }
    report.comparison = Some(serde_json::json!({
        "recallDelta":report.summary.recall-baseline.summary.recall,
        "precisionDelta":report.summary.precision-baseline.summary.precision,
        "recallAt5Delta":report.summary.recall_at5-baseline.summary.recall_at5,
        "tokensDelta":report.summary.tokens as i64-baseline.summary.tokens as i64,
        "selectionMsDelta":report.summary.selection_ms-baseline.summary.selection_ms,
    }));
    Ok(())
}
