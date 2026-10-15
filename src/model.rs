use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileMetadata {
    pub path: String,
    pub language: String,
    pub size: u64,
    pub mtime: i64,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub file_path: String,
    pub name: String,
    pub kind: String,
    pub start_line: usize,
    pub end_line: usize,
    pub signature: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct ImportRelation {
    pub source_path: String,
    pub target_path: String,
    pub symbol: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSignal {
    pub path: String,
    pub last_modified: Option<String>,
    pub commit_count: u64,
    pub churn_score: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTask {
    pub raw: String,
    pub raw_words: Vec<String>,
    pub keywords: Vec<String>,
    pub files_hint: Vec<String>,
    pub symbols: Vec<String>,
    pub domains: Vec<String>,
    pub domain_weights: BTreeMap<String, f64>,
    pub change_type: String,
    pub confidence: TaskConfidence,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TaskConfidence {
    pub overall: f64,
    pub signals: BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Candidate {
    pub path: String,
    pub score: f64,
    pub reasons: Vec<String>,
    #[serde(skip)]
    pub reserved: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Excerpt {
    pub path: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub total_lines: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StacktraceEntry {
    pub file: String,
    pub line: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiffEntry {
    pub file: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    #[serde(skip)]
    pub changed_lines: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct PackOptions {
    pub task: Option<String>,
    pub error: Option<String>,
    pub since: Option<String>,
    pub diff: Option<String>,
    pub file: Option<String>,
    pub symbol: Option<String>,
    pub max_files: usize,
    pub budget_tokens: usize,
    pub include: Vec<String>,
    pub exclude: Vec<String>,
    pub focus: Vec<String>,
}

impl Default for PackOptions {
    fn default() -> Self {
        Self {
            task: None,
            error: None,
            since: None,
            diff: None,
            file: None,
            symbol: None,
            max_files: 25,
            budget_tokens: 32_000,
            include: vec![],
            exclude: vec![],
            focus: vec![],
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub files: usize,
    pub symbols: usize,
    pub imports: usize,
    pub updated: usize,
    pub removed: usize,
    pub duration_ms: u128,
}
