# How Context Works

This document explains the internal architecture and algorithms used by Context.

## Overview

Context uses a multi-stage pipeline to transform a task description into a focused context pack:

```
Task Input --> Resolve --> Discover --> Score --> Compose --> Output
```

## Stage 1: Indexing

Before any pack can be created, the codebase must be indexed. This happens once and is incrementally updated.

### File Scanning

The indexer scans all files respecting `.ctxignore` patterns. For each file it records:

- Path (relative to project root)
- Language (detected from extension)
- Size in bytes
- Modification time
- Content hash (for change detection)

### Symbol Extraction

For supported languages, symbols are extracted:

| Symbol Type | Examples |
|-------------|----------|
| Class | `class UserController`, `class PaymentService` |
| Function | `function handleWebhook()`, `def process_payment()` |
| Method | `public function store()`, `async createUser()` |
| Interface | `interface PaymentGateway` |
| Constant | `const API_VERSION`, `define('MAX_RETRIES')` |

Each symbol includes its name, kind, and line range (start/end).

### Import Graph

The indexer builds a directed graph of import relationships:

```
UserController.php --> User.php
UserController.php --> UserService.php
UserService.php --> User.php
UserService.php --> MailService.php
```

This graph is used to find related files during discovery.

### Git Signals

For git repositories, additional signals are collected:

- **Last modified** - When the file was last changed
- **Commit count** - How many commits touched this file
- **Churn score** - Frequency of changes (high churn = hot spot)

## Stage 2: Task Resolution

The resolver analyzes the task input to understand intent.

### Keyword Extraction

Keywords are extracted using multiple techniques:

1. **Tokenization** - Split on whitespace and punctuation
2. **Stemming** - Reduce words to roots (e.g., "payments" -> "payment")
3. **Stop word removal** - Filter common words (the, a, is, etc.)
4. **N-gram extraction** - Capture multi-word phrases

### Entity Detection

The resolver looks for specific entities:

- **File names** - `User.php`, `payment-service.ts`
- **Class names** - `UserController`, `PaymentService`
- **Method names** - `handleWebhook`, `processPayment`
- **Route patterns** - `/api/users`, `/checkout`
- **Error codes** - `E_USER_DEPRECATED`, `ECONNREFUSED`

### Domain Detection

Task keywords are matched against domain definitions to identify conceptual areas:

```
Task: "Fix the Stripe webhook payment confirmation"
Matched domains: payments (stripe, webhook, payment)
```

### Change Type Classification

The task is classified into a change type:

| Type | Indicators |
|------|------------|
| bugfix | fix, bug, error, issue, broken, fails |
| feature | add, implement, create, new, support |
| refactor | refactor, clean, improve, optimize |
| perf | performance, slow, fast, optimize, cache |
| security | security, vulnerability, auth, permission |

### Confidence Scoring

A confidence score (0-1) is calculated based on:

- Presence of exact file names
- Presence of class/method names
- Keyword match count
- Domain match strength

Low confidence tasks trigger suggestions for more specific input.

## Stage 3: Discovery

The discovery stage finds candidate files using multiple signals.

### Signal Types

| Signal | Weight | Description |
|--------|--------|-------------|
| `stacktraceHit` | High | File appears in error stacktrace |
| `diffHit` | High | File was modified in the diff |
| `fileHintExact` | High | File name exactly matches task mention |
| `exactSymbolMention` | High | File contains symbol mentioned in task |
| `symbolMatch` | Medium | File contains related symbols |
| `keywordMatch` | Medium | File path/content matches keywords |
| `graphRelated` | Medium | File is imported by/imports a candidate |
| `gitHotspot` | Low | File has high git activity |
| `relatedFile` | Low | Found by framework-specific rules |

### Framework Rules

Context includes framework-specific discovery rules:

**Laravel:**
- Controller -> Request, Resource, Model
- Model -> Migration, Factory, Seeder
- Route -> Controller, Middleware

**Node.js/NestJS:**
- Controller -> Service, DTO, Module
- Service -> Repository, Entity

**React:**
- Component -> Hook, Context, Style

### Graph Traversal

Starting from high-confidence candidates, the import graph is traversed to find related files:

1. Direct imports (depth 1) - High relevance
2. Transitive imports (depth 2) - Medium relevance
3. Further imports - Low relevance with decay

## Stage 4: Scoring

Candidates are scored and ranked.

### Score Calculation

Each signal contributes to the final score:

```
score = sum(signal_weight * signal_value) / max_possible_score
```

Weights are tuned to prioritize:
1. Explicit mentions (file names, symbols in task)
2. Error-driven signals (stacktrace, recent changes)
3. Semantic matches (keywords, domains)
4. Structural relationships (imports, framework patterns)

### Filtering and Limits

- Files are sorted by score descending
- A configurable limit is applied (default: 25 files)
- Test files are included but may be deprioritized
- Config files are included when relevant

## Stage 5: Composition

The final stage generates the context pack.

### Excerpt Extraction

For each selected file, relevant excerpts are extracted:

1. If specific symbols are mentioned, extract those symbol ranges
2. If diff lines are known, extract changed regions
3. Otherwise, extract the most relevant portions based on keywords
4. Respect line limits (default: 300 lines per file)

### Output Files

| File | Content |
|------|---------|
| `PACK.md` | Combined prompt with task, files, and excerpts |
| `TASK.md` | Detailed task analysis, keywords, domains |
| `FILES.md` | File list with scores and relevance reasons |
| `GRAPH.md` | ASCII dependency graph |
| `excerpts/` | Individual file excerpts |
| `ctx.json` | Machine-readable manifest |
| `ctx.tgz` | Compressed archive of all outputs |

### PACK.md Structure

The main output file follows this structure:

```markdown
# Context Pack

## Task
[Original task description]

## Analysis
[Keywords, domains, change type, confidence]

## Files
[List of files with relevance reasons]

## Code
[Concatenated excerpts with file headers]
```

This format is optimized for AI coding assistants to quickly understand the context.
