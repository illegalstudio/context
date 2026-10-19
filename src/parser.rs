use crate::model::Symbol;
use anyhow::{Context, Result};
use std::{
    collections::{BTreeSet, HashSet},
    path::{Component, Path, PathBuf},
};
use tree_sitter::{Language, Node, Parser};

#[derive(Clone, Debug)]
pub struct RawImport {
    pub module: String,
    pub kind: String,
}

#[derive(Default, Debug)]
pub struct Parsed {
    pub symbols: Vec<Symbol>,
    pub imports: Vec<RawImport>,
    pub references: BTreeSet<String>,
}

pub fn language(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "php" => "php",
        "py" => "python",
        "go" => "go",
        "rs" => "rust",
        "rb" => "ruby",
        "java" => "java",
        "kt" => "kotlin",
        "swift" => "swift",
        "cs" => "csharp",
        "c" | "h" => "c",
        "cpp" | "hpp" | "cc" => "cpp",
        "vue" => "vue",
        "svelte" => "svelte",
        "json" => "json",
        "yml" | "yaml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "html" => "html",
        "css" | "scss" | "sass" | "less" => "css",
        "md" => "markdown",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "shell",
        _ => "unknown",
    }
}

pub(crate) fn grammar(path: &str) -> Option<Language> {
    Some(match language(path) {
        "typescript" if path.ends_with(".tsx") => tree_sitter_typescript::LANGUAGE_TSX.into(),
        "typescript" => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "javascript" => tree_sitter_javascript::LANGUAGE.into(),
        "php" => tree_sitter_php::LANGUAGE_PHP.into(),
        "python" => tree_sitter_python::LANGUAGE.into(),
        "go" => tree_sitter_go::LANGUAGE.into(),
        "rust" => tree_sitter_rust::LANGUAGE.into(),
        "ruby" => tree_sitter_ruby::LANGUAGE.into(),
        "java" => tree_sitter_java::LANGUAGE.into(),
        _ => return None,
    })
}

pub fn parse(path: &str, content: &str, parser: &mut Parser) -> Result<Parsed> {
    let mut result = Parsed::default();
    result.imports.extend(framework_imports(path, content));
    // Text references also cover prose, templates and framework string references.
    for word in content.split(|c: char| !c.is_alphanumeric() && c != '_') {
        if word.len() >= 3
            && (word.chars().next().is_some_and(char::is_uppercase)
                || word.contains('_')
                || word.chars().any(char::is_uppercase))
        {
            result.references.insert(word.to_owned());
        }
    }
    let Some(grammar) = grammar(path) else {
        return Ok(result);
    };
    parser
        .set_language(&grammar)
        .context("Incompatible parser grammar")?;
    let tree = parser.parse(content, None).context("Parsing cancelled")?;
    let language = language(path);
    let tests = crate::test_cases::Api::new(tree.root_node(), path, language, content);
    let mut cursor = tree.walk();
    loop {
        let node = cursor.node();
        if let Some(case) = tests.callback(node, path, content) {
            result.symbols.push(case);
        }
        inspect(node, path, language, content, &mut result);
        if cursor.goto_first_child() {
            continue;
        }
        loop {
            if cursor.goto_next_sibling() {
                break;
            }
            if !cursor.goto_parent() {
                result
                    .symbols
                    .sort_by(|a, b| a.start_line.cmp(&b.start_line).then(a.name.cmp(&b.name)));
                result
                    .symbols
                    .dedup_by(|a, b| a.start_line == b.start_line && a.name == b.name);
                return Ok(result);
            }
        }
    }
}

