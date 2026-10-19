pub fn is_test_path(path: &str) -> bool {
    path.split('/').any(|part| {
        matches!(
            part.to_ascii_lowercase().as_str(),
            "test" | "tests" | "spec" | "specs" | "__tests__" | "e2e"
        ) || part.ends_with("Tests")
            || part.ends_with(".Test")
    }) || path.contains(".test.")
        || path.contains(".spec.")
        || path.contains("_test.")
        || path.contains("_spec.")
        || std::path::Path::new(path)
            .file_stem()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with("test_") || name.ends_with("Test") || name.ends_with("Tests")
            })
}

pub fn is_test_helper(path: &str) -> bool {
    if !is_test_path(path) {
        return false;
    }
    let lower = path.to_ascii_lowercase();
    let name = lower
        .rsplit('/')
        .next()
        .unwrap_or(&lower)
        .split('.')
        .next()
        .unwrap_or("");
    lower
        .split('/')
        .any(|part| matches!(part, "support" | "helpers" | "test-helpers" | "fixtures"))
        || matches!(
            name,
            "env" | "setup" | "conftest" | "testcase" | "support" | "helpers" | "helper" | "utils"
        )
}

pub fn generated(path: &str, content: &str) -> bool {
    if path
        .split('/')
        .any(|part| matches!(part, "generated" | "__generated__"))
        || path.contains(".generated.")
        || path.ends_with(".min.js")
        || path.ends_with(".min.css")
        || path.ends_with(".bundle.js")
        || path.ends_with(".bundle.css")
    {
        return true;
    }
    let header = content
        .chars()
        .take(2048)
        .collect::<String>()
        .to_ascii_lowercase();
    if [
        "@generated",
        "automatically generated",
        "auto-generated",
        "do not edit",
    ]
    .iter()
    .any(|marker| header.contains(marker))
    {
        return true;
    }
    if !matches!(
        path.rsplit('.').next(),
        Some("js" | "jsx" | "mjs" | "cjs" | "css")
    ) {
        return false;
    }
    content.lines().any(|line| {
        line.len() > 2000
            && line
                .bytes()
                .filter(|byte| *byte == b';' || *byte == b'}')
                .take(20)
                .count()
                >= 20
            && line.bytes().filter(u8::is_ascii_whitespace).count() < line.len() / 5
    })
}
