use super::{Case, CaseReport, Dataset, GroupReport, Metrics, RangeReport, matches};
use crate::{model::FileMetadata, snippets::Selection, tokens::Tokenizer};
use anyhow::{Result, bail};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path},
};

pub fn validate_isolation(dataset: &Dataset) -> Result<()> {
    let mut projects = BTreeMap::new();
    for case in &dataset.cases {
        if !matches!(case.split.as_str(), "train" | "eval") {
            bail!("Invalid split for {}", case.name);
        }
        if dataset.project_isolation {
            let project = case
                .metadata
                .project
                .trim()
                .trim_end_matches('/')
                .to_lowercase();
            if project.is_empty() {
                bail!(
                    "Project isolation requires project metadata for {}",
                    case.name
                );
            }
            if let Some(previous) = projects.insert(project.clone(), &case.split)
                && previous != &case.split
            {
                bail!("Project {project} appears in both train and eval");
            }
        }
    }
    Ok(())
}

pub fn validate_annotations(case: &Case, root: &Path) -> Result<()> {
    for path in case
        .expected_files
        .iter()
        .chain(&case.supporting_files)
        .chain(&case.forbidden_files)
        .chain(
            case.expected_ranges
                .iter()
                .chain(&case.supporting_ranges)
                .map(|range| &range.path),
        )
    {
        if Path::new(path).is_absolute()
            || Path::new(path)
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            bail!("Annotation path must be project-relative: {path}");
        }
    }
    for range in case.expected_ranges.iter().chain(&case.supporting_ranges) {
        if range.start == 0 || range.end < range.start || range.end - range.start > 100_000 {
            bail!("Invalid expected range for {}", case.name);
        }
        let path = root.join(&range.path);
        if path.is_file()
            && range.end
                > crate::snippets::read_source(root, &range.path)?
                    .lines()
                    .count()
        {
            bail!("Expected range exceeds source lines: {}", range.path);
        }
    }
    if case
        .expected_files
        .iter()
        .chain(&case.supporting_files)
        .any(|path| {
            case.forbidden_files
                .iter()
                .any(|other| matches(path, other) || matches(other, path))
        })
    {
        bail!(
            "Positive and forbidden annotations overlap in {}",
            case.name
        );
    }
    Ok(())
}

pub struct Details {
    pub excerpt_recall: f64,
    pub supporting_recall: Option<f64>,
    pub supporting_range_coverage: Option<f64>,
    pub missing_supporting_ranges: Vec<RangeReport>,
    pub judged_precision: Option<f64>,
    pub missing_files: Vec<String>,
    pub missing_ranges: Vec<RangeReport>,
    pub unknown_files: Vec<String>,
    pub omissions: BTreeMap<String, String>,
    pub forbidden_tokens: usize,
}

pub fn details(
    case: &Case,
    paths: &[String],
    selected: &Selection,
    indexed: &BTreeMap<String, FileMetadata>,
    tokenizer: &Tokenizer,
) -> Details {
    let included = |path: &str| {
        selected
            .excerpts
            .iter()
            .any(|excerpt| matches(&excerpt.path, path))
    };
    let missing_files: Vec<_> = case
        .expected_files
        .iter()
        .filter(|path| !included(path))
        .cloned()
        .collect();
    let mut wanted = BTreeSet::new();
    for range in &case.expected_ranges {
        for line in range.start..=range.end {
            wanted.insert((range.path.clone(), line));
        }
    }
    let mut missing_ranges: Vec<RangeReport> = vec![];
    for (path, line) in wanted {
        if selected.excerpts.iter().any(|excerpt| {
            matches(&excerpt.path, &path) && excerpt.start_line <= line && line <= excerpt.end_line
        }) {
            continue;
        }
        if let Some(last) = missing_ranges.last_mut()
            && last.path == path
            && last.end + 1 == line
        {
            last.end = line;
        } else {
            missing_ranges.push(RangeReport {
                path,
                start: line,
                end: line,
            });
        }
    }
    let mut supporting_wanted = BTreeSet::new();
    for range in &case.supporting_ranges {
        for line in range.start..=range.end {
            supporting_wanted.insert((range.path.clone(), line));
        }
    }
    let supporting_missing: Vec<_> = supporting_wanted
        .iter()
        .filter(|(path, line)| {
            !selected.excerpts.iter().any(|excerpt| {
                matches(&excerpt.path, path)
                    && excerpt.start_line <= *line
                    && *line <= excerpt.end_line
            })
        })
        .cloned()
        .collect();
    let supporting_range_coverage = (!supporting_wanted.is_empty())
        .then(|| 1.0 - supporting_missing.len() as f64 / supporting_wanted.len() as f64);
    let mut missing_supporting_ranges: Vec<RangeReport> = vec![];
    for (path, line) in supporting_missing {
        if let Some(last) = missing_supporting_ranges.last_mut()
            && last.path == path
            && last.end + 1 == line
        {
            last.end = line;
        } else {
            missing_supporting_ranges.push(RangeReport {
                path,
                start: line,
                end: line,
            });
        }
    }
    let positive = |path: &str| {
        case.expected_files
            .iter()
            .chain(&case.supporting_files)
            .any(|expected| matches(path, expected))
    };
    let forbidden = |path: &str| {
        case.forbidden_files
            .iter()
            .any(|expected| matches(path, expected))
    };
    let positives = paths.iter().filter(|path| positive(path)).count();
    let negatives = paths.iter().filter(|path| forbidden(path)).count();
    let omissions = missing_files
        .iter()
        .map(|path| {
            let reason = if !indexed.keys().any(|file| matches(file, path)) {
                "not_indexed"
            } else if !paths.iter().any(|file| matches(file, path)) {
                "not_selected"
            } else {
                "selected_without_excerpt"
            };
            (path.clone(), reason.to_string())
        })
        .collect();
    Details {
        supporting_range_coverage,
        missing_supporting_ranges,
        excerpt_recall: 1.0 - missing_files.len() as f64 / case.expected_files.len() as f64,
        supporting_recall: (!case.supporting_files.is_empty()).then(|| {
            case.supporting_files
                .iter()
                .filter(|path| included(path))
                .count() as f64
                / case.supporting_files.len() as f64
        }),
        judged_precision: (positives + negatives > 0)
            .then(|| positives as f64 / (positives + negatives) as f64),
        missing_files,
        missing_ranges,
        omissions,
        unknown_files: paths
            .iter()
            .filter(|path| !positive(path) && !forbidden(path))
            .cloned()
            .collect(),
        forbidden_tokens: selected
            .excerpts
            .iter()
            .filter(|excerpt| forbidden(&excerpt.path))
            .map(|excerpt| tokenizer.count(&crate::pack::excerpt_markdown(excerpt)))
            .sum(),
    }
}

