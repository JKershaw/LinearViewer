# Requirements notes: routes/dispatch.js, routes/proxy-dispatch.js, routes/proxy-kickoff.js (origin/main 1f8010a0)

Exports to keep: `dispatch.js` → `createDispatchRoutes(deps)`, `dispatchQueueLimiter` (express-rate-limit, 30/min, also used by
routes/flight-companion.js). `proxy-dispatch.js` → `createDispatchRoutes(deps)`. `proxy-kickoff.js` → `createKickoffRoutes(deps)`.
Mounts: server.js:2336 `app.use(createDispatchRoutes({dispatchQueueStore, dispatchTokenStore, workspaceFromUrl, userPreferencesStore,
harbourFeedbackTokenStore, workspacePreferencesStore, dispatchPresetsStore, proxyTokenStore, workspaceOwnerCheck, getWorkspaceAccessToken,
fetchIssueContext, workspaceHaltStore, sessionsFeedCache, taskModeStore, freeTierStore, accountStore}))` (no `provider`, no
`haltReadTimeoutMs` → 1500). routes/proxy.js:1576 kickoff router, then :1580 proxy dispatch router, both path-less, after the halt
router (which owns `/api/proxy/dispatch/halt`). Global before both: `express.urlencoded`, `express.json({limit:'250kb'})`, session;
after: server.js's final error handler (4xx client errors keep status; else 500 "Internal server error"). Errors: `jsonError(res,s,msg,extra)`
= `{error,...extra}`; badRequest/unauthorized/notFound/serviceUnavailable `.json(res,msg[,detail])`.

## Session lane (dispatch.js). Middleware: `workspaceFromUrl` (400 bad urlKey on /api/, 401 no workspaces, 404 HTML unknown key, 500)
- **POST /workspace/:urlKey/api/dispatch** — `dispatchQueueLimiter` (skip when NODE_ENV=test) → workspaceFromUrl. Order: abort+followUpTo
  400 → prompt required (non-abort) 400 → `targetError(target, DISPATCH_TARGETS)` → **runner owner gate** `resolveRunnerOwnerRefusal({ownerCheck,
  workspaceId:workspace.id, accountId:session.accountId, target: target??'cli'})` (cli/web only; 503 GRANT_OWNERLESS / 503 OWNER_CHECK_UNAVAILABLE /
  403 RUNNER_OWNER_ONLY / 409 WORKSPACE_OWNER_UNSET via `sendRunnerRefusal` + console.warn) → abortTo rule → abort target must be cli/web/dash →
  cascade boolean → cascade needs abort → kind vocab → periodicalId registry → waitForFollowUps/queueIfBusy/subscription → presetId (non-empty
  string; `dispatchPresetsStore.get(urlKey,id)` miss → 400) → maxTasks (int>=1) → attachProxy boolean → entryRung (DISPATCH_RUNGS; not with
  abort/cascade/followUpTo; needs issueIdentifier) → stopAt ('pr'; fresh only; kind autopilot; needs issueIdentifier) → variant
  (standard|stepper; fresh; kind autopilot) → surface (SURFACES) → target 'local' needs Host localhost/127.0.0.1 → `validateDispatchPayload`.
  Then: cascade:true → `dispatchQueueStore.expandCascadeAborts(urlKey, abortTo, {target||'cli', dispatchedBy})` → 201 `{success,cascade:true,...result}`.
  Non-abort with issueIdentifier → dangling-referent guard via `resolveIssueBinding(workspace, issueSource)` (registry provider, injected
  `provider` wins; AMBIGUOUS scope → no token) → `provider.issueWriteGuard(token,id)` null → 422 `{error,code:'ISSUE_NOT_FOUND',issueIdentifier}`.
  Run gate: `resolveChatCredential({sessionApiKey: session.openRouterApiKey})` → `buildRunGate({isFreeTier,freeTierStore,accountId,accountStore})`.
  `createDispatchItem({store, urlKey, workspacePreferencesStore, dispatchPresetsStore, presetId||null, applyDefaultHarness:false, kind, model,
  harness, terminal, effort, dispatchTokenStore, proxyTokenStore, runGate, readPlanBlock, composedRunMarker, getWorkspaceAccessToken:(k)=>
  getWorkspaceAccessToken(k, session), fetchIssueContext, finalizePrompt | prompt, fields:{promptName||'Prompt', issueId, issueIdentifier,
  issueTitle, issueUrl, dispatchedBy, target||'cli', repo, followUpTo, force===true, abort, abortTo(if abort), cascade, sessionId,
  periodicalId, waitForFollowUps, queueIfBusy, subscription??'terminal-only', maxTasks??null, stopAt??null, variant??null, issueSource}})`.
  finalizePrompt: followUpTo → `provisionResumeCredential({..., label:'dispatch-bootstrap', mint: shouldUseMcpTokenField(harness), attach:
  attachProxy?{issueIdentifier,prompt,providerDisplayName,providerUi}:null})` (attach unchanged prompt → throw proxyAttachFailed);
  attachProxy (fresh) → `attachProxyContext` (+ declaredGrants:['dispatch'], declaredSite:'M2', grantOwnerAccountId, workspaceId when kind
  autopilot or periodical+PERIODICAL_AUTOPILOT_TAIL; coded refusal tagged `launchRefusal`); unchanged prompt → proxyAttachFailed; else `{prompt}`.
  After: entryRung + taskModeStore + account → fire-and-forget `taskModeStore.record({accountId,urlKey,issueId,issueIdentifier,rung,ready:true,
  needs:null,act:'dispatch',dispatchId:item._id,surface})` (errors console.error only). target 'local' → write staging file
  `$TMPDIR/harbour-dispatch/<id>.prompt` (0600, dir 0700) → optional `harbourFeedbackTokenStore.mintToken(id,urlKey)` → `spawnClaudeSession`
  (OSC write to /dev/tty) → on success+store `takeItem(id,urlKey,'harbour')` (errors logged); any throw → `spawn:{success:false,error:'Harbour spawn
  setup failed'}`. 201 `{success, item:{id,promptName,kind,issueIdentifier,target,dispatchedAt,consumerLastSeenAt,[budgetPosition]}, [warning],
  [spawn]}`. Catch order: `mapDispatchRefusal` (409 duplicate/budget/close-out/runaway, 429/503 run limit, Retry-After header when set) →
  launchRefusal (`codedGrantRefusalResponse(err,'an autopilot launch credential')`) → proxyAttachFailed 503 → structural grant refusal
  (err.status/code) → anchorTerminalRefusal 409 → composedRunMarkerInvalid 400 → 500 'Failed to dispatch prompt' + console.error. No logEvent.
