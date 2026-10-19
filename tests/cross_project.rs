use context::{
    config::{self, Config},
    database::Database,
    discovery, frameworks, indexer,
    model::{Candidate, PackOptions, Symbol},
    parser::{self, RawImport},
    resolver, snippets,
    tokens::Tokenizer,
};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

fn write(root: &Path, path: &str, content: &str) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}
fn indexed(root: &Path) -> Database {
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    db
}
fn options(task: &str) -> PackOptions {
    PackOptions {
        task: Some(task.into()),
        ..Default::default()
    }
}

#[test]
fn repository_opt_ins_preserve_source_and_generated_exclusions_after_init() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        ".gitignore",
        "node_modules/\n!packages/node_modules\npackages/node_modules/*/public/\nvendor/\n!first/vendor\n",
    );
    for path in [
        "packages/node_modules/app/src/main.ts",
        "first/vendor/lib/main.ts",
        "node_modules/download/main.ts",
        "packages/node_modules/app/public/generated.ts",
        "packages/node_modules/app/node_modules/download/main.ts",
    ] {
        write(root, path, "export function login() {}");
    }
    write(
        root,
        "packages/node_modules/app/package.json",
        r#"{"dependencies":{"express":"*"}}"#,
    );
    let mut db = indexed(root);
    let paths = db.files().unwrap();
    assert!(paths.contains_key("packages/node_modules/app/src/main.ts"));
    assert!(paths.contains_key("first/vendor/lib/main.ts"));
    for excluded in [
        "node_modules/download/main.ts",
        "packages/node_modules/app/public/generated.ts",
        "packages/node_modules/app/node_modules/download/main.ts",
    ] {
        assert!(!paths.contains_key(excluded), "{excluded}");
    }
    assert!(
        frameworks::detect(root)
            .unwrap()
            .iter()
            .any(|s| s.path == "packages/node_modules/app")
    );
    config::initialize(root, false).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    let initialized = db.files().unwrap();
    for path in paths.keys() {
        assert!(initialized.contains_key(path), "{path}");
    }
    assert!(!initialized.contains_key("packages/node_modules/app/public/generated.ts"));
    assert!(!initialized.contains_key("node_modules/download/main.ts"));
}

#[test]
fn explicit_context_exclusions_override_git_opt_ins_and_broad_git_negations_do_not_opt_in() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, ".gitignore", "!*\n");
    write(root, "vendor/lib/main.py", "def login(): pass");
    assert!(
        !indexed(root)
            .files()
            .unwrap()
            .contains_key("vendor/lib/main.py")
    );
    write(root, ".gitignore", "!vendor/\n");
    write(root, ".ctxignore", "vendor/\n");
    assert!(
        !indexed(root)
            .files()
            .unwrap()
            .contains_key("vendor/lib/main.py")
    );
    assert!(
        !frameworks::detect(root)
            .unwrap()
            .iter()
            .any(|s| s.path.starts_with("vendor/"))
    );
}

#[test]
fn test_roles_are_syntactic_and_old_symbol_json_still_reads() {
    let rust = parser::parse(
        "src/lib.rs",
        r##"
// #[test]
pub fn production() { let _x = "#[cfg(test)]"; }
#[cfg(not(test))]
fn non_test() {}
#[cfg(feature = "test")]
fn feature_flag() {}
#[tokio::test]
async fn checks_behavior() {}
#[cfg(test)]
mod checks { fn helper() {} }
mod tests { fn more_checks() {} }
"##,
        &mut tree_sitter::Parser::new(),
    )
    .unwrap();
    for name in ["production", "non_test", "feature_flag"] {
        assert!(
            !rust
                .symbols
                .iter()
                .find(|s| s.name == name)
                .unwrap()
                .is_test,
            "{name}"
        );
    }
    for name in ["checks_behavior", "helper", "more_checks"] {
        assert!(
            rust.symbols
                .iter()
                .find(|s| s.name == name)
                .unwrap()
                .is_test,
            "{name}"
        );
    }
    let java = parser::parse(
        "src/Verifier.java",
        "class Verifier { @org.junit.jupiter.api.Test void checks() {} void production() {} }",
        &mut tree_sitter::Parser::new(),
    )
    .unwrap();
    assert!(
        java.symbols
            .iter()
            .find(|s| s.name == "checks")
            .unwrap()
            .is_test
    );
    assert!(
        !java
            .symbols
            .iter()
            .find(|s| s.name == "production")
            .unwrap()
            .is_test
    );
    let legacy:Symbol=serde_json::from_value(serde_json::json!({"filePath":"x.rs","name":"old","kind":"function","startLine":1,"endLine":1,"signature":"old"})).unwrap();
    assert!(!legacy.is_test);
    assert!(!legacy.is_test_case);
    for path in [
        "Lib.Tests/Foo.cs",
        "SourcesTests/Foo.swift",
        "tests/test_foo.py",
        "a/FooTest.java",
        "a/foo_test.go",
    ] {
        assert!(discovery::is_test(path), "{path}");
    }
    for path in ["src/contest.rs", "src/specification.py", "src/testimony.js"] {
        assert!(!discovery::is_test(path), "{path}");
    }
}

