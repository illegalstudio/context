# Cross-project retrieval measurements

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 16000 | 80 | 0 | 79.7% | 58.2% | 46.2% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 16000 | 53 | 25.6% | 15597 | 9 | 6.9% |

Supporting file recall measures selection, separately from coverage of annotated test lines.

| Method | Budget | Supporting file cases | Supporting file recall |
| --- | ---: | ---: | ---: |
| context | 16000 | 54 | 56.5% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 40 | 0 | 52.5% | 37.5% |
| train | context | 40 | 0 | 63.9% | 55.0% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| go | context | 10 | 0 | 29.3% | 20.0% |
| java | context | 10 | 0 | 60.0% | 40.0% |
| javascript | context | 10 | 0 | 70.0% | 60.0% |
| php | context | 10 | 0 | 79.7% | 60.0% |
| python | context | 10 | 0 | 34.5% | 30.0% |
| ruby | context | 10 | 0 | 88.0% | 80.0% |
| rust | context | 10 | 0 | 69.0% | 50.0% |
| typescript | context | 10 | 0 | 35.0% | 30.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| expressjs/express | context | 5 | 0 | 80.0% | 80.0% |
| go-chi/chi | context | 5 | 0 | 16.0% | 0.0% |
| google/gson | context | 5 | 0 | 70.0% | 60.0% |
| koel/koel | context | 5 | 0 | 73.3% | 60.0% |
| nestjs/nest | context | 5 | 0 | 40.0% | 40.0% |
| node-red/node-red | context | 5 | 0 | 60.0% | 40.0% |
| outline/outline | context | 5 | 0 | 30.0% | 20.0% |
| pallets/flask | context | 5 | 0 | 40.0% | 40.0% |
| rubocop/rubocop | context | 5 | 0 | 80.0% | 80.0% |
| sinatra/sinatra | context | 5 | 0 | 96.0% | 80.0% |
| spf13/cobra | context | 5 | 0 | 42.7% | 40.0% |
| spring-projects/spring-framework | context | 5 | 0 | 50.0% | 20.0% |
| starship/starship | context | 5 | 0 | 42.0% | 20.0% |
| symfony/http-foundation | context | 5 | 0 | 86.0% | 60.0% |
| tokio-rs/axum | context | 5 | 0 | 96.0% | 80.0% |
| wagtail/wagtail | context | 5 | 0 | 29.0% | 20.0% |

## Preparation and evaluation failures

No execution failures.

## Measurement conditions

- Pinned archives and source labels are identical across paired methods/builds. Case batches overlap on a shared development host, so timings are diagnostic. Labels are sparse and agent-reviewed. Reserved-case results used for corrections are regression evidence.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