- **GET …/dispatch** listItems; if rows: `getConsumerLastSeenAt(dispatchTokenStore,urlKey,proxyTokenStore)`; items redacted
  (`redactSessionItem(item, accountId)`) + `consumerPollWarning`. 500 'Failed to list dispatch items'.
- **GET …/dispatch/count** countItems → `{count}`. **GET …/quota**: not free tier or no account → all-null `{limited:false…}`; else
  `resolveAccountGroup` → `freeTierStore.getRunUsage(ids)` → `{limited:true,runsUsed,limit,remaining,resetsAt}`; 500.
- **GET …/history** `?limit` clamp 1..100 (NaN→NaN passed through!) `?offset` → `listHistory(urlKey,{limit,offset})` → `{...result,items:redacted}`.
- **recent-prompts GET/POST**, **favorite-prompts GET/POST/DELETE**: accountId required (401), no store → `{prompts:[]}` / 503; trim; 10000
  cap; dangerous chars; recents dedupe+unshift+slice(10) then `saveUserPreferences(accountId,{...prefs,recentCustomPrompts})`; favourites via
  get/add/removeFavoritePrompt (DELETE reads body.prompt ?? query.prompt; no length/char checks). GET failures degrade to `{prompts:[]}`.
- **halt** (registered before `DELETE …/:itemId`): GET (no store 503) `getWorkspaceHalt` → `{halt: projectHaltForPoll(doc)}`; POST mode in
  HALT_MODES (400 first) → owner gate (no target ⇒ cli) → no store 503 → `setWorkspaceHalt(urlKey,{mode,setBy,now})` → `{success,halt:{mode,
  setAt,setBy}}`; DELETE owner gate → `clearWorkspaceHalt`.
- **DELETE …/:itemId** UUID 400 → `getItemStatus(urlKey,id)` → gate on row.target → `removeItem` (falsy → 404). **PATCH …/:sessionId/trim**
  UUID → maxTasks required → positive int → getItemStatus → gate → `trimSessionBudget(urlKey,id,{maxTasks},{by})` ok → redacted item;
  'not-found' 404; else 409.
- **tokens**: POST (tokenCreationLimiter) → `resolveOwnerMintRefusal(subject 'a dispatch token')` (warn + jsonError with code/category/
  retryable) → label ≤1000 → `createToken(urlKey,label||'default',accountId||null)` → 201 `{tokenId,token,label,message}`; GET listTokens;
  DELETE UUID → owner gate → `revokeToken` (404).