fn excerpts(
    root: &Path,
    db: &Database,
    path: &str,
    task: &str,
    lines: usize,
    budget: usize,
) -> String {
    let resolution = resolver::resolve_indexed(root, db, &options(task)).unwrap();
    let candidates = [Candidate {
        path: path.into(),
        score: 1.0,
        reasons: vec![],
        contributions: BTreeMap::new(),
        evidence: vec![],
        reserved: false,
    }];
    let selection = snippets::select(
        root,
        db,
        &resolution,
        &candidates,
        lines,
        "",
        budget,
        &Tokenizer::new("approx").unwrap(),
    )
    .unwrap();
    selection
        .excerpts
        .iter()
        .map(|e| e.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn excerpts_keep_implementation_before_repetitive_inline_tests() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut code="pub fn render(value: &str) -> String {\n    let escaped = value.replace(\"$\", \"\\\\$\");\n    escaped\n}\n#[cfg(test)]\nmod tests {\n".to_owned();
    for n in 0..30 {
        code.push_str(&format!("#[test]\nfn escaping_prompt_{n}() {{\nassert_eq!(super::render(\"$\"), \"\\\\$\");\n}}\n"));
    }
    code.push_str("}\n");
    write(root, "src/prompt.rs", &code);
    let db = indexed(root);
    let text = excerpts(
        root,
        &db,
        "src/prompt.rs",
        "prompt dollar escaping",
        30,
        500,
    );
    assert!(text.contains("let escaped ="), "{text}");
}

#[test]
fn long_functions_retain_multiple_relevant_regions_and_configuration_values() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut code = "pub fn process() {\n".to_owned();
    for n in 0..210 {
        code.push_str(if n == 30 {
            "    validate_cookie_domain();\n"
        } else if n == 170 {
            "    persist_session_state();\n"
        } else {
            "    do_work();\n"
        });
    }
    code.push_str("}\n");
    write(root, "src/session.rs", &code);
    let config = format!(
        "<?php\n/*\n{}\n*/\nreturn [\n    'driver' => env('SESSION_DRIVER', 'database'),\n    'domain' => env('SESSION_DOMAIN'),\n    'same_site' => 'lax',\n];\n",
        "session documentation\n".repeat(120)
    );
    write(root, "config/session.php", &config);
    let db = indexed(root);
    let text = excerpts(
        root,
        &db,
        "src/session.rs",
        "cookie domain session state",
        30,
        2000,
    );
    assert!(text.contains("validate_cookie_domain"), "{text}");
    assert!(text.contains("persist_session_state"), "{text}");
    let text = excerpts(root, &db, "config/session.php", "session settings", 20, 500);
    for key in ["'driver'", "'domain'", "'same_site'"] {
        assert!(text.contains(key), "{text}");
    }
}

