# Cross-project retrieval improvements

The four retrieval improvements are implemented, with additional fixes for incomplete TypeScript configuration, test budget balance and incremental policy refresh. The final 16000-token replays complete all 102 tasks across 28 repositories. Complete annotated context remains limited to 40/80 original cases and 6/18 expanded cases. These are regression measurements after inspecting the initial evaluation, not proof of generalization.

## Changes

- Recognize first-party sources explicitly opted into dependency directories by root Git ignore rules. Share this policy across indexing, framework discovery, initialization and evaluation copies. Existing `.ctxignore` files remain authoritative.
- Persist syntactic test roles in schema 8. Prioritize implementation in mixed implementation/test files; keep reference scoring and window ordering for ordinary code. Split long functions only when separated regions add distinct query concepts; keep repeated concepts and composite declarations contiguous. Favor active configuration values over comment headers.
- Link strong implementations to direct import tests or source/test counterparts. Prefer new query facets and package evidence over repeated filenames. Weak lexical symbol references cannot create query-facet novelty. Related tests need a selected implementation or independent new query/scope/dependency evidence.
- Share an initial one-fifth excerpt allowance among unreserved tests while implementation grows. Tests can borrow unused capacity afterwards. Testing focus and explicit references bypass the quota.
- Build Java filename/package indexes once per graph rebuild, resolving local classes, nested/static members and direct-package wildcards without full scans per external import.
- Continue when an inherited TypeScript config is absent, including external presets and generated local files. Report missing path/reference pairs and unavailable inherited mappings. Invalid present configs, cycles and paths outside the root remain errors. Newly available presets refresh imports without source changes.
- Record `excerptStrategyVersion` in manifests so older policies receive one full refresh even when source hashes are unchanged. Later updates reuse unchanged context normally.

## Paired outcomes at 16000 tokens

| Suite | Essential lines before | After | Complete contexts before | After | Execution failures before | After |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Original 80 tasks | 53.6% | 62.4% | 36/80 | 40/80 | 5 | 0 |
| Billing/notifications, 4 tasks | 50.0% | 50.0% | 2/4 | 2/4 | 0 | 0 |
| Expanded 18 tasks | 32.7% | 39.4% | 5/18 | 6/18 | 4 | 0 |

The original corpus improves essential-line coverage on 9 tasks and keeps 71 unchanged. No essential-line coverage regressions remain in the original 80-task replay.

An intermediate candidate lost the response-header guard in `expressjs--express-3` and the correction precondition in `rubocop--rubocop-2`. Restoring ordinary-code window behavior, protecting implementation tokens and rejecting redundant test facets recovers those cases. [Before/intermediate/final source ranges](excerpt-regression-recovery.json) retain the evidence. Dedicated regressions cover early guards, repeated-concept fragmentation, weak identifiers mentioned only in comments, test quota/focus/borrowing and old-policy incremental refresh.

Starship essential-line coverage changes from 11.0% to 42.0%, with required-file recall 100.0%. Node-RED changes from zero to 60.0%: all annotated sources become indexable, though ranking omissions remain. All five Spring tasks now finish under the 180-second per-process deadline; their essential-line coverage is 50.0%. Execution success does not imply complete context.

Supporting-test line coverage changes from 20.8% to 21.0% over 53 annotated original tasks. Supporting-file recall changes from 46.3% to 53.7% over 54 tasks. Expanded supporting-file recall changes from 23.1% to 34.6% over 13 tasks, with no supporting-line windows labeled there. Supporting-test excerpts remain a weak point despite improved file recall. These measures are separate and do not isolate causal effects of individual features.

## The initial unseen evaluation rejected a broader scorer

Before implementation, 18 tasks and 41 required windows were frozen on ten new repositories: CakePHP, Starlette, Fastify, tRPC, Hugo, Nushell, Hanami Router, Micronaut, System.CommandLine and Vapor. They cover eight structural parser languages plus C# and Swift text fallback.

