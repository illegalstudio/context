use context::{
    config::Config, database::Database, discovery, indexer, model::PackOptions, parser, resolver,
    snippets, tokens::Tokenizer,
};
use std::{fs, path::Path};

fn write(root: &Path, name: &str, content: &str) {
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

#[test]
fn callback_titles_and_ranges_are_structural_test_cases() {
    for (path, source, expected) in [
        (
            "tests/Feature/IdentityTest.php",
            "<?php\ntest('login and logout use a session', function () {\n $this->post('/login')->assertRedirect('/home');\n $this->assertAuthenticated();\n});\n",
            "login and logout use a session",
        ),
        (
            "e2e/identity.spec.ts",
            "import { test as check } from '@playwright/test';\ncheck('login uses a session', async ({ page }) => {\n await page.goto('/login');\n expect(page.url()).toContain('/home');\n});\n",
            "login uses a session",
        ),
        (
            "test/redirect.js",
            "describe('redirects', () => {\n it.only('formats uppercase protocols', () => {\n  assert.equal(redirect('HTTP://example.test'), 'http://example.test');\n });\n});\n",
            "formats uppercase protocols",
        ),
        (
            "tests/serializer.test.ts",
            "import * as suite from 'vitest';\nsuite.test('preserves serializer values', () => {\n suite.expect(serialize(value)).toEqual(value);\n});\n",
            "preserves serializer values",
        ),
        (
            "tests/http.test.js",
            "const { test: check } = require('node:test');\ncheck('handles HTTP redirects', () => {\n assert.equal(status(), 302);\n});\n",
            "handles HTTP redirects",
        ),
        (
            "src/inline.ts",
            "import { test } from 'vitest';\ntest('handles inline checks', () => {\n expect(true).toBe(true);\n});\n",
            "handles inline checks",
        ),
    ] {
        let parsed = parser::parse(path, source, &mut tree_sitter::Parser::new()).unwrap();
        let case = parsed
            .symbols
            .iter()
            .find(|s| s.name == expected)
            .unwrap_or_else(|| panic!("missing callback case in {path}: {:?}", parsed.symbols));
        assert_eq!(case.kind, "test");
        assert!(case.is_test);
        let lines: Vec<_> = source.lines().collect();
        let body = lines[case.start_line - 1..case.end_line].join("\n");
        assert!(body.contains(expected));
        assert!(body.contains("assert") || body.contains("expect"));
    }
}

#[test]
fn callback_detection_rejects_dynamic_titles_comments_and_shadowed_apis() {
    for (path, source) in [
        (
            "tests/not_cases.js",
            "function test(name, callback) { callback(); }\ntest('login', () => { expect(true).toBe(true); });",
        ),
        (
            "tests/not_cases.ts",
            "import { test } from './custom-client';\ntest('login', () => { expect(true).toBe(true); });",
        ),
        (
            "tests/not_cases.php",
            "<?php function test($name, $callback) {}\ntest('login', function () { expect(true)->toBeTrue(); });",
        ),
        (
            "tests/not_cases.js",
            "// test('login', () => {});\nconst example = \"test('login', () => {})\";\nclient.test('login', () => {});\ntest(variable, () => {});\ntest(`login ${user}`, () => {});",
        ),
        ("tests/incomplete.test.js", "test(\"café"),
        (
            "src/client.js",
            "test('login', () => { expect(true).toBe(true); });",
        ),
        (
            "tests/not_cases.js",
            "const { test } = require('./custom-client');\ntest('login', () => {});",
        ),
        (
            "tests/not_cases.js",
            "function run(test) { test('login', () => {}); }",
        ),
    ] {
        let parsed = parser::parse(path, source, &mut tree_sitter::Parser::new()).unwrap();
        assert!(
            !parsed.symbols.iter().any(|s| s.kind == "test"),
            "{path}: {source}"
        );
    }
}

#[test]
fn direct_callback_checks_survive_setup_helpers_and_query_redundancy() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "src/login.ts",
        "export function login() { return 'session'; }\n",
    );
    write(
        root,
        "tests/helpers/env.ts",
        "export function environment() { return 'session'; }\n",
    );
    write(
        root,
        "tests/helpers/setup.ts",
        "import { environment } from './env';\nexport function login() { return environment(); }\n",
    );
    write(
        root,
        "tests/access.test.ts",
        "import { test, expect } from 'vitest';\nimport { login } from '../src/login';\ntest('login establishes a session', () => {\n const value = login();\n expect(value).toBe('session');\n});\n",
    );
    write(
        root,
        "tests/mixed.test.ts",
        "import { test, expect } from 'vitest';\nimport { login } from './helpers/setup';\ntest('opens the workspace dashboard', () => { login(); expect(true).toBe(true); });\n",
    );
    for index in 0..8 {
        write(
            root,
            &format!("tests/dashboard{index}.test.ts"),
            "import { test, expect } from 'vitest';\nimport { login } from './helpers/setup';\ntest('lists unrelated dashboard entries', () => { login(); login(); login(); expect(true).toBe(true); });\n",
        );
    }
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    let options = PackOptions {
        task: Some("login fails".into()),
        max_files: 10,
        ..Default::default()
    };
    let resolution = resolver::resolve_indexed(root, &db, &options).unwrap();
    let candidates = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
    assert!(candidates.iter().any(|c| c.path == "src/login.ts"));
    let direct = candidates
        .iter()
        .find(|c| c.path == "tests/access.test.ts")
        .unwrap_or_else(|| panic!("direct behavior missing: {candidates:?}"));
    assert!(direct.evidence.iter().any(|e| e.signal == "test_intent"));
    assert!(
        !candidates
            .iter()
            .any(|c| c.path.contains("dashboard") || c.path == "tests/mixed.test.ts")
    );
    let excerpt = snippets::select(
        root,
        &db,
        &resolution,
        &candidates,
        80,
        "",
        4000,
        &Tokenizer::new("approx").unwrap(),
    )
    .unwrap();
    assert!(
        excerpt
            .excerpts
            .iter()
            .any(|e| e.path == "tests/access.test.ts"
                && e.content.contains("expect(value).toBe('session')"))
    );
}