#[test]
fn direct_tests_have_traceable_links_and_respect_package_scopes_and_exclusions() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "packages/alpha/package.json", "{}");
    write(root, "packages/beta/package.json", "{}");
    write(
        root,
        "packages/alpha/src/auth/login.ts",
        "export function login() { return validateSession(); }",
    );
    write(
        root,
        "packages/alpha/tests/auth/login.test.ts",
        "import { login } from '../../src/auth/login';\nassert(login());",
    );
    write(
        root,
        "packages/beta/tests/auth/login.test.ts",
        "export function unrelated() {}",
    );
    for n in 0..12 {
        write(
            root,
            &format!("packages/alpha/tests/misc/check{n}.test.ts"),
            "export function login() { return 'login session login session'; }",
        );
    }
    let db = indexed(root);
    let opts = PackOptions {
        max_files: 10,
        ..options("login fails with invalid session")
    };
    let res = resolver::resolve_indexed(root, &db, &opts).unwrap();
    let ranked = discovery::rank(root, &db, &res, &opts, 2).unwrap();
    let related = ranked
        .iter()
        .find(|c| c.path == "packages/alpha/tests/auth/login.test.ts")
        .unwrap();
    assert!(related.evidence.iter().any(|e| e.signal == "behavior_test"
        && e.source_path.as_deref() == Some("packages/alpha/src/auth/login.ts")));
    assert!(
        !ranked
            .iter()
            .find(|c| c.path == "packages/beta/tests/auth/login.test.ts")
            .is_some_and(|c| c.evidence.iter().any(|e| e.signal == "behavior_test"))
    );
    let selected = discovery::discover(root, &db, &res, &opts, 2).unwrap();
    assert!(
        selected.iter().any(|c| c.path == related.path),
        "{selected:?}"
    );
    assert!(
        selected
            .iter()
            .filter(|c| discovery::is_test(&c.path))
            .count()
            <= 2
    );
    let opts = PackOptions {
        exclude: vec!["**/login.test.ts".into()],
        ..opts
    };
    assert!(
        discovery::discover(root, &db, &res, &opts, 2)
            .unwrap()
            .iter()
            .all(|c| !c.path.ends_with("login.test.ts"))
    );
}

#[test]
fn java_imports_resolve_classes_members_and_direct_package_wildcards() {
    let files: HashSet<String> = [
        "odd/root/com/example/Widget.java",
        "odd/root/com/example/Other.java",
        "odd/root/com/example/sub/Nested.java",
        "other/notcom/example/Widget.java",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    let resolve = |module: &str| {
        parser::resolve_import(
            "src/Caller.java",
            &RawImport {
                module: module.into(),
                kind: "java".into(),
            },
            &files,
            &[],
        )
    };
    for import in [
        "com.example.Widget",
        "com.example.Widget.Inner",
        "static com.example.Widget.VALUE",
        "static com.example.Widget.*",
        "import com.example.Widget;",
    ] {
        assert_eq!(
            resolve(import),
            ["odd/root/com/example/Widget.java"],
            "{import}"
        );
    }
    assert_eq!(
        resolve("com.example.*"),
        [
            "odd/root/com/example/Other.java",
            "odd/root/com/example/Widget.java"
        ]
    );
    assert!(resolve("java.util.Missing").is_empty());
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "src/Caller.java",
        "import com.example.Widget; class Caller {}",
    );
    let mut db = indexed(root);
    assert!(db.dependencies().unwrap().is_empty());
    write(
        root,
        "odd/com/example/Widget.java",
        "package com.example; class Widget {}",
    );
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    assert_eq!(db.dependencies().unwrap().len(), 1);
    fs::remove_file(root.join("odd/com/example/Widget.java")).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    assert!(db.dependencies().unwrap().is_empty());
}

#[test]
fn java_graph_rebuild_handles_many_missing_external_imports_within_deadline() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "source/org/example/Shared.java",
        "package org.example; class Shared {}",
    );
    for n in 0..1500 {
        let mut code = "import org.example.Shared;\n".to_owned();
        for k in 0..24 {
            code.push_str(&format!("import external.library.Type{k};\n"));
        }
        code.push_str(&format!("class Item{n} {{}}\n"));
        write(root, &format!("source/org/example/Item{n}.java"), &code);
    }
    let mut child = Command::new(env!("CARGO_BIN_EXE_context"))
        .args(["--root", root.to_str().unwrap(), "index", "--json"])
        .env("RAYON_NUM_THREADS", "2")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        if started.elapsed() > Duration::from_secs(30) {
            child.kill().unwrap();
            child.wait().unwrap();
            panic!("Java import graph exceeded 30 seconds");
        }
        thread::sleep(Duration::from_millis(25));
    }
    assert_eq!(
        Database::open(root).unwrap().dependencies().unwrap().len(),
        1500
    );
}

#[test]
fn evaluation_copies_the_same_first_party_sources_as_the_indexer() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        ".gitignore",
        "node_modules/\n!packages/node_modules\n",
    );
    write(
        root,
        "packages/node_modules/app/login.ts",
        "export function login() { return true; }",
    );
    let dataset:context::evaluation::Dataset=serde_json::from_value(serde_json::json!({"cases":[{"name":"first party", "root":".", "task":"login", "expectedFiles":["packages/node_modules/app/login.ts"]}]})).unwrap();
    let report = context::evaluation::evaluate(&dataset, root, &Config::default(), "all").unwrap();
    assert_eq!(report.summary.recall, 1.0);
    assert_eq!(report.summary.excerpt_recall, 1.0);
}

