# Requirements notes: routes/workspace-api.js (origin/main 16e7ae77e8fba0874c5776e2421ace6da3b2f474)

Exports to keep: `createWorkspaceApiRoutes(deps)` → express Router; `generateMockRecommendation(issue)`; `buildMockRecommendationHop(ctx)`;
`decisionStampDedupe` (createDedupeCache instance; server.js passes it to createTestRoutes for resets). 4,673 lines, 32 own routes + 2 sub-routers.
Mount: server.js:2978 `app.use(createWorkspaceApiRoutes({workspaceFromUrl, freeTierStore, getOpenRouterSource, userPreferencesStore,
workspacePreferencesStore, customPromptsStore, recapCacheStore, briefCacheStore, reportHistoryStore, dispatchQueueStore, agentStatusStore,
promptTraceStore, proxyTokenStore, taskDecisionsStore, harbourCommentsStore, sessionsFeedCache, ownerCredentialStore, accountStore,
adoptConnectionCredential:(a)=>connectionAccess.adoptConnectionCredential(a), closeOutEventsStore, workspaceOwnerCheck, onTicketWrite}))`
(no `runEvidence`/`closeOut` test seams in production). Before it: express.urlencoded, express.json({limit:'250kb'}), session, many routers
(createProxyRoutes immediately before). After: server.js:4457 final error handler (client 4xx keep status via clientErrorStatus/Message; else
500 `{error:'Internal server error'}` for /api/ paths). Router order: createPromptsRoutes (prompt-traces, prompts/custom CRUD) FIRST, then the 32
routes below in order, then createRoadmapRoutes (north-star, reports, generate, chat) LAST. `/recommend/status` precedes `/recommend/:issueId`.
Module imports with side effects: `../lib/providers/linear/index.js` (registers Linear), `./proxy.js` (commentDedupe, commentDedupeGenerations —
shared with the agent lane), `./dashboard.js` (settleWithConcurrency). Import reads no env, prints nothing.

