use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand};
use context::{
    config::{self, Domain, DomainsConfig},
    database::Database,
    discovery, indexer,
    model::PackOptions,
    pack, resolver,
};
use rustyline::{
    Editor, Helper,
    completion::{Completer, Pair},
    highlight::Highlighter,
    hint::Hinter,
    validate::Validator,
};
use std::{
    collections::BTreeSet,
    io::IsTerminal,
    path::{Path, PathBuf},
};

#[derive(Parser)]
#[command(
    name = "context",
    version,
    about = "Deterministic, explainable context packs for coding tasks"
)]
struct Cli {
    #[arg(short = 'C', long, global = true, default_value = ".")]
    root: PathBuf,
    #[arg(short, long, global = true, env = "CONTEXT_VERBOSE")]
    verbose: bool,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize Context configuration and ignore patterns.
    Init {
        #[arg(short, long)]
        force: bool,
    },
    /// Update the code index. Unchanged files are skipped.
    Index {
        /// Hash all files, including those whose size and modification time are unchanged.
        #[arg(long)]
        verify: bool,
        #[arg(long)]
        json: bool,
    },
    /// Select relevant files and create a context pack.
    Pack(PackArgs),
    /// List saved context packs.
    #[command(alias = "ls")]
    List {
        #[arg(short='n',long,default_value="20",value_parser=positive)]
        limit: usize,
        #[arg(long)]
        json: bool,
    },
    /// Open a saved pack in the default application.
    Open {
        pack: Option<String>,
        #[arg(short, long)]
        file: Option<PathBuf>,
    },
    /// Manage task domains.
    Domains {
        #[command(subcommand)]
        command: DomainCommands,
    },
}

#[derive(Args)]
struct PackArgs {
    /// Task description in English or Italian.
    #[arg(short, long)]
    task: Option<String>,
    /// Read an error log and extract stacktrace locations.
    #[arg(short, long)]
    error: Option<String>,
    /// Keep recent log entries, for example 30m or 1h.
    #[arg(long, requires = "error")]
    since: Option<String>,
    /// Use tracked changes relative to a Git reference.
    #[arg(short, long)]
    diff: Option<String>,
    /// Prioritize an exact file path or filename.
    #[arg(short, long)]
    file: Option<String>,
    /// Prioritize a class, function or method.
    #[arg(short, long)]
    symbol: Option<String>,
    /// Maximum selected files, including explicit hints.
    #[arg(long,env="CONTEXT_MAX_FILES",value_parser=positive)]
    max_files: Option<usize>,
    /// Approximate token budget for the complete prompt.
    #[arg(long,value_parser=positive)]
    budget_tokens: Option<usize>,
    /// Permitted optional categories: tests,config,docs.
    #[arg(long, value_delimiter = ',')]
    include: Vec<String>,
    /// Exclude candidates using comma-separated Git-style patterns.
    #[arg(long, value_delimiter = ',')]
    exclude: Vec<String>,
    /// Boost known task domains, for example payments or auth.
    #[arg(long, value_delimiter = ',')]
    focus: Vec<String>,
    #[arg(long)]
    verify: bool,
    /// Print the generated manifest as JSON.
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand)]
enum DomainCommands {
    List {
        #[arg(short, long)]
        all: bool,
        #[arg(long)]
        json: bool,
    },
    Add {
        name: String,
        #[arg(short, long, value_delimiter = ',', required = true)]
        keywords: Vec<String>,
        #[arg(short, long, default_value = "")]
        description: String,
    },
    Remove {
        name: String,
    },
    Enable {
        name: String,
    },
}

fn positive(text: &str) -> std::result::Result<usize, String> {
    let value: usize = text
        .parse()
        .map_err(|_| "Expected a positive integer".to_owned())?;
    if value == 0 || value > 1_000_000 {
        return Err("Value must be between 1 and 1000000".into());
    }
    Ok(value)
}

fn main() {
    if let Err(error) = execute(Cli::parse()) {
        eprintln!("Error: {error:#}");
        std::process::exit(1);
    }
}

