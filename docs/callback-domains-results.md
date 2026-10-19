# Cross-project retrieval measurements

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 16000 | 4 | 0 | 75.0% | 50.0% | 50.0% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 16000 | 2 | 50.0% | 15994 | 0 | 5.1% |

Supporting file recall measures selection, separately from coverage of annotated test lines.

| Method | Budget | Supporting file cases | Supporting file recall |
| --- | ---: | ---: | ---: |
| context | 16000 | 2 | 50.0% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 4 | 0 | 50.0% | 50.0% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| python | context | 2 | 0 | 50.0% | 50.0% |
| ruby | context | 2 | 0 | 50.0% | 50.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| pretix/pretix | context | 2 | 0 | 50.0% | 50.0% |
| solidusio/solidus | context | 2 | 0 | 50.0% | 50.0% |

## Preparation and evaluation failures

No execution failures.

## Measurement conditions

- Pinned archives and source labels are identical across paired methods/builds. Case batches overlap on a shared development host, so timings are diagnostic. Labels are sparse and agent-reviewed. Reserved-case results used for corrections are regression evidence.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
