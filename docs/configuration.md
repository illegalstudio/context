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

Framework manifests are discovered in nested projects as well as the selected root. Node.js uses `package.json`; Laravel and Statamic use Composer requirements, including development requirements. Dependency and build directories are not treated as application roots unless explicitly opted in as first-party source. New framework defaults are anchored to their project scope, for example `/apps/server/storage/framework/` and `/apps/server/public/js/filament/`. Laravel exclusions therefore do not hide a sibling frontend's `storage/framework/`. `.context/project.json` reports `frameworkScopes` alongside the combined `activeDiscoveries` list. Existing `.ctxignore` files retain their contents.

Root `.gitignore` exceptions can identify first-party source stored under a default dependency directory when no `.ctxignore` exists, for example:

~~~gitignore
node_modules/
!packages/node_modules
packages/node_modules/*/public/
~~~

Only patterns explicitly naming a default dependency directory participate; `!*` does not enable all dependencies. Root rules retain their ordering and exclusions for generated children. Initialization copies these rules after the generated defaults. Existing `.ctxignore` files are authoritative and are never silently rewritten: add corresponding negations there if needed. Nested Git ignore files are not used as opt-in evidence.

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

Excerpt allocation proceeds in rounds. Each file starts with a relevance-weighted share and can expand as the rounds progress. When multiple readable files are selected, each can use at most half of the excerpt allowance remaining after the prompt header. A single selected source can use the entire allowance. This may leave capacity unused when other sources are small. Complete declarations are preferred. Sections too large for the available budget are clipped around their relevant lines and marked truncated; individual lines are never split. `maxLinesPerFile` limits the sum of included lines across that file's non-overlapping sections. Some selected files may have no excerpt; the manifest indicates this with a null `excerptRange` and empty `excerptRanges`.

Excerpt planning bounds retained source buffers and line metadata to approximately 64 MiB, excluding temporary parsing/derived output and a single source currently being read. A selected file without excerpts reports `omissionReason`: `token_budget`, `oversized_line` or `source_memory_limit`. `oversized_line` means no section fit and a source line exceeded that file's maximum allowance. Its source hash is still captured, and an incremental update retries files whose earlier excerpt was omitted.

`--include tests,config,docs` chooses which optional categories are permitted. Omitting it permits all three. Main source files are always eligible. `--exclude` applies Git-style patterns to every candidate, including explicit hints.

Plain query words contribute to relevance without reserving symbol slots. `--symbol`, `@identifier`, backticked identifiers, `identifier()` and recognizable mixed-case or snake-case identifiers provide stronger code references. An ordinary word such as `at` or `il` can still be requested explicitly. Common symbol terms receive less weight using their frequency across indexed files.

Generated directories, filename conventions, generated-file notices and dense JavaScript/CSS lines are heuristic signals for a ranking penalty, recorded in explanations. Explicit file/symbol hints bypass that penalty but still obey ignore rules, exclusions and token limits. `maxFiles` and search limits are ceilings: marginal selection can return fewer files when remaining candidates add little evidence. It values additional query coverage, package implementations, file roles and real dependencies. General tasks cap tests, including `e2e` helpers, at one fifth of the limit (at least one); explicit hints bypass the cap, and requests matching or focusing `testing` lift it. Direct source/test counterparts and test imports can recover behavior checks without matching the task wording. Related tests must add distinct query facets or scope/dependency evidence, rather than gaining novelty solely from another filename. General tasks initially share one fifth of the excerpt allowance across unreserved test files while implementation grows. Tests can borrow unused capacity once implementation stops growing. Testing focus and explicit test references bypass the quota. Relevant production declarations take priority over embedded tests, and configuration excerpts favor active values over comment headers. Scoped runtime relationships can recover configuration without literal task-word matches. Ambiguous tasks can retain both web and CLI context.

## Domains

~~~bash
context domains list --all --verbose
context domains add inventory --keywords stock,warehouse,sku --description "Inventory"
context domains remove queue
context domains enable queue
~~~

Core domains are combined with detected Node.js/Laravel framework domains and project custom domains. Custom definitions override definitions with the same name. Removing a custom domain deletes that override; removing a built-in domain disables it. `--focus` boosts known, enabled domains. Definitions are stored in `.context/domains.json`.

The domain catalog combines all discovered projects. Framework-specific ranking and inferred filename relationships apply within the owning scope; the nearest package manifest defines that boundary. Core and custom domains remain project-wide. Indexing stores framework metadata independently of `includeLanguages`, and search, packs, explanations and MCP reuse it without another directory scan during resolution or ranking.

## Import mappings

TypeScript resolution reads root and nested `tsconfig.json`, referenced project configs and inherited configs, accepting comments, trailing commas and extensionless `extends` paths. Relative config extensions and package configs inside the project's `node_modules` are supported. Inheritance cycles, excessive depth and configs outside the project root are rejected. An absent inherited configuration, including an external preset package or a generated local config, does not prevent indexing an unbuilt checkout. Context applies available local options and reports the missing preset through `unresolvedConfigExtends` in index JSON (and evaluation case reports); inherited aliases are unavailable until that preset is present. Missing relative configs are reported through the same diagnostics. Malformed existing presets, cycles and paths outside the root remain errors. Context never installs application dependencies. A subsequently available preset automatically refreshes the import map. Relative mappings retain their defining config directory or effective `baseUrl`; the nearest source scope takes precedence.

Indexed local `package.json` names resolve workspace imports, exact/wildcard exports, common source/types/import/default/require conditions and legacy entry fields. Exported paths must point to indexed files; Context does not infer source locations from missing generated output. This is static project discovery, not a complete implementation of every runtime or TypeScript module-resolution mode.

Nested Composer `autoload.psr-4` and `autoload-dev.psr-4` mappings resolve PHP namespaces. Explicit `view()`, Blade include/extends/component calls, class references, Antlers partials and YAML template/layout/blueprint fields add relationships to indexed project resources. Literal `Inertia::render()` and `inertia()` page names resolve TSX, JSX, Vue, Svelte, TS and JS files under the owning Composer project's `resources/js/pages/` or `resources/js/Pages/`. Dynamic expressions and application container execution are not evaluated. Rust imports use the nearest indexed package's library root and local crate names. Relative Python imports remain supported. Java imports resolve local classes, nested/static members and direct-package wildcards using an index rebuilt with the dependency graph. External library sources are not downloaded.

Configuration metadata is discovered independently of `includeLanguages`, while ignore rules still control directory traversal. Changes to project configuration rebuild resolved edges even when importing source files have not changed.

## Environment

| Variable | Purpose |
| --- | --- |
| `CONTEXT_MAX_FILES` | File limit when no CLI limit is supplied |
| `CONTEXT_VERBOSE` | Enable detailed progress output |
| `RAYON_NUM_THREADS` | Limit the indexing worker pool |

## Stored data

The disposable index is `.context/index.db`. Updates are transactional, including deletion of stale symbols, references and search entries. Schema changes rebuild the index while preserving configuration and saved packs. Pack output lives in `.context/packs/`. Add `.context/` to your project ignore rules if these artifacts should remain local.
