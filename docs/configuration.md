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
  "graphDepth": 2,
  "tokenizer": "approx"
}
~~~

An empty language list accepts all readable UTF-8 text. Recognized binary content, empty files and oversized files are skipped. `graphDepth` can range from 0 to 8. Other limits must be positive.

CLI `--max-files`, `--budget-tokens` and `--tokenizer` override project settings. `approx` retains the four-bytes-per-token estimate. `cl100k_base` and `o200k_base` count the complete `PACK.md` prompt with the selected BPE vocabulary, including headings, file lists and Markdown fences. Both vocabularies are embedded and require no downloads or API keys. These counts cover the prompt text, excluding any chat framing or additional instructions added by the consuming application. Choose an encoding supported by that application.

Every file first receives a relevance-weighted budget share; unused capacity is then allocated to additional sections. Complete declarations are preferred. Sections too large for the available budget are clipped around their relevant lines and marked truncated. `maxLinesPerFile` limits the sum of included lines across that file's non-overlapping sections. Some selected files may have no excerpt when the budget is exhausted; the manifest indicates this with a null `excerptRange` and empty `excerptRanges`.

Excerpt planning bounds retained source buffers and line metadata to approximately 64 MiB, excluding temporary parsing/derived output and a single source currently being read. A selected file without excerpts reports `omissionReason`: `token_budget` or `source_memory_limit`. Its source hash is still captured, and an incremental update retries files whose earlier excerpt was omitted.

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

TypeScript resolution reads root and nested `tsconfig.json`, referenced project configs and inherited configs, accepting comments, trailing commas and extensionless `extends` paths. Relative config extensions and package configs inside the project's `node_modules` are supported. Inheritance cycles, excessive depth and configs outside the project root are rejected. Relative mappings retain their defining config directory or effective `baseUrl`; the nearest source scope takes precedence.

Indexed local `package.json` names resolve workspace imports, exact/wildcard exports, common source/types/import/default/require conditions and legacy entry fields. Exported paths must point to indexed files; Context does not infer source locations from missing generated output. This is static project discovery, not a complete implementation of every runtime or TypeScript module-resolution mode.

Nested Composer `autoload.psr-4` and `autoload-dev.psr-4` mappings resolve PHP namespaces. Explicit `view()`, Blade include/extends/component calls, class references, Antlers partials and YAML template/layout/blueprint fields add relationships to indexed project resources. Dynamic expressions and application container execution are not evaluated. Rust imports use the nearest indexed package's library root and local crate names. Relative Python imports remain supported.

Configuration metadata is discovered independently of `includeLanguages`, while ignore rules still control directory traversal. Changes to project configuration rebuild resolved edges even when importing source files have not changed.

## Environment

| Variable | Purpose |
| --- | --- |
| `CONTEXT_MAX_FILES` | File limit when no CLI limit is supplied |
| `CONTEXT_VERBOSE` | Enable detailed progress output |
| `RAYON_NUM_THREADS` | Limit the indexing worker pool |

## Stored data

The disposable index is `.context/index.db`. Updates are transactional, including deletion of stale symbols, references and search entries. Schema changes rebuild the index while preserving configuration and saved packs. Pack output lives in `.context/packs/`. Add `.context/` to your project ignore rules if these artifacts should remain local.
