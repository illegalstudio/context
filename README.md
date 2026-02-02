# Context

CLI tool for agentic coding that transforms tasks into deterministic, explainable context packages.

Context analyzes your codebase and creates focused context packs that help AI coding assistants (Claude, Cursor, Codex) understand exactly which files are relevant to your task.

## Installation

```bash
npm install -g @illegalstudio/context
```

Or use directly with npx:

```bash
npx @illegalstudio/context --help
```

## Quick Start

```bash
# Navigate to your project
cd /path/to/your/project

# Index the codebase (required once, updates automatically)
context index

# Create a context pack for your task
context pack --task "Fix the payment webhook handler"

# Or run interactively with autocomplete
context pack
```

## How It Works

1. **Index** - Scans your codebase to build a searchable index of files, symbols (classes, functions, methods), and import relationships.

2. **Resolve** - Analyzes your task description to extract keywords, detect domains (auth, payments, api), and identify the type of change (bugfix, feature, refactor).

3. **Discover** - Finds relevant files using multiple signals: keyword matching, symbol references, import graph traversal, git history, and framework-specific rules.

4. **Score** - Ranks candidates based on relevance signals and applies configurable limits.

5. **Compose** - Generates a structured context pack with task analysis, file excerpts, dependency graphs, and a ready-to-use prompt.

## Output

Running `context pack` creates a timestamped pack in `.context/packs/<slug>/`:

```
.context/packs/20260202-143022-fix-payment-webhook/
  PACK.md       # Ready-to-use prompt for AI agents
  TASK.md       # Task analysis and assumptions
  FILES.md      # Selected files with relevance reasons
  GRAPH.md      # Dependency graph visualization
  excerpts/     # Focused code excerpts
  ctx.json      # Machine-readable manifest
  ctx.tgz       # Portable archive
```

Each pack is preserved with a unique slug based on timestamp and task description.

## Features

- **Framework Detection** - Automatically detects Laravel, Node.js, React, NestJS, and applies framework-specific discovery rules
- **Interactive Mode** - Autocomplete for files and symbols with `@` syntax
- **Multi-language Support** - Works with TypeScript, JavaScript, PHP, Python, and more
- **Import Graph** - Follows dependencies to find related files
- **Git Signals** - Uses commit history to identify hot spots
- **Configurable** - Exclude files with `.ctxignore`, customize domains

## Commands

```bash
context init              # Initialize in current directory
context index             # Index the codebase
context pack              # Create a context pack (interactive)
context pack --task "..." # Create pack for specific task
context list              # List all packs
context open              # Open the most recent pack
context open <pack>       # Open a specific pack
context domains list      # List active domains
context domains add       # Add custom domain
```

See [Commands Reference](docs/commands.md) for full documentation.

## Configuration

Create a `.ctxignore` file to exclude files from indexing:

```
# Dependencies
node_modules/
vendor/

# Build output
dist/
build/

# Generated files
*.generated.ts
*.min.js
```

See [Configuration Guide](docs/configuration.md) for more options.

## Requirements

- Node.js >= 18.0.0
- Git (for git signals and diff analysis)

## Disclaimer

This project was developed with extensive use of artificial intelligence and is provided "as is", without warranty of any kind, express or implied. Use it at your own risk.

## Contributing

Contributions are welcome. If you find bugs, have suggestions, or want to improve the tool, feel free to open an issue or submit a pull request on GitHub.

```bash
git clone https://github.com/illegalstudio/context.git
cd context
npm install
npm run build
```

## License

MIT
