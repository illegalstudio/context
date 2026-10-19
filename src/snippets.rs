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
    priority: u8,
}

struct Source {
    path: String,
    lines: Vec<String>,
    units: Vec<Unit>,
    selected: Vec<Unit>,
    weight: f64,
    budgeted_test: bool,
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

fn evidence(text: &str, task: &ResolvedTask) -> BTreeMap<String, f64> {
    let lexical: BTreeSet<_> = resolver::search_terms(text).into_iter().collect();
    if task.query_terms.is_empty() {
        return task
            .keywords
            .iter()
            .filter(|term| lexical.contains(*term))
            .map(|term| (term.clone(), 1.0))
            .collect();
    }
    let literal: BTreeSet<_> = resolver::words(text).into_iter().collect();
    let mut sources = BTreeMap::<String, f64>::new();
    for term in &task.query_terms {
        let present = if term.origin == crate::terms::Origin::Literal {
            literal.contains(&term.term)
        } else {
            lexical.contains(&term.term)
        };
        if present {
            let score = sources.entry(term.source.clone()).or_default();
            *score = (*score).max(term.weight);
        }
    }
    sources
}

fn code_lines(lines: &[String]) -> Vec<bool> {
    let mut block = false;
    lines
        .iter()
        .map(|line| {
            let mut text = line.trim();
            if block {
                let Some((_, rest)) = text.split_once("*/") else {
                    return false;
                };
                text = rest.trim();
                block = false;
            }
            if text.starts_with("/*") {
                if let Some((_, rest)) = text.split_once("*/") {
                    text = rest.trim();
                } else {
                    block = true;
                    return false;
                }
            }
            !text.is_empty()
                && !["//", "<!--", "*"]
                    .iter()
                    .any(|prefix| text.starts_with(prefix))
                && (!text.starts_with('#') || text.starts_with("#["))
        })
        .collect()
}

fn test_context(
    path: &str,
    lines: &[String],
    symbols: &[&Symbol],
    resolution: &Resolution,
    anchors: &BTreeMap<usize, f64>,
) -> Option<crate::test_context::Context> {
    if !crate::quality::is_test_path(path)
        || resolution.task.domains.iter().any(|d| d == "testing")
        || resolution.task.files_hint.iter().any(|hint| {
            let relative = hint.trim_start_matches("./");
            (relative == path || path.ends_with(&format!("/{relative}")))
                && (resolution.task.raw.contains(hint)
                    || !resolution.stacktrace.iter().any(|s| s.file == *hint)
                        && !resolution.diff.iter().any(|d| d.file == *hint))
        })
        || symbols.iter().any(|symbol| {
            !symbol.is_test_case
                && (resolution
                    .task
                    .symbols
                    .iter()
                    .any(|name| name.eq_ignore_ascii_case(&symbol.name))
                    || symbol.kind != "class"
                        && anchors
                            .range(symbol.start_line.saturating_sub(1)..symbol.end_line)
                            .next()
                            .is_some())
        })
    {
        return None;
    }
    let selected: Vec<_> = symbols
        .iter()
        .filter(|symbol| symbol.is_test_case)
        .filter(|symbol| {
            evidence(&symbol.name, &resolution.task)
                .values()
                .sum::<f64>()
                >= 0.5
                || resolution
                    .task
                    .symbols
                    .iter()
                    .any(|name| name.eq_ignore_ascii_case(&symbol.name))
                || anchors
                    .range(symbol.start_line.saturating_sub(1)..symbol.end_line)
                    .next()
                    .is_some()
        })
        .map(|symbol| symbol.start_line.saturating_sub(1)..symbol.end_line)
        .collect();
    if selected.is_empty() {
        return None;
    }
    crate::test_context::analyze(path, &lines.join("\n"), symbols, &selected)
}

fn focus_tests(
    mut units: Vec<Unit>,
    context: crate::test_context::Context,
    lines: &[String],
) -> Vec<Unit> {
    // Keep one strongest case before its required setup. Extra cases and
    // enclosing context can then use the remaining per-file allowance.
    let primary = if units.iter().any(|unit| unit.priority >= 2) {
        None
    } else {
        units
            .iter()
            .enumerate()
            .filter(|(_, unit)| unit.priority == 1)
            .max_by(|(_, a), (_, b)| a.score.total_cmp(&b.score).then(b.start.cmp(&a.start)))
            .map(|(index, _)| index)
    };
    for (index, unit) in units.iter_mut().enumerate() {
        if unit.priority == 1 {
            unit.priority = if primary == Some(index) { 2 } else { 0 };
        }
    }
    for support in context.support {
        let range = support.range;
        if range.start >= range.end || range.end > lines.len() {
            continue;
        }
        units.push(Unit {
            start: range.start,
            end: range.end,
            anchor: range.start,
            score: 1.0,
            priority: u8::from(support.required),
            truncated: false,
        });
    }
    let mut result = vec![];
    for unit in units {
        let mut ranges: Vec<_> = std::iter::once(unit.start..unit.end).collect();
        for excluded in &context.excluded {
            let start = context_start(lines, excluded.start);
            ranges = ranges
                .into_iter()
                .flat_map(|range| {
                    if start >= range.end || excluded.end <= range.start {
                        return vec![range];
                    }
                    let mut parts = vec![];
                    if range.start < start {
                        parts.push(range.start..start);
                    }
                    if range.end > excluded.end {
                        parts.push(excluded.end..range.end);
                    }
                    parts
                })
                .collect();
        }
        for range in ranges {
            if lines[range.clone()]
                .iter()
                .all(|line| line.trim().is_empty())
            {
                continue;
            }
            result.push(Unit {
                anchor: unit.anchor.clamp(range.start, range.end - 1),
                truncated: unit.truncated || range.start != unit.start || range.end != unit.end,
                start: range.start,
                end: range.end,
                ..unit.clone()
            });
        }
    }
    result
}

fn units(
    path: &str,
    lines: &[String],
    symbols: &[Symbol],
    resolution: &Resolution,
    max_lines: usize,
) -> Vec<Unit> {
    let active = code_lines(lines);
    let line_evidence: Vec<_> = lines
        .iter()
        .map(|line| evidence(line, &resolution.task))
        .collect();
    let symbols: Vec<_> = symbols.iter().filter(|s| s.file_path == path).collect();
    let production = symbols
        .iter()
        .any(|symbol| !symbol.is_test && symbol.kind != "class");
    let mixed_tests = production && symbols.iter().any(|symbol| symbol.is_test);
    let structured_data = matches!(
        Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("json" | "yaml" | "yml" | "toml" | "ini")
    );
    let contextual = mixed_tests
        || crate::quality::is_test_path(path)
        || crate::discovery::is_config(path)
        || structured_data;
    let reference_scores: Vec<usize> = line_evidence
        .iter()
        .map(|terms| {
            terms
                .values()
                .map(|weight| (weight * 100.0).round() as usize)
                .sum()
        })
        .collect();
    let line_scores: Vec<_> = line_evidence
        .iter()
        .enumerate()
        .map(|(index, terms)| {
            if contextual {
                terms.values().sum::<f64>() * if active[index] { 1.0 } else { 0.35 }
            } else {
                reference_scores[index] as f64 / 100.0
            }
        })
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
    let test_context = test_context(path, lines, &symbols, resolution, &anchors);
    let mut result = vec![];
    for symbol in &symbols {
        let start = symbol.start_line.saturating_sub(1).min(lines.len() - 1);
        let end = symbol.end_line.min(lines.len()).max(start + 1);
        let explicit = resolution
            .task
            .symbols
            .iter()
            .any(|name| name.eq_ignore_ascii_case(&symbol.name));
        let name_terms = evidence(&symbol.name, &resolution.task);
        let name_score: f64 = if contextual {
            name_terms.values().sum()
        } else {
            name_terms
                .values()
                .map(|weight| (weight * 100.0).round() as usize)
                .sum::<usize>() as f64
                / 100.0
        };
        let body_score: f64 = if contextual {
            line_scores[start..end].iter().sum()
        } else {
            reference_scores[start..end].iter().sum::<usize>() as f64 / 100.0
        };
        let pinned = anchors
            .range(start..end)
            .map(|(_, score)| *score)
            .fold(0.0_f64, f64::max);
        if !explicit && pinned == 0.0 && name_score == 0.0 && body_score == 0.0 {
            continue;
        }
        let anchor = anchors
            .range(start..end)
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(line, _)| *line)
            .unwrap_or_else(|| {
                (start..end)
                    .max_by(|a, b| line_scores[*a].total_cmp(&line_scores[*b]).then(b.cmp(a)))
                    .unwrap_or(start)
            });
        let score = (if explicit { 40.0 } else { 0.0 })
            + pinned
            + name_score * 6.0
            + body_score.min(8.0)
            + if symbol.kind == "class" { 0.0 } else { 3.0 };
        let score = score / (1.0 + (end - start) as f64 / 150.0);
        let score = score
            * if mixed_tests
                && symbol.is_test
                && !explicit
                && pinned == 0.0
                && !resolution
                    .task
                    .domains
                    .iter()
                    .any(|domain| domain == "testing")
            {
                0.35
            } else {
                1.0
            };
        let unit = Unit {
            start: context_start(lines, start),
            end,
            anchor,
            score,
            truncated: false,
            priority: if explicit {
                3
            } else if pinned > 0.0 {
                2
            } else if ((symbol.kind == "test" || test_context.is_some() && symbol.is_test_case)
                && name_score >= 0.5
                && crate::quality::is_test_path(path))
                || mixed_tests
                    && !symbol.is_test
                    && symbol.kind != "class"
                    && !resolution
                        .task
                        .domains
                        .iter()
                        .any(|domain| domain == "testing")
            {
                1
            } else {
                0
            },
        };
        if unit.end - unit.start > max_lines {
            let width = (max_lines / 3).max(1);
            let mut points = vec![anchor];
            let mut covered: BTreeSet<_> = line_evidence[anchor].keys().collect();
            let mut ranked: Vec<_> = (start..end)
                .filter(|line| line_scores[*line] > 0.0)
                .collect();
            ranked.sort_by(|a, b| line_scores[*b].total_cmp(&line_scores[*a]).then(a.cmp(b)));
            for point in ranked {
                if points.len() == 3 {
                    break;
                }
                if !matches!(symbol.kind.as_str(), "class" | "interface")
                    && points.iter().all(|old| point.abs_diff(*old) >= width)
                    && line_evidence[point]
                        .keys()
                        .any(|term| !covered.contains(term))
                {
                    points.push(point);
                    covered.extend(line_evidence[point].keys());
                }
            }
            if points.len() == 1 {
                let start = anchor.saturating_sub(max_lines / 3).max(unit.start);
                result.push(Unit {
                    start,
                    end: (start + max_lines).min(end),
                    truncated: true,
                    ..unit
                });
                continue;
            }
            let width = (max_lines / points.len()).max(1);
            for point in points {
                let start = point
                    .saturating_sub(width / 3)
                    .max(unit.start)
                    .min(end.saturating_sub(width));
                result.push(Unit {
                    start,
                    end: (start + width).min(end),
                    anchor: point,
                    score: unit.score
                        * (0.8 + 0.2 * line_scores[point] / line_scores[anchor].max(1.0)),
                    priority: if point == anchor { unit.priority } else { 0 },
                    truncated: true,
                });
            }
        } else {
            result.push(unit);
        }
    }
    for (anchor, score) in anchors {
        if !result.iter().any(|u| u.start <= anchor && anchor < u.end) {
            result.push(Unit {
                start: anchor.saturating_sub(8),
                end: (anchor + 16).min(lines.len()),
                anchor,
                score,
                truncated: true,
                priority: 2,
            });
        }
    }
    // Text matches also anchor templates, configuration and unsupported grammars.
    let mut text_matches: Vec<_> = line_scores
        .iter()
        .enumerate()
        .filter(|(_, score)| **score > 0.0)
        .collect();
    if contextual {
        text_matches.sort_by(|a, b| b.1.total_cmp(a.1).then(a.0.cmp(&b.0)));
    }
    for (anchor, score) in text_matches.into_iter().take(128) {
        if !result.iter().any(|u| u.start <= anchor && anchor < u.end) {
            result.push(Unit {
                start: anchor.saturating_sub(5),
                end: (anchor + 10).min(lines.len()),
                anchor,
                score: *score,
                truncated: true,
                priority: 0,
            });
        }
    }
    if crate::discovery::is_config(path) || structured_data {
        for (start, line) in lines.iter().enumerate().filter(|(index, _)| active[*index]) {
            let text = line.trim();
            if text.contains("=>")
                || text.contains('=')
                || text.split_once(':').is_some_and(|(key, _)| {
                    !key.is_empty()
                        && key.chars().all(|c| {
                            c.is_alphanumeric() || matches!(c, '_' | '-' | '\'' | '"' | '.')
                        })
                })
            {
                result.push(Unit {
                    start,
                    end: (start + 3).min(lines.len()),
                    anchor: start,
                    score: 0.9 + line_scores[start],
                    truncated: true,
                    priority: 0,
                });
            }
        }
    }
    if result.is_empty() {
        result.push(Unit {
            start: 0,
            end: lines.len().min(max_lines.min(40)),
            anchor: 0,
            score: 0.5,
            truncated: lines.len() > max_lines.min(40),
            priority: 0,
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
                priority: 0,
            });
        }
    }
    if let Some(context) = test_context {
        result = focus_tests(result, context, lines);
    }
    result.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then(b.score.total_cmp(&a.score))
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
            budgeted_test: crate::quality::is_test_path(&candidate.path)
                && !candidate.reserved
                && !resolution
                    .task
                    .domains
                    .iter()
                    .any(|domain| domain == "testing"),
        });
    }
    let available = budget.saturating_sub(tokenizer.count(header));
    let weights: f64 = sources.iter().map(|s| s.weight).sum();
    let mut restrict_tests = sources.iter().any(|source| source.budgeted_test)
        && sources.iter().any(|source| !source.budgeted_test);
    let test_cap = available / 5;
    let mut test_tokens = 0usize;
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
            let role_allowance = if restrict_tests && source.budgeted_test {
                test_cap.saturating_sub(test_tokens.saturating_sub(old))
            } else {
                usize::MAX
            };
            let allowance = target
                .min(
                    budget
                        .saturating_sub(tokenizer.count(&text))
                        .saturating_add(old),
                )
                .min(role_allowance)
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
                    if restrict_tests && source.budgeted_test {
                        test_tokens = test_tokens.saturating_sub(old)
                            + tokenizer.count(&source_markdown(source, &selected));
                    }
                    sources[index].selected = selected;
                    text = trial;
                    progress = true;
                }
                break;
            }
        }
        if capped && !progress {
            // Once implementation cannot grow, tests can use the remaining capacity.
            if restrict_tests {
                restrict_tests = false;
                continue;
            }
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
