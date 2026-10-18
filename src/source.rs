use anyhow::{Context, Result, bail};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::{fs, path::Path};

pub(crate) fn dependency_directory(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | "vendor"
            | "target"
            | "dist"
            | "build"
            | "out"
            | ".next"
            | ".venv"
            | "venv"
            | "__pycache__"
            | "coverage"
            | ".cache"
    )
}

fn dependency_path(path: &Path) -> bool {
    path.components()
        .any(|part| part.as_os_str().to_str().is_some_and(dependency_directory))
}

fn read_rules(root: &Path, name: &str) -> Result<Option<String>> {
    let path = root.join(name);
    if !path.exists() {
        return Ok(None);
    }
    let canonical = path.canonicalize()?;
    if !canonical.starts_with(root.canonicalize()?) {
        bail!("Source exclusion file is outside the project: {name}");
    }
    if fs::metadata(&canonical)?.len() > 2 * 1024 * 1024 {
        bail!("Source exclusion file exceeds 2 MiB: {name}");
    }
    fs::read_to_string(canonical)
        .map(Some)
        .with_context(|| format!("Cannot read {name}"))
}

/// Only repository rules explicitly naming a dependency directory can opt it in.
/// Other Git exclusions do not replace Context's independent source exclusions.
pub(crate) fn repository_exceptions(root: &Path) -> Result<Vec<String>> {
    let mut rules = vec![];
    for line in read_rules(root, ".gitignore")?.unwrap_or_default().lines() {
        let pattern = line.trim();
        if pattern.starts_with('#')
            || !pattern
                .trim_start_matches('!')
                .split('/')
                .any(dependency_directory)
        {
            continue;
        }
        // Malformed optional Git patterns must not make an otherwise valid project fail.
        if GitignoreBuilder::new(root).add_line(None, line).is_ok() {
            rules.push(line.to_owned());
        }
    }
    if !rules.iter().any(|line| line.starts_with('!')) {
        rules.clear();
    }
    Ok(rules)
}

pub(crate) struct SourcePolicy {
    custom: bool,
    rules: Gitignore,
}

impl SourcePolicy {
    pub(crate) fn new(root: &Path) -> Result<Self> {
        let context = read_rules(root, ".ctxignore")?;
        let custom = context.is_some();
        let mut rules = GitignoreBuilder::new(root);
        if let Some(text) = context {
            for line in text.lines() {
                rules.add_line(None, line)?;
            }
        } else {
            for name in [
                "node_modules",
                "vendor",
                "target",
                "dist",
                "build",
                "out",
                ".next",
                ".venv",
                "venv",
                "__pycache__",
                "coverage",
                ".cache",
            ] {
                rules.add_line(None, &format!("{name}/"))?;
            }
            for line in repository_exceptions(root)? {
                rules.add_line(None, &line)?;
            }
        }
        Ok(Self {
            custom,
            rules: rules.build()?,
        })
    }

    pub(crate) fn first_party(&self, path: &Path, directory: bool) -> bool {
        self.rules
            .matched_path_or_any_parents(path, directory)
            .is_whitelist()
    }

    pub(crate) fn allow(&self, path: &Path, directory: bool) -> bool {
        if path
            .components()
            .any(|part| matches!(part.as_os_str().to_str(), Some(".git" | ".context")))
        {
            return false;
        }
        self.custom || !dependency_path(path) || self.first_party(path, directory)
    }

    pub(crate) fn framework_manifest(&self, path: &Path) -> bool {
        !dependency_path(path) || self.first_party(path, false)
    }
}
