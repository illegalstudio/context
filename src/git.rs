use crate::model::{DiffEntry, GitSignal};
use anyhow::{Context, Result, bail};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    process::Command,
};

pub fn run(root: &Path, arguments: &[&str]) -> Result<Vec<u8>> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()
        .context("Cannot run git")?;
    if !output.status.success() {
        bail!(
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output.stdout)
}

pub fn head(root: &Path) -> Option<String> {
    run(root, &["rev-parse", "HEAD"])
        .ok()
        .map(|s| String::from_utf8_lossy(&s).trim().into())
}

pub fn signals(root: &Path, files: &BTreeSet<String>) -> Result<Vec<GitSignal>> {
    let prefix = String::from_utf8(run(root, &["rev-parse", "--show-prefix"])?)?;
    let prefix = prefix.trim();
    let log = run(
        root,
        &[
            "--no-pager",
            "log",
            "-n",
            "500",
            "--format=%x00%ct",
            "--name-only",
            "-z",
            "--no-renames",
            "--",
            ".",
        ],
    )?;
    let mut timestamp = None;
    let mut result: BTreeMap<String, GitSignal> = BTreeMap::new();
    for field in log.split(|b| *b == 0).filter(|s| !s.is_empty()) {
        let field = String::from_utf8_lossy(field);
        let field = field.trim_start_matches('\n');
        if let Ok(value) = field.parse::<i64>() {
            timestamp = chrono::DateTime::from_timestamp(value, 0).map(|d| d.to_rfc3339());
        } else if let Some(path) = field.strip_prefix(prefix)
            && files.contains(path)
        {
            let entry = result.entry(path.into()).or_insert_with(|| GitSignal {
                path: path.into(),
                last_modified: timestamp.clone(),
                ..Default::default()
            });
            entry.commit_count += 1;
        }
    }
    let max = result.values().map(|s| s.commit_count).max().unwrap_or(1) as f64;
    for signal in result.values_mut() {
        signal.churn_score = signal.commit_count as f64 / max;
    }
    Ok(result.into_values().collect())
}

pub fn diff(root: &Path, reference: &str) -> Result<Vec<DiffEntry>> {
    // Resolve the user value as a revision before passing it to diff.
    let revision = run(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
    )?;
    let revision = String::from_utf8(revision)?;
    let data = run(
        root,
        &[
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--numstat",
            "-z",
            "--no-renames",
            revision.trim(),
            "--",
            ".",
        ],
    )?;
    let prefix = String::from_utf8(run(root, &["rev-parse", "--show-prefix"])?)?;
    let states = run(
        root,
        &[
            "--no-pager",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--name-status",
            "-z",
            "--no-renames",
            revision.trim(),
            "--",
            ".",
        ],
    )?;
    let mut states = states.split(|byte| *byte == 0);
    let mut statuses = BTreeMap::new();
    while let (Some(status), Some(path)) = (states.next(), states.next()) {
        let path = String::from_utf8_lossy(path).into_owned();
        let status = match status.first() {
            Some(b'A') => "added",
            Some(b'D') => "deleted",
            _ => "modified",
        };
        statuses.insert(path, status);
    }
    let mut result = Vec::new();
    for field in data.split(|b| *b == 0).filter(|s| !s.is_empty()) {
        let text = String::from_utf8_lossy(field);
        let parts: Vec<_> = text.splitn(3, '\t').collect();
        if parts.len() != 3 {
            continue;
        }
        let Some(file) = parts[2].strip_prefix(prefix.trim()) else {
            continue;
        };
        let additions = parts[0].parse().unwrap_or(0);
        let deletions = parts[1].parse().unwrap_or(0);
        result.push(DiffEntry {
            file: file.into(),
            status: statuses.get(parts[2]).copied().unwrap_or("modified").into(),
            additions,
            deletions,
            changed_lines: vec![],
        });
    }
    let patch = String::from_utf8(run(
        root,
        &[
            "--no-pager",
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=0",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--no-renames",
            revision.trim(),
            "--",
            ".",
        ],
    )?)?;
    let hunk = regex::Regex::new(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")?;
    let mut current = None;
    for line in patch.lines() {
        if let Some(file) = line.strip_prefix("+++ b/") {
            current = result.iter().position(|entry| {
                prefix.trim().is_empty() && entry.file == file
                    || file.strip_prefix(prefix.trim()) == Some(entry.file.as_str())
            });
        } else if let Some(captures) = hunk.captures(line)
            && let Some(index) = current
        {
            let start: usize = captures[1].parse()?;
            let count = captures
                .get(2)
                .map(|c| c.as_str().parse())
                .transpose()?
                .unwrap_or(1);
            result[index].changed_lines.extend(start..start + count);
        }
    }
    result.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(result)
}
