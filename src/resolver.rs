use crate::{config, model::*};
use anyhow::{Context, Result, bail};
use chrono::{Duration, NaiveDateTime, Utc};
use regex::Regex;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    sync::OnceLock,
};

pub use crate::terms::{search_terms, words};

fn stopword(word: &str) -> bool {
    matches!(
        word,
        "the"
            | "and"
            | "for"
            | "with"
            | "from"
            | "that"
            | "this"
            | "have"
            | "has"
            | "are"
            | "was"
            | "when"
            | "where"
            | "which"
            | "not"
            | "into"
            | "using"
            | "should"
            | "could"
            | "would"
            | "there"
            | "their"
            | "something"
            | "broken"
            | "fix"
            | "bug"
            | "issue"
            | "error"
            | "add"
            | "new"
            | "implement"
            | "refactor"
            | "improve"
            | "optimize"
            | "il"
            | "lo"
            | "la"
            | "le"
            | "gli"
            | "del"
            | "della"
            | "delle"
            | "dei"
            | "di"
            | "da"
            | "in"
            | "con"
            | "che"
            | "per"
            | "un"
            | "una"
            | "uno"
            | "non"
            | "nel"
            | "nella"
            | "al"
            | "allo"
            | "alla"
            | "come"
            | "sono"
            | "essere"
            | "fare"
            | "sul"
            | "sulla"
            | "si"
            | "to"
            | "of"
            | "on"
            | "is"
            | "it"
            | "as"
            | "at"
            | "be"
            | "an"
            | "or"
    )
}

fn file_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)[\w@./\\-]+\.(?:tsx?|jsx?|mjs|cjs|php|py|rb|go|rs|java|kt|swift|cs|cpp|hpp|c|h|vue|svelte|ya?ml|json|toml|md|html|css|sql|sh)\b").unwrap())
}

pub struct Resolution {
    pub task: ResolvedTask,
    pub stacktrace: Vec<StacktraceEntry>,
    pub diff: Vec<DiffEntry>,
}

pub fn resolve(root: &Path, options: &PackOptions) -> Result<Resolution> {
    resolve_with_scopes(root, options, &crate::frameworks::detect(root)?)
}

pub fn resolve_indexed(
    root: &Path,
    database: &crate::database::Database,
    options: &PackOptions,
) -> Result<Resolution> {
    let scopes = match database.framework_scopes()? {
        Some(scopes) => scopes,
        None => crate::frameworks::detect(root)?,
    };
    resolve_with_scopes(root, options, &scopes)
}

