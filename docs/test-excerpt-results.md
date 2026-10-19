# Focused test excerpts

The excerpt planner prefers a clearly matched case and its shared setup over unrelated sibling cases and enclosing-class fragments. File ranking remains unchanged in this paired replay. Existing index schema 10 remains valid; excerpt strategy 3 refreshes retained ranges once.

## Known-input excerpt check

Two unchanged files from the reported Code Journal case were copied into owned scratch and passed to the public excerpt API as fixed candidates. The task is `Non funziona il login`, with a 32000-token approximate budget and 300 lines per file. This is an isolated excerpt check, not a full 25-file retrieval replay. Original sources were fingerprinted before/after and remain unchanged. Private source and pack contents are not published.

| Input | Code lines before | Final | Code tokens before | Final | Other complete cases before | Final | Checked setup before / final |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| callbacks | 39 | 27 | 409 | 240 | 2 | 0 | incomplete / present |
| class | 113 | 93 | 1417 | 1002 | 5 | 0 | incomplete / present |

Both matched cases retain all assertions. The PHP check includes the Pest binding and lifecycle hook. The Python check includes lifecycle methods, the CLI helper, referenced constants and the HTTP fixture class. Combined code tokens fall from 1826 to 1242 (32.0%); this excludes prompt headers and is not a whole-pack token estimate.

## Existing corpus replay

| Suite | Tasks | Essential lines before / final | Supporting lines before / final | Mean tokens before / final |
| --- | ---: | --- | --- | --- |
| primary | 80 | 62.4% / 62.6% | 21.3% / 23.8% | 15175 / 15085 |
| domains | 4 | 50.0% / 50.0% | 50.0% / 50.0% | 15994 / 15994 |
| validation | 18 | 39.4% / 39.4% | unavailable / unavailable | 13941 / 13889 |
| callbacks | 4 | 64.6% / 64.6% | 63.3% / 63.3% | 13412 / 13252 |

All 106 Context tasks on 32 repositories complete at 16000 `o200k_base` tokens, preserving annotated essential coverage and selected file lists. Every fresh reference source hash, selected list and range matches the canonical callback-update report. The paired JSON stores changed ranges per path; unchanged ranges remain in the linked canonical baselines. The four manifests and labels are unchanged.

Frozen supporting labels retain the reported loss on `outline--outline-4`: the video task labels an `isAudio` assertion plus closing delimiters as supporting context. The planner omits that audio sibling. Task `a5313bdc` requests independent annotation review; the label and raw loss have not been changed.

The three separate historical Context cases keep file recall and top-five recall at 1.0 with no forbidden files. Raw line coverage changes from 100.0% to 98.2%: the acronym case omits one annotated blank separator at pinned `interactive-prompt.ts:221`. All required nonempty statements remain. That case's raw completeness loss remains in the report.

## Initial outcomes and corrections

The first measured candidate is preserved in [the initial paired data](test-excerpt-first.json). It retained essential coverage but lost the Spring JDK client supporting helper under a contended budget. The helper was recognized; optional container fragments consumed the allowance first. A generic eight-file weighted-budget regression reproduced that failure. The corrected ordering keeps the strongest case, then required setup/helpers, before optional container context and extra cases. Later fixtures also exposed missing Playwright test-bound hooks and local inherited setup; both now pass.

Twelve focused fixtures cover callback/class precision, complete assertions, scoped hook aliases, transitive helpers/bindings, fixtures, local inheritance, qualified Java lifecycle annotations, explicit files/classes/cases/helpers, error/diff locations, determinism and constrained BPE budgets. Explicit `./` file references preserve their whole-file override; the final compatibility replay retains identical quality, selections and ranges on all 106 corpus tasks. Final verification passes 97 Rust tests, 59 Python tests, formatting, clippy with denied warnings, Rust 1.90 all-target checks and the release build.

## Limits and reproduction

All 32 repositories and the private case are known calibration data. Labels are sparse and agent-reviewed; these results do not establish general precision, total noise or task-solving success. Independent unseen-cohort task `96e8b6af` remains open. Lifecycle recognition and file-local identifier following are syntax heuristics, not complete framework or fixture resolution. Dynamic setup, cross-file inheritance, indirect factories and overlapping single-line registrations can require explicit references or retain broader excerpts. Normal token/line limits still apply. Concurrent single-sample timings are diagnostic, not a performance claim.

```bash
cargo build --release --locked
python3 scripts/corpus.py run --manifest benchmarks/corpus.json --split all --methods context --budgets 16000 --jobs 4 --output primary.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-domains.json --split all --methods context --budgets 16000 --jobs 4 --output domains.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-validation.json --split all --methods context --budgets 16000 --jobs 4 --output expansion.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-callback-validation.json --split all --methods context --budgets 16000 --jobs 4 --output callbacks.json
```

[Final paired metrics, range deltas and source/build fingerprints](test-excerpt-results.json) include every case, omissions, the fixed-file probe and the historical before/after reports. Canonical references are the preceding [primary](callback-primary-results.json), [domain](callback-domains-results.json), [expansion](callback-validation-results.json) and [four-case](callback-validation-after.json) reports. Measured final binary SHA256: `32ef6150a62e1de044addc9ff1e68f1ac17320b1e4a7f19eaf159ef20cae9f6b`.
