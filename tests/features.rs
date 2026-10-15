use context::{
    config::{self, Config},
    database::Database,
    discovery, evaluation,
    model::PackOptions,
    pack, query, resolver,
    tokens::Tokenizer,
};
use serde_json::{Value, json};
use std::{fs, path::Path, process::Command};

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}
fn project(files: &[(&str, &str)]) -> tempfile::TempDir {
    let directory = tempfile::Builder::new()
        .prefix("context-features-")
        .tempdir()
        .unwrap();
    for (path, text) in files {
        write(directory.path(), path, text);
    }
    directory
}
fn compose(
    root: &Path,
    config: &Config,
    options: &PackOptions,
    parent: Option<&pack::Manifest>,
) -> pack::PackResult {
    let mut database = Database::open(root).unwrap();
    context::indexer::index(root, &mut database, config, true).unwrap();
    let resolution = resolver::resolve(root, options).unwrap();
    let candidates =
        discovery::discover(root, &database, &resolution, options, config.graph_depth).unwrap();
    pack::compose_with_options(
        root,
        &database,
        &resolution,
        &candidates,
        config,
        options,
        parent,
    )
    .unwrap()
}
fn options(task: &str) -> PackOptions {
    PackOptions {
        task: Some(task.into()),
        ..Default::default()
    }
}
fn cli(root: &Path, args: &[&str]) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_context"))
        .arg("--root")
        .arg(root)
        .args(args)
        .env_remove("CONTEXT_MAX_FILES")
        .env_remove("CONTEXT_VERBOSE")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn task_words_find_complete_functions_far_below_the_file_header() {
    let source = format!(
        "use crate::currency::Amount;\n{}\npub fn check_payment(amount: Amount) -> bool {{\n    // payment validation rejects negative totals\n    amount.total > 0\n}}\n{}\npub fn render_logo() {{}}\n",
        "// unrelated layout notes\n".repeat(500),
        "// unrelated footer\n".repeat(500)
    );
    let project = project(&[("billing.rs", &source)]);
    let result = compose(
        project.path(),
        &Config::default(),
        &options("Fix payment validation for negative totals"),
        None,
    );
    let prompt = fs::read_to_string(result.directory.join("PACK.md")).unwrap();
    assert!(prompt.contains("pub fn check_payment(amount: Amount) -> bool {\n"));
    assert!(prompt.contains("amount.total > 0\n}"));
    assert!(prompt.contains("use crate::currency::Amount;"));
    assert!(!prompt.contains("render_logo"));
    assert!(
        result.manifest.files[0]
            .excerpt_ranges
            .iter()
            .any(|r| r.start > 490)
    );
}

#[test]
fn multiple_functions_are_kept_without_overlapping_or_filler_ranges() {
    let source = format!(
        "export function calculateTax() {{\n  return 12;\n}}\n{}\nexport function refundPayment() {{\n  return true;\n}}\n",
        "// irrelevant padding\n".repeat(600)
    );
    let directory = project(&[("payments.ts", &source)]);
    let config = Config {
        max_lines_per_file: 30,
        ..Default::default()
    };
    let result = compose(
        directory.path(),
        &config,
        &options("Fix calculateTax and refundPayment"),
        None,
    );
    let ranges = &result.manifest.files[0].excerpt_ranges;
    assert!(ranges.len() >= 2, "{ranges:?}");
    assert!(ranges.windows(2).all(|pair| pair[0].end < pair[1].start));
    assert!(ranges.iter().map(|r| r.end - r.start + 1).sum::<usize>() <= 30);
    let prompt = fs::read_to_string(result.directory.join("PACK.md")).unwrap();
    assert!(prompt.contains("return 12;\n}"));
    assert!(prompt.contains("return true;\n}"));
    assert!(!prompt.contains("irrelevant padding"));
    assert!(
        fs::read_dir(result.directory.join("excerpts"))
            .unwrap()
            .count()
            >= 2
    );
}