fn execute(cli: Cli) -> Result<()> {
    let root = cli
        .root
        .canonicalize()
        .context("Repository directory does not exist")?;
    if !root.is_dir() {
        bail!("--root must be a directory");
    }
    match cli.command {
        Commands::Init { force } => {
            config::initialize(&root, force)?;
            println!("Context initialized. Run context index or context pack --task \"...\".");
        }
        Commands::Index { verify, json } => {
            config::initialize(&root, false)?;
            let config = config::load(&root)?;
            let mut database = Database::open(&root)?;
            let stats = indexer::index(&root, &mut database, &config, verify)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&stats)?);
            } else {
                println!(
                    "Files indexed: {}\nSymbols found: {}\nImport relations: {}\nUpdated: {}, removed: {}\nDuration: {:.3}s",
                    stats.files,
                    stats.symbols,
                    stats.imports,
                    stats.updated,
                    stats.removed,
                    stats.duration_ms as f64 / 1000.0
                );
            }
        }
        Commands::Pack(args) => {
            for category in &args.include {
                if !matches!(category.as_str(), "tests" | "config" | "docs") {
                    bail!("Unknown include category: {category}");
                }
            }
            config::initialize(&root, false)?;
            let config = config::load(&root)?;
            let mut database = Database::open(&root)?;
            let stats = indexer::index(&root, &mut database, &config, args.verify)?;
            if cli.verbose {
                eprintln!(
                    "Index: {} files, {} updated in {} ms",
                    stats.files, stats.updated, stats.duration_ms
                );
            }
            let mut options = PackOptions {
                task: args.task,
                error: args.error,
                since: args.since,
                diff: args.diff,
                file: args.file,
                symbol: args.symbol,
                max_files: args.max_files.unwrap_or(config.max_files),
                budget_tokens: args.budget_tokens.unwrap_or(config.budget_tokens),
                include: args.include,
                exclude: args.exclude,
                focus: args.focus,
            };
            if options.task.is_none()
                && options.error.is_none()
                && options.diff.is_none()
                && options.file.is_none()
                && options.symbol.is_none()
            {
                if !std::io::stdin().is_terminal() {
                    bail!("Provide --task, --error, --diff, --file or --symbol");
                }
                let Some(task) = prompt(&database)? else {
                    return Ok(());
                };
                options.task = Some(task);
            }
            let resolution = resolver::resolve(&root, &options)?;
            let candidates =
                discovery::discover(&root, &database, &resolution, &options, config.graph_depth)?;
            let result = pack::compose(
                &root,
                &database,
                &resolution,
                &candidates,
                &config,
                options.budget_tokens,
            )?;
            if args.json {
                println!("{}", serde_json::to_string_pretty(&result.manifest)?);
            } else {
                println!("Context pack created at: {}", result.directory.display());
                println!(
                    "Selected {} files, approximately {} tokens",
                    candidates.len(),
                    result.manifest.budget_tokens
                );
                for candidate in candidates.iter().take(5) {
                    println!("  {:.0}% {}", candidate.score * 100.0, candidate.path);
                }
            }
        }
        Commands::List { limit, json } => {
            let packs = pack::list(&root)?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &packs.iter().take(limit).map(|(_, m)| m).collect::<Vec<_>>()
                    )?
                );
            } else if packs.is_empty() {
                println!("No context packs found.");
            } else {
                for (_, manifest) in packs.iter().take(limit) {
                    println!(
                        "{}  {} files  {}",
                        manifest.slug,
                        manifest.files.len(),
                        manifest.task.raw.replace('\n', " ")
                    );
                }
            }
        }
        Commands::Open { pack: slug, file } => {
            let packs = pack::list(&root)?;
            let directory = if let Some(slug) = slug {
                if slug.contains(['/', '\\']) || slug == ".." {
                    bail!("Provide a pack slug or prefix");
                }
                if let Some((path, _)) = packs.iter().find(|(_, manifest)| manifest.slug == slug) {
                    path
                } else {
                    let matches: Vec<_> = packs
                        .iter()
                        .filter(|(_, m)| m.slug.starts_with(&slug))
                        .collect();
                    if matches.len() > 1 {
                        bail!("Pack prefix is ambiguous; use the full slug");
                    }
                    &matches.first().context("Pack not found")?.0
                }
            } else {
                &packs.first().context("No context packs found")?.0
            };
            let target = directory
                .join(file.unwrap_or_default())
                .canonicalize()
                .context("Pack file not found")?;
            if !target.starts_with(directory.canonicalize()?) {
                bail!("File must be inside the selected pack");
            }
            open::that_detached(&target).context("Cannot open pack")?;
            println!("Opened {}", target.display());
        }
        Commands::Domains { command } => domain_command(&root, command, cli.verbose)?,
    }
    Ok(())
}

