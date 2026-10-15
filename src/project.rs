use crate::parser::{self, RawImport};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ProjectMap {
    scopes: Vec<Scope>,
    packages: Vec<Package>,
    composers: Vec<Scope>,
    #[serde(skip)]
    file_names: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Scope {
    directory: String,
    rules: Vec<Rule>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Rule {
    pattern: String,
    targets: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Package {
    name: String,
    directory: String,
    exports: Option<Value>,
    entries: Vec<String>,
    rust: bool,
}

#[derive(Default)]
struct TsOptions {
    base: Option<String>,
    paths: Option<(String, Vec<Rule>)>,
}

fn inside(directory: &str, source: &str) -> bool {
    directory.is_empty()
        || source
            .strip_prefix(directory)
            .is_some_and(|rest| rest.starts_with('/'))
}

fn join(directory: &str, target: &str) -> String {
    parser::normalize(&Path::new(directory).join(target))
}

fn capture<'a>(pattern: &str, value: &'a str) -> Option<&'a str> {
    if let Some((prefix, suffix)) = pattern.split_once('*') {
        value.strip_prefix(prefix)?.strip_suffix(suffix)
    } else if pattern == value {
        Some("")
    } else {
        None
    }
}

fn json(root: &Path, path: &Path) -> Result<Value> {
    let canonical = path
        .canonicalize()
        .with_context(|| format!("Cannot read project configuration {}", path.display()))?;
    if !canonical.starts_with(root) {
        bail!(
            "Project configuration is outside the root: {}",
            path.display()
        );
    }
    if fs::metadata(&canonical)?.len() > 2 * 1024 * 1024 {
        bail!("Project configuration exceeds 2 MiB");
    }
    let text = fs::read_to_string(canonical)?;
    serde_json::from_str(&crate::indexer::strip_json_comments(&text))
        .with_context(|| format!("Invalid configuration {}", path.display()))
}

fn config_path(root: &Path, from: &Path, reference: &str) -> Result<PathBuf> {
    let candidates = if reference.starts_with('.') || Path::new(reference).is_absolute() {
        vec![from.join(reference)]
    } else {
        let mut candidates = vec![];
        let mut directory = Some(from);
        while let Some(dir) = directory {
            if !dir.starts_with(root) {
                break;
            }
            candidates.push(dir.join("node_modules").join(reference));
            directory = dir.parent();
        }
        candidates
    };
    for candidate in candidates {
        let mut appended = candidate.as_os_str().to_os_string();
        appended.push(".json");
        for path in [
            candidate.clone(),
            PathBuf::from(appended),
            candidate.join("tsconfig.json"),
        ] {
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    bail!(
        "Cannot resolve tsconfig extension {reference} from {}",
        from.display()
    )
}

fn tsconfig(root: &Path, path: &Path, stack: &mut BTreeSet<PathBuf>) -> Result<TsOptions> {
    let path = path.canonicalize()?;
    if stack.len() >= 32 || !stack.insert(path.clone()) {
        bail!(
            "Cyclic or overly deep tsconfig inheritance: {}",
            path.display()
        );
    }
    let value = json(root, &path)?;
    let parent = path.parent().context("Configuration has no parent")?;
    let directory = parser::normalize(parent.strip_prefix(root)?);
    let mut options = TsOptions::default();
    let extensions: Vec<_> = match &value["extends"] {
        Value::String(value) => vec![value.as_str()],
        Value::Array(values) => values.iter().filter_map(Value::as_str).collect(),
        _ => vec![],
    };
    for extension in extensions {
        let inherited = tsconfig(root, &config_path(root, parent, extension)?, stack)?;
        if inherited.base.is_some() {
            options.base = inherited.base;
        }
        if inherited.paths.is_some() {
            options.paths = inherited.paths;
        }
    }
    if let Some(base) = value
        .pointer("/compilerOptions/baseUrl")
        .and_then(Value::as_str)
    {
        options.base = Some(join(&directory, base));
    }
    if let Some(paths) = value
        .pointer("/compilerOptions/paths")
        .and_then(Value::as_object)
    {
        let rules = paths
            .iter()
            .map(|(pattern, values)| Rule {
                pattern: pattern.clone(),
                targets: values
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect(),
            })
            .collect();
        options.paths = Some((directory, rules));
    }
    stack.remove(&path);
    Ok(options)
}

fn export_targets(value: &Value) -> Vec<String> {
    match value {
        Value::String(value) => vec![value.clone()],
        Value::Array(values) => values.iter().flat_map(export_targets).collect(),
        Value::Object(values) => ["source", "types", "import", "node", "default", "require"]
            .iter()
            .filter_map(|key| values.get(*key))
            .flat_map(export_targets)
            .collect(),
        _ => vec![],
    }
}

impl ProjectMap {
    pub fn prepare_files(&mut self, files: &HashSet<String>) {
        self.file_names.clear();
        for path in files {
            if let Some(name) = path.rsplit('/').next() {
                self.file_names
                    .entry(name.into())
                    .or_default()
                    .push(path.clone());
            }
        }
        for paths in self.file_names.values_mut() {
            paths.sort();
        }
    }
    pub fn load(root: &Path, paths: impl Iterator<Item = impl AsRef<str>>) -> Result<Self> {
        let root = root.canonicalize()?;
        let paths: BTreeSet<String> = paths.map(|p| p.as_ref().to_owned()).collect();
        let mut result = Self::default();
        let mut configs: BTreeSet<PathBuf> = paths
            .iter()
            .filter(|p| p.rsplit('/').next() == Some("tsconfig.json"))
            .map(|p| root.join(p))
            .collect();
        if root.join("tsconfig.json").is_file() {
            configs.insert(root.join("tsconfig.json"));
        }
        let mut processed = BTreeSet::new();
        while let Some(path) = configs.pop_first() {
            let canonical = path.canonicalize()?;
            if !processed.insert(canonical.clone()) {
                continue;
            }
            let options = tsconfig(&root, &canonical, &mut BTreeSet::new())?;
            let directory = parser::normalize(canonical.parent().unwrap().strip_prefix(&root)?);
            let mut rules = vec![];
            if let Some((origin, paths)) = options.paths {
                for rule in paths {
                    rules.push(Rule {
                        pattern: rule.pattern,
                        targets: rule
                            .targets
                            .iter()
                            .map(|target| join(options.base.as_deref().unwrap_or(&origin), target))
                            .collect(),
                    });
                }
            }
            if let Some(base) = options.base {
                rules.push(Rule {
                    pattern: "*".into(),
                    targets: vec![format!("{base}/*")],
                });
            }
            result.scopes.push(Scope { directory, rules });
            let value = json(&root, &canonical)?;
            for reference in value["references"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v["path"].as_str())
            {
                let target = canonical.parent().unwrap().join(reference);
                let target = if target.is_dir() {
                    target.join("tsconfig.json")
                } else {
                    target
                };
                configs.insert(target);
            }
        }
        for path in paths.iter().filter(|p| {
            matches!(
                p.rsplit('/').next(),
                Some("package.json" | "composer.json" | "Cargo.toml")
            )
        }) {
            let full = root.join(path);
            if !full.canonicalize()?.starts_with(&root) {
                bail!("Project configuration is outside the root: {path}");
            }
            let directory = parser::normalize(Path::new(path).parent().unwrap_or(Path::new("")));
            if path.ends_with("Cargo.toml") {
                if fs::metadata(&full)?.len() > 2 * 1024 * 1024 {
                    bail!("Project configuration exceeds 2 MiB");
                }
                let value: toml::Value = toml::from_str(&fs::read_to_string(&full)?)
                    .with_context(|| format!("Invalid {path}"))?;
                if let Some(name) = value
                    .get("package")
                    .and_then(|v| v.get("name"))
                    .and_then(toml::Value::as_str)
                {
                    let library = value.get("lib");
                    let name = library
                        .and_then(|v| v.get("name"))
                        .and_then(toml::Value::as_str)
                        .unwrap_or(name)
                        .replace('-', "_");
                    let default_entry = if root.join(&directory).join("src/lib.rs").is_file() {
                        "src/lib.rs"
                    } else {
                        "src/main.rs"
                    };
                    let entry = library
                        .and_then(|v| v.get("path"))
                        .and_then(toml::Value::as_str)
                        .unwrap_or(default_entry);
                    result.packages.push(Package {
                        name,
                        directory,
                        exports: None,
                        entries: vec![entry.into()],
                        rust: true,
                    });
                }
                continue;
            }
            let value = json(&root, &full)?;
            if path.ends_with("composer.json") {
                let mut rules = vec![];
                for pointer in ["/autoload/psr-4", "/autoload-dev/psr-4"] {
                    for (prefix, targets) in value
                        .pointer(pointer)
                        .and_then(Value::as_object)
                        .into_iter()
                        .flatten()
                    {
                        let targets = if let Some(target) = targets.as_str() {
                            vec![target.to_owned()]
                        } else {
                            targets
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        };
                        rules.push(Rule {
                            pattern: format!("{prefix}*"),
                            targets: targets
                                .iter()
                                .map(|t| format!("{}/*", join(&directory, t)))
                                .collect(),
                        });
                    }
                }
                result.composers.push(Scope { directory, rules });
            } else if let Some(name) = value["name"].as_str() {
                let entries = ["source", "types", "typings", "module", "main"]
                    .iter()
                    .filter_map(|key| value[*key].as_str())
                    .map(str::to_owned)
                    .collect();
                result.packages.push(Package {
                    name: name.into(),
                    directory,
                    exports: value.get("exports").cloned(),
                    entries,
                    rust: false,
                });
            }
        }
        result.scopes.sort_by(|a, b| {
            b.directory
                .len()
                .cmp(&a.directory.len())
                .then(a.directory.cmp(&b.directory))
        });
        result.composers.sort_by(|a, b| {
            b.directory
                .len()
                .cmp(&a.directory.len())
                .then(a.directory.cmp(&b.directory))
        });
        result
            .packages
            .sort_by(|a, b| b.name.len().cmp(&a.name.len()).then(a.name.cmp(&b.name)));
        Ok(result)
    }

    fn target(source: &str, target: &str, files: &HashSet<String>) -> Vec<String> {
        parser::resolve_import(
            source,
            &RawImport {
                module: format!("./{target}"),
                kind: "js".into(),
            },
            files,
            &[],
        )
    }

    pub fn resolve(
        &self,
        source: &str,
        request: &RawImport,
        files: &HashSet<String>,
    ) -> Option<Vec<String>> {
        let resolve_target = |target: &str| Self::target("index.ts", target, files);
        if request.kind == "js" && !request.module.starts_with('.') {
            if let Some(scope) = self
                .scopes
                .iter()
                .find(|scope| inside(&scope.directory, source))
            {
                let mut rules: Vec<_> = scope
                    .rules
                    .iter()
                    .filter_map(|r| {
                        capture(&r.pattern, &request.module).map(|capture| (r, capture))
                    })
                    .collect();
                rules.sort_by_key(|(r, _)| {
                    std::cmp::Reverse(r.pattern.split('*').next().unwrap_or("").len())
                });
                if let Some((rule, capture)) = rules.first() {
                    for target in &rule.targets {
                        let result = resolve_target(&target.replace('*', capture));
                        if !result.is_empty() {
                            return Some(result);
                        }
                    }
                    if rule.pattern != "*" {
                        return Some(vec![]);
                    }
                }
            }
            if let Some(package) = self.packages.iter().find(|p| {
                !p.rust
                    && (p.name == request.module
                        || request.module.starts_with(&format!("{}/", p.name)))
            }) {
                let subpath = request.module.strip_prefix(&package.name).unwrap();
                let targets = if let Some(exports) = &package.exports {
                    if let Some(values) = exports
                        .as_object()
                        .filter(|v| v.keys().any(|k| k.starts_with('.')))
                    {
                        let key = format!(".{subpath}");
                        let mut matching: Vec<_> = values
                            .iter()
                            .filter_map(|(pattern, value)| {
                                capture(pattern, &key).map(|captured| (pattern, value, captured))
                            })
                            .collect();
                        matching.sort_by_key(|(p, _, _)| std::cmp::Reverse(p.len()));
                        matching
                            .first()
                            .map(|(_, v, c)| {
                                export_targets(v)
                                    .into_iter()
                                    .map(|s| s.replace('*', c))
                                    .collect()
                            })
                            .unwrap_or_default()
                    } else if subpath.is_empty() {
                        export_targets(exports)
                    } else {
                        vec![]
                    }
                } else if subpath.is_empty() {
                    let mut entries = package.entries.clone();
                    entries.push("index".into());
                    entries
                } else {
                    vec![subpath.trim_start_matches('/').into()]
                };
                for target in targets {
                    let result = resolve_target(&join(&package.directory, &target));
                    if !result.is_empty() {
                        return Some(result);
                    }
                }
                return Some(vec![]);
            }
        }
        if request.kind == "php" {
            for scope in self
                .composers
                .iter()
                .filter(|s| inside(&s.directory, source))
            {
                for rule in &scope.rules {
                    if let Some(captured) = capture(&rule.pattern, &request.module) {
                        for target in &rule.targets {
                            let result =
                                resolve_target(&target.replace('*', &captured.replace('\\', "/")));
                            if !result.is_empty() {
                                return Some(result);
                            }
                        }
                    }
                }
            }
        }
        if request.kind == "rust" {
            let mut segments = request.module.split("::");
            let name = segments.next().unwrap_or("");
            let package = if name == "crate" {
                self.packages
                    .iter()
                    .filter(|p| p.rust && inside(&p.directory, source))
                    .max_by_key(|p| p.directory.len())
            } else {
                self.packages.iter().find(|p| p.rust && p.name == name)
            };
            if let Some(package) = package {
                let mut module = join(
                    &package.directory,
                    Path::new(&package.entries[0])
                        .parent()
                        .unwrap_or(Path::new("src"))
                        .to_str()
                        .unwrap_or("src"),
                );
                let mut bases = vec![join(&package.directory, &package.entries[0])];
                for segment in segments {
                    module = join(&module, segment);
                    bases.push(module.clone());
                }
                for target in bases.iter().rev() {
                    let result = parser::resolve_import(
                        source,
                        &RawImport {
                            module: target.clone(),
                            kind: "project_path".into(),
                        },
                        files,
                        &[],
                    );
                    if !result.is_empty() {
                        return Some(result);
                    }
                }
            }
        }
        if matches!(request.kind.as_str(), "view" | "blueprint" | "class") {
            let scope = self
                .composers
                .iter()
                .find(|s| inside(&s.directory, source))
                .map(|s| s.directory.as_str())
                .unwrap_or("");
            if request.kind == "class" {
                let name = request
                    .module
                    .rsplit('\\')
                    .next()
                    .unwrap_or(&request.module);
                return Some(
                    self.file_names
                        .get(&format!("{name}.php"))
                        .into_iter()
                        .flatten()
                        .filter(|p| inside(scope, p) && p.ends_with(&format!("/{name}.php")))
                        .cloned()
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect(),
                );
            }
            let name = request.module.replace('.', "/");
            let mut targets = vec![];
            if request.kind == "view" {
                for extension in ["blade.php", "antlers.html", "antlers.php", "html"] {
                    let target = join(scope, &format!("resources/views/{name}.{extension}"));
                    if files.contains(&target) {
                        targets.push(target);
                    }
                }
            } else {
                let basename = format!("{}.yaml", name.rsplit('/').next().unwrap_or(&name));
                targets.extend(
                    self.file_names
                        .get(&basename)
                        .into_iter()
                        .flatten()
                        .filter(|p| {
                            inside(scope, p)
                                && p.starts_with(&join(scope, "resources/blueprints/"))
                                && p.ends_with(&format!("/{name}.yaml"))
                        })
                        .cloned(),
                );
            }
            targets.sort();
            targets.dedup();
            return Some(targets);
        }
        None
    }
}
