# Cross-project retrieval baseline

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 80 | 5 | 75.6% | 41.4% | 36.2% |
| context | 16000 | 80 | 5 | 75.6% | 53.6% | 45.0% |
| context | 32000 | 80 | 5 | 75.6% | 65.0% | 53.8% |
| lexical | 8000 | 80 | 5 | 78.1% | 25.3% | 21.2% |
| lexical | 16000 | 80 | 5 | 78.1% | 46.2% | 35.0% |
| lexical | 32000 | 80 | 5 | 78.1% | 65.3% | 52.5% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 53 | 12.1% | 7964 | 9 | 7.0% |
| context | 16000 | 53 | 20.8% | 15070 | 9 | 7.0% |
| context | 32000 | 53 | 30.3% | 23481 | 9 | 7.0% |
| lexical | 8000 | 53 | 19.1% | 7993 | 8 | 6.3% |
| lexical | 16000 | 53 | 31.7% | 15676 | 8 | 6.3% |
| lexical | 32000 | 53 | 39.1% | 27746 | 8 | 6.3% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 40 | 5 | 33.7% | 27.5% |
| train | context | 40 | 0 | 73.4% | 62.5% |
| eval | lexical | 40 | 5 | 28.7% | 22.5% |
| train | lexical | 40 | 0 | 63.7% | 47.5% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| go | context | 10 | 0 | 39.3% | 30.0% |
| java | context | 10 | 5 | 35.0% | 30.0% |
| javascript | context | 10 | 0 | 50.0% | 50.0% |
| php | context | 10 | 0 | 79.7% | 60.0% |
| python | context | 10 | 0 | 30.0% | 30.0% |
| ruby | context | 10 | 0 | 88.0% | 80.0% |
| rust | context | 10 | 0 | 53.5% | 40.0% |
| typescript | context | 10 | 0 | 53.0% | 40.0% |
| go | lexical | 10 | 0 | 37.3% | 30.0% |
| java | lexical | 10 | 5 | 38.0% | 30.0% |
| javascript | lexical | 10 | 0 | 35.0% | 20.0% |
| php | lexical | 10 | 0 | 57.2% | 40.0% |
| python | lexical | 10 | 0 | 32.5% | 30.0% |
| ruby | lexical | 10 | 0 | 73.0% | 60.0% |
| rust | lexical | 10 | 0 | 43.5% | 30.0% |
| typescript | lexical | 10 | 0 | 53.0% | 40.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| expressjs/express | context | 5 | 0 | 100.0% | 100.0% |
| go-chi/chi | context | 5 | 0 | 36.0% | 20.0% |
| google/gson | context | 5 | 0 | 70.0% | 60.0% |
| koel/koel | context | 5 | 0 | 73.3% | 60.0% |
| nestjs/nest | context | 5 | 0 | 76.0% | 60.0% |
| node-red/node-red | context | 5 | 0 | 0.0% | 0.0% |
| outline/outline | context | 5 | 0 | 30.0% | 20.0% |
| pallets/flask | context | 5 | 0 | 40.0% | 40.0% |
| rubocop/rubocop | context | 5 | 0 | 80.0% | 80.0% |
| sinatra/sinatra | context | 5 | 0 | 96.0% | 80.0% |
| spf13/cobra | context | 5 | 0 | 42.7% | 40.0% |
| spring-projects/spring-framework | context | 5 | 5 | 0.0% | 0.0% |
| starship/starship | context | 5 | 0 | 11.0% | 0.0% |
| symfony/http-foundation | context | 5 | 0 | 86.0% | 60.0% |
| tokio-rs/axum | context | 5 | 0 | 96.0% | 80.0% |
| wagtail/wagtail | context | 5 | 0 | 20.0% | 20.0% |
| expressjs/express | lexical | 5 | 0 | 70.0% | 40.0% |
| go-chi/chi | lexical | 5 | 0 | 52.0% | 40.0% |
| google/gson | lexical | 5 | 0 | 76.0% | 60.0% |
| koel/koel | lexical | 5 | 0 | 53.3% | 40.0% |
| nestjs/nest | lexical | 5 | 0 | 76.0% | 60.0% |
| node-red/node-red | lexical | 5 | 0 | 0.0% | 0.0% |
| outline/outline | lexical | 5 | 0 | 30.0% | 20.0% |
| pallets/flask | lexical | 5 | 0 | 40.0% | 40.0% |
| rubocop/rubocop | lexical | 5 | 0 | 80.0% | 80.0% |
| sinatra/sinatra | lexical | 5 | 0 | 66.0% | 40.0% |
| spf13/cobra | lexical | 5 | 0 | 22.7% | 20.0% |
| spring-projects/spring-framework | lexical | 5 | 5 | 0.0% | 0.0% |
| starship/starship | lexical | 5 | 0 | 11.0% | 0.0% |
| symfony/http-foundation | lexical | 5 | 0 | 61.0% | 40.0% |
| tokio-rs/axum | lexical | 5 | 0 | 76.0% | 60.0% |
| wagtail/wagtail | lexical | 5 | 0 | 25.0% | 20.0% |

## Preparation and evaluation failures

- `spring-projects--spring-framework-1` (timeout at 180 seconds): Evaluation produced no report
- `spring-projects--spring-framework-2` (timeout at 180 seconds): Evaluation produced no report
- `spring-projects--spring-framework-3` (timeout at 180 seconds): Evaluation produced no report
- `spring-projects--spring-framework-4` (timeout at 180 seconds): Evaluation produced no report
- `spring-projects--spring-framework-5` (timeout at 180 seconds): Evaluation produced no report

## Measurement conditions

- Seven completed language partitions were retained. A superseded serial Java partition was interrupted and discarded in full; Java was rerun with five case workers using the same immutable evaluator, sources, labels and 180-second deadline.
- Batches and supplementary probes overlapped on a contended local host. These are single diagnostic wall-time samples, not uncontended latency measurements or speedup evidence.
- Production retrieval source/resource fingerprints match the start of the task. No retrieval ranking was tuned on this corpus.
- The binary hash identifies the measured release build. A later legacy-report comparison guard affects --baseline comparisons only, which these measurements do not invoke.
- This reference predates the explicit Git-discovery ceiling. No Git location overrides were inherited and scratch paths have no tracked ancestor history, so no ancestor-history ranking signals were available.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
