use crate::{
    config::{self, Config},
    database::{Database, FileUpdate, IndexedFile},
    model::*,
    parser, resolver,
};
use anyhow::{Context, Result};
use ignore::WalkBuilder;
use rayon::prelude::*;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    time::{Instant, UNIX_EPOCH},
};

thread_local! {
    static WORKER_PARSER: RefCell<tree_sitter::Parser> = RefCell::new(tree_sitter::Parser::new());
}

pub fn index(
    root: &Path,
    database: &mut Database,
    config: &Config,
    verify: bool,
) -> Result<IndexStats> {
    let start = Instant::now();
    let mut previous = database.files()?;
    let skipped = database.skipped_files()?;
    previous.extend(skipped.clone());
    let custom_ignore = root.join(".ctxignore").is_file();
    let mut walker = WalkBuilder::new(root);
    walker
        .standard_filters(false)
        .follow_links(false)
        .add_custom_ignore_filename(".ctxignore")
        .filter_entry(move |entry| {
            let name = entry.file_name().to_string_lossy();
            if entry.depth() > 0 && matches!(name.as_ref(), ".git" | ".context") {
                return false;
            }
            if !custom_ignore
                && entry.depth() > 0
                && matches!(
                    name.as_ref(),
                    "node_modules"
                        | "vendor"
                        | "target"
                        | ".venv"
                        | "venv"
                        | "__pycache__"
                        | "dist"
                        | "build"
                        | "coverage"
                )
            {
                return false;
            }
            true
        });
    let mut current = BTreeMap::new();
    for entry in walker.build() {
        let entry = entry.context("Cannot scan repository")?;
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = parser::normalize(entry.path().strip_prefix(root)?);
        let metadata = entry.metadata()?;
        if metadata.len() == 0 || metadata.len() > config.max_file_size {
            continue;
        }
        let language = parser::language(&path);
        if !config.include_languages.is_empty()
            && !config.include_languages.iter().any(|l| l == language)
        {
            continue;
        }
        if !custom_ignore
            && (path
                .split('/')
                .next_back()
                .is_some_and(|p| p == ".env" || p.starts_with(".env.") && p != ".env.example")
                || path.ends_with(".pem")
                || path.ends_with(".key"))
        {
            continue;
        }
        let mtime = metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .min(i64::MAX as u128) as i64;
        current.insert(
            path.clone(),
            FileMetadata {
                path,
                language: language.into(),
                size: metadata.len(),
                mtime,
                hash: String::new(),
            },
        );
    }
    let mut pending: Vec<_> = current
        .values()
        .filter(|file| {
            verify
                || previous
                    .get(&file.path)
                    .is_none_or(|old| old.size != file.size || old.mtime != file.mtime)
        })
        .cloned()
        .collect();
    pending.sort_by(|a, b| a.path.cmp(&b.path));
    // Bound retained source text to one batch. The transaction consumes batches lazily.
    let batch_size = (64 * 1024 * 1024 / config.max_file_size).clamp(1, 128) as usize;
    let changes = pending.chunks(batch_size).flat_map(|batch| {
        batch
            .par_iter()
            .map(|file| {
                let bytes = fs::read(root.join(&file.path))
                    .with_context(|| format!("Cannot read {}", file.path))?;
                let mut metadata = file.clone();
                metadata.hash = blake3::hash(&bytes).to_hex().to_string();
                if let Some(old) = previous.get(&file.path)
                    && old.hash == metadata.hash
                {
                    return Ok(if skipped.contains_key(&file.path) {
                        FileUpdate::Skipped(metadata)
                    } else {
                        FileUpdate::Metadata(metadata)
                    });
                }
                if bytes.contains(&0) {
                    return Ok(FileUpdate::Skipped(metadata));
                }
                let Ok(content) = String::from_utf8(bytes) else {
                    return Ok(FileUpdate::Skipped(metadata));
                };
                let parsed = WORKER_PARSER.with(|worker| {
                    parser::parse(&metadata.path, &content, &mut worker.borrow_mut())
                })?;
                let terms = resolver::search_terms(&content);
                Ok(FileUpdate::Changed(IndexedFile {
                    metadata,
                    content: format!("{content}\n{}", terms.join(" ")),
                    symbols: parsed.symbols,
                    imports: parsed.imports,
                    references: parsed.references,
                }))
            })
            .collect::<Vec<Result<FileUpdate>>>()
    });
    let removed: Vec<_> = previous
        .keys()
        .filter(|path| !current.contains_key(*path))
        .cloned()
        .collect();
    let paths: BTreeSet<_> = current.keys().cloned().collect();
    let head = crate::git::head(root);
    let git_key = head.as_ref().map(|head| {
        let paths = paths.iter().cloned().collect::<Vec<_>>().join("\0");
        format!("{head}:{}", blake3::hash(paths.as_bytes()))
    });
    let refresh_git = git_key.is_some() && database.state("git_key")? != git_key;
    let git = if refresh_git {
        Some(crate::git::signals(root, &paths)?)
    } else if head.is_none() {
        Some(vec![])
    } else {
        None
    };
    let aliases = aliases(root)?;
    let (updated, removed) = database.update(
        changes,
        &removed,
        git.as_deref(),
        git_key.as_deref(),
        &aliases,
    )?;
    let (files, symbols, imports) = database.counts()?;
    Ok(IndexStats {
        files,
        symbols,
        imports,
        updated,
        removed,
        duration_ms: start.elapsed().as_millis(),
    })
}