- **presets**: GET (no store → `{presets:[]}`) list; POST/PATCH validate model/harness/effort (opaque ≤1000) + byKind (object; per
  DISPATCH_DEFAULT_KINDS entry object; trimmed) → createCustom / get+update (byKind absent keeps existing) ; store error status 400 when the
  message matches /required|characters or less|must be|maximum of/ else 500; DELETE delete (404).
- **Consumer**: `authenticateDispatchToken` (401 header/empty/invalid; 500 store throw) sets dispatchUrlKey/TokenLabel/TokenOwner.
  **GET /api/dispatch/poll**: pollAvailable ‖ `readHaltForPoll(store,urlKey,1500)` (timeout/throw → `getLastKnownHalt`) → `{items,[halt]}`.
  **POST /api/dispatch/broker-token**: ownerless + compat off → 503 (warn); ownerless compat → warn; no proxyTokenStore 503; body.itemId
  (UUID else 400) → `getGrantDeclaration` (throw 503) → record: B1 owner mismatch / B2 row (getItemStatus) missing, terminal, not taker,
  `deriveTerminalStatus(feedback)` → 403 REFIRE_CALLER_NOT_PERMITTED (warn) → `provisionResumeCredential({label:'refire-broker',harness:
  'claude-code',followUpTo:itemId,createdBy:owner,prompt:null})` → 201 `{token}`; else `createToken(urlKey,{kind:'bootstrap',scope:READ_WRITE,
  label:'refire-broker',ttl:BOOTSTRAP_TOKEN_TTL_SECONDS,createdBy})` → 201 `{token,expiresAt}` (throw/no token 503).
  **POST /api/dispatch/take/:itemId** UUID → `takeItem(id,urlKey,label)` → `{item,dispatchId:item.id}` / 404. **POST
  /api/dispatch/feedback/:itemId** (feedbackLimiter) → `authenticateFeedbackToken` (harbour `validateAndConsume(token,itemId)` first, label
  'harbour'; throw → falls back) → UUID → `validateFeedbackBody` → `addFeedback(id,urlKey,{message,url,urlLabel,kind,rootItemId},label,
  buildWakeCredentialProvisioner({proxyTokenStore,urlKey,baseUrl,createdBy}))` → falsy 404; kind 'decision-withdrawn' →
  `sessionsFeedCache?.clear(urlKey)` → `res.json(result)`.

## Proxy lane. Chain: `proxyLimiter → authenticateProxyToken [→ requireWriteScope → requireGrant('dispatch')]` (403 'This endpoint requires a
read-write token' / 403 DISPATCH_GRANT_REQUIRED). Every outcome after auth calls `logEvent(req, endpoint, status[, note])` except where noted.
- **GET /api/proxy/autopilot/kickoff** mode/variant fallback, goal slice(1000) → logEvent 200 → text/plain `buildAutopilotKickoff({baseUrl,
  goal,mode,variant,standalone:true})`. **GET /autopilot/manual**, **GET /passage-runner/prompt**: logEvent 200 + text/plain builders.
- **POST /api/proxy/autopilot/kickoff** (grant): no queue 503 → mode/variant/goal(≤100000, reportReceivedLength)/target(cli,web,dash)/repo/
  issueIdentifier format/sessionId/subscription/model/harness/effort (unknown effort → warn) → presetId (get miss 400) → maxTasks (400s logged).
  Scoped: `resolveProviderAccess(urlKey, createdBy, req, {source:issueSource})` → no token → `workspaceUnavailable` 503 → `denyIfUnsupported(
  'fetchIssueContext')` 422 → `resolvePromptIssueContext(provider,token,id,isTestMode)` ('not found' / null → 404). Parent run:
  `getItemStatus(urlKey,sessionId)` (errors → null) → stopAt inherit. `buildAutopilotKickoff({baseUrl,issue,goal,mode,variant,stopAt,maxTasks,
  providerUi})`. `getWorkspaceOpenRouterKey` (optional) → run gate → `createDispatchItem({… presetId, kind:'autopilot', finalizePrompt:
  attachProxyContext(label 'kickoff-bootstrap', declaredGrants ['dispatch'], declaredSite 'M1', grantOwnerAccountId: createdBy, workspaceId:
  proxyWorkspaceId) unless appendProxyContext===false, fields:{promptName 'Autopilot (ID)'|'Autopilot (stack walk)', waitForFollowUps:true,
  sessionId, subscription, maxTasks, variant, issueSource…}})` → logEvent 201 → 201 `{success,id,sessionId:id,status:'queued',kind,promptName,
  mode,variant,issueIdentifier,target,dispatchedAt(ISO),maxTasks,[budgetPosition],consumerLastSeenAt,[warning]}`. Catch: relayDispatchRefusal
  → proxyAttachFailed 503 → structural (codedGrantRefusalResponse 'a child autopilot launch credential') → graphqlErrorStatus 401/503 →
  `classifyUpstreamError(err, resolvedProvider.displayName)` envelope → else 500.
