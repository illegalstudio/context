# Implementation

Context is a Rust library and CLI. The CLI has no Node runtime or npm dependencies.

## Indexing

`indexer.rs` traverses directories with the ignore crate, applies file/language limits and compares size and nanosecond modification time against the existing index. Eligible updates are read once and hashed with BLAKE3. Equal hashes update metadata without reparsing.

Rayon workers reuse Tree-sitter parser instances within bounded batches. The batch size bounds retained source bytes to approximately 64 MiB before derived parser/search data, unless the configured individual file limit itself is larger. Metadata and index structures still grow with repository size.

`parser.rs` extracts real declarations and source ranges for TypeScript, JavaScript, PHP, Python, Go, Rust, Ruby and Java. Other UTF-8 files contribute searchable text and references. Parsing recovers useful declarations from incomplete code; it does not perform type checking or prove runtime dependency relationships.

`database.rs` consumes parsed batches lazily inside a single SQLite transaction. Statements are reused. Deleted and newly excluded files lose their metadata, symbols, import requests, references and full-text entries. Import requests are stored separately from resolved edges, so newly created targets become connected even when the importing source did not change. Schema 5 rebuilds the disposable index to capture framework resource requests.

`project.rs` builds a serializable scoped map of TypeScript configs, local package exports, Composer namespaces and Rust library roots. Its fingerprint invalidates resolved edges after config changes, without reparsing unchanged sources. Metadata discovery occurs before language filtering. Explicit framework string references are captured once during parsing and resolved against indexed resources. Neither application code nor package build scripts are executed.

Framework class and blueprint targets use a filename lookup prepared once per graph rebuild, avoiding a full repository scan for every static reference. That derived lookup is excluded from the configuration fingerprint.

SQLite FTS5 stores raw text and normalized search terms. Search combines task terms into a single indexed query. FTS row IDs follow file row IDs, so deleting or replacing one document avoids scanning full-text paths. Import requests have a source-path index. Rejected binary/invalid UTF-8 files retain only metadata, avoiding repeated reads until they change. The index schema is versioned and disposable.

## Task analysis

`resolver.rs` splits identifiers, filters stopwords and uses Snowball stemming. Embedded English and Italian synonym groups and Italian stem translations preserve the original vocabulary. Task analysis adds explicit paths, symbols, stacktrace locations, Git changes, domains and a change type.

Confidence scores are heuristic signal summaries, not calibrated probabilities. Timestamp filtering understands UTC log timestamps; logs without timestamps cannot be reliably filtered by age.

## Discovery and ranking

`discovery.rs` loads index metadata once per discovery pass and builds symbol, entity and adjacency maps. It combines exact hints, path terms, full-text content, import traversal, indexed references, related tests/configuration and Node.js/Laravel/Statamic relationships.

Explicit hints reserve slots within the file limit. Import expansion has bounded depth, seed count and visited-node count. Domain boosts reflect task domain weights. Git activity is a small secondary signal. Relevant tests and configuration get small quotas; unused slots remain available to other files. Equal scores are ordered by path.

Ranking remains heuristic. Framework links and syntactic imports are useful context signals, not a complete semantic call graph.

Each ranking addition and multiplier records a numerical contribution. `query.rs` shares discovery with search, explanations and MCP. It can explain candidates omitted by file limits and explicit exclusions without reserving a selected slot for the queried file.

## Git

`git.rs` invokes Git directly without a shell. Revision arguments are validated before diff operations. Diff collection uses explicit prefixes and disables external diff tools, so user Git display configuration does not change parsing. History is collected in one batched log operation and cached by HEAD and the indexed path set. It covers the latest 500 commits.

## Packs

`snippets.rs` scores structural declarations, task keyword locations, error anchors and all changed regions. It prefers complete declarations, adds import context, merges overlapping ranges and enforces a total line limit per file. Allocation first distributes a relevance-weighted share to each file, then uses spare capacity for additional ranges. Oversized units are clipped around relevant lines with UTF-8-safe line boundaries. Multiple excerpts have distinct range-qualified filenames.

`tokens.rs` caches embedded BPE encoders lazily. `approx` preserves the original byte estimate; selectable `cl100k_base` and `o200k_base` count the complete prompt. Every proposed allocation is checked against the final assembled text so boundaries between Markdown sections cannot exceed the token budget. No network tokenizer download is needed.

`pack.rs` preserves existing reports and manifest fields, adding source hashes, multiple ranges, effective options/configuration, selected relationships and parent/update metadata. Incremental composition verifies selected source hashes, sends changed/new excerpts and explicitly invalidates removed context and stale relationships. Unchanged ranges refer to the retained parent chain. Old manifests deserialize with defaults and get a full first refresh.

All reports and a tar.gz archive are written to an owned staging directory. A successful rename makes the completed pack visible; failures remove the staging directory. Archive entry order, permissions and timestamps are normalized. The manifest and pack slug contain invocation timestamps.

`main.rs` provides Clap commands, JSON output, task completion through rustyline, and platform-native opening. Public Rust modules expose the same processing stages for integrations.

`mcp.rs` wraps these APIs with the official Rust MCP SDK over stdio. It fixes the project root at startup, serializes index/pack operations and exposes tools plus saved-prompt resources. `evaluation.rs` runs labeled cases in isolated temporary copies or pinned Git archives, fingerprints the dataset and source snapshots, and reports retrieval, excerpt coverage, token and timing metrics. See the integration and evaluation guides for their contracts.