At 16000 tokens, the first candidate reduced essential-line coverage from 32.7% to 20.5% and complete contexts from 5/18 to 3/18. Both initial binaries also failed four tasks because their snapshots referenced missing TypeScript presets. The [initial raw evaluation](corpus-validation-first-attempt.json) and [initial summary](corpus-validation-first-attempt.md) preserve those adverse outcomes.

That result rejected file-local rarity scoring and universal production priority. The final scorer keeps bounded reference name/body evidence and scopes special treatment to tests, mixed files and configuration. A synthetic name-versus-comment-density regression yields complete essential coverage on the reference and final implementations, but zero on the rejected candidate.

The corrected replay removes all four execution failures. Among the 14 previously successful cases, essential coverage improves in 0, remains unchanged in 14, and regresses in 0. The aggregate gain includes newly executable cases and must not be read as independent generalization evidence. [Targeted 8000/32000 checks](corpus-excerpt-corners.md) cover the four affected excerpt cases separately from the full 16000-token suite.

On the expanded suite, Context includes 39.4% of essential lines and 6/18 complete contexts, versus 43.6% and 6/18 for literal retrieval. Required-file recall is 58.3% versus 72.2%. File selection and actual code coverage must be measured separately. These repositories have now informed changes and cannot serve as a fresh holdout for future tuning.

## Costs, noise and scalability

Original successful-case mean token usage changes from 15070 to 15191 at a 16000-token ceiling, over 75 successful baseline cases versus 80 final cases. These different denominators prevent treating the means as a controlled cost comparison. Billing/notification completeness is 2/4; the rejected candidate had reached [3/4](corpus-domains-first-attempt.md). Expanded successful-case token usage changes from 14366 to 13927, with 18 successful tasks instead of 14. That denominator change prevents interpreting the mean as a controlled token-saving estimate.

Known-negative selections change from 9 to 9 in the original corpus and 1 to 2 in the expanded corpus. Only 7.1% and 5.9% of selected files respectively have explicit relevance labels. The rest are unclassified, so total noise and general relevance precision cannot be inferred.

A separate cold index sample on the final release processes 11319 Spring files, 103990 symbols and 89059 import requests in 17.4 seconds with 79.6 MiB peak resident memory. It resolves 41892 edges and retains 652696 lexical references. The pre-change serial command was stopped after more than 190 seconds, with no completed timing. Interrupted indexing had committed a cache, so warm reuse was excluded from cold comparisons.

Whole-evaluation peak memory is 292 MiB, including indexing, discovery and BPE excerpts. Original timed-out Spring runs lack comparable completed-process memory. Corpus batches overlapped local development work. Timings are diagnostic samples, not controlled speedup ratios; filesystem caches were not cleared.

## Artifacts and reproduction

- [Original final summary](corpus-improved-results.md), [raw measurements](corpus-improved-results.json).
- [Domain final summary](corpus-domains-improved-results.md), [raw measurements](corpus-domains-improved-results.json).
- [Expanded baseline](corpus-validation-before.md), [raw baseline](corpus-validation-before.json).
- [Expanded final replay](corpus-validation-after.md), [raw replay](corpus-validation-after.json).
- [Paired metrics, source/build fingerprints and cold-index profile](retrieval-improvements-results.json).

```bash
cargo build --release --locked
python3 scripts/corpus.py run --manifest benchmarks/corpus.json --split all --methods context --budgets 16000 --output original-final.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-domains.json --split all --methods context --budgets 16000 --output domains-final.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-validation.json --split all --budgets 16000 --output expanded-final.json
```

The manual workflow supports the expanded suite and all three budgets. Full final corpus runs contain 120 measurements; eight targeted budget checks are separate. The initial expanded baseline and candidate each retain 108 measurements across three budgets. Third-party application sources are not bundled, dependencies are not installed, and upstream application test suites are not executed.

Verification passes 78 Rust tests, 58 Python tests, formatting, clippy, Rust 1.90 compilation, release builds and portable Linux package checks. The three historical Context tasks preserve recall and top-five recall of 1. Reserve independently reviewed, previously unseen repositories before further tuning.
