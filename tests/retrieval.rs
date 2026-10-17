use context::{
    config::{self, Config},
    database::Database,
    discovery, indexer,
    model::{Candidate, PackOptions},
    pack, query, resolver, snippets,
    tokens::Tokenizer,
};
use std::{collections::BTreeMap, fs, path::Path};

fn write(root: &Path, path: &str, content: &str) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    for (path, content) in files {
        write(directory.path(), path, content);
    }
    directory
}

fn options(task: &str) -> PackOptions {
    PackOptions {
        task: Some(task.into()),
        ..Default::default()
    }
}

fn indexed(root: &Path) -> Database {
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    db
}

#[test]
fn natural_language_matches_do_not_reserve_symbols_in_any_language() {
    let directory = project(&[
        (
            "short.ts",
            "export function il() {}\nexport function at() {}\nexport function next() {}",
        ),
        (
            "login.ts",
            "export function login() { return 'authentication'; }",
        ),
    ]);
    let root = directory.path();
    let db = indexed(root);
    for text in [
        "Non funziona il login",
        "Login fails at startup",
        "Login fails next time",
        "API login fails AT startup",
    ] {
        let options = options(text);
        let resolution = resolver::resolve(root, &options).unwrap();
        let results = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
        assert!(
            results.iter().all(|file| !file.reserved),
            "{text}: {results:?}"
        );
        assert_eq!(results[0].path, "login.ts", "{text}");
    }
    for text in ["Inspect @at", "Inspect `at`", "Inspect at()", "Inspect `i`"] {
        let resolution = resolver::resolve(root, &options(text)).unwrap();
        let expected = if text.ends_with("`i`") { "i" } else { "at" };
        assert!(resolution.task.symbols.contains(&expected.into()), "{text}");
    }
    let references = resolver::resolve(
        root,
        &options("Inspect @src/login.ts and contact user@example.org"),
    )
    .unwrap();
    assert!(
        !references
            .task
            .symbols
            .iter()
            .any(|name| matches!(name.as_str(), "src" | "example"))
    );
    let options = PackOptions {
        symbol: Some("at".into()),
        ..options("Inspect behavior")
    };
    let resolution = resolver::resolve(root, &options).unwrap();
    assert!(
        discovery::discover(root, &db, &resolution, &options, 2)
            .unwrap()
            .iter()
            .any(|c| c.path == "short.ts" && c.reserved)
    );
}

#[test]
fn ubiquitous_symbol_terms_have_less_weight_than_rare_terms() {
    let directory = project(&[("rare.ts", "export function checkout() {}")]);
    for i in 0..8 {
        write(
            directory.path(),
            &format!("common{i}.ts"),
            "export function stage() {}",
        );
    }
    let db = indexed(directory.path());
    let options = options("checkout stage");
    let resolution = resolver::resolve(directory.path(), &options).unwrap();
    let results = discovery::discover(directory.path(), &db, &resolution, &options, 0).unwrap();
    let contribution = |path| {
        results
            .iter()
            .find(|c| c.path == path)
            .unwrap()
            .contributions["contains matching symbol"]
    };
    assert!(contribution("rare.ts") > contribution("common0.ts"));
    assert!(results.iter().all(|c| !c.reserved));
}

#[test]
fn test_heavy_search_keeps_implementation_context_unless_testing_is_requested() {
    let directory = project(&[]);
    for i in 0..20 {
        write(
            directory.path(),
            &format!("tests/auth/login{i}.ts"),
            "export function login() { return 'authentication login'; }",
        );
        write(
            directory.path(),
            &format!("src/auth/module{i}.ts"),
            "export function authenticate() { return 'authentication'; }",
        );
    }
    let db = indexed(directory.path());
    let options = PackOptions {
        max_files: 12,
        ..options("login")
    };
    let resolution = resolver::resolve_indexed(directory.path(), &db, &options).unwrap();
    let results = discovery::discover(directory.path(), &db, &resolution, &options, 2).unwrap();
    assert!(results.len() <= 12);
    assert!(
        results
            .iter()
            .any(|candidate| !discovery::is_test(&candidate.path))
    );
    assert!(
        results
            .iter()
            .filter(|candidate| discovery::is_test(&candidate.path))
            .count()
            <= 2
    );
    let testing = PackOptions {
        focus: vec!["testing".into()],
        ..options
    };
    let resolution = resolver::resolve_indexed(directory.path(), &db, &testing).unwrap();
    let focused = discovery::discover(directory.path(), &db, &resolution, &testing, 2).unwrap();
    assert!(
        focused
            .iter()
            .any(|candidate| discovery::is_test(&candidate.path))
    );
    assert!(focused.len() <= 12);
}