#[test]
fn schema_upgrade_rebuilds_test_roles_without_touching_settings_or_saved_packs() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(root, "src/lib.rs", "#[test]\nfn checks() {}\n");
    write(root, ".context/config.json", "{\"maxFiles\":17}\n");
    write(root, ".context/packs/saved/PACK.md", "retained pack\n");
    drop(indexed(root));
    let connection = rusqlite::Connection::open(root.join(".context/index.db")).unwrap();
    connection.pragma_update(None, "user_version", 7).unwrap();
    drop(connection);
    let mut db = Database::open(root).unwrap();
    assert!(db.files().unwrap().is_empty());
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    assert!(
        db.symbols()
            .unwrap()
            .iter()
            .find(|s| s.name == "checks")
            .unwrap()
            .is_test
    );
    assert_eq!(
        fs::read_to_string(root.join(".context/packs/saved/PACK.md")).unwrap(),
        "retained pack\n"
    );
    assert_eq!(
        fs::read_to_string(root.join(".context/config.json")).unwrap(),
        "{\"maxFiles\":17}\n"
    );
}

#[test]
fn missing_external_tsconfig_preserves_local_mappings_and_recovers_after_installation() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "tsconfig.json",
        r#"{"extends":"@org/toolchain/base", "compilerOptions":{"baseUrl":".", "paths":{"@local/*":["src/*"]}}}"#,
    );
    write(root, "src/value.ts", "export const value = 1;");
    write(root, "src/inherited.ts", "export const inherited = 2;");
    write(
        root,
        "consumer.ts",
        "import {value} from '@local/value';\nimport {inherited} from '@inherited/inherited';",
    );
    let mut db = Database::open(root).unwrap();
    let stats = indexer::index(root, &mut db, &Config::default(), false).unwrap();
    assert_eq!(stats.unresolved_config_extends.len(), 1);
    assert_eq!(stats.unresolved_config_extends[0].path, "tsconfig.json");
    assert!(
        db.dependencies()
            .unwrap()
            .iter()
            .any(|d| d.target_path == "src/value.ts")
    );
    assert!(
        !db.dependencies()
            .unwrap()
            .iter()
            .any(|d| d.target_path == "src/inherited.ts")
    );
    write(
        root,
        "tsconfig.json",
        r#"{"extends":"@org/toolchain/base", "compilerOptions":{"baseUrl":"."}}"#,
    );
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    // The dependency is supplied by the caller, never installed by Context.
    write(
        root,
        "node_modules/@org/toolchain/base.json",
        r#"{"compilerOptions":{"baseUrl":"../../..", "paths":{"@inherited/*":["src/*"]}}}"#,
    );
    let stats = indexer::index(root, &mut db, &Config::default(), false).unwrap();
    assert!(stats.unresolved_config_extends.is_empty());
    assert_eq!(
        stats.updated, 0,
        "Only an excluded external configuration appeared"
    );
    assert!(
        db.dependencies()
            .unwrap()
            .iter()
            .any(|d| d.target_path == "src/inherited.ts")
    );
    write(root, "tsconfig.json", r#"{"extends":"./missing-local"}"#);
    let stats = indexer::index(root, &mut db, &Config::default(), false).unwrap();
    assert_eq!(
        stats.unresolved_config_extends[0].reference,
        "./missing-local"
    );
    write(root, "tsconfig.json", r#"{"extends":"../outside-missing"}"#);
    assert!(
        indexer::index(root, &mut db, &Config::default(), false)
            .unwrap_err()
            .to_string()
            .contains("outside the root")
    );
    write(
        root,
        "tsconfig.json",
        r#"{"extends":"@org/toolchain/base"}"#,
    );
    write(
        root,
        "node_modules/@org/toolchain/base.json",
        "{ invalid json",
    );
    assert!(
        indexer::index(root, &mut db, &Config::default(), false)
            .unwrap_err()
            .to_string()
            .contains("Invalid configuration")
    );
}

#[test]
fn ordinary_production_symbols_do_not_suppress_other_relevant_source_regions() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut source =
        "class Decoder {\n decode_record(input) {\n return unpack(input);\n }\n".to_owned();
    for n in 0..12 {
        source.push_str(&format!(
            " transform{n}(input) {{\n // decode encoded user value packed stream record content boundary checks lengths flags offsets namespaces checksums columns fields validation errors\n return input;\n }}\n"
        ));
    }
    source.push_str("}\n");
    write(root, "src/decoder.js", &source);
    let db = indexed(root);
    let text = excerpts(
        root,
        &db,
        "src/decoder.js",
        "decode encoded user value packed stream record content boundary checks lengths flags offsets namespaces checksums columns fields validation errors",
        25,
        800,
    );
    assert!(text.contains("return unpack(input)"), "{text}");
}

