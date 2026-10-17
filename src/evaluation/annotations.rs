use serde::{Deserialize, Serialize};

fn is_false(value: &bool) -> bool {
    !value
}
fn evaluation_split() -> String {
    "eval".into()
}

#[derive(Deserialize, Serialize)]
pub struct Dataset {
    #[serde(default, skip_serializing_if = "is_false", rename = "projectIsolation")]
    pub project_isolation: bool,
    pub cases: Vec<Case>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub framework: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub category: String,
}
impl Metadata {
    pub fn is_empty(&self) -> bool {
        self.project.is_empty()
            && self.language.is_empty()
            && self.framework.is_empty()
            && self.kind.is_empty()
            && self.category.is_empty()
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Case {
    pub name: String,
    pub root: String,
    pub task: String,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default = "evaluation_split")]
    pub split: String,
    pub expected_files: Vec<String>,
    #[serde(default)]
    pub forbidden_files: Vec<String>,
    #[serde(default)]
    pub expected_ranges: Vec<ExpectedRange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub supporting_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub supporting_ranges: Vec<ExpectedRange>,
    #[serde(default, skip_serializing_if = "Metadata::is_empty")]
    pub metadata: Metadata,
}

#[derive(Deserialize, Serialize)]
pub struct ExpectedRange {
    pub path: String,
    pub start: usize,
    pub end: usize,
}
