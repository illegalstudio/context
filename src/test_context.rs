//! File-local test context. This is conservative syntax analysis, not call resolution.
use crate::model::Symbol;
use std::{collections::BTreeSet, ops::Range};
use tree_sitter::Node;

pub(crate) struct Context {
    pub excluded: Vec<Range<usize>>,
    pub support: Vec<Support>,
}

pub(crate) struct Support {
    pub range: Range<usize>,
    pub required: bool,
}

impl Context {
    fn add_support(&mut self, range: Range<usize>, required: bool) {
        if let Some(old) = self.support.iter_mut().find(|s| s.range == range) {
            old.required |= required;
        } else {
            self.support.push(Support { range, required });
        }
    }
}

fn range(node: Node<'_>) -> Range<usize> {
    node.start_position().row..node.end_position().row + usize::from(node.end_position().column > 0)
}

fn span(symbol: &Symbol) -> Range<usize> {
    symbol.start_line.saturating_sub(1)..symbol.end_line
}

fn contains(outer: &Range<usize>, inner: &Range<usize>) -> bool {
    outer.start <= inner.start && outer.end >= inner.end
}

fn identifiers(text: &str) -> BTreeSet<&str> {
    text.split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|word| !word.is_empty())
        .collect()
}

fn declaration(node: Node<'_>) -> Node<'_> {
    node.parent()
        .filter(|parent| {
            matches!(
                parent.kind(),
                "decorated_definition"
                    | "lexical_declaration"
                    | "variable_declaration"
                    | "field_declaration"
            )
        })
        .unwrap_or(node)
}

fn scope_contains(node: Node<'_>, selected: &[Range<usize>]) -> bool {
    let mut parent = node.parent();
    while let Some(node) = parent {
        if matches!(
            node.kind(),
            "class_definition"
                | "class_declaration"
                | "function_definition"
                | "function_declaration"
                | "method_definition"
                | "method_declaration"
                | "arrow_function"
                | "function_expression"
                | "anonymous_function"
                | "function_item"
                | "method"
                | "singleton_method"
        ) {
            return selected.iter().any(|case| contains(&range(node), case));
        }
        parent = node.parent();
    }
    true
}

fn lifecycle(name: &str, signature: &str) -> bool {
    matches!(
        name,
        "setUp"
            | "tearDown"
            | "setUpClass"
            | "tearDownClass"
            | "setup_method"
            | "teardown_method"
            | "setup_class"
            | "teardown_class"
            | "setup_module"
            | "teardown_module"
            | "setup"
            | "teardown"
            | "before_setup"
            | "after_teardown"
    ) || signature
        .lines()
        .filter_map(|line| line.trim().strip_prefix('@'))
        .any(|annotation| {
            let name = annotation
                .split(|c: char| !c.is_alphanumeric() && !matches!(c, '.' | '_'))
                .next()
                .unwrap_or("")
                .rsplit('.')
                .next()
                .unwrap_or("");
            matches!(
                name,
                "Before"
                    | "After"
                    | "BeforeEach"
                    | "AfterEach"
                    | "BeforeAll"
                    | "AfterAll"
                    | "BeforeClass"
                    | "AfterClass"
                    | "BeforeMethod"
                    | "AfterMethod"
            )
        })
}

pub(crate) fn analyze(
    path: &str,
    source: &str,
    symbols: &[&Symbol],
    selected: &[Range<usize>],
) -> Option<Context> {
    let mut parser = tree_sitter::Parser::new();
    parser.set_language(&crate::parser::grammar(path)?).ok()?;
    let tree = parser.parse(source, None)?;
    if tree.root_node().has_error() {
        return None;
    }
    let mut nodes = vec![];
    let mut pending = vec![tree.root_node()];
    while let Some(node) = pending.pop() {
        nodes.push(node);
        let mut cursor = node.walk();
        pending.extend(node.named_children(&mut cursor));
    }
    let text = |node: Node<'_>| source.get(node.byte_range()).unwrap_or("");
    let hooks = crate::test_cases::Api::hooks(
        tree.root_node(),
        path,
        crate::parser::language(path),
        source,
    );
    let lines: Vec<_> = source.lines().collect();
    if symbols.iter().any(|symbol| {
        symbol.start_line == 0
            || symbol.end_line < symbol.start_line
            || symbol.end_line > lines.len()
    }) {
        return None;
    }
    let content = |range: &Range<usize>| lines[range.start..range.end.min(lines.len())].join("\n");
    let cases: Vec<_> = symbols
        .iter()
        .filter(|s| s.is_test_case)
        .map(|s| span(s))
        .collect();
    let mut result = Context {
        excluded: vec![],
        support: vec![],
    };
    for case in &cases {
        if !selected
            .iter()
            .any(|matched| contains(case, matched) || contains(matched, case))
        {
            result.excluded.push(case.clone());
        }
    }
    let mut used = BTreeSet::<String>::new();
    for case in selected {
        let context = nodes
            .iter()
            .find(|node| range(**node) == *case && node.child_by_field_name("name").is_some())
            .map(|node| range(declaration(*node)))
            .unwrap_or_else(|| case.clone());
        used.extend(
            identifiers(&content(&context))
                .into_iter()
                .map(str::to_owned),
        );
    }
    for node in &nodes {
        let node_range = range(*node);
        let has_cases = cases.iter().any(|case| contains(&node_range, case));
        let has_selected = selected.iter().any(|case| contains(&node_range, case));
        if has_cases
            && !has_selected
            && matches!(
                node.kind(),
                "class_definition"
                    | "class_declaration"
                    | "call_expression"
                    | "function_call_expression"
            )
        {
            result.excluded.push(node_range);
            continue;
        }
        if selected.iter().any(|case| contains(case, &node_range))
            || !scope_contains(*node, selected)
        {
            continue;
        }
        if has_selected
            && matches!(node.kind(), "class_definition" | "class_declaration")
            && let Some(body) = node.child_by_field_name("body")
        {
            let header = node_range.start..(body.start_position().row + 1);
            used.extend(
                identifiers(&content(&header))
                    .into_iter()
                    .map(str::to_owned),
            );
            result.add_support(header, false);
        }
        if !has_cases && hooks.matches_call(*node, source) {
            let mut statement = *node;
            while let Some(parent) = statement.parent().filter(|parent| {
                matches!(
                    parent.kind(),
                    "member_call_expression" | "scoped_call_expression" | "expression_statement"
                )
            }) {
                statement = parent;
            }
            result.add_support(range(statement), true);
            used.extend(identifiers(text(statement)).into_iter().map(str::to_owned));
        }
    }
    // Follow only file-local named helpers, including transitive setup dependencies.
    let helpers: Vec<_> = symbols
        .iter()
        .filter(|s| {
            !s.is_test_case
                && matches!(s.kind.as_str(), "function" | "method")
                && !cases
                    .iter()
                    .any(|case| contains(&span(s), case) || contains(case, &span(s)))
        })
        .collect();
    let mut kept = BTreeSet::new();
    let mut fixture_classes = vec![];
    loop {
        let mut progress = false;
        for class in symbols.iter().filter(|s| s.kind == "class") {
            let class_range = span(class);
            if used.contains(&class.name)
                && !selected.iter().any(|case| contains(&class_range, case))
                && !fixture_classes.contains(&class_range)
            {
                // A referenced base class can have its own tests. Keep its setup,
                // while the individual unmatched case masks still apply.
                result.excluded.retain(|excluded| *excluded != class_range);
                used.extend(
                    identifiers(&content(&class_range))
                        .into_iter()
                        .map(str::to_owned),
                );
                fixture_classes.push(class_range.clone());
                result.add_support(class_range, true);
                progress = true;
            }
        }
        for (index, helper) in helpers.iter().enumerate() {
            if kept.contains(&index) {
                continue;
            }
            let node = nodes.iter().find(|node| {
                range(**node) == span(helper)
                    && node
                        .child_by_field_name("name")
                        .is_some_and(|name| text(name) == helper.name)
            });
            let helper_range = node
                .map(|node| range(declaration(*node)))
                .unwrap_or_else(|| span(helper));
            let helper_text = content(&helper_range);
            if fixture_classes
                .iter()
                .any(|class| contains(class, &helper_range))
                || node.is_some_and(|node| scope_contains(*node, selected))
                    && (used.contains(&helper.name)
                        || lifecycle(&helper.name, &helper_text)
                        || helper_text
                            .lines()
                            .take_while(|line| !line.trim().starts_with("def "))
                            .any(|line| {
                                line.contains("fixture")
                                    && line.contains("autouse")
                                    && line.contains("True")
                            }))
            {
                used.extend(
                    identifiers(&content(&helper_range))
                        .into_iter()
                        .map(str::to_owned),
                );
                result.add_support(helper_range, true);
                kept.insert(index);
                progress = true;
            }
        }
        for node in &nodes {
            if !matches!(
                node.kind(),
                "variable_declarator" | "assignment" | "assignment_expression"
            ) || !scope_contains(*node, selected)
            {
                continue;
            }
            let Some(binding) = node
                .child_by_field_name("name")
                .or_else(|| node.child_by_field_name("left"))
            else {
                continue;
            };
            let binding = text(binding).rsplit('.').next().unwrap_or("");
            let node_range = range(declaration(*node));
            if used.contains(binding)
                && !result
                    .support
                    .iter()
                    .any(|s| s.range == node_range && s.required)
                && !cases.iter().any(|case| contains(case, &node_range))
            {
                used.extend(identifiers(text(*node)).into_iter().map(str::to_owned));
                result.add_support(node_range, true);
                progress = true;
            }
        }
        if !progress {
            break;
        }
    }
    for (index, helper) in helpers.iter().enumerate() {
        if !kept.contains(&index) {
            let helper_range = nodes
                .iter()
                .find(|node| {
                    range(**node) == span(helper)
                        && node
                            .child_by_field_name("name")
                            .is_some_and(|name| text(name) == helper.name)
                })
                .map(|node| range(declaration(*node)))
                .unwrap_or_else(|| span(helper));
            result.excluded.push(helper_range);
        }
    }
    Some(result)
}