#[test]
fn direct_test_facets_are_bounded_and_testing_focus_and_explicit_hints_work() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "src/login.ts",
        "export function login() { return true; }\n",
    );
    write(
        root,
        "tests/helpers/setup.ts",
        "export function login() { return true; }\n",
    );
    for name in ["accepts", "rejects"] {
        write(
            root,
            &format!("tests/{name}.test.ts"),
            &format!(
                "import {{ test, expect }} from 'vitest';\nimport {{ login }} from './helpers/setup';\ntest('login {name} a session', () => {{ expect(login()).toBe(true); }});\n"
            ),
        );
    }
    write(
        root,
        "tests/dashboard.test.ts",
        "import { test, expect } from 'vitest';\nimport { login } from './helpers/setup';\ntest('opens a dashboard', () => { login(); expect(true).toBe(true); });\n",
    );
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    let options = PackOptions {
        task: Some("login".into()),
        max_files: 10,
        ..Default::default()
    };
    let run = |options: &PackOptions| {
        let resolution = resolver::resolve_indexed(root, &db, options).unwrap();
        discovery::discover(root, &db, &resolution, options, 2).unwrap()
    };
    let normal = run(&options);
    let direct = |c: &&context::model::Candidate| {
        c.path == "tests/accepts.test.ts" || c.path == "tests/rejects.test.ts"
    };
    assert_eq!(normal.iter().filter(direct).count(), 1, "{normal:?}");
    let mut focused = options.clone();
    focused.focus = vec!["testing".into()];
    assert_eq!(run(&focused).iter().filter(direct).count(), 2);
    let mut explicit = options;
    explicit.file = Some("tests/dashboard.test.ts".into());
    assert!(
        run(&explicit)
            .iter()
            .any(|c| c.path == "tests/dashboard.test.ts")
    );
}