fn framework_imports(path: &str, content: &str) -> Vec<RawImport> {
    use std::sync::OnceLock;
    static PATTERNS: OnceLock<Vec<(regex::Regex, &'static str)>> = OnceLock::new();
    if !path.ends_with(".php")
        && !path.ends_with(".html")
        && !path.ends_with(".yaml")
        && !path.ends_with(".yml")
    {
        return vec![];
    }
    let patterns = PATTERNS.get_or_init(|| {
        [
            (
                r#"\b(?:Inertia::render|inertia)\s*\(\s*['"]([^'"]+)['"]"#,
                "inertia",
            ),
            (
                r#"(?:\bview|View::make|->view)\s*\(\s*['"]([^'"]+)['"]"#,
                "view",
            ),
            (
                r#"@(?:include|extends|component|each)\s*\(\s*['"]([^'"]+)['"]"#,
                "view",
            ),
            (r#"\{\{\s*(?:partial|include):([a-zA-Z0-9_./-]+)"#, "view"),
            (r#"\{\{\s*partial\s+src=['"]([^'"]+)['"]"#, "view"),
            (r#"([A-Za-z_\\][A-Za-z0-9_\\]*)::class"#, "class"),
            (r#"['"]([A-Za-z_\\][A-Za-z0-9_\\]*Controller)@"#, "class"),
            (
                r#"(?m)^\s*(?:template|layout):\s*['"]?([a-zA-Z0-9_./-]+)"#,
                "view",
            ),
            (
                r#"(?m)^\s*blueprint:\s*['"]?([a-zA-Z0-9_./-]+)"#,
                "blueprint",
            ),
        ]
        .into_iter()
        .map(|(pattern, kind)| {
            (
                regex::Regex::new(pattern).expect("Valid static framework pattern"),
                kind,
            )
        })
        .collect()
    });
    let content = content
        .lines()
        .filter(|line| {
            !["//", "#", "*", "<!--"]
                .iter()
                .any(|prefix| line.trim_start().starts_with(prefix))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let mut imports: Vec<_> = patterns
        .iter()
        .flat_map(|(pattern, kind)| {
            pattern.captures_iter(&content).map(move |c| RawImport {
                module: c[1].into(),
                kind: (*kind).into(),
            })
        })
        .collect();
    imports.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.module.cmp(&b.module)));
    imports.dedup_by(|a, b| a.kind == b.kind && a.module == b.module);
    imports
}

fn text<'a>(node: Node<'_>, content: &'a str) -> &'a str {
    content.get(node.byte_range()).unwrap_or("")
}

fn test_scope(mut node: Node<'_>, language: &str, content: &str) -> bool {
    loop {
        if language == "rust" {
            if node.kind() == "mod_item"
                && node
                    .child_by_field_name("name")
                    .is_some_and(|name| text(name, content) == "tests")
            {
                return true;
            }
            let mut attribute = node.prev_named_sibling();
            while let Some(previous) = attribute {
                if previous.kind() != "attribute_item" {
                    break;
                }
                let value: String = text(previous, content)
                    .chars()
                    .filter(|c| !c.is_whitespace())
                    .collect();
                let name = value
                    .trim_start_matches("#[")
                    .split(['(', ']'])
                    .next()
                    .unwrap_or("");
                if name.rsplit("::").next() == Some("test")
                    || name == "cfg" && value == "#[cfg(test)]"
                {
                    return true;
                }
                attribute = previous.prev_named_sibling();
            }
        } else if language == "java" {
            let mut cursor = node.walk();
            for modifiers in node
                .named_children(&mut cursor)
                .filter(|child| child.kind() == "modifiers")
            {
                let mut cursor = modifiers.walk();
                if modifiers.named_children(&mut cursor).any(|annotation| {
                    matches!(annotation.kind(), "annotation" | "marker_annotation")
                        && annotation.child_by_field_name("name").is_some_and(|name| {
                            matches!(
                                text(name, content).rsplit('.').next(),
                                Some(
                                    "Test"
                                        | "ParameterizedTest"
                                        | "RepeatedTest"
                                        | "TestFactory"
                                        | "Theory"
                                )
                            )
                        })
                }) {
                    return true;
                }
            }
        } else if language == "python"
            && node.kind() == "function_definition"
            && node
                .child_by_field_name("name")
                .is_some_and(|name| text(name, content).starts_with("test_"))
        {
            return true;
        }
        let Some(parent) = node.parent() else {
            return false;
        };
        node = parent;
    }
}

fn inspect(node: Node<'_>, path: &str, language: &str, content: &str, result: &mut Parsed) {
    let kind = node.kind();
    if language == "php"
        && matches!(
            kind,
            "function_call_expression" | "scoped_call_expression" | "member_call_expression"
        )
    {
        result
            .imports
            .extend(crate::runtime::requests(text(node, content)));
    }
    let symbol_kind = match kind {
        "class_declaration" | "class_definition" | "class" | "struct_item" | "enum_item" => {
            Some("class")
        }
        "interface_declaration" | "trait_declaration" | "trait_item" => Some("interface"),
        "type_alias_declaration" | "type_item" | "type_spec" => Some("type"),
        "function_declaration" | "function_definition" | "function_item" | "singleton_method" => {
            Some("function")
        }
        "method_definition" | "method_declaration" | "method" => Some("method"),
        "variable_declarator"
            if node
                .child_by_field_name("value")
                .is_some_and(|v| matches!(v.kind(), "arrow_function" | "function_expression")) =>
        {
            Some("function")
        }
        _ => None,
    };
    if let Some(symbol_kind) = symbol_kind
        && let Some(name) = node.child_by_field_name("name")
    {
        let name = text(name, content);
        if !name.is_empty() {
            let signature = text(node, content)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .chars()
                .take(240)
                .collect();
            let is_test_case = crate::test_cases::named_case(node, path, language, name, content);
            result.symbols.push(Symbol {
                file_path: path.into(),
                name: name.into(),
                kind: symbol_kind.into(),
                start_line: node.start_position().row + 1,
                end_line: node.end_position().row + usize::from(node.end_position().column > 0),
                signature,
                is_test: is_test_case
                    || crate::quality::is_test_path(path)
                    || test_scope(node, language, content),
                is_test_case,
            });
        }
    }
    match kind {
        "import_statement" if matches!(language, "typescript" | "javascript") => {
            if let Some(source) = node.child_by_field_name("source") {
                result.imports.push(RawImport {
                    module: text(source, content).trim_matches(['\'', '"']).into(),
                    kind: "js".into(),
                });
            }
        }
        "call_expression" if matches!(language, "typescript" | "javascript") => {
            if node
                .child_by_field_name("function")
                .is_some_and(|n| matches!(text(n, content), "require" | "import"))
                && let Some(arguments) = node.child_by_field_name("arguments")
                && let Some(value) = arguments.named_child(0)
                && value.kind() == "string"
            {
                result.imports.push(RawImport {
                    module: text(value, content).trim_matches(['\'', '"']).into(),
                    kind: "js".into(),
                });
            }
        }
        "namespace_use_declaration" => {
            let value = text(node, content)
                .trim()
                .trim_start_matches("use ")
                .trim_end_matches(';');
            let (prefix, modules) = if let Some((prefix, group)) = value.split_once('{') {
                (prefix.trim(), group.trim_end_matches('}'))
            } else {
                ("", value)
            };
            for module in modules.split(',') {
                let module = module.split(" as ").next().unwrap_or(module).trim();
                result.imports.push(RawImport {
                    module: format!("{prefix}{module}").trim_start_matches('\\').into(),
                    kind: "php".into(),
                });
            }
        }
        "import_from_statement" => {
            if let Some(module) = node.child_by_field_name("module_name") {
                result.imports.push(RawImport {
                    module: text(module, content).into(),
                    kind: "python".into(),
                });
            }
        }
        "import_statement" if language == "python" => {
            let mut c = node.walk();
            for module in node.named_children(&mut c) {
                let module = module.child_by_field_name("name").unwrap_or(module);
                result.imports.push(RawImport {
                    module: text(module, content).into(),
                    kind: "python".into(),
                });
            }
        }
        "use_declaration" if language == "rust" => {
            let value = text(node, content)
                .split_once("use ")
                .map(|(_, value)| value)
                .unwrap_or("")
                .trim_end_matches(';');
            for module in rust_use_paths(value) {
                result.imports.push(RawImport {
                    module,
                    kind: "rust".into(),
                });
            }
        }
        "mod_item" if node.child_by_field_name("body").is_none() => {
            if let Some(name) = node.child_by_field_name("name") {
                result.imports.push(RawImport {
                    module: text(name, content).into(),
                    kind: "rust_mod".into(),
                });
            }
        }
        "import_spec" | "import_declaration" if matches!(language, "go" | "java") => {
            let value = node
                .child_by_field_name("path")
                .map(|n| text(n, content))
                .unwrap_or_else(|| text(node, content));
            result.imports.push(RawImport {
                module: value
                    .trim()
                    .trim_matches('"')
                    .trim_start_matches("import ")
                    .trim_end_matches(';')
                    .into(),
                kind: language.into(),
            });
        }
        _ => {}
    }
}

fn rust_use_paths(value: &str) -> Vec<String> {
    if let Some((prefix, group)) = value.split_once('{') {
        let group = group
            .rsplit_once('}')
            .map(|(group, _)| group)
            .unwrap_or(group);
        let mut depth = 0;
        let mut start = 0;
        let mut result = vec![];
        for (index, c) in group.char_indices() {
            match c {
                '{' => depth += 1,
                '}' => depth -= 1,
                ',' if depth == 0 => {
                    result.extend(rust_use_paths(&format!("{prefix}{}", &group[start..index])));
                    start = index + 1;
                }
                _ => {}
            }
        }
        result.extend(rust_use_paths(&format!("{prefix}{}", &group[start..])));
        result
    } else {
        let value = value.split(" as ").next().unwrap_or(value);
        let value: String = value.chars().filter(|c| !c.is_whitespace()).collect();
        let value = value
            .strip_suffix("::self")
            .or_else(|| value.strip_suffix("::*"))
            .unwrap_or(&value);
        if value.is_empty() {
            vec![]
        } else {
            vec![value.into()]
        }
    }
}

fn rust_module_directory(source: &str, parent: &Path) -> PathBuf {
    if matches!(
        Path::new(source).file_name().and_then(|s| s.to_str()),
        Some("mod.rs" | "lib.rs" | "main.rs")
    ) {
        parent.to_path_buf()
    } else {
        parent.join(Path::new(source).file_stem().unwrap_or_default())
    }
}

pub fn normalize(path: &Path) -> String {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(s) => parts.push(s.to_string_lossy().into_owned()),
            Component::ParentDir => {
                parts.pop();
            }
            Component::CurDir => {}
            _ => {}
        }
    }
    parts.join("/")
}

pub fn resolve_import(
    source: &str,
    import: &RawImport,
    files: &HashSet<String>,
    aliases: &[(String, String)],
) -> Vec<String> {
    let parent = Path::new(source).parent().unwrap_or(Path::new(""));
    let module = import.module.as_str();
    let mut bases: Vec<PathBuf> = vec![];
    match import.kind.as_str() {
        "js" => {
            if module.starts_with('.') {
                bases.push(parent.join(module));
            } else {
                for (alias, target) in aliases {
                    if let Some(rest) = module.strip_prefix(alias) {
                        bases.push(Path::new(target).join(rest.trim_start_matches('/')));
                    }
                }
            }
        }
        "project_path" => bases.push(PathBuf::from(module)),
        "php" => {
            for (alias, target) in aliases {
                if let Some(rest) = module.strip_prefix(alias) {
                    bases.push(Path::new(target).join(rest.replace('\\', "/")));
                }
            }
            if let Some(rest) = module.strip_prefix("App\\") {
                bases.push(Path::new("app").join(rest.replace('\\', "/")));
            }
        }
        "python" => {
            let dots = module.chars().take_while(|c| *c == '.').count();
            let mut base = if dots > 0 {
                parent.to_path_buf()
            } else {
                PathBuf::new()
            };
            for _ in 1..dots {
                base.pop();
            }
            bases.push(base.join(module.trim_start_matches('.').replace('.', "/")));
        }
        "rust_mod" => bases.push(rust_module_directory(source, parent).join(module)),
        "rust" => {
            let segments: Vec<_> = module.split("::").collect();
            if segments
                .first()
                .is_some_and(|p| matches!(*p, "crate" | "self" | "super"))
            {
                let mut base = if segments[0] == "crate" {
                    PathBuf::from("src")
                } else {
                    rust_module_directory(source, parent)
                };
                if segments[0] == "super" {
                    base.pop();
                }
                let mut prefixes = vec![base.clone()];
                for segment in &segments[1..] {
                    if *segment == "super" {
                        base.pop();
                    } else {
                        base.push(segment);
                    }
                    prefixes.push(base.clone());
                }
                bases.extend(prefixes.into_iter().rev());
            }
        }
        "java" => return crate::java::ImportIndex::new(files).resolve(module),
        "go" => {
            return files
                .iter()
                .filter(|p| {
                    p.ends_with(".go")
                        && p.rsplit_once('/').is_some_and(|(d, _)| module.ends_with(d))
                })
                .cloned()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
        }
        _ => {}
    }
    let mut result = BTreeSet::new();
    for base in bases {
        let base = normalize(&base);
        let mut variants = vec![base.clone()];
        // ESM projects commonly write .js specifiers for TypeScript sources.
        let stem = base
            .strip_suffix(".js")
            .or_else(|| base.strip_suffix(".mjs"))
            .unwrap_or(&base);
        for extension in [
            "ts", "tsx", "js", "jsx", "mjs", "cjs", "php", "py", "rs", "java", "go", "rb",
        ] {
            variants.push(format!("{stem}.{extension}"));
            variants.push(format!("{base}/index.{extension}"));
        }
        variants.push(format!("{base}/__init__.py"));
        variants.push(format!("{base}/mod.rs"));
        if import.kind == "rust" && base == "src" {
            variants.push("src/lib.rs".into());
            variants.push("src/main.rs".into());
        }
        if let Some(target) = variants.into_iter().find(|v| files.contains(v)) {
            result.insert(target);
            if import.kind == "rust" {
                break;
            }
        }
    }
    result.into_iter().collect()
}
