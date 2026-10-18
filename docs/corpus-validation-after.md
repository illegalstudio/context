# Cross-project retrieval measurements

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 16000 | 18 | 0 | 58.3% | 39.4% | 33.3% |
| lexical | 16000 | 18 | 0 | 72.2% | 43.6% | 33.3% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 16000 | 0 | unavailable | 13927 | 2 | 5.9% |
| lexical | 16000 | 0 | unavailable | 15994 | 0 | 5.3% |

Supporting file recall measures selection, separately from coverage of annotated test lines.

| Method | Budget | Supporting file cases | Supporting file recall |
| --- | ---: | ---: | ---: |
| context | 16000 | 13 | 34.6% |
| lexical | 16000 | 13 | 61.5% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 18 | 0 | 39.4% | 33.3% |
| eval | lexical | 18 | 0 | 43.6% | 33.3% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| csharp | context | 1 | 0 | 0.0% | 0.0% |
| go | context | 2 | 0 | 0.0% | 0.0% |
| java | context | 2 | 0 | 44.6% | 0.0% |
| javascript | context | 2 | 0 | 50.0% | 50.0% |
| php | context | 2 | 0 | 50.0% | 50.0% |
| python | context | 2 | 0 | 100.0% | 100.0% |
| ruby | context | 2 | 0 | 50.0% | 50.0% |
| rust | context | 2 | 0 | 0.0% | 0.0% |
| swift | context | 1 | 0 | 100.0% | 100.0% |
| typescript | context | 2 | 0 | 10.0% | 0.0% |
| csharp | lexical | 1 | 0 | 0.0% | 0.0% |
| go | lexical | 2 | 0 | 50.0% | 50.0% |
| java | lexical | 2 | 0 | 33.3% | 0.0% |
| javascript | lexical | 2 | 0 | 25.0% | 0.0% |
| php | lexical | 2 | 0 | 0.0% | 0.0% |
| python | lexical | 2 | 0 | 100.0% | 100.0% |
| ruby | lexical | 2 | 0 | 73.7% | 50.0% |
| rust | lexical | 2 | 0 | 10.0% | 0.0% |
| swift | lexical | 1 | 0 | 100.0% | 100.0% |
| typescript | lexical | 2 | 0 | 50.0% | 50.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| cakephp/cakephp | context | 2 | 0 | 50.0% | 50.0% |
| dotnet/command-line-api | context | 1 | 0 | 0.0% | 0.0% |
| encode/starlette | context | 2 | 0 | 100.0% | 100.0% |
| fastify/fastify | context | 2 | 0 | 50.0% | 50.0% |
| gohugoio/hugo | context | 2 | 0 | 0.0% | 0.0% |
| hanami/router | context | 2 | 0 | 50.0% | 50.0% |
| micronaut-projects/micronaut-core | context | 2 | 0 | 44.6% | 0.0% |
| nushell/nushell | context | 2 | 0 | 0.0% | 0.0% |
| trpc/trpc | context | 2 | 0 | 10.0% | 0.0% |
| vapor/vapor | context | 1 | 0 | 100.0% | 100.0% |
| cakephp/cakephp | lexical | 2 | 0 | 0.0% | 0.0% |
| dotnet/command-line-api | lexical | 1 | 0 | 0.0% | 0.0% |
| encode/starlette | lexical | 2 | 0 | 100.0% | 100.0% |
| fastify/fastify | lexical | 2 | 0 | 25.0% | 0.0% |
| gohugoio/hugo | lexical | 2 | 0 | 50.0% | 50.0% |
| hanami/router | lexical | 2 | 0 | 73.7% | 50.0% |
| micronaut-projects/micronaut-core | lexical | 2 | 0 | 33.3% | 0.0% |
| nushell/nushell | lexical | 2 | 0 | 10.0% | 0.0% |
| trpc/trpc | lexical | 2 | 0 | 50.0% | 50.0% |
| vapor/vapor | lexical | 1 | 0 | 100.0% | 100.0% |

## Preparation and evaluation failures

No execution failures.

## Measurement conditions

- Measured after the frozen implementation; primary, supplementary and validation batches overlapped on the local host. Primary/domain final runs use Context at 16000 tokens; the corrected 18-case replay uses both methods at 16000 tokens. The original baseline and first candidate retain all three budgets. Per-case wall time is diagnostic, not a controlled speed comparison. The separate Spring cold-index profile uses one benchmark process.
- Source-policy changes can expand the indexed source set while pinned archives and annotations remain identical. Literal-baseline runs also use the new shared index and excerpt planner.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