#[test]
fn named_tests_keep_real_test_roles_without_promoting_helpers() {
    for (path, source, names) in [
        (
            "src/lib.rs",
            "#[cfg(test)] mod tests { #[test] fn checks_session() {} fn login_helper() {} }",
            vec!["checks_session"],
        ),
        (
            "tests/test_session.py",
            "def test_session():\n assert True\ndef login_helper():\n return True\n",
            vec!["test_session"],
        ),
        (
            "src/SessionTest.java",
            "class SessionTest { @org.junit.jupiter.api.Test void checksSession() {} void loginHelper() {} }",
            vec!["checksSession"],
        ),
        (
            "session_test.go",
            "package session\ntype TestHelper struct {}\nfunc TestSession(t *testing.T) {}\nfunc loginHelper() {}\n",
            vec!["TestSession"],
        ),
    ] {
        let parsed = parser::parse(path, source, &mut tree_sitter::Parser::new()).unwrap();
        for name in names {
            assert!(
                parsed
                    .symbols
                    .iter()
                    .any(|s| s.name == name && s.is_test_case && s.is_test && s.kind != "test"),
                "{path}: {:?}",
                parsed.symbols
            );
        }
        assert!(
            parsed
                .symbols
                .iter()
                .filter(|s| s.name.to_lowercase().contains("helper"))
                .all(|s| !s.is_test_case)
        );
    }
}

#[test]
fn incidental_and_negated_title_mentions_do_not_claim_direct_behavior() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "src/login.ts",
        "export function login() { return true; }\n",
    );
    write(
        root,
        "tests/identity.test.ts",
        "import { test, expect } from 'vitest';\ntest('login establishes a session', () => { expect(login()).toBe(true); });\n",
    );
    write(
        root,
        "tests/recovery.test.ts",
        "import { test, expect } from 'vitest';\ntest('recovery revokes previous browsers and remembered login', () => { login(); login(); expect(true).toBe(true); });\n",
    );
    write(
        root,
        "tests/watch_test.py",
        "def test_keyring_failure_without_claiming_missing_login():\n assert 'login' in message\n",
    );
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    let options = PackOptions {
        task: Some("login".into()),
        ..Default::default()
    };
    let resolution = resolver::resolve_indexed(root, &db, &options).unwrap();
    let ranked = discovery::rank(root, &db, &resolution, &options, 2).unwrap();
    for candidate in ranked
        .iter()
        .filter(|c| c.path == "tests/recovery.test.ts" || c.path == "tests/watch_test.py")
    {
        assert!(
            !candidate.evidence.iter().any(|e| e.signal == "test_intent"),
            "{candidate:?}"
        );
    }
    let selected = discovery::discover(root, &db, &resolution, &options, 2).unwrap();
    assert!(
        selected.iter().any(|c| c.path == "tests/identity.test.ts"),
        "{selected:?}"
    );
}

#[test]
fn one_broad_test_word_does_not_claim_a_specific_multi_concept_task() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        root,
        "routes.go",
        "package routes\nfunc MountRoutes() {}\nfunc HandlerPattern() {}\n",
    );
    write(
        root,
        "pattern_test.go",
        "package routes\nfunc TestPatternParsing(t *testing.T) {}\n",
    );
    let mut db = Database::open(root).unwrap();
    indexer::index(root, &mut db, &Config::default(), false).unwrap();
    let options = PackOptions {
        task: Some("mount routes pattern handler".into()),
        ..Default::default()
    };
    let resolution = resolver::resolve_indexed(root, &db, &options).unwrap();
    let ranked = discovery::rank(root, &db, &resolution, &options, 2).unwrap();
    let broad = ranked.iter().find(|c| c.path == "pattern_test.go").unwrap();
    assert!(!broad.evidence.iter().any(|e| e.signal == "test_intent"));
}
