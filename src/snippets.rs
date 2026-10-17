use crate::{database::Database, model::*, resolver, resolver::Resolution, tokens::Tokenizer};
use anyhow::{Context, Result, bail};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

#[derive(Clone, PartialEq)]
struct Unit {
    start: usize,
    end: usize,
    anchor: usize,
    score: f64,
    truncated: bool,
}

struct Source {
    path: String,
    lines: Vec<String>,
    units: Vec<Unit>,
    selected: Vec<Unit>,
    weight: f64,
}

pub struct Selection {
    pub excerpts: Vec<Excerpt>,
    pub hashes: BTreeMap<String, String>,
    pub omitted: BTreeMap<String, String>,
}

pub fn read_source(root: &Path, path: &str) -> Result<String> {
    let canonical = root
        .join(path)
        .canonicalize()
        .with_context(|| format!("Cannot read {path}"))?;
    if !canonical.starts_with(root.canonicalize()?) {
        bail!("Source moved outside repository: {path}");
    }
    fs::read_to_string(canonical).with_context(|| format!("Cannot read {path}"))
}

fn context_start(lines: &[String], mut start: usize) -> usize {
    for _ in 0..8 {
        if start == 0 {
            break;
        }
        let previous = lines[start - 1].trim();
        if previous.starts_with(['/', '*', '#', '@']) {
            start -= 1;
        } else {
            break;
        }
    }
    start
}

fn relevance(text: &str, task: &ResolvedTask) -> usize {
    let lexical: BTreeSet<_> = resolver::search_terms(text).into_iter().collect();
    if task.query_terms.is_empty() {
        return task
            .keywords
            .iter()
            .filter(|term| lexical.contains(*term))
            .count()
            * 100;
    }
    let literal: BTreeSet<_> = resolver::words(text).into_iter().collect();
    let mut sources = BTreeMap::<&str, usize>::new();
    for term in &task.query_terms {
        let present = if term.origin == crate::terms::Origin::Literal {
            literal.contains(&term.term)
        } else {
            lexical.contains(&term.term)
        };
        if present {
            let score = sources.entry(&term.source).or_default();
            *score = (*score).max((term.weight * 100.0).round() as usize);
        }
    }
    sources.values().sum()
}

