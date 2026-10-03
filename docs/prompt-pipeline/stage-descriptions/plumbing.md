# Prompt plumbing map: how Harbour builds the prompts agents receive

Scope: a read-only map of today's prompt production, end to end, so the planned split (a mechanical layer that picks the action and assembles rules, facts and machine-read pieces, then a writing layer that turns that bundle into a plain brief) can be built. No code was changed. Line numbers are against the working tree as read on 2026-10-03.

---

## 0. One-paragraph answer

**The prompts that autonomous agents actually receive come mainly from the meta (AI) path.** Autopilot, worker lanes and the passage runner all advance a task with `POST /api/proxy/recommend-and-dispatch` *without* `kind`, and that call reaches `getRecommendation()` → `buildMetaPrompt()` → one OpenRouter call that does the routing and writes the body. The handwritten path reaches dispatch in five places. (a) The orchestrator pins `kind` on recommend-and-dispatch, which the kickoff describes as a "rare, demonstrable misses only" escape hatch. (b) The UI's per-template buttons and close-out button are followed by a "run step" dispatch. (c) Feedback triage. (d) `GET /api/proxy/prompt/:id/:key` followed by a plain `POST /dispatch`. (e) `GET /api/proxy/recommend/:id?kind=`. The UI's main "✦ next step" button is also the meta path (the streaming route). The handwritten templates never feed the meta path; the meta path sees only each template's `aiHint`. Both paths converge on the same deterministic grounding post-pass. Every enqueue then converges on `createDispatchItem()` (`lib/dispatch-factory.js`), which adds the proxy access block and, for implementation only, the file-pointer pilot.

---

## 1. Which path produces dispatched prompts, and where each path is called

### 1.1 The two generators

| Path | Entry function | File:line | Sync? | Network? |
|---|---|---|---|---|
| Handwritten | `generatePrompt(labelName, issue, context, featureFlags, providerUi)` | `lib/prompt-templates.js:248` | sync | none |
| Handwritten (custom) | `generateCustomPrompt(customPrompt, …)` | `lib/prompt-templates.js:82` | sync | none |
| Meta (buffered) | `getRecommendation(issue, context, options)` | `lib/openrouter.js:1799` | async | 1 OpenRouter call |
| Meta (streaming) | `getRecommendationStream(issue, context, options, onEvent)` | `lib/openrouter.js:947` | async | 1 OpenRouter call (SSE) |
| Descent driver (meta only) | `resolveRecommendation({ computeOne, … })` | `lib/recommend-recurse.js:106` | async | one `computeOne` per hop |

`resolveRecommendation` keeps following `defer` hops (each hop is one LLM call that emits no body) until it reaches a non-defer action. Only that terminal hop carries a body.

### 1.2 Every call site of a generator

**Meta path (`getRecommendation` / `getRecommendationStream`):**

| Call site | Surface | Who uses it |
|---|---|---|
| `routes/proxy.js:1643` inside `computeRecommendation()` (`routes/proxy.js:1545`) | shared by the two proxy recommend routes below | |
| `routes/proxy-dispatch.js:1208` → `resolveRecommendation` → `computeRecommendation` | **`POST /api/proxy/recommend-and-dispatch` with no `kind`** (route at `:739`, LLM branch `:1175-1430`) | **Autopilot's default "trigger the next step"** (`lib/prompts/autopilot-kickoff.js:508`); worker lanes and child autopilots (`docs/worker-lane-prompt.md:12`); the passage runner |
| `routes/proxy-compute.js:487` → `computeRecommendation` | `GET /api/proxy/recommend/:id` (route `:351`), with no `?kind=` | Stepped autopilot "Read the worker prompt" beat (`autopilot-kickoff.js:208`); external agents. Read only, no enqueue |
| `routes/workspace-api.js:1015` | UI `GET /workspace/:urlKey/api/recommend/:issueId` (route `:875`), buffered | Older UI surfaces |
| `routes/workspace-api.js:1341` (node/descent) and `:1411` (leaf) | UI `GET …/api/recommend/:issueId/stream` (route `:1098`), SSE | **"✦ next step" (`__ai__`) in `public/prompt-section.js:612-642`**. The streamed text becomes `state.result.raw`, which the run-step rung dispatches through `window.dispatchPrompt` → `POST /workspace/:urlKey/api/dispatch` (`public/prompt-section.js:986`, `routes/dispatch.js:243`, factory at `:552`) |

**Handwritten path (`generatePrompt`):**

