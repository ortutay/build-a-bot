# Master versus beta/timo: performance pass, 15 September 2026 UTC

## Findings

Master now builds the combined jobs service and extracts five ATSs, including Workday. It remains behind beta in SmartRecruiters coverage and application-form evidence. Master is faster on the eight URLs both versions handle and approximately four times faster on Pokémon sync. Beta is faster and more reliable in this Allabolag sample.

No core source, core tests or core configuration were edited during this pass. The integrity check compared 266 files and found zero changes. No deployment was performed.

## Comparable setup

- Master means the current working-tree snapshot on top of `db4d52f`, including the recent tool migrations, generic element inspection, form-tool removal and schema typing refactor. Beta is `45b4fb9` from `beta/timo`.
- Both versions used **one combined jobs service with all nine URLs**, not one service per ATS. Four Workday URLs include the listing and three supplied details. Allabolag and Pokémon used their existing client schemas and URLs.
- The same JSON schemas, identity settings, single-key Bright Data provisioning and all four configured proxy types plus direct access were used on both. The obsolete client schema reference to `browserTools_formsTool` was removed from both inputs. No generated script or database-stored code was manually patched.
- Each version/case had separate SQLite files, document storage, LLM disk cache and tool-cache directory. Redis was disabled for these isolated runs. Credentials came from the project's `.env`; the benchmark used local database URLs rather than the configured remote database. Installed dependency versions were shared to isolate application-code differences.
- Source snapshot caching was **not enabled** on either version. Fast repeated syncs therefore reflect tool caching and stored-script reuse, not skipping the source execution entirely.
- A cold build was followed by three build/sync/list passes. Build validation itself fetches seed pages, so the first subsequent sync is already partly cache-warmed. Additional sync-only runs used saved scripts/data with empty tool/document caches; only their first sync is cache-cold.
- One independent cold build per case/version was measured. Sync repetition tests consistency of those generated scripts, not reproducibility of fresh generation. Some cases ran concurrently (up to four initial clients), so generation/network timing includes ordinary shared-machine/provider variability. The initial runner database-URL setup error was corrected before these runs and excluded. Beta Pokémon's supervision window was extended because its cold build used most of the original 15-minute allowance.

## Cold build and subsequent sync times

All times are seconds. Sync includes routing, extraction, validation and persistence; `list()` is measured separately and generally takes milliseconds.

| Case                                       | Master cold build | Beta cold build | Master sync 1 / 2 / 3 | Beta sync 1 / 2 / 3    |
| ------------------------------------------ | ----------------: | --------------: | --------------------- | ---------------------- |
| Combined jobs, all 9 URLs                  |            398.39 |          720.96 | 3.97, 3.79, 3.77      | 103.71, 102.79, 103.27 |
| Allabolag                                  |            251.25 |          202.31 | 23.73, 38.63, 33.67   | 10.00, 9.48, 8.36      |
| Pokémon, 3 URLs including national listing |            146.51 |          745.69 | 51.52, 51.41, 51.42   | 204.56, 204.50, 204.51 |

Jobs timings are **not equivalent-coverage speed comparisons**: master fails SmartRecruiters; beta extracts its 14 jobs and attempts their application pages. Master's third Allabolag sync failed; its 33.67s is a failure duration, and the prior successful item remained visible.

Warm build reuse was measured in milliseconds. Pokémon returned 1,027 source-associated rows representing 1,025 distinct identities on both versions. Jobs returned 16 rows / 13 distinct identities on master and 30 rows / 27 distinct identities on beta. The three extra Workday rows correspond to jobs appearing both in the listing source and the explicit detail sources.

## Sync-only measurements

