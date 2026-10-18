use std::collections::{BTreeMap, BTreeSet, HashSet};

/// Derived once per import-graph rebuild. Qualified suffixes retain arbitrary source roots.
#[derive(Default)]
pub(crate) struct ImportIndex {
    classes: BTreeMap<String, Vec<String>>,
    packages: BTreeMap<String, Vec<String>>,
}

fn suffix(path: &str, target: &str) -> bool {
    path == target
        || path
            .strip_suffix(target)
            .is_some_and(|prefix| prefix.ends_with('/'))
}

impl ImportIndex {
    pub(crate) fn new(files: &HashSet<String>) -> Self {
        let mut result = Self::default();
        for path in files.iter().filter(|path| path.ends_with(".java")) {
            let (directory, name) = path.rsplit_once('/').unwrap_or(("", path));
            result
                .classes
                .entry(name.to_owned())
                .or_default()
                .push(path.clone());
            result
                .packages
                .entry(directory.rsplit('/').next().unwrap_or("").to_owned())
                .or_default()
                .push(path.clone());
        }
        for paths in result
            .classes
            .values_mut()
            .chain(result.packages.values_mut())
        {
            paths.sort();
        }
        result
    }

    pub(crate) fn resolve(&self, module: &str) -> Vec<String> {
        let mut input = module.trim().trim_end_matches(';');
        if let Some(rest) = input
            .strip_prefix("import")
            .filter(|rest| rest.starts_with(char::is_whitespace))
        {
            input = rest.trim_start();
        }
        let static_import = input
            .strip_prefix("static")
            .filter(|rest| rest.starts_with(char::is_whitespace));
        let input = static_import.unwrap_or(input).trim();
        let mut name: String = input.chars().filter(|c| !c.is_whitespace()).collect();
        let wildcard = name.ends_with(".*");
        if wildcard {
            name.truncate(name.len() - 2);
        }
        if wildcard && static_import.is_none() {
            let package = name.replace('.', "/");
            let leaf = package.rsplit('/').next().unwrap_or("");
            return self
                .packages
                .get(leaf)
                .into_iter()
                .flatten()
                .filter(|path| {
                    path.rsplit_once('/')
                        .is_some_and(|(directory, _)| suffix(directory, &package))
                })
                .cloned()
                .collect();
        }
        loop {
            let class = name.rsplit('.').next().unwrap_or("");
            let target = format!("{}.java", name.replace('.', "/"));
            let result: BTreeSet<_> = self
                .classes
                .get(&format!("{class}.java"))
                .into_iter()
                .flatten()
                .filter(|path| suffix(path, &target))
                .cloned()
                .collect();
            if !result.is_empty() {
                return result.into_iter().collect();
            }
            // Static members and nested classes live in the enclosing class source.
            let Some((outer, _)) = name.rsplit_once('.') else {
                return vec![];
            };
            name = outer.to_owned();
        }
    }
}
