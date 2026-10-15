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

Tests create task-specific temporary directories through tempfile. They never modify the checked-in codebases and automatically remove their temporary artifacts. Test Git commits disable signing and user hooks within their isolated invocation.

## Benchmarks

~~~bash
cargo build --release --locked
python3 scripts/benchmark.py --files 1000 10000 --repetitions 3
~~~

The script generates deterministic TypeScript source projects in a single owned temporary directory. It measures complete subprocess wall time, including startup, for initial indexing, unchanged indexing and pack creation. Warm operations report the median. Filesystem caches are not cleared, and this is a synthetic workload rather than a representative benchmark of every framework.

An optional `--baseline <compiled-cli.js>` runs the former implementation through Node on an equivalent copy. The baseline must have working native SQLite bindings for the installed Node version. `--output <report.json>` saves results; temporary projects are cleaned on success and failure.

See `benchmark-results.json` for the measured results from the rewrite. Compare releases on the same machine, filesystem, options and workload.

## Measured results

Linux x86-64, release build, 2026-10-14. Each source file has a class, 12 methods and a relative import. Warm values are medians of three complete subprocess invocations.

| Source files | Initial index | Unchanged index | Pack creation |
| ---: | ---: | ---: | ---: |
| 1,000 | 198 ms | 25 ms | 84 ms |
| 10,000 | 1,381 ms | 58 ms | 596 ms |

The first Rust benchmark exposed unindexed full-text deletions by path and an unindexed import-request lookup. Binding FTS row IDs to file row IDs and adding the import-request index reduced the 10,000-file initial index from 32.7 seconds to 1.38 seconds on this synthetic workload.

The TypeScript comparison could not run: its better-sqlite3 11.10.0 module failed to load and failed rebuilding under local Node 26.7.0. These figures describe the Rust implementation and its own indexing optimization, not a Rust-versus-TypeScript speedup.
