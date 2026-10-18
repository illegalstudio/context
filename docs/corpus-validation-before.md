# Cross-project retrieval measurements

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 18 | 4 | 41.7% | 21.6% | 16.7% |
| context | 16000 | 18 | 4 | 41.7% | 32.7% | 27.8% |
| context | 32000 | 18 | 4 | 41.7% | 40.1% | 33.3% |
| lexical | 8000 | 18 | 4 | 55.6% | 18.9% | 11.1% |
| lexical | 16000 | 18 | 4 | 55.6% | 27.8% | 22.2% |
| lexical | 32000 | 18 | 4 | 55.6% | 45.2% | 38.9% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 0 | unavailable | 7929 | 1 | 4.6% |
| context | 16000 | 0 | unavailable | 14366 | 1 | 4.6% |
| context | 32000 | 0 | unavailable | 25135 | 1 | 4.6% |
| lexical | 8000 | 0 | unavailable | 7994 | 0 | 4.9% |
| lexical | 16000 | 0 | unavailable | 15995 | 0 | 4.9% |
| lexical | 32000 | 0 | unavailable | 28010 | 0 | 4.9% |

Supporting file recall measures selection, separately from coverage of annotated test lines.

| Method | Budget | Supporting file cases | Supporting file recall |
| --- | ---: | ---: | ---: |
| context | 8000 | 13 | 23.1% |
| context | 16000 | 13 | 23.1% |
| context | 32000 | 13 | 23.1% |
| lexical | 8000 | 13 | 38.5% |
| lexical | 16000 | 13 | 38.5% |
| lexical | 32000 | 13 | 38.5% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 18 | 4 | 32.7% | 27.8% |
| eval | lexical | 18 | 4 | 27.8% | 22.2% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| csharp | context | 1 | 0 | 0.0% | 0.0% |
| go | context | 2 | 0 | 0.0% | 0.0% |
| java | context | 2 | 0 | 44.6% | 0.0% |
| javascript | context | 2 | 2 | 0.0% | 0.0% |
| php | context | 2 | 0 | 50.0% | 50.0% |
| python | context | 2 | 0 | 100.0% | 100.0% |
| ruby | context | 2 | 0 | 50.0% | 50.0% |
| rust | context | 2 | 0 | 0.0% | 0.0% |
| swift | context | 1 | 0 | 100.0% | 100.0% |
| typescript | context | 2 | 2 | 0.0% | 0.0% |
| csharp | lexical | 1 | 0 | 0.0% | 0.0% |
| go | lexical | 2 | 0 | 0.0% | 0.0% |
| java | lexical | 2 | 0 | 16.7% | 0.0% |
| javascript | lexical | 2 | 2 | 0.0% | 0.0% |
| php | lexical | 2 | 0 | 0.0% | 0.0% |
| python | lexical | 2 | 0 | 100.0% | 100.0% |
| ruby | lexical | 2 | 0 | 73.7% | 50.0% |
| rust | lexical | 2 | 0 | 10.0% | 0.0% |
| swift | lexical | 1 | 0 | 100.0% | 100.0% |
| typescript | lexical | 2 | 2 | 0.0% | 0.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| cakephp/cakephp | context | 2 | 0 | 50.0% | 50.0% |
| dotnet/command-line-api | context | 1 | 0 | 0.0% | 0.0% |
| encode/starlette | context | 2 | 0 | 100.0% | 100.0% |
| fastify/fastify | context | 2 | 2 | 0.0% | 0.0% |
| gohugoio/hugo | context | 2 | 0 | 0.0% | 0.0% |
| hanami/router | context | 2 | 0 | 50.0% | 50.0% |
| micronaut-projects/micronaut-core | context | 2 | 0 | 44.6% | 0.0% |
| nushell/nushell | context | 2 | 0 | 0.0% | 0.0% |
| trpc/trpc | context | 2 | 2 | 0.0% | 0.0% |
| vapor/vapor | context | 1 | 0 | 100.0% | 100.0% |
| cakephp/cakephp | lexical | 2 | 0 | 0.0% | 0.0% |
| dotnet/command-line-api | lexical | 1 | 0 | 0.0% | 0.0% |
| encode/starlette | lexical | 2 | 0 | 100.0% | 100.0% |
| fastify/fastify | lexical | 2 | 2 | 0.0% | 0.0% |
| gohugoio/hugo | lexical | 2 | 0 | 0.0% | 0.0% |
| hanami/router | lexical | 2 | 0 | 73.7% | 50.0% |
| micronaut-projects/micronaut-core | lexical | 2 | 0 | 16.7% | 0.0% |
| nushell/nushell | lexical | 2 | 0 | 10.0% | 0.0% |
| trpc/trpc | lexical | 2 | 2 | 0.0% | 0.0% |
| vapor/vapor | lexical | 1 | 0 | 100.0% | 100.0% |

## Preparation and evaluation failures

- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-Ga0Ibd/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-JptRIW/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-PqJEmx/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-bqqcta/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-kSsJTe/0/test/types
- `fastify--fastify-1` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-nFB45v/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-03ZvBv/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-Powbin/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-TfCUgu/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-iSqhZe/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-k1pyha/0/test/types
- `fastify--fastify-2` (evaluation_failed): Error: Cannot resolve tsconfig extension fastify-tsconfig from [scratch]/process-temp/context-evaluation-p6klU4/0/test/types
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-34zzuI/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-A8HWrb/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-SdeMvB/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-oEdJ2o/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-uyczh0/0/examples/.test/internal-types-export
- `trpc--trpc-1` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-yoYo7e/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-P8uvDQ/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-QVvSSu/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-VwmjvS/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-Xy6eyt/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-aOiCkT/0/examples/.test/internal-types-export
- `trpc--trpc-2` (evaluation_failed): Error: Cannot resolve tsconfig extension @tsconfig/node-lts from [scratch]/process-temp/context-evaluation-xzMIrr/0/examples/.test/internal-types-export

## Measurement conditions

- Measured before implementation with the immutable pre-change release binary; four concurrent case workers and two index threads per child.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
