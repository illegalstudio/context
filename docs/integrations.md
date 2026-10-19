# Agent integration

The CLI, public Rust modules and MCP server share the same resolver, ranking, structural excerpt selection and token accounting. Search results and pack manifests use project-relative source paths.

## CLI and JSON

~~~bash
context --root /path/to/project search "payment validation" --limit 5 --json
context --root /path/to/project explain src/payments.ts --task "Fix checkout" --json
context --root /path/to/project pack --task "Fix checkout" --tokenizer o200k_base --json
context --root /path/to/project pack --update latest --json
~~~

Search produces `query`, `queryTerms`, `tokenizer` and a `hits` array. `queryTerms` records each term, its `origin` (`literal`, `stem`, `translation` or `synonym`), original `source` word and heuristic `weight`. Each hit has a path, normalized score, reasons, numerical `contributions`, structured `evidence`, indexed symbols and zero or more excerpts. Lexical evidence distinguishes origins; dependency evidence includes `sourcePath`, `relation` and `hops`. Content evidence identifies its query origin without claiming an exact matching word. The excerpt budget is bounded; symbol metadata and JSON framing are separate. An explanation also reports `queryTerms`, `evidence`, indexing/selection status, rank and dependency edges. Its `low_marginal_value` status means a scored candidate was omitted while file capacity remained; `below_file_limit` means the file ceiling was reached. Search and pack limits can return fewer files than requested. Scores describe relative heuristic relevance, not a probability of correctness.

Pack stdout JSON is its manifest. Its task includes `queryTerms`; each selected file includes `contributions` and `evidence`. Older manifests remain readable with empty defaults for these added fields. Read `PACK.md` from `.context/packs/<slug>/` for the prompt. `sourceHash` is a BLAKE3 hash of the source captured for that file. `excerptRanges` lists all included sections; the original `excerptRange` is retained as the first range. A null first range means no source excerpt fit; `omissionReason` distinguishes `token_budget`, `oversized_line` and `source_memory_limit`. Selection and excerpt ordering remain deterministic for identical source, settings and inputs.

## MCP stdio

Start a server for one project:

~~~bash
context --root /absolute/path/to/project mcp
~~~

The server uses the official `rmcp` Rust SDK for protocol negotiation, schemas, transport and request handling. Its stdout is reserved for MCP messages. It runs locally, uses embedded tokenizer vocabularies and requires no API key.

For clients with an `mcpServers` configuration, use:

~~~json
{
  "mcpServers": {
    "context": {
      "command": "context",
      "args": ["--root", "/absolute/path/to/project", "mcp"]
    }
  }
}
~~~

Use the installed executable's absolute path if the client does not inherit your shell's PATH. Configure a separate server entry for each project. Project roots are fixed at startup and cannot be overridden by tool arguments.

| Tool | Arguments | Result |
| --- | --- | --- |
| `context_search` | `query`, optional `limit` (1 to 100) | Ranked files, symbols, reasons and excerpts |
| `context_explain` | `task`, `path`, optional `max_files` | Selection status, score contributions and edges |
| `context_pack` | `task` for a new pack; optional `budget_tokens`, `max_files`, `tokenizer`, `update` | Manifest and complete prompt |
| `context_list` | None | Up to 100 newest pack manifests |
| `context_read_pack` | `slug`, unique prefix or `latest` | Manifest and saved prompt |

`context_pack` limits `max_files` to 1000 and `budget_tokens` to 1000000. Its `update` argument selects a parent pack and inherits unset selection options. MCP accepts no arbitrary error-log path and does not replay an error-log path saved by a CLI invocation. A new task may still contain indexed filename and symbol hints.

Search, explanations and pack creation refresh the local index and initialize Context settings if necessary. Pack creation also writes a completed pack. Operations on one MCP server are serialized to keep these updates coherent. Existing source code is not edited. Application failures return MCP tool errors; invalid argument types and unknown properties are rejected by the SDK.

Saved prompts are also resources with URIs `context://packs/<slug>`. `resources/list` returns up to 100 newest packs and `resources/read` returns `PACK.md`. Refresh the list after creating a pack. Pack selection and resource reads reject traversal and files redirected outside the selected project pack.

## Incremental conversations

1. Ask for a normal pack and retain its prompt.
2. After edits, call `context_pack` with `update` set to that pack's slug. Use `latest` only when the newest saved pack is the context you retained.
3. Apply replacement excerpts and removal instructions from the returned prompt. Preserve excerpts marked unchanged through the parent reference.
4. Use the returned new slug as the next parent.

Each delta includes `parentPack` and `changes`: `added`, `changed`, `removed`, `unchanged` and `staleReferences`. Its file list describes the entire current selection. Unchanged files keep their source hash and earlier ranges; their code is not sent again. Changed files replace previous excerpts, including an instruction to discard stale excerpts when the replacement does not fit. New files add context. Removed files leave the retained context. Stale relationships refer to earlier selected dependency edges that no longer exist in the new selection.

Updates verify source hashes even when file metadata is unchanged. New task/options/tokenizer settings or changed query evidence refresh affected retained context. Packs from before query provenance receive a full first refresh even when source hashes are present. Legacy packs without hashes are fully refreshed on their first update. `excerptStrategyVersion` identifies excerpt and allocation policy: a missing or changed version forces one complete refresh even when source hashes and task options are unchanged. Later updates reuse unchanged context normally. A delta is meaningful with its parent chain; create a normal pack to obtain a standalone prompt.

Named test functions retain their declaration kinds and add optional `isTestCase` metadata; supported literal callback registrations use symbol kind `test`. `test_intent` evidence records original query concepts matched by declaration names; it is a syntactic relevance signal, not proof that a test executes successfully. Index schema 10 reparses older caches. Excerpt strategy 3 refreshes retained ranges after focused-test excerpt planning. Matched cases keep their assertions and shared setup without automatically including unrelated sibling cases or the enclosing class. Normal token/line ceilings still apply; explicit file/symbol requests preserve the requested context.
