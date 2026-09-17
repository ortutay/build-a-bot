# Heal workflow evaluation — 2026-09-16

## Result

The four deterministic workflow tests pass. Pokémon and Allabolag pass their client runs. Jobs exits with code 1: all three iterations fail during healing, before sync, because the model API connection closes. Jobs also exposes generated-script and heal-scoping problems.

| Evaluation            | Result   | Evidence                                                                                       |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| Core TypeScript build | Pass     | `npx tsc -p packages/core/tsconfig.json`, exit 0 before client reruns                          |
| Heal workflow tests   | 4/4 pass | Latest run at 23:53 UTC; 591 ms; exit 0                                                        |
| `client:pokemon`      | Pass     | Exit 0; 2 successful URLs, 0 unhandled, 0 errors                                               |
| `client:allabolag`    | Pass     | Exit 0; all 3 iterations: 1 successful URL, 0 unhandled, 0 errors; stable one-item fingerprint |
| `client:jobs`         | Fail     | Exit 1; all 3 iterations fail before sync; stored item count remains 0                         |

## Test coverage

Added `packages/core/test/workflows/healWorkflow.test.ts`:

1. No healing returns null code.
2. One repair corrects a compiling script that returns the wrong item.
3. One repair corrects invalid syntax, with bot tools absent until compilation succeeds.
4. Two repairs carry the intermediate and final code through successive attempts.

These tests use the real workflow and compiler with mocked agent responses. They verify workflow mechanics, not the model's ability to diagnose arbitrary scripts or database persistence. The final no-change response must preserve any earlier repaired code.

Command, from `packages/core`: `ENV=test FORCE_COLOR=0 npx vitest run test/workflows/healWorkflow.test.ts`.

## Client findings

### Pokémon and Allabolag

Both clients returned null code for no-change healing, and logs confirm script saving was skipped. Pokémon synced Bulbasaur and Charmander successfully. Allabolag returned a stable Volvo Personvagnar record in each iteration, with no created or changed records. Allabolag iterations took approximately 64.6, 23.1, and 34.8 seconds, mostly in build/heal.

Nonfatal logging/storage warnings occurred, including unsupported batch metric/log writes and context compression. They did not prevent these clients from completing.

### Jobs terminal failures

The run started at 23:39:53 UTC and ended around 23:55 UTC. Six generated scripts initially compiled for nine input URLs spanning six ATS platforms.

- Iteration 1 failed in the healing invoked by `build()`.
- Iteration 2 completed build-time healing, then failed in the explicit `heal()` call.
- Iteration 3 failed in build-time healing.

Each surfaced `Workflow did not complete successfully: failed`, caused by `AI_APICallError: Cannot connect to API: other side closed`. No iteration reached sync/list quality evaluation. Therefore, successful end-to-end Jobs extraction and recovery from the errors below are not established.

### Errors observed inside Jobs research/healing

These errors occurred across original and generated revisions; some log entries are cache replays. They are not all independent terminal failures.

- Research: `SyntaxError: missing ) after argument list`; research continued afterward.
- Workday: rejected canonical `/job/` URLs for `/details/` inputs; missing or incomplete listing links; missing title/company; invalid detail URLs; HTTP 400/404; navigation interrupted by `chrome-error://chromewebdata/`.
- Greenhouse: 10-second click timeout on a hidden phone-country combobox; HTTP 301 on an HTTP URL; missing title/company/employer in later revisions.
- SmartRecruiters: missing listing links or readable detail content; unsupported URL; application-page HTTP 403; missing public Apply control.
- Ashby: `ApiJobPosting response was not captured`; unreadable detail page; missing public Apply control.
- Teamtailor: unreadable detail page and failure to enumerate listing links.
- Generated JavaScript: null-property access (`name` and `value`), and `$(...).filter(...).sort is not a function`.

### Heal-flow concerns observed

1. `DataService.#healScript()` passes all service URLs to every script. Healers repeatedly treated platform-specific scripts as defective because they did not handle the other platforms, and broadened them. Subsequent evaluations exposed new extraction failures. This is evidence of a scope mismatch, not proof that every original script was otherwise correct.
2. A rejected `Promise.all()` does not cancel sibling heal operations. Logs show earlier repairs continuing and saving after the next client iteration starts, including repeated saves for the same script. This allows overlapping writes; a specific lost update was not proven.
3. Repaired scripts were saved in the rebuilt runtime. Passing persistence does not imply those repairs produced correct Jobs data.

## Runtime and change boundaries

Initial client observations used stale `core/dist`. The runtime was rebuilt and all three clients restarted; only those reruns determine the results above. An earlier apparent lost-repair issue from the stale runtime is not counted as a current-source failure. The client runs use the compiled snapshot from their start; the final unit-test rerun uses the source present at 23:53 UTC. Existing caches and persisted data were retained.

No core source or client source fixes were made for this evaluation, and no failing assertions were changed. Additions are the workflow test file and this report. Normal client execution persisted generated/healed scripts and runtime data.

## Evidence files

- Pokémon log: `/private/tmp/builder-heal-pokemon-current.log`
- Allabolag log: `/private/tmp/builder-heal-allabolag-current.log`
- Jobs log: `/private/tmp/builder-heal-jobs-current.log`
- Allabolag artifacts: `.log/beta-workflows/beta-allabolag-2/2026-09-16T23-40-00.099Z/run-{1,2,3}.json`
- Jobs artifacts: `.log/beta-workflows/beta-jobs/2026-09-16T23-39-53.963Z/run-{1,2,3}.json`
