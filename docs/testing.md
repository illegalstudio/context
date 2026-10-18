# Testing and Benchmarks

## Checks

~~~bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
python3 -m unittest discover -s tests -p 'test_*.py'
~~~

`make check` runs formatting, clippy, Rust tests and the Python release tests. CI checks Linux x86_64, Linux ARM64, macOS ARM64 and Windows, and the minimum supported Rust toolchain on Linux. It also builds portable archives and native pacman packages without publishing them. See [releases](releases.md) for signing and distribution checks.

## Regression coverage

`tests/fixtures/scenarios.json` preserves the original task-selection scenarios. `tests/regression.rs` evaluates them against copied sample codebases, asserting required files, top-five placement and forbidden results.

Additional regressions cover structural declarations and comment handling across every bundled grammar, deletion/rename cleanup, new import targets, verification with preserved metadata, nested ignore files and negation, file-size/binary exclusions, TypeScript and PHP aliases, Python relative imports, Rust grouped/public imports, cyclic graphs, deterministic ranking, Italian task resolution, custom/disabled domains, CLI validation, Git history/diff hints, log filtering, pack budgets and readable archives.

`tests/features.rs` covers deep structural anchors, multiple complete functions, balanced allocation, both BPE vocabularies, inherited/nested project configuration, local exports, crate roots, explicit framework relationships, search/explain evidence, legacy manifests and chained incremental updates. `tests/mcp.rs` starts the actual stdio server and exercises SDK negotiation, tool calls, resources, validation errors and ping with response timeouts and automatic child cleanup.

`tests/retrieval.rs` covers natural-language symbol collisions in multiple languages, explicit short identifiers, document-frequency weighting, generated-asset penalties and refreshed classification, oversized-line fairness with all three tokenizers, implementation/test balance, ambiguous web/CLI authentication, nested framework domains, scope-specific exclusions, language filters, persisted framework metadata, scoped Inertia page links and package boundaries. The original language-collision, asset, budget, authentication and nested-framework tests were confirmed failing before the corrections.

`retrieval-regression-results.json` records a local calibration replay of the reported login failure. It uses a pinned Code Journal source archive augmented with four generated assets referenced by the saved pack; Git history alone omits those untracked assets. Before/after source hashes match, and the original pack's hashes were verified unchanged. The two task variants retrieve 5/6 and 4/6 annotated files after correction, compared with 2/6 each beforehand, and select none of the captured generated assets. Every selected file receives an excerpt. The original request now includes the Fortify provider, auth/Fortify configuration, frontend login and CLI login. These tasks informed the fixes, so this replay is calibration evidence rather than a held-out quality estimate; the report retains missed labels.

`tests/precision.rs` covers literal corpus tokens, query-origin weights, access/login ambiguity, real imports versus lexical mentions, hub damping, scoped runtime/configuration links, quoted examples and comments, marginal stopping, explicit exclusions, CLI intent, test focus, dependency fan-out, query limits and incremental refresh after changed query evidence. Language names in nested fixture scopes cannot restrict production dependency expansion. A subprocess timeout regression reproduces the previously hanging class/method clipping case under a 250-token budget.

`precision-regression-results.json` compares the development 0.3.1 baseline with the next precision changes on identical frozen Code Journal sources. Five local regression tasks cover Italian/English login, project access permissions, Billing plan limits and CLI device login. Mean labeled-file recall rises from 0.857 to 1, and forbidden matches fall from 5 to 0. The two login requests now include all seven annotated files, including session configuration and bootstrap. The CLI request selects 9 files instead of 25. All selected files receive excerpts. Token usage is workload-dependent: the Italian login grows from 13716 to 14016 tokens, and English login grows from 11837 to 16839 as coverage expands; the other three cases use fewer tokens. These cases include tuning feedback and are calibration evidence. The original saved packs were verified unchanged, and the report records both binary hashes, source hashes, expected/missed labels and the token tradeoffs.

Use [quality evaluation](evaluation.md) to measure retrieval and line coverage separately from correctness tests. Its historical fixture pins real repository commits and supports baseline comparisons without modifying the source checkout.

`evaluation-results.json` records the release-profile baseline on two pinned historical evaluation tasks, with 15 selected files per task and the default 32000-token approximate budget. It retrieves both labeled target files and covers 98.2% of the annotated lines. Positive annotations are deliberately sparse, so its precision value should not be read as a complete relevance judgment. Use this report as a reproducible starting point and add reviewed tasks before tuning ranking.