| Saved service / input set                              | Master syncs, seconds | Beta syncs, seconds     | Interpretation                                                                                   |
| ------------------------------------------------------ | --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Jobs, all 9 URLs, fresh caches initially               | 12.76, 3.79, 3.81     | 177.82, 101.04, 105.58  | Master has the SmartRecruiters failure; beta handles all URLs.                                   |
| Same combined jobs service, 8 common URLs, warm caches | 1.08, 1.05, 1.07      | 6.58, 7.38, 6.57        | Both handle every input URL; master remains faster, but application-form coverage still differs. |
| Allabolag, fresh caches initially                      | 18.18, 20.37, 21.04   | 7.69, 9.28, 8.46        | Both succeeded in all three runs of this separate pass.                                          |
| Pokémon, fresh caches initially                        | 51.79, 51.38, 51.40   | Not separately measured | Master remains near the queue-imposed floor with or without initial tool cache entries.          |

The eight-URL probe reuses each combined service and excludes only the SmartRecruiters input from `sync(urls)`. It does not change service grouping or remove stored SmartRecruiters rows; consequently `list().total` on beta remains 30 even during this probe. It measures runtime for the common URL set, not a newly filtered database.

### Why the sync times differ

**Jobs:** master extracts independent source URLs concurrently, then persists results sequentially. Beta's source loop is sequential. Beta's recorded per-source execution durations put approximately 96–97s in SmartRecruiters and 5.4s in Lever; the other sources are predominantly cache hits. SmartRecruiters sequentially navigates 14 detail/application flows. Many application clicks spend about 5.1s in the bounded readiness wait, despite the subsequent URL check taking around 1ms. This is a concrete candidate for narrower readiness criteria and less repeated application navigation. Master aborts the SmartRecruiters extraction on an application-page 403, so its shorter time does not mean equivalent work was completed.

Master's persisted per-source run durations all include waiting for the combined extraction batch, because run completion is written after `Promise.allSettled`. Those durations cannot be treated as independent provider extraction timers.

**Pokémon:** both scripts acquire roughly 1,025 detail pages. Master permits 20 queue starts/second; beta permits 5. Warm requests complete quickly, but every queued task still consumes a rate-limit slot. This explains both the approximately 51s versus 205s sync times and low instantaneous `running` counts despite a large backlog. It is primarily a start-rate limit, not failure to use the configured concurrency. Beta's cold build also needed three repair cycles; master did not. Some failed beta validation attempts continued draining already queued work while repair planning had begun.

**Allabolag:** master's generated script uses two residential-browser pages (overview and appointments), while beta uses one page and embedded JSON. Master returns eight management/board/auditor/signatory entries, beta five. Both agree on the financial fields. Status/org-number formatting differs (`Aktiv` versus `ACTIVE`, hyphenated versus digits-only organisation numbers). The extra acquisition and selector waits explain a substantial part of master's cost; the third baseline sync timed out waiting for `table[aria-label='simple table']`.

### Cache observations

Repeated Allabolag navigations miss the same cache keys on both versions (two keys on master, one on beta). They therefore keep paying browser acquisition costs on repeat sync. The cache code deliberately excludes failed or readiness-timeout sequences; successful extraction after a later explicit selector wait does not make that earlier sequence cacheable again. The observed pattern is consistent with this policy, not evidence of random cursor IDs entering the cache key. No cache fixes were made because core edits were explicitly excluded.

The jobs/Pokémon logs demonstrate tool-cache hits, and the fresh-cache runs demonstrate that the scripts can reacquire their documents. No source-snapshot hits were used. See the metrics JSON for cache counts by sync; queued work continuing after a failure can cross phase boundaries, so those counts are diagnostic rather than exact isolated request-cost accounting.

## Jobs output quality

| ATS             | Master result                                                 | Beta result                                                                        |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Teamtailor      | 3 jobs; partial forms with zero fields                        | 3 jobs; reported complete forms with 10–16 fields                                  |
| Greenhouse      | 1 job; reported complete, 15 fields                           | 1 job; partial, 15 fields                                                          |
| Lever           | 1 job; partial with zero fields                               | 1 job; partial with 19 fields                                                      |
| Ashby           | 1 job; partial with 9 fields                                  | 1 job; partial with 11 fields                                                      |
| SmartRecruiters | Entire source fails on application-page 403; zero jobs saved  | 14 jobs; partial forms with zero fields, explicitly reporting Datadome gating      |
| Workday         | 7 distinct jobs / 10 rows; little useful application evidence | 7 distinct jobs / 10 rows; partial first-step application structure with 15 fields |

