<p align="center">
  <img src="assets/logo-transparent.png" alt="Context logo" width="130">
</p>

<h1 align="center">Context</h1>

<p align="center">
  <em>The right context for every coding task.</em>
</p>

<p align="center">
  <a href="https://github.com/illegalstudio/context/actions/workflows/ci.yml"><img src="https://github.com/illegalstudio/context/actions/workflows/ci.yml/badge.svg" alt="Build and tests"></a>
  <img src="https://img.shields.io/badge/Rust-1.90%2B-02B7A1?style=flat-square&amp;logo=rust&amp;logoColor=white" alt="Rust 1.90 or newer">
  <a href="https://github.com/illegalstudio/context/stargazers"><img src="https://img.shields.io/github/stars/illegalstudio/context?style=flat-square&amp;logo=github&amp;logoColor=white&amp;label=stars&amp;color=02B7A1" alt="GitHub stars"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-02B7A1?style=flat-square&amp;color=02B7A1" alt="License: MIT"></a>
</p>

<p align="center">
  <strong>Deterministic packs &middot; Explainable file selection &middot; Multi-language support</strong>
</p>

<p align="center">
  Context is a CLI tool for agentic coding that transforms tasks into deterministic, explainable context packages. It analyzes your codebase and creates focused context packs that help AI coding assistants (Claude, Cursor, Codex) understand exactly which files are relevant to your task.
</p>

<p align="center">
  <a href="https://illegal.studio/en/products/context"><strong>Official Website</strong></a>
</p>

---

## Installation

Prebuilt packages support Linux x86_64, Linux ARM64 and macOS ARM64 (Apple Silicon). Linux requires glibc 2.35 or newer; macOS requires version 11 or newer. SQLite and Tree-sitter are embedded. Git enables diff analysis and history signals; indexing and task-based packs also work outside Git repositories.

### Homebrew

~~~bash
brew install illegalstudio/tap/context
~~~

### Arch Linux and Arch Linux ARM