- **POST /api/proxy/dispatch** (grant): no queue 503; validation order abort/followUpTo, prompt, target (POLLED_TARGETS), abortTo, cascade,
  kind, periodicalId, waitForFollowUps, queueIfBusy, subscription, maxTasks, validateDispatchPayload (each 400 logged). cascade → expand (201
  logged). Non-abort with issueIdentifier or repo → resolveProviderAccess(source only when issueIdentifier) → referent guard 422 note
  `ISSUE_NOT_FOUND <id>`. getWorkspaceOpenRouterKey → run gate → createDispatchItem (finalizePrompt: followUp → provisionResumeCredential(mint:
  prompt && !optOut && mcp; attach when append); prompt && append → attachProxyContext; else `{prompt, bootstrapToken:null}`; append default
  ON for fresh, OFF for follow-ups unless appendProxyContext:true) → logEvent 201 → 201 `{success,id,status:'queued',promptName,kind,
  issueIdentifier,target,abort,abortTo,cascade,sessionId,maxTasks,[budgetPosition],dispatchedAt,consumerLastSeenAt,[warning]}`. Catch:
  relay → attach 503 → structural (err.status) → 500.
- **POST /api/proxy/recommend-and-dispatch** (grant): issueIdentifier required/format, target, noDescend boolean, waitForFollowUps,
  queueIfBusy, subscription, repo/model/harness/effort opaque (≤1000), kind ∈ PROMPT_TEMPLATES, periodicalId, sessionId, followUpTo
  (UUID, cli/web), force. resolveProviderAccess(source) → 503 → denyIfUnsupported fetchIssueContext + fetchRecommendationContext. kind
  override arm: OR key → armKeepalive + clientGoneSignal → resolvePromptIssueContext (404) → periodicalId (caller ?? gate marker) →
  generatePrompt (null → 500) → hung up → 499 note 'client closed before enqueue' (endpoint `(override:kind)`) → createDispatchItem →
  logEvent `/api/proxy/recommend-and-dispatch (override:<kind>)` 201 → keepalive.send 201 {…, override:true}; catch relay(keepalive) / 503 /
  structural / graphqlErrorStatus + detail. LLM arm: OR key → isAiUnavailable 503 → logOpenRouterCredentialSource (non-test) → free tier
  charge (429 body) → keepalive → `resolveRecommendation({startIdentifier,deadline,noDescend,computeOne→computeRecommendation({…clientSignal})})`
  (gone → 499 'client closed'; else recommendErrorResponse) → defer/no prompt → 422 {deferredVia,deferTruncated,deferStopReason} →
  createDispatchItem(kind deriveDispatchKind(action), issueIdentifier = rec.identifier) → 201 {…, deferredVia, deferTruncated, [descent]}.
  Outer catch → graphqlErrorStatus. Flushed keepalive moves status into body `statusCode`.
- **GET /api/proxy/dispatch** (read): limit 1..100 (default 20), issueIdentifier ≤100 / status ≤1000 no control chars (400). listItems +
  listHistory(limit 200, projection {prompt:0}, scoped) → lineage `listHistory({rootItemId:{$in},limit:LINEAGE_QUERY_LIMIT})` (warn over cap)
  → abort harvest → wire status filter/sort → getConsumerLastSeenAt only if a returned row is queued → 200 `{items,total,truncated}`.
- **GET /api/proxy/dispatch/:id** id ≤100 no control chars → `getItemStatus(urlKey,id,{includeGroupFeedback:true})` 404 → wake row →
  `getWakeShadow` → `?wait` (≤50s): terminal → reason 'terminal'; else keepalive + 1500ms re-poll loop → 'change'/'timeout' + waitedMs.
- **GET /api/proxy/dispatch/:id/prompt** getItemStatus → prompt redacted unless caller is the dispatcher. **GET /api/proxy/wake-shadow**
  days clamp 1..31 → `getWakeShadowTally(urlKey, {days}|{})`. All: no queue 503, throw 500 + console.error.
