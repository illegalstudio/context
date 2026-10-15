use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::Path};

pub const DEFAULT_IGNORE: &str = "# Context exclusions\n.git/\n.context/\nnode_modules/\nvendor/\ntarget/\n.venv/\nvenv/\n__pycache__/\n*.pyc\ndist/\nbuild/\nout/\n.next/\ncoverage/\n.cache/\n*.log\n*.min.js\n*.min.css\n*.map\n.env\n.env.*\n!.env.example\n*.pem\n*.key\n";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub version: String,
    pub include_languages: Vec<String>,
    pub max_file_size: u64,
    pub max_files: usize,
    pub max_lines_per_file: usize,
    pub budget_tokens: usize,
    pub graph_depth: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: "0.3.0".into(),
            include_languages: vec![],
            max_file_size: 1_048_576,
            max_files: 25,
            max_lines_per_file: 300,
            budget_tokens: 32_000,
            graph_depth: 2,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Domain {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub keywords: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DomainsConfig {
    pub custom_domains: Vec<Domain>,
    pub disabled_domains: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Framework {
    ignore_patterns: String,
    domains: Vec<Domain>,
}

pub fn read_json<T: serde::de::DeserializeOwned + Default>(path: &Path) -> Result<T> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .with_context(|| format!("Invalid JSON in {}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e).with_context(|| format!("Cannot read {}", path.display())),
    }
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    fs::write(path, bytes).with_context(|| format!("Cannot write {}", path.display()))
}

pub fn load(root: &Path) -> Result<Config> {
    let config: Config = read_json(&root.join(".context/config.json"))?;
    if config.max_file_size == 0
        || config.max_files == 0
        || config.max_lines_per_file == 0
        || config.budget_tokens == 0
        || config.graph_depth > 8
    {
        bail!("Configuration limits must be positive and graphDepth must be at most 8");
    }
    Ok(config)
}

pub fn detect_frameworks(root: &Path) -> Result<Vec<String>> {
    let mut names = vec!["generic".into()];
    if root.join("package.json").is_file() {
        names.push("nodejs".into());
    }
    let composer: serde_json::Value = read_json(&root.join("composer.json"))?;
    let requires = &composer["require"];
    if requires.get("laravel/framework").is_some() || requires.get("statamic/cms").is_some() {
        names.push("laravel".into());
    }
    if requires.get("statamic/cms").is_some() {
        names.push("statamic".into());
    }
    Ok(names)
}

pub fn domains(root: &Path, include_disabled: bool) -> Result<Vec<(String, Domain, bool)>> {
    let definitions: Vec<Domain> = serde_json::from_str(include_str!("../resources/domains.json"))?;
    let frameworks: BTreeMap<String, Framework> =
        serde_json::from_str(include_str!("../resources/frameworks.json"))?;
    let custom: DomainsConfig = read_json(&root.join(".context/domains.json"))?;
    let mut result: BTreeMap<String, (String, Domain, bool)> = BTreeMap::new();
    for domain in definitions {
        result.insert(domain.name.clone(), ("core".into(), domain, true));
    }
    for name in detect_frameworks(root)? {
        if let Some(framework) = frameworks.get(&name) {
            for domain in &framework.domains {
                result.insert(domain.name.clone(), (name.clone(), domain.clone(), true));
            }
        }
    }
    for domain in custom.custom_domains {
        result.insert(domain.name.clone(), ("custom".into(), domain, true));
    }
    for name in custom.disabled_domains {
        if let Some(value) = result.get_mut(&name) {
            value.2 = false;
        }
    }
    Ok(result
        .into_values()
        .filter(|d| include_disabled || d.2)
        .collect())
}

pub fn initialize(root: &Path, force: bool) -> Result<()> {
    let config_path = root.join(".context/config.json");
    if force || !config_path.exists() {
        write_json(&config_path, &Config::default())?;
    }
    let names = detect_frameworks(root)?;
    write_json(
        &root.join(".context/project.json"),
        &serde_json::json!({"detectedAt": chrono::Utc::now(), "activeDiscoveries": names}),
    )?;
    let ignore_path = root.join(".ctxignore");
    if force || !ignore_path.exists() {
        let frameworks: BTreeMap<String, Framework> =
            serde_json::from_str(include_str!("../resources/frameworks.json"))?;
        let mut patterns = DEFAULT_IGNORE.to_owned();
        for name in names {
            if let Some(f) = frameworks.get(&name) {
                patterns.push('\n');
                patterns.push_str(&f.ignore_patterns);
                patterns.push('\n');
            }
        }
        fs::write(ignore_path, patterns)?;
    }
    let gitignore = root.join(".gitignore");
    if gitignore.exists() {
        let mut text = fs::read_to_string(&gitignore)?;
        if !text
            .lines()
            .any(|l| matches!(l.trim(), ".context" | ".context/" | "/.context/"))
        {
            text.push_str("\n# Context data\n.context/\n");
            fs::write(gitignore, text)?;
        }
    }
    Ok(())
}
