# Getting Started

Install a native package with Homebrew, the Illegal Studio pacman repository, mise or a GitHub release archive. See the [installation instructions](../README.md#installation) for all platforms.

For a source installation, use Rust 1.90 or newer and a C/C++ compiler:

~~~bash
git clone https://github.com/illegalstudio/context.git
cd context
cargo install --path . --locked
~~~

The installed executable is independent of Node.js and the Rust toolchain.

## First pack

~~~bash
cd /path/to/project
context init
# Review .ctxignore and .context/config.json.
context index
context pack --task "Fix the payment webhook handler"
~~~

Both indexing and packing initialize settings when necessary. Packing automatically refreshes the index. Unchanged files are skipped using size and modification time; use `--verify` to detect edits that preserve both values.

## Interactive mode

Run `context pack` in a terminal. Type your task and use `@` followed by a filename, path, symbol or acronym. Press Tab for completion, Enter to submit, or Ctrl+C to cancel. Multiple references in the task are preserved.

~~~text
Fix validation in @UserController and @createUser
Refactor @app/Services/StripeService.php
~~~

Noninteractive runs require `--task`, `--file`, `--symbol`, `--error` or `--diff`.

## Other inputs

~~~bash
context pack --error storage/logs/laravel.log --since 1h
context pack --diff origin/main
context pack --file src/payments.ts --symbol processPayment
context pack --task "Correggi il pagamento" --focus payments
~~~

Errors from Node.js, Python and PHP stacktraces contribute file and line hints. Timestamped log filtering accepts UTC timestamps in `YYYY-MM-DD HH:MM:SS` form. Untimestamped lines remain attached to their preceding log entry.

## Inspect and automate

~~~bash
context list
context open --file PACK.md
context pack --task "Fix checkout" --json
context --root /path/to/project index --json
~~~

Each pack has a unique directory, structured reports, excerpts, a JSON manifest and a compressed archive. `PACK.md` contains the task and selected code, ready to pass to a coding assistant.
