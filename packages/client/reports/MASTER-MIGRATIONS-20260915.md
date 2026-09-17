Implemented on master, September 15, 2026. This follows the [client comparison](MASTER-BETA-COMPARISON-20260914.md).

## Changes

| Change                         | Implementation and benefit                                                                                                                                                                                                                                                                                                                                                                                    | Cost / limits                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redirect-safe response capture | Ported `NetworkCapture`: ignore redirect bodies, catch asynchronous response-reading failures, save completed immutable responses, and scope queries by capture. Unique capture IDs also distinguish deliberate cursor reuse. Added `networkTool` with required endpoint-prefix waits.                                                                                                                        | Captures supported XHR/fetch content up to 2 MB per response and retains up to 200 references per capture. Unsupported or unavailable bodies are skipped with diagnostics.                                                                                               |
| Document-cache scope           | Disk stores use their resolved directory as scope; memory libraries get an isolated scope. Fetch and browser caches include it in their keys. Preserves `_background` normalization and failure exclusion.                                                                                                                                                                                                    | Existing unscoped entries are cold after migration. This prevents cross-store references; deleting individual documents within an otherwise unchanged store is not repaired automatically.                                                                               |
| Forms and readiness            | Ported form inspection, grouped required-upload alternatives, custom select inspection, frame enumeration/selection, open-shadow DOM snapshots, scrolling/URL waits, cursor cleanup, and bounded page readiness. HTML formatting preserves control attributes, canonical links, embedded JSON, iframe references, and form ancestry during collapse. Recognizes Unicode required markers such as Lever's `✱`. | Adds browser waits and inspection work. Readiness timeout and unavailable forms are not cached. Hidden labels, closed roots, CAPTCHAs, and later conditional application steps can still require further work; these tools do not establish universal form completeness. |
| Fetch request options          | Added GET/read-only POST, headers, body, timeout and request metadata. Null optional headers/body are accepted as omitted, fixing the argument shape generated in the live Pokémon test. Method/body/headers affect cache identity. Reused master's already-migrated proxy implementations.                                                                                                                   | No mutating POST support. This does not add a DOM renderer, stealth mode, or gateway retries.                                                                                                                                                                            |
| Queue limit                    | Changed the shared per-script queue from 5 to **20 starts/second**, retaining concurrency 50 and the rolling one-second interval.                                                                                                                                                                                                                                                                             | Cache hits and local work still consume queue slots. This is a limit increase, not a redesign of where network rate limits are applied.                                                                                                                                  |

Master's single-URL script functions, append-only items, `lastSeenAt`, configurable identity, and sync outcome contract remain in place. No service/storage migration, branch merge, deployment, or commit was performed in this task.

## Verification

- Core build, core test TypeScript check, and API build pass.
- The 77 focused browser/CDP, capture, cache, formatting, request, and queue regressions pass.
- Broader compiler/service/document checks: **167 passed, 3 failed**. All three failures were reproduced in the pre-migration snapshot: two assertions expect a tool-name prefix that `toContextTools()` does not add; one `Item.save()` test expects an unchanged `updatedAt` when saving an unchanged item by unique key. The relevant implementations are byte-identical to the baseline; they were left unchanged.
- A local queue benchmark with 30 one-millisecond tasks took **5,007 ms at 5/sec** and **1,002 ms at 20/sec**. This isolates the launch-rate limit; it is not a remote-site throughput guarantee. A compiler regression confirms concurrent `run()` calls share the 20-start budget.
- Live Workday read-only POST returned HTTP 200 and **7 jobs** in **1,394 ms**. The second identical request was a **cache hit in 2 ms**. Browser navigation returned HTTP 200, settled in **4,733 ms**, and captured the jobs JSON endpoint successfully.
- Live Allabolag passed all three build/sync/list iterations with one company and identical data. Initial build: **187.25 s**; syncs: **10.38 / 9.22 / 8.87 s**. The generated script attempts a datacenter request that returns 403, then uses a residential browser fallback. Repeated 403 misses are expected because failed results are excluded from caches. These runs are slower than the former generated HTTP-unlocker strategy; source/code-generation choices and browser readiness prevent a clean before/after timing comparison.

