# Direct test declarations and setup helpers

Implemented structural callback test declarations, explicit test-case metadata, conservative declaration intent and bounded setup-helper propagation. The real Laravel replay now includes the whole login/logout regression and retains all six core implementation/configuration files and active session/Fortify values. Workspace setup-only tests are absent. This is a known calibration case.

## What changed

- Literal titles and callback ranges are indexed for supported Pest, Playwright, Vitest/Jest, Mocha-style and Node/CommonJS APIs. Dynamic titles, comments, unknown imports and detected shadowing remain ordinary text. Named test functions retain their declaration kinds and add optional `isTestCase` metadata. Rust/Python/Java/Go/Ruby/PHP named conventions and annotations distinguish cases from helpers where supported.
- Callback descriptions contribute dedicated intent, rather than ordinary program-identifier frequency, shared symbols or graph seed strength. Intent requires a leading query match supported by implementation paths/declarations. Clauses, late mentions and low coverage of multi-concept tasks reduce confidence. This avoids promoting a watch/keyring test just because its name ends with missing login.
- Behavior coverage is separate from implementation query coverage. Equivalent tests share a package/query feature; related tests wait for their implementation. Intent bonuses respect existing implementation ceilings and do not raise the relevance admission floor for production files. Explicit references and testing focus retain their overrides.
- Conventional setup/support/environment helpers without actual test cases do not propagate reverse edges into other tests for general tasks. Needed outgoing dependencies can still recover helper code.
- Excerpts prioritize whole matching callback cases in dedicated test files. Index schema 10 rebuilds older disposable caches, while excerpt strategy 2 performs one refresh of retained packs.

These are static heuristics, not a semantic proof of a test's subject or execution. Indirect factories, parameterized chains, custom DSLs and complete lexical binding resolution are not supported uniformly. C# and Swift continue to use text fallback.

## Controlled real replay

| Measurement | Earlier saved pack | Fresh baseline | Final |
| --- | ---: | ---: | ---: |
| Files with code | 21 | 24 | 25 |
| Approximate tokens | 12744 | 12725 | 14468 |
| Direct login/logout case | No | No | Yes |
| Workspace setup-only file | Yes | No | No |

The controlled runs use identical hashes for 12838 indexed sources and 1422 Git observations, a 25-file ceiling and 32000-token budget. The original saved index included 160 development captures that no longer exist and two changed capture metadata files. Its earlier selection is therefore not an interchangeable baseline. The direct-test improvement is reproduced on the fresh paired input; workspace absence in that pair already occurs in the reference. Original packs, index, settings and application sources were not modified. Private source and pack contents are not bundled.

The final excerpt includes all lines 61-68 of the direct callback, including authenticated-user and logout/guest assertions. Active configuration checks cover driver, lifetime, cookie/path/domain, secure/http_only, same_site and the Fortify identity/middleware/home/features values. The model file is not forced into every login task. Browser/CLI ambiguity remains when the query does not specify either path.

## Cross-project regression measurements

| Suite | Essential lines before | Final | Regressed essential cases | Supporting lines before | Final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original 80 | 62.4% | 62.4% | 0 | 21.0% | 21.3% |
| Domains 4 | 50.0% | 50.0% | 0 | 50.0% | 50.0% |
| Previous expansion 18 | 39.4% | 39.4% | 0 | unavailable | unavailable |
| Reserved 4 | 64.6% | 64.6% | 0 | 66.7% | 63.3% |

Original-corpus required coverage improves on 0 cases and stays unchanged on 80; 0 regress. All 106 central-budget Context tasks complete. The final reports retain 102 previous-task measurements plus 24 measurements of the four reserved cases across both methods and all three budgets. Known-negative and unclassified-file counts remain available in the raw reports; sparse labels do not establish total noise or general precision.

Original successful-case mean token use changes from 15191 to 15175 at a 16000-token ceiling. Known-negative selections change from 9 to 9; only 7.1% of selected files have explicit relevance labels. The controlled real replay uses 1743 additional tokens to include more context. This change does not establish token savings or exhaustive relevance.

## Initial adverse outcomes retained

The first frozen candidate reduced original essential-line coverage from 62.4% to 58.2%, losing four cases, and still missed the direct login/logout case. [Initial original-corpus data](callback-primary-first.json) preserve those regressions. On the reserved four repositories, essential coverage stayed at 64.6%, while supporting-line coverage at 16000 tokens fell from 66.7% to 33.3%. [Initial reserved measurements](callback-validation-first.md) and [raw data](callback-validation-first.json) retain that outcome.

Those results rejected treating arbitrary title mentions as ordinary symbols and letting test evidence consume implementation query novelty. The corrected four-case central-budget supporting coverage is 63.3%, compared with 66.7%. Frozen labels have not been changed. Missing supporting lines are enumerated with nonempty/whitespace flags in the [paired report](callback-test-results.json); a tighter whole-case excerpt can omit an annotated separator line without losing an assertion. Remaining file/test omissions are still reported.

The four additional repositories (Slim, Koa, Vitest, Bottle) and their patch-derived labels were frozen before implementation. They were reviewed by the implementing agent, not an independent reviewer. Their initial outcomes informed corrections, so final measurements are regression data. Task 96e8b6af still calls for independently reviewed, previously unseen evaluation inputs. All 32 current repositories are now known calibration data.

## Verification and reproduction

Verification passes 85 Rust tests, 59 Python tests, formatting, clippy, Rust 1.90, the release build and the portable Linux package/checksum/notices check. Three historical tasks retain recall and top-five recall of 1.0. Timings come from overlapping local runs and are not controlled performance estimates. No upstream dependencies were installed and no upstream application tests were executed.

```bash
cargo build --release --locked
python3 scripts/corpus.py run --manifest benchmarks/corpus.json --split all --methods context --budgets 16000 --output original.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-domains.json --split all --methods context --budgets 16000 --output domains.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-validation.json --split all --methods context --budgets 16000 --output expansion.json
python3 scripts/corpus.py run --manifest benchmarks/corpus-callback-validation.json --split all --output callbacks.json
```

Raw final inputs/results: [original](callback-primary-results.json), [domains](callback-domains-results.json), [previous expansion](callback-validation-results.json), [reserved reference](callback-validation-before.json), [reserved final](callback-validation-after.json). [Paired metrics and source/build fingerprints](callback-test-results.json) preserve provenance. The manual benchmark workflow accepts `suite: callbacks`.