#[test]
fn a_long_line_cannot_consume_other_files_excerpt_budgets() {
    let huge = format!("export const payment = '{}';", "x".repeat(18_000));
    let useful = format!("export const payment = '{}';", "x".repeat(7_000));
    let directory = project(&[
        ("a.ts", &huge),
        ("b.ts", &useful),
        ("c.ts", &useful),
        ("d.ts", &useful),
    ]);
    let db = indexed(directory.path());
    let resolution = resolver::resolve(directory.path(), &options("payment")).unwrap();
    let candidates: Vec<_> = ["a.ts", "b.ts", "c.ts", "d.ts"]
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
    for profile in ["approx", "cl100k_base", "o200k_base"] {
        let tokenizer = Tokenizer::new(profile).unwrap();
        let budget = tokenizer.count(&huge) * 4 / 3;
        let result = snippets::select(
            directory.path(),
            &db,
            &resolution,
            &candidates,
            300,
            "",
            budget,
            &tokenizer,
        )
        .unwrap();
        assert_eq!(
            result.omitted.get("a.ts").map(String::as_str),
            Some("oversized_line")
        );
        assert_eq!(result.excerpts.len(), 3);
        assert!(result.excerpts.iter().all(|excerpt| excerpt.path != "a.ts"));
        let single = snippets::select(
            directory.path(),
            &db,
            &resolution,
            &candidates[..1],
            300,
            "",
            budget,
            &tokenizer,
        )
        .unwrap();
        assert_eq!(single.excerpts.len(), 1);
    }
}

#[test]
fn generated_assets_are_penalized_but_remain_explicitly_accessible() {
    let bundle = format!(
        "// @generated\nexport function login() {{ {} }}",
        "var at=1;".repeat(500)
    );
    let directory = project(&[
        ("chart.js", &bundle),
        ("auth.ts", "export function login() { return 'session'; }"),
    ]);
    let root = directory.path();
    let db = indexed(root);
    let options = PackOptions {
        max_files: 1,
        ..options("login")
    };
    let resolution = resolver::resolve(root, &options).unwrap();
    assert_eq!(
        discovery::discover(root, &db, &resolution, &options, 0).unwrap()[0].path,
        "auth.ts"
    );
    let explanation = query::explain(root, &db, &Config::default(), "chart.js", &options).unwrap();
    assert!(explanation.contributions["generated or minified asset penalty"] < 0.0);
    let explicit = PackOptions {
        file: Some("chart.js".into()),
        ..options
    };
    let resolution = resolver::resolve(root, &explicit).unwrap();
    assert_eq!(
        discovery::discover(root, &db, &resolution, &explicit, 0).unwrap()[0].path,
        "chart.js"
    );
    drop(db);
    let reopened = indexed(root);
    let explanation =
        query::explain(root, &reopened, &Config::default(), "chart.js", &explicit).unwrap();
    assert!(explanation.selected);
    assert!(reopened.generated_files().unwrap().contains("chart.js"));
    drop(reopened);
    write(
        root,
        "chart.js",
        "export function login() { return 'handwritten'; }",
    );
    assert!(
        !indexed(root)
            .generated_files()
            .unwrap()
            .contains("chart.js")
    );
}

#[test]
fn framework_metadata_survives_language_filters_reopens_and_manifest_changes() {
    let directory = project(&[
        (
            "apps/server/composer.json",
            r#"{"require-dev":{"laravel/framework":"*"}}"#,
        ),
        ("apps/server/code.rs", "fn source() {}"),
        (
            "ignored/composer.json",
            r#"{"require":{"statamic/cms":"*"}}"#,
        ),
        (".ctxignore", "ignored/\n"),
    ]);
    let root = directory.path();
    let config = Config {
        include_languages: vec!["rust".into()],
        ..Default::default()
    };
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &config, false).unwrap();
    assert!(
        !db.files()
            .unwrap()
            .contains_key("apps/server/composer.json")
    );
    drop(db);
    let mut db = Database::open(root).unwrap();
    let resolution = resolver::resolve_indexed(root, &db, &options("Fix blade view")).unwrap();
    assert!(resolution.task.domains.contains(&"blade".into()));
    assert!(
        !config::detect_frameworks(root)
            .unwrap()
            .contains(&"statamic".into())
    );
    write(root, "apps/server/composer.json", "{}");
    indexer::index(root, &mut db, &config, false).unwrap();
    assert!(
        !resolver::resolve_indexed(root, &db, &options("Fix blade view"))
            .unwrap()
            .task
            .domains
            .contains(&"blade".into())
    );
}