pub fn aliases(root: &Path) -> Result<Vec<(String, String)>> {
    let mut aliases = vec![];
    let composer: serde_json::Value = config::read_json(&root.join("composer.json"))?;
    if let Some(mappings) = composer
        .pointer("/autoload/psr-4")
        .and_then(|v| v.as_object())
    {
        for (prefix, target) in mappings {
            if let Some(target) = target.as_str() {
                aliases.push((prefix.clone(), target.into()));
            } else if let Some(targets) = target.as_array() {
                for target in targets.iter().filter_map(|v| v.as_str()) {
                    aliases.push((prefix.clone(), target.into()));
                }
            }
        }
    }
    // Read strict JSON configs; JS-style tsconfig comments are accepted by a small lexer.
    if root.join("tsconfig.json").is_file() {
        let text = fs::read_to_string(root.join("tsconfig.json"))?;
        let tsconfig: serde_json::Value =
            serde_json::from_str(&strip_json_comments(&text)).context("Invalid tsconfig.json")?;
        let base = tsconfig
            .pointer("/compilerOptions/baseUrl")
            .and_then(|v| v.as_str())
            .unwrap_or(".");
        if let Some(paths) = tsconfig
            .pointer("/compilerOptions/paths")
            .and_then(|v| v.as_object())
        {
            for (prefix, targets) in paths {
                if let Some(targets) = targets.as_array() {
                    for target in targets.iter().filter_map(|v| v.as_str()) {
                        aliases.push((
                            prefix.trim_end_matches('*').into(),
                            parser::normalize(&Path::new(base).join(target.trim_end_matches('*'))),
                        ));
                    }
                }
            }
        }
    }
    aliases.sort();
    Ok(aliases)
}

fn strip_json_comments(text: &str) -> String {
    let mut output = String::new();
    let mut chars = text.chars().peekable();
    let mut quoted = false;
    while let Some(c) = chars.next() {
        if quoted {
            output.push(c);
            if c == '\\' {
                if let Some(next) = chars.next() {
                    output.push(next);
                }
            } else if c == '"' {
                quoted = false;
            }
        } else if c == '"' {
            quoted = true;
            output.push(c);
        } else if c == '/' && chars.peek() == Some(&'/') {
            chars.next();
            for next in chars.by_ref() {
                if next == '\n' {
                    output.push('\n');
                    break;
                }
            }
        } else if c == '/' && chars.peek() == Some(&'*') {
            chars.next();
            while let Some(next) = chars.next() {
                if next == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    break;
                }
            }
        } else if c == ',' {
            let next = chars.clone().find(|c| !c.is_whitespace());
            if !matches!(next, Some('}' | ']')) {
                output.push(c);
            }
        } else {
            output.push(c);
        }
    }
    remove_trailing_commas(&output)
}

fn remove_trailing_commas(text: &str) -> String {
    let mut output = String::new();
    let mut chars = text.chars().peekable();
    let mut quoted = false;
    while let Some(c) = chars.next() {
        if quoted {
            output.push(c);
            if c == '\\' {
                if let Some(next) = chars.next() {
                    output.push(next);
                }
            } else if c == '"' {
                quoted = false;
            }
        } else if c == '"' {
            quoted = true;
            output.push(c);
        } else if c != ',' || !matches!(chars.clone().find(|c| !c.is_whitespace()), Some('}' | ']'))
        {
            output.push(c);
        }
    }
    output
}
