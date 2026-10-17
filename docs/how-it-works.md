# Implementation

Context is a Rust library and CLI. The CLI has no Node runtime or npm dependencies.

## Indexing

`indexer.rs` traverses directories with the ignore crate, applies file/language limits and compares size and nanosecond modification time against the existing index. Eligible updates are read once and hashed with BLAKE3. Equal hashes update metadata without reparsing.

Rayon workers reuse Tree-sitter parser instances within bounded batches. The batch size bounds retained source bytes to approximately 64 MiB before derived parser/search data, unless the configured individual file limit itself is larger. Metadata and index structures still grow with repository size.

`parser.rs` extracts real declarations and source ranges for TypeScript, JavaScript, PHP, Python, Go, Rust, Ruby and Java. Other UTF-8 files contribute searchable text and references. Parsing recovers useful declarations from incomplete code; it does not perform type checking or prove runtime dependency relationships.

`database.rs` consumes parsed batches lazily inside a single SQLite transaction. Statements are reused. Deleted and newly excluded files lose their metadata, symbols, import requests, references and full-text entries. Import requests are stored separately from resolved edges, so newly created targets become connected even when the importing source did not change. Schema 7 rebuilds the disposable index to separate literal content from lexical stems and persist dependency kinds. Generated/minified classification remains cached across metadata-only updates and is recomputed in the existing read pass when sources change.

`project.rs` builds a serializable scoped map of TypeScript configs, local package exports, Composer namespaces and Rust library roots. Its fingerprint invalidates resolved edges after config changes, without reparsing unchanged sources. Metadata discovery occurs before language filtering. Explicit framework string references are captured once during parsing and resolved against indexed resources. Neither application code nor package build scripts are executed.

Literal Inertia page references connect backend controllers/providers to indexed frontend page files in the same Composer scope. This lets login pages lead back to authentication setup without relying on a provider filename appearing in the task.

Framework class and blueprint targets use a filename lookup prepared once per graph rebuild, avoiding a full repository scan for every static reference. That derived lookup is excluded from the configuration fingerprint.

SQLite FTS5 stores raw text plus split identifiers in a literal column, and lexical stems in a separate column. Corpus normalization never introduces translations or synonyms. Search groups query terms by origin and weight, restricting literal matches to the literal column. Literal terms take priority when the full-text query reaches its term limit. FTS row IDs follow file row IDs, so deleting or replacing one document avoids scanning full-text paths. Import requests have a source-path index. Rejected binary/invalid UTF-8 files retain only metadata, avoiding repeated reads until they change. The index schema is versioned and disposable.

## Task analysis

`resolver.rs` splits identifiers and filters stopwords. `terms.rs` retains literal query terms with weight 1, adds English stems with weight 0.75, and attaches lower-confidence translations and one-hop synonyms only to the query. Each query term records its origin, original word and weight. Ambiguous Italian stems that are also unchanged English words, such as `access`, receive a weaker translation weight. Duplicate translation stems preserve every target. Task analysis also adds explicit paths, symbols, stacktrace locations, Git changes, domains and a change type.

Natural-language token matches are weak search evidence. Only explicit code syntax, CLI symbol hints and recognizable mixed-case/snake-case identifiers reserve symbol slots. Uppercase prose acronyms do not automatically become code references. `frameworks.rs` discovers nested manifest scopes and generates anchored framework ignore rules. The index persists these scopes even when manifest languages are excluded, and the indexed resolver reuses that snapshot.

Confidence scores are heuristic signal summaries, not calibrated probabilities. Timestamp filtering understands UTC log timestamps; logs without timestamps cannot be reliably filtered by age.

## Discovery and ranking

`discovery.rs` loads index metadata once per discovery pass and builds symbol, entity and adjacency maps. It combines exact hints, path terms, full-text content, import traversal, indexed references, related tests/configuration and Node.js/Laravel/Statamic relationships.

Explicit hints reserve slots within the file limit. Path and symbol evidence distinguish literal matches, stems, translations and synonyms, with document frequency reducing ubiquitous terms. Domain paths can recover candidates without direct query-word matches. Domain boosts respect task weights and package boundaries. Git activity is a small secondary signal. Generated/minified assets receive a visible penalty unless explicitly hinted and do not seed ordinary graph expansion.