fn resolve_with_scopes(
    root: &Path,
    options: &PackOptions,
    scopes: &[crate::frameworks::FrameworkScope],
) -> Result<Resolution> {
    let mut raw = options.task.clone().unwrap_or_default().trim().to_owned();
    if options.task.is_some() && raw.is_empty() {
        bail!("Task description cannot be empty");
    }
    let mut stacktrace = vec![];
    if let Some(path) = &options.error {
        let path = root.join(path);
        if fs::metadata(&path)?.len() > 16 * 1024 * 1024 {
            bail!("Error log exceeds 16 MiB; select a smaller log excerpt");
        }
        let log = fs::read_to_string(&path)
            .with_context(|| format!("Cannot read error log {}", path.display()))?;
        let log = filter_log(&log, options.since.as_deref())?;
        stacktrace = parse_stacktrace(&log);
        if raw.is_empty() {
            raw = log
                .lines()
                .filter(|l| !l.trim().is_empty())
                .take(4)
                .collect::<Vec<_>>()
                .join("\n");
        }
    } else if options.since.is_some() {
        bail!("--since requires --error");
    }
    let diff = options
        .diff
        .as_deref()
        .map(|reference| crate::git::diff(root, reference))
        .transpose()?
        .unwrap_or_default();
    if raw.is_empty() {
        raw = if let Some(file) = &options.file {
            format!("Analyze {file} {}", options.symbol.as_deref().unwrap_or(""))
        } else if let Some(symbol) = &options.symbol {
            format!("Analyze symbol {symbol}")
        } else if options.diff.is_some() {
            "Review current changes".into()
        } else {
            String::new()
        };
    }
    let raw_words: BTreeSet<_> = words(&raw)
        .into_iter()
        .filter(|word| !stopword(word))
        .collect();
    let query_terms = crate::terms::query_terms(&raw_words.iter().cloned().collect::<Vec<_>>());
    let keywords: BTreeSet<_> = query_terms.iter().map(|term| term.term.clone()).collect();
    let mut files_hint: BTreeSet<String> = file_regex()
        .find_iter(&raw)
        .map(|m| m.as_str().trim_start_matches('@').replace('\\', "/"))
        .collect();
    if let Some(file) = &options.file {
        files_hint.insert(file.replace('\\', "/"));
    }
    files_hint.extend(stacktrace.iter().map(|entry| entry.file.clone()));
    files_hint.extend(
        diff.iter()
            .filter(|entry| entry.status != "deleted")
            .map(|entry| entry.file.clone()),
    );
    let mut symbols: BTreeSet<String> = raw
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|word| {
            word.len() >= 3
                && !stopword(&word.to_lowercase())
                && (word.chars().skip(1).any(char::is_uppercase)
                    && word.chars().any(char::is_lowercase)
                    || word.contains('_'))
        })
        .map(str::to_owned)
        .collect();
    if let Some(symbol) = &options.symbol {
        symbols.insert(symbol.clone());
    }
    static EXPLICIT: OnceLock<Regex> = OnceLock::new();
    let explicit = EXPLICIT.get_or_init(|| Regex::new(r"(?:@([\p{L}_][\p{L}\p{N}_]*)\b|`([\p{L}_][\p{L}\p{N}_]*)`|\b([\p{L}_][\p{L}\p{N}_]*)\s*\(\s*\))").unwrap());
    for capture in explicit.captures_iter(&raw) {
        if let Some(name) = capture.get(1) {
            let start = capture.get(0).unwrap().start();
            if raw[..start]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_alphanumeric() || matches!(c, '_' | '.'))
                || raw[name.end()..].starts_with(['/', '\\', '.', ':'])
            {
                continue;
            }
        }
        if let Some(name) = capture
            .get(1)
            .or_else(|| capture.get(2))
            .or_else(|| capture.get(3))
        {
            symbols.insert(name.as_str().into());
        }
    }
    let domains = config::domains_for_scopes(root, false, scopes)?;
    let mut domain_weights = BTreeMap::new();
    for (_, domain, _) in &domains {
        let matches: f64 = domain
            .keywords
            .iter()
            .map(|keyword| {
                let terms = search_terms(keyword);
                query_terms
                    .iter()
                    .filter(|term| terms.contains(&term.term))
                    .map(|term| term.weight)
                    .fold(0.0, f64::max)
            })
            .sum();
        if matches >= 0.3 {
            domain_weights.insert(domain.name.clone(), matches);
        }
    }
    for domain in &options.focus {
        if !domains
            .iter()
            .any(|(_, definition, _)| definition.name == *domain)
        {
            bail!("Unknown focus domain: {domain}");
        }
        domain_weights.insert(domain.clone(), 10.0);
    }
    let change_type = detect_change_type(&raw);
    let mut signals = BTreeMap::new();
    signals.insert(
        "hasExactFileName".into(),
        serde_json::json!(!files_hint.is_empty()),
    );
    signals.insert(
        "hasClassName".into(),
        serde_json::json!(
            symbols
                .iter()
                .any(|s| s.chars().next().is_some_and(char::is_uppercase))
        ),
    );
    signals.insert(
        "hasMethodName".into(),
        serde_json::json!(
            options.symbol.is_some()
                || symbols
                    .iter()
                    .any(|s| s.chars().next().is_some_and(char::is_lowercase))
        ),
    );
    signals.insert(
        "hasRoutePattern".into(),
        serde_json::json!(raw.contains("/api/")),
    );
    signals.insert(
        "hasErrorCode".into(),
        serde_json::json!(
            raw.split_whitespace()
                .any(|s| matches!(s, "401" | "403" | "404" | "500"))
        ),
    );
    signals.insert(
        "keywordMatchCount".into(),
        serde_json::json!(raw_words.len()),
    );
    let confidence = (if !files_hint.is_empty() { 0.3_f64 } else { 0.0 })
        + if !symbols.is_empty() { 0.25 } else { 0.0 }
        + if !stacktrace.is_empty() { 0.3 } else { 0.0 }
        + if !diff.is_empty() { 0.3 } else { 0.0 }
        + (raw_words.len() as f64 * 0.04).min(0.2);
    Ok(Resolution {
        task: ResolvedTask {
            raw: raw.trim().into(),
            raw_words: raw_words.into_iter().collect(),
            keywords: keywords.into_iter().collect(),
            query_terms,
            files_hint: files_hint.into_iter().collect(),
            symbols: symbols.into_iter().collect(),
            domains: domain_weights.keys().cloned().collect(),
            domain_weights,
            change_type: change_type.into(),
            confidence: TaskConfidence {
                overall: confidence.min(1.0),
                signals,
            },
        },
        stacktrace,
        diff,
    })
}