#[test]
fn ordinary_text_windows_keep_an_early_guard_before_a_denser_match() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let source = format!(
        "const cookie = true;\nif (!valid) {{\n reject();\n}}\n{}const header_response = cookie;\n{}",
        "const padding = 0;\n".repeat(4),
        "const padding = 0;\n".repeat(15)
    );
    write(root, "src/response.js", &source);
    let db = indexed(root);
    let text = excerpts(
        root,
        &db,
        "src/response.js",
        "cookie header response",
        15,
        2000,
    );
    assert!(text.contains("reject();"), "{text}");
}

#[test]
fn repeated_query_concepts_do_not_fragment_away_a_guard_clause() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let source = format!(
        "def run(value)\n  value = check()\n  # cookie header response authentication\n  return reject() unless valid\n{}  header_response = cookie\nend\n",
        "  padding = 0\n".repeat(20)
    );
    write(root, "src/decoder.rb", &source);
    let db = indexed(root);
    let text = excerpts(
        root,
        &db,
        "src/decoder.rb",
        "cookie header response authentication",
        2,
        1000,
    );
    assert!(text.contains("return reject() unless valid"), "{text}");
}

#[test]
fn direct_tests_cannot_spend_the_implementation_budget_and_testing_focus_lifts_the_quota() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let code = (0..10)
        .map(|n| {
            format!(
                "export function sessionCookieAuthentication{n}() {{\n{} return true;\n}}\n",
                (0..30)
                    .map(|j| format!("const value{j} = 'session cookie authentication value';\n"))
                    .collect::<String>()
            )
        })
        .collect::<String>();
    let paths = [
        "src/session.js",
        "src/cookie.js",
        "tests/a.test.js",
        "tests/b.test.js",
        "tests/c.test.js",
        "tests/d.test.js",
        "tests/e.test.js",
    ];
    for path in paths {
        write(root, path, &code);
    }
    write(
        root,
        "src/tiny.js",
        "export function sessionCookie() { return true; }
",
    );
    let db = indexed(root);
    let candidates: Vec<_> = paths
        .into_iter()
        .map(|path| Candidate {
            path: path.into(),
            score: 1.0,
            reasons: vec![],
            contributions: BTreeMap::new(),
            evidence: vec![],
            reserved: false,
        })
        .collect();
    for profile in ["approx", "o200k_base"] {
        let tokenizer = Tokenizer::new(profile).unwrap();
        let opts = options("session cookie authentication");
        let resolution = resolver::resolve_indexed(root, &db, &opts).unwrap();
        let selected = snippets::select(
            root,
            &db,
            &resolution,
            &candidates,
            300,
            "",
            2000,
            &tokenizer,
        )
        .unwrap();
        let test_tokens: usize = selected
            .excerpts
            .iter()
            .filter(|e| discovery::is_test(&e.path))
            .map(|e| tokenizer.count(&e.content))
            .sum();
        assert!(
            selected
                .excerpts
                .iter()
                .any(|e| discovery::is_test(&e.path))
        );
        assert!(
            test_tokens <= 500,
            "{profile}: tests consumed {test_tokens}/2000 tokens"
        );
        let focused = PackOptions {
            focus: vec!["testing".into()],
            ..opts
        };
        let resolution = resolver::resolve_indexed(root, &db, &focused).unwrap();
        let selected = snippets::select(
            root,
            &db,
            &resolution,
            &candidates,
            300,
            "",
            2000,
            &tokenizer,
        )
        .unwrap();
        let focused_tokens: usize = selected
            .excerpts
            .iter()
            .filter(|e| discovery::is_test(&e.path))
            .map(|e| tokenizer.count(&e.content))
            .sum();
        assert!(
            focused_tokens > test_tokens + 300,
            "{profile}: focus {focused_tokens}, general {test_tokens}"
        );
        let borrowers = [
            Candidate {
                path: "src/tiny.js".into(),
                ..candidates[0].clone()
            },
            candidates[2].clone(),
        ];
        let resolution =
            resolver::resolve_indexed(root, &db, &options("session cookie authentication"))
                .unwrap();
        let selection = snippets::select(
            root,
            &db,
            &resolution,
            &borrowers,
            300,
            "",
            2000,
            &tokenizer,
        )
        .unwrap();
        let borrowed: usize = selection
            .excerpts
            .iter()
            .filter(|e| discovery::is_test(&e.path))
            .map(|e| tokenizer.count(&e.content))
            .sum();
        assert!(
            borrowed > 600,
            "{profile}: unused implementation capacity was not released ({borrowed})"
        );
    }
}