Add the [Illegal Studio repository](https://github.com/illegalstudio/pacman) to `/etc/pacman.conf` once:

~~~ini
[illegalstudio]
SigLevel = Optional TrustAll
Server = https://illegalstudio.github.io/pacman/$arch
~~~

Then install the native package for x86_64 or aarch64:

~~~bash
sudo pacman -Syu context
~~~

### mise

~~~bash
mise use -g github:illegalstudio/context
~~~

To pin a release, use `mise use -g github:illegalstudio/context@0.3.0`. Pinning also makes a newly published release available immediately, without mise's default release-age delay. The [GitHub backend](https://mise.jdx.dev/dev-tools/backends/github.html) selects the archive for your platform and verifies its checksum.

### GitHub Releases

Download a package and its `.sha256` file from [Releases](https://github.com/illegalstudio/context/releases). Every release includes:

| Platform | Portable archive | Native package |
| --- | --- | --- |
| Linux x86_64 | `context_<version>_linux_amd64.tar.gz` | `context-<version>-1-x86_64.pkg.tar.zst` |
| Linux ARM64 | `context_<version>_linux_arm64.tar.gz` | `context-<version>-1-aarch64.pkg.tar.zst` |
| macOS ARM64 | `context_<version>_darwin_arm64.zip` | Signed and notarized executable in the ZIP |

For example, on Linux x86_64:

~~~bash
version=0.3.0
asset="context_${version}_linux_amd64.tar.gz"
base_url="https://github.com/illegalstudio/context/releases/download/v${version}"
curl -fLO "$base_url/$asset"
curl -fLO "$base_url/$asset.sha256"
sha256sum --check "$asset.sha256"
tar -xzf "$asset"
mkdir -p "$HOME/.local/bin"
install -m755 "context_${version}_linux_amd64/context" "$HOME/.local/bin/context"
~~~

Ensure `$HOME/.local/bin` is on `PATH`. On Linux ARM64, replace `amd64` with `arm64`. On macOS, verify the ZIP with `shasum -a 256 -c <archive>.sha256`, extract it with `unzip`, and install the `context` executable into a directory on `PATH`. Downloaded Arch packages can also be installed with `sudo pacman -U <package>.pkg.tar.zst`.

### From source

Build and install with Rust 1.90 or newer and a C/C++ compiler:

~~~bash
git clone https://github.com/illegalstudio/context.git
cd context
cargo install --path . --locked
~~~

The installed executable does not require Node.js or Rust.

## Quick Start

~~~bash
cd /path/to/project
context index
context pack --task "Fix the payment webhook handler"
context pack                         # Interactive task input with @ completion
context list
context open
context search "payment validation"
context explain src/payments.ts --task "Fix the payment webhook"
~~~

Indexing initializes settings automatically. Every pack refreshes the index before selecting files. Use `context init` when you want to review settings and ignore patterns first.

## How It Works

1. **Index:** Traverse the project using `.ctxignore`, skip unchanged files, and parse changed files in parallel. Save metadata, symbols, imports, references and searchable content in SQLite.
2. **Resolve:** Extract file and symbol hints, English and Italian keywords, conceptual domains, stacktrace locations and Git changes.
3. **Discover:** Combine path matches, indexed content, symbols, dependency traversal and framework relationships.
4. **Rank:** Prioritize explicit file and symbol references, explain every selection, and include relevant tests and configuration within the file limit.
5. **Compose:** Write bounded code excerpts, Markdown reports, a JSON manifest and a portable archive.

Selection and graph ordering are deterministic for the same source, task, options and Git state. Pack timestamps and directory names are unique to each invocation.

## Output

~~~text
.context/packs/<timestamp>-<task>/
  PACK.md       # Task, selected files and code excerpts
  TASK.md       # Keywords, domains and heuristic confidence
  FILES.md      # Selected files and relevance reasons
  GRAPH.md      # Mermaid dependency graph
  TESTS.md      # Relevant tests
  DIFF.md       # Change summary
  excerpts/     # Individual code excerpts
  ctx.json      # Machine-readable manifest
  ctx.tgz       # Portable archive, excluding itself
~~~

Packs are published atomically after all files and the archive have been written. Excerpt filenames include a path hash to avoid collisions.

## Features

- **Structural parsing:** Tree-sitter declarations for TypeScript/TSX, JavaScript/JSX, PHP, Python, Go, Rust, Ruby and Java. Other text languages remain searchable without structural symbol extraction.
- **Incremental indexing:** Size and nanosecond modification-time checks avoid reading unchanged sources. BLAKE3 hashes prevent unnecessary parsing after timestamp-only changes. `--verify` hashes every source when metadata cannot be trusted.
- **Bounded parallel work:** Files are read once per indexing update and processed in batches. SQLite updates use one transaction and reused statements.
- **Import resolution:** Relative imports, TypeScript .js specifiers, root tsconfig path mappings, Composer PSR-4 mappings, Python modules and Rust module imports.
- **Framework discovery:** Node.js, Laravel and Statamic relationships and framework-specific task domains.
- **Interactive input:** `@` file and symbol references with Tab completion and acronym matching.
- **Structural excerpts:** Complete relevant declarations and multiple non-overlapping sections per file, including import context when it fits. Error locations, all changed regions, explicit symbols and task terms guide selection.
- **Context limits:** Relevance-weighted allocation across files, with an approximate budget or offline `cl100k_base` / `o200k_base` BPE tokenization of the complete prompt. Explicit exclusions also apply to hinted files.
- **Project relationships:** Inherited and nested TypeScript configs, project references, local package exports, Rust crate roots, Composer namespaces, Laravel views and Statamic templates/blueprints.
- **Agent integration:** Search and numerical ranking explanations through CLI/JSON and an MCP stdio server with tools and saved-pack resources.
- **Incremental packs:** Update a previous pack with changed/new context, removed files and obsolete relationships while retaining unchanged excerpts through the parent reference.
- **Quality evaluation:** Labeled datasets, separate training/evaluation splits, historical Git snapshots, file retrieval and line coverage metrics, token costs and baseline comparisons.
- **Automation:** JSON output for indexing, packs, listing and domains; `--root` selects the project directory.

## Commands

~~~bash
context init
context index --verify
context pack --task "Fix checkout" --focus payments --max-files 15
context pack --error error.log --since 1h
context pack --diff origin/main
context pack --file app/Services/StripeService.php --symbol handleWebhook
context pack --task "Fix checkout" --exclude 'tests/' --budget-tokens 8000 --json
context domains add inventory --keywords stock,warehouse,sku
context domains list --all --verbose
context list --limit 10
context open --file PACK.md
context pack --task "Fix checkout" --tokenizer o200k_base --budget-tokens 8000
context pack --update latest --json
context search "checkout validation" --limit 5 --json
context explain app/Services/StripeService.php --task "Fix webhook verification" --json
context mcp
~~~

See the [commands reference](docs/commands.md), [configuration guide](docs/configuration.md) and [implementation guide](docs/how-it-works.md).

See [agent integration](docs/integrations.md) for MCP setup and [quality evaluation](docs/evaluation.md) for measuring file selection, excerpt coverage and token usage on repeatable tasks.

## Development

~~~bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/benchmark.py
~~~

The executable is `target/release/context` (or `context.exe` on Windows). Tests reuse the original sample codebases and selection scenarios and run in automatically cleaned temporary directories. See [testing](docs/testing.md).

`make check` runs the Rust and packaging checks. `make package` builds a local portable archive with dependency notices. Release builds, Apple signing, Homebrew and pacman publication are documented in [the release guide](docs/releases.md).

This replaces the former TypeScript implementation and npm distribution. The former JavaScript library API is removed. Existing source projects and packs are preserved; the disposable index is rebuilt when its schema changes.

## Disclaimer

This project was developed with extensive use of artificial intelligence and is provided "as is", without warranty of any kind, express or implied.

## License

[MIT](LICENSE)
