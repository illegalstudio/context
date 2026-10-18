# Cross-project retrieval measurements

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 18 | 4 | 41.7% | 17.8% | 16.7% |
| context | 16000 | 18 | 4 | 41.7% | 20.5% | 16.7% |
| context | 32000 | 18 | 4 | 41.7% | 40.1% | 33.3% |
| lexical | 8000 | 18 | 4 | 55.6% | 17.4% | 11.1% |
| lexical | 16000 | 18 | 4 | 55.6% | 28.5% | 22.2% |
| lexical | 32000 | 18 | 4 | 55.6% | 41.9% | 33.3% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 0 | unavailable | 7961 | 1 | 5.1% |
| context | 16000 | 0 | unavailable | 14443 | 1 | 5.1% |
| context | 32000 | 0 | unavailable | 24991 | 1 | 5.1% |
| lexical | 8000 | 0 | unavailable | 7994 | 0 | 4.9% |
| lexical | 16000 | 0 | unavailable | 15994 | 0 | 4.9% |
| lexical | 32000 | 0 | unavailable | 28015 | 0 | 4.9% |

Supporting file recall measures selection, separately from coverage of annotated test lines.

| Method | Budget | Supporting file cases | Supporting file recall |
| --- | ---: | ---: | ---: |
| context | 8000 | 13 | 30.8% |
| context | 16000 | 13 | 30.8% |
| context | 32000 | 13 | 30.8% |
| lexical | 8000 | 13 | 38.5% |
| lexical | 16000 | 13 | 38.5% |
| lexical | 32000 | 13 | 38.5% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 18 | 4 | 20.5% | 16.7% |
| eval | lexical | 18 | 4 | 28.5% | 22.2% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| csharp | context | 1 | 0 | 0.0% | 0.0% |
| go | context | 2 | 0 | 0.0% | 0.0% |
| java | context | 2 | 0 | 34.3% | 0.0% |
| javascript | context | 2 | 2 | 0.0% | 0.0% |
| php | context | 2 | 0 | 0.0% | 0.0% |
| python | context | 2 | 0 | 50.0% | 50.0% |
| ruby | context | 2 | 0 | 50.0% | 50.0% |
| rust | context | 2 | 0 | 0.0% | 0.0% |
| swift | context | 1 | 0 | 100.0% | 100.0% |
| typescript | context | 2 | 2 | 0.0% | 0.0% |
| csharp | lexical | 1 | 0 | 0.0% | 0.0% |
| go | lexical | 2 | 0 | 0.0% | 0.0% |
| java | lexical | 2 | 0 | 0.0% | 0.0% |
| javascript | lexical | 2 | 2 | 0.0% | 0.0% |
| php | lexical | 2 | 0 | 0.0% | 0.0% |
| python | lexical | 2 | 0 | 100.0% | 100.0% |
| ruby | lexical | 2 | 0 | 86.8% | 50.0% |
| rust | lexical | 2 | 0 | 20.0% | 0.0% |
| swift | lexical | 1 | 0 | 100.0% | 100.0% |
| typescript | lexical | 2 | 2 | 0.0% | 0.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| cakephp/cakephp | context | 2 | 0 | 0.0% | 0.0% |
| dotnet/command-line-api | context | 1 | 0 | 0.0% | 0.0% |
| encode/starlette | context | 2 | 0 | 50.0% | 50.0% |
| fastify/fastify | context | 2 | 2 | 0.0% | 0.0% |
| gohugoio/hugo | context | 2 | 0 | 0.0% | 0.0% |
| hanami/router | context | 2 | 0 | 50.0% | 50.0% |
| micronaut-projects/micronaut-core | context | 2 | 0 | 34.3% | 0.0% |
| nushell/nushell | context | 2 | 0 | 0.0% | 0.0% |
| trpc/trpc | context | 2 | 2 | 0.0% | 0.0% |
| vapor/vapor | context | 1 | 0 | 100.0% | 100.0% |
| cakephp/cakephp | lexical | 2 | 0 | 0.0% | 0.0% |
| dotnet/command-line-api | lexical | 1 | 0 | 0.0% | 0.0% |
| encode/starlette | lexical | 2 | 0 | 100.0% | 100.0% |
| fastify/fastify | lexical | 2 | 2 | 0.0% | 0.0% |
| gohugoio/hugo | lexical | 2 | 0 | 0.0% | 0.0% |
| hanami/router | lexical | 2 | 0 | 86.8% | 50.0% |
| micronaut-projects/micronaut-core | lexical | 2 | 0 | 0.0% | 0.0% |
| nushell/nushell | lexical | 2 | 0 | 20.0% | 0.0% |
| trpc/trpc | lexical | 2 | 2 | 0.0% | 0.0% |
| vapor/vapor | lexical | 1 | 0 | 100.0% | 100.0% |

## Preparation and evaluation failures

- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-FQzNLf/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-LKqUFJ/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-VAeFTe/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-dholSB/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-iWP3UM/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-vYDPfH/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-BOfMqM/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-Gy03hp/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-HH0QpV/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-Ua9wb8/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-Wqb5oJ/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-xTTNbn/0/test/types
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-4CxmRt/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-7WwG4b/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-JIc0Qe/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-QFCeZJ/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-VpDmVx/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-oYUBZx/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-3SViit/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-EUXGGE/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-Ise5li/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-bJCkc7/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-p7BiVT/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-vPmOju/0/examples/.test/internal-types-export

## Measurement conditions

- First candidate, frozen before validation scores were inspected. These initial adverse outcomes are retained. Later replays on this manifest are regression data.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
