# Configuration

## Ignore rules

`.ctxignore` uses Git ignore syntax, including root anchors, directory rules, globs and negation. Nested `.ctxignore` files apply to their own directories. Git's own ignore files are not used automatically; this lets Context index useful files even when the project does not track them.

~~~gitignore
node_modules/
vendor/*
!vendor/important.php
*.generated.ts
.env
.env.*
!.env.example
target/
~~~

To reinclude a file, its parent directory must remain traversable. Use `vendor/*` rather than `vendor/` in the example above. The `.git` and `.context` directories are always excluded; symlinks are not followed.

Initialization generates generic and framework-specific defaults, including dependencies, build output, logs and common credential filenames. Existing ignore files are preserved unless `context init --force` is requested.

## Project settings

Edit `.context/config.json`:

~~~json
{
  "version": "0.3.0",
  "includeLanguages": [],
  "maxFileSize": 1048576,
  "maxFiles": 25,
  "maxLinesPerFile": 300,
  "budgetTokens": 32000,
  "graphDepth": 2
}
~~~

An empty language list accepts all readable UTF-8 text. Recognized binary content, empty files and oversized files are skipped. `graphDepth` can range from 0 to 8. Other limits must be positive.

CLI `--max-files` and `--budget-tokens` override project settings. The token budget is a byte-based estimate (four bytes per token), applied to the complete `PACK.md` prompt including its file list. It is not an exact tokenizer count. Some selected files may have no excerpt when the budget is exhausted; the manifest indicates this with a null excerpt range.

`--include tests,config,docs` chooses which optional categories are permitted. Omitting it permits all three. Main source files are always eligible. `--exclude` applies Git-style patterns to every candidate, including explicit hints.

## Domains

~~~bash
context domains list --all --verbose
context domains add inventory --keywords stock,warehouse,sku --description "Inventory"
context domains remove queue
context domains enable queue
~~~

Core domains are combined with detected Node.js/Laravel framework domains and project custom domains. Custom definitions override definitions with the same name. Removing a custom domain deletes that override; removing a built-in domain disables it. `--focus` boosts known, enabled domains. Definitions are stored in `.context/domains.json`.

## Import mappings

Root `tsconfig.json` path mappings and baseUrl are used to resolve TypeScript imports. Comments and trailing commas are accepted. Config inheritance, package exports, project references and nested compiler configs are not resolved automatically. Composer `autoload.psr-4` mappings resolve PHP namespaces. Relative Python imports and common Rust module paths are resolved against indexed files.

## Environment

| Variable | Purpose |
| --- | --- |
| `CONTEXT_MAX_FILES` | File limit when no CLI limit is supplied |
| `CONTEXT_VERBOSE` | Enable detailed progress output |
| `RAYON_NUM_THREADS` | Limit the indexing worker pool |

## Stored data

The disposable index is `.context/index.db`. Updates are transactional, including deletion of stale symbols, references and search entries. Schema changes rebuild the index while preserving configuration and saved packs. Pack output lives in `.context/packs/`. Add `.context/` to your project ignore rules if these artifacts should remain local.
