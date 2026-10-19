use context::{
    config::Config, database::Database, indexer, model::*, resolver, snippets, tokens::Tokenizer,
};
use std::{collections::BTreeMap, fs};

const CALLBACKS: &str = "<?php
use App\\Identity;
beforeEach(function () {
    $this->identity = makeIdentity();
    $this->identity->prepare();
});
function makeIdentity() {
    return Identity::factory()->create();
}
test('login and logout keep a session', function () {
    $this->post('/login');
    $this->assertAuthenticated();
    $this->post('/logout');
    $this->assertGuest();
});
test('membership accepts an administrator', function () {
    $this->post('/login');
    $this->grantAdministrator();
    $this->assertMembership();
});
";

const CLASS: &str = "import unittest
from client import Client

class TestResponses(unittest.TestCase):
    endpoint = '/account'

    def setUp(self):
        self.client = self.make_client()

    def make_client(self):
        return Client(self.endpoint)

    def test_refuses_login(self):
        response = self.client.login()
        self.assertEqual(response.status, 403)
        self.assertFalse(response.accepted)

    def test_membership(self):
        self.client.login()
        self.assertTrue(self.client.membership())

    def unrelated_helper(self):
        return 'unrelated login diagnostic'
";

fn excerpts(path: &str, source: &str, options: PackOptions, budget: usize) -> Vec<Excerpt> {
    excerpts_with(path, source, options, budget, |_| {})
}

fn excerpts_with(
    path: &str,
    source: &str,
    options: PackOptions,
    budget: usize,
    edit: impl FnOnce(&mut resolver::Resolution),
) -> Vec<Excerpt> {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join(path);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(target, source).unwrap();
    let mut db = Database::open(dir.path()).unwrap();
    indexer::index(dir.path(), &mut db, &Config::default(), false).unwrap();
    let mut resolution = resolver::resolve_indexed(dir.path(), &db, &options).unwrap();
    edit(&mut resolution);
    snippets::select(
        dir.path(),
        &db,
        &resolution,
        &[Candidate {
            path: path.into(),
            score: 1.0,
            reasons: vec![],
            contributions: BTreeMap::new(),
            evidence: vec![],
            reserved: options.file.is_some() || options.symbol.is_some(),
        }],
        300,
        "",
        budget,
        &Tokenizer::new("o200k_base").unwrap(),
    )
    .unwrap()
    .excerpts
}

fn options(task: &str) -> PackOptions {
    PackOptions {
        task: Some(task.into()),
        ..Default::default()
    }
}

