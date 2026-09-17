# Form inspection: move interpretation into generated services

## Implemented now

Removed `forms.ts` and `browserTools_formsTool`, including their output schema, executor, cache special case and heuristic tests. Core no longer recognizes résumé/cover-letter fields, interprets required markers in labels, guesses alternative upload rules, groups controls using ATS selectors, classifies address autocomplete, or opens dropdowns implicitly. The schema-preservation test now uses a generic nested record fixture.

Generic capabilities remain: rendered HTML, open shadow-root content, frame enumeration and selection, explicit clicks and native selects, selector/URL waits, page readiness, and captured XHR/fetch documents. Raw HTML preserves the original labels and attributes for service-specific parsing.

Follow-up implementation: `inspectElementsTool`, `pressTool` and `fillTool` are now available. Inspection returns raw DOM evidence and caller-selected primitive properties; it does not have a fixed list of form properties. Missing, unsupported and unreadable properties are reported separately. CSS selectors support open shadow roots, and all three tools accept the existing frame paths and use cursor sequencing/cache replay. Generation-prompt changes below remain proposed.

Inspection defaults to 20 matches (maximum 100) and no requested properties (maximum 20). Strings and attribute output have per-element limits; the aggregate result is capped at 128 Ki serialized JSON characters before instrumentation. Shortened fields and omitted matches are marked explicitly. Object-valued properties are not recursively serialized. Interactions act on exactly one matching element and perform only the requested fill or key press.

Validation: 25 targeted browser/cache tests passed, including live values versus HTML attributes, primitive/error handling, frame/shadow-root inspection, output bounds, strict interaction targeting and replay of cached fills/key presses. Core build and typecheck passed. Live job-service extraction has not been re-evaluated.

## Proposed approach

### 1. Use the existing evidence tools first

The planner should navigate to the relevant UI, wait for an observed selector or response, and read its DOM. Use `framesTool` and `contentTool({ framePath, shadowDom: true })` where necessary; read the saved document with `format: "raw", transform: "none"` when slim/collapsed HTML omits needed evidence. Inspect captured JSON when it supplies the same information more directly.

Open custom dropdowns through explicit `clickTool` calls, then inspect the resulting DOM or network response. A read operation must not silently click controls, choose answers, or claim that all conditional states were inspected.

### 2. DOM observation tools (implemented with caller-selected properties)

Full-page HTML can be large and does not reliably represent live properties. The generic `inspectElementsTool({ cursorId, framePath?, selector, limit?, properties? })` returns bounded element observations without implicit interactions:

- Tag, original attributes, text and outer HTML.
- Caller-selected primitive properties, such as current `value`, `checked`, `selected` and `selectedIndex`. There are no default property names or schema-specific interpretations. Reading a property can execute a page-defined getter.
- Visibility and whether the result was truncated.

Use selectors that support open shadow roots, and the existing frame-path convention. Keep attributes distinct from live properties. Do not derive semantic labels, requiredness, grouping, completeness, field categories or user-schema keys. A native `required: false` is evidence about that DOM property, not a claim that the service should output an optional field. Bound output size; return truncation explicitly rather than dropping evidence silently.

Generic `pressTool` and `fillTool` perform only the caller's explicit action, with the same cursor/frame/selector handling as click/select. A requested Enter can submit a form; fill does not append Enter. Generated code uses explicit selector/network waits for asynchronous changes. There is no automatic form exploration engine.

### 3. Keep shared prompts short

Suggested planner guidance:

> For requested interactive structure, inspect the relevant rendered state. Record selectors, raw attributes or response fields, necessary actions, and unresolved evidence in the grouping report. Keep source-specific interpretation in that report; do not assume a convention applies across sites.

Suggested coding guidance:

> Map the observed evidence into the supplied schema in the generated script. Distinguish explicit source properties from inferred rules, and represent missing evidence according to the schema. Do not treat absent evidence as false or assume unseen conditional states are complete.

These are general instructions. ATS names, CSS conventions, marker recognition and business fields belong in the per-service research report and generated code, not in shared prompts. The planner supplies that evidence to the existing bounded code-writing step; no additional research loop is needed there.

### 4. Validate at the appropriate layer

Core tests should verify faithful attributes/properties, frame and shadow-root access, bounded output, and absence of implicit interactions. Keep readiness and network-capture tests.

Service fixtures should verify the schema interpretation: visible required markers versus native attributes, alternative upload/text groups, dropdown options and conditional fields. Test each rule against observed markup and at least one counterexample. Such fixtures belong with client/service examples, outside core. Runtime output validation still checks the supplied item schema; it cannot establish semantic completeness by itself.

## Expected effects and rollout

- Core becomes smaller and reusable across domains; schema-specific fixes can evolve independently in services.
- Form extraction may regress immediately. Automatic required-marker detection, alternative grouping and dropdown exploration are intentionally removed. Generated scripts must implement those behaviors where justified by evidence.
- Existing scripts calling the removed tool need rebuilding. `DataService.build()` already fingerprints the available tool names and schemas, so removing this tool changes that fingerprint when it was available. Calling only `sync()` does not rebuild stored scripts.
- Planning may need more tool calls and tokens than the former combined inspector. Scoped DOM observations can reduce that cost if needed. Runtime cost depends on the generated acquisition strategy; no speed improvement is claimed from this rollback.
- Re-test one static form, one conditional/custom-control form and one frame/shadow-root form before evaluating the job services again. Do not require recovery of all prior behavior before accepting the simpler core boundary.