#[test]
fn framework_relationship_boosts_do_not_cross_package_boundaries() {
    let directory = project(&[
        ("apps/a/package.json", "{}"),
        ("apps/a/PaymentService.ts", "export class PaymentService {}"),
        (
            "apps/a/PaymentController.ts",
            "export class PaymentController {}",
        ),
        ("apps/b/package.json", "{}"),
        (
            "apps/b/PaymentController.ts",
            "export class PaymentController {}",
        ),
    ]);
    let db = indexed(directory.path());
    let options = PackOptions {
        file: Some("apps/a/PaymentService.ts".into()),
        ..options("Inspect behavior")
    };
    let resolution = resolver::resolve_indexed(directory.path(), &db, &options).unwrap();
    let results = discovery::rank(directory.path(), &db, &resolution, &options, 0).unwrap();
    assert!(results.iter().any(|c| {
        c.path == "apps/a/PaymentController.ts"
            && c.reasons
                .iter()
                .any(|reason| reason == "related framework file")
    }));
    assert!(!results.iter().any(|c| {
        c.path == "apps/b/PaymentController.ts"
            && c.reasons
                .iter()
                .any(|reason| reason == "related framework file")
    }));
}

#[test]
fn inertia_pages_link_to_backend_providers_within_their_composer_scope() {
    let directory = project(&[
        (
            "apps/a/composer.json",
            r#"{"require":{"laravel/framework":"*"}}"#,
        ),
        (
            "apps/a/app/Provider.php",
            "<?php Inertia::render('Auth/Login');",
        ),
        ("apps/a/routes/web.php", "<?php inertia('Auth/Login');"),
        (
            "apps/a/resources/js/pages/Auth/Login.tsx",
            "export function Login() { return <form>login</form>; }",
        ),
        (
            "apps/b/composer.json",
            r#"{"require":{"laravel/framework":"*"}}"#,
        ),
        (
            "apps/b/resources/js/pages/Auth/Login.tsx",
            "export function Login() { return <form>login</form>; }",
        ),
    ]);
    let db = indexed(directory.path());
    let imports = db.imports().unwrap();
    for source in ["apps/a/app/Provider.php", "apps/a/routes/web.php"] {
        assert!(imports.iter().any(|edge| edge.source_path == source
            && edge.target_path == "apps/a/resources/js/pages/Auth/Login.tsx"));
        assert!(
            !imports
                .iter()
                .any(|edge| edge.source_path == source && edge.target_path.starts_with("apps/b/"))
        );
    }
}

#[test]
fn direct_neighbors_of_explicit_references_obey_graph_depth() {
    let directory = project(&[
        (
            "entry.ts",
            "import value from './support'; export default value;",
        ),
        ("support.ts", "export default 1;"),
    ]);
    let db = indexed(directory.path());
    let options = PackOptions {
        file: Some("entry.ts".into()),
        ..options("Inspect behavior")
    };
    let resolution = resolver::resolve_indexed(directory.path(), &db, &options).unwrap();
    for depth in [0, 1] {
        let results =
            discovery::discover(directory.path(), &db, &resolution, &options, depth).unwrap();
        assert_eq!(
            results
                .iter()
                .any(|candidate| candidate.path == "support.ts"
                    && candidate
                        .reasons
                        .iter()
                        .any(|reason| reason
                            == "direct import relationship to an explicit reference")),
            depth == 1
        );
    }
}

