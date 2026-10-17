use context::{config::Config, evaluation};
use serde_json::json;
use std::{fs, path::Path};

fn dataset(value: serde_json::Value) -> evaluation::Dataset {
    serde_json::from_value(value).unwrap()
}

#[test]
fn selected_files_are_distinct_from_essential_code_and_unknown_is_not_noise() {
    let root = tempfile::tempdir().unwrap();
    let source = format!(
        "export function payment() {{}}\n{}export const essential = 1;\n",
        "// padding\n".repeat(100)
    );
    let line = source.lines().count();
    fs::write(root.path().join("payment.ts"), &source).unwrap();
    fs::write(root.path().join("test.ts"), &source).unwrap();
    fs::write(root.path().join("notes.ts"), "// payment mention\n").unwrap();
    let dataset = dataset(
        json!({"cases":[{"name":"partial context","root":".","task":"payment","expectedFiles":["payment.ts"],"expectedRanges":[{"path":"payment.ts","start":line,"end":line}],"supportingFiles":["test.ts"],"supportingRanges":[{"path":"test.ts","start":line,"end":line}]}]}),
    );
    let config = Config {
        max_files: 3,
        max_lines_per_file: 1,
        ..Default::default()
    };
    let report =
        evaluation::evaluate_method(&dataset, root.path(), &config, "all", "lexical").unwrap();
    assert_eq!(report.summary.recall, 1.0);
    assert_eq!(report.summary.excerpt_recall, 1.0);
    assert_eq!(report.summary.range_coverage, Some(0.0));
    assert_eq!(report.summary.complete_context, 0.0);
    assert_eq!(report.summary.supporting_recall, Some(1.0));
    assert_eq!(report.summary.supporting_range_coverage, Some(0.0));
    assert_eq!(report.summary.judged_precision, Some(1.0));
    assert_eq!(report.summary.forbidden_matches, 0);
    assert_eq!(report.cases[0].unknown_files, vec!["notes.ts"]);
    assert_eq!(report.cases[0].missing_ranges[0].start, line);
    assert_eq!(report.cases[0].missing_supporting_ranges[0].start, line);
}

#[test]
fn repository_isolation_is_checked_across_all_splits() {
    let root = tempfile::tempdir().unwrap();
    let dataset = dataset(json!({"projectIsolation":true,"cases":[
        {"name":"a","root":"a","split":"train","task":"payment","expectedFiles":["payment.ts"],"metadata":{"project":"Owner/Repo"}},
        {"name":"b","root":"b","split":"eval","task":"payment","expectedFiles":["payment.ts"],"metadata":{"project":"owner/repo"}}
    ]}));
    let error =
        evaluation::evaluate(&dataset, root.path(), &Config::default(), "eval").unwrap_err();
    assert!(error.to_string().contains("both train and eval"));
}

#[test]
fn project_macro_rates_do_not_give_more_weight_to_projects_with_more_tasks() {
    let root = tempfile::tempdir().unwrap();
    for directory in ["a", "b"] {
        fs::create_dir(root.path().join(directory)).unwrap();
    }
    fs::write(
        root.path().join("a/payment.ts"),
        "export function payment() {}\n",
    )
    .unwrap();
    fs::write(
        root.path().join("b/weather.ts"),
        "export function weather() {}\n",
    )
    .unwrap();
    let dataset = dataset(json!({"cases":[
        {"name":"a1","root":"a","task":"payment","expectedFiles":["payment.ts"],"metadata":{"project":"a","language":"typescript"}},
        {"name":"a2","root":"a","task":"payment","expectedFiles":["payment.ts"],"metadata":{"project":"a","language":"typescript"}},
        {"name":"b","root":"b","task":"refund","expectedFiles":["weather.ts"],"metadata":{"project":"b","language":"javascript"}}
    ]}));
    let report = evaluation::evaluate(&dataset, root.path(), &Config::default(), "all").unwrap();
    assert!((report.summary.complete_context - 2.0 / 3.0).abs() < 1e-10);
    assert_eq!(report.project_macro_summary.complete_context, 0.5);
    assert_eq!(
        report.groups["language"]["javascript"]
            .metrics
            .excerpt_recall,
        0.0
    );
    assert_eq!(report.cases[2].omissions["weather.ts"], "not_selected");
}

#[test]
fn malformed_annotations_fail_before_they_can_create_a_quality_score() {
    let root = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("payment.ts"),
        "export const payment = 1;\n",
    )
    .unwrap();
    for case in [
        json!({"name":"overrun","root":".","task":"payment","expectedFiles":["payment.ts"],"expectedRanges":[{"path":"payment.ts","start":1,"end":20}]}),
        json!({"name":"overlap","root":".","task":"payment","expectedFiles":["payment.ts"],"forbiddenFiles":["payment.ts"]}),
        json!({"name":"escape","root":".","task":"payment","expectedFiles":["../payment.ts"]}),
    ] {
        let data = dataset(json!({"cases":[case]}));
        assert!(evaluation::evaluate(&data, root.path(), &Config::default(), "all").is_err());
    }
}

#[test]
fn adding_evaluation_metadata_preserves_legacy_dataset_fingerprints() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dataset = evaluation::load(&root.join("tests/fixtures/evaluation-history.json")).unwrap();
    let fingerprint = blake3::hash(&serde_json::to_vec(&dataset).unwrap())
        .to_hex()
        .to_string();
    let previous: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("docs/precision-regression-results.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(fingerprint, previous["historicalValidation"]["datasetHash"]);
}

#[test]
fn unsupported_grammars_retain_text_context_and_report_indexed_languages() {
    let root = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("Notify.cs"),
        "public class Notify { void Send() { /* notification retry */ } }\n",
    )
    .unwrap();
    let dataset = dataset(
        json!({"cases":[{"name":"text fallback","root":".","task":"notification retry","expectedFiles":["Notify.cs"],"metadata":{"project":"sample","language":"csharp","framework":"plain"}}]}),
    );
    let report = evaluation::evaluate(&dataset, root.path(), &Config::default(), "all").unwrap();
    assert_eq!(report.summary.excerpt_recall, 1.0);
    assert_eq!(report.cases[0].indexed_languages["csharp"], 1);
    assert_eq!(report.cases[0].indexed_symbols, 0);
}

#[test]
fn legacy_report_comparisons_do_not_invent_missing_excerpt_metrics() {
    let root = tempfile::tempdir().unwrap();
    fs::write(
        root.path().join("payment.ts"),
        "export const payment = 1;\n",
    )
    .unwrap();
    let data = dataset(
        json!({"cases":[{"name":"payment","root":".","task":"payment","expectedFiles":["payment.ts"]}]}),
    );
    let mut report = evaluation::evaluate(&data, root.path(), &Config::default(), "all").unwrap();
    let mut old = serde_json::to_value(&report).unwrap();
    old.as_object_mut().unwrap().remove("groups");
    let baseline = serde_json::from_value(old).unwrap();
    evaluation::compare(&mut report, &baseline).unwrap();
    assert_eq!(report.comparison.as_ref().unwrap()["recallDelta"], 0.0);
    assert!(report.comparison.as_ref().unwrap()["completeContextDelta"].is_null());
}
