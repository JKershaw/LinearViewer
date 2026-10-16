# lib/task-page-loader.js — requirements notes (origin/main 1f8010a0)

441 code lines / 776 total; `buildTaskPageModel` cyclomatic 77. Builds the model
`lib/render-task-page.js` renders for `GET /workspace/:urlKey/task/:id` (routes/task-page.js)
and the guest page `/t/:token` (routes/task-share.js). Wired once in server.js:3012.

## Exports (11)
- `stageLabel(kind)` → `STAGE_LABELS[kind]` if truthy, else `stepKindWord(kind)`. Plain-object
  lookup: `'constructor'`/`'__proto__'`/`'toString'` return Object.prototype members (a function /
  object), and a non-string kind (5) throws in `stepKindWord`. render-task-page imports it.
- `fmtWhen(value, now = new Date())` → `'6 Oct, 14:02 UTC'`, `' 2025'` year suffix when the year
  differs from `now`'s; null for falsy/invalid. Epoch `0` is falsy → null. Also used by the renderer.
- `isNotFoundError(err)` → `/not found/i` on `err.message` (string coerced; bare strings → false).
- `sessionMessage(loop, state)` → last wake-marker entry text (marker stripped by
  `WAKE_FEEDBACK_REGEX`), a `[blocked]` one only while `state==='waiting'`; else `agentSummary`; '' → null.
- `guessStages(sessions, trackerType)` → `USUAL_STAGES` after the furthest reached index; [] when
  completed/canceled; non-array sessions → all five.
- `briefCurrentSection(body)` → text under `## Current` up to the next level-2 heading; null if
  missing/empty/`_None._`/`- none` etc.
- `buildTaskStages(sessions, {trackerType})` → stages (orchestration kinds fold into the next work
  session or the last stage; consecutive same-kind sessions = attempts) + `ahead` guesses.
- `deriveReadyHeader(closeOut)` → `{status:'waiting', sentence:'Approved. PR #N is ready to merge.'}`
  iff `status==='ready'` and `pr.number != null` (0 counts).
- `deriveHeader({sessions, waiting, tracker, closeOut, now})` → `{status, sentence}`: done (tracker
  completed/canceled) > waiting (first non-empty line, ≤160 chars with `…`) > running (newest
  running) > queued > ready > idle ("No sessions yet." / "No session running. Last: …").
- `buildTaskPageModel({identifier, loops, ctx, brief, recap, contextMiss, evidence, issueId,
  enrichLoop, deriveSessionWaiting, now})` → the page model (identifier, title, issueId, tracker,
  status, sentence, readyHeader, live, finished, sessions[], guesses, stages, summary, brief, recap,
  contextMiss, description, comments, evidence, details). Pure apart from the injected helpers.
- `createTaskPageLoader(deps)` → `{ loadTaskPage, loadTaskState }`; throws if `enrichLoop` or
  `deriveSessionWaiting` is not a function.

## Inputs / injected deps
- `enrichLoop`, `deriveSessionWaiting`: routes/dashboard.js (a lib module may not import a route).
- `getLoopsForIssue` (default: lib/pipeline-loops.js, called with `{dispatchStore,
  agentStatusStore, horizon:'all'}`), `readTaskRunFacts` (default lib/task-run-facts.js,
  `{store: dispatchStore, urlKey, issueIdentifier}`), `now` (default `() => new Date()`).
- `briefCacheStore`/`recapCacheStore`: `get(urlKey, issueId)` only, errors swallowed; never `put`.
- `readRunEvidence({issueIdentifier, provider, callScope, comments, evidenceUrls, asked, urlKey,
  viewerIsOwner, stopAt, variant, runnerReady, [readPrStatus]})`; errors → console.error + null.
- `prStateStore.readResult({repo, number}, prStateStore.now(), auth)` inside a `readPrStatus`
  closure; `auth = {token, scopeKey: urlKey}` only when `prReadToken(callScope, repo)` matches.
- `closeOutEventsStore.listForIssue({urlKey, issueIdentifier})` (errors swallowed → mergedBy null).
- `access.provider.fetchRecommendationContext(callScope, identifier, {noDescend:true})` — the ONE
  tracker read per page load.

## loadTaskPage({urlKey, identifier, access, viewerIsOwner, runnerReady})
1. No access/provider → `{unavailable:true}`. Tracker read throws: `/not found/i` → `{notFound:true}`,
   else console.error + `{unavailable:true}`. `!ctx || !ctx.issue` → `{notFound:true}`.
2. Loops read under the canonical `ctx.issue.identifier || identifier`; issueId =
   `ctx.issue.id || newest loop issueId`.
3. `readTaskRunFacts` BEFORE evidence (rejection propagates). Then in parallel: cache reads + hash
   check (`hashContext(ctx)`; exact iff every child terminal: match→doc, else miss 'stale'; inexact
   & finished → 'unverifiable'; inexact & not finished → doc kept), and evidence.
4. Evidence with a closeOut gets `mergedBy` ('close-out' | 'person' | null, matched by PR url or
   `/pull/<n>` suffix; only for merged/partial with a pr) + message override + `closeOutSummary`.
5. `{ model: buildTaskPageModel(..., now: now()) }`. Rejections from getLoopsForIssue /
   readTaskRunFacts propagate.

## loadTaskState({urlKey, identifier, issueId})
Stored data only: loops + `buildTaskPageModel` with ctx/brief/recap/evidence null (never reads the
provider, caches, evidence or run facts). `contextMiss` is `{brief:null, recap:null}`.

## Side effects
- Clock: `new Date()` defaults (`fmtWhen`, `deriveHeader`, `buildTaskPageModel`, loader `now`).
  No env reads, no module-level mutable state, no network of its own.
- console.error on tracker-read failure and evidence failure (exact texts are observable).
- Output aliasing: `sessions[].loop` IS the enriched loop (or a `{...loop, terminalStatus}` copy);
  `stages[].sessions` share the session objects; `evidence` is the reader's object (or a spread copy).
- Never mutates its inputs (the replay checks args and store-returned values).

## Tests that read the file as text
None found (grep of tests/ for the filename: only imports). Generic lib scanners also parse it
(email-import-boundary import graph; lin-3382 urlKey class guard; code-shape areas.json lists it).
