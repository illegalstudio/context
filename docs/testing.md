# Testing

Context includes a comprehensive test suite to ensure reliability and correctness. This document describes the testing approach, test structure, and how to run tests.

## Test Structure

```
tests/
  unit/                    # Unit tests for individual modules
    discovery/
    extractor/
    indexer/
    resolver/
    storage/
  integration/             # Integration tests for module interactions
  e2e/                     # End-to-end scenario tests
  codebases/               # Sample codebases for testing
  fixtures/                # Test fixtures (stacktraces, diffs, tasks)
  helpers/                 # Test utilities
```

## Running Tests

```bash
# Run all unit and integration tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with UI
npm run test:ui

# Run with coverage
npm run test:coverage

# Run E2E tests (requires build)
npm run test:e2e

# Run all tests
npm run test:all
```

## Test Types

### Unit Tests

Unit tests verify individual components in isolation:

| Module | Tests |
|--------|-------|
| `indexer/FileScanner` | File scanning, language detection |
| `indexer/SymbolExtractor` | Symbol extraction for various languages |
| `indexer/ImportGraphBuilder` | Import relationship detection |
| `indexer/CtxIgnore` | Ignore pattern matching |
| `resolver/TaskResolver` | Task parsing and analysis |
| `resolver/KeywordExtractor` | Keyword extraction algorithms |
| `resolver/StacktraceParser` | Stacktrace parsing for multiple formats |
| `resolver/Stemmer` | Word stemming |
| `discovery/CandidateDiscovery` | File candidate discovery |
| `discovery/Scorer` | Relevance scoring |
| `extractor/ExcerptExtractor` | Code excerpt extraction |
| `storage/Database` | SQLite database operations |

### Integration Tests

Integration tests verify module interactions:

- **indexing.test.ts** - Full indexing workflow
- **task-resolution.test.ts** - Task analysis pipeline
- **candidate-discovery.test.ts** - Discovery with real indexes
- **full-pack.test.ts** - Complete pack generation

### E2E Scenario Tests

End-to-end tests run the actual CLI against sample codebases with predefined task scenarios. Each scenario specifies:

- **task** - The task description to test
- **expectedFiles** - Files that must appear in results
- **expectedInTop5** - Files that should rank highly
- **forbiddenFiles** - Files that should not appear (e.g., ignored files)

## Sample Codebases

The `tests/codebases/` directory contains sample projects for testing:

| Codebase | Description | Purpose |
|----------|-------------|---------|
| `laravel-app` | Laravel PHP application | Test PHP/Laravel discovery rules |
| `nodejs-express` | Node.js Express API | Test TypeScript/Node.js handling |
| `react-frontend` | React frontend app | Test React component discovery |
| `typescript-nestjs` | NestJS application | Test NestJS module patterns |
| `python-flask` | Flask Python API | Test Python support |
| `mixed-fullstack` | Monorepo with frontend/backend | Test multi-package projects |
| `minimal-project` | Single file project | Test minimal scenarios |
| `large-project` | 60+ file project | Test performance |
| `circular-imports` | Circular dependencies | Test graph handling |
| `with-ctxignore` | Project with .ctxignore | Test ignore patterns |

### Laravel Sample Structure

```
laravel-app/
  app/
    Http/
      Controllers/
        UserController.php
        PaymentController.php
        Api/
          AuthController.php
    Models/
      User.php
      Payment.php
    Services/
      StripeService.php
  database/
    migrations/
  resources/
    views/
  tests/
```

### Scenario Examples

```typescript
{
  codebase: 'laravel-app',
  scenarios: [
    {
      name: 'Controller bug',
      task: 'Bug in UserController when creating users',
      expectedFiles: ['app/Http/Controllers/UserController.php'],
      expectedInTop5: ['app/Http/Controllers/UserController.php', 'app/Models/User.php'],
    },
    {
      name: 'Payment domain',
      task: 'Payment webhook error with Stripe checkout',
      expectedFiles: ['app/Http/Controllers/PaymentController.php'],
      expectedInTop5: ['app/Services/StripeService.php'],
    },
  ],
}
```

## Test Fixtures

### Sample Tasks

`tests/fixtures/tasks/sample-tasks.json` contains categorized task examples:

```json
{
  "bugfix": [
    {
      "text": "Fix bug in UserController where login fails",
      "expectedDomains": ["auth"],
      "expectedChangeType": "bugfix",
      "expectedFiles": ["UserController"]
    }
  ],
  "feature": [...],
  "refactor": [...],
  "vague": [
    {
      "text": "Something is broken",
      "expectedConfidenceBelow": 0.3
    }
  ]
}
```

### Stacktraces

`tests/fixtures/stacktraces/` contains sample error logs:

- `nodejs.log` - Node.js/JavaScript stacktrace
- `php-laravel.log` - PHP/Laravel exception
- `python.log` - Python traceback

### Diffs

`tests/fixtures/diffs/` contains sample git diffs for testing diff-based discovery.

## Coverage

Run coverage report:

```bash
npm run test:coverage
```

Coverage targets:
- Statements: > 80%
- Branches: > 75%
- Functions: > 80%
- Lines: > 80%

## Adding Tests

### Adding a Unit Test

Create a test file in the appropriate `tests/unit/` subdirectory:

```typescript
import { describe, it, expect } from 'vitest';
import { YourModule } from '../../src/core/your-module/index.js';

describe('YourModule', () => {
  it('should do something', () => {
    const result = YourModule.doSomething();
    expect(result).toBe(expected);
  });
});
```

### Adding an E2E Scenario

Add a scenario to `tests/e2e/scenarios.test.ts`:

```typescript
{
  codebase: 'your-codebase',
  scenarios: [
    {
      name: 'Descriptive name',
      task: 'Task description to test',
      expectedFiles: ['path/to/expected/file.ts'],
      expectedInTop5: ['path/to/high-priority/file.ts'],
      forbiddenFiles: ['path/to/ignored/file.ts'],
    },
  ],
}
```

### Adding a Test Codebase

1. Create a directory in `tests/codebases/`
2. Add realistic source files
3. Include a `.ctxignore` if needed
4. Add scenarios in `scenarios.test.ts`

## Continuous Integration

Tests run automatically on:
- Pull requests
- Pushes to main branch

The CI pipeline:
1. Installs dependencies
2. Builds the project
3. Runs unit and integration tests
4. Runs E2E tests
5. Reports coverage
