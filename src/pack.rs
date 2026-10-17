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
    #[serde(default = "default_tokenizer")]
    pub tokenizer: String,
    #[serde(default)]
    pub options: Option<PackOptions>,
    #[serde(default)]
    pub config: Option<Config>,
    #[serde(default)]
    pub parent_pack: Option<String>,
    #[serde(default)]
    pub changes: Option<PackChanges>,
    #[serde(default)]
    pub relationships: Vec<ImportRelation>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub path: String,
    pub score: f64,
    pub reasons: Vec<String>,
    #[serde(default)]
    pub contributions: BTreeMap<String, f64>,
    #[serde(default)]
    pub evidence: Vec<MatchEvidence>,
    pub excerpt_range: Option<ExcerptRange>,
    #[serde(default)]
    pub excerpt_ranges: Vec<ExcerptRange>,
    #[serde(default)]
    pub source_hash: Option<String>,
    #[serde(default)]
    pub omission_reason: Option<String>,
}

fn default_tokenizer() -> String {
    "approx".into()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackChanges {
    pub added: Vec<String>,
    pub changed: Vec<String>,
    pub removed: Vec<String>,
    pub unchanged: Vec<String>,
    pub stale_references: Vec<ImportRelation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
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

pub(crate) fn excerpt_markdown(excerpt: &Excerpt) -> String {
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

pub(crate) fn header(task: &ResolvedTask, candidates: &[Candidate]) -> String {
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
    Ok(crate::snippets::select(
        root,
        database,
        resolution,
        candidates,
        max_lines,
        "",
        budget_bytes / 4,
        &crate::tokens::Tokenizer::new("approx")?,
    )?
    .excerpts)
}

pub fn compose(
    root: &Path,
    database: &Database,
    resolution: &Resolution,
    candidates: &[Candidate],
    config: &Config,
    budget_tokens: usize,
) -> Result<PackResult> {
    let options = PackOptions {
        task: Some(resolution.task.raw.clone()),
        budget_tokens,
        ..Default::default()
    };
    compose_with_options(
        root, database, resolution, candidates, config, &options, None,
    )
}

pub fn compose_with_options(
    root: &Path,
    database: &Database,
    resolution: &Resolution,
    candidates: &[Candidate],
    config: &Config,
    options: &PackOptions,
    parent: Option<&Manifest>,
) -> Result<PackResult> {
    let tokenizer = crate::tokens::Tokenizer::new(&config.tokenizer)?;
    let relationships: Vec<_> = database
        .imports()?
        .into_iter()
        .filter(|edge| {
            candidates.iter().any(|c| c.path == edge.source_path)
                && candidates.iter().any(|c| c.path == edge.target_path)
        })
        .collect();
    let mut hashes = BTreeMap::new();
    let mut changes = PackChanges::default();
    let active: Vec<_> = if let Some(parent) = parent {
        let reset = parent.task.raw != resolution.task.raw
            || parent.task.query_terms != resolution.task.query_terms
            || parent.tokenizer != config.tokenizer
            || parent.config.as_ref().is_some_and(|old| {
                old.max_lines_per_file != config.max_lines_per_file
                    || old.budget_tokens != config.budget_tokens
            })
            || parent.options.as_ref().is_some_and(|old| {
                serde_json::to_value(old).ok() != serde_json::to_value(options).ok()
            });
        for candidate in candidates {
            let content = crate::snippets::read_source(root, &candidate.path)?;
            let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
            if let Some(old) = parent.files.iter().find(|f| f.path == candidate.path) {
                if reset || old.source_hash.as_ref() != Some(&hash) || old.excerpt_range.is_none() {
                    changes.changed.push(candidate.path.clone());
                } else {
                    changes.unchanged.push(candidate.path.clone());
                }
            } else {
                changes.added.push(candidate.path.clone());
            }
            hashes.insert(candidate.path.clone(), hash);
        }
        changes.removed = parent
            .files
            .iter()
            .filter(|f| !candidates.iter().any(|c| c.path == f.path))
            .map(|f| f.path.clone())
            .collect();
        changes.stale_references = parent
            .relationships
            .iter()
            .filter(|edge| !relationships.contains(edge))
            .cloned()
            .collect();
        candidates
            .iter()
            .filter(|c| !changes.unchanged.contains(&c.path))
            .cloned()
            .collect()
    } else {
        candidates.to_vec()
    };
    let mut header = header(&resolution.task, candidates);
    if let Some(parent) = parent {
        header.push_str(&format!("Update of pack {}. Apply this delta to the parent context. Unchanged excerpts are retained from the parent.\n\n", parent.slug));
        for path in &changes.changed {
            header.push_str(&format!("Replace previous excerpts for {path}; discard them even if no replacement fits this budget.\n"));
        }
        for path in &changes.added {
            header.push_str(&format!("New context: {path}\n"));
        }
        for path in &changes.removed {
            header.push_str(&format!("Remove previous context: {path}\n"));
        }
        for edge in &changes.stale_references {
            header.push_str(&format!(
                "Stale relationship: {} -> {}\n",
                edge.source_path, edge.target_path
            ));
        }
        header.push('\n');
    }
    let selection = crate::snippets::select(
        root,
        database,
        resolution,
        &active,
        config.max_lines_per_file,
        &header,
        options.budget_tokens,
        &tokenizer,
    )?;
    hashes.extend(selection.hashes);
    let omitted = selection.omitted;
    let excerpts = selection.excerpts;
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
                contributions: candidate.contributions.clone(),
                evidence: candidate.evidence.clone(),
                excerpt_range: excerpts
                    .iter()
                    .find(|e| e.path == candidate.path)
                    .map(|e| ExcerptRange {
                        start: e.start_line,
                        end: e.end_line,
                    })
                    .or_else(|| {
                        parent
                            .filter(|_| changes.unchanged.contains(&candidate.path))
                            .and_then(|p| p.files.iter().find(|f| f.path == candidate.path))
                            .and_then(|f| f.excerpt_range.clone())
                    }),
                excerpt_ranges: if changes.unchanged.contains(&candidate.path) {
                    parent
                        .and_then(|p| p.files.iter().find(|f| f.path == candidate.path))
                        .map(|f| f.excerpt_ranges.clone())
                        .unwrap_or_default()
                } else {
                    excerpts
                        .iter()
                        .filter(|e| e.path == candidate.path)
                        .map(|e| ExcerptRange {
                            start: e.start_line,
                            end: e.end_line,
                        })
                        .collect()
                },
                source_hash: hashes.get(&candidate.path).cloned(),
                omission_reason: omitted.get(&candidate.path).cloned(),
            })
            .collect(),
        budget_tokens: tokenizer.count(&prompt),
        tokenizer: config.tokenizer.clone(),
        options: Some(options.clone()),
        config: Some(config.clone()),
        parent_pack: parent.map(|p| p.slug.clone()),
        changes: parent.map(|_| changes.clone()),
        relationships,
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
    if parent.is_some() {
        output.insert(
            "UPDATE.md".into(),
            format!(
                "# Context update\n\n{}\n",
                serde_json::to_string_pretty(&changes)?
            ),
        );
    }
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
            format!(
                "excerpts/{name}-{}-{}-{}.md",
                &hash[..12],
                excerpt.start_line,
                excerpt.end_line
            ),
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
    if !packs.canonicalize()?.starts_with(root.canonicalize()?) {
        bail!("Pack directory must be inside the project");
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
        let manifest = serde_json::from_slice(&fs::read(checked_file(root, &path, "ctx.json")?)?)
            .with_context(|| format!("Invalid pack manifest {}", path.display()))?;
        result.push((path, manifest));
    }
    Ok(result)
}

pub fn load(root: &Path, selector: &str) -> Result<(PathBuf, Manifest)> {
    if selector.is_empty() || selector.contains(['/', '\\']) || selector == ".." {
        bail!("Provide a pack slug, unique prefix or latest");
    }
    let packs = list(root)?;
    let mut matches: Vec<_> = packs
        .into_iter()
        .filter(|(_, m)| selector == "latest" || m.slug == selector || m.slug.starts_with(selector))
        .collect();
    if selector == "latest" {
        matches.truncate(1);
    }
    if matches.len() > 1
        && let Some(position) = matches.iter().position(|(_, m)| m.slug == selector)
    {
        let exact = matches.swap_remove(position);
        matches = vec![exact];
    }
    if matches.len() > 1 {
        bail!("Pack prefix is ambiguous; use the full slug");
    }
    let (path, manifest) = matches.pop().context("Pack not found")?;
    if !path
        .canonicalize()?
        .starts_with(root.join(".context/packs").canonicalize()?)
    {
        bail!("Pack must be inside the project pack directory");
    }
    Ok((path, manifest))
}

fn checked_file(root: &Path, directory: &Path, name: &str) -> Result<PathBuf> {
    let directory = directory.canonicalize()?;
    let file = directory.join(name).canonicalize()?;
    if !directory.starts_with(root.canonicalize()?) || !file.starts_with(&directory) {
        bail!("Pack resource must be inside the selected project pack");
    }
    if fs::metadata(&file)?.len() > 16 * 1024 * 1024 {
        bail!("Pack resource exceeds 16 MiB");
    }
    Ok(file)
}

pub fn read_prompt(root: &Path, directory: &Path) -> Result<String> {
    Ok(fs::read_to_string(checked_file(
        root, directory, "PACK.md",
    )?)?)
}
