use crate::{model::Symbol, quality::is_test_path};
use std::collections::BTreeSet;
use tree_sitter::Node;

fn text<'a>(node: Node<'_>, source: &'a str) -> &'a str {
    source.get(node.byte_range()).unwrap_or("")
}

fn argument(node: Node<'_>) -> Option<Node<'_>> {
    if node.kind() == "argument" {
        node.named_child(0)
    } else {
        Some(node)
    }
}

fn literal(node: Node<'_>, source: &str) -> Option<String> {
    if !matches!(
        node.kind(),
        "string" | "encapsed_string" | "template_string"
    ) {
        return None;
    }
    let mut cursor = node.walk();
    if node.named_children(&mut cursor).any(|child| {
        !matches!(
            child.kind(),
            "string_content" | "string_fragment" | "escape_sequence"
        )
    }) {
        return None;
    }
    let raw = text(node, source);
    if raw.len() < 2
        || raw.len() > 2048
        || !matches!(raw.as_bytes()[0], b'\'' | b'"' | b'`')
        || raw.as_bytes().first() != raw.as_bytes().last()
    {
        return None;
    }
    let mut title = String::new();
    let mut chars = raw[1..raw.len() - 1].chars();
    while let Some(ch) = chars.next() {
        title.push(if ch == '\\' {
            match chars.next()? {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                escaped => escaped,
            }
        } else {
            ch
        });
    }
    (!title.trim().is_empty()).then_some(title)
}

fn known_module(module: &str) -> bool {
    matches!(
        module,
        "vitest" | "@jest/globals" | "@playwright/test" | "node:test" | "bun:test" | "ava" | "tape"
    )
}

fn require_module(node: Node<'_>, source: &str) -> Option<String> {
    if node.kind() != "call_expression"
        || text(node.child_by_field_name("function")?, source) != "require"
    {
        return None;
    }
    literal(
        node.child_by_field_name("arguments")?.named_child(0)?,
        source,
    )
}

fn shadowed(mut node: Node<'_>, binding: &str, source: &str) -> bool {
    while let Some(parent) = node.parent() {
        if matches!(
            parent.kind(),
            "arrow_function" | "function_expression" | "function_declaration"
        ) {
            let mut parameters: Vec<_> = parent
                .child_by_field_name("parameters")
                .into_iter()
                .collect();
            parameters.extend(parent.child_by_field_name("parameter"));
            while let Some(parameter) = parameters.pop() {
                if parameter.kind() == "identifier" && text(parameter, source) == binding {
                    return true;
                }
                let mut cursor = parameter.walk();
                parameters.extend(parameter.named_children(&mut cursor));
            }
        }
        node = parent;
    }
    false
}

pub fn named_case(node: Node<'_>, path: &str, language: &str, name: &str, source: &str) -> bool {
    if !matches!(
        node.kind(),
        "function_declaration"
            | "function_definition"
            | "function_item"
            | "method_definition"
            | "method_declaration"
            | "method"
            | "singleton_method"
    ) {
        return false;
    }
    if is_test_path(path)
        && match language {
            "python" | "ruby" => name.starts_with("test_"),
            "go" => ["Test", "Example", "Benchmark", "Fuzz"]
                .iter()
                .any(|prefix| {
                    name.strip_prefix(prefix)
                        .is_some_and(|rest| rest.is_empty() || rest.starts_with(char::is_uppercase))
                }),
            "php" | "java" => name
                .strip_prefix("test")
                .is_some_and(|rest| rest.starts_with('_') || rest.starts_with(char::is_uppercase)),
            _ => false,
        }
    {
        return true;
    }
    if language == "rust" {
        let mut previous = node.prev_named_sibling();
        while let Some(attribute) = previous.filter(|n| n.kind() == "attribute_item") {
            let compact: String = text(attribute, source)
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            let name = compact
                .trim_start_matches("#[")
                .trim_end_matches(']')
                .split('(')
                .next()
                .unwrap_or("");
            if name == "test" || name.ends_with("::test") {
                return true;
            }
            previous = attribute.prev_named_sibling();
        }
    }
    if language == "java" && node.kind() == "method_declaration" {
        let mut cursor = node.walk();
        for modifiers in node
            .named_children(&mut cursor)
            .filter(|n| n.kind() == "modifiers")
        {
            let mut c = modifiers.walk();
            if modifiers.named_children(&mut c).any(|a| {
                matches!(a.kind(), "annotation" | "marker_annotation")
                    && a.child_by_field_name("name").is_some_and(|name| {
                        matches!(
                            text(name, source).rsplit('.').next(),
                            Some(
                                "Test"
                                    | "ParameterizedTest"
                                    | "RepeatedTest"
                                    | "TestFactory"
                                    | "TestTemplate"
                            )
                        )
                    })
            }) {
                return true;
            }
        }
    }
    false
}

/// Recognize test APIs without treating an application's own `test` function as a suite.
pub(crate) struct Api {
    names: BTreeSet<String>,
    namespaces: BTreeSet<String>,
    members: BTreeSet<String>,
    enabled: bool,
}

impl Api {
    pub fn new(root: Node<'_>, path: &str, language: &str, source: &str) -> Self {
        Self::with_names(root, path, language, source, &["test", "it", "specify"])
    }

    pub fn hooks(root: Node<'_>, path: &str, language: &str, source: &str) -> Self {
        Self::with_names(
            root,
            path,
            language,
            source,
            &[
                "beforeEach",
                "afterEach",
                "beforeAll",
                "afterAll",
                "before",
                "after",
                "pest",
                "uses",
            ],
        )
    }

    fn with_names(
        root: Node<'_>,
        path: &str,
        language: &str,
        source: &str,
        members: &[&str],
    ) -> Self {
        let mut api = Self {
            names: if is_test_path(path) {
                members.iter().map(|name| (*name).to_owned()).collect()
            } else {
                BTreeSet::new()
            },
            namespaces: BTreeSet::new(),
            members: members.iter().map(|name| (*name).to_owned()).collect(),
            enabled: matches!(language, "php" | "javascript" | "typescript"),
        };
        if !api.enabled {
            return api;
        }
        let mut imported = BTreeSet::new();
        let mut namespaces = BTreeSet::new();
        let mut cursor = root.walk();
        loop {
            let node = cursor.node();
            if matches!(
                node.kind(),
                "function_declaration" | "function_definition" | "variable_declarator"
            ) && let Some(name) = node.child_by_field_name("name")
            {
                api.names.remove(text(name, source));
            }
            if node.kind() == "variable_declarator"
                && let Some(name) = node.child_by_field_name("name")
            {
                let module = node
                    .child_by_field_name("value")
                    .and_then(|n| require_module(n, source));
                let known = module.as_deref().is_some_and(known_module);
                if name.kind() == "identifier" && known {
                    namespaces.insert(text(name, source).to_owned());
                    if module
                        .as_deref()
                        .is_some_and(|m| matches!(m, "node:test" | "ava" | "tape"))
                        && members.contains(&"test")
                    {
                        imported.insert(text(name, source).to_owned());
                    }
                } else if name.kind() == "object_pattern" {
                    let mut cursor = name.walk();
                    for part in name.named_children(&mut cursor) {
                        let pair = if part.kind() == "pair_pattern" {
                            part.child_by_field_name("key")
                                .zip(part.child_by_field_name("value"))
                        } else if part.kind() == "shorthand_property_identifier_pattern" {
                            Some((part, part))
                        } else {
                            None
                        };
                        if let Some((key, alias)) = pair {
                            api.names.remove(text(alias, source));
                            if known && !members.contains(&"test") && text(key, source) == "test" {
                                namespaces.insert(text(alias, source).to_owned());
                            }
                            if known && members.contains(&text(key, source)) {
                                imported.insert(text(alias, source).to_owned());
                            }
                        }
                    }
                }
            }
            if node.kind() == "import_statement" {
                let module = node
                    .child_by_field_name("source")
                    .and_then(|n| literal(n, source));
                let known = module.as_deref().is_some_and(known_module);
                if let Some(clause) = node.named_child(0).filter(|n| n.kind() == "import_clause") {
                    let mut parts = vec![clause];
                    while let Some(part) = parts.pop() {
                        if part.kind() == "import_specifier" {
                            if let Some(name) = part.child_by_field_name("name") {
                                let alias = part.child_by_field_name("alias").unwrap_or(name);
                                api.names.remove(text(alias, source));
                                if known
                                    && !members.contains(&"test")
                                    && text(name, source) == "test"
                                {
                                    namespaces.insert(text(alias, source).to_owned());
                                }
                                if known && members.contains(&text(name, source)) {
                                    imported.insert(text(alias, source).to_owned());
                                }
                            }
                        } else if part.kind() == "namespace_import" {
                            if known && let Some(name) = part.named_child(0) {
                                namespaces.insert(text(name, source).to_owned());
                            }
                        } else if part.kind() == "identifier"
                            && part.parent().is_some_and(|n| n.kind() == "import_clause")
                        {
                            api.names.remove(text(part, source));
                            if module
                                .as_deref()
                                .is_some_and(|m| matches!(m, "node:test" | "ava" | "tape"))
                            {
                                if members.contains(&"test") {
                                    imported.insert(text(part, source).to_owned());
                                }
                                if !members.contains(&"test") {
                                    namespaces.insert(text(part, source).to_owned());
                                }
                            }
                        } else {
                            let mut c = part.walk();
                            parts.extend(part.named_children(&mut c));
                        }
                    }
                }
            }
            if cursor.goto_first_child() {
                continue;
            }
            loop {
                if cursor.goto_next_sibling() {
                    break;
                }
                if !cursor.goto_parent() {
                    api.names.extend(imported);
                    api.namespaces = namespaces;
                    return api;
                }
            }
        }
    }

    fn function(&self, node: Node<'_>, source: &str) -> bool {
        match node.kind() {
            "identifier" | "name" | "qualified_name" => self
                .names
                .contains(text(node, source).trim_start_matches('\\')),
            "member_expression" => {
                let Some(object) = node.child_by_field_name("object") else {
                    return false;
                };
                let Some(property) = node.child_by_field_name("property") else {
                    return false;
                };
                let property = text(property, source);
                if self.namespaces.contains(text(object, source)) {
                    self.members.contains(property)
                } else {
                    matches!(
                        property,
                        "only" | "skip" | "concurrent" | "serial" | "todo" | "fails"
                    ) && self.function(object, source)
                }
            }
            _ => false,
        }
    }

    pub fn matches_call(&self, node: Node<'_>, source: &str) -> bool {
        if !self.enabled || !matches!(node.kind(), "call_expression" | "function_call_expression") {
            return false;
        }
        let Some(function) = node.child_by_field_name("function") else {
            return false;
        };
        let mut binding = function;
        while binding.kind() == "member_expression" {
            let Some(object) = binding.child_by_field_name("object") else {
                return false;
            };
            binding = object;
        }
        if !self.function(function, source) || shadowed(node, text(binding, source), source) {
            return false;
        }
        true
    }

    pub fn callback(&self, node: Node<'_>, path: &str, source: &str) -> Option<Symbol> {
        if !self.matches_call(node, source) {
            return None;
        }
        let args = node.child_by_field_name("arguments")?;
        let title = literal(argument(args.named_child(0)?)?, source)?;
        let mut cursor = args.walk();
        if !args
            .named_children(&mut cursor)
            .filter_map(argument)
            .any(|arg| {
                matches!(
                    arg.kind(),
                    "anonymous_function" | "arrow_function" | "function_expression"
                )
            })
        {
            return None;
        }
        Some(Symbol {
            file_path: path.into(),
            name: title,
            kind: "test".into(),
            start_line: node.start_position().row + 1,
            end_line: node.end_position().row + usize::from(node.end_position().column > 0),
            signature: text(node, source)
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(240)
                .collect(),
            is_test: true,
            is_test_case: true,
        })
    }
}
