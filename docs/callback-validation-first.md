# Cross-project retrieval measurements

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 4 | 0 | 87.5% | 64.6% | 50.0% |
| context | 16000 | 4 | 0 | 87.5% | 64.6% | 50.0% |
| context | 32000 | 4 | 0 | 87.5% | 64.6% | 50.0% |
| lexical | 8000 | 4 | 0 | 87.5% | 64.6% | 50.0% |
| lexical | 16000 | 4 | 0 | 87.5% | 64.6% | 50.0% |
| lexical | 32000 | 4 | 0 | 87.5% | 64.6% | 50.0% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 3 | 33.3% | 7995 | 1 | 10.0% |
| context | 16000 | 3 | 33.3% | 14558 | 1 | 10.0% |
| context | 32000 | 3 | 33.3% | 19582 | 1 | 10.0% |
| lexical | 8000 | 3 | 0.0% | 7996 | 1 | 8.0% |
| lexical | 16000 | 3 | 33.3% | 15620 | 1 | 8.0% |
| lexical | 32000 | 3 | 63.3% | 24379 | 1 | 8.0% |

Supporting file recall measures selection, separately from coverage of annotated test lines.

| Method | Budget | Supporting file cases | Supporting file recall |
| --- | ---: | ---: | ---: |
| context | 8000 | 3 | 50.0% |
| context | 16000 | 3 | 50.0% |
| context | 32000 | 3 | 50.0% |
| lexical | 8000 | 3 | 50.0% |
| lexical | 16000 | 3 | 66.7% |
| lexical | 32000 | 3 | 66.7% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 4 | 0 | 64.6% | 50.0% |
| eval | lexical | 4 | 0 | 64.6% | 50.0% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| javascript | context | 1 | 0 | 100.0% | 100.0% |
| php | context | 1 | 0 | 100.0% | 100.0% |
| python | context | 1 | 0 | 0.0% | 0.0% |
| typescript | context | 1 | 0 | 58.3% | 0.0% |
| javascript | lexical | 1 | 0 | 100.0% | 100.0% |
| php | lexical | 1 | 0 | 100.0% | 100.0% |
| python | lexical | 1 | 0 | 0.0% | 0.0% |
| typescript | lexical | 1 | 0 | 58.3% | 0.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| bottlepy/bottle | context | 1 | 0 | 0.0% | 0.0% |
| koajs/koa | context | 1 | 0 | 100.0% | 100.0% |
| slimphp/Slim | context | 1 | 0 | 100.0% | 100.0% |
| vitest-dev/vitest | context | 1 | 0 | 58.3% | 0.0% |
| bottlepy/bottle | lexical | 1 | 0 | 0.0% | 0.0% |
| koajs/koa | lexical | 1 | 0 | 100.0% | 100.0% |
| slimphp/Slim | lexical | 1 | 0 | 100.0% | 100.0% |
| vitest-dev/vitest | lexical | 1 | 0 | 58.3% | 0.0% |

## Preparation and evaluation failures

No execution failures.

## Measurement conditions

- Pinned archives and source labels are identical across paired methods/builds. Case batches overlap on a shared development host, so timings are diagnostic. Labels are sparse and agent-reviewed. Reserved-case results used for corrections are regression evidence.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