fn detect_change_type(text: &str) -> &'static str {
    let words = words(text);
    for (kind, terms) in [
        (
            "security",
            &["security", "vulnerability", "vulnerabilita", "csrf", "xss"][..],
        ),
        (
            "perf",
            &[
                "optimize",
                "performance",
                "slow",
                "latency",
                "ottimizza",
                "lento",
            ][..],
        ),
        (
            "refactor",
            &["refactor", "restructure", "simplify", "ristruttura"][..],
        ),
        (
            "bugfix",
            &[
                "fix", "bug", "error", "fails", "failing", "broken", "errore", "correggi",
                "problema", "issue",
            ][..],
        ),
        (
            "feature",
            &[
                "add",
                "implement",
                "create",
                "introduce",
                "new",
                "aggiungi",
                "crea",
                "implementa",
            ][..],
        ),
    ] {
        if words.iter().any(|word| terms.contains(&word.as_str())) {
            return kind;
        }
    }
    "unknown"
}

pub fn parse_stacktrace(text: &str) -> Vec<StacktraceEntry> {
    static COLON: OnceLock<Regex> = OnceLock::new();
    static PYTHON: OnceLock<Regex> = OnceLock::new();
    static PHP: OnceLock<Regex> = OnceLock::new();
    let colon = COLON.get_or_init(|| {
        Regex::new(r"([\w./\\-]+\.(?:tsx?|jsx?|php|py|rb|go|rs|java)):(\d+)(?::\d+)?").unwrap()
    });
    let python = PYTHON.get_or_init(|| Regex::new(r#"File "([^"]+)", line (\d+)"#).unwrap());
    let php = PHP.get_or_init(|| Regex::new(r"([\w./\\-]+\.php)\((\d+)\)").unwrap());
    let mut entries = BTreeSet::new();
    for regex in [colon, python, php] {
        for captures in regex.captures_iter(text) {
            if let Ok(line) = captures[2].parse::<usize>() {
                entries.insert((captures[1].replace('\\', "/"), line));
            }
        }
    }
    entries
        .into_iter()
        .map(|(file, line)| StacktraceEntry { file, line })
        .collect()
}

fn filter_log(log: &str, since: Option<&str>) -> Result<String> {
    let Some(since) = since else {
        return Ok(log.into());
    };
    if since.len() < 2 || !since.is_ascii() {
        bail!("Invalid --since duration, use 30m, 1h or 2d");
    }
    let (amount, unit) = since.split_at(since.len() - 1);
    let amount: i64 = amount.parse().context("Invalid --since duration")?;
    let seconds = amount
        .checked_mul(match unit {
            "s" => 1,
            "m" => 60,
            "h" => 3600,
            "d" => 86400,
            _ => bail!("Invalid --since unit"),
        })
        .filter(|v| *v > 0)
        .context("Invalid --since duration")?;
    let duration = Duration::try_seconds(seconds).context("Duration out of range")?;
    let cutoff = Utc::now()
        .checked_sub_signed(duration)
        .context("Duration out of range")?
        .naive_utc();
    let mut keep = true;
    let mut output = String::new();
    for line in log.lines() {
        let date = line
            .trim_start_matches('[')
            .get(..19)
            .and_then(|s| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok());
        if let Some(date) = date {
            keep = date >= cutoff;
        }
        if keep {
            output.push_str(line);
            output.push('\n');
        }
    }
    Ok(output)
}
