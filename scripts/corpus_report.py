"""Summaries for frozen-corpus runs, including unsuccessful cases in denominators."""
from collections import defaultdict
import json
from pathlib import Path


def summarize(rows):
    successful = [row for row in rows if row["status"] == "ok"]
    size = len(rows)
    def average(key):
        return sum(row.get("metrics", {}).get(key, 0) or 0 for row in rows) / max(size, 1)
    return {
        "cases": size, "successful": len(successful), "errors": size - len(successful),
        "recall": average("recall"), "excerptRecall": average("excerptRecall"),
        "rangeCoverage": average("rangeCoverage"), "completeContextRate": average("completeContext"),
        "supportingRangeCoverage": optional_mean(rows, "supportingRangeCoverage"),
        "judgedPrecision": optional_mean(rows, "judgedPrecision"),
        "unknownFiles": sum(row.get("metrics", {}).get("unknownFiles", 0) for row in rows),
        "forbiddenMatches": sum(row.get("metrics", {}).get("forbiddenMatches", 0) for row in rows),
        "tokens": sum(row.get("metrics", {}).get("tokens", 0) for row in rows),
        "meanTokensPerSuccessfulCase": sum(row["metrics"]["tokens"] for row in successful) / max(len(successful), 1),
        "selectedFiles": sum(len(row.get("selectedFiles", [])) for row in rows),
        "judgedFileFraction": (sum(len(row.get("selectedFiles", []))-row.get("metrics", {}).get("unknownFiles", 0) for row in rows)/max(sum(len(row.get("selectedFiles", [])) for row in rows),1)),
        "supportingAnnotatedCases": sum(bool(row.get("hasSupportingRanges")) for row in rows),
        "judgedCases": sum(row.get("metrics", {}).get("judgedPrecision") is not None for row in rows),
        "forbiddenTokens": sum(row.get("metrics", {}).get("forbiddenTokens", 0) for row in rows),
        "meanWallMs": sum(row["wallMs"] for row in rows) / max(size, 1),
        "meanSuccessfulWallMs": sum(row["wallMs"] for row in successful)/max(len(successful),1),
        "peakRssBytes": max((row["peakRssBytes"] for row in rows if row.get("peakRssBytes") is not None), default=None),
    }


def optional_mean(rows, key):
    if key == "supportingRangeCoverage":
        values = [row.get("metrics", {}).get(key, 0) or 0 for row in rows if row.get("hasSupportingRanges")]
    else:
        values = [row["metrics"][key] for row in rows if row["status"] == "ok" and row["metrics"].get(key) is not None]
    return sum(values) / len(values) if values else None


def groups(rows):
    result = {}
    for dimension in ["language", "framework", "project", "kind", "category", "split", "size"]:
        buckets = defaultdict(list)
        for row in rows:
            value = row.get("sizeClass", "unavailable") if dimension == "size" else row["metadata"][dimension]
            buckets[value].append(row)
        result[dimension] = {key: summarize(value) for key, value in sorted(buckets.items())}
    return result


def report(manifest, rows, identity, settings):
    runs = {}
    for method in settings["methods"]:
        for budget in settings["budgets"]:
            cases = [row for row in rows if row["method"] == method and row["budgetTokens"] == budget]
            if not cases:
                continue
            grouped = groups(cases)
            runs[f"{method}:{budget}"] = {"summary": summarize(cases), "groups": grouped,
                "projectMacro": {key: sum(group[key] for group in grouped["project"].values()) / len(grouped["project"])
                    for key in ["recall", "excerptRecall", "rangeCoverage", "completeContextRate"]}}
    return {"schemaVersion": 1, "corpusHash": identity["corpusHash"], "binarySha256": identity["binarySha256"],
        "rankingFingerprint": identity.get("rankingFingerprint"), "settings": settings,
        "protocol": manifest["protocol"], "runs": runs, "cases": rows,
        "interpretation": "Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking."}


def markdown(data):
    lines = ["# Cross-project retrieval baseline", "", data["interpretation"], "",
        "| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for name, run in data["runs"].items():
        method, budget = name.split(":")
        m = run["summary"]
        lines.append(f"| {method} | {budget} | {m['cases']} | {m['errors']} | {m['excerptRecall']:.1%} | {m['rangeCoverage']:.1%} | {m['completeContextRate']:.1%} |")
    lines += ["", "## Supporting code, cost and annotation scope", "", "| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for name, run in data["runs"].items():
        method, budget = name.split(":")
        m = run["summary"]
        supporting = f"{m['supportingRangeCoverage']:.1%}" if m['supportingRangeCoverage'] is not None else 'unavailable'
        lines.append(f"| {method} | {budget} | {m['supportingAnnotatedCases']} | {supporting} | {m['meanTokensPerSuccessfulCase']:.0f} | {m['forbiddenMatches']} | {m['judgedFileFraction']:.1%} |")
    lines += ["", "## Repository splits at 16000 tokens", "", "| Split | Method | Cases | Errors | Essential lines | Complete context |", "| --- | --- | ---: | ---: | ---: | ---: |"]
    for name, run in data["runs"].items():
        method, budget = name.split(":")
        if budget == "16000":
            for split, m in run["groups"]["split"].items():
                lines.append(f"| {split} | {method} | {m['cases']} | {m['errors']} | {m['rangeCoverage']:.1%} | {m['completeContextRate']:.1%} |")
    lines += ["", "## Language results at 16000 tokens", "", "| Language | Method | Cases | Errors | Essential lines | Complete context |", "| --- | --- | ---: | ---: | ---: | ---: |"]
    for name, run in data["runs"].items():
        method, budget = name.split(":")
        if budget != "16000":
            continue
        for language, m in run["groups"]["language"].items():
            lines.append(f"| {language} | {method} | {m['cases']} | {m['errors']} | {m['rangeCoverage']:.1%} | {m['completeContextRate']:.1%} |")
    lines += ["", "## Projects at 16000 tokens", "", "| Project | Method | Cases | Errors | Essential lines | Complete context |", "| --- | --- | ---: | ---: | ---: | ---: |"]
    for name, run in data["runs"].items():
        method, budget = name.split(":")
        if budget == "16000":
            for project, m in run["groups"]["project"].items():
                lines.append(f"| {project} | {method} | {m['cases']} | {m['errors']} | {m['rangeCoverage']:.1%} | {m['completeContextRate']:.1%} |")
    errors = {}
    for row in data["cases"]:
        if row["status"] != "ok":
            errors.setdefault((row["id"], row["error"]), row)
    lines += ["", "## Preparation and evaluation failures", ""]
    if not errors:
        lines += ["No execution failures."]
    for (ident, error), row in sorted(errors.items()):
        status = row['status']
        if status == 'timeout':
            status += f" at {row.get('timeoutSeconds', data['settings'].get('timeoutSeconds', 'configured'))} seconds"
        lines.append(f"- `{ident}` ({status}): {error.replace(chr(10), ' ')[:400]}")
    if data.get("measurementNotes"):
        lines += ["", "## Measurement conditions", ""]
        lines += [f"- {note}" for note in data["measurementNotes"]]
    lines += ["", "The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.", ""]
    return "\n".join(lines)
