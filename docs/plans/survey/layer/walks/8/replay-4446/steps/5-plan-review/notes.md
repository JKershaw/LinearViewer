# Notes: 5-plan-review (task-8)

**Written.** verdict-39 (request-changes, on plan-26@5, to design, about check-37, finding-30); finding-40 (the blocking one: workspace-kpis reads the global at load, to design, about plan-26, decision-28, check-19); finding-41 (CLAUDE.md is full), finding-42 (stale consumer comments) and finding-43 (fixture across vm contexts), all to implementation. **Revised:** check-19 (constraint restated, Chart-stub witness), check-33 (six renderers, both list shapes), check-32 (read code, not comments) and check-31 (404 through the full app). **Ended:** check-37 done; run-44 done. Note 8 of the output only confirms finding-30, so it got a link and no new record.

**Looked up:** what was open to plan-review; existing verdicts (none); check-19 and checks 31–36, to revise them rather than duplicate them; finding-14 and finding-30; open project records and lessons; run-38.

**Refusals:**
1. `{"error":"field on does not belong to verdict"}`: I had put `on` as a top-level field. I moved it into `"links":{"on":[…]}` and the write was accepted. BUILD-NOTES does not show the shape that `add` expects for links.
2. A shell quoting failure (an apostrophe in the JSON) before the store saw anything. I switched to JSON files.

**What the output relied on that no brief or query gave:** Chart.js 4.5.1 internals (`chart.js:5696-5698`), `chart-helpers.js:112`, the IIFE in `workspace-kpis.js` and its early return when `Chart` is missing, `e2e/workspace-kpis.spec.js:133-136`, `render.js:384`, `const SCRIPTS` in `render-task-page.js:82`, the CLAUDE.md budget figures (110/110 lines, 11,950 bytes) and its test, the consumer comment line numbers, `UPDATE_RENDER_TASK_PAGE_GOLDEN`, and the `server.js` fall-through to the catch-all.

**Brief carried but not needed:** finding-20 and finding-21 in full, the growth history, and checks 34 and 36.

**Couldn't place:** a project-level lesson that "a library's synchronous callback counts as a read at load". I left it with design (finding-40) and did not write a lesson.
