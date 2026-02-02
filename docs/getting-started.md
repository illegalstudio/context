# Getting Started

This guide walks you through installing and using Context for the first time.

## Installation

### Global Installation (Recommended)

Install Context globally to use it in any project:

```bash
npm install -g @illegalstudio/context
```

Verify the installation:

```bash
context --version
```

### Using npx

Alternatively, run Context without installing:

```bash
npx @illegalstudio/context --help
```

## First Steps

### 1. Navigate to Your Project

```bash
cd /path/to/your/project
```

Context works best with projects that have:
- A clear directory structure
- Source code in common languages (TypeScript, JavaScript, PHP, Python, etc.)
- A git repository (optional, but enables additional features)

### 2. Index the Codebase

Before creating context packs, you need to index your codebase:

```bash
context index
```

This creates a `.context/` directory containing the index database. The indexing process:

- Scans all source files
- Extracts symbols (classes, functions, methods)
- Builds the import graph
- Collects git signals (if available)

For large codebases, this may take a few seconds. Subsequent runs are incremental and faster.

### 3. Create Your First Pack

Run the pack command with a task description:

```bash
context pack --task "Fix the user authentication login flow"
```

Or enter interactive mode for autocomplete:

```bash
context pack
```

### 4. Review the Output

Context creates a `ctx/` directory with your context pack:

```
ctx/
  PACK.md       # Ready-to-use prompt
  TASK.md       # Task analysis
  FILES.md      # Selected files with reasons
  GRAPH.md      # Dependency graph
  excerpts/     # Code excerpts
  ctx.json      # Machine-readable manifest
  ctx.tgz       # Portable archive
```

Open the main output:

```bash
context open --file PACK.md
```

### 5. Use with AI Assistants

Copy the contents of `PACK.md` and paste it into your AI coding assistant (Claude, Cursor, ChatGPT, etc.) along with your question or request.

The context pack provides the AI with:
- Understanding of your task
- Relevant code excerpts
- File structure and dependencies
- Framework-specific context

## Example Workflows

### Bug Fix Workflow

You have a bug in your payment processing:

```bash
# Option 1: Describe the bug
context pack --task "Stripe webhook returns 500 on duplicate events"

# Option 2: Use the error log
context pack --error storage/logs/laravel.log --since 1h

# Option 3: Combine both
context pack --task "Fix webhook idempotency" --error logs/error.log
```

### Feature Development Workflow

Adding a new feature:

```bash
# Describe what you want to build
context pack --task "Add password reset functionality to user auth"

# Focus on specific domains
context pack --task "Add password reset" --focus auth,email
```

### Code Review Workflow

Reviewing changes from a branch:

```bash
# Create context from diff
context pack --diff origin/main

# Or compare to a specific commit
context pack --diff abc123
```

### Refactoring Workflow

Refactoring existing code:

```bash
# Focus on a specific file
context pack --file src/services/PaymentService.ts --task "Refactor to use dependency injection"

# Or a specific symbol
context pack --symbol handlePayment --task "Extract validation logic"
```

## Interactive Mode (REPL)

When you run `context pack` without arguments in a terminal, you enter interactive mode with a REPL (Read-Eval-Print Loop) interface:

```bash
context pack
```

```
Enter task (use @ for autocomplete): _
```

This mode provides real-time autocomplete suggestions as you type, making it easy to reference specific files and symbols from your codebase.

### Using @ References

The `@` character triggers autocomplete for files and symbols in your indexed codebase. This is the most powerful feature of interactive mode.

**Referencing files:**

```
Fix the bug in @app/Http/Controllers/UserController.php
```

As you type after `@`, suggestions appear:

```
Enter task: Fix bug in @User
                        app/Http/Controllers/UserController.php
                        app/Models/User.php
                        src/services/UserService.ts
```

**Referencing symbols (classes, methods, functions):**

```
Refactor the @handlePayment method to use async/await
```

```
Enter task: Refactor @handle
                      handlePayment (PaymentService.ts)
                      handleWebhook (WebhookController.php)
                      handleError (ErrorHandler.ts)
```

**Multiple references in one task:**

```
The @UserController should use @UserService instead of direct DB calls
```

### Keyboard Controls

| Key | Action |
|-----|--------|
| `Tab` | Accept the highlighted suggestion |
| `Up/Down` | Navigate through suggestions |
| `Enter` | Submit the task |
| `Ctrl+C` | Cancel and exit |
| `Backspace` | Delete character (clears suggestions if @ is deleted) |

### How References Work

When you include `@` references in your task:

1. The referenced files/symbols are automatically prioritized in discovery
2. They appear at the top of the relevance ranking
3. Related files (imports, dependencies) are also included
4. The excerpt extraction focuses on the referenced symbols

**Example session:**

```
$ context pack

Enter task (use @ for autocomplete): Fix validation in @UserController createUser method

Analyzing task...
  Keywords: fix, validation, createUser
  Domains: users
  Type: bugfix

Discovering relevant files...
  Found 12 candidate files

Top files:
  98% app/Http/Controllers/UserController.php
  85% app/Models/User.php
  72% app/Http/Requests/CreateUserRequest.php
  ...

Context pack created at: ctx/
```

### Tips for Interactive Mode

1. **Start with @** - If you know the file or symbol, start typing `@` immediately
2. **Partial matches work** - `@UserCont` will match `UserController`
3. **Path prefixes** - Use `@src/` or `@app/` to filter by directory
4. **Case insensitive** - `@user` matches `User`, `UserService`, `userHelper`
5. **Combine references** - Use multiple `@` in one task for complex scenarios

## Tips

### Effective Task Descriptions

Good task descriptions include:

- Specific file or component names when known
- The type of change (fix, add, refactor)
- Domain context (payments, auth, api)
- Error messages or symptoms (if applicable)

**Good examples:**
- "Fix the Stripe webhook handler to handle duplicate events"
- "Add email verification to the user registration flow"
- "Refactor UserService to use repository pattern"

**Vague examples (less effective):**
- "Fix the bug"
- "Make it faster"
- "Clean up the code"

### Excluding Files

Create a `.ctxignore` file to exclude irrelevant files:

```
# Exclude build artifacts
dist/
build/

# Exclude dependencies
node_modules/
vendor/

# Exclude generated files
*.generated.ts
```

### Custom Domains

Add project-specific domains to improve discovery:

```bash
context domains add billing --keywords "invoice,subscription,charge,plan"
```

## Next Steps

- Read the [Commands Reference](commands.md) for all available options
- Learn about [Configuration](configuration.md) options
- Understand [How It Works](how-it-works.md) for advanced usage
