## Adversarial Second-Read

- **Tier:** 2 — a fresh-context sub-agent with no memory of the report-writing turn. It was given the two repositories, their windows and the finished report, and none of the writer's notes.
- **Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (in full, lightly condensed for line length; every citation re-checked at `fb358dbda` by the writer):**

> I agree that row 159 is the window's largest item. Everything I found is LOW. The biggest miss is one more false "one home" header, of the same kind as rows 159, 160, 161 and 163, sitting in a module the report lists as an improvement.
>
> **1. Largest missed item: `promptContextOf`'s header is untrue for the busiest prompt surface.**
> - **What the header claims.** `lib/prompts/prompt-context.js:1-5`, added in this window by LIN-4470, says every prompt surface that renders a stage from a fetched context hands `generatePrompt` this one projection, "so a field added to the context reaches all of them from here".
> - **What the code does.** The routed and code-routed recommendation renders the stage prompt through `composeRoutedRecommendation` (`lib/openrouter.js:2056-2058`), called from `:1293`, `:2087` and `:2212`. It passes `generatePrompt` the object from `prepareRecommendationInput` (`lib/recommendation-input.js:35-42`), not `promptContextOf`. That is a second hand-written field list, which also carries `focusedChild`, `runs` and `allRuns`. This is the prompt recommend-and-dispatch actually sends, and the code routes (blind read, look-first) use it too.
> - **The window's own test admits it.** `tests/unit/lin-4470-prompt-context.test.js:1-8` says the fifth context "stays hand-built: it is pinned by a test, not derived".
> - **What the report says.** It lists "One prompt-context builder (`promptContextOf`)" as an improvement, noting only `routes/workspace-api-feedback.js:256` as an exception.
> - **Cost.** A new field must be added in two places, but the test catches a miss, so CI fails rather than output drifting. A template that ever read `context.runs` or `focusedChild` would render differently on recommend than on the pinned and override paths; no template reads them today.
> - **Severity:** LOW. Caused in this window.
>
> **2. Against row 159: AGREE.** I checked `lib/recommendation-facts.js:466-471` and `:554`, `lib/recommendation-look-first.js:152`, `COMMENT_KINDS` at `lib/run-trail.js:134-145` and the header at `:15-17`. The repro output matches the code (`## Survey open-0` is the survey-task heading, `lib/prompts/survey-words.js:8`). Nothing I found is larger or changes behaviour more.
>
> **3. Other items.**
> 1. **Row 149 is described too kindly.** One of the nine `report` rows (`lib/runner-kit/contract.json`, LIN-4475) pins the sides *disagreeing*. For `DONE: http://…`, SD returns the canonical https URL and Harbour returns null, because `PR_URL_RE` (`lib/run-ledger.js:355`) reads https only. `prUrlOfFeedback` partly recovers through its structured-`url` fallback (`lib/dispatch-wake.js:300-315`). A Waiting entry added in the window holds it. LOW.
> 2. **A Waiting entry was removed as settled while three copies remain.** `8aad24e35` removed the web-routes entry asking for one owner for mapping a cut-off to its reply. Three routers still each map a `truncationFailureOf` result their own way: `routes/dashboard-summaries.js:30-34`, `routes/proxy-compute.js:118-122` and `routes/workspace-api-steps.js:28-30`. LOW, borderline.
> 3. **The create-field rule is split between the in-app session create** (`routes/workspace-api-issue-write.js:259-276`, against `createFields()`) **and the proxy create** (`routes/proxy-writes.js:473-505`, `apiWriteFields()`). It is already a `docs/areas/web-routes.md` entry (LIN-4451), so it is held.
>
> **4. What the report got right:**
> - Rows 160, 163, 164 and 165 at their cited lines.
> - Rows 142, 153 and 158 resolved, and 131 derived.
> - Every write mount names a classified operation.
> - `res.status(` is 275 at both ends; the cost shim has one reader; only the two allow-listed leaves are served from `/lib/`.
> - SD's `sentinelLine` is the only sentinel-regex home.

**Disposition, item by item:**
1. Confirmed at HEAD and added as **row 167** (LOW), with a Waiting entry in `llm-and-prompts.md`. The LLM & prompts verdict line is qualified.
2. 149's delta now names the pinned http disagreement.
3. Re-read and ruled **borderline, not restored.** Each router now has one arm over the shared helper (`summaryFailure`, `streamedFailureReply`, `failureOf`), each mapping the helper's tuple into its own reply envelope. That is what the removed entry asked for within each file. Recorded under report-only.
4. Already held in `web-routes.md`; recorded under report-only.

The top finding is unchanged.

Adversarial second-read verdict: AGREE
Differed from top finding: NO
Disposition: fixed in place
