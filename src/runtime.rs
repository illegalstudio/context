use crate::parser::RawImport;
use regex::Regex;
use std::{collections::HashSet, sync::OnceLock};

pub fn requests(content: &str) -> Vec<RawImport> {
    static CONFIG: OnceLock<Regex> = OnceLock::new();
    static FORTIFY: OnceLock<Regex> = OnceLock::new();
    static AUTH: OnceLock<Regex> = OnceLock::new();
    static SESSION: OnceLock<Regex> = OnceLock::new();
    let config=CONFIG.get_or_init(|| Regex::new(r#"^(?:config|Config::[a-zA-Z_]\w*|config\(\)->[a-zA-Z_]\w*)\s*\(\s*['"]([a-zA-Z0-9_-]+)(?:\.[^'"]*)?['"]"#).unwrap());
    let auth=AUTH.get_or_init(|| Regex::new(r"^(?:Auth::(?:attempt|login|logout|guard)|auth\(\)->(?:attempt|login|logout|guard))\s*\(").unwrap());
    let session = SESSION.get_or_init(|| {
        Regex::new(r#"(?:^session\s*\(|^Session::[a-zA-Z_]\w*\s*\(|^[^'"\n;]+->session\s*\()"#)
            .unwrap()
    });
    let fortify = FORTIFY.get_or_init(|| Regex::new(r"^Fortify::[a-zA-Z_]\w*\s*\(").unwrap());
    let mut requests: Vec<_> = config
        .captures_iter(content)
        .map(|capture| RawImport {
            module: capture[1].into(),
            kind: "config".into(),
        })
        .collect();
    if fortify.is_match(content) {
        requests.push(RawImport {
            module: "web_auth".into(),
            kind: "runtime".into(),
        });
    } else if auth.is_match(content) {
        requests.push(RawImport {
            module: "auth".into(),
            kind: "runtime".into(),
        });
    }
    if session.is_match(content) {
        requests.push(RawImport {
            module: "session".into(),
            kind: "runtime".into(),
        });
    }
    requests
}

pub fn targets(scope: &str, request: &RawImport, files: &HashSet<String>) -> Vec<String> {
    let names = if request.kind == "config" {
        vec![format!("config/{}.php", request.module)]
    } else {
        match request.module.as_str() {
            "web_auth" => vec![
                "config/fortify.php".into(),
                "config/auth.php".into(),
                "config/session.php".into(),
                "bootstrap/app.php".into(),
            ],
            "auth" => vec!["config/auth.php".into(), "bootstrap/app.php".into()],
            "session" => vec!["config/session.php".into(), "bootstrap/app.php".into()],
            _ => vec![],
        }
    };
    names
        .into_iter()
        .map(|name| {
            if scope.is_empty() {
                name
            } else {
                format!("{scope}/{name}")
            }
        })
        .filter(|path| files.contains(path))
        .collect()
}
