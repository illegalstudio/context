use context::{
    config::{self, Config},
    database::Database,
    discovery, indexer,
    model::PackOptions,
    pack, parser, resolver,
};
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;

fn project(files: &[(&str, &str)]) -> TempDir {
    let directory = tempfile::Builder::new()
        .prefix("context-test-")
        .tempdir()
        .unwrap();
    for (path, content) in files {
        write(directory.path(), path, content);
    }
    directory
}

fn write(root: &Path, path: &str, content: &str) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn options(task: &str) -> PackOptions {
    PackOptions {
        task: Some(task.into()),
        max_files: 25,
        budget_tokens: 32_000,
        ..Default::default()
    }
}

fn copy(source: &Path, target: &Path) {
    fs::create_dir_all(target).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        if entry.file_name() == ".context" {
            continue;
        }
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target.join(entry.file_name()));
        } else {
            fs::copy(entry.path(), target.join(entry.file_name())).unwrap();
        }
    }
}

#[derive(Deserialize)]
struct Scenarios {
    codebase: String,
    scenarios: Vec<Scenario>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scenario {
    name: String,
    task: String,
    expected_files: Vec<String>,
    #[serde(default)]
    expected_in_top5: Vec<String>,
    #[serde(default)]
    forbidden_files: Vec<String>,
}

#[test]
fn existing_end_to_end_scenarios() {
    let cases: Vec<Scenarios> =
        serde_json::from_str(include_str!("fixtures/scenarios.json")).unwrap();
    let directory = project(&[]);
    let mut failures = vec![];
    for case in cases {
        let root = directory.path().join(&case.codebase);
        copy(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/codebases")
                .join(&case.codebase),
            &root,
        );
        let config = Config::default();
        let mut database = Database::open(&root).unwrap();
        let stats = indexer::index(&root, &mut database, &config, false).unwrap();
        assert!(stats.files > 0);
        for scenario in case.scenarios {
            let options = options(&scenario.task);
            let resolution = resolver::resolve(&root, &options).unwrap();
            let candidates =
                discovery::discover(&root, &database, &resolution, &options, 2).unwrap();
            let paths: Vec<_> = candidates.iter().map(|c| c.path.as_str()).collect();
            for expected in scenario.expected_files {
                if !paths.iter().any(|p| p.contains(&expected)) {
                    failures.push(format!(
                        "{} / {}: missing {expected}, got {paths:?}",
                        case.codebase, scenario.name
                    ));
                }
            }
            for expected in scenario.expected_in_top5 {
                if !paths.iter().take(5).any(|p| p.contains(&expected)) {
                    failures.push(format!(
                        "{} / {}: {expected} outside top 5, got {paths:?}",
                        case.codebase, scenario.name
                    ));
                }
            }
            for forbidden in scenario.forbidden_files {
                assert!(
                    !paths.iter().any(|p| p.contains(&forbidden)),
                    "{} / {} selected forbidden file {forbidden}",
                    case.codebase,
                    scenario.name
                );
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn structural_parsers_find_real_declarations_and_ignore_comments() {
    for (path, content, name) in [
        (
            "file.ts",
            "// class Phantom {}\nexport class Real { run() {} }",
            "Real",
        ),
        (
            "file.tsx",
            "export const Widget = () => <div>Hello</div>;",
            "Widget",
        ),
        (
            "file.js",
            "// function phantom() {}\nexport function real() { return 1; }",
            "real",
        ),
        (
            "file.php",
            "<?php // class Phantom {}\nclass Real { public function run() {} }",
            "Real",
        ),
        (
            "file.py",
            "# def phantom(): pass\nclass Real:\n    def run(self): pass",
            "Real",
        ),
        (
            "file.go",
            "package main\n// func phantom() {}\nfunc real() {}",
            "real",
        ),
        ("file.rs", "// fn phantom() {}\npub fn real() {}", "real"),
        (
            "file.rb",
            "# def phantom; end\nclass Real\n def run; end\nend",
            "Real",
        ),
        (
            "file.java",
            "// class Phantom {}\npublic class Real { public void run() {} }",
            "Real",
        ),
    ] {
        let result = parser::parse(path, content, &mut tree_sitter::Parser::new()).unwrap();
        assert!(
            result.symbols.iter().any(|s| s.name == name),
            "{path}: {:?}",
            result.symbols
        );
        assert!(
            !result
                .symbols
                .iter()
                .any(|s| s.name.eq_ignore_ascii_case("phantom"))
        );
        assert!(result.symbols.iter().all(|s| s.end_line >= s.start_line));
    }
}

#[test]
fn index_updates_deleted_renamed_and_new_import_targets() {
    let directory = project(&[
        (".ctxignore", "target/\n"),
        (
            "src/main.ts",
            "import { User } from './User.js';\nexport function run() { return new User(); }",
        ),
    ]);
    let root = directory.path();
    let mut db = Database::open(root).unwrap();
    let config = Config::default();
    assert_eq!(
        indexer::index(root, &mut db, &config, false)
            .unwrap()
            .updated,
        2
    );
    assert_eq!(
        indexer::index(root, &mut db, &config, false)
            .unwrap()
            .updated,
        0
    );
    assert!(db.imports().unwrap().is_empty());
    write(root, "src/User.ts", "export class User {}");
    indexer::index(root, &mut db, &config, false).unwrap();
    assert!(
        db.imports()
            .unwrap()
            .iter()
            .any(|r| r.target_path == "src/User.ts")
    );
    fs::rename(root.join("src/User.ts"), root.join("src/Customer.ts")).unwrap();
    let stats = indexer::index(root, &mut db, &config, false).unwrap();
    assert_eq!(stats.removed, 1);
    assert!(db.imports().unwrap().is_empty());
    assert!(
        !db.symbols()
            .unwrap()
            .iter()
            .any(|s| s.file_path == "src/User.ts")
    );
    assert!(
        !db.search(&["User".into()], 100)
            .unwrap()
            .iter()
            .any(|(p, _)| p == "src/User.ts")
    );
    assert_eq!(
        indexer::index(root, &mut db, &config, true).unwrap().files,
        3
    );
}

#[test]
fn ignore_negation_nested_rules_size_limits_and_binary_files() {
    let directory = project(&[
        (
            ".ctxignore",
            "vendor/*\n!vendor/important.ts\n*.generated.ts\n",
        ),
        ("vendor/skip.ts", "export class Skip {}"),
        ("vendor/important.ts", "export class Important {}"),
        ("src/.ctxignore", "ignored.ts\n"),
        ("src/ignored.ts", "export class Ignore {}"),
        ("src/real.ts", "export class Real {}"),
        ("src/code.generated.ts", "export class Generated {}"),
        (".context/internal.ts", "export class Internal {}"),
        (".git/internal.ts", "export class Internal {}"),
        ("huge.ts", &"x".repeat(3000)),
        ("binary.dat", "some\0binary"),
    ]);
    let root = directory.path();
    let mut db = Database::open(root).unwrap();
    indexer::index(
        root,
        &mut db,
        &Config {
            max_file_size: 2000,
            ..Default::default()
        },
        false,
    )
    .unwrap();
    let files = db.files().unwrap();
    assert!(files.contains_key("vendor/important.ts"));
    assert!(files.contains_key("src/real.ts"));
    for path in [
        "vendor/skip.ts",
        "src/ignored.ts",
        "src/code.generated.ts",
        ".context/internal.ts",
        ".git/internal.ts",
        "huge.ts",
        "binary.dat",
    ] {
        assert!(!files.contains_key(path), "{path}");
    }
}

#[test]
fn verification_detects_content_changes_with_preserved_metadata() {
    let directory = project(&[("file.ts", "export class Old {}")]);
    let root = directory.path();
    let mut db = Database::open(root).unwrap();
    let config = Config::default();
    indexer::index(root, &mut db, &config, false).unwrap();
    let path = root.join("file.ts");
    let time = fs::metadata(&path).unwrap().modified().unwrap();
    fs::write(&path, "export class New {}").unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(time))
        .unwrap();
    assert_eq!(
        indexer::index(root, &mut db, &config, false)
            .unwrap()
            .updated,
        0
    );
    indexer::index(root, &mut db, &config, true).unwrap();
    assert!(db.symbols().unwrap().iter().any(|s| s.name == "New"));
}

#[test]
fn aliases_python_relative_imports_and_circular_graphs() {
    let directory = project(&[
        (
            "tsconfig.json",
            "{ // comment\n \"compilerOptions\": {\"baseUrl\":\".\",\"paths\":{\"@app/*\":[\"src/*\"],}, // trailing comment\n},}",
        ),
        ("src/a.ts", "import { B } from '@app/b'; export class A {}"),
        ("src/b.ts", "import { A } from './a'; export class B {}"),
        ("app/routes/users.py", "from ..models.user import User\n"),
        ("app/models/user.py", "class User: pass"),
        (
            "composer.json",
            "{\"autoload\":{\"psr-4\":{\"Domain\\\\\":\"domain/\"}}}",
        ),
        ("domain/User.php", "<?php namespace Domain; class User {}"),
        ("src/lib.rs", "pub mod models; pub mod service;"),
        ("src/models.rs", "pub struct User {}"),
        (
            "src/service.rs",
            "pub use crate::{models::{User as Account}}; use super::models::User;",
        ),
        (
            "app/Service.php",
            "<?php use \\Domain\\{User as Account}; class Service {}",
        ),
    ]);
    let root = directory.path();
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    let imports = db.imports().unwrap();
    for (source, target) in [
        ("src/a.ts", "src/b.ts"),
        ("src/b.ts", "src/a.ts"),
        ("app/routes/users.py", "app/models/user.py"),
        ("app/Service.php", "domain/User.php"),
        ("src/service.rs", "src/models.rs"),
        ("src/lib.rs", "src/service.rs"),
    ] {
        assert!(
            imports
                .iter()
                .any(|r| r.source_path == source && r.target_path == target),
            "{source} -> {target}: {imports:?}"
        );
    }
    let options = options("Fix A");
    let resolution = resolver::resolve(root, &options).unwrap();
    let first = discovery::discover(root, &db, &resolution, &options, 4).unwrap();
    let second = discovery::discover(root, &db, &resolution, &options, 4).unwrap();
    assert_eq!(
        serde_json::to_string(&first).unwrap(),
        serde_json::to_string(&second).unwrap()
    );
}

#[test]
fn multilingual_tasks_domains_stacktraces_and_exclusions() {
    let directory = project(&[
        (
            "src/PaymentService.ts",
            "export class PaymentService { processPayment() {} }",
        ),
        (
            "tests/PaymentService.test.ts",
            "import { PaymentService } from '../src/PaymentService';",
        ),
        ("src/UserService.ts", "export class UserService {}"),
    ]);
    let root = directory.path();
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    let options = options("Correggi i pagamenti nel servizio");
    let resolution = resolver::resolve(root, &options).unwrap();
    assert!(
        resolution.task.domains.contains(&"payments".into()),
        "{:?}",
        resolution.task
    );
    let candidates = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
    assert_eq!(candidates[0].path, "src/PaymentService.ts");
    let mut options = options.clone();
    options.exclude = vec!["tests/".into()];
    options.max_files = 1;
    let candidates = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
    assert_eq!(candidates.len(), 1);
    assert!(!discovery::is_test(&candidates[0].path));
    for text in [
        include_str!("fixtures/stacktraces/nodejs.log"),
        include_str!("fixtures/stacktraces/php-laravel.log"),
        include_str!("fixtures/stacktraces/python.log"),
    ] {
        assert!(!resolver::parse_stacktrace(text).is_empty());
    }
    let json = serde_json::json!({"customDomains":[{"name":"billing","description":"Billing","keywords":["stripe"]}],"disabledDomains":["payments"]});
    config::write_json(&root.join(".context/domains.json"), &json).unwrap();
    let domains = config::domains(root, false).unwrap();
    assert!(domains.iter().any(|(_, d, _)| d.name == "billing"));
    assert!(!domains.iter().any(|(_, d, _)| d.name == "payments"));
}

#[test]
fn packs_have_valid_archives_unique_excerpts_and_bounded_prompts() {
    let directory = project(&[
        (
            "src/a_b.ts",
            &format!(
                "export class Payment {{}}\n{}",
                "// pagamento 日本語\n".repeat(400)
            ),
        ),
        ("src/a/b.ts", "export function processPayment() {}"),
    ]);
    let root = directory.path();
    let config = Config::default();
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &config, false).unwrap();
    let options = options("Fix Payment processPayment");
    let resolution = resolver::resolve(root, &options).unwrap();
    let candidates = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
    let first = pack::compose(root, &db, &resolution, &candidates, &config, 500).unwrap();
    let second = pack::compose(root, &db, &resolution, &candidates, &config, 500).unwrap();
    assert_ne!(first.directory, second.directory);
    assert!(first.manifest.budget_tokens <= 500);
    for name in [
        "PACK.md", "TASK.md", "FILES.md", "GRAPH.md", "TESTS.md", "DIFF.md", "ctx.json", "ctx.tgz",
    ] {
        assert!(first.directory.join(name).is_file());
    }
    let prompt = fs::read_to_string(first.directory.join("PACK.md")).unwrap();
    assert!(prompt.len() <= 2000);
    let json: pack::Manifest =
        serde_json::from_slice(&fs::read(first.directory.join("ctx.json")).unwrap()).unwrap();
    assert_eq!(json.files.len(), candidates.len());
    let decoder =
        flate2::read::GzDecoder::new(fs::File::open(first.directory.join("ctx.tgz")).unwrap());
    let mut archive = tar::Archive::new(decoder);
    let paths: Vec<_> = archive
        .entries()
        .unwrap()
        .map(|entry| entry.unwrap().path().unwrap().into_owned())
        .collect();
    assert!(paths.contains(&PathBuf::from("PACK.md")));
    assert!(!paths.contains(&PathBuf::from("ctx.tgz")));
    assert_eq!(pack::list(root).unwrap().len(), 2);
    assert!(
        fs::read_dir(root.join(".context/packs"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".pending"))
    );
}

fn cli(root: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_context"))
        .arg("--root")
        .arg(root)
        .args(args)
        .env_remove("CONTEXT_MAX_FILES")
        .env_remove("CONTEXT_VERBOSE")
        .output()
        .unwrap()
}

#[test]
fn cli_commands_config_and_invalid_arguments() {
    let directory = project(&[("app.rs", "pub fn payment() {}")]);
    let root = directory.path();
    assert!(cli(root, &["--help"]).status.success());
    assert!(cli(root, &["init"]).status.success());
    assert!(cli(root, &["index", "--json"]).status.success());
    let output = cli(root, &["pack", "--task", "Fix payment", "--json"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let manifest: pack::Manifest = serde_json::from_slice(&output.stdout).unwrap();
    assert!(manifest.files.iter().any(|f| f.path == "app.rs"));
    assert!(cli(root, &["ls", "--json"]).status.success());
    assert!(
        cli(
            root,
            &[
                "domains",
                "add",
                "inventory",
                "--keywords",
                "stock,warehouse"
            ]
        )
        .status
        .success()
    );
    assert!(
        cli(root, &["domains", "remove", "inventory"])
            .status
            .success()
    );
    assert!(
        cli(root, &["domains", "remove", "payments"])
            .status
            .success()
    );
    assert!(
        cli(root, &["domains", "enable", "payments"])
            .status
            .success()
    );
    assert!(!cli(root, &["pack", "--max-files", "0"]).status.success());
    assert!(
        !cli(
            root,
            &["pack", "--task", "Fix payment", "--include", "invalid"]
        )
        .status
        .success()
    );
    assert!(!cli(root, &["pack", "--since", "1h"]).status.success());
    assert!(!cli(root, &["open", "../outside"]).status.success());
    assert!(!cli(root, &["pack"]).status.success());
}

#[test]
fn git_signals_diff_and_error_log_filters() {
    let directory = project(&[("service.ts", "export function payment() { return 1; }\n")]);
    let root = directory.path();
    for args in [
        &["init", "-q"][..],
        &["add", "service.ts"],
        &[
            "-c",
            "user.name=Context Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "core.hooksPath=.git/hooks",
            "commit",
            "-qm",
            "Initial",
        ],
    ] {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(root)
                .status()
                .unwrap()
                .success()
        );
    }
    write(
        root,
        "service.ts",
        "export function payment() { return 2; }\n",
    );
    let diff = context::git::diff(root, "HEAD").unwrap();
    assert_eq!(diff.len(), 1);
    assert_eq!(
        diff[0].changed_lines,
        vec![1],
        "patch: {}",
        String::from_utf8_lossy(
            &context::git::run(
                root,
                &[
                    "--no-pager",
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "--unified=0",
                    "--src-prefix=a/",
                    "--dst-prefix=b/",
                    "HEAD",
                    "--",
                    "."
                ]
            )
            .unwrap()
        )
    );
    assert!(context::git::diff(root, "--output=bad").is_err());
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    assert_eq!(db.git_signals().unwrap()["service.ts"].commit_count, 1);
    let log = format!(
        "[2000-01-01 00:00:00] Old service.ts:1\n[{}] New service.ts:2\n",
        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
    );
    write(root, "error.log", &log);
    let options = PackOptions {
        error: Some("error.log".into()),
        since: Some("1h".into()),
        task: None,
        ..options("")
    };
    let resolution = resolver::resolve(root, &options).unwrap();
    assert_eq!(resolution.stacktrace.len(), 1);
    assert_eq!(resolution.stacktrace[0].line, 2);
}

#[test]
fn failed_updates_roll_back_and_binary_metadata_is_cached() {
    use context::database::FileUpdate;
    let directory = project(&[
        ("file.ts", "export class Real {}"),
        ("asset.bin", "abc\0def"),
    ]);
    let root = directory.path();
    let mut database = Database::open(root).unwrap();
    let config = Config::default();
    indexer::index(root, &mut database, &config, false).unwrap();
    assert_eq!(database.skipped_files().unwrap().len(), 1);
    assert_eq!(
        indexer::index(root, &mut database, &config, false)
            .unwrap()
            .updated,
        0
    );
    let original = database.files().unwrap()["file.ts"].clone();
    let mut changed = original.clone();
    changed.hash = "unexpected".into();
    let updates = vec![
        Ok(FileUpdate::Metadata(changed)),
        Err(anyhow::anyhow!("Simulated failure")),
    ];
    assert!(database.update(updates, &[], None, None, &[]).is_err());
    assert_eq!(database.files().unwrap()["file.ts"].hash, original.hash);
    write(root, "asset.bin", "readable text now");
    indexer::index(root, &mut database, &config, false).unwrap();
    assert!(database.files().unwrap().contains_key("asset.bin"));
    assert!(database.skipped_files().unwrap().is_empty());
    write(root, "file.ts", "changed\0binary");
    assert_eq!(
        indexer::index(root, &mut database, &config, false)
            .unwrap()
            .removed,
        1
    );
    assert!(!database.symbols().unwrap().iter().any(|s| s.name == "Real"));
}

#[test]
fn unicode_paths_and_long_markdown_fences_respect_budget() {
    let directory = project(&[
        (
            "src/日本語/支払い.ts",
            &format!("export class Payment {{}}\n{}\n", "\u{0060}".repeat(1500)),
        ),
        ("error.log", "recent file.ts:1"),
    ]);
    let root = directory.path();
    let config = Config::default();
    let mut database = Database::open(root).unwrap();
    indexer::index(root, &mut database, &config, false).unwrap();
    let options = options("Fix Payment");
    let resolution = resolver::resolve(root, &options).unwrap();
    let candidates = discovery::discover(root, &database, &resolution, &options, 2).unwrap();
    let result = pack::compose(root, &database, &resolution, &candidates, &config, 400).unwrap();
    assert!(
        fs::metadata(result.directory.join("PACK.md"))
            .unwrap()
            .len()
            <= 1600
    );
    for entry in fs::read_dir(result.directory.join("excerpts")).unwrap() {
        assert!(entry.unwrap().file_name().to_string_lossy().len() < 255);
    }
    let options = PackOptions {
        error: Some("error.log".into()),
        since: Some("1☃".into()),
        ..options
    };
    assert!(resolver::resolve(root, &options).is_err());
}

#[cfg(unix)]
#[test]
fn scanner_does_not_follow_symlinks() {
    let directory = project(&[("real.ts", "export class Real {}")]);
    let outside = project(&[("external.ts", "export class External {}")]);
    std::os::unix::fs::symlink(
        outside.path().join("external.ts"),
        directory.path().join("linked.ts"),
    )
    .unwrap();
    let mut database = Database::open(directory.path()).unwrap();
    indexer::index(directory.path(), &mut database, &Config::default(), false).unwrap();
    assert!(!database.files().unwrap().contains_key("linked.ts"));
}