fn units(
    path: &str,
    lines: &[String],
    symbols: &[Symbol],
    resolution: &Resolution,
    max_lines: usize,
) -> Vec<Unit> {
    let line_scores: Vec<_> = lines
        .iter()
        .map(|line| relevance(line, &resolution.task))
        .collect();
    let mut anchors = BTreeMap::<usize, f64>::new();
    for entry in &resolution.stacktrace {
        if entry.file == path || entry.file.ends_with(&format!("/{path}")) {
            anchors.insert(entry.line.saturating_sub(1).min(lines.len() - 1), 30.0);
        }
    }
    for entry in resolution.diff.iter().filter(|d| d.file == path) {
        for line in &entry.changed_lines {
            anchors
                .entry(line.saturating_sub(1).min(lines.len() - 1))
                .or_insert(20.0);
        }
    }
    let mut result = vec![];
    for symbol in symbols.iter().filter(|s| s.file_path == path) {
        let start = symbol.start_line.saturating_sub(1).min(lines.len() - 1);
        let end = symbol.end_line.min(lines.len()).max(start + 1);
        let explicit = resolution
            .task
            .symbols
            .iter()
            .any(|name| name.eq_ignore_ascii_case(&symbol.name));
        let name_score = relevance(&symbol.name, &resolution.task);
        let body_score: usize = line_scores[start..end].iter().sum();
        let pinned = anchors
            .range(start..end)
            .map(|(_, score)| *score)
            .fold(0.0_f64, f64::max);
        if !explicit && pinned == 0.0 && name_score == 0 && body_score == 0 {
            continue;
        }
        let anchor = anchors
            .range(start..end)
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(line, _)| *line)
            .unwrap_or_else(|| {
                (start..end)
                    .max_by_key(|i| (line_scores[*i], std::cmp::Reverse(*i)))
                    .unwrap_or(start)
            });
        let score = (if explicit { 40.0 } else { 0.0 })
            + pinned
            + name_score as f64 / 100.0 * 6.0
            + (body_score as f64 / 100.0).min(8.0)
            + if symbol.kind == "class" { 0.0 } else { 3.0 };
        let mut unit = Unit {
            start: context_start(lines, start),
            end,
            anchor,
            score: score / (1.0 + (end - start) as f64 / 150.0),
            truncated: false,
        };
        if unit.end - unit.start > max_lines {
            unit.start = anchor.saturating_sub(max_lines / 3).max(unit.start);
            unit.end = (unit.start + max_lines).min(end);
            unit.truncated = true;
        }
        result.push(unit);
    }
    for (anchor, score) in anchors {
        if !result.iter().any(|u| u.start <= anchor && anchor < u.end) {
            result.push(Unit {
                start: anchor.saturating_sub(8),
                end: (anchor + 16).min(lines.len()),
                anchor,
                score,
                truncated: true,
            });
        }
    }
    // Text matches also anchor templates, configuration and unsupported grammars.
    for (anchor, score) in line_scores
        .iter()
        .enumerate()
        .filter(|(_, s)| **s > 0)
        .take(128)
    {
        if !result.iter().any(|u| u.start <= anchor && anchor < u.end) {
            result.push(Unit {
                start: anchor.saturating_sub(5),
                end: (anchor + 10).min(lines.len()),
                anchor,
                score: *score as f64 / 100.0,
                truncated: true,
            });
        }
    }
    if result.is_empty() {
        result.push(Unit {
            start: 0,
            end: lines.len().min(max_lines.min(40)),
            anchor: 0,
            score: 0.5,
            truncated: lines.len() > max_lines.min(40),
        });
    }
    for (start, line) in lines.iter().enumerate() {
        let line = line.trim();
        if [
            "import ",
            "from ",
            "use ",
            "namespace ",
            "package ",
            "pub use ",
        ]
        .iter()
        .any(|prefix| line.starts_with(prefix))
        {
            let end = if (line.starts_with("import") || line.starts_with("use"))
                && !line.contains(';')
                && line.contains('{')
            {
                (start..(start + 12).min(lines.len()))
                    .find(|i| lines[*i].contains(';'))
                    .map(|i| i + 1)
                    .unwrap_or(start + 1)
            } else {
                start + 1
            };
            result.push(Unit {
                start,
                end,
                anchor: start,
                score: 0.2,
                truncated: false,
            });
        }
    }
    result.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then((a.end - a.start).cmp(&(b.end - b.start)))
            .then(a.start.cmp(&b.start))
    });
    result.dedup_by(|a, b| a.start == b.start && a.end == b.end);
    result.truncate(32);
    result
}

fn merge(mut units: Vec<Unit>) -> Vec<Unit> {
    units.sort_by_key(|u| u.start);
    let mut result: Vec<Unit> = vec![];
    for unit in units {
        if let Some(last) = result.last_mut()
            && unit.start <= last.end
        {
            last.end = last.end.max(unit.end);
            last.truncated |= unit.truncated;
        } else {
            result.push(unit);
        }
    }
    result
}

fn render(source: &Source, selected: &[Unit]) -> Vec<Excerpt> {
    selected
        .iter()
        .map(|unit| Excerpt {
            path: source.path.clone(),
            content: source.lines[unit.start..unit.end].join("\n"),
            start_line: unit.start + 1,
            end_line: unit.end,
            total_lines: source.lines.len(),
            truncated: unit.truncated,
        })
        .collect()
}

fn source_markdown(source: &Source, selected: &[Unit]) -> String {
    render(source, selected)
        .iter()
        .map(crate::pack::excerpt_markdown)
        .collect()
}

fn fit(
    source: &Source,
    unit: &Unit,
    token_limit: usize,
    max_lines: usize,
    tokenizer: &Tokenizer,
) -> Option<Vec<Unit>> {
    let fits = |unit: &Unit| {
        let mut selected = source.selected.clone();
        selected.retain(|old| !(unit.start <= old.start && unit.end >= old.end));
        selected.push(unit.clone());
        let selected = merge(selected);
        let count: usize = selected.iter().map(|u| u.end - u.start).sum();
        if count > max_lines || tokenizer.count(&source_markdown(source, &selected)) > token_limit {
            None
        } else {
            Some(selected)
        }
    };
    if let Some(selected) = fits(unit) {
        return Some(selected);
    }
    // Keep the anchor when a complete declaration cannot fit; never cut UTF-8 bytes.
    let mut low = 1;
    let mut high = unit.end - unit.start;
    let mut best = None;
    while low <= high {
        let count = low + (high - low) / 2;
        let start = unit
            .anchor
            .saturating_sub(count / 3)
            .max(unit.start)
            .min(unit.end.saturating_sub(count));
        let shortened = Unit {
            start,
            end: start + count,
            truncated: true,
            ..unit.clone()
        };
        if let Some(selected) = fits(&shortened) {
            best = Some(selected);
            low = count + 1;
        } else {
            high = count - 1;
        }
    }
    best
}

