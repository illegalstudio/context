use anyhow::{Context, Result, bail};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct FrameworkScope {
    pub path: String,
    pub frameworks: Vec<String>,
}

fn dependency_path(path: &str) -> bool {
    path.split('/').any(|part| {
        matches!(
            part,
            "node_modules"
                | "vendor"
                | "target"
                | ".git"
                | ".context"
                | "dist"
                | "build"
                | "out"
                | ".next"
                | ".venv"
                | "venv"
                | "coverage"
                | ".cache"
        )
    })
}

pub fn from_paths<'a>(
    root: &Path,
    paths: impl IntoIterator<Item = &'a String>,
) -> Result<Vec<FrameworkScope>> {
    let mut scopes: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let canonical_root = root.canonicalize()?;
    for path in paths {
        if dependency_path(path) {
            continue;
        }
        let file = Path::new(path);
        let directory = crate::parser::normalize(file.parent().unwrap_or(Path::new("")));
        if matches!(
            file.file_name().and_then(|name| name.to_str()),
            Some("package.json" | "Cargo.toml" | "composer.json")
        ) {
            let source = root.join(path).canonicalize()?;
            if !source.starts_with(&canonical_root) {
                bail!("Framework manifest is outside the project: {path}");
            }
        }
        match file.file_name().and_then(|name| name.to_str()) {
            Some("package.json") => {
                scopes.entry(directory).or_default().insert("nodejs".into());
            }
            Some("Cargo.toml") => {
                scopes.entry(directory).or_default();
            }
            Some("composer.json") => {
                let source = root.join(path).canonicalize()?;
                if !source.starts_with(&canonical_root) {
                    bail!("Framework manifest is outside the project: {path}");
                }
                if fs::metadata(&source)?.len() > 2 * 1024 * 1024 {
                    bail!("Framework manifest exceeds 2 MiB: {path}");
                }
                let value: serde_json::Value = crate::config::read_json(&source)?;
                let names = scopes.entry(directory).or_default();
                for section in ["require", "require-dev"] {
                    if value[section].get("laravel/framework").is_some()
                        || value[section].get("statamic/cms").is_some()
                    {
                        names.insert("laravel".into());
                    }
                    if value[section].get("statamic/cms").is_some() {
                        names.insert("statamic".into());
                    }
                }
            }
            _ => {}
        }
    }
    Ok(scopes
        .into_iter()
        .map(|(path, frameworks)| FrameworkScope {
            path,
            frameworks: frameworks.into_iter().collect(),
        })
        .collect())
}

pub fn detect(root: &Path) -> Result<Vec<FrameworkScope>> {
    let mut walker = WalkBuilder::new(root);
    walker
        .standard_filters(false)
        .follow_links(false)
        .add_custom_ignore_filename(".ctxignore")
        .filter_entry(|entry| {
            entry.depth() == 0
                || !matches!(
                    entry.file_name().to_str(),
                    Some(
                        ".git"
                            | ".context"
                            | "node_modules"
                            | "vendor"
                            | "target"
                            | "dist"
                            | "build"
                            | "out"
                            | ".next"
                            | ".venv"
                            | "venv"
                            | "coverage"
                            | ".cache"
                    )
                )
        });
    let mut paths = BTreeSet::new();
    for entry in walker.build() {
        let entry = entry.context("Cannot scan framework manifests")?;
        if entry.file_type().is_some_and(|kind| kind.is_file())
            && matches!(
                entry.file_name().to_str(),
                Some("package.json" | "composer.json" | "Cargo.toml")
            )
        {
            paths.insert(crate::parser::normalize(entry.path().strip_prefix(root)?));
        }
    }
    from_paths(root, paths.iter())
}

pub fn names(scopes: &[FrameworkScope]) -> Vec<String> {
    ["generic", "nodejs", "laravel", "statamic"]
        .into_iter()
        .filter(|name| {
            *name == "generic"
                || scopes
                    .iter()
                    .any(|scope| scope.frameworks.iter().any(|value| value == name))
        })
        .map(str::to_owned)
        .collect()
}

pub fn scope_for<'a>(scopes: &'a [FrameworkScope], path: &str) -> Option<&'a FrameworkScope> {
    scopes
        .iter()
        .filter(|scope| {
            scope.path.is_empty()
                || path
                    .strip_prefix(&scope.path)
                    .is_some_and(|rest| rest.starts_with('/'))
        })
        .max_by_key(|scope| scope.path.len())
}

pub fn scoped_pattern(scope: &str, pattern: &str) -> String {
    let (negation, pattern) = pattern
        .strip_prefix('!')
        .map_or(("", pattern), |p| ("!", p));
    let pattern = pattern.trim_start_matches('/');
    let prefix = if scope.is_empty() {
        "/".to_owned()
    } else {
        format!("/{scope}/")
    };
    if !pattern.trim_end_matches('/').contains('/') {
        format!("{negation}{prefix}**/{pattern}")
    } else {
        format!("{negation}{prefix}{pattern}")
    }
}