These are extracted results, not a certification of completeness. Master falsely labels three Workday detail outputs complete: the only field is **“Sök efter jobb eller nyckelord”**, the job-search box. Fresh acquisition changes that box's generated DOM ID and produces three spurious `updated` records with otherwise unchanged job data. Cached repetitions hide this problem.

Master's Teamtailor descriptions are populated but `requirements` is empty for all three jobs. Both versions have empty requirements on some other sources. Beta's broader forms output relies partly on the domain-specific `formsTool` that was intentionally removed from master; restoring its hardcoded core heuristics is not recommended. Scope inspection to the actual application UI in generated service code, and keep unknown/partial states when evidence is missing.

Pokémon data agrees on all but one identity: Maushold (#925), weight 2.8 kg on master versus 2.3 kg on beta. This remains a form-selection discrepancy to resolve at the service/schema level; matching item counts alone do not establish identical data.

## Next candidates, without changes in this pass

1. **Client/schema and generated-service behavior first:** retain a successfully extracted job when its separate application page is gated, scope application controls correctly, and avoid random DOM IDs as durable field identifiers. This should recover SmartRecruiters posting coverage and prevent false Workday completeness/updates without schema-specific core rules.
2. **Allabolag acquisition:** prefer observed embedded company JSON for the common fields; fetch the appointments page only for genuinely additional requested information. Replace brittle broad table waits with evidence-backed readiness checks in the service.
3. **Generic readiness/caching:** investigate why unrelated activity keeps navigation/click sequences uncacheable, and whether an explicit relevant readiness check can safely permit later observations to be cached. Avoid treating every readiness timeout as permanently poisoning all subsequent observations.
4. **Generic inspection cost:** `inspectElementsTool` incurs per-element browser round trips for handle acquisition, evaluation, visibility and disposal. Research calls in this run reached several seconds, sometimes over 10s; instrumentation includes cursor queue wait. Consider batching observations while preserving generic caller-selected properties. This is a planning-cost opportunity, not evidence that every slow sync uses the inspector.
5. **Queue placement/cancellation:** cached tool calls still pay the generated script's queue start limit. Separating actual network throttling from cache hits could improve warm Pokémon sync further. Cancel or drain failed generated batches before retries to avoid abandoned work competing with replacements.

## Reproduction and evidence

A common public-library client harness is available:

```bash
npm run client:compare -- jobs
npm run client:compare -- allabolag
npm run client:compare -- pokemon
# Reuse a previously built service without build():
npm run client:compare -- jobs --sync-only
# Same combined service; sync only the eight common URLs:
npm run client:compare -- jobs --sync-only --exclude-host=careers.smartrecruiters.com --label=without-smartrecruiters
```

The commands use the current working directory's data/cache setup; they do not automatically clear caches. A fair cold comparison requires separate directories and cache namespaces. The isolated runner and snapshots for this pass are retained under `/tmp/fetchfox-performance-20260915/`; `run.py` performs the baseline and `sync.py` clones the saved SQLite database into fresh tool/document-cache directories. Its supervisor extension is recorded separately. The sync-only mode still constructs the same service and provisions the proxies, but setup time is reported separately from `syncMs`.

- Frozen common service definitions: [PERFORMANCE-20260915-CASES.json](PERFORMANCE-20260915-CASES.json)
- Timings, outcomes, form counts and cache metrics: [PERFORMANCE-20260915-METRICS.json](PERFORMANCE-20260915-METRICS.json)
- Full rows and changes: each snapshot's `runs/<case>/.log/performance/<label>/run-1.json` through `run-3.json`.
- Full logs and generated script copies: `/tmp/fetchfox-performance-20260915/`. Logs are private local artifacts; they are not bundled into this report.

Client changes in this pass are the comparison harness, frozen case definitions, removal of the obsolete tool reference in the jobs schema, and the `client:compare` npm command. The harness was typechecked. No core changes or remote service updates were made.
