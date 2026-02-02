# Commands Reference

## context init

Initialize Context in the current directory.

```bash
context init [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-f, --force` | Force reinitialization, recreating the index |

**Example:**

```bash
context init
context init --force
```

---

## context index

Index the repository. This scans all files, extracts symbols, and builds the import graph.

```bash
context index [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Show detailed output |

**Example:**

```bash
context index
context index --verbose
```

The index is stored in `.context/index.db` and is automatically updated when you run `context pack`.

---

## context pack

Create a context pack for a task.

```bash
context pack [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-t, --task <description>` | Task description |
| `-e, --error <file>` | Error log file path |
| `--since <duration>` | Filter error log (e.g., 1h, 2h, 30m) |
| `-d, --diff <ref>` | Git diff reference (e.g., origin/main) |
| `-f, --file <path>` | Specific file to analyze |
| `-s, --symbol <name>` | Specific symbol to focus on |
| `--max-files <number>` | Maximum files to include (default: 25) |
| `--include <categories>` | Include categories (comma-separated: tests,config,docs) |
| `--exclude <patterns>` | Exclude patterns (comma-separated) |
| `--focus <domains>` | Focus on domains (comma-separated: auth,payments,api) |
| `-v, --verbose` | Verbose output |

**Examples:**

```bash
# Interactive mode with autocomplete
context pack

# Task-based
context pack --task "Fix the checkout payment flow"

# Error-driven
context pack --error storage/logs/laravel.log --since 1h

# Diff-based
context pack --diff origin/main

# File-focused
context pack --file app/Services/StripeService.php --symbol handleWebhook

# Combined
context pack --task "Fix webhook" --diff origin/main --focus payments
```

### Interactive Mode (REPL)

When run without arguments in a terminal, `context pack` enters interactive mode with real-time autocomplete:

```bash
context pack
```

```
Enter task (use @ for autocomplete): _
```

**Using @ references:**

The `@` character triggers autocomplete for files and symbols from your indexed codebase:

| Reference | Description | Example |
|-----------|-------------|---------|
| `@filename` | Match files by name | `@UserController` |
| `@path/to/` | Match files by path | `@app/Models/User.php` |
| `@symbolName` | Match symbols (classes, methods) | `@handlePayment` |

**Keyboard controls:**

| Key | Action |
|-----|--------|
| `Tab` | Accept highlighted suggestion |
| `Up/Down` | Navigate suggestions |
| `Enter` | Submit task |
| `Ctrl+C` | Cancel |

**Examples:**

```
Fix validation in @UserController createUser method
Refactor @PaymentService to use @StripeClient
Bug in @app/Models/User.php when saving
```

Files and symbols referenced with `@` are automatically prioritized in the discovery results.

See [Getting Started - Interactive Mode](getting-started.md#interactive-mode-repl) for a detailed guide.

---

## context list

List all context packs.

```bash
context list [options]
context ls [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <number>` | Number of packs to show |

**Example:**

```bash
context list
context ls
context list --limit 10
```

**Output:**

```
Context Packs

DATE        TIME      TASK                                     FILES
----------  --------  ----------------------------------------  -----
2026-02-02  14:30:22  fix-payment-webhook-handler                  12
2026-02-02  10:15:00  add-user-validation                           8
2026-02-01  16:45:30  refactor-auth-service                        15
```

---

## context open

Open a context pack in your file manager or editor.

```bash
context open [pack] [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `pack` | Pack slug or prefix (optional, opens most recent if not specified) |

**Options:**

| Option | Description |
|--------|-------------|
| `-f, --file <name>` | Open a specific file (e.g., PACK.md) |

**Example:**

```bash
# Open most recent pack
context open

# Open specific pack by full slug
context open 20260202-143022-fix-payment-webhook

# Open specific pack by prefix
context open 20260202-143022

# Open specific file from most recent pack
context open --file PACK.md

# Open specific file from specific pack
context open 20260202-143022-fix-payment-webhook --file PACK.md
```

---

## context domains

Manage domain definitions for task analysis. Domains help Context understand the conceptual areas of your codebase.

### context domains list

List all active domains.

```bash
context domains list [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-a, --all` | Show all domains including disabled |
| `-v, --verbose` | Show keywords for each domain |

**Example:**

```bash
context domains list
context domains list --all --verbose
```

### context domains add

Add a custom domain.

```bash
context domains add <name> --keywords <keywords> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-k, --keywords <keywords>` | Comma-separated keywords (required) |
| `-d, --description <description>` | Domain description |

**Example:**

```bash
context domains add billing --keywords "invoice,subscription,payment,charge" --description "Billing and subscriptions"
```

### context domains remove

Remove a custom domain or disable a built-in domain.

```bash
context domains remove <name>
```

**Example:**

```bash
context domains remove billing
```

### context domains enable

Re-enable a previously disabled domain.

```bash
context domains enable <name>
```

**Example:**

```bash
context domains enable auth
```
