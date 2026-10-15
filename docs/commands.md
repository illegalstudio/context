# Commands

Global options: `--root <directory>` (or `-C`), `--verbose` (or `-v`), `--help` and `--version`. Commands operate on the current directory by default.

## init

~~~bash
context init [--force]
~~~

Creates settings, detects frameworks and generates ignore defaults. Existing settings and ignore patterns are preserved. `--force` resets settings and ignore patterns; it preserves saved packs.

## index

~~~bash
context index [--verify] [--json]
~~~

Scans and updates the index. `--verify` reads and hashes every eligible file, detecting changes with preserved size and modification time. Unchanged hashes skip parsing. JSON output includes files, symbols, imports, updated and removed counts and durationMs. The updated count reports reparsed files.

## pack

~~~bash
context pack [options]
~~~

| Option | Purpose |
| --- | --- |
| `-t, --task <text>` | Task description, in English or Italian |
| `-e, --error <file>` | Error log with stacktrace hints (up to 16 MiB) |
| `--since <duration>` | Filter timestamped log entries: 30m, 1h, 2d or seconds |
| `-d, --diff <ref>` | Changes between a Git commit/reference and the working tree |
| `-f, --file <path>` | Explicit file hint |
| `-s, --symbol <name>` | Explicit symbol hint |
| `--max-files <count>` | Maximum selected files |
| `--budget-tokens <count>` | Maximum tokens in PACK.md under the selected tokenizer |
| `--tokenizer <name>` | `approx`, `cl100k_base` or `o200k_base` |
| `--update <slug-or-prefix>` | Create a delta against a saved pack; accepts `latest` |
| `--include <categories>` | Permitted optional categories: tests,config,docs |
| `--exclude <patterns>` | Comma-separated Git-style exclusions |
| `--focus <domains>` | Boost known task domains |
| `--verify` | Fully verify source hashes before packing |
| `--json` | Print the generated manifest to stdout |

No input options in a terminal enter interactive task input with `@` and Tab completion. Noninteractive input without a task source exits with an error. Packs always refresh the index first. Diff analysis covers tracked working-tree changes, including deletions, and reports renames as a deletion/addition pair. Untracked files enter the index but are not Git diff hints.

An update inherits the parent's task, file/symbol/diff inputs, filters, limits and tokenizer unless overridden. Source hashes are fully verified for updates. The new manifest describes the complete selection, while `PACK.md` includes excerpts only for new/changed files and instructions to discard removed or replaced context. `UPDATE.md` lists changes and stale relationships. Keep the parent context when consuming a delta. A task/options/tokenizer change refreshes the retained excerpts. Updates of 0.3.0 manifests without source hashes refresh every selected file.

Each file has `sourceHash` and `excerptRanges`. The existing `excerptRange` field remains the first section for compatibility. In an update, unchanged files retain their previous ranges through the parent reference. Historical packs remain readable. Manifests also record the tokenizer, effective configuration, options, parent slug and selected dependency relationships.

## search

~~~bash
context search "payment validation" --limit 5 [--json] [--verify]
context search "processPayment" --tokenizer cl100k_base --json
~~~

Refreshes the index and returns ranked files, matching reasons and score contributions, indexed symbols and focused excerpts. The limit is 1 to 1000. Search uses the same discovery pipeline as packs and bounds excerpt output to 8000 selected-tokenizer tokens and 60 lines per file. JSON metadata and symbol lists are additional to this excerpt budget. It does not create saved packs.

## explain

~~~bash
context explain src/payments.ts --task "Fix checkout" --json
context explain src/payments.ts --task "Fix checkout" --max-files 5 --exclude 'vendor/'
~~~

Reports whether a file is indexed and selected, its rank among candidates, normalized score contributions, reasons and dependency edges. The contributions sum to the file's score. Scores are relative heuristic weights, not probabilities. An excluded path is reported as `excluded_by_pattern`; a ranked candidate outside the limit is `below_file_limit`. An unknown/unranked path may be unindexed or have no matching signals. Ambiguous basenames require a project-relative path.

## evaluate

~~~bash
context evaluate tests/fixtures/evaluation-history.json --max-files 15 --json
context evaluate cases.json --projects /path/to/projects --split eval --output report.json
context evaluate cases.json --baseline report.json --min-recall 0.9 --json
~~~

Runs labeled tasks against isolated copies or pinned Git revisions, without creating packs or editing source projects. Supports `--split train|eval|all`, `--max-files`, `--budget-tokens` and `--tokenizer`. Reports retrieval precision/recall, recall at five, reciprocal rank, expected line coverage, forbidden matches, tokens and timings. `--min-recall` causes exit 1 below the threshold. A baseline must describe the same dataset, splits and indexed source snapshots. See [evaluation](evaluation.md) for the dataset schema and interpretation.

## mcp

~~~bash
context --root /path/to/project mcp
~~~

Starts the official Rust MCP SDK's stdio transport with a fixed project root. Stdout contains only protocol messages. Tools expose search, explanations, pack creation/updates, pack listing and pack reading. Saved prompts are also resources. See [integration](integrations.md) for configuration and tool parameters.

## list / ls

~~~bash
context list [--limit 20] [--json]
context ls
~~~

Lists completed packs, newest first. Incomplete staging directories are excluded.

## open

~~~bash
context open [slug-or-prefix] [--file PACK.md]
~~~

Opens the latest pack by default, or a uniquely matching pack. A full slug resolves an ambiguous prefix. The requested file must be inside that pack. The operating system's default application opens the file or directory.

## domains

~~~bash
context domains list [--all] [--verbose] [--json]
context domains add inventory --keywords stock,warehouse,sku --description "Inventory"
context domains remove inventory
context domains remove payments
context domains enable payments
~~~

Domain names use lowercase letters, digits, hyphens and underscores. Adding a domain creates or replaces a custom definition. Removing a built-in domain disables it. List output identifies its source and enabled state.

Successful commands exit with status 0. Invalid CLI arguments exit with status 2; operational failures exit with status 1 and an explanatory error on stderr.
