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