#[test]
fn budgets_are_balanced_and_bpe_counts_cover_the_complete_prompt() {
    let source = format!(
        "export function paymentValidation() {{\n{}\nreturn true;\n}}",
        "console.log('pagamento 日本語 <|endoftext|>');\n".repeat(500)
    );
    let directory = project(&[
        ("billing.ts", &source),
        ("checkout.ts", &source),
        ("payment.ts", &source),
    ]);
    for profile in ["approx", "cl100k_base", "o200k_base"] {
        let config = Config {
            tokenizer: profile.into(),
            ..Default::default()
        };
        let options = PackOptions {
            budget_tokens: 1800,
            ..options("Fix paymentValidation")
        };
        let result = compose(directory.path(), &config, &options, None);
        let prompt = fs::read_to_string(result.directory.join("PACK.md")).unwrap();
        assert_eq!(
            Tokenizer::new(profile).unwrap().count(&prompt),
            result.manifest.budget_tokens
        );
        assert!(result.manifest.budget_tokens <= 1800);
        assert_eq!(result.manifest.files.len(), 3);
        assert!(
            result
                .manifest
                .files
                .iter()
                .all(|file| !file.excerpt_ranges.is_empty()),
            "{profile}"
        );
    }
    assert!(Tokenizer::new("unknown").is_err());
}

#[test]
fn imports_follow_inheritance_nested_scopes_exports_and_rust_crate_roots() {
    let directory = project(&[
        (
            "tsconfig.base.json",
            r#"{"compilerOptions":{"baseUrl":".","paths":{"@shared/*":["shared/*"]}}}"#,
        ),
        (
            "apps/a/tsconfig.json",
            r#"{"extends":"../../tsconfig.base","references":[{"path":"../b"}]}"#,
        ),
        (
            "apps/b/tsconfig.json",
            r#"{"compilerOptions":{"baseUrl":".","paths":{"@shared/*":["src/*"]}}}"#,
        ),
        (
            "apps/a/index.ts",
            "import { shared } from '@shared/tool'; import { api } from '@local/api'; import { helper } from '@local/api/helper';",
        ),
        ("apps/b/index.ts", "import { local } from '@shared/tool';"),
        ("shared/tool.ts", "export const shared = 1;"),
        ("apps/b/src/tool.ts", "export const local = 2;"),
        (
            "packages/api/package.json",
            r#"{"name":"@local/api","exports":{".":{"types":"./src/index.ts"},"./*":"./src/*.ts"}}"#,
        ),
        ("packages/api/src/index.ts", "export const api=1;"),
        ("packages/api/src/helper.ts", "export const helper=1;"),
        (
            "crates/a/Cargo.toml",
            "[package]\nname='alpha'\nversion='0.1.0'\n",
        ),
        (
            "crates/a/src/lib.rs",
            "pub mod inner; use crate::inner::payment; use beta::check;",
        ),
        ("crates/a/src/inner.rs", "pub fn payment() {}"),
        (
            "crates/b/Cargo.toml",
            "[package]\nname='beta'\nversion='0.1.0'\n",
        ),
        ("crates/b/src/lib.rs", "pub fn check() {}"),
    ]);
    let (_, db) = query::prepare(directory.path(), false).unwrap();
    let edges = db.imports().unwrap();
    for (source, target) in [
        ("apps/a/index.ts", "shared/tool.ts"),
        ("apps/b/index.ts", "apps/b/src/tool.ts"),
        ("apps/a/index.ts", "packages/api/src/index.ts"),
        ("apps/a/index.ts", "packages/api/src/helper.ts"),
        ("crates/a/src/lib.rs", "crates/a/src/inner.rs"),
        ("crates/a/src/lib.rs", "crates/b/src/lib.rs"),
    ] {
        assert!(
            edges
                .iter()
                .any(|e| e.source_path == source && e.target_path == target),
            "missing {source} -> {target}: {edges:?}"
        );
    }
    assert!(
        !edges
            .iter()
            .any(|e| e.source_path == "apps/b/index.ts" && e.target_path == "shared/tool.ts")
    );
    write(
        directory.path(),
        "apps/b/tsconfig.json",
        r#"{"compilerOptions":{"baseUrl":"../../","paths":{"@shared/*":["shared/*"]}}}"#,
    );
    let (_, db) = query::prepare(directory.path(), false).unwrap();
    assert!(
        db.imports()
            .unwrap()
            .iter()
            .any(|e| e.source_path == "apps/b/index.ts" && e.target_path == "shared/tool.ts")
    );
}

