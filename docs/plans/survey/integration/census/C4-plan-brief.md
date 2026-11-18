# C4 — the plan and the brief

Route: the plan and the brief · commit 6f6c5d2 · 18 Nov · read by a census reader. [checked] = read in code.

## How the route works today

- The plan is text. A plan stage is told to write it in the description, below any `## As asked` block, under `## Implementation Plan` (lib/prompts/stage-kinds.js:118-122). A plan comment also counts (lib/run-trail.js:194-197). [checked]
- Stage prompts are pass-by-reference: no description, no comment bodies. They say "read the current description and comment thread" (lib/prompt-formatters.js:168-172,283). Exceptions: the Surveys embed the description (lib/prompt-template-defs.js:1112-1114); custom prompts substitute `{{description}}`/`{{comments}}` (lib/prompt-templates.js:97,102). [checked]
- From context a stage prompt takes only title lines (project, parent, siblings, children), labels, the latest review ref, landing PRs and attachments (lib/prompt-template-defs.js:102-106,644-649,1014; lib/prompt-templates.js:285). [checked]
- The worker gets the plan by reading. `attachProxyContext` appends a preamble that says "Start from the distilled brief: GET …/brief/{id}" (lib/proxy-preamble.js:278-290,816). [checked]
- The brief is a model call over `formatIssueContext`, the code that turns ticket text into a context block (lib/openrouter.js:751-880). Code then quotes the As-asked words (own and parent's) ahead of the model's sections (lib/as-asked.js:317-332). Cached by context hash, 7-day TTL (lib/brief-cache.js:35; lib/recap-cache.js:50-107). [checked]
- Routing does not use `formatIssueContext`. It uses `formatSelectorView` (plan body condensed, newest 3 comments) plus TRAIL FACTS from all comments: where the plan is, session fit, plan-review due (lib/openrouter.js:883-989; lib/recommendation-facts.js:455-574,636-662). [checked]
- Prune: prompt text tells close-out what to do (archive with GET /brief?noRefresh=1, verify /snapshots, then POST description/below; lib/prompt-template-defs.js:865-874). Code only gives the endpoint, which keeps the block and replaces everything below it (routes/proxy-writes.js:743-757). [checked]
- Copy-down: prompt text only. The breakdown template tells the agent to put "this piece's slice of the approved plan" in each child (lib/prompt-template-defs.js:321-335). The proxy create then seals that child text into an As-asked block (routes/proxy-writes.js:488). No code copies a parent plan. [checked]
- Snapshots: fire-and-forget, hash-gated copies of the ticket slice, taken only on the proxy's recap/brief reads, 50 per task (routes/proxy.js:490-501; lib/task-snapshot-store.js:41-46,83,191). No prompt builder reads them. [checked]
- Chain, ticket to prompt: provider.fetchRecommendationContext → `promptContextOf` → `generatePrompt(kind, issue, context)` → template.generate + `finishStagePrompt` → `attachProxyContext` (+ preamble pointing at GET /brief) → worker → GET /brief → `generateBrief` → `formatIssueContext` (raw description + all comments) → model → `composeBrief`. [checked]

## Sites

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C4-01 | lib/prompts/stage-kinds.js:118-122 | instructs | Plan contract: plan below the block under `## Implementation Plan`, session-fit phrase, `plan-review due:` line | prompt-contract.js:30-34 via finishStagePrompt |
| C4-02 | lib/prompts/stage-kinds.js:97 | instructs | Plan route whenNot: "a breakdown child's copied slice of an approved parent plan" counts as a plan | getSelectableStages, prompt-templates.js:440-446 |
| C4-03 | lib/prompt-template-defs.js:313-340 | instructs | Breakdown: read the plan in the description; the copy-down bullets (a)-(e) apply only if this ticket has an Approve | generatePrompt('breakdown') |
| C4-04 | lib/prompt-template-defs.js:865-874; stage-kinds.js:455,462 | instructs | Close-out archive, verify, prune via description/below; keep plan heading and fact lines verbatim | generatePrompt('close-out') |
| C4-05 | lib/prompt-contract.js:1-34 | instructs | Contract header names each plan-line reader; appends each kind's `contract` lines | finishStagePrompt, prompt-templates.js:282 |
| C4-06 | lib/file-pointer.js:156-175 | reads | `extractPlanSection`: the last `## Implementation Plan` section; below the block wins (readFact) | recommendation-facts.js:485-494; buildFilePointer |
| C4-07 | lib/file-pointer.js:82,186,238-268 | carries | Implementation-only pilot: plan paths + earlier-PR files, cap 300 chars, prepended to the prompt | dispatch-factory.js:850-864 (env HARBOUR_FILE_POINTER_PILOT) |
| C4-08 | lib/run-trail.js:180,194-197 | reads | `PLAN_HEADING_ANY`; `isPlanComment` (a heading, or a first line opening "Plan") | assembleTrailFacts; carriesStageState |
| C4-09 | lib/recommendation-facts.js:444-447 | guards | `carriesStageState`: a description that already has plan lines is not sealed at first dispatch | dispatch-factory.js:1075 |
| C4-10 | lib/recommendation-facts.js:455-525 | reads | `assembleTrailFacts` plan facts: where (description / comment / parent's plan), session fit, plan-review due | openrouter.js:981 |
| C4-11 | lib/recommendation-facts.js:541-574 | carries | TRAIL FACTS block; plan lines at 566-571 | openrouter.js:981 |
| C4-12 | lib/recommendation-facts.js:595-662 | carries | `condensePlan`: a plan body over 3000 chars is cut to leads (400-char cap), Session fit and machine lines; As-asked words untouched | formatSelectorView, openrouter.js:938 |
| C4-13 | lib/recommendation-facts.js:219-226; lib/plan-review-round-trips.js:319 | reads | `extractSessionFit`/`sessionFitOf`; `planReviewDueOf` | assembleTrailFacts; carriesStageState |
| C4-14 | lib/as-asked.js:67-68,90,121,188 | writes/guards | Marker strings, `sealAsAsked`, `splitAsAsked`, `checkAsAsked` | seal lanes; proxy guard |
| C4-15 | lib/as-asked.js:236-257 | reads | `readFact` / `outsideAsAsked`: read below the block first, the block as fallback | file-pointer, recommendation-facts, plan-review-round-trips |
| C4-16 | lib/as-asked.js:298-352 | carries | `BRIEF_HINT`; `composeBrief` (own and parent words quoted ahead of the model output); `briefQuoteEnd` | brief.js:133; task-page-loader.js:158,179 |
| C4-17 | lib/as-asked-seal.js:81,122 | writes | `sealForFiling`; `readIssueRaw` (one issue read, shared by the seal and the plan read) | proxy-writes.js:488; workspace-api-issue-write.js:781; workspace-api-feedback.js:525; dispatch-factory.js:1077 |
| C4-18 | routes/proxy-writes.js:379 | guards | Description writes refused 422 if the block changes | proxy description writes |
| C4-19 | routes/proxy-writes.js:743-757 | writes | POST description/below: keep up to the block end, replace the rest (the prune's door) | close-out agent |
| C4-20 | lib/openrouter.js:709-722,751-880 | carries | `formatIssueContext`: raw description, relations, children, all comments in full, attachments; no cap | brief.js:68; recap.js:38; scan.js:85; task-chat-template.js:39 |
| C4-21 | lib/openrouter.js:883-989 | carries | `formatSelectorView` (3 newest comments, 2000-char cap each, condensed plan) + `buildSelectorArgs` | buildRoutingPrompt :992 → getRecommendation :2139, getRecommendationStream :1120 |
| C4-22 | lib/openrouter.js:2056-2061 | carries | `composeRoutedRecommendation`: routed action → generatePrompt | getRecommendation(Stream) :1293,:2087,:2212 |
| C4-23 | lib/stage-router.js:85-96 | instructs | `buildRouterPrompt` puts `view` and `facts` into the selector prompt | buildRoutingPrompt |
| C4-24 | lib/prompts/prompt-context.js:12-15 | carries | `promptContextOf`: parent, siblings, project, children, comments, attachments | C4-27..C4-29; recommendation-input.js:41 |
| C4-25 | lib/recommendation-input.js:36-42 | carries | Routing input = promptContextOf + focusedChild, runs, allRuns | proxy.js:1505; workspace-api.js:297,365,513 |
| C4-26 | lib/prompt-templates.js:50-58,258-287 | carries | `PromptContext` typedef; `generatePrompt`; `finishStagePrompt` (intent, contract, grounding, attachments, capabilities) | C4-22, C4-27..C4-30 |
| C4-27 | lib/dispatch-entrance.js:1592 | carries | Pinned dispatch: generatePrompt(kind, issue, promptContextOf(found)) | dispatch entrance |
| C4-28 | routes/proxy-compute.js:339,493 | carries | Proxy /prompt and /recommend overrides call generatePrompt | proxy routes |
| C4-29 | routes/workspace-api-prompts.js:246-261 | carries | In-app prompt: generatePrompt or generateCustomPrompt | workspace API |
| C4-30 | routes/workspace-api-feedback.js:256 | carries | Feedback triage: generatePrompt('triage') with an empty context | enqueueFeedbackTriage |
| C4-31 | lib/prompt-formatters.js:168-172,274-313 | instructs | Pass-by-reference line and "Fetch details" workflow steps | every template's generate |
| C4-32 | lib/prompt-template-defs.js:1112-1114,985,1009 | carries | Surveys embed the title and the raw description | generatePrompt('survey-task' / 'survey-place') |
| C4-33 | lib/prompt-templates.js:80-113 | carries | Custom prompt `{{description}}`, `{{comments}}` (formatComments) | workspace-api-prompts.js:259 |
| C4-34 | lib/proxy-preamble.js:278-290,757-821 | instructs | Preamble "Start from the distilled brief", appended as prompt + block | attachProxyContext callers |
| C4-35 | lib/brief.js:29-73,117-134 | writes | BRIEF_SYSTEM_PROMPT (description seed, comments amend, latest wins); maxTokens 3000; composeBrief | proxy-compute.js:1428,1539; workspace-api.js:864 |
| C4-36 | lib/recap.js:12-43,97-114 | writes | Recap JSON (done / pending / deviations) from formatIssueContext; maxTokens 1500 | proxy-compute.js:1168,1280; workspace-api.js:773 |
| C4-37 | lib/brief-cache.js:22,35; lib/recap-cache.js:41-107 | carries | Cache keyed by workspace:issue + inputHash; slice includes description, comments, children, parent's As-asked words | brief/recap routes; task page; dashboard |
| C4-38 | routes/proxy-compute.js:1332-1461,1467+ | ends | GET/POST /api/proxy/brief: fetch context, hash, capture snapshot, serve cache or generate | worker, autopilot, close-out |
| C4-39 | routes/proxy-compute.js:1071,1207 | ends | GET/POST /api/proxy/recap (same pattern; captures a snapshot at :1112,:1270) | autopilot, Flight Companion |
| C4-40 | routes/workspace-api.js:695-720,740-864 | ends | In-app brief/recap: generateCachedDocument; no snapshot capture | task page UI |
| C4-41 | routes/proxy.js:490-501 | writes | `captureTaskSnapshot`, fire-and-forget | proxy-compute.js:1112,1270,1373,1529 |
| C4-42 | lib/task-snapshot-store.js:41-46,83,191,228,259,290 | writes/reads | Snapshot slice, caps (50 per task, 100000 chars of text), list, diffLatest, listByWorkspace | proxy-compute.js:593-640; ship-biscuit.js:158; server.js:650 |
| C4-43 | lib/prompts/autopilot-kickoff.js:487-491,731,738 | instructs | Autopilot verbs GET /recap/{id}, GET /brief/{id}; first act reads the brief | buildAutopilotKickoff |
| C4-44 | flight-companion-kickoff.js:102,104; chat-tools.js:290; proxy-instructions.js:303-327 (lib/) | instructs | Other brief/recap pointers; get_brief is cache-only | their builders |
| C4-45 | lib/task-page-loader.js:156-190,1281-1282 | shows | Task page: `## Current` split after briefQuoteEnd; cached brief/recap shown if the hash matches | task page |
| C4-46 | routes/dashboard.js:851-852 | shows | Session view reads the cached brief/recap | dashboard |
| C4-47 | lib/scan.js:85; lib/prompts/task-chat-template.js:39 | reads | Other formatIssueContext consumers (scan, task chat) | workspace-api-scan.js; task-chat.js |
| C4-48 | tests/unit/prompt-size-budget.test.js:76-146,156-198 | guards | Frozen UTF-8 byte ceilings (see 4) | npm run test:unit |
| C4-49 | tests/unit/as-asked-marker-census.test.js:34-39,129,145-161 | guards | No hand spelling of the markers in lib/ or routes/; BRIEF_HINT carried by 5 surfaces | npm run test:unit |
| C4-50 | tests/unit/{as-asked-brief, as-asked-readers, as-asked-one-home, stage-selector-input, lin-4470-prompt-context, brief, brief-cache, task-snapshot-store, file-pointer, openrouter}.test.js | guards | Verbatim quote; below-the-block wins; promptContextOf fields; per-module | npm run test:unit |

## Where a record-built brief would plug in (facts only)

- Ticket context enters `generatePrompt(labelName, issue, context, featureFlags, providerUi)` (lib/prompt-templates.js:258) through `issue` (description, labels, state, createdAt) and `context` (the six `promptContextOf` fields, lib/prompts/prompt-context.js:12-15). Templates read `issue.description` only in the Surveys (:1113) and `context.comments` only at lib/prompt-template-defs.js:366,644-649,1014. [checked]
- The plan body reaches the worker only through GET /brief (C4-34, C4-38), and on the pilot arm as ≤300 chars of paths (C4-07). [checked]
- The brief's input is `formatIssueContext` (lib/brief.js:68); it also feeds recap (lib/recap.js:38), scan (lib/scan.js:85) and task chat (lib/prompts/task-chat-template.js:39). [checked]
- Routing reads the same context via `formatSelectorView` + `assembleTrailFacts` (lib/openrouter.js:975-989). [checked]
- Cache freshness for the brief, the recap and the snapshot dedupe is one hash, `hashContext` (lib/recap-cache.js:104). The task page judges cached docs by the same hash (lib/task-page-loader.js:1284). [checked]
- Byte sizes stated in code: none on `formatIssueContext` (description and comments are unbounded). Condense threshold 3000 chars, lead cap 400 (lib/recommendation-facts.js:643). Selector comments 3 × 2000 chars (lib/openrouter.js:883-884). Brief output 3000 tokens, recap 1500 tokens (lib/brief.js:125; lib/recap.js:105). File pointer 300 chars (lib/file-pointer.js:82). Snapshot text 100000 chars (lib/task-snapshot-store.js:42). [checked]
- Prompt-size budget (UTF-8 bytes, `Buffer.byteLength`, tests/unit/prompt-size-budget.test.js:11). It covers template source files (lib/prompt-template-defs.js 98917, prompt-templates.js 19903, prompt-formatters.js 48752, prompt-contract.js 2057, stage-kinds.js 43336; :76-82). Each template rendered under one fixture with no comments, e.g. plan 10428, breakdown 5310, close-out 13800, review 16376 (:87-108,156-175). Router source 8206; routing prompt with a placeholder view 10110; runner, onboarding, landing, leftover; total 396064 (:115-146). Not measured: lib/brief.js, lib/recap.js, formatIssueContext, formatSelectorView, or any real ticket context. [checked]

## Corrections to the inventory

- E1: held. The plan is the description's `## Implementation Plan` plus comments (C4-06, C4-08, C4-10). The brief header and the 7-day TTL at lib/brief-cache.js:35 hold. Refinements: snapshots are taken only on the proxy recap and brief reads, hash-gated, 50 per task (C4-41, C4-42); the in-app brief route does not capture them (routes/workspace-api.js:695-720). The prune is prompt text plus the description/below endpoint (C4-04, C4-19). [checked]
- E7: held for the sealed ask. A marked block in the description (lib/as-asked.js:67-68). The census test checks only hand spellings of the markers in lib/ and routes/, not the words (tests/unit/as-asked-marker-census.test.js:34-39). Local store, one collection: held (lib/local-store.js:9-12). Rest of E7 not checked. [checked]
- E15: partly corrected. The brief and recap headers and `formatIssueContext` as their input hold (lib/brief.js:68; lib/recap.js:38). `generatePrompt` at lib/prompt-templates.js:258 holds. Corrected: the autopilot lines are lib/prompts/autopilot-kickoff.js:487-488 (and 731, 738), not 473-474. Added: stage prompts embed no description (C4-31); routing uses `formatSelectorView` (C4-21). [checked]

## Loose ends

- routes/proxy.js:1508 says the routing prompt is built by "formatIssueContext → formatAttachmentsSection". Stale: it is built by formatSelectorView (lib/openrouter.js:2139,992). [checked]
- The proxy create seals a breakdown child's slice as that child's own "As asked" words. composeBrief also quotes the parent's words for every subtask (lib/as-asked.js:306-310). [checked] Whether children are created through the proxy create or another lane was not traced.
- Not traced: provider fetchers' caps on comments and siblings; the Jira as-asked region module. Linear's parent selection includes the description (lib/providers/linear/index.js:537-545). [checked]
- simple-dispatcher not read; the prompt leaves this repo as a queued string. [checked]