## Middleware (every route): `workspaceFromUrl` (server.js:2293)
invalid urlKey (`/^[a-z0-9-]{1,50}$/i`) → 400 `Invalid workspace URL`; no `session.workspaces` → 401 `Not authenticated`; unknown key → 404 HTML;
throw → 500. Sets `req.workspace` (the session's own object — later mutations land in the session). Route-local `json()` (100kb, type json) on
comments POST, scan dismiss/retire/unretire, issues POST/PATCH, run-evidence check/press; feedback has `json({type:()=>true, limit:'12mb'})`.
No owner gate on any route except the feedback triage/autopilot lane (below). No CSRF/proxy-token auth here: session-only lane.

## Common shapes
- `resolveIssueBinding(workspace, req.query.source)` → {provider (registry), callScope (token / {email,apiToken,site} / {token,repo})}. `source`
  selects a binding of that provider kind inside the workspace only; unknown → workspace active provider (unknown name → linear).
- isTestMode = `NODE_ENV==='test' && workspace.accessToken==='test-token'` → testMockData data mocks. mockAi = shouldMockAi (test + test-token|local).
- AI credential: `resolveChatCredential({sessionApiKey: session.openRouterApiKey})` (session key > OPENROUTER_API_KEY > OPENROUTER_FREE_TIER_KEY);
  `isAiUnavailable` → 503; free tier → `checkFreeTierGate` (freeTierStore.tryUse(urlKey); 429 `{error:reason, freeTier:{used:true, remaining,
  limit, resetsAt}}`) — NOT inside try: a throwing tryUse escapes to the final handler (500). Model: `resolveAiOperationModel({urlKey,
  workspacePreferencesStore, opKind, forceDefault:isFreeTier})` (free tier clamped).
- Error ladders in catch: `error.response?.status===401` → 401 `Token expired or invalid`; `message.includes('not found')` → 404 message; (AI routes)
  `includes('OpenRouter')` → 503 `AI service temporarily unavailable` +message; else 500 `{error, message}`.
- `armKeepalive(res)`: after 20s (x-request-start) / 25s, commits 200 + whitespace; later errors ride `{statusCode}` in the body
  (`keepaliveError`). Used by recommend, recap/brief/scan POST, retire, scan-due. `clientGoneSignal` (recommend: hang-up → 499).
- Capability 422 envelope: `{error, code:'CAPABILITY_NOT_SUPPORTED', capability, provider}`.

## Routes (method path → behaviour; provider/store/closure calls)
1. GET /audit — test mock (test-token or local, NODE_ENV test) → computeAuditFromData; non-Linear active provider → 422 capability 'audit'
   (credential must NOT reach Linear, LIN-1899); `runAudit(getWorkspaceToken(ws))` (Linear GraphQL) → 200 report; 401 → 401; else 500 `Audit failed`.
2. GET /prompt/:issueId/:labelName — isValidIssueId (`/^#?[A-Za-z0-9-]{1,100}$/`) else 400; label without template (and not `custom:`) → 404;
   test mock (testMockData) or `provider.fetchIssueContext(scope,id)`; `custom:<id>` → customPromptsStore.get(urlKey,id) (miss → 404) →
   generateCustomPrompt; else generatePrompt(label, issue, ctx(+attachments), getFeatureFlags(session), providerUi). `?format=md` →
   text/markdown + `Content-Disposition: attachment; filename="<buildPromptFilename>"`; else `{label, promptName, prompt}`. 401/404/500 ladder.
3. GET /autopilot-prompt/:issueId — `session.features.proxy!==true` → 403 `Proxy feature is not enabled`; id 400; `?stopAt` blank→absent, 'pr' only
   (else 400 validateRunField msg); mode/variant whitelists; baseUrl `${req.protocol}://${host}`; test mock or fetchIssueContext →
   buildAutopilotKickoff({baseUrl, issue:{identifier,title}, mode, variant, stopAt, standalone:true, providerUi}); stepper changes label/
   promptName/downloadName only. Same md/JSON + 401/404/500.
4. GET /autopilot-prompt — proxy flag 403; goal = query string sliced 1000; `?maxTasks` blank→absent, else Number ≥1 int (400); kickoff
   {baseUrl, goal, mode, variant, standalone, maxTasks, providerUi(active)}; promptName from goal.trim().slice(0,60) or 'stack walk'.
5. GET /recommend/status — `{enabled: isTestMode||isRecommendationEnabled(sessionKey)||source==='free', source:getOpenRouterSource(req), model,
   modelName}`; no try (prefs throw → final handler 500).
6. GET /recommend/:issueId — binding resolved BEFORE id check; 400; `!supports('fetchRecommendationContext')` → 422; 503 if AI unavailable;
   free tier 429 (non-test, non-mock unless session freeTierEnabled); keepalive; test mock (tryUse when session free tier) → mock JSON;
   else resolveRecommendation({startIdentifier:issueId, deadline: now+180s, computeOne}) — computeOne: fetchRecommendationContext(scope,id)
   → mockAi ? buildMockRecommendationHop : getRecommendation(issue, prepareRecommendationInput(ctx,{dispatchQueueStore,urlKey,identifier}),
   {apiKey, model, featureFlags, providerUi, signal: armHopSignal, callMeta:{urlKey, feature:'recommend', issueIdentifier}}). 200 `{reasoning,
   prompt, truncated, completionTokens, issueUrl, identifier, deferredVia, deferTruncated, deferStopReason}`; gone → 499; 401/404/503/500.
7. GET /recommend/:issueId/stream — same pre-flight (plain JSON errors, 503 text without the OpenRouter hint); mockAi(local) pre-checks
   context (not found → 404); test mock SSE (descent breadcrumbs for parents); else SSE headers + armSseKeepalive (15s comments),
   `phase fetching_context`, context fetch with AbortSignal.any([client, timeout 45s]); children → resolveRecommendation with onHop breadcrumbs
   and getRecommendationStream per hop (per-hop done swallowed); final `done` {truncated, completionTokens, issueUrl, identifier, deferredVia,
   deferTruncated, deferStopReason} or `error` 'did not resolve'; leaf → getRecommendationStream forwarding events, done merged with {issueUrl};
   errors → `event: error {error: message}`; client close aborts model calls, nothing more written.
8. GET /comments/:issueId — 400; fetchIssueComments(scope,id) → `{comments}`; 401/404/500.
9. POST /comments/:issueId — binding first; `!supports('createComment')` → 422; id 400; validateCommentBody (400), >50000 → 400; key =
   dedupeKey(urlKey, issueId, body, commentDedupeGenerations.current(urlKey), 'human-comment'); body + `\n\n— Ruling recorded via Harbour`.
   Non-test: no issueWriteGuard method → 422 'issueWriteGuard'; guard trashed → 409. Dedupe hit → re-stamp unless decisionStampDedupe has key,
   ledger repair harbourCommentsStore.record, 200 `{...prior, deduped:true}`. Else test-mode synthetic comment or
   normalizeCommentWrite(provider.createComment(scope, id, attributed)); !success/!comment → 502 `{detail}`; success → commentDedupe.set,
   harbourCommentsStore.record({urlKey, commentId}) (logged on failure), stampDecisionAnswers: loop pair → dispatchQueueStore
   .markDecisionAnswered(loopId, urlKey, decisionId, undefined, optionId) (+sessionsFeedCache.clear on success); task pair →
   taskDecisionsStore.answer({urlKey, issueId, id}) (+clear); all-ok → decisionStampDedupe.set → 201 `commentCreate`.
   Catch: classifyUpstreamError; auth + !test + ownerCredentialStore + no `?source` + linear → recovery: connection-backed active binding →
   adoptConnectionCredential({workspace, ownerAccountId, fingerprint}) + setBindingCredential/setWorkspaceCredential; else
   adoptDurableCredentialIfDifferent (ownerCredentialStore.get). Adopted → applyAccessTokenToWorkspace (SESSION MUTATION) → saveSession →
   `[credential-adopted]` log (fingerprints only) → re-resolve binding → guard (409) → createComment retry → success tail; any failure →
   classified. 500 `{error:'Failed to create comment', code, category, retryable, detail}` — never the raw upstream message; console logs
   credentialFingerprint only.
10. GET /detail/:issueId — 400; test mock or fetchIssueFields(scope,id); customPromptsStore.list (non-fatal); isLocalhost from Host;
    section whitelist; `{html: renderDetailsContent(issue, {..., openRouterSource, featureFlags, customPrompts, isLocalhost, provider, section})}`.
11. GET /sessions/:identifier — >100 chars → 400; no dispatchQueueStore/agentStatusStore → 503; getLoopsForIssue (listItems, listHistory,
    listStatus) → `{sessions}` newest first; 500.
12/13. GET|POST /recap/:issueId, 15/16 GET|POST /brief/:issueId — 400; store missing → 503; capability 422; context (test mock /
    fetchRecommendationContext); canonicalId = context.issue.id || issueId; inputHash = hashContext(ctx). GET: store.get(urlKey, canonicalId) →
    missing / stale {generatedAt, model} / fresh {recap|brief,...}. POST: AI 503 `{code:'AI_NOT_CONFIGURED'}`, free tier 429 (non-mock), keepalive,
    mock (buildMockRecap/Brief) or generateRecap/generateBrief (streamChat, callMeta feature recap/brief), store.put(urlKey, canonicalId,
    {inputHash, recap|brief, model}) then get → 200 `{status:'fresh', ..., generatedAt, model}`.
14. GET /context/:issueId — 400; test mock issues or fetchProjects(scope).issues; root by id or identifier (case-insensitive) → 404;
    buildContextGraph → 200; ladder.
17. GET /scan/:issueId — 400; taskDecisionsStore missing 503; 422 capability; context; non-UUID canonical → 422 CANONICAL_ID_REQUIRED;
    getStatus(urlKey, canonicalId, inputHash) → missing / stale|fresh with decision fields + basisChanged (tri-state).
18. POST /scan/:issueId — `issueSource` from trimmed `?source` persisted; AI 503/429; keepalive; mock text through parseScanResponse or
    generateScan; fail-closed → 503 PRINCIPLE_ZERO_UNAVAILABLE; error → 502 SCAN_PARSE_FAILED; harbourCommentsStore.wereRecordedByHarbour;
    recordScan({urlKey, issueId, issueIdentifier, inputHash, basisHash, basisVersion, dueBasisHash, dueBasisVersion, decision, [issueSource]});
    null → 500; 200 `{status:'fresh', id, issueId, decision, scannedAt, outcome, outcomeAt, outcomeReason, outcomeBasisHash, model}`.
19. POST /scan/:issueId/dismiss — 400 id; body.id required (400); 503; UUID issueId skips the context fetch; markOutcome({urlKey, issueId,
    id, outcome:'dismissed'}) null → 404; sessionsFeedCache.clear; 200 record fields.
20. POST /scan/:issueId/retire — server-side re-scan (buildScanMessages → streamChat maxTokens 1000 temperature 0 feature 'scan-retire', or
    mock); non-retirement → 200 `{retired:false, reason}` / 502 parse; markOutcome self-resolved + outcomeReason (ISO now) + outcomeBasisHash →
    404 ROW_GONE / 409 ALREADY_TERMINAL / 200 `{retired:true,...}` + clear. Never trusts a client verdict.
21. POST /scan/:issueId/unretire — reverseOutcome; exact-message errors → 404 ROW_GONE / 409 NOT_SELF_RESOLVED; clear; 401/500.
22. GET /scan-due — default binding (`source` ignored); 503; 422; cursor base64url JSON {scannedAt,issueId} strings else 400 INVALID_CURSOR;
    listCandidatesForWorkspace(urlKey, {cursor, limit:40}); fan-out concurrency 5: fetchRecommendationContext + wereRecordedByHarbour →
    {issueId, issueIdentifier, dueStatus, [source]}; per-row failure → {dueStatus:null, error:true}; nextCursor re-encoded or null.
23. GET /image — url required/https/exact host {uploads,cdn,}linear.app/no '..' in pathname/parseable (400s, SSRF guard); Authorization
    Bearer token ONLY when active provider is Linear (incl. providerless legacy); fetch(redirect:'error'); !ok → upstream status `Failed to
    fetch image`; >10MB (content-length or body) → 413; sniffRasterType else 400 (no SVG/HTML relay); headers Content-Type sniffed,
    X-Content-Type-Options nosniff, Cache-Control private, max-age=3600; redirect errors → 400; else 500. Array `?url` → TypeError → 500.
24. POST /feedback — default binding; issueSource = provider.name; model/harness validateOpaqueDispatchField (400); message required ≤10000;
    capability createIssue / uploadFile(if image) 422; team: body.teamId → FEEDBACK_TEAM_ID → fetchTeams()[0].id → 422 TEAM_UNRESOLVED; project:
    body → FEEDBACK_PROJECT_ID; description = message + capture block (url/userAgent clamp 2000) + image (parseFeedbackImage 400 / 413 >10MB /
    uploadFile) + folded priority (when !apiWriteFields priority) + origin triage marker; title: explicit (250) or AI (generateFeedbackTitle /
    mock) or `Feedback: <first line 60>`; createIssue(scope, {teamId,title,description,[projectId],[priority]}) → 502; lane = action triage|
    autopilot | legacy flag feedbackTriage; OWNER GATE resolveRunnerOwnerRefusal({ownerCheck: workspaceOwnerCheck, workspaceId, accountId,
    target:'cli'}) → `{launched:false, code, retryable, message}`; triage: createDispatchItem(kind 'triage', label feedback-triage, prompt
    generatePrompt('triage')), autopilot: kickoff + FEEDBACK_AUTOPILOT_ORIGIN_NOTE, declaredGrants ['dispatch'], declaredSite 'M4',
    grantOwnerAccountId, workspaceId; runGate=buildRunGate (free tier); run-limit / coded grant refusals reported; 201 `{success, issue,
    [triage], [autopilot]}`; other failures swallowed (logged).
25. POST /issues — default binding; 422 capability; createFields(): teamId required only when declared; title required; validateIssueWriteFields
    (validatePriority) 400; undeclared stateId/priority → 400; team/project/state symbolic refs (UUID short-circuit; fetchTeams/
    fetchProjectsList/states) → RefResolutionError → 422 (+candidates); input.createdBy = session.accountId; 502 `{detail}`; 201; else 500.
26. PATCH /issues/:issueId — 422 updateIssue; 400 id/fields/empty; no guard → 422 issueWriteGuard; trashed → 409; stateId|state|status
    resolved against guard.team.id (none → 422); updateIssue → 502 / 200 `{success, issue}`; then (state write only) fire-and-forget
    onTicketWrite({urlKey, written, readBack}); PartialWriteError → status `{code:'PARTIAL_WRITE', category, retryable, detail, context}`.
27. GET /openrouter/models — getModelCatalog({mock: shouldMockAi}) (fetch + 1h cache) → `{models:[{id,name,free}]}`; never 500.
28. GET /run-evidence/:issueIdentifier — >100 → 400; readRunEvidence({issueIdentifier, provider, callScope, viewerIsOwner, urlKey, readPrStatus,
    githubFetch}) → `{state, evidence, ledger, closeOut}`; 500.
29. POST …/check — 400; no session.accountId → 401; proxy-token request → 403 PERSON_SESSION_REQUIRED; source from body then query; comments →
    extractPrUrls → readPrStatusFailOpen per PR (prReadToken: workspace token for the bound repo) — fail open; readRunLedger; stopAt via
    readTaskRunFacts (dispatch rows); runnerReady = features.dispatch; deriveCloseOutState; stopAt 'pr': merged PRs → closeOutEventsStore
    findMergedByPr / findAnyByPr(press → by 'close-out') / record; closeOutSetsDone → markDone (fetchIssueContext → issueWriteGuard team →
    states completed → updateIssue) once per merge (doneAt), onTicketWrite, stampDone; → `{state, recorded, done, doneNow, doneError}`.
30. POST …/close-out-press — 400/401/403 as above; hasMergedEvent → 409 CLOSE_OUT_ALREADY_MERGED; record({accountId, urlKey, issueId:null,
    issueIdentifier, by:'press', dispatchId, prUrl, headSha??null, merged:false, openItems zero}) → null → 400; 201 `{success, event}`.

## Logged events (console) — compared verbatim
`Audit error:`, `Prompt generation error:`, `Recommendation error:`, `Streaming recommendation error:`, `Workspace-api create comment error:`
(+ {code, category, credentialFingerprint}), `[credential-adopted] {source:'session-comment-recovery', …fingerprints}`, decision/ledger stamp
failures, `Feedback triage not launched: <code>`, `Feedback autopilot not launched: <code>`, `[ticket-closer] seam 2/3 failure:`, etc.
Side effects: comment dedupe caches (module state, 5 min TTL, shared with routes/proxy.js), decisionStampDedupe, session workspace mutation +
save, store writes listed above, onTicketWrite fire-and-forget, model/upstream calls (all faked here).