- Live combined jobs ran for the full **600-second budget** without the previous unhandled response-body crash. Generation had not activated any scripts when stopped (603 seconds including cleanup), so a complete combined-service sync was **not established**. Response-body failures were logged as warnings; browser-closed warnings after termination are cleanup effects.
- Live Pokémon initially returned two successful detail URLs and one national-listing error: the generated GET passed `headers: null`. That compatibility issue is fixed and covered by a regression. Retrying the same saved script after the fix finished in **5.39 seconds**, but hit a separate generated assertion: listing name `Nidoran♀` versus detail name `Nidoran♀ (female)`. Two detail URLs still succeeded; national extraction remained failed. The 20-start limit is independently verified; these provider/parser failures prevent claiming an end-to-end Pokémon speedup.

Remaining work is in acquisition/generation strategy and source-specific assertions: make the large combined jobs build finish within a practical budget, and compare Pokémon identity by number rather than exact display-name spelling. Neither is silently patched in stored scripts here.

## Source footprint

**15 source files; +1,052 / −153 lines**, relative to the saved pre-migration working-tree snapshot, excluding unrelated existing edits. Four modules are new. Most added code is the form inspector and browser tool definitions; network capture, frame traversal and readiness are separate modules. Details:

| Source file                                                                                                                                                                   | Added | Removed |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | ------: |
| [packages/core/src/compile/Compiler.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/compile/Compiler.ts)                                                       |     1 |       1 |
| [packages/core/src/documents/DiskLibraryBackend.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/documents/DiskLibraryBackend.ts)                               |     3 |       1 |
| [packages/core/src/documents/DocumentLibrary.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/documents/DocumentLibrary.ts)                                     |    20 |       1 |
| [packages/core/src/formats.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/formats.ts)                                                                         |   108 |      27 |
| [packages/core/src/mastra/instruments/cacheInstrument.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/instruments/cacheInstrument.ts)                   |     2 |       1 |
| [packages/core/src/mastra/tools/browserTools/BrowserSession.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/BrowserSession.ts)       |    10 |       0 |
| [packages/core/src/mastra/tools/browserTools/BrowserToolCache.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/BrowserToolCache.ts)   |    17 |       7 |
| [packages/core/src/mastra/tools/browserTools/NetworkCapture.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/NetworkCapture.ts) (new) |   160 |       0 |
| [packages/core/src/mastra/tools/browserTools/dom.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/dom.ts) (new)                       |    49 |       0 |
| [packages/core/src/mastra/tools/browserTools/forms.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/forms.ts) (new)                   |   249 |       0 |
| [packages/core/src/mastra/tools/browserTools/instruments.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/instruments.ts)             |     1 |       1 |
| [packages/core/src/mastra/tools/browserTools/readiness.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/readiness.ts) (new)           |    77 |       0 |
| [packages/core/src/mastra/tools/browserTools/tools.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/browserTools/tools.ts)                         |   277 |      99 |
| [packages/core/src/mastra/tools/documents/tools.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/documents/tools.ts)                               |     6 |       0 |
| [packages/core/src/mastra/tools/fetchTools/tools.ts](/Users/marcell/projects/fetchfox/builder/packages/core/src/mastra/tools/fetchTools/tools.ts)                             |    72 |      15 |

## Evidence and commands

Live clients used `packages/core/.env` and isolated storage in `/tmp/timo-migration-20260915`; the checkout database was not touched. Raw logs remain there and may contain sensitive diagnostic material. The report includes only results and metrics.

```sh
npm run build --workspace=@build-a-bot/core
npm run typecheck --workspace=@build-a-bot/core
npm run client:jobs
npm run client:allabolag
npm run client:pokemon
```

The new focused tests are under `packages/core/test/tools`, `test/cache`, `test/formats`, and `test/compile/queue.test.ts`. Final test output: `/tmp/timo-migration-tests-final.log`; baseline failure reproduction: `/tmp/timo-migration-baseline-failures.log`.