| Call site | Surface | Who uses it |
|---|---|---|
| `routes/proxy-dispatch.js:960` | recommend-and-dispatch **with `kind`** (LIN-573 verb override, `:925-1110`) | Orchestrator pinning the verb. The kickoff calls it "Rare, demonstrable misses only" (`autopilot-kickoff.js:519-525`) |
| `routes/proxy-compute.js:466` | `GET /api/proxy/recommend/:id?kind=` (LIN-839) | Read only |
| `routes/proxy-compute.js:316` | `GET /api/proxy/prompt/:id/:templateKey` (route `:278`) | Read only. An agent can then `POST /api/proxy/dispatch` the text |
| `routes/workspace-api.js:601` (`generateCustomPrompt` at `:597`) | UI `GET …/api/prompt/:issueId/:labelName` (route `:469`) | Per-template buttons in `prompt-section.js:684`, close-out button `public/session.js:804` (entryRung `run-step`), then dispatched from the browser |
| `routes/workspace-api.js:3654` | `enqueueFeedbackTriage` → factory `:3677` | Feedback-triage dispatch (flag `feedbackTriage`) |
| `lib/audit.js:589` | prompt audit page | Not dispatch |

**Paths that dispatch prompts that are not stage templates** (out of scope for the split, listed for completeness): the autopilot kickoff (`buildAutopilotKickoff`, `routes/proxy-kickoff.js:322` → factory `:384`; UI `workspace-api.js:653/769`; feedback autopilot `workspace-api.js:3778`); collective participants (`routes/collective.js:332`); chat-tool and reply-box follow-ups (`lib/chat-tools.js:1920`, `lib/follow-up-dispatch.js:79`); plain `POST /api/proxy/dispatch` with caller text (`routes/proxy-dispatch.js:233`, factory `:515`); store-internal wake follow-ups and cascade aborts (`lib/dispatch-store.js`).

### 1.3 How much each path is used

- **By design, the meta path is the default for autonomous work.** The kickoff tells the orchestrator never to read or write the body, and to pin `kind` only for rare misses (`autopilot-kickoff.js:508-525`). The UI's primary button is also meta.
- **No stored field records which path produced a row.** On the meta branch `promptName` is `rec.recommendedAction` (`proxy-dispatch.js:1386`). On the override branch it is `generated.name` (`:1074`). Both hold the same display name, for example `implement`. Two partial signals exist. (1) `logEvent` tags the override route as `/api/proxy/recommend-and-dispatch (override:<kind>)` (`proxy-dispatch.js:1112`). (2) Meta calls write a prompt trace (`recordPromptTrace`, `lib/openrouter.js:1136/1888` → `lib/prompt-trace-store.js:160`), keyed by `callMeta.urlKey` and `issueIdentifier`. Joining traces to dispatch rows would give the real share. That has not been done.
- **Test mode never reaches either LLM function.** `computeRecommendation` has a test-token stub (`routes/proxy.js:~1555-1617`), and the UI has `mockAi` (`buildMockRecommendationHop` / `generateMockRecommendation`, `workspace-api.js:1014, 1332, 1400`). E2E therefore never exercises the real meta parse, grounding or any future writer.

---

## 2. The meta-prompt's structure

Built by `buildMetaPrompt()` (`lib/openrouter.js:771`), which assembles facts and calls `buildMetaPromptTemplate()` (`lib/prompts/meta-prompt-template.js:43`). The rendered size is about 104.5 KB for the leaf fixture (`META_PROMPT_RENDERED_CEILING = 104526`, `tests/unit/prompt-size-budget.test.js`). Interpolated pieces add to that: aiHints are about 9.1 KB and completion signals about 4.4 KB (measured).

### 2.1 Inputs assembled by code (already the "mechanical layer")

- `formatIssueContext(issue, context)` (`openrouter.js:633`) holds the facts: identifier/title, state, Created/Updated, the full description, labels, project, parent, siblings (capped), cousins for epic-shaped parents, and either the leaf form (all children plus all comments) or the node form (subtask overview, parent discussion, `→ SUGGESTED NEXT`). It also folds in **Attachments** (`formatAttachmentsSection`, `:757`).
- `assembleNodeFacts(issue, children)` (`lib/recommendation-facts.js`) supplies counts, `isTerminal`, `hasOpenChildren` and `frontierFacts`.
- `formatAIHintsForMetaPrompt()` (`lib/prompt-templates.js:472`) supplies each template's `aiHint` {situation, goal, workflow, whenNot, chooseOver}. This is the *only* thing the meta path takes from `lib/prompt-template-defs.js`.
- `getAIRecommendationActionNames()` supplies the action vocabulary: 16 display names plus `defer`.
- `formatAllSignalsForMetaPrompt()` (`lib/completion-signals.js`) supplies completion signals.
- `featureFlags` + `providerUi` → `resolvePromptUi()` produce caps that shape the template text *at input*.

### 2.2 Sections of `buildMetaPromptTemplate`, by role (source bytes measured per line range)

