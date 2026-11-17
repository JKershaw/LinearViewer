# 5-plan-review notes

**Written:** run-35 (account = copy of real output; ended done); finding-36 blocking, to design (workspace-kpis.js reads CostFormat at load via Chart.js ticks.callback; about plan-28, check-22, decision-29); verdict-45 request-changes, on plan-28@1, to design, about finding-36; finding-37..44, the eight builder notes, to implementation (about plan-28, plus check-33 / check-13 where relevant).
**Revised:** check-22 (adds the library-callback case and the Chart-stub witness), check-33 (six renderers incl. render.js; both list shapes), check-32 (the Playwright check doesn't cover the KPI cost chart). All still addressed to review. Nothing ended; plan-28 left kept for design to supersede.

**Looked up:** open records to plan-review (none), area-1 open findings, `show --task` (to find checks to revise and avoid duplicates), `find --text workspace-kpis`/`render.js`, existing verdicts (none), then design's brief to confirm finding-36 and verdict-45 reach it.

**Refusal:** `{"error":"outcome request-changes is not in the set for plan-28"}`. `of` picks the outcome set, so it takes the stage name, not the target id. I re-added with `of:"plan-review"`. Because of the retry, the verdict's time (14:23:59.941) comes after the run ended (14:23:58.941).

**Relied on beyond brief/queries:** the repo at HEAD 4b5001ddf: Chart.js 4.5.1 source (constructor → update), chart-helpers.js:112, workspace-kpis.js IIFE and :138, the e2e spec :133-136, render.js:384, render-task-page.js:82 `const SCRIPTS`, the CLAUDE.md line/byte budget and its test, consumer comment lines, client-world `fireDOMContentLoaded`, the golden env var.

**Brief carried but unneeded:** lesson-2 (poll discipline), the full `asked` text repeated twice, and most of the previous run's account, which repeats plan-28.

**Unplaced:** nothing.
