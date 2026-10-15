# Measuring context quality

`context evaluate` measures selection and excerpts on labeled tasks. Source projects are copied to one automatically cleaned temporary directory; Context's index is created in those copies. Evaluation does not create saved packs or modify the supplied projects. Symlinks are not copied. Dependency/build directories use the normal exclusions unless a custom `.ctxignore` specifies otherwise.

## Dataset

~~~json
{
  "cases": [
    {
      "name": "Payment validation regression",
      "root": "checkout-service",
      "split": "eval",
      "task": "Reject negative totals during payment validation",
      "expectedFiles": ["src/payments.ts", "tests/payments.test.ts"],
      "forbiddenFiles": ["src/weather.ts"],
      "expectedRanges": [
        {"path": "src/payments.ts", "start": 45, "end": 62}
      ]
    }
  ]
}
~~~

`root` is relative to `--projects` (the CLI project root by default). Cases must remain inside that directory. `expectedFiles` is required and must be nonempty. Paths match exactly or by a whole path suffix, so a basename can label an existing fixture, but full project-relative paths avoid ambiguity. Line ranges are inclusive and 1-based. Overlapping expected ranges are deduplicated. Use `split: "train"` for calibration and `"eval"` for tasks kept separate from tuning. The default split is `eval`.

~~~bash
context evaluate cases.json --projects /path/to/projects --split train --json
context evaluate cases.json --projects /path/to/projects --split eval --output baseline.json
context evaluate cases.json --projects /path/to/projects --split eval --baseline baseline.json --json
~~~

`--max-files`, `--budget-tokens` and `--tokenizer` override project settings for the run. `--min-recall 0.9` causes an unsuccessful exit when mean recall is below 0.9. The report is still printed/written before that check.

The earlier grouped `tests/fixtures/scenarios.json` format is also accepted, with `codebase` interpreted relative to `--projects`:

~~~bash
context evaluate tests/fixtures/scenarios.json --projects tests/codebases --split all --json
~~~

Its `expectedFiles` annotations feed retrieval metrics. The original regression suite separately enforces its `expectedInTop5` assertions.

## Historical changes

A case may specify `revision` to evaluate a pinned source snapshot:

~~~json
{
  "name": "Acronym completion change",
  "root": ".",
  "revision": "0033a5a",
  "split": "eval",
  "task": "Make acronym matching case-insensitive with segmented prefixes",
  "expectedFiles": ["src/cli/utils/interactive-prompt.ts"]
}
~~~

The source must be a Git repository root and the revision must be available locally. Context resolves it to a commit and streams a Git archive into its temporary directory. It creates no worktree, changes no branch and fetches nothing. Only regular archive entries are extracted. Git history/hotspot signals are absent from isolated evaluation snapshots; these reports measure static retrieval and excerpt quality.

`tests/fixtures/evaluation-history.json` contains tasks grounded in actual Context commits, including the Node-era completion change and native Rust pack composition. Run it from a full repository checkout:

~~~bash
context evaluate tests/fixtures/evaluation-history.json --max-files 15 --min-recall 1 --json
~~~

These few hand-labeled examples are a regression baseline, not evidence that every repository or task will achieve the same results. Expand the dataset with reviewed tasks from the projects where you use Context. Keep evaluation tasks separate from the tasks used to adjust ranking weights.

The shared native build workflow runs the historical dataset with a minimum recall of 1 on Linux x86_64, Linux ARM64 and macOS ARM64 before packaging. The source checkout includes complete Git history for those pinned snapshots. Cargo-source installations can run custom datasets without Git history; the historical fixture itself requires a full Context checkout.

## Report interpretation

| Metric | Meaning |
| --- | --- |
| `precision` | Fraction of selected files matching a positive file annotation |
| `recall` | Fraction of positive file annotations retrieved |
| `recallAt5` | Positive annotations retrieved among the first five files |
| `reciprocalRank` | Inverse rank of the first positive file; zero when missing |
| `rangeCoverage` | Fraction of expected source lines present in the excerpts |
| `forbiddenMatches` | Selected files explicitly labeled irrelevant |
| `tokens` | Complete prompt text under the selected tokenizer |
| `usefulLinesPer1000Tokens` | Expected covered lines per thousand prompt tokens |
| `indexMs`, `selectionMs` | Indexing and selection/excerpt wall time, excluding snapshot copying |

Summary precision, recall, rank and timing metrics are per-case means. Tokens and forbidden matches are totals. Coverage metrics average only cases with line annotations; missing line annotations produce null, not a perfect score. Precision assumes the positive labels describe all useful files. With incomplete annotations it underestimates usefulness, so review selected file lists before treating every additional dependency as noise.

Baseline comparisons require matching normalized dataset hashes, case names/splits, indexed source hashes and resolved revision commits. They report retrieval, token and selection-time deltas. These checks prevent accidentally comparing changed ground truth or source snapshots. Timings remain sensitive to filesystem caches, CPU load and compilation profile. Use the same build, host conditions and tokenizer settings when measuring speed; label deliberate budget/tokenizer changes when comparing quality.
