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

## Cross-project corpus

The [corpus](../benchmarks/corpus.json) contains 80 historical tasks from 16 public repositories, with two repositories per structurally parsed language. Eight whole repositories are `train`, eight are `eval`; a repository never contributes to both splits. Cases use the parent of a specific upstream correction, with full parent/fix commits, archive SHA256, source-range fingerprints and an upstream evidence URL. Only original task descriptions and annotations are stored here; third-party sources remain temporary downloads under their original licenses.

| Language | Development repository | Evaluation repository |
| --- | --- | --- |
| PHP | [Koel](https://github.com/koel/koel), Laravel/Vue application | [HttpFoundation](https://github.com/symfony/http-foundation), Symfony library |
| Python | [Flask](https://github.com/pallets/flask), framework | [Wagtail](https://github.com/wagtail/wagtail), Django application |
| TypeScript | [Nest](https://github.com/nestjs/nest), framework | [Outline](https://github.com/outline/outline), application |
| JavaScript | [Express](https://github.com/expressjs/express), framework/examples | [Node-RED](https://github.com/node-red/node-red), application monorepo |
| Go | [Chi](https://github.com/go-chi/chi), HTTP library | [Cobra](https://github.com/spf13/cobra), CLI library |
| Rust | [Axum](https://github.com/tokio-rs/axum), HTTP framework | [Starship](https://github.com/starship/starship), CLI |
| Ruby | [Sinatra](https://github.com/sinatra/sinatra), framework | [RuboCop](https://github.com/rubocop/rubocop), CLI |
| Java | [Gson](https://github.com/google/gson), library | [Spring](https://github.com/spring-projects/spring-framework), framework monorepo |

The initial labels were reviewed against upstream patches and pre-fix source by the implementing agent before retrieval runs. They comprise 129 required implementation windows, 74 supporting test windows, and one inspected unrelated module per task. They are sparse, patch-derived annotations, not independently validated or exhaustive ground truth. New tests absent from the parent snapshot are not expected context. Inline Rust test windows are classified separately from implementation. A complete annotated context does not prove that an agent can solve the original issue, or that every necessary dependency was annotated. Most extra files remain unclassified, so zero negative-control matches does not mean zero noise.

A separate [domain corpus](../benchmarks/corpus-domains.json) adds four evaluation tasks from two new applications: payment/refund behavior in [Solidus](https://github.com/solidusio/solidus), a Rails monorepo, and notification delivery/audit behavior in [pretix](https://github.com/pretix/pretix), a Django monorepo. These source labels were frozen separately before their retrieval runs, without changing the primary corpus. The combined inventory is 18 repositories and 84 tasks; the reports remain separate so their provenance and denominators are explicit.

The source revisions, tasks and labels were frozen before the initial corpus measurement. The Context ranking was kept unchanged during this work. Both splits are reported, but the evaluation repositories have not been used to tune retrieval. Once a failed evaluation case informs a ranking change, treat that case as regression data and add fresh independent evaluation cases. Five tasks from one repository are correlated; the corpus supports diagnosis across these projects, not a universal accuracy claim. Tasks are English symptom paraphrases of upstream corrections, not a random sample of end-user investigations. Vague requests and multilingual paraphrases need separate validation. C#, Kotlin, Swift and other text-only languages need additional real-project evaluation; a synthetic C# regression checks text fallback only.

~~~bash
# Offline validation, also covered by make check
python3 scripts/corpus.py validate

# Release-profile measurements, default eval repositories and three BPE budgets
cargo build --release --locked
python3 scripts/corpus.py run --jobs 4 --output docs/corpus-results.json

# Both repository splits, or an individual language/budget
python3 scripts/corpus.py run --split all --jobs 4 --output docs/corpus-results.json
python3 scripts/corpus.py run --language rust --budgets 16000 --methods context lexical

# Concurrent cases within one language, or one reproducible failure
python3 scripts/corpus.py run --language java --partition case --jobs 5
python3 scripts/corpus.py run --case node-red--node-red-1 --budgets 16000

# Supplementary billing and notification probes on new repositories
python3 scripts/corpus.py run --manifest benchmarks/corpus-domains.json --jobs 2 --output docs/corpus-domains-results.json
~~~

The runner downloads pinned GitHub archives, verifies checksums and all annotated source ranges, and extracts only regular files. It executes the Context evaluator; it does not install project dependencies, build applications, run upstream tests or execute repository hooks/configuration. Existing source directories are not changed. Context still reads project manifests and resolves configuration, so unavailable dependency-provided TypeScript configs can cause a measured evaluation failure. First-party source located under a normally ignored directory can appear as `not_indexed`. These outcomes remain in the report; no per-project workaround is silently applied.

Each case uses fixed `maxFiles=25`, `maxLinesPerFile=300`, `maxFileSize=1048576`, `graphDepth=2` and `o200k_base`. Budgets default to 8000, 16000 and 32000 tokens. `context` uses the normal ranking. `lexical` ranks literal split-identifier/path matches and indexed literal content, without graph expansion, domains, translations, synonyms or marginal selection. It shares the excerpt planner and token accounting, with literal-only query evidence for excerpts. This is a simple reference search, not an optimized external search engine.

`--jobs` bounds independent language partitions on Unix; `--partition case` instead bounds cases and also accepts a language filter. Every evaluator process uses two index threads by default (`--index-threads` overrides this). The per-evaluation deadline defaults to 180 seconds (`--timeout` overrides it). Wall time includes isolated source copying, indexing and excerpt construction; downloading and archive extraction are excluded. Peak resident memory is measured per child with `wait4` on Unix and is unavailable on other platforms or aborted processes. Concurrent reference measurements describe a contended workload rather than uncontended latency. Methods run in a fixed order without filesystem cache eviction. Measurements are single samples and do not establish a speedup. Use `--jobs 1` and repeated runs when investigating latency.

`--work-dir` chooses a parent for owned temporary directories; existing content in that parent is preserved. Git discovery is bounded to the owned directory and inherited Git location overrides are removed, so a scratch directory inside another checkout does not acquire its history. `--archive-cache` reads pre-downloaded `<revision>.tar.gz` archives after checksum verification and always extracts fresh snapshots. Normal runs clean their snapshots, child temporary indexes, downloaded archives and per-partition scratch files on success, failure and catchable interruptions. Timeouts terminate and reap owned child processes. `fetch` performs download/source-label verification without retaining third-party sources. Run identity checks reject a manifest or evaluator binary changed during measurement.

The JSON report retains every case's source identity, selected files, actual ranges, omitted required files/lines, unknown files, indexed language/declaration/dependency counts, timing and memory. Groups cover project, language, framework, project kind, task category, split and indexed size. Project-macro rates give each project equal weight. Execution/preparation failures contribute zero to required-file/line coverage and completeness and retain their diagnostic; they are never silently dropped. Supporting-test coverage is averaged over explicitly annotated cases, and judged precision over cases with judged selected files. Inspect their denominators and the unclassified-file fraction.

The generated Markdown report provides a readable overview. The manual **Cross-project retrieval benchmark** GitHub Actions workflow measures language partitions and uploads JSON/Markdown artifacts. Choose `primary` or `domains`, and an appropriate repository split (domain probes use `eval` or `all`). It does not run on every ordinary push, and completion of the workflow is not a minimum-quality guarantee. The initial baseline sets no arbitrary cross-framework recall threshold; regression gates should follow annotation review and an agreed quality/cost policy.

### Initial reference findings (2026-10-17)

The [primary report](corpus-results.md) and [raw measurements](corpus-results.json) retain all 480 method/budget/task combinations: 450 completed evaluations and 30 timeouts. The separate [domain report](corpus-domains-results.md) and [raw domain measurements](corpus-domains-results.json) add 24 completed evaluations. All required token/file limits and source identities were checked. Retrieval source/resource fingerprints remained unchanged throughout.

At 16000 tokens, the primary corpus has complete annotated context in 36/80 cases for Context and 28/80 for the literal baseline. Required-line coverage averages 53.6% versus 46.2%. On the evaluation repositories alone, completeness is 11/40 versus 9/40, with required-line coverage of 33.7% versus 28.7%. These are descriptive outcomes on this small, correlated, provisionally labeled corpus, not statistical evidence of universal superiority or agent task-solving rates.

The results expose distinct limitations:

- Node-RED's required first-party files are under `packages/node_modules/@node-red`, which the default dependency exclusions do not index. All five tasks have zero required-code coverage for both methods.
- Source-file recall hides range-selection failures. Both Axum and Starship have all required source files selected, but Context covers about 96% and 11% of their required lines respectively at 16000 tokens. Wagtail and Outline also have low essential-line coverage.
- All five Spring snapshots exceed the 180-second deadline for both methods at every budget. Those 30 failures stay in the denominators. They require a controlled serial profile before assigning the cause to a particular processing phase or to Java support.
- Supporting-test line coverage averages 20.8% for Context versus 31.7% for the baseline over 53 annotated cases, including failed cases. Better implementation coverage does not by itself supply the direct behavior tests.
- Nine known-negative files are selected by Context versus eight by the baseline at 16000 tokens. Only about 7% of Context's selected files have explicit positive/negative labels; the remaining files require review before total noise can be estimated.

For the four additional billing/notification tasks, both methods have complete annotated context in 2/4 cases at 16000 tokens. Context reaches 3/4 at 32000, while the baseline stays at 2/4. Four cases do not establish a domain-wide guarantee.

Seven completed language partitions were retained from a four-worker run; Java was rerun with five concurrent case workers after discarding the superseded serial Java partition. Supplementary measurements overlapped those batches. Every native evaluation used two index threads and the same 180-second deadline. Timings and memory are diagnostic samples on that contended local host. The reference run predates the runner's explicit Git-discovery ceiling; it had no inherited Git location overrides and its scratch paths have no tracked ancestor history, so no ancestor-history ranking signals were available. The report binary hash identifies the measured release build; a later compatibility guard only changes comparisons with legacy `--baseline` reports, a path these measurements do not use.

The immediate follow-up work is first-party source discovery, essential excerpts, supporting behavior tests and large-monorepo profiling. Review these annotations independently before turning them into hard quality gates. Cases used to guide those fixes become regression data; use fresh repositories for the next independent evaluation.

## Richer native evaluation annotations

Native datasets accept optional `metadata` (`project`, `language`, `framework`, `kind`, `category`), `supportingFiles` and `supportingRanges`. Required `expectedFiles` and `expectedRanges` retain their existing meaning. Add top-level `projectIsolation: true` to reject a project appearing in both repository splits, even when evaluating only one split. Existing datasets keep their original serialized fingerprints when new fields are omitted.

~~~bash
context evaluate cases.json --method lexical --json
context evaluate cases.json --method context --json
~~~

Additional metrics include `excerptRecall` (required files with actual code), `completeContext` (all required files have excerpts and all required source lines are included), `supportingRecall`, `supportingRangeCoverage`, `judgedPrecision`, `unknownFiles` and `forbiddenTokens`. Judged file precision uses only required/supporting positives and explicit forbidden negatives. Unknown files are neither positives nor negatives. `forbiddenTokens` measures excerpt Markdown attributable to known negatives; it excludes their contribution to the shared prompt header. Explanations include `missingFiles`, `missingRanges`, `missingSupportingRanges` and required-file omission reasons (`not_indexed`, `not_selected`, `selected_without_excerpt`). Index statistics help distinguish setup/coverage problems from ranking omissions. New report fields are additive; old report inputs remain readable.

## Fresh repository validation

`benchmarks/corpus-validation.json` reserves 18 additional historical tasks on ten repositories absent from both earlier suites. It covers CakePHP, Starlette, Fastify, tRPC, Hugo, Nushell, Hanami Router, Micronaut, System.CommandLine and Vapor. C# and Swift exercise text fallback alongside the eight structural parser languages. All projects belong to `eval` and remain disjoint by repository identity.

The manifest and 41 required source windows were frozen before the cross-project retrieval changes. The baseline and initial candidate use the same pinned archives, labels, 25-file limit, `o200k_base` encoding and 8000/16000/32000-token budgets. The corrected replay covers all 102 tasks at 16000 tokens, with a literal comparison on the 18-task suite and targeted 8000/32000-token checks for the four affected excerpt cases. An unchanged baseline executable was measured before implementation. The first implementation was frozen before validation scores were examined. Its result exposed three excerpt regressions at 16000 tokens and four evaluation failures from absent external TypeScript presets. Those initial measurements are preserved. Subsequent corrections used that evidence, so the final replay is regression data, not an independent validation estimate.

~~~bash
python3 scripts/corpus.py validate --manifest benchmarks/corpus-validation.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-validation.json --split eval --output validation-results.json
~~~

The manual workflow accepts `suite: validation`. Existing primary and domain cases informed the improvements and now serve as regression data, regardless of their original split names. Use new repositories or privately reserved tasks for subsequent tuning cycles.

Supporting-file recall and supporting-line coverage are separate measurements. A cochanged test file can be a supporting label without a defensible pre-fix assertion window; the validation suite therefore has supporting files but no supporting ranges. Missing annotations are reported as unavailable, never as full coverage. Failed annotated cases contribute zero. GitHub archives can omit test sources through `export-ignore`, so label review must verify the actual archive rather than assume every upstream Git path is present.

These remain sparse, agent-reviewed patch-derived labels. They do not establish general relevance precision, exhaustive behavior coverage or success at solving the underlying task. See the [cross-project improvement results](retrieval-improvements.md) for paired outcomes, costs and limitations.

## Callback test validation

The subsequent [focused-test excerpt replay](test-excerpt-results.md) compares the same 106 known tasks on unchanged manifests. It is regression evidence for excerpt precision, not a new unseen cohort. The separate independent-review task remains open.

`benchmarks/corpus-callback-validation.json` reserves four patch-derived cases on Slim, Koa, Vitest and Bottle, disjoint from the preceding 28 repositories. Tasks, pre-fix ranges, related existing test assertions and archive hashes were frozen before callback retrieval changes; both methods use the same three budgets. Labels were reviewed by the implementing agent, so this is not an independently reviewed cohort. The manual workflow accepts `suite: callbacks`. Preserve the first frozen candidate outcome, including failures, before using these cases for further corrections.
