# Configuration Guide

## .ctxignore

The `.ctxignore` file controls which files are excluded from indexing. It uses the same syntax as `.gitignore`.

Create a `.ctxignore` file in your project root:

```
# Dependencies
node_modules/
vendor/
.venv/

# Build output
dist/
build/
out/
.next/

# Generated files
*.generated.ts
*.min.js
*.min.css
*.bundle.js

# IDE and editor files
.idea/
.vscode/
*.swp

# Test coverage
coverage/
.nyc_output/

# Temporary files
tmp/
temp/
*.tmp

# Large binary files
*.zip
*.tar.gz
*.pdf

# Secrets (should also be in .gitignore)
.env
.env.local
*.pem
```

### Pattern Syntax

| Pattern | Description |
|---------|-------------|
| `file.txt` | Matches `file.txt` in any directory |
| `/file.txt` | Matches `file.txt` only in the root |
| `dir/` | Matches the directory and all contents |
| `*.js` | Matches all `.js` files |
| `**/*.test.ts` | Matches all `.test.ts` files in any subdirectory |
| `!important.js` | Negates a previous pattern (include the file) |

### Framework-Specific Defaults

Context automatically applies sensible defaults based on detected frameworks:

**Node.js projects:**
- `node_modules/`
- `package-lock.json`
- `*.min.js`

**Laravel projects:**
- `vendor/`
- `storage/framework/`
- `bootstrap/cache/`
- `public/build/`

**Python projects:**
- `.venv/`
- `__pycache__/`
- `*.pyc`

## Domains

Domains are conceptual areas of your codebase that help Context understand task context. Built-in domains include:

- **auth** - Authentication and authorization
- **payments** - Payment processing
- **api** - API endpoints and handlers
- **database** - Database operations
- **email** - Email sending and templates
- **storage** - File storage and uploads
- **cache** - Caching logic
- **queue** - Background jobs and queues
- **testing** - Test utilities and helpers

### Custom Domains

Add project-specific domains:

```bash
context domains add inventory --keywords "stock,warehouse,sku,product" --description "Inventory management"
```

Domain keywords are matched against task descriptions to boost relevant files.

### Disabling Domains

Disable built-in domains you don't need:

```bash
context domains remove queue
```

Re-enable later:

```bash
context domains enable queue
```

## Index Location

The index is stored in `.context/index.db`. This is a SQLite database containing:

- File metadata (path, size, hash, modification time)
- Symbols (classes, functions, methods with line numbers)
- Import relationships
- Git signals (commit count, churn score)

You can safely delete `.context/` and re-run `context index` to rebuild.

## Output Directory

Context packs are created in `.context/packs/` with unique timestamped slugs:

```
.context/packs/20260202-143022-fix-payment-webhook/
.context/packs/20260202-150100-add-user-validation/
```

Each pack is preserved - they don't overwrite each other. Use `context list` to see all packs and `context open <pack>` to open a specific one.

Add `.context/packs/` to your `.gitignore` if you don't want to commit context packs:

```
# Context packs (keep the index)
.context/packs/
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTEXT_MAX_FILES` | Maximum files to include in pack | 25 |
| `CONTEXT_VERBOSE` | Enable verbose output | false |
