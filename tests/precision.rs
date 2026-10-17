use context::{
    config::Config, database::Database, discovery, indexer, model::PackOptions, query, resolver,
};
use std::{fs, path::Path};

fn write(root: &Path, path: &str, content: &str) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}
fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    for (path, content) in files {
        write(root.path(), path, content);
    }
    root
}
fn indexed(root: &Path) -> Database {
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), true).unwrap();
    db
}
fn options(task: &str) -> PackOptions {
    PackOptions {
        task: Some(task.into()),
        ..Default::default()
    }
}
fn discover(root: &Path, db: &Database, options: &PackOptions) -> Vec<context::model::Candidate> {
    let resolution = resolver::resolve_indexed(root, db, options).unwrap();
    discovery::discover(root, db, &resolution, options, 2).unwrap()
}

#[test]
fn corpus_tokens_are_literal_and_query_expansion_has_provenance() {
    assert!(!resolver::search_terms("ProjectAccessData").contains(&"login".into()));
    assert!(!resolver::search_terms("ClientImport").contains(&"amount".into()));
    let root = project(&[("access.ts", "export class ProjectAccessData {}")]);
    let db = indexed(root.path());
    let content: String = db
        .connection
        .query_row(
            "SELECT content FROM files_fts WHERE path='access.ts'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!content.split_whitespace().any(|word| word == "login"));
    let resolution =
        resolver::resolve_indexed(root.path(), &db, &options("Fix access permissions")).unwrap();
    let translation = resolution
        .task
        .query_terms
        .iter()
        .find(|term| term.term == "login")
        .unwrap();
    assert_eq!(translation.origin, context::terms::Origin::Translation);
    assert!(translation.weight < 0.3);
    assert_eq!(translation.source, "access");
}

#[test]
fn billing_access_login_and_italian_login_keep_distinct_evidence() {
    let root = project(&[
        (
            "billing/ProjectAccessData.ts",
            "export class ProjectAccessData { permissions = ['read']; }",
        ),
        (
            "auth/LoginHandler.ts",
            "export function login() { return authenticate(); }",
        ),
        (
            "billing/InvoiceService.ts",
            "export function invoice() { return 'billing total'; }",
        ),
    ]);
    let db = indexed(root.path());
    for task in ["Fix login", "Problemi di accesso"] {
        let result = discover(root.path(), &db, &options(task));
        assert_eq!(result[0].path, "auth/LoginHandler.ts", "{task}: {result:?}");
        assert!(
            !result
                .iter()
                .any(|candidate| candidate.path == "billing/ProjectAccessData.ts"),
            "{task}: {result:?}"
        );
    }
    let result = discover(root.path(), &db, &options("Fix project access permissions"));
    assert_eq!(result[0].path, "billing/ProjectAccessData.ts");
    assert!(
        !result
            .iter()
            .any(|candidate| candidate.path == "auth/LoginHandler.ts")
    );
    let explicit = PackOptions {
        symbol: Some("ProjectAccessData".into()),
        ..options("Inspect behavior")
    };
    assert!(discover(root.path(), &db, &explicit)[0].reserved);
}

#[test]
fn actual_direct_dependencies_outweigh_lexical_mentions() {
    let root = project(&[
        (
            "entry.ts",
            "import { connect } from './session'; // SharedData\nexport function login() { return connect(); }",
        ),
        ("session.ts", "export function connect() { return true; }"),
        ("shared.ts", "export class SharedData {}"),
    ]);
    let db = indexed(root.path());
    let options = PackOptions {
        file: Some("entry.ts".into()),
        ..options("Inspect behavior")
    };
    let resolution = resolver::resolve_indexed(root.path(), &db, &options).unwrap();
    let result = discovery::rank(root.path(), &db, &resolution, &options, 2).unwrap();
    let dependency = result
        .iter()
        .find(|candidate| candidate.path == "session.ts")
        .unwrap();
    let mention = result
        .iter()
        .find(|candidate| candidate.path == "shared.ts")
        .unwrap();
    assert!(dependency.score > mention.score * 4.0);
    assert!(
        dependency
            .evidence
            .iter()
            .any(|e| e.signal == "outgoing_dependency"
                && e.relation.as_deref() == Some("js")
                && e.source_path.as_deref() == Some("entry.ts"))
    );
    assert!(mention.evidence.iter().any(|e| e.signal == "shared_symbol"));
}

#[test]
fn incoming_hubs_do_not_pull_all_consumers_into_context() {
    let root = project(&[("User.ts", "export class User {}")]);
    for index in 0..30 {
        write(
            root.path(),
            &format!("features/module{index}.ts"),
            "import { User } from '../User'; export const record = new User();",
        );
    }
    let db = indexed(root.path());
    let options = PackOptions {
        file: Some("User.ts".into()),
        ..options("Inspect behavior")
    };
    let result = discover(root.path(), &db, &options);
    assert!(result.iter().any(|candidate| candidate.path == "User.ts"));
    assert!(result.len() < 6, "{result:?}");
}

#[test]
fn web_authentication_reaches_runtime_config_and_bootstrap_in_its_scope() {
    let root = project(&[
        (
            "apps/server/composer.json",
            r#"{"require":{"laravel/framework":"*"}}"#,
        ),
        (
            "apps/server/app/Providers/FortifyServiceProvider.php",
            "<?php Fortify::loginView(fn () => Inertia::render('Auth/Login'));",
        ),
        (
            "apps/server/resources/js/pages/Auth/Login.tsx",
            "export function Login() { return <form>login</form>; }",
        ),
        (
            "apps/server/config/auth.php",
            "<?php return ['guards' => ['web' => []]];",
        ),
        (
            "apps/server/config/fortify.php",
            "<?php return ['views' => true];",
        ),
        (
            "apps/server/config/session.php",
            "<?php return ['driver' => 'redis'];",
        ),
        (
            "apps/server/bootstrap/app.php",
            "<?php return Application::configure();",
        ),
        (
            "apps/other/composer.json",
            r#"{"require":{"laravel/framework":"*"}}"#,
        ),
        (
            "apps/other/config/session.php",
            "<?php return ['driver' => 'database'];",
        ),
    ]);
    let db = indexed(root.path());
    let result = discover(root.path(), &db, &options("Login fails"));
    for path in [
        "apps/server/app/Providers/FortifyServiceProvider.php",
        "apps/server/config/auth.php",
        "apps/server/config/session.php",
        "apps/server/bootstrap/app.php",
    ] {
        assert!(
            result.iter().any(|candidate| candidate.path == path),
            "missing {path}: {result:?}"
        );
    }
    assert!(
        db.dependencies()
            .unwrap()
            .iter()
            .any(|edge| edge.kind == "runtime"
                && edge.target_path == "apps/server/config/session.php")
    );
    assert!(
        !db.dependencies()
            .unwrap()
            .iter()
            .any(|edge| edge.source_path.starts_with("apps/server/")
                && edge.target_path.starts_with("apps/other/"))
    );
}

#[test]
fn literal_config_references_work_for_non_authentication_tasks() {
    let root = project(&[
        ("apps/server/composer.json", "{}"),
        (
            "apps/server/app/Invoice.php",
            "<?php class Invoice { public function total() { return config('billing.tax'); } }",
        ),
        (
            "apps/server/config/billing.php",
            "<?php return ['tax' => 0.22];",
        ),
        (
            "apps/server/config/session.php",
            "<?php return ['driver' => 'redis'];",
        ),
        (
            "apps/server/bootstrap/app.php",
            "<?php return Application::configure();",
        ),
    ]);
    let db = indexed(root.path());
    let result = discover(root.path(), &db, &options("Correct invoice total"));
    assert!(
        result
            .iter()
            .any(|candidate| candidate.path == "apps/server/config/billing.php")
    );
    assert!(
        !result
            .iter()
            .any(|candidate| candidate.path.ends_with("bootstrap/app.php"))
    );
}

#[test]
fn file_limit_is_a_ceiling_and_weak_matches_remain_explainable() {
    let root = project(&[
        (
            "RefundService.ts",
            "import { total } from './money'; export function refund() { return total(); }",
        ),
        ("money.ts", "export function total() { return 1; }"),
    ]);
    for index in 0..30 {
        write(
            root.path(),
            &format!("notes/record{index}.ts"),
            &format!("export const value{index} = {index}; // refund\n"),
        );
    }
    let db = indexed(root.path());
    let options = options("Fix refund processing");
    let result = discover(root.path(), &db, &options);
    assert!(result.len() < 10, "{result:?}");
    assert!(
        result
            .iter()
            .any(|candidate| candidate.path == "RefundService.ts")
    );
    assert!(result.iter().any(|candidate| candidate.path == "money.ts"));
    let explanation = query::explain(
        root.path(),
        &db,
        &Config::default(),
        "notes/record29.ts",
        &options,
    )
    .unwrap();
    assert_eq!(explanation.status, "low_marginal_value");
    assert!(explanation.rank.is_some());
    let explicit = PackOptions {
        file: Some("notes/record29.ts".into()),
        max_files: 1,
        ..options.clone()
    };
    assert_eq!(
        discover(root.path(), &db, &explicit)[0].path,
        "notes/record29.ts"
    );
    let excluded = PackOptions {
        exclude: vec!["notes/".into()],
        ..explicit
    };
    assert!(
        !discover(root.path(), &db, &excluded)
            .iter()
            .any(|candidate| candidate.path.starts_with("notes/"))
    );
}

#[test]
fn explicit_cli_intent_does_not_expand_web_runtime_configuration() {
    let root = project(&[
        (
            "apps/cli/Cargo.toml",
            "[package]\nname='client'\nversion='0.1.0'",
        ),
        (
            "apps/cli/src/login.rs",
            "mod credentials; pub fn login() { credentials::device_token(); }",
        ),
        (
            "apps/cli/src/login/credentials.rs",
            "pub fn device_token() {}",
        ),
        (
            "apps/server/composer.json",
            r#"{"require":{"laravel/framework":"*"}}"#,
        ),
        (
            "apps/server/app/Provider.php",
            "<?php Fortify::loginView(fn () => Inertia::render('Auth/Login'));",
        ),
        (
            "apps/server/resources/js/pages/Auth/Login.tsx",
            "export function Login() { return <form>login</form>; }",
        ),
        (
            "apps/server/config/session.php",
            "<?php return ['driver' => 'redis'];",
        ),
        (
            "apps/server/bootstrap/app.php",
            "<?php return Application::configure();",
        ),
    ]);
    let db = indexed(root.path());
    let result = discover(root.path(), &db, &options("CLI device login fails"));
    assert!(result[0].path.starts_with("apps/cli/"), "{result:?}");
    assert!(
        !result
            .iter()
            .any(|candidate| candidate.path.ends_with("bootstrap/app.php"))
    );
    assert!(
        !result
            .iter()
            .any(|candidate| candidate.path.ends_with("config/session.php"))
    );
}

#[test]
fn runtime_links_require_calls_and_ignore_comments_and_quoted_examples() {
    let root = project(&[
        ("composer.json", "{}"),
        (
            "app/Examples.php",
            r#"<?php
// Fortify::loginView();
/* Auth::login(); config('session.driver'); */
$example = "Fortify::loginView(); config('session.driver')";
logger("session('example')");
"#,
        ),
        (
            "app/Invoice.php",
            "<?php Config::array('billing.tax'); config()->get('invoice.currency');",
        ),
        ("config/billing.php", "<?php return [];"),
        ("config/invoice.php", "<?php return [];"),
        ("config/session.php", "<?php return [];"),
        (
            "bootstrap/app.php",
            "<?php return Application::configure();",
        ),
    ]);
    let db = indexed(root.path());
    let edges = db.dependencies().unwrap();
    assert!(
        !edges
            .iter()
            .any(|edge| edge.source_path == "app/Examples.php")
    );
    for path in ["config/billing.php", "config/invoice.php"] {
        assert!(
            edges
                .iter()
                .any(|edge| edge.source_path == "app/Invoice.php"
                    && edge.target_path == path
                    && edge.kind == "config"),
            "{edges:?}"
        );
    }
}

#[test]
fn long_queries_prioritize_literal_terms_before_expansion_limits() {
    let root = project(&[("target.ts", "export const zzzzzz = true;")]);
    let db = indexed(root.path());
    let mut terms: Vec<_> = (0..80)
        .map(|index| context::terms::QueryTerm {
            term: format!("aaa{index}"),
            origin: context::terms::Origin::Synonym,
            source: "example".into(),
            weight: 0.1,
        })
        .collect();
    terms.push(context::terms::QueryTerm {
        term: "zzzzzz".into(),
        origin: context::terms::Origin::Literal,
        source: "zzzzzz".into(),
        weight: 1.0,
    });
    terms.push(context::terms::QueryTerm {
        term: String::new(),
        origin: context::terms::Origin::Literal,
        source: String::new(),
        weight: 1.0,
    });
    assert!(
        db.search_with_provenance(&terms, 10)
            .unwrap()
            .iter()
            .any(|(path, origin, _)| path == "target.ts"
                && *origin == context::terms::Origin::Literal)
    );
}

#[test]
fn testing_focus_lifts_the_test_ceiling_for_distinct_query_evidence() {
    let root = project(&[("refund.ts", "export function refund() {}")]);
    for term in [
        "amount",
        "currency",
        "rounding",
        "validation",
        "fees",
        "taxes",
    ] {
        write(
            root.path(),
            &format!("e2e/{term}.ts"),
            &format!("export function refund_{term}() {{ return '{term}'; }}"),
        );
    }
    let db = indexed(root.path());
    let general = PackOptions {
        max_files: 10,
        ..options("refund amount currency rounding validation fees taxes")
    };
    let result = discover(root.path(), &db, &general);
    assert!(
        result
            .iter()
            .filter(|candidate| discovery::is_test(&candidate.path))
            .count()
            <= 2
    );
    let testing = PackOptions {
        focus: vec!["testing".into()],
        ..general
    };
    let result = discover(root.path(), &db, &testing);
    assert!(
        result
            .iter()
            .filter(|candidate| discovery::is_test(&candidate.path))
            .count()
            > 2,
        "{result:?}"
    );
}

#[test]
fn incremental_packs_refresh_when_query_evidence_changes() {
    let root = project(&[("Login.ts", "export function login() { return true; }")]);
    let db = indexed(root.path());
    let options = options("Fix login");
    let resolution = resolver::resolve_indexed(root.path(), &db, &options).unwrap();
    let candidates = discover(root.path(), &db, &options);
    let mut parent = context::pack::compose_with_options(
        root.path(),
        &db,
        &resolution,
        &candidates,
        &Config::default(),
        &options,
        None,
    )
    .unwrap()
    .manifest;
    parent.task.query_terms.clear();
    let update = context::pack::compose_with_options(
        root.path(),
        &db,
        &resolution,
        &candidates,
        &Config::default(),
        &options,
        Some(&parent),
    )
    .unwrap();
    let changes = update.manifest.changes.as_ref().unwrap();
    assert_eq!(changes.changed, vec!["Login.ts"]);
    assert!(changes.unchanged.is_empty());
    assert!(!update.manifest.files[0].excerpt_ranges.is_empty());
}

#[test]
fn project_permission_logic_survives_related_dependency_fanout() {
    let root = project(&[(
        "billing/ProjectScope.ts",
        "export class ProjectScope { locked() { return true; } }",
    )]);
    let mut imports = String::new();
    for index in 0..30 {
        imports.push_str(&format!(
            "import {{ helper{index} }} from './helpers/helper{index}';\n"
        ));
        write(
            root.path(),
            &format!("billing/helpers/helper{index}.ts"),
            &format!("export function helper{index}() {{ return true; }}"),
        );
    }
    imports.push_str("export class ProjectAccessData { locked = true; }");
    write(root.path(), "billing/ProjectAccessData.ts", &imports);
    let db = indexed(root.path());
    let options = PackOptions {
        max_files: 8,
        ..options("Project access permissions for locked projects")
    };
    let result = discover(root.path(), &db, &options);
    assert!(
        result
            .iter()
            .any(|candidate| candidate.path == "billing/ProjectScope.ts"),
        "{result:?}"
    );
}

#[test]
fn overlapping_clipped_declarations_finish_without_metadata_only_progress() {
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let root = project(&[]);
    let mut source = "export class Ledger {\n  process() {\n".to_owned();
    for index in 0..40 {
        source.push_str(&format!("    const filler{index} = 'padding data';\n"));
    }
    source.push_str("    payment();\n");
    for index in 0..40 {
        source.push_str(&format!("    const tail{index} = 'padding data';\n"));
    }
    source.push_str("  }\n}\n");
    write(root.path(), "ledger.ts", &source);
    let mut child = Command::new(env!("CARGO_BIN_EXE_context"))
        .arg("--root")
        .arg(root.path())
        .args([
            "pack",
            "--task",
            "payment",
            "--budget-tokens",
            "250",
            "--json",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(5) => {
                std::thread::sleep(Duration::from_millis(10))
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Overlapping declarations did not finish: {result:?}");
            }
        }
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let manifest: context::pack::Manifest = serde_json::from_slice(&output.stdout).unwrap();
    let prompt = fs::read_to_string(
        root.path()
            .join(".context/packs")
            .join(manifest.slug)
            .join("PACK.md"),
    )
    .unwrap();
    assert!(prompt.contains("payment();"));
    assert!(
        context::tokens::Tokenizer::new("approx")
            .unwrap()
            .count(&prompt)
            <= 250
    );
}

#[test]
fn language_names_in_nested_fixtures_do_not_restrict_implementation_context() {
    let root = project(&[
        ("Cargo.toml", "[package]\nname='context'\nversion='0.1.0'"),
        ("src/lib.rs", "pub mod parser; pub mod storage;"),
        ("src/parser.rs", "pub fn parse_imports() {}"),
        (
            "src/storage.rs",
            "use crate::parser::parse_imports; pub fn update() { parse_imports(); }",
        ),
        (
            "tests/codebases/rust-crate/Cargo.toml",
            "[package]\nname='example'\nversion='0.1.0'",
        ),
        (
            "tests/codebases/rust-crate/src/lib.rs",
            "// Rust imports\npub fn example() {}",
        ),
    ]);
    let db = indexed(root.path());
    let result = discover(root.path(), &db, &options("Resolve Rust imports"));
    assert!(
        result
            .iter()
            .any(|candidate| candidate.path == "src/storage.rs"
                && candidate
                    .evidence
                    .iter()
                    .any(|evidence| evidence.signal == "incoming_dependency"
                        && evidence.source_path.as_deref() == Some("src/parser.rs"))),
        "{result:?}"
    );
}