#[test]
fn nested_framework_domains_and_ignore_rules_are_scoped() {
    let directory = project(&[
        ("Cargo.toml", "[workspace]\nmembers = ['apps/cli']"),
        (
            "apps/cli/Cargo.toml",
            "[package]\nname='client'\nversion='0.1.0'",
        ),
        ("apps/cli/src/main.rs", "fn main() {}"),
        (
            "apps/server/composer.json",
            r#"{"require":{"laravel/framework":"*","statamic/cms":"*"}}"#,
        ),
        ("apps/server/package.json", "{}"),
        ("apps/server/app/Auth.php", "<?php class Auth {}"),
        ("apps/server/public/vendor/chart.js", "function at() {}"),
        (
            "apps/server/storage/framework/cache.php",
            "<?php // generated",
        ),
        ("apps/server/users/admin.yaml", "secret: omitted"),
        ("apps/web/package.json", r#"{"dependencies":{"react":"*"}}"#),
        (
            "apps/web/public/storage/handwritten.ts",
            "export const source = 1;",
        ),
        (
            "apps/web/storage/framework/source.ts",
            "export const source = 1;",
        ),
        (
            "node_modules/fake/composer.json",
            r#"{"require":{"laravel/framework":"*"}}"#,
        ),
    ]);
    let root = directory.path();
    let domains = config::domains(root, false).unwrap();
    assert!(
        domains
            .iter()
            .any(|(source, domain, _)| source == "laravel" && domain.name == "blade")
    );
    assert!(
        domains
            .iter()
            .any(|(source, domain, _)| source == "nodejs" && domain.name == "react")
    );
    assert!(!root.join(".context").exists());
    config::initialize(root, false).unwrap();
    let patterns = fs::read_to_string(root.join(".ctxignore")).unwrap();
    assert!(patterns.contains("/apps/server/public/vendor/"));
    assert!(!patterns.lines().any(|line| line == "public/vendor/"));
    let db = indexed(root);
    let files = db.files().unwrap();
    for path in [
        "apps/server/public/vendor/chart.js",
        "apps/server/storage/framework/cache.php",
        "apps/server/users/admin.yaml",
    ] {
        assert!(!files.contains_key(path), "{path}");
    }
    assert!(files.contains_key("apps/web/public/storage/handwritten.ts"));
    assert!(files.contains_key("apps/web/storage/framework/source.ts"));
    let original = fs::read(root.join(".ctxignore")).unwrap();
    config::initialize(root, false).unwrap();
    assert_eq!(fs::read(root.join(".ctxignore")).unwrap(), original);
}

#[test]
fn ambiguous_login_keeps_web_cli_and_auth_configuration_context() {
    let directory = project(&[
        (
            "apps/server/composer.json",
            r#"{"require":{"laravel/framework":"*"}}"#,
        ),
        (
            "apps/server/app/Providers/FortifyServiceProvider.php",
            "<?php class FortifyServiceProvider { public function boot() { Fortify::authenticateUsing(fn($request) => Auth::attempt($request->only('email', 'password'))); } }",
        ),
        (
            "apps/server/config/auth.php",
            "<?php return ['guards' => ['web' => ['driver' => 'session']]];",
        ),
        (
            "apps/server/config/session.php",
            "<?php return ['driver' => 'database', 'cookie' => 'session'];",
        ),
        (
            "apps/server/resources/js/Login.tsx",
            "export function Login() { return <form>login password</form>; }",
        ),
        (
            "apps/cli/Cargo.toml",
            "[package]\nname='client'\nversion='0.1.0'",
        ),
        (
            "apps/cli/src/login.rs",
            "pub fn login() { authenticate_device(); }\nfn authenticate_device() {}",
        ),
    ]);
    for i in 0..10 {
        write(
            directory.path(),
            &format!("apps/cli/src/auth{i}.rs"),
            "pub fn login() { println!(\"CLI login\"); }",
        );
    }
    let root = directory.path();
    let db = indexed(root);
    for task in ["Non funziona il login", "Login fails at startup"] {
        let options = PackOptions {
            max_files: 8,
            ..options(task)
        };
        let resolution = resolver::resolve(root, &options).unwrap();
        let candidates = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
        let result = pack::compose_with_options(
            root,
            &db,
            &resolution,
            &candidates,
            &Config::default(),
            &options,
            None,
        )
        .unwrap();
        let included = |path: &str| {
            result
                .manifest
                .files
                .iter()
                .any(|file| file.path == path && !file.excerpt_ranges.is_empty())
        };
        assert!(
            included("apps/server/app/Providers/FortifyServiceProvider.php"),
            "{task}: {candidates:?}"
        );
        assert!(
            result
                .manifest
                .files
                .iter()
                .any(|file| file.path.starts_with("apps/cli/") && !file.excerpt_ranges.is_empty())
        );
        assert!(
            included("apps/server/config/auth.php") || included("apps/server/config/session.php"),
            "{task}: {candidates:?}; ranked: {:?}",
            discovery::rank(root, &db, &resolution, &options, 2).unwrap()
        );
    }
}