`graph.rs` traverses directed, typed dependencies. Outgoing imports have stronger evidence than incoming consumers; literal view/Inertia links support reverse traversal back to the backend. Fan-in and fan-out reduce hub influence, and depth, seed and visited-node limits bound expansion. Generic shared-symbol references and filename associations provide weak, non-recursive evidence within package scopes.

`runtime.rs` extracts literal configuration keys and known authentication/session calls from PHP call nodes. Config keys resolve to existing `config/<section>.php` files. Fortify, authentication and session calls connect their runtime configuration and `bootstrap/app.php` within the nearest Composer scope. Comments and quoted examples do not create these runtime edges. These scoped conventions require source evidence, without forcing runtime files merely because a task contains “login”.

`selection.rs` treats `max-files` as a ceiling. It selects candidates by relevance and the additional query, package, file-role and dependency evidence they contribute. It stops when remaining evidence has insufficient marginal value. Distinct dependencies and runtime configurations can add useful context even without task-word matches. Explicit package intent restricts graph seeds and reduces the utility of other scopes; language/framework names and nested test-fixture scopes do not imply package intent; ambiguous requests can retain multiple implementations. Tests, including `e2e` helpers, have a one-fifth ceiling for general tasks, lifted for testing tasks. Explicit hints bypass this test ceiling. Final results use descending relevance and path ties.

Ranking remains heuristic. Framework links and syntactic imports are useful context signals, not a complete semantic call graph.

Each ranking addition and multiplier records a numerical contribution. Candidate evidence also records lexical origin or dependency source, relation kind and hop count. `query.rs` shares discovery with search, explanations and MCP. Explanations rank all scored candidates independently of marginal selection and distinguish omitted candidates, file limits and explicit exclusions without reserving a selected slot for the queried file.

## Git

`git.rs` invokes Git directly without a shell. Revision arguments are validated before diff operations. Diff collection uses explicit prefixes and disables external diff tools, so user Git display configuration does not change parsing. History is collected in one batched log operation and cached by HEAD and the indexed path set. It covers the latest 500 commits.

## Packs

`snippets.rs` scores structural declarations, weighted query matches, error anchors and all changed regions. Literal query evidence outweighs translation and synonym matches when selecting source ranges. It prefers complete declarations, adds import context, merges overlapping ranges and enforces a total line limit per file. Progressive rounds grow relevance-weighted allowances, granting one section per source per round. Multiple readable sources each have a half-allowance ceiling after header costs; a single source can use all remaining tokens. Oversized units are clipped around relevant lines with UTF-8-safe line boundaries. A line exceeding its source ceiling cannot consume another source's allocation and can produce an `oversized_line` omission. Multiple excerpts have distinct range-qualified filenames.

`tokens.rs` caches embedded BPE encoders lazily. `approx` preserves the original byte estimate; selectable `cl100k_base` and `o200k_base` count the complete prompt. Every proposed allocation is checked against the final assembled text so boundaries between Markdown sections cannot exceed the token budget. An accepted allocation must add source lines; metadata-only changes between overlapping clipped declarations cannot keep the allocation loop running. No network tokenizer download is needed.

`pack.rs` preserves existing reports and manifest fields, adding source hashes, multiple ranges, effective options/configuration, selected relationships and parent/update metadata. Incremental composition verifies selected source hashes, sends changed/new excerpts and explicitly invalidates removed context and stale relationships. Unchanged ranges refer to the retained parent chain. Old manifests deserialize with defaults and get a full first refresh when source hashes or query provenance are absent. Changes in weighted query evidence also refresh retained excerpts.

All reports and a tar.gz archive are written to an owned staging directory. A successful rename makes the completed pack visible; failures remove the staging directory. Archive entry order, permissions and timestamps are normalized. The manifest and pack slug contain invocation timestamps.

`main.rs` provides Clap commands, JSON output, task completion through rustyline, and platform-native opening. Public Rust modules expose the same processing stages for integrations.

`mcp.rs` wraps these APIs with the official Rust MCP SDK over stdio. It fixes the project root at startup, serializes index/pack operations and exposes tools plus saved-prompt resources. `evaluation.rs` runs labeled cases in isolated temporary copies or pinned Git archives and fingerprints their datasets and indexed sources. Its annotation, literal-baseline and scoring modules distinguish selected files, actual required/supporting code, unknown relevance and omission causes, with grouped quality and cost reports. `scripts/corpus.py` verifies pinned public archives and source labels, bounds isolated measurement processes, retains failures and records process timing/memory across budgets. See the integration and evaluation guides for their contracts.