| Lines | Section | Role | ~bytes |
|---|---|---|---|
| 106-111 | Persona + `## Task Context` (`${issueContext}`) | facts | 0.35 KB + context |
| 113-117 | `## Grounding Rule` | **writing rule** (don't invent facts; tell the consumer to find them) | 0.8 KB |
| 119-126 | `## Scale To The Task` | **writing rule** (output size) | 1.6 KB |
| 128-134 | `## CRITICAL: Sequential Workflow Decision` + priority order | **routing** (+1 writing line at 132: keep the prompt inside one action) | 0.6 KB |
| 135-150 | `### Step 0` (conditional on `isTerminal`/`hasOpenChildren`/`hasSubtasks`): review / close-out / retrospective-audit / cannot-close | **routing** | 5.5 KB |
| 151-176 | `### Step 1` research-or-preparation | **routing** | 5.0 KB |
| 177-189 | `### Step 2` blocked / bug (bug-already-investigated escape, divergence veto) | **routing** | 4.1 KB |
| 190-228 | `### Step 3` already-landed guard, design hatch, plan check, no-committed-scope, completed-prep, plan-review gate and verdict routing, session-fit, implementation readiness, SUGGESTED NEXT, FRONTIER FACTS block | **routing** (the largest block) | 18.4 KB |
| 229-240 | `### Step 4` (only when `hasSubtasks`): defer vs node-work, "no body on defer" | **routing** + cost contract | 1.8 KB |
| 241-295 | `## Prompt Structure`: a code-fenced skeleton (`# [Action verb] ID: title`, `## Workflow` with Start/Fetch/…/Update-Linear steps gated on `canWrite`/`useLinear`, optional `## Git Workflow` / `## Self-Review` / `## CI/CD Check` / `## PR Review` gated on featureFlags, `## Context` "reference, don't restate", `## Goal` with **Role**) | **output shape of the body** + flag-driven sections | 3.3 KB |
| 297-311 | `### Quality rules for generated prompts`: one bullet per stage: Blocked (0.7), Triage (0.9), Bug (1.5), Research (5.9), Plan (9.8), Breakdown (1.6), Plan-review (5.1), Implementation (4.4), Defer (0.45), Review (11.6), Close-out (12.0), Retrospective-audit (1.8) | **per-stage rules** (all stages are always sent, whatever the action) | 55.9 KB |
| 313-326 | `## Action Types Reference` (`${aiHints}`) + `## Completion Signals` | routing inputs | 0.4 KB + 13.5 KB interpolated |
| 327-336 | Comments vs Description; Label instructions (bug label) | writing rule | 0.5 KB |
| 338-360 | `## Instructions` + the **response format** (`## Reasoning` / Assessment / `→ **<action>**` / `**DeferTo:**` / `**Next:**` / `## Prompt`) + rules about the format lines | **output format / parser contract** | 1.9 KB |
| 368 | `applyPromptCapabilities(metaPrompt, {...caps, write:true, subtasks:true})` | rename "Linear" → provider; strip " in {tracker}" | — |

Summary: about 35 KB is routing (Steps 0-4), about 56 KB is per-stage quality rules (all twelve sent on every call, even though only one applies), about 3 KB is body skeleton, about 2 KB is response format, and about 3 KB is cross-cutting writing rules. **Routing could run without the 56 KB of stage rules. The writing step needs only the one rule for the chosen stage.** That is the split John described.

### 2.3 What the parser expects back

`parseRecommendationResponse(content, finishReason, completionTokens)` (`lib/openrouter.js:1716`) is a pure function and does not take `issue`/`context`, by design:
- `## Reasoning\n` … up to `\n## Prompt`, captured by regex `/## Reasoning\n([\s\S]*?)(?=\n## Prompt|$)/`.
- `## Prompt\n` … to the end of the reply, then `stripCodeBlockMarkers` (`:336`) removes a wrapping code fence.
- `parseRecommendedAction(reasoning)` (`:1675`) reads `/→\s*\*\*(.+?)\*\*/`. That value becomes `recommendedAction`, and `deriveDispatchKind()` (`lib/prompt-templates.js:228`) turns it into the dispatch `kind`, falling back to `custom`.
- When the action is `defer`, `parseDeferTo(reasoning)` (`:1694`) requires `DeferTo: <ID|UUID>`. The reply returns `prompt: null`, and a missing DeferTo throws.
- For any other action, both `reasoning` and `prompt` must be non-empty or it throws `Invalid response: missing ## Reasoning or ## Prompt section`.
- `truncated = finishReason === 'length'`.
- Return shape: `{ reasoning, prompt, truncated, recommendedAction, deferTo, completionTokens }`.
- The streaming path splits sections live with `StreamingSectionParser` (`:851`), keyed on the literal `## Reasoning\n` and `\n## Prompt\n`. At the end it re-parses the accumulated raw text with the same `parseRecommendationResponse` (`:1104`), so the defer and truncation rules are identical on both paths.

---

## 3. Post-passes and code-appended pieces (what runs after the body exists)

In order, from body to queue.

### 3.1 Inside the generators

**Handwritten: `generatePrompt()` (`lib/prompt-templates.js:248-302`):**
1. `template.generate(issue, context, featureFlags)` produces the **body** (`:252`). Templates live in `lib/prompt-template-defs.js` (17 keys; `implementation` at `:919` is a typical shape: header, `## Workflow` numbered steps, `## Context` facts, `## Goal` with Role, then guidelines, `formatCiGateCheck()`, `formatIfBlocked()`).
2. `appendGroundingSections(prompt, issue, context)` (`lib/prompt-formatters.js:787`) adds `formatStalenessCheck` (re-ground, with `git log --since=<issue.createdAt>`), `formatTerminalStateNote`, `formatChildrenCompleteNote` and `formatBugInvestigatedNote`. Each one gates itself to `''`.
3. `formatAttachmentsSection(context)` (`:859`) is appended.
4. If `featureFlags.featureBranches` is set and the category is `ready`, `formatGitWorkflow` is appended.
5. If `featureFlags.codeReview` is set and the template is `implementation`, self-review, CI/CD and PR-review blocks are appended.
6. `applyPromptCapabilities(prompt, resolvePromptUi(featureFlags, providerUi))` (`:1102`) runs **last** and covers everything above. It does four things. `gateWorkflowWrites` drops numbered steps in `## Workflow` whose bold label is `Start`/`Commit`/`Complete`/`Update…`, or that say "Set … status to", then renumbers. `shapeWorkflowStateWording` rewrites `status to "In Progress"/"Done"` for providers with `fixedStates`. `stripSubtaskSections` removes `**Subtasks:**`, `**Frontier facts:**` and `**Existing Subtasks:**`. It renames `\bLinear\b` to the provider's displayName and strips ` in {tracker}`. **This is a no-op for Linear**, and byte-parity tests pin that.

**Meta: `applyGroundingToRecommendation(structured, issue, context, flags, ui)` (`lib/openrouter.js:1792`):**
- If `prompt == null` (defer), the reply is returned unchanged. That is the no-body cost contract.
- Otherwise it returns `structured.prompt + applyPromptCapabilities(appendGroundingSections('', issue, context), caps)`. **Only the grounding is capability-shaped, not the LLM's body.** On the meta path, capability is applied to the *input* (meta-prompt Workflow skeleton plus the rename at `meta-prompt-template.js:368`), and the model is trusted to follow it.
- It is called at `getRecommendation` `:1882` and at `getRecommendationStream` `:1108`. The stream also **emits the appended grounding as one extra `prompt` delta** (`:1114-1123`). That delta is load-bearing, because the leaf UI path receives the prompt *only* through deltas and ignores the return value.
- Attachments are **not** a post-pass on the meta path. They exist only in the meta-prompt's context, and the LLM decides whether to carry them. That is a guarantee gap compared with the handwritten path.

### 3.2 Inside the dispatch factory (`createDispatchItem`, `lib/dispatch-factory.js:318`)

Every external enqueue goes through this function. The steps that touch the prompt:
- **Guards before any prompt work** (1.5 duplicate dispatch, 1.55 free-tier run limit, 1.6 task budget, 1.65 close-out run boundary, 1.7 terminal anchor) refuse the dispatch outright. None of them inspects prompt text.
- **Step 7, `finalizePrompt(resolvedHarness)`** (`:1032-1043`), is a callback supplied by the caller. In every proxy route it is `attachProxyContext()` (`lib/proxy-preamble.js:634`) or, for follow-ups, `provisionResumeCredential()` (`:718`). It **appends** `buildProxyContextPreamble()` (`:239`), the workspace API access block. On the claude-code harness (the default interposed by step 5, `applyDefaultDispatchHarness`) the token travels as `bootstrapToken` and not in the text. The harness has to be resolved before this append; that ordering invariant is LIN-1155.
- **Step 7.6, the file-pointer pilot** (`:1056-1142`), **prepends** a pointer marked `[file-pointer v1]` (`lib/file-pointer.js:66`, `prependFilePointer` at `:254`). It applies only when `HARBOUR_FILE_POINTER_PILOT` is on, `effectiveKind === 'implementation'`, the dispatch is fresh (not a follow-up or abort), it is scoped to an issue, and the even-ordinal arm is selected. It fails open and never throws. It is built from the issue's `## Implementation Plan` block and from files in earlier PRs.
- **Step 8, `addItem`**: `DispatchQueueStore.addItem` (`lib/dispatch-store.js:~398-576`) **appends** `appendAutopilotSessionRef` (`:251`), but only for `kind === 'autopilot'`. Separately, wake follow-ups get `formatGrantRefusalNotice` prepended (`:2667`).

### 3.3 What these passes guarantee today

| Guarantee | Handwritten | Meta |
|---|---|---|
| Staleness / terminal / children-complete / bug-investigated sections present and byte-identical | yes (post-pass) | yes (post-pass) |
| Staleness `--since` is the real `createdAt` | yes | yes (fixed by moving it to code, LIN-435) |
| Attachments section | yes (post-pass) | only if the LLM copies it from context |
| Provider capability on the body (no write steps on read-only trackers, tracker rename, subtask strip, state wording) | yes (regex post-pass) | **no.** Input-shaped only; the body is not post-passed |
| featureBranches / codeReview sections | appended by code | requested in the skeleton; the LLM writes them |
| Defer never reaches dispatch | n/a | `parseRecommendationResponse` + `resolveRecommendation` + a 422 in the routes (`proxy-dispatch.js:1236-1245`, SSE error at `workspace-api.js:1374-1377`) |
| Proxy access block, token channel | factory step 7 (both paths) | same |
| File pointer (pilot, implementation only) | factory step 7.6 | same |

---

## 4. Where a writing call would sit

### 4.1 The natural seams

**Meta path: between `parseRecommendationResponse` and `applyGroundingToRecommendation`.**
- `getRecommendation`: between `lib/openrouter.js:1881` and `:1882`.
- `getRecommendationStream`: between `:1104` and `:1108`. But see the streaming problem below.
- Writing only ever happens on the terminal hop: `parsed.prompt == null` for defer, so skip the writer there, exactly as grounding does.

A cleaner version of the split goes one step further. Turn the meta call into **routing only**: Steps 0-4, facts, vocabulary and the response format with `## Prompt` dropped. Then `deriveDispatchKind(recommendedAction)` picks the stage, code assembles the bundle, and the writer writes. The obvious "mechanical bundle" for a stage already exists. **`PROMPT_TEMPLATES[kind].generate(issue, context, flags)` is the handwritten body for that stage**, so both paths would converge on: routing (LLM or pinned `kind`) → template body (code) → writer (LLM) → shared post-passes. That would also reduce the "both-paths" rule (which keeps 56 KB of quality rules mirrored in the meta-prompt) to one source. The `reasoning` text from the routing call (Assessment, `→ action`, `**Next:**`) is a useful extra input for the writer.

**Handwritten path: inside `generatePrompt` between `:252` (body) and `:262` (grounding).** `generatePrompt` is **synchronous** and has at least 8 callers, including pure ones: `lib/audit.js:589`, the size-budget test and the cross-path parity tests. Turning it async would ripple through all of them. A better route is to split it into two parts:
- `renderStageBody(kind, issue, context, flags)`, which is `template.generate`.
- `finishPrompt(body, kind, issue, context, flags, providerUi)`, which runs the post-passes at `:262-293`.

Then add a new async `generateBrief(...) = finishPrompt(await writeBrief(renderStageBody(...)), ...)`. `generatePrompt` would stay as `finishPrompt(renderStageBody(...))`, so it remains byte-identical and the switch-off state is trivial. The dispatch-relevant callers that would opt in are `proxy-dispatch.js:960`, `proxy-compute.js:316` and `:466`, `workspace-api.js:601` and `:3654`.

**Not in `createDispatchItem`.** The factory deliberately "owns only RESOLUTION + construction, never prompt authoring" (header comment, `lib/dispatch-factory.js:14-23`). By step 7 the prompt already carries grounding and attachments, the access block, and possibly the file pointer. Also, plain `POST /dispatch` text is caller-authored and should not be rewritten.

### 4.2 Inputs the writer would have at the seam

At both seams the values in scope are `issue` (identifier, title, description, state, labels, createdAt, updatedAt), `context` (parent, siblings, siblingsTotal, project, children, comments, focusedChild, attachments, cousins), `featureFlags`, `providerUi`, and the stage. The stage is `recommendedAction` on the meta path, mapped to a template key via `deriveDispatchKind`, or `kind`/`labelName` on the handwritten path. The meta path also has `parsed.reasoning`. The handwritten path has the template body. What it **lacks** is `urlKey`/`workspacePreferencesStore`, which a writer needs for model resolution and any workspace switch. Those live in the route closure: `computeRecommendation` already has `urlKey`, and the UI routes have `workspace.urlKey`. They would be threaded through `options` the way `callMeta`/`model` already are.

### 4.3 What makes it awkward

1. **Streaming / the leaf view.** The UI leaf path (`workspace-api.js:1395-1433`) streams body tokens **live** as `prompt` deltas and throws away the return value. The client is **append-only**: `onEvent` in `public/prompt-section.js:763-789` does `promptRaw += content`, and no replace event exists. The node path also forwards each hop's deltas live (`:1341-1357`). A writer after the body means one of three things. (a) Don't stream the routing call's body (stream reasoning only), then stream the writer's output as the `prompt` section, which needs the writer to be a streaming call too. (b) Add a new SSE event, for example `prompt-replace`, plus client support. (c) Stream nothing until the end. Option (a) fits naturally with "routing call emits no body". The grounding delta (`openrouter.js:1114-1123`) would then follow the writer's stream.
2. **Proxy fallback.** When `HTTPS_PROXY`/`HTTP_PROXY` is set, `getRecommendationStream` delegates to buffered `getRecommendation` and re-emits events (`:963-978`). A writer placed in `getRecommendation` would also cover this case.
3. **The `defer` path and its cost contract.** A defer hop has no body and must not be charged for writing. Skip the writer when `prompt == null` or when the action is `defer`, mirroring `applyGroundingToRecommendation:1793`. The writer runs once per request, on the terminal hop only.
4. **Timeouts and budgets.** Each OpenRouter call has `REQUEST_TIMEOUT_MS = 120000` (`openrouter.js:27`). The proxy wraps each hop with `fetchWithTimeout(…, LLM_TIMEOUT_MS = 180_000)` (`routes/proxy.js:371, 1641-1661`). The whole descent shares `RECOMMEND_DESCENT_BUDGET_MS = 180_000` (`routes/proxy.js:390`, `routes/workspace-api.js:33`). Per-hop abort comes from `armHopSignal` (`recommend-recurse.js`). **A second sequential call inside the same hop must fit within the remaining budget and honour `options.signal`.** Otherwise a slow writer turns into a 503 or a truncated descent. recommend-and-dispatch and GET recommend already arm `armKeepalive` (Heroku 30 s router cap), so a longer request is survivable but not free.
5. **Cost contract and free tier.** Free tier is charged **once per request**, not per hop (`proxy-dispatch.js:1190-1197`, `proxy-compute.js:421`, UI `checkFreeTierGate`). Free-tier calls bill the operator's `OPENROUTER_FREE_TIER_KEY` and clamp to `resolveFreeTierModel()` (`openrouter.js:304`). A writer doubles the calls per terminal hop. Each call is logged by `recordLlmCall(meta, callMeta)` (`openrouter.js:365`) with `callMeta.feature = 'recommend'`, so the writer should log under its own feature tag (for example `recommend-write`) to keep cost attributable. The handwritten override path is currently free of LLM calls and explicitly **bypasses** the LLM-config 503 gate and free-tier metering (`proxy-dispatch.js:918-924`, `proxy-compute.js:389`). A writer on that path would bring both back, and the route would need a fallback when no key is configured: ship the unwritten body.
6. **Which model, and how it is configured.** `resolveAiOperationModel({ urlKey, workspacePreferencesStore, opKind: 'recommend', forceDefault: isFreeTier })` (`lib/workspace-preferences.js:229`) resolves `aiModelOverrides.byKind.recommend`, then the workspace `modelId`, then `DEFAULT_MODEL = 'openai/gpt-5.4-mini'` (`openrouter.js:26`). It is called in `routes/proxy.js:1633` and in the UI routes, and passed as `options.model`. `temperature: 0`, `max_tokens: RECOMMENDATION_MAX_TOKENS = 8000` (`openrouter.js:112`). Recommendation calls do **not** use the `resolveReasoningBudget` reasoning field that `streamChat` uses. A separate writer model would add an op kind to `AI_OPERATION_KINDS` (`workspace-preferences.js:209`), which also creates a settings override row (`lib/render-settings.js`, pinned by an "every kind has a label" test).
7. **Machine-read text inside the body has to survive the writer.** `applyPromptCapabilities` is regex over structure: `## Workflow` numbered steps with bold `**Start**`/`**Update…**`, `status to "In Progress"`, `**Subtasks:**` lines. A writer that turns this into plain prose would silently break read-only and non-Linear providers (GitHub, Jira, GitHub Projects). Some literal strings that agents are told to write are later parsed by code: `## Implementation Plan` (`lib/file-pointer.js`, `follow-on-ratio.js`, `plan-review-round-trips.js`, `completion-signals.js`), `### What CI Did Not Prove` (`run-ledger.js`, `follow-on-ratio.js`, `completion-signals.js`), `plan-review due:` (`effort-readout.js`, `plan-review-round-trips.js`), and `### Plan Review Verdict` (read by the meta routing rules). The mechanical layer should hold these as fixed blocks the writer passes through untouched, or apply capability shaping to the bundle before the writer *and* again after it. The access block, file pointer and session-id block are appended after the seam, so they are safe.
8. **Prompt traces.** `recordPromptTrace` (`openrouter.js:400`, store `lib/prompt-trace-store.js:160`) captures `metaPrompt, rawContent, reasoning, prompt, finalPrompt`. The writer's input and output would need new fields to keep the trace (the LIN-578 debugging surface) complete.
9. **Prompt-size freeze.** CLAUDE.md says prompt text grows only by removing at least as many bytes elsewhere, and `tests/unit/prompt-size-budget.test.js` freezes total bytes (`FROZEN_TOTAL_BYTES = 568534`, meta source ceiling `106905`). The writer's own instruction text is new prompt text, and its byte cost has to be offset. Moving stage rules out of the routing call frees about 56 KB, which is more than enough, but the budget table needs a new surface row.
10. **Measurements in flight.** The file-pointer pilot compares arms over implementation dispatches, and `scripts/follow-on-ratio.mjs` reads prompt-change effects. Switching on a writer mid-pilot confounds both. Every prompt-template change needs a row in `scripts/prompt-template-change-log.md` with a pre-registered direction (`docs/architecture/prompt-system.md:28`).
11. **Determinism.** The handwritten path is deterministic today, and tests, the audit page and Linear byte-parity depend on that. A writer makes it non-deterministic. That is a strong reason to keep `generatePrompt` unchanged and add the writer as a separate opt-in step.

---

## 5. Feature flags and switches: how prompt-related switches work today

There are three mechanisms, and they reach different surfaces.

1. **Per-user features** (`lib/feature-defaults.js`): `FEATURES` (`:21`), `FEATURE_DEFAULTS` (`:50`), `FEATURE_LABELS`, `FEATURE_DESCRIPTIONS`, optional `FEATURE_NOTES`. They are read with `getFeatureFlags(req.session)` (`:199`) and passed as `featureFlags` into `generatePrompt` / `getRecommendation` (`options.featureFlags`). Prompt-shaping keys today are `linearMcp`, `featureBranches`, `codeReview`, `codeReviewSelf`, `codeReviewCicd` and `codeReviewPr`. **Proxy and autopilot paths pass `featureFlags: {}`** (`routes/proxy.js:1652`, `proxy-dispatch.js:960`, `proxy-compute.js:316/466`), so per-user flags never reach autonomous dispatch. LIN-282 tracks that gap. **A per-user flag is therefore the wrong switch for a writer meant to affect autopilot.**
2. **Workspace features** (`lib/feature-defaults.js`, `WORKSPACE_FEATURES` at `:221`, `WORKSPACE_FEATURE_DEFAULTS`, labels and descriptions), read with `await isWorkspaceFeatureEnabled({ urlKey, featureKey, store: workspacePreferencesStore })` (`lib/workspace-preferences.js:288`) and written with `setWorkspaceFeature` (`:306`). Current examples are `periodicals` and `observerAuthority`, both default `false`. These *are* reachable on proxy paths (`computeRecommendation` has `urlKey`, and the routes hold `workspacePreferencesStore`), and the settings UI renders them. This is the right shape for a per-workspace, off-by-default writer switch.
3. **Env switch read at call time.** The precedent is `HARBOUR_FILE_POINTER_PILOT`: `FILE_POINTER_PILOT_ENV` + `isFilePointerPilotEnabled(env = process.env)` in `lib/dispatch-factory.js:63-72`, which accepts `1/true/on/yes`. It is read per call, not at import, and a test override parameter (`filePointerEnabled`) is threaded through `createDispatchItem`. This is the simplest instance-wide kill switch. Note that `HARBOUR_FILE_POINTER_PILOT` is **not** listed in `docs/architecture/configuration.md`; a new variable should be.

Suggested pattern for the writer: an env master switch (`isBriefWriterEnabled(env)`, off by default) AND'd with an optional workspace feature. Both should be resolved in the route, where `urlKey` and the store are available, and passed down as a plain boolean option (`options.writeBrief`), so `lib/openrouter.js` and `lib/prompt-templates.js` stay free of store I/O.

---

## 6. Tests that pin prompt output

705 unit test files in total. The prompt-relevant ones:

| File | Tests | What it pins |
|---|---|---|
| `tests/unit/prompt-templates.test.js` | 365 | Template content per stage, mostly by **phrase presence** (about 250 `.includes`, about 550 regex/`.test`, about 80 `indexOf` ordering checks). Also contains meta-prompt routing blocks (`:2280-2510`, `:3879`, `:3907`), cross-path parity (`:4046` grounding, `:4113` attachments), capability parity (`:2213-2280`, `:3963-4046`), plus inventory checks: "exactly 17 templates" `:115`, `llms.txt` catalogue sync `:154`, docs template count `:217` |
| `tests/unit/openrouter.test.js` | 219 | About 97 on `buildMetaPromptTemplate` routing and quality-rule content (`:640-2158`, `:3233+`), mostly phrase presence; about 25 on vocabulary and the parsers (`:2159-2349`: `parseDeferTo`, `parseRecommendationResponse`, `parseRecommendedAction`); the stream contract (`:2350`, which asserts the returned structure equals the parse); LLM call recorder, trace recorder, abort and transport (`:2466+`, `:2949`, `:3060`, `:3128`) |
| `tests/unit/prompt-size-budget.test.js` | 8 | **Byte ceilings**: template source and render per key, meta-prompt source and render, runner prompt, `FROZEN_TOTAL_BYTES` |
| `tests/unit/rulings-resolution-contract-drift.test.js` | 9 | **Byte identity** of `scripts/eval/meta-prompt.baseline.txt` against a fresh render (`:146-170`); regenerate with `scripts/eval/regen-baseline.mjs` |
| `tests/unit/lin-2353-*-provider-ui*.test.js`, `recommend-provider-ui.test.js`, `lin-2353-recommend-llm-provider-ui.test.js` | about 19 | providerUi threading into both generators |
| `recommend-stream-attachments.test.js`, `proxy-prompt-attachments.test.js` | 3 | attachments reach both paths |
| `proxy-recommend-kind-override.test.js`, `recommend-defer-integration.test.js`, `recommend-recurse.test.js`, `mock-recommendation.test.js` | — | routing and override plumbing, defer descent |
| `file-pointer*.test.js` (5 files), `proxy-preamble.test.js` (57), `dispatch-factory*.test.js` | — | Downstream appends and prepends; fixed marker text |
| `follow-on-ratio.test.js`, `periodicals.test.js` | — | read template source and change-log; `periodicals` has its own `template.generatePrompt` (not ours) |
| e2e: `prompts.spec.js`, `streaming.spec.js`, `opened-task-first-screen.spec.js` | — | UI flow over **mock** prompts (`Help me with task …`), not real template wording |

**Split by kind of assertion:**
- **Exact rendered wording / bytes, which a writer or rewrite will break directly:** the inline snapshot of the bug template Goal block (`prompt-templates.test.js:506`); the meta-prompt baseline byte identity (`rulings-resolution-contract-drift.test.js:146-170`); the byte ceilings (`prompt-size-budget.test.js`); and verbatim-sentence pins such as "pre-existing conditional-Approve sentence is preserved verbatim" (`prompt-templates.test.js:2790`, `openrouter.test.js:1300`), the step-3 blocks/blocked-by line (`prompt-templates.test.js:4386`), the review checklist line (`:1044`), and "the LIN-597 downward bias … untouched byte-for-byte" (`openrouter.test.js:3331`).
- **Rule content via key-phrase presence (the bulk, about 450 tests across the two big files):** they assert that a phrase or regex appears in `generatePrompt(kind)` or `buildMetaPromptTemplate()`. They pin the *rule*, but through its wording, so a prose rewrite breaks them even when the rule survives. They test the generators' text, not dispatched output. A writer layer that keeps `generatePrompt` and the routing builder unchanged leaves them green, but they would then pin the *bundle* and not what agents receive.
- **Structural / self-relative (robust to rewording):** the grounding parity tests (`:4046-4111`) check that handwritten ends with the grounding and that the meta prompt is `'BODY' + grounding`; attachments parity; Linear byte parity (provider vs no provider, comparing output to itself); the defer `prompt:null` contract; parser and stream contract tests; the template count and catalogue syncs.
- **Process instruments:** `scripts/eval-research-routing.mjs` with `scripts/eval/` (offline A/B of the *routing* line on the baseline snapshot) and `scripts/eval-completeness-check.mjs` (`docs/prompt-change-validation.md`). The routing eval maps directly onto the "routing-only call" half of the split.

**Writer-layer test implications:** the writer's own output is non-deterministic, so it needs contract tests, not wording pins. Useful contracts: the machine-read blocks survive, capability transforms still apply, grounding is still appended exactly once, defer skips the writer, the switch off is byte-identical, and the fallback on writer failure or timeout returns the unwritten bundle. OpenRouter is stubbed via `setFetchImpl` / `global.fetch` mocks, as in `openrouter.test.js:2350ff`. The hermetic guard (`tests/fixtures/network-guard.js`) fails any test that opens a real socket.
