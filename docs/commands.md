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
| `--budget-tokens <count>` | Approximate maximum tokens in PACK.md |
| `--include <categories>` | Permitted optional categories: tests,config,docs |
| `--exclude <patterns>` | Comma-separated Git-style exclusions |
| `--focus <domains>` | Boost known task domains |
| `--verify` | Fully verify source hashes before packing |
| `--json` | Print the generated manifest to stdout |

No input options in a terminal enter interactive task input with `@` and Tab completion. Noninteractive input without a task source exits with an error. Packs always refresh the index first. Diff analysis covers tracked working-tree changes, including deletions, and reports renames as a deletion/addition pair. Untracked files enter the index but are not Git diff hints.

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