pub fn average<'a>(metrics: impl IntoIterator<Item = &'a Metrics>) -> Metrics {
    let rows: Vec<_> = metrics.into_iter().collect();
    if rows.is_empty() {
        return Metrics::default();
    }
    let n = rows.len() as f64;
    let mean = |field: fn(&Metrics) -> f64| rows.iter().map(|row| field(row)).sum::<f64>() / n;
    let optional = |field: fn(&Metrics) -> Option<f64>| {
        let values: Vec<_> = rows.iter().filter_map(|row| field(row)).collect();
        (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64)
    };
    Metrics {
        precision: mean(|m| m.precision),
        recall: mean(|m| m.recall),
        recall_at5: mean(|m| m.recall_at5),
        reciprocal_rank: mean(|m| m.reciprocal_rank),
        range_coverage: optional(|m| m.range_coverage),
        forbidden_matches: rows.iter().map(|m| m.forbidden_matches).sum(),
        tokens: rows.iter().map(|m| m.tokens).sum(),
        useful_lines_per1000_tokens: optional(|m| m.useful_lines_per1000_tokens),
        index_ms: mean(|m| m.index_ms),
        selection_ms: mean(|m| m.selection_ms),
        excerpt_recall: mean(|m| m.excerpt_recall),
        complete_context: mean(|m| m.complete_context),
        supporting_recall: optional(|m| m.supporting_recall),
        supporting_range_coverage: optional(|m| m.supporting_range_coverage),
        judged_precision: optional(|m| m.judged_precision),
        unknown_files: rows.iter().map(|m| m.unknown_files).sum(),
        forbidden_tokens: rows.iter().map(|m| m.forbidden_tokens).sum(),
    }
}

pub fn groups(reports: &[CaseReport]) -> BTreeMap<String, BTreeMap<String, GroupReport>> {
    let mut groups = BTreeMap::<String, BTreeMap<String, Vec<&Metrics>>>::new();
    for report in reports {
        let metadata = &report.metadata;
        let size = match report.indexed_files {
            0..=100 => "small",
            101..=1000 => "medium",
            1001..=10000 => "large",
            _ => "very_large",
        };
        for (dimension, value) in [
            ("project", metadata.project.as_str()),
            ("language", &metadata.language),
            ("framework", &metadata.framework),
            ("kind", &metadata.kind),
            ("category", &metadata.category),
            ("split", &report.split),
            ("size", size),
        ] {
            let value = if value.is_empty() {
                if dimension == "project" {
                    report.name.as_str()
                } else {
                    "unspecified"
                }
            } else {
                value
            };
            groups
                .entry(dimension.into())
                .or_default()
                .entry(value.into())
                .or_default()
                .push(&report.metrics);
        }
    }
    groups
        .into_iter()
        .map(|(dimension, groups)| {
            (
                dimension,
                groups
                    .into_iter()
                    .map(|(key, rows)| {
                        (
                            key,
                            GroupReport {
                                cases: rows.len(),
                                metrics: average(rows),
                            },
                        )
                    })
                    .collect(),
            )
        })
        .collect()
}