fn text(excerpts: &[Excerpt]) -> String {
    excerpts
        .iter()
        .map(|e| e.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn callback_excerpts_keep_the_complete_case_and_shared_hooks_without_siblings() {
    let result = excerpts("tests/identity.php", CALLBACKS, options("login"), 8000);
    let code = text(&result);
    for needed in [
        "use App\\Identity;",
        "beforeEach(function",
        "->prepare();",
        "function makeIdentity",
        "assertAuthenticated",
        "assertGuest",
    ] {
        assert!(code.contains(needed), "Missing {needed}: {code}");
    }
    assert!(!code.contains("membership accepts"), "{code}");
    assert!(!code.contains("assertMembership"), "{code}");
    assert!(result.iter().any(|e| e.content.contains("test('login") && e.content.contains("assertGuest();\n});")));
}

#[test]
fn named_class_excerpts_keep_context_and_transitive_setup_without_the_whole_class() {
    let code = text(&excerpts(
        "tests/test_responses.py",
        CLASS,
        options("login"),
        8000,
    ));
    for needed in [
        "from client import Client",
        "class TestResponses",
        "endpoint =",
        "def setUp",
        "def make_client",
        "def test_refuses_login",
        "self.assertFalse(response.accepted)",
    ] {
        assert!(code.contains(needed), "Missing {needed}: {code}");
    }
    assert!(!code.contains("def test_membership"), "{code}");
    assert!(!code.contains("def unrelated_helper"), "{code}");
}

#[test]
fn explicit_files_classes_and_cases_preserve_the_requested_context() {
    for options in [
        PackOptions {
            file: Some("tests/test_responses.py".into()),
            ..options("login")
        },
        PackOptions {
            file: Some("./tests/test_responses.py".into()),
            ..options("login")
        },
        PackOptions {
            symbol: Some("TestResponses".into()),
            ..options("login")
        },
        PackOptions {
            symbol: Some("testresponses".into()),
            ..options("login")
        },
        PackOptions {
            symbol: Some("test_membership".into()),
            ..options("login")
        },
    ] {
        let code = text(&excerpts("tests/test_responses.py", CLASS, options, 8000));
        assert!(code.contains("def test_membership"), "{code}");
        assert!(
            code.contains("self.assertTrue(self.client.membership())"),
            "{code}"
        );
    }
}

#[test]
fn callback_support_is_scoped_and_complete_for_nested_suites() {
    let source = "import { test, expect, describe, beforeEach } from 'vitest';
describe('accounts', () => {
    beforeEach(() => {
        prepareAccount();
        initializeTransport();
    });
    test('login accepts a password', () => {
        expect(login()).toBe(true);
    });
    test('exports membership', () => {
        login();
        expect(exportMembership()).toBe(true);
    });
});
describe('reports', () => {
    beforeEach(() => { initializeReports(); });
    test('formats reports', () => { expect(report()).toBe(true); });
});
";
    let code = text(&excerpts(
        "tests/accounts.test.ts",
        source,
        options("login"),
        8000,
    ));
    assert!(
        code.contains("prepareAccount();\n        initializeTransport();"),
        "{code}"
    );
    assert!(code.contains("expect(login()).toBe(true);"), "{code}");
    assert!(!code.contains("exports membership"), "{code}");
    assert!(!code.contains("initializeReports"), "{code}");
}

#[test]
fn aliased_hooks_shared_bindings_and_arrow_helpers_are_retained() {
    let source = "import { test, beforeEach as prepare } from 'vitest';
const endpoint = '/account';
const makeClient = () => new Client(endpoint);
prepare(() => { installClient(makeClient()); });
test('login works', () => { expect(login()).toBe(true); });
test('membership works', () => { login(); expect(membership()).toBe(true); });
";
    let code = text(&excerpts(
        "tests/client.test.ts",
        source,
        options("login"),
        8000,
    ));
    for needed in [
        "const endpoint =",
        "const makeClient =",
        "prepare(() =>",
        "expect(login())",
    ] {
        assert!(code.contains(needed), "Missing {needed}: {code}");
    }
    assert!(!code.contains("membership works"), "{code}");
}

#[test]
fn python_fixtures_and_opaque_fixture_classes_preserve_required_behavior() {
    let source = "import pytest
class Transport:
    def dispatch(self):
        return 'server reply'

@pytest.fixture(autouse=True)
def initialize():
    install_transport(Transport())

@pytest.fixture
def client():
    return Client()

def test_login(client):
    assert client.login() is True

def test_membership(client):
    client.login()
    assert client.membership() is True
";
    let code = text(&excerpts(
        "tests/test_transport.py",
        source,
        options("login"),
        8000,
    ));
    for needed in [
        "class Transport:",
        "def dispatch",
        "@pytest.fixture(autouse=True)",
        "install_transport(Transport())",
        "def client():",
        "assert client.login() is True",
    ] {
        assert!(code.contains(needed), "Missing {needed}: {code}");
    }
    assert!(!code.contains("def test_membership"), "{code}");
}

#[test]
fn explicit_helpers_and_error_or_diff_anchors_override_sibling_filtering() {
    let code = text(&excerpts(
        "tests/test_responses.py",
        CLASS,
        PackOptions {
            symbol: Some("unrelated_helper".into()),
            ..options("login")
        },
        8000,
    ));
    assert!(code.contains("def unrelated_helper"), "{code}");
    for diff in [false, true] {
        let result = excerpts_with(
            "tests/test_responses.py",
            CLASS,
            options("login"),
            8000,
            |resolution| {
                if diff {
                    resolution.diff.push(DiffEntry {
                        file: "tests/test_responses.py".into(),
                        status: "modified".into(),
                        additions: 1,
                        deletions: 0,
                        changed_lines: vec![20],
                    });
                } else {
                    resolution.stacktrace.push(StacktraceEntry {
                        file: "tests/test_responses.py".into(),
                        line: 20,
                    });
                }
            },
        );
        let code = text(&result);
        assert!(
            code.contains("self.assertTrue(self.client.membership())"),
            "{code}"
        );
        assert!(
            code.contains("self.assertFalse(response.accepted)"),
            "{code}"
        );
    }
}

#[test]
fn focused_test_ranges_remain_deterministic_and_bounded_under_small_budgets() {
    for budget in [180, 350, 800] {
        let first = excerpts("tests/test_responses.py", CLASS, options("login"), budget);
        let second = excerpts("tests/test_responses.py", CLASS, options("login"), budget);
        assert_eq!(text(&first), text(&second));
        assert!(!text(&first).contains("def test_membership"));
        let prompt = text(&first);
        assert!(Tokenizer::new("o200k_base").unwrap().count(&prompt) <= budget);
        assert!(
            first
                .windows(2)
                .all(|pair| pair[0].end_line < pair[1].start_line)
        );
        if budget >= 350 {
            assert!(text(&first).contains("self.assertFalse(response.accepted)"));
        }
    }
}

#[test]
fn java_test_annotations_keep_qualified_lifecycle_methods() {
    let source = "import example.Client;
class IdentityTest {
    private Client client;
    @org.junit.jupiter.api.BeforeEach
    void prepareEnvironment() {
        client = new Client();
    }
    @org.junit.jupiter.api.Test
    void acceptsLogin() {
        assertTrue(client.login());
    }
    @org.junit.jupiter.api.Test
    void exportsMembership() {
        client.login();
        assertTrue(client.membership());
    }
}


";
    let code = text(&excerpts(
        "tests/IdentityTest.java",
        source,
        options("login"),
        8000,
    ));
    for needed in [
        "private Client client",
        "@org.junit.jupiter.api.BeforeEach",
        "void prepareEnvironment",
        "new Client()",
        "void acceptsLogin",
        "assertTrue(client.login())",
    ] {
        assert!(code.contains(needed), "Missing {needed}: {code}");
    }
    assert!(!code.contains("void exportsMembership"), "{code}");
}

#[test]
fn playwright_hooks_follow_the_named_test_binding() {
    let source = "import { test as check } from '@playwright/test';
check.beforeEach(async ({ page }) => {
    await prepareWorkspace(page);
    await installTransport(page);
});
check('login works', async ({ page }) => {
    await expectLogin(page);
});
check('membership works', async ({ page }) => {
    await login(page);
    await expectMembership(page);
});
";
    let code = text(&excerpts(
        "e2e/identity.spec.ts",
        source,
        options("login"),
        8000,
    ));
    assert!(code.contains("check.beforeEach"), "{code}");
    assert!(code.contains("await installTransport(page);"), "{code}");
    assert!(code.contains("await expectLogin(page);"), "{code}");
    assert!(!code.contains("membership works"), "{code}");
}

#[test]
fn local_inherited_setup_is_retained_without_inherited_sibling_cases() {
    for inherited_case in [
        "",
        "    def test_export(self):\n        self.client.login()\n        assert self.client.export()\n\n",
    ] {
        let source = format!(
            "import unittest
class BaseEnvironment(unittest.TestCase):
    def setUp(self):
        self.client = buildClient()

{inherited_case}class LoginTest(BaseEnvironment):
    def test_login(self):
        assert self.client.login()

    def test_membership(self):
        self.client.login()
        assert self.client.membership()
"
        );
        let code = text(&excerpts(
            "tests/test_identity.py",
            &source,
            options("login"),
            8000,
        ));
        for needed in [
            "class BaseEnvironment",
            "def setUp",
            "self.client = buildClient()",
            "class LoginTest(BaseEnvironment)",
            "assert self.client.login()",
        ] {
            assert!(code.contains(needed), "Missing {needed}: {code}");
        }
        assert!(!code.contains("def test_export"), "{code}");
        assert!(!code.contains("def test_membership"), "{code}");
    }
}

#[test]
fn required_helpers_precede_optional_container_context_under_token_pressure() {
    let dir = tempfile::tempdir().unwrap();
    let padding = (0..60)
        .map(|i| format!("    private String padding{i} = \"unused value\";\n"))
        .collect::<String>();
    let test_source = format!(
        "class HttpClientHeaderTests {{\n{padding}
    @Test
    void allowsSingleHeader() {{
        assertEquals(restrictedHeaders(\"host\"), 1);
    }}
    private int restrictedHeaders(String allowlist) {{
        String original = System.getProperty(\"allowlist\");
        System.setProperty(\"allowlist\", allowlist);
        int count = client.inspect();
        System.setProperty(\"allowlist\", original);
        return count;
    }}
}}"
    );
    let mut candidates = vec![];
    for (path, source, score) in [
        (
            "tests/BlockingTest.java".to_owned(),
            test_source.clone(),
            4.0,
        ),
        ("tests/ReactiveTest.java".to_owned(), test_source, 4.0),
    ]
    .into_iter()
    .chain((0..6).map(|i| {
        (
            format!("src/client{i}.ts"),
            format!(
                "export function client{i}() {{\n{}\n}}",
                "    processRequest('payload and transport state');\n".repeat(200)
            ),
            1.0,
        )
    })) {
        let target = dir.path().join(&path);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, source).unwrap();
        candidates.push(Candidate {
            path,
            score,
            reserved: false,
            reasons: vec![],
            contributions: BTreeMap::new(),
            evidence: vec![],
        });
    }
    let mut db = Database::open(dir.path()).unwrap();
    indexer::index(dir.path(), &mut db, &Config::default(), false).unwrap();
    let resolution =
        resolver::resolve_indexed(dir.path(), &db, &options("http client header allowlist"))
            .unwrap();
    let result = snippets::select(
        dir.path(),
        &db,
        &resolution,
        &candidates,
        300,
        "",
        2000,
        &Tokenizer::new("o200k_base").unwrap(),
    )
    .unwrap();
    for path in ["tests/BlockingTest.java", "tests/ReactiveTest.java"] {
        let code = result
            .excerpts
            .iter()
            .filter(|e| e.path == path)
            .map(|e| e.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            code.contains("assertEquals(restrictedHeaders"),
            "{path}: {code}"
        );
        assert!(
            code.contains("private int restrictedHeaders"),
            "{path}: {code}"
        );
        assert!(code.contains("return count;"), "{path}: {code}");
    }
}
