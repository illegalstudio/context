use crate::{
    config::Config, database::Database, discovery::is_test, model::*, resolver::Resolution,
};
use anyhow::{Context, Result, bail};
use flate2::{Compression, GzBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub timestamp: String,
    pub slug: String,
    pub task: ResolvedTask,
    pub files: Vec<ManifestFile>,
    pub budget_tokens: usize,
    pub commit_base: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub path: String,
    pub score: f64,
    pub reasons: Vec<String>,
    pub excerpt_range: Option<ExcerptRange>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExcerptRange {
    pub start: usize,
    pub end: usize,
}

pub struct PackResult {
    pub directory: PathBuf,
    pub manifest: Manifest,
}

fn fence(content: &str) -> String {
    let mut max = 2;
    let mut current = 0;
    for c in content.chars() {
        if c == '\u{0060}' {
            current += 1;
            max = max.max(current);
        } else {
            current = 0;
        }
    }
    "\u{0060}".repeat(max + 1)
}

fn excerpt_markdown(excerpt: &Excerpt) -> String {
    let fence = fence(&excerpt.content);
    format!(
        "### {}\n\nLines {}-{} of {}{}\n\n{}{}\n{}\n{}\n\n",
        excerpt.path,
        excerpt.start_line,
        excerpt.end_line,
        excerpt.total_lines,
        if excerpt.truncated {
            " (truncated)"
        } else {
            ""
        },
        fence,
        crate::parser::language(&excerpt.path),
        excerpt.content,
        fence
    )
}

fn header(task: &ResolvedTask, candidates: &[Candidate]) -> String {
    let mut output = format!(
        "# Context Pack\n\n## Task\n\n{}\n\nChange type: {}\nDomains: {}\n\n## Selected files\n\n",
        task.raw,
        task.change_type,
        task.domains.join(", ")
    );
    for candidate in candidates {
        output.push_str(&format!(
            "- {} ({:.0}%): {}\n",
            candidate.path,
            candidate.score * 100.0,
            candidate.reasons.join("; ")
        ));
    }
    output.push_str("\n## Code excerpts\n\n");
    output
}

pub fn excerpts(
    root: &Path,
    database: &Database,
    resolution: &Resolution,
    candidates: &[Candidate],
    max_lines: usize,
    budget_bytes: usize,
) -> Result<Vec<Excerpt>> {
    let symbols = database.symbols()?;
    let canonical_root = root.canonicalize()?;
    let mut remaining = budget_bytes;
    let mut excerpts = Vec::new();
    for candidate in candidates {
        if remaining < 120 {
            break;
        }
        let full_path = root.join(&candidate.path);
        let canonical = full_path
            .canonicalize()
            .with_context(|| format!("Cannot read {}", candidate.path))?;
        if !canonical.starts_with(&canonical_root) {
            bail!("Source moved outside repository: {}", candidate.path);
        }
        let content = fs::read_to_string(&canonical)
            .with_context(|| format!("Cannot read {}", candidate.path))?;
        let lines: Vec<_> = content.lines().collect();
        if lines.is_empty() {
            continue;
        }
        let anchor = resolution
            .stacktrace
            .iter()
            .find(|s| candidate.path == s.file || s.file.ends_with(&format!("/{}", candidate.path)))
            .map(|s| s.line)
            .or_else(|| {
                resolution
                    .diff
                    .iter()
                    .find(|d| d.file == candidate.path)
                    .and_then(|d| d.changed_lines.first().copied())
            })
            .or_else(|| {
                symbols
                    .iter()
                    .find(|s| {
                        s.file_path == candidate.path && resolution.task.symbols.contains(&s.name)
                    })
                    .map(|s| s.start_line)
            })
            .unwrap_or(1)
            .clamp(1, lines.len());
        let mut start = anchor.saturating_sub(max_lines / 3 + 1);
        if start + max_lines > lines.len() {
            start = lines.len().saturating_sub(max_lines);
        }
        let end = (start + max_lines).min(lines.len());
        let mut excerpt = Excerpt {
            path: candidate.path.clone(),
            content: lines[start..end].join("\n"),
            start_line: start + 1,
            end_line: end,
            total_lines: lines.len(),
            truncated: start > 0 || end < lines.len(),
        };
        let overhead = excerpt_markdown(&Excerpt {
            content: String::new(),
            ..excerpt.clone()
        })
        .len()
            + 32;
        if overhead >= remaining {
            break;
        }
        let allowance = remaining - overhead;
        if excerpt.content.len() > allowance {
            let mut boundary = allowance;
            while !excerpt.content.is_char_boundary(boundary) {
                boundary -= 1;
            }
            let partial = &excerpt.content[..boundary];
            let boundary = partial.rfind('\n').filter(|n| *n > 0).unwrap_or(boundary);
            excerpt.content.truncate(boundary);
            excerpt.end_line =
                excerpt.start_line + excerpt.content.lines().count().saturating_sub(1);
            excerpt.truncated = true;
        }
        while excerpt_markdown(&excerpt).len() > remaining && !excerpt.content.is_empty() {
            let excess = excerpt_markdown(&excerpt).len() - remaining;
            let mut boundary = excerpt.content.len().saturating_sub(excess.max(1));
            while !excerpt.content.is_char_boundary(boundary) {
                boundary -= 1;
            }
            excerpt.content.truncate(boundary);
            excerpt.end_line =
                excerpt.start_line + excerpt.content.lines().count().saturating_sub(1);
            excerpt.truncated = true;
        }
        if excerpt_markdown(&excerpt).len() > remaining {
            break;
        }
        remaining = remaining.saturating_sub(excerpt_markdown(&excerpt).len());
        excerpts.push(excerpt);
    }
    Ok(excerpts)
}

pub fn compose(
    root: &Path,
    database: &Database,
    resolution: &Resolution,
    candidates: &[Candidate],
    config: &Config,
    budget_tokens: usize,
) -> Result<PackResult> {
    let header = header(&resolution.task, candidates);
    let byte_budget = budget_tokens
        .checked_mul(4)
        .context("Token budget is too large")?;
    if header.len() + 128 > byte_budget {
        bail!("Token budget is too small for the task and file list; increase --budget-tokens");
    }
    let excerpts = excerpts(
        root,
        database,
        resolution,
        candidates,
        config.max_lines_per_file,
        byte_budget - header.len(),
    )?;
    let mut prompt = header;
    for excerpt in &excerpts {
        prompt.push_str(&excerpt_markdown(excerpt));
    }
    let now = chrono::Utc::now();
    let description: String = crate::resolver::words(&resolution.task.raw)
        .join("-")
        .chars()
        .take(40)
        .collect();
    let description = description.trim_end_matches('-');
    let slug = format!(
        "{}-{:06}-{}",
        now.format("%Y%m%d-%H%M%S"),
        now.timestamp_subsec_micros(),
        if description.is_empty() {
            "pack"
        } else {
            description
        }
    );
    let manifest = Manifest {
        version: env!("CARGO_PKG_VERSION").into(),
        timestamp: now.to_rfc3339(),
        slug: slug.clone(),
        task: resolution.task.clone(),
        files: candidates
            .iter()
            .map(|candidate| ManifestFile {
                path: candidate.path.clone(),
                score: candidate.score,
                reasons: candidate.reasons.clone(),
                excerpt_range: excerpts
                    .iter()
                    .find(|excerpt| excerpt.path == candidate.path)
                    .map(|excerpt| ExcerptRange {
                        start: excerpt.start_line,
                        end: excerpt.end_line,
                    }),
            })
            .collect(),
        budget_tokens: prompt.len().div_ceil(4),
        commit_base: crate::git::head(root),
        tags: resolution.task.domains.clone(),
    };
    let mut output: BTreeMap<String, String> = BTreeMap::new();
    output.insert("PACK.md".into(), prompt);
    output.insert("TASK.md".into(),format!("# Task\n\n{}\n\n## Analysis\n\nKeywords: {}\n\nDomains: {}\n\nChange type: {}\n\nHeuristic confidence: {:.0}%\n",
        resolution.task.raw,resolution.task.keywords.join(", "),resolution.task.domains.join(", "),resolution.task.change_type,resolution.task.confidence.overall*100.0));
    let mut file_list =
        "# Included Files\n\n| File | Score | Reasons |\n| --- | ---: | --- |\n".to_owned();
    for candidate in candidates {
        file_list.push_str(&format!(
            "| {} | {:.0}% | {} |\n",
            candidate.path.replace('|', "\\|"),
            candidate.score * 100.0,
            candidate.reasons.join("; ").replace('|', "\\|")
        ));
    }
    output.insert("FILES.md".into(), file_list);
    output.insert("GRAPH.md".into(), graph(database, candidates)?);
    let tests = candidates
        .iter()
        .filter(|c| is_test(&c.path))
        .map(|c| format!("- {}\n", c.path))
        .collect::<String>();
    output.insert(
        "TESTS.md".into(),
        format!(
            "# Relevant Tests\n\n{}",
            if tests.is_empty() {
                "No matching tests selected.\n"
            } else {
                &tests
            }
        ),
    );
    let diffs = resolution
        .diff
        .iter()
        .map(|d| {
            format!(
                "- {} ({}): +{} -{}\n",
                d.file, d.status, d.additions, d.deletions
            )
        })
        .collect::<String>();
    output.insert(
        "DIFF.md".into(),
        format!(
            "# Changes\n\n{}",
            if diffs.is_empty() {
                "No diff supplied.\n"
            } else {
                &diffs
            }
        ),
    );
    output.insert(
        "ctx.json".into(),
        format!("{}\n", serde_json::to_string_pretty(&manifest)?),
    );
    for excerpt in &excerpts {
        let name: String = excerpt
            .path
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .take(120)
            .collect();
        let hash = blake3::hash(excerpt.path.as_bytes()).to_hex();
        output.insert(
            format!("excerpts/{name}-{}.md", &hash[..12]),
            excerpt_markdown(excerpt),
        );
    }
    let packs = root.join(".context/packs");
    fs::create_dir_all(&packs)?;
    let staging = packs.join(format!(".pending-{slug}"));
    fs::create_dir(&staging)?;
    let mut guard = StagingGuard(Some(staging.clone()));
    fs::create_dir(staging.join("excerpts"))?;
    for (name, content) in &output {
        fs::write(staging.join(name), content)?;
    }
    let archive = fs::File::create(staging.join("ctx.tgz"))?;
    let gzip = GzBuilder::new()
        .mtime(0)
        .write(archive, Compression::fast());
    let mut tar = tar::Builder::new(gzip);
    for (name, content) in &output {
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_uid(0);
        header.set_gid(0);
        header.set_mtime(0);
        header.set_cksum();
        tar.append_data(&mut header, name, content.as_bytes())?;
    }
    let mut file = tar.into_inner()?.finish()?;
    file.flush()?;
    let directory = packs.join(slug);
    if directory.exists() {
        bail!("Pack name collision; retry the command");
    }
    fs::rename(&staging, &directory)?;
    guard.0 = None;
    Ok(PackResult {
        directory,
        manifest,
    })
}

struct StagingGuard(Option<PathBuf>);
impl Drop for StagingGuard {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn graph(db: &Database, candidates: &[Candidate]) -> Result<String> {
    let names: BTreeMap<_, _> = candidates
        .iter()
        .enumerate()
        .map(|(index, c)| (c.path.as_str(), index))
        .collect();
    let mut output = "# Dependency Graph\n\n\u{0060}\u{0060}\u{0060}mermaid\ngraph TD\n".to_owned();
    for (name, index) in &names {
        output.push_str(&format!(
            "  n{index}[\"{}\"]\n",
            name.replace('&', "&amp;")
                .replace('"', "&quot;")
                .replace(['\n', '\r'], " ")
        ));
    }
    for edge in db.imports()? {
        if let (Some(source), Some(target)) = (
            names.get(edge.source_path.as_str()),
            names.get(edge.target_path.as_str()),
        ) {
            output.push_str(&format!("  n{source} --> n{target}\n"));
        }
    }
    output.push_str("\u{0060}\u{0060}\u{0060}\n");
    Ok(output)
}

pub fn list(root: &Path) -> Result<Vec<(PathBuf, Manifest)>> {
    let packs = root.join(".context/packs");
    if !packs.exists() {
        return Ok(vec![]);
    }
    let mut paths = fs::read_dir(packs)?.collect::<std::io::Result<Vec<_>>>()?;
    paths.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    let mut result = vec![];
    for entry in paths {
        if !entry.file_type()?.is_dir() || entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        if !path.join("ctx.json").is_file() {
            continue;
        }
        let manifest = serde_json::from_slice(&fs::read(path.join("ctx.json"))?)
            .with_context(|| format!("Invalid pack manifest {}", path.display()))?;
        result.push((path, manifest));
    }
    Ok(result)
}