Tests create task-specific temporary directories through tempfile. They never modify the checked-in codebases and automatically remove their temporary artifacts. Test Git commits disable signing and user hooks within their isolated invocation.

`tests/cross_project.rs` covers first-party opt-ins under dependency directories, preservation through initialization and evaluation copies, custom exclusion precedence, syntactic test roles and legacy JSON, implementation coverage against repetitive inline tests, separated regions in long functions, active session configuration and package-aware direct tests.

Configuration cases cover missing external TypeScript presets, preservation of local mappings, import refresh when a preset appears without source changes, diagnostics for missing local configs and strict handling of invalid configurations or paths outside the root. Java cases verify import semantics and incremental invalidation. A bounded subprocess indexes 1500 Java consumers with 36000 missing external imports and verifies the 1500 real edges; it kills and reaps the child if the 30-second deadline expires.

Excerpt regressions preserve early text guards, retain guard clauses when repeated query concepts do not justify fragmentation, avoid redundant counterpart tests, protect implementation tokens from aggregate test growth, lift the quota for testing focus, lend unused capacity, and refresh legacy incremental packs after excerpt policy changes. A scorer regression where keyword-heavy helper comments suppressed the actual decoder was reproduced against the first candidate: zero required-line coverage before correction and full coverage afterwards.

## Cross-project quality measurement

`tests/evaluation.rs` verifies repository split isolation, excerpt-aware completeness, supporting test ranges, unclassified relevance, project-macro aggregation, malformed annotations, legacy dataset/report compatibility and text fallback. `tests/test_corpus.py` validates the primary 80-task/16-project corpus and four supplementary domain tasks on two additional projects, a fresh 18-task validation suite on ten disjoint repositories, supporting-file failure denominators, archive/source fingerprints, extraction boundaries and cleanup, shared-parent concurrent downloads, failure denominators, parallel failure retention, Git-history isolation and child timing/timeout cleanup.

Use [cross-project evaluation](evaluation.md#cross-project-corpus) for the complete protocol and commands. The manual `corpus.yml` workflow runs pinned public sources independently of ordinary offline tests. Third-party sources and application dependencies are not bundled into the source package. The benchmark measures static context retrieval and excerpts, with agent-reviewed annotations; it does not execute upstream application tests or establish task-solving success.

## Benchmarks

~~~bash
cargo build --release --locked
python3 scripts/benchmark.py --files 1000 10000 --repetitions 3
~~~

The script generates deterministic TypeScript source projects in a single owned temporary directory. It measures complete subprocess wall time, including startup, for initial indexing, unchanged indexing and pack creation. Warm operations report the median. Filesystem caches are not cleared, and this is a synthetic workload rather than a representative benchmark of every framework.

An optional `--baseline <compiled-cli.js>` runs the former implementation through Node on an equivalent copy. The baseline must have working native SQLite bindings for the installed Node version. `--output <report.json>` saves results; temporary projects are cleaned on success and failure.

See `benchmark-results.json` for the measured results from the rewrite. Compare releases on the same machine, filesystem, options and workload.

`feature-benchmark-results.json` records a subsequent release-profile run with structural excerpts and the new integrations, using the same synthetic generator and three warm repetitions. The recorded benchmark ran after this task's builds and tests completed. At 10000 generated source files it measured 1.418 s for initial indexing, 59.4 ms for unchanged indexing and 577.5 ms for pack creation. These are workload-specific measurements, not a statistically established speedup over the earlier run.

## Measured results

Linux x86-64, release build, 2026-10-14. Each source file has a class, 12 methods and a relative import. Warm values are medians of three complete subprocess invocations.

| Source files | Initial index | Unchanged index | Pack creation |
| ---: | ---: | ---: | ---: |
| 1,000 | 198 ms | 25 ms | 84 ms |
| 10,000 | 1,381 ms | 58 ms | 596 ms |

The first Rust benchmark exposed unindexed full-text deletions by path and an unindexed import-request lookup. Binding FTS row IDs to file row IDs and adding the import-request index reduced the 10,000-file initial index from 32.7 seconds to 1.38 seconds on this synthetic workload.

The TypeScript comparison could not run: its better-sqlite3 11.10.0 module failed to load and failed rebuilding under local Node 26.7.0. These figures describe the Rust implementation and its own indexing optimization, not a Rust-versus-TypeScript speedup.