fn domain_command(root: &Path, command: DomainCommands, verbose: bool) -> Result<()> {
    let path = root.join(".context/domains.json");
    let mut custom: DomainsConfig = config::read_json(&path)?;
    match command {
        DomainCommands::List { all, json } => {
            let domains = config::domains(root, all)?;
            if json {
                let values: Vec<_> = domains.iter().map(|(source,domain,enabled)|serde_json::json!({"source":source,"domain":domain,"enabled":enabled})).collect();
                println!("{}", serde_json::to_string_pretty(&values)?);
            } else {
                for (source, domain, enabled) in domains {
                    println!(
                        "{} [{}{}]: {}",
                        domain.name,
                        source,
                        if enabled { "" } else { ", disabled" },
                        domain.description
                    );
                    if verbose {
                        println!("  {}", domain.keywords.join(", "));
                    }
                }
            }
            return Ok(());
        }
        DomainCommands::Add {
            name,
            keywords,
            description,
        } => {
            if name.is_empty()
                || !name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_'))
            {
                bail!("Domain names use lowercase letters, numbers, hyphens or underscores");
            }
            let keywords: Vec<_> = keywords
                .iter()
                .map(|s| s.trim().to_lowercase())
                .filter(|s| !s.is_empty())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            if keywords.is_empty() {
                bail!("Provide at least one keyword");
            }
            custom.custom_domains.retain(|d| d.name != name);
            custom.disabled_domains.retain(|d| d != &name);
            custom.custom_domains.push(Domain {
                name,
                keywords,
                description,
            });
            custom.custom_domains.sort_by(|a, b| a.name.cmp(&b.name));
        }
        DomainCommands::Remove { name } => {
            if !config::domains(root, true)?
                .iter()
                .any(|(_, d, _)| d.name == name)
            {
                bail!("Unknown domain: {name}");
            }
            if custom.custom_domains.iter().any(|d| d.name == name) {
                custom.custom_domains.retain(|d| d.name != name);
            } else if !custom.disabled_domains.contains(&name) {
                custom.disabled_domains.push(name);
            }
        }
        DomainCommands::Enable { name } => {
            if !config::domains(root, true)?
                .iter()
                .any(|(_, d, _)| d.name == name)
            {
                bail!("Unknown domain: {name}");
            }
            custom.disabled_domains.retain(|d| d != &name);
        }
    }
    config::write_json(&path, &custom)?;
    println!("Domain configuration updated.");
    Ok(())
}

struct Completion {
    values: Vec<String>,
}
impl Helper for Completion {}
impl Validator for Completion {}
impl Highlighter for Completion {}
impl Hinter for Completion {
    type Hint = String;
}
impl Completer for Completion {
    type Candidate = Pair;
    fn complete(
        &self,
        line: &str,
        position: usize,
        _: &rustyline::Context<'_>,
    ) -> rustyline::Result<(usize, Vec<Pair>)> {
        let input = &line[..position];
        let start = input.rfind(char::is_whitespace).map(|p| p + 1).unwrap_or(0);
        let Some(prefix) = input[start..].strip_prefix('@') else {
            return Ok((position, vec![]));
        };
        let prefix = prefix.to_lowercase();
        let matches = self
            .values
            .iter()
            .filter(|value| {
                let acronym: String = value
                    .chars()
                    .filter(|c| c.is_uppercase())
                    .flat_map(char::to_lowercase)
                    .collect();
                value.to_lowercase().contains(&prefix)
                    || prefix.len() >= 3 && acronym.starts_with(&prefix)
            })
            .take(100)
            .map(|value| Pair {
                display: value.clone(),
                replacement: format!("@{value}"),
            })
            .collect();
        Ok((start, matches))
    }
}

fn prompt(database: &Database) -> Result<Option<String>> {
    let mut values: BTreeSet<_> = database.files()?.into_keys().collect();
    values.extend(database.symbols()?.into_iter().map(|s| s.name));
    let mut editor = Editor::<Completion, rustyline::history::DefaultHistory>::new()?;
    editor.set_helper(Some(Completion {
        values: values.into_iter().collect(),
    }));
    match editor.readline("Enter task (use @ and Tab for autocomplete): ") {
        Ok(task) if !task.trim().is_empty() => Ok(Some(task)),
        Ok(_)
        | Err(
            rustyline::error::ReadlineError::Interrupted | rustyline::error::ReadlineError::Eof,
        ) => Ok(None),
        Err(error) => Err(error.into()),
    }
}