#[test]
fn project_resolution_rejects_cycles_and_unexported_package_subpaths() {
    let directory = project(&[
        ("tsconfig.json", r#"{"extends":"./tsconfig.json"}"#),
        ("index.ts", "export const value=1;"),
    ]);
    assert!(
        query::prepare(directory.path(), false)
            .err()
            .unwrap()
            .to_string()
            .contains("Cyclic")
    );
    fs::remove_file(directory.path().join("tsconfig.json")).unwrap();
    write(
        directory.path(),
        "package.json",
        r#"{"name":"@local/locked","exports":{".":"./index.ts"}}"#,
    );
    write(directory.path(), "secret.ts", "export const secret=1;");
    write(
        directory.path(),
        "consumer.ts",
        "import '@local/locked/secret';",
    );
    let (_, db) = query::prepare(directory.path(), false).unwrap();
    assert!(
        !db.imports()
            .unwrap()
            .iter()
            .any(|e| e.source_path == "consumer.ts" && e.target_path == "secret.ts")
    );
}

#[test]
fn explicit_laravel_and_statamic_links_join_routes_classes_views_and_blueprints() {
    let directory = project(&[
        (
            "composer.json",
            r#"{"require":{"statamic/cms":"*"},"autoload":{"psr-4":{"App\\":"app/"}},"autoload-dev":{"psr-4":{"Tests\\":"tests/"}}}"#,
        ),
        (
            "routes/web.php",
            "<?php use App\\Http\\Controllers\\PaymentController; Route::get('/pay', [PaymentController::class, 'show']);",
        ),
        (
            "app/Http/Controllers/PaymentController.php",
            "<?php namespace App\\Http\\Controllers; class PaymentController { public function show() { return view('payments.show'); } }",
        ),
        (
            "resources/views/payments/show.blade.php",
            "@extends('layouts.app')\n@include('payments.form')",
        ),
        (
            "resources/views/layouts/app.blade.php",
            "<main>@yield('content')</main>",
        ),
        (
            "resources/views/payments/form.blade.php",
            "<form>payment</form>",
        ),
        (
            "content/collections/payments.yaml",
            "template: payments/show\nblueprint: payment\n",
        ),
        (
            "resources/views/payments/show.antlers.html",
            "{{ partial:payments/form }}",
        ),
        (
            "resources/views/payments/form.antlers.html",
            "<form>pay</form>",
        ),
        (
            "resources/blueprints/collections/payments/payment.yaml",
            "title: Payment",
        ),
    ]);
    let (_, db) = query::prepare(directory.path(), false).unwrap();
    let edges = db.imports().unwrap();
    for (source, target) in [
        (
            "routes/web.php",
            "app/Http/Controllers/PaymentController.php",
        ),
        (
            "app/Http/Controllers/PaymentController.php",
            "resources/views/payments/show.blade.php",
        ),
        (
            "resources/views/payments/show.blade.php",
            "resources/views/layouts/app.blade.php",
        ),
        (
            "content/collections/payments.yaml",
            "resources/views/payments/show.antlers.html",
        ),
        (
            "content/collections/payments.yaml",
            "resources/blueprints/collections/payments/payment.yaml",
        ),
    ] {
        assert!(
            edges
                .iter()
                .any(|e| e.source_path == source && e.target_path == target),
            "missing {source} -> {target}: {edges:?}"
        );
    }
}

#[test]
fn search_and_explain_share_selection_and_return_numerical_evidence() {
    let directory = project(&[
        (
            "src/payment.ts",
            "export function processPayment() { return true; }",
        ),
        ("unrelated.ts", "export function weather() {}"),
    ]);
    let result = cli(directory.path(), &["search", "processPayment", "--json"]);
    assert_eq!(result["hits"][0]["path"], "src/payment.ts");
    assert!(
        result["hits"][0]["excerpts"][0]["content"]
            .as_str()
            .unwrap()
            .contains("processPayment")
    );
    let result = cli(
        directory.path(),
        &[
            "explain",
            "src/payment.ts",
            "--task",
            "Fix processPayment",
            "--json",
        ],
    );
    assert_eq!(result["selected"], true);
    let total: f64 = result["contributions"]
        .as_object()
        .unwrap()
        .values()
        .map(|v| v.as_f64().unwrap())
        .sum();
    assert!((total - result["score"].as_f64().unwrap()).abs() < 1e-10);
    let result = cli(
        directory.path(),
        &[
            "explain",
            "src/payment.ts",
            "--task",
            "Fix processPayment",
            "--exclude",
            "src/",
            "--json",
        ],
    );
    assert_eq!(result["selected"], false);
    assert_eq!(result["status"], "excluded_by_pattern");
}

#[test]
fn incremental_updates_keep_unchanged_context_and_report_removed_dependencies() {
    let directory = project(&[
        (
            "payment.ts",
            "import {validate} from './validate';\nexport function processPayment() { return validate(); }",
        ),
        ("validate.ts", "export function validate() { return true; }"),
    ]);
    let root = directory.path();
    let config = Config::default();
    let options = options("Fix processPayment validation");
    let first = compose(root, &config, &options, None);
    let unchanged = compose(root, &config, &options, Some(&first.manifest));
    assert!(
        unchanged
            .manifest
            .changes
            .as_ref()
            .unwrap()
            .changed
            .is_empty()
    );
    assert!(
        unchanged
            .manifest
            .changes
            .as_ref()
            .unwrap()
            .unchanged
            .contains(&"payment.ts".into())
    );
    assert!(
        !fs::read_to_string(unchanged.directory.join("PACK.md"))
            .unwrap()
            .contains("return validate();")
    );
    write(
        root,
        "validate.ts",
        "export function validate() { return false; }",
    );
    let update = compose(root, &config, &options, Some(&unchanged.manifest));
    assert_eq!(
        update.manifest.changes.as_ref().unwrap().changed,
        vec!["validate.ts"]
    );
    let prompt = fs::read_to_string(update.directory.join("PACK.md")).unwrap();
    assert!(prompt.contains("return false;"));
    assert!(!prompt.contains("return validate();"));
    assert_eq!(
        update.manifest.parent_pack.as_deref(),
        Some(unchanged.manifest.slug.as_str())
    );
    write(
        root,
        "payment.ts",
        "import {authorize} from './authorize';\nexport function processPayment() { return authorize(); }",
    );
    write(
        root,
        "authorize.ts",
        "export function authorize() { return true; }",
    );
    fs::remove_file(root.join("validate.ts")).unwrap();
    let update = compose(root, &config, &options, Some(&update.manifest));
    let changes = update.manifest.changes.as_ref().unwrap();
    assert!(changes.added.contains(&"authorize.ts".into()));
    assert!(changes.removed.contains(&"validate.ts".into()));
    assert!(
        changes
            .stale_references
            .iter()
            .any(|e| e.target_path == "validate.ts")
    );
    assert!(update.directory.join("UPDATE.md").is_file());
    let result = cli(root, &["pack", "--update", "latest", "--json"]);
    assert_eq!(result["parentPack"], update.manifest.slug);
}

#[test]
fn old_manifests_remain_readable_and_updates_without_hashes_refresh_all_files() {
    let directory = project(&[("payment.ts", "export function payment() { return true; }")]);
    let root = directory.path();
    let result = compose(root, &Config::default(), &options("Fix payment"), None);
    let mut value = serde_json::to_value(result.manifest).unwrap();
    for key in [
        "tokenizer",
        "options",
        "config",
        "parentPack",
        "changes",
        "relationships",
    ] {
        value.as_object_mut().unwrap().remove(key);
    }
    for file in value["files"].as_array_mut().unwrap() {
        for key in ["sourceHash", "excerptRanges"] {
            file.as_object_mut().unwrap().remove(key);
        }
    }
    let legacy: pack::Manifest = serde_json::from_value(value).unwrap();
    assert_eq!(legacy.tokenizer, "approx");
    let update = compose(
        root,
        &Config::default(),
        &options("Fix payment"),
        Some(&legacy),
    );
    assert_eq!(update.manifest.changes.unwrap().changed, vec!["payment.ts"]);
    assert!(pack::load(root, "../escape").is_err());
}

#[test]
fn evaluation_measures_quality_splits_baselines_and_preserves_projects() {
    let directory = project(&[
        (
            "app/payment.ts",
            "export function processPayment() { return true; }",
        ),
        ("app/noise.ts", "export const weather=1;"),
    ]);
    let dataset:evaluation::Dataset=serde_json::from_value(json!({"cases":[
        {"name":"payment held out","root":"app","split":"eval","task":"Fix processPayment","expectedFiles":["payment.ts"],"forbiddenFiles":["noise.ts"],"expectedRanges":[{"path":"payment.ts","start":1,"end":1}]},
        {"name":"calibration","root":"app","split":"train","task":"weather","expectedFiles":["noise.ts"]}
    ]})).unwrap();
    let mut report =
        evaluation::evaluate(&dataset, directory.path(), &Config::default(), "eval").unwrap();
    assert_eq!(report.cases.len(), 1);
    assert_eq!(report.summary.recall, 1.0);
    assert_eq!(report.summary.range_coverage, Some(1.0));
    assert_eq!(report.summary.forbidden_matches, 0);
    assert!(!directory.path().join("app/.context").exists());
    assert!(!directory.path().join("app/.ctxignore").exists());
    let baseline = serde_json::from_value(serde_json::to_value(&report).unwrap()).unwrap();
    evaluation::compare(&mut report, &baseline).unwrap();
    assert_eq!(report.comparison.as_ref().unwrap()["recallDelta"], 0.0);
    let training =
        evaluation::evaluate(&dataset, directory.path(), &Config::default(), "train").unwrap();
    assert!(evaluation::compare(&mut report, &training).is_err());
    config::write_json(&directory.path().join("dataset.json"), &dataset).unwrap();
    let result = cli(
        directory.path(),
        &["evaluate", "dataset.json", "--min-recall", "1", "--json"],
    );
    assert_eq!(result["summary"]["recall"], 1.0);
}

#[test]
fn project_metadata_still_resolves_imports_when_json_is_not_an_indexed_language() {
    let directory = project(&[
        (
            "apps/web/tsconfig.json",
            r#"{"compilerOptions":{"paths":{"@app/*":["src/*"]}}}"#,
        ),
        ("apps/web/index.ts", "import {payment} from '@app/payment';"),
        ("apps/web/src/payment.ts", "export const payment=1;"),
    ]);
    let mut database = Database::open(directory.path()).unwrap();
    let config = Config {
        include_languages: vec!["typescript".into()],
        ..Default::default()
    };
    context::indexer::index(directory.path(), &mut database, &config, false).unwrap();
    assert_eq!(database.files().unwrap().len(), 2);
    assert!(database.imports().unwrap().iter().any(
        |e| e.source_path == "apps/web/index.ts" && e.target_path == "apps/web/src/payment.ts"
    ));
}

#[test]
fn update_refreshes_a_file_whose_previous_excerpt_was_omitted() {
    let directory = project(&[("payment.ts", "export function payment() { return 42; }")]);
    let config = Config::default();
    let options = options("Fix payment");
    let mut parent = compose(directory.path(), &config, &options, None).manifest;
    parent.files[0].excerpt_range = None;
    parent.files[0].excerpt_ranges.clear();
    let update = compose(directory.path(), &config, &options, Some(&parent));
    assert_eq!(
        update.manifest.changes.as_ref().unwrap().changed,
        vec!["payment.ts"]
    );
    assert!(
        fs::read_to_string(update.directory.join("PACK.md"))
            .unwrap()
            .contains("return 42;")
    );
}

#[test]
fn historical_evaluation_uses_the_pinned_commit_and_detects_changed_snapshots() {
    let directory = project(&[("payment.ts", "export function payment() { return 42; }")]);
    let root = directory.path();
    let git = |args: &[&str]| {
        let result = Command::new("git")
            .arg("-C")
            .arg(root)
            .args([
                "-c",
                "commit.gpgsign=false",
                "-c",
                "core.hooksPath=disabled-hooks",
                "-c",
                "user.name=Context Tests",
                "-c",
                "user.email=tests@example.invalid",
            ])
            .args(args)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        String::from_utf8(result.stdout).unwrap().trim().to_owned()
    };
    git(&["init", "--template=", "--initial-branch=main", "-q"]);
    git(&["add", "."]);
    git(&["commit", "-qm", "Payment baseline"]);
    let revision = git(&["rev-parse", "HEAD"]);
    let dataset:evaluation::Dataset=serde_json::from_value(json!({"cases":[{"name":"historical payment","root":".","revision":revision,"task":"Fix payment","expectedFiles":["payment.ts"],"expectedRanges":[{"path":"payment.ts","start":1,"end":1}]}]})).unwrap();
    write(root, "payment.ts", "export function weather() {}");
    let report = evaluation::evaluate(&dataset, root, &Config::default(), "eval").unwrap();
    assert_eq!(report.summary.range_coverage, Some(1.0));
    assert_eq!(
        report.cases[0].source_revision.as_deref(),
        Some(revision.as_str())
    );
    assert!(
        fs::read_to_string(root.join("payment.ts"))
            .unwrap()
            .contains("weather")
    );
    assert!(!root.join(".context").exists());
}

#[cfg(unix)]
#[test]
fn saved_pack_resources_cannot_follow_symlinks_outside_the_pack() {
    let directory = project(&[("payment.ts", "export function payment() {}")]);
    let result = compose(
        directory.path(),
        &Config::default(),
        &options("payment"),
        None,
    );
    let private = project(&[("private.txt", "private data")]);
    fs::remove_file(result.directory.join("PACK.md")).unwrap();
    std::os::unix::fs::symlink(
        private.path().join("private.txt"),
        result.directory.join("PACK.md"),
    )
    .unwrap();
    assert!(pack::read_prompt(directory.path(), &result.directory).is_err());
}