#[test]
fn counterpart_tests_add_distinct_query_coverage_instead_of_repeating_a_behavior() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "Cargo.toml",
        "[package]\nname='sample'\nversion='1.0.0'\nedition='2024'\n",
    );
    for (source, name) in [
        ("cookie", "cookie"),
        ("session", "session"),
        ("extra_cookie", "cookie_extra"),
    ] {
        write(
            root,
            &format!("src/{source}.rs"),
            &format!("pub fn {name}() {{}}\n"),
        );
        write(
            root,
            &format!("tests/{source}_test.rs"),
            &format!("#[test]\nfn checks_{name}() {{assert!(true);}}\n"),
        );
    }
    write(
        root,
        "src/extra_cookie.rs",
        "pub fn cookie_extra() {} // shared_helper is only an illustrative identifier
",
    );
    write(
        root,
        "tests/extra_cookie_test.rs",
        "#[test]
fn checks_cookie_extra() { assert!(true); }
fn shared_helper() {}
",
    );
    let db = indexed(root);
    let opts = PackOptions {
        max_files: 15,
        ..options("cookie session")
    };
    let resolution = resolver::resolve_indexed(root, &db, &opts).unwrap();
    let selected = discovery::discover(root, &db, &resolution, &opts, 2).unwrap();
    assert!(
        selected.iter().any(|c| c.path == "tests/cookie_test.rs"),
        "{selected:?}"
    );
    assert!(
        selected.iter().any(|c| c.path == "tests/session_test.rs"),
        "{selected:?}"
    );
    assert!(
        !selected
            .iter()
            .any(|c| c.path == "tests/extra_cookie_test.rs"),
        "{selected:?}"
    );
    let opts = PackOptions {
        focus: vec!["testing".into()],
        ..opts
    };
    let resolution = resolver::resolve_indexed(root, &db, &opts).unwrap();
    assert!(
        discovery::discover(root, &db, &resolution, &opts, 2)
            .unwrap()
            .iter()
            .any(|c| c.path == "tests/extra_cookie_test.rs")
    );
}

#[test]
fn incremental_updates_refresh_old_excerpt_policies_even_when_sources_are_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "src/cookie.ts",
        "export function cookie() { return true; }\n",
    );
    let db = indexed(root);
    let config = Config::default();
    let options = options("cookie");
    let resolution = resolver::resolve_indexed(root, &db, &options).unwrap();
    let candidates = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
    let first = context::pack::compose_with_options(
        root,
        &db,
        &resolution,
        &candidates,
        &config,
        &options,
        None,
    )
    .unwrap();
    let mut legacy = serde_json::to_value(&first.manifest).unwrap();
    legacy
        .as_object_mut()
        .unwrap()
        .remove("excerptStrategyVersion");
    let legacy: context::pack::Manifest = serde_json::from_value(legacy).unwrap();
    let refreshed = context::pack::compose_with_options(
        root,
        &db,
        &resolution,
        &candidates,
        &config,
        &options,
        Some(&legacy),
    )
    .unwrap();
    assert_eq!(
        refreshed.manifest.changes.as_ref().unwrap().changed,
        ["src/cookie.ts"]
    );
    assert!(refreshed.manifest.files[0].excerpt_range.is_some());
    let current = context::pack::compose_with_options(
        root,
        &db,
        &resolution,
        &candidates,
        &config,
        &options,
        Some(&refreshed.manifest),
    )
    .unwrap();
    assert_eq!(
        current.manifest.changes.as_ref().unwrap().unchanged,
        ["src/cookie.ts"]
    );
    assert!(
        current
            .manifest
            .changes
            .as_ref()
            .unwrap()
            .changed
            .is_empty()
    );
}
