# Cross-project retrieval measurements

Agent-reviewed patch-derived labels are sparse, not independently validated ground truth. Unclassified files are not noise. Failed cases contribute zero to recall and completeness. Supporting-range and judged-precision means show only available annotations; inspect annotation counts and errors. Public evaluation cases cease to be held out when used to tune ranking.

| Method | Budget | Cases | Errors | File excerpts | Essential lines | Complete context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 4 | 0 | 75.0% | 62.5% | 50.0% |
| context | 16000 | 4 | 0 | 75.0% | 75.0% | 75.0% |
| context | 32000 | 4 | 0 | 75.0% | 75.0% | 75.0% |
| lexical | 8000 | 4 | 0 | 62.5% | 25.0% | 25.0% |
| lexical | 16000 | 4 | 0 | 62.5% | 37.5% | 25.0% |
| lexical | 32000 | 4 | 0 | 62.5% | 62.5% | 50.0% |

## Supporting code, cost and annotation scope

| Method | Budget | Supporting cases | Supporting lines | Mean tokens (successful) | Known negative files | Judged selected files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| context | 8000 | 2 | 50.0% | 7995 | 0 | 5.1% |
| context | 16000 | 2 | 50.0% | 15995 | 0 | 5.1% |
| context | 32000 | 2 | 50.0% | 28033 | 0 | 5.1% |
| lexical | 8000 | 2 | 0.0% | 7996 | 0 | 3.0% |
| lexical | 16000 | 2 | 0.0% | 15995 | 0 | 3.0% |
| lexical | 32000 | 2 | 0.0% | 26823 | 0 | 3.0% |

Supporting file recall measures selection, separately from coverage of annotated test lines.

| Method | Budget | Supporting file cases | Supporting file recall |
| --- | ---: | ---: | ---: |
| context | 8000 | 2 | 50.0% |
| context | 16000 | 2 | 50.0% |
| context | 32000 | 2 | 50.0% |
| lexical | 8000 | 2 | 0.0% |
| lexical | 16000 | 2 | 0.0% |
| lexical | 32000 | 2 | 0.0% |

## Repository splits at 16000 tokens

| Split | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| eval | context | 4 | 0 | 75.0% | 75.0% |
| eval | lexical | 4 | 0 | 37.5% | 25.0% |

## Language results at 16000 tokens

| Language | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| python | context | 2 | 0 | 100.0% | 100.0% |
| ruby | context | 2 | 0 | 50.0% | 50.0% |
| python | lexical | 2 | 0 | 50.0% | 50.0% |
| ruby | lexical | 2 | 0 | 25.0% | 0.0% |

## Projects at 16000 tokens

| Project | Method | Cases | Errors | Essential lines | Complete context |
| --- | --- | ---: | ---: | ---: | ---: |
| pretix/pretix | context | 2 | 0 | 100.0% | 100.0% |
| solidusio/solidus | context | 2 | 0 | 50.0% | 50.0% |
| pretix/pretix | lexical | 2 | 0 | 50.0% | 50.0% |
| solidusio/solidus | lexical | 2 | 0 | 25.0% | 0.0% |

## Preparation and evaluation failures

No execution failures.

## Measurement conditions

- Initial candidate before the expanded-corpus evaluation was inspected. Its 3/4 domain result at 16000 tokens was not retained by the corrected scorer; the final domain outcome is 2/4.

The JSON report contains every case, omissions, source ranges, grouped metrics, process timing and peak resident memory. Timing is a single local sample, excludes downloading, and includes isolated indexing and excerpt construction. No application test suites are executed.