#[allow(clippy::too_many_arguments)]
pub fn select(
    root: &Path,
    database: &Database,
    resolution: &Resolution,
    candidates: &[Candidate],
    max_lines: usize,
    header: &str,
    budget: usize,
    tokenizer: &Tokenizer,
) -> Result<Selection> {
    if tokenizer.count(header) > budget {
        bail!("Token budget is too small for the task and file list; increase --budget-tokens");
    }
    let symbols = database.symbols()?;
    let mut sources = vec![];
    let mut hashes = BTreeMap::new();
    let mut omitted = BTreeMap::new();
    let mut retained_bytes = 0usize;
    for candidate in candidates {
        let content = read_source(root, &candidate.path)?;
        hashes.insert(
            candidate.path.clone(),
            blake3::hash(content.as_bytes()).to_hex().to_string(),
        );
        let lines: Vec<_> = content.lines().map(str::to_owned).collect();
        if lines.is_empty() {
            continue;
        }
        let retained = content
            .len()
            .saturating_add(lines.len().saturating_mul(std::mem::size_of::<String>()));
        if retained_bytes.saturating_add(retained) > 64 * 1024 * 1024 {
            omitted.insert(candidate.path.clone(), "source_memory_limit".into());
            continue;
        }
        retained_bytes += retained;
        let proposals = units(&candidate.path, &lines, &symbols, resolution, max_lines);
        sources.push(Source {
            path: candidate.path.clone(),
            lines,
            units: proposals,
            selected: vec![],
            weight: 0.5 + candidate.score,
        });
    }
    let available = budget.saturating_sub(tokenizer.count(header));
    let weights: f64 = sources.iter().map(|s| s.weight).sum();
    // A single source may use the budget; multiple sources each get at most half.
    let per_file_cap = if sources.len() > 1 {
        available / 2
    } else {
        available
    };
    let mut text = header.to_owned();
    let mut scale = 1usize;
    loop {
        let mut progress = false;
        let mut capped = true;
        for index in 0..sources.len() {
            let source = &sources[index];
            let share = ((available as f64 * source.weight / weights).floor() as usize).max(1);
            let target = share.saturating_mul(scale).min(per_file_cap);
            capped &= target == per_file_cap;
            let old = tokenizer.count(&source_markdown(source, &source.selected));
            let allowance = target
                .min(
                    budget
                        .saturating_sub(tokenizer.count(&text))
                        .saturating_add(old),
                )
                .saturating_sub(4);
            for unit in &source.units {
                if source
                    .selected
                    .iter()
                    .any(|s| s.start <= unit.start && s.end >= unit.end)
                {
                    continue;
                }
                let Some(selected) = fit(source, unit, allowance, max_lines, tokenizer) else {
                    continue;
                };
                // Overlapping clipped declarations may only change anchor/score metadata.
                // Progress must add source lines, otherwise rounds can alternate forever.
                if selected
                    .iter()
                    .map(|unit| unit.end - unit.start)
                    .sum::<usize>()
                    <= source
                        .selected
                        .iter()
                        .map(|unit| unit.end - unit.start)
                        .sum::<usize>()
                {
                    continue;
                }
                let mut trial = header.to_owned();
                for (j, s) in sources.iter().enumerate() {
                    trial.push_str(&source_markdown(
                        s,
                        if index == j { &selected } else { &s.selected },
                    ));
                }
                if tokenizer.count(&trial) <= budget {
                    sources[index].selected = selected;
                    text = trial;
                    progress = true;
                }
                break;
            }
        }
        if capped && !progress {
            break;
        }
        scale = scale.saturating_mul(2);
    }
    for source in &sources {
        if source.selected.is_empty() {
            let reason = if source
                .lines
                .iter()
                .any(|line| tokenizer.count(line) > per_file_cap.saturating_sub(4))
            {
                "oversized_line"
            } else {
                "token_budget"
            };
            omitted.insert(source.path.clone(), reason.into());
        }
    }
    Ok(Selection {
        excerpts: sources
            .iter()
            .flat_map(|s| render(s, &s.selected))
            .collect(),
        hashes,
        omitted,
    })
}
