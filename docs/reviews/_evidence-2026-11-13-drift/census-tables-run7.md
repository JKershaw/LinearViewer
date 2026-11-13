| rank | id (run 7) | id (run 6) | decision | areas/files/sites | status vs run 6 | window hunk | ruling | reason |
|---|---|---|---|---|---|---|---|---|
| 1 | G0001 | G0001 | repeated comparison NODE_ENV == 'test' | 7/17/43 | unchanged | — | real | Env read inline 43x; 10 identical limiter skip arrows re-derive test mode. Home: lib/should-mock-ai.js plus one skipInTest helper (10-23 named it; it… |
| 2 | G0002 | G0002 | repeated comparison kind == 'autopilot' | 4/19/31 | unchanged | — | real | Anchor test repeated inline: run-view.js:340 copies findAnchorLoop's test (session-summary.js:53); dispatch-store 573/738 repeat run-root. Home: find… |
| 3 | G0003 | G0003 | record assembled from the same sources {id=ID.id, title=ID.title} | 7/11/17 | unchanged | — | noise | A new shared home for two mocks (record {id,title} re-keyed from the gone {id,identifier,title}); lib/sample-data/fixture-parent.js is the first home. |
| 4 | G0004 | G0006 | tiny rule copied as a helper slugifyForFilename() (also: githubSlug, … | 5/10/12 | unchanged | — | noise | periodical-runs.js:193 is the first home for repo spelling (no exported repo normaliser); the copies are not a shared decision yet. |
| 5 | G0005 | G0004 | record assembled from the same sources {deployInfo=getDeployInfo(), u… | 2/13/13 | unchanged | — | real | 13 routes rebuild the same deployInfo/urlKey/openRouterSource/workspaces record with no shared builder. One chrome-options builder beside lib/compone… |
| 6 | G0006 | G0005 | repeated comparison authType == 'oauth' | 4/8/12 | unchanged | — | real | lib/workspace.js getBindingCallScope |
| 7 | G0007 | G0007 | repeated comparison kind == 'wake' | 2/11/24 | grown | yes | real | runner.mjs repeats the wake-claim test (kind wake, dispatchedBy null, followUpTo) at lines 122, 1012 and 1332; one helper in that file. Other wake si… |
| 8 | G0008 | G0008 | repeated comparison accessToken == 'test-token' | 4/6/13 | unchanged | — | real | isTestMode predicate re-inlined; 11-04 adds `lib/key-state-holders.js:48` (`workspace.accessToken === MOCK_ACCESS_TOKEN`), the same mock rule restate… |
| 9 | G0009 | G0010 | repeated comparison status == 'taken' | 1/9/16 | unchanged | — | borderline | Status literal still 16 sites in 9 files; the 5 in `dispatch-lineage-status.js` remain beside `lineage-membership.js:39`, which already holds the joi… |
| 10 | G0010 | G0009 | repeated comparison provider == 'jira' | 2/6/8 | unchanged | — | noise | provider switch at the edge; each branch differs |
| 11 | G0011 | G0011 | repeated comparison type == 'started' | 5/7/11 | unchanged | — | real | isInProgress (providers/state-map.js:59) and home-view isStarted exist, yet about 8 sites inline state.type==='started' (tree.js, openrouter, recomme… |
| 12 | G0012 | G0012 | repeated comparison stopAt == 'pr' | 4/10/15 | unchanged | yes | real | Inline stopAt==='pr' at 15 sites; readTaskRunFacts().stopAt is the home, but dispatch-entrance.js:1756 and dispatch-factory.js:444/1170 still re-deri… |
| 13 | G0013 | G0014 | text contract marker: [blocked] | 3/7/15 | unchanged | — | borderline | dispatch-terminal — the parse side is the authority; the emit side is the kit |
| 14 | G0014 | G0013 | repeated comparison scope == 'current' | 3/10/16 | unchanged | — | real | Find-by-(provider,scope) binding lookup is re-written at ~9 sites in 6 files; workspace.js already owns binding lookup (getBindingsForWorkspace). Lab… |
| 15 | G0015 | G0015 | repeated comparison key == 'Escape' | 1/7/10 | unchanged | — | noise | Each Escape handler closes its own component (queue, search, toggles, selectors, sheet); the literal is the platform key name, no shared rule is re-d… |
| 16 | G0016 | G0016 | repeated comparison key == 'Enter' | 1/8/12 | unchanged | — | borderline | Enter/Space activation repeated in 4 handlers; app.js x2 and common.js carry a Spacebar alias. Other Enter sites are send-on-Enter with shift guards,… |
| 17 | G0017 | G0017 | repeated comparison NODE_ENV == 'production' | 3/5/7 | unchanged | — | noise | Environment switch for secure cookies and https redirects; each site sets a different setting. Inert and not a domain decision. |
| 18 | G0018 | G0018 | repeated comparison name == 'AbortError' | 4/6/9 | unchanged | — | noise | standard fetch-abort check |
| 19 | G0019 | G0019 | string set {'127.0.0.1', 'localhost'} as array [[...].includes, [...]… | 4/4/8 | unchanged | — | real | isLocalhostRequest in lib/public-origin.js is the home; server.js inlines the same host test 5x and workspace-api-issue-read.js once. dispatch-entran… |
| 20 | G0020 | G0085 | text contract marker: [skipped] | 3/5/8 | grown | yes | borderline | Grown from table to mustRule by two blind-read prompt sites (completion-signals.js:260, prompt-template-defs.js:1310) that ask an agent to end [skipp… |
| 21 | G0021 | G0020 | repeated comparison provider == 'linear' | 2/4/7 | unchanged | — | borderline | workspace-token-refresh defaultResolveExchange |
| 22 | G0022 | G0021 | string set {'cancelled', 'expired'} as Set/or-chain [NEVER_RAN, ID.hi… | 1/5/6 | unchanged | — | real | Window-introduced: dispatch-leftover.js:29 NEVER_RAN restates the store status set at dispatch-store.js:1906. Home: export the set from the store; th… |
| 23 | G0023 | G0022 | record assembled from the same sources {code=ID.code, category=ID.cat… | 4/7/8 | unchanged | — | real | lib/errors.js — refusal envelope; `lib/errors.js` is the home |
| 24 | G0024 | G0024 | text contract marker: [evidence] | 5/6/9 | unchanged | — | real | session-telemetry EVIDENCE_PREFIX |
| 25 | G0025 | G0023 | string set {'Apr', 'Aug', 'Dec', 'Feb', 'Jan', 'Jul', +6} as array [m… | 4/6/7 | unchanged | — | noise | Inert month-abbreviation constants copied across lib and public; values cannot drift in meaning. Harmless duplication. |
| 26 | G0026 | G0025 | string set {'github', 'github-projects', 'jira', 'linear', 'local'} a… | 3/4/4 | unchanged | — | borderline | `REGISTRY_PROVIDERS` (`lib/workspace-store.js:4`) restates the provider registry (`providers/registry.js` `getAllProviders`); LOW |
| 30 | G0030 | G0029 | tiny rule copied as a helper (anonymous)(), 8 copies of 1-4 statements | 5/6/8 | unchanged | — | real | Mock-issue comment shaping is identical in proxy-compute.js:116, task-chat.js:69 and workspace-api-mocks.js:218. Home: buildMockRecapContext in lib/w… |
| 33 | G0033 | G0031 | repeated comparison harness == 'claude-code' | 4/5/8 | unchanged | — | borderline | harness == 'claude-code' special case repeats at 8 sites in 5 files (curated list, model mapping, catalog guard, label dedupe); each rule differs, so… |
| 34 | G0034 | G0035 | repeated comparison status == 'owner' | 4/8/8 | unchanged | — | borderline | Seven consumers switch on the one answer from readOwnerSeamStatus in lib/workspace-owner.js. The home exists; only the literal is repeated. |
| 35 | G0035 | G0032 | repeated comparison type == 'blocks' | 3/10/12 | unchanged | — | noise | Linear relation literal at 12 sites, each reading a different field for a different purpose; one external enum meaning. |
| 36 | G0036 | G0033 | record assembled from the same sources {token=ID.token, expiresAt=ID.… | 3/3/9 | unchanged | — | borderline | server.js resolver — cache tuple; follows the credential row, no separate decision |
| 37 | G0037 | G0034 | repeated comparison enabled == 'true' | 3/3/3 | unchanged | — | noise | Same one-line boolean parse in a user-level session toggle (server.js) and a workspace-level settings route (routes/settings.js); different stores an… |
| 39 | G0039 | G0039 | text contract marker: [done] | 4/5/7 | unchanged | — | noise | Grown (was run-5 G0099, borderline). New sites are the parse authority REPORT_LINE_RE (dispatch-terminal.js:663) and prose at dispatch-wake.js:356. R… |
| 40 | G0040 | G0036 | repeated comparison recommendedAction == 'defer' | 3/4/6 | unchanged | — | borderline | recommend-recurse |
| 41 | G0041 | G0038 | repeated comparison kind == 'recent' | 3/3/3 | unchanged | — | noise | 'recent' is a collective-characters doc kind at one site and a home-row kind at two others; different kind spaces, no shared rule re-derived. |
| 42 | G0042 | G0040 | repeated comparison status == 'ready' | 3/5/7 | unchanged | — | noise | 'ready' names different enums: close-out status in task-page-loader, close-out.js and session.js versus prompt aiState. Unrelated meanings. |
| 43 | G0043 | G0041 | repeated comparison code == 'OWNER_CHECK_UNAVAILABLE' | 3/5/5 | unchanged | — | borderline | proxy-preamble — sentinel string shared by two modules; follows the credential row |
| 44 | G0044 | G0044 | repeated comparison type == 'completed' | 5/8/10 | unchanged | — | noise | Literal is deliberate in follow-on-ratio.js and ship-journey.js (documented as not isCompleted/isTerminalState); roadmap and tree sites are separate … |
| 45 | G0045 | G0043 | repeated comparison kind == 'custom' | 3/4/5 | unchanged | — | noise | Grown by a store site. Codebase idiom: the custom-kind guard answers a different question at each site (dispatch-store.js:3453). |
| 46 | G0046 | G0046 | string set {'effort', 'harness', 'model'} as table-keys/array [FIELD_… | 4/5/5 | unchanged | — | real | model/harness/effort restated at 5 sites; model-routing.js FIELDS.AGENT_SESSION already declares them. dispatch-validation OPAQUE_FIELDS adds termina… |
| 48 | G0048 | G0049 | text contract marker: [failed] | 3/4/17 | unchanged | — | borderline | dispatch-terminal parses / kit emits |
| 49 | G0049 | G0047 | string set {'pause', 'stop'} as or-chain/table-keys/array [ID.mode, H… | 3/5/5 | unchanged | — | real | Window-introduced: dispatch-leftover.js:113 restates the halt modes beside HALT_MODES (lib/workspace-halt.js:34). Home: HALT_MODES (R1(b)). |
| 51 | G0051 | G0076 | repeated comparison state == 'running' | 3/6/25 | grown | yes | borderline | 22 sites in 5 files mix stage, ledger-row and session state spaces; runner.mjs re-tests row 'running' ~10 times with no shared predicate. Only that l… |
| 52 | G0052 | G0050 | tiny rule copied as a helper hashKey() (also: hashEmailRecipient, has… | 4/9/11 | unchanged | — | noise | hash helpers, identical by design; now also `account-erasure.js:231` |
| 55 | G0055 | G0052 | tiny rule copied as a helper (anonymous)() (also: brief), 3 copies of… | 3/3/3 | unchanged | — | noise | new only because LIN-3596 moved the mocks; same shape |
| 57 | G0057 | G0057 | record assembled from the same sources {id=ID.id, body=ID.body, creat… | 4/5/7 | unchanged | — | noise | comment record, three fields |
| 60 | G0060 | G0062 | repeated comparison turnKind == 'user-initiated' | 4/5/25 | unchanged | — | borderline | lib/agent-turn.js |
| 81 | G0081 | G0082 | repeated comparison agentState == 'error' | 3/4/5 | unchanged | — | noise | Error reads map to different outputs (failed status in task-page-loader, summary text in dashboard-summaries). Not the same decision. |
| 83 | G0083 | G0080 | repeated comparison stateType == 'started' | 3/10/19 | unchanged | — | real | Task-or-subtask in-progress test copied in render-roadmap.js:86, roadmap-digest-template.js:103 and roadmap-narrative-template.js:122. Home: lib/road… |
| 84 | G0084 | G0093 | repeated comparison kind == 'implementation' | 3/6/7 | unchanged | — | noise | Grown by dispatch-leftover.js:61, which is the body of isStageBuild, a new predicate of its own, not a second copy of an existing one. |
| 92 | G0092 | G0092 | repeated comparison state == 'done' | 3/4/5 | unchanged | — | noise | Stage tone, ledger row, task-state settle and ticket markers are four different state machines that share the word; no shared rule is re-derived. |
| 93 | G0093 | G0095 | string set {'merged', 'partial'} as or-chain/Set [ID.closeOut.status,… | 3/4/5 | unchanged | — | real | `lib/run-closeout-state.js` (owns `PARTIAL`/`MERGED`); export an `isMerged` predicate |
| 96 | G0096 | G0102 | text contract heading: changelog | 3/3/3 | unchanged | — | real | `lib/workspace-api-mocks.js` `buildMockBrief` (headings as a contract) |
| 97 | G0097 | G0103 | text contract heading: constraints | 3/3/3 | unchanged | — | real | as G0088 |
| 98 | G0098 | G0104 | text contract heading: open questions | 3/3/3 | unchanged | — | real | as G0088 |
| 101 | G0101 | G0097 | string set {'assistant', 'user'} as or-chain/if-chain [ID.role] | 4/6/6 | unchanged | — | borderline | lib/chat-transcript.js filterChatTurns (bypassed ×3) — role filter; `filterChatTurns` is bypassed three times (LIN-2430 residue) |
| 102 | G0102 | G0098 | repeated comparison type == 'text' | 3/3/5 | unchanged | — | noise | Three sites are ADF node types, one a Claude content block, one a DOM input type; different type namespaces that share the literal. |
| 107 | G0107 | G0110 | repeated comparison state == 'waiting' | 3/4/8 | unchanged | — | borderline | 'waiting' compared inline at 8 sites; UNENDED_STATES now lives in lib/task-state.js:28 (running, queued, waiting). Routing each read is modest cost. |
| 111 | G0111 | G0111 | named constant MONTHS=[Apr,Aug,Dec,Feb,Jan,Jul,Jun,Mar,May,Nov,Oct,Se… | 3/3/3 | unchanged | — | borderline | Identical 12-entry month table in home-view, render and task-page-loader; lib/utils/time.js already holds date helpers. Drift unlikely; sharing is ch… |
| 112 | G0112 | G0108 | string set {'number', 'string'} as or-chain [typeofID] | 3/3/3 | unchanged | — | noise | isScalar, the brief's date coercion and toEpochMs share a typeof idiom but answer different questions; no drifting rule. |
| 115 | G0115 | G0114 | repeated comparison status == 'error' | 3/3/5 | unchanged | — | noise | Grown by dispatch-factory.js:1074-1075, a local settleWithin shape; no shared home for a write status check. |
| 122 | G0122 | G0125 | tiny rule copied as a helper (anonymous)(), 9 copies of 1-4 statements | 3/9/9 | unchanged | — | noise | Nine stream-event callbacks, each a distinct consumer; the shared body is one token append. Not one decision to home. |
| 129 | G0129 | G0127 | tiny rule copied as a helper escapeHtml() (also: escapeXml), 3 copies… | 3/3/3 | unchanged | — | noise | escape helpers per output format |
| 131 | G0131 | G0134 | near-duplicate function buildMockRecapContext() (also: buildMockRecap… | 3/3/3 | unchanged | — | real | `lib/workspace-api-mocks.js` `buildMockRecapContext` |
| 132 | G0132 | G0133 | repeated comparison disposition == 'task-bound' | 3/3/7 | unchanged | — | borderline | Server disposition enum; observation.js branches on it 5 times with different actions. Only the deliverRulingStampOnly pair (2868, 3295) is one dupli… |
| 133 | G0133 | G0135 | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 3/3/3 | unchanged | — | real | Same mock child shaping in workspace-api-mocks.js:211, proxy-compute.js:122 and task-chat.js:75; home buildMockRecapContext in lib/workspace-api-mock… |
| 137 | G0137 | G0129 | repeated comparison provider == 'local' | 4/4/4 | unchanged | — | borderline | Four different uses, but workspace-api-audit.js:36 re-inlines shouldMockAi's test-plus-local predicate despite its comment. Needs one home or a docum… |
| 138 | G0138 | G0142 | string set {'queued', 'running'} as or-chain [ID.state, ID.outcome] | 3/4/5 | unchanged | — | real | running//queued test is inline at home-view:59, render-task-page:245/283, task-state:143 and recent-runs:82; task-state.js exports isOpenState/isUnen… |
| 141 | G0141 | G0144 | repeated comparison state == 'failed' | 3/4/7 | unchanged | — | borderline | `state == 'failed'` in task-state.js roll-ups and attention (`:144,:168,:275,:345`) and in home-view / task-board counts; `task-page-loader.js:648` (… |
| 146 | G0146 | G0140 | named constant UUID_REGEX=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a… | 3/3/3 | unchanged | — | borderline | lib/workspace.js; `UUID_REGEX` copies 6 → 3 |
| 147 | G0147 | G0153 | repeated comparison status == 'done' | 3/3/6 | grown | yes | noise | done status literal; unrelated meanings Re-read: the new site public/task-page.js:848 repeats the page's own :64/:73 reads of the server status; ruli… |
| 152 | G0152 | G0152 | named constant SWEEP_INSTANCE_PREFIX="sweep:v1:" | 3/3/3 | unchanged | — | real | `lib/observer-sweep.js` (the writer; uses an inline literal at :449) |
| 156 | G0156 | G0155 | repeated comparison phase == 'result' | 3/3/3 | unchanged | — | noise | phase literal in one module |
| 157 | G0157 | G0145 | string set {'0', '1', '2', '3', '4'} as table-keys [PRIORITY_WORDS, F… | 4/6/8 | unchanged | — | real | Priority number-to-name map re-declared at 6+ sites (home-view, local provider, swim x2, swipe, roadmap template); render.js already exports PRIORITY… |
| 158 | G0158 | G0175 | tiny rule copied as a helper stripCodeFence() (also: trimToNull, pars… | 4/4/6 | unchanged | — | noise | small parse helpers, coincidental similarity |
| 166 | G0166 | G0168 | repeated comparison state == 'needs-you' | 3/3/6 | unchanged | — | real | needsAPerson(state) already exists in task-state.js, yet task-state.js:275 inlines 'needs-you // failed' instead of calling it. Other sites are per-s… |
| 167 | G0167 | G0169 | repeated comparison state == 'queued' | 3/3/7 | unchanged | — | noise | Queued checks are per-site labels, tones, selection and mapping; the shared in-flight test is G0148, so this is not a separate rule. |
| 168 | G0168 | G0170 | repeated comparison waitingFor == 'ruling' | 3/3/7 | unchanged | — | borderline | task-page-loader tests model.waitingFor==='ruling' at 938, 991, 1017, 1471 though 991 derives waitingOnRuling once; one local would own it. Low cost. |
| 171 | G0171 | G0167 | repeated comparison name == 'linear' | 3/3/3 | unchanged | — | borderline | Grown; the test-only transport (dispatch-factory.js:948) is already a runs-and-dispatch Waiting entry (John, 7 Nov). |
| 172 | G0172 | G0188 | string set {'standard', 'stepper'} as array/ternary-chain [AUTOPILOT_… | 3/3/3 | unchanged | — | borderline | `lib/prompts/autopilot-kickoff.js` `AUTOPILOT_VARIANTS` — `AUTOPILOT_VARIANTS` already exists; callers should import it |
| 175 | G0175 | G0166 | repeated comparison category == 'auth' | 4/4/4 | unchanged | — | noise | Three sites read a classification they already hold; isAuthError exists for bare errors. Trivial token comparison, no drift risk. |
| 177 | G0177 | G0192 | repeated comparison variant == 'stepper' | 3/3/3 | unchanged | — | noise | Three local reads of a variant literal; the allowed-variant validator is elsewhere. Each read is local. |
| 182 | G0182 | G0180 | tiny rule copied as a helper _issueRef() (also: refOf, projectNeighbo… | 3/3/3 | unchanged | — | noise | Three ref projections returning different fields under different names. Not one decision. |
| 191 | G0191 | G0196 | tiny rule copied as a helper normalizePrivateKey() (also: cleanClaim,… | 3/3/3 | unchanged | — | noise | string cleanup helpers, coincidental |
| 192 | G0192 | G0185 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | — | noise | store constructors — reused from 10-18 G0149 (lead matched G0359, a groupKey twin) |
| 196 | G0196 | G0221 | text contract marker: [ticket-closer] | 3/4/4 | unchanged | — | borderline | Tag hardcoded in three route catch logs while ticket-close-closer.js owns a LOG const. A console prefix, not a posted marker; cost unclear. |
| 230 | G0230 | G0234 | repeated comparison state == 'parked' | 3/3/3 | unchanged | — | noise | Three sites: a text line, a task-state switch to 'waiting', and one evidence check on the same field; per-site, no shared rule re-derived. |
| 236 | G0236 | G0233 | string set {'backlog', 'canceled', 'completed', 'duplicate', 'started… | 3/5/11 | unchanged | — | real | `lib/providers/state-map.js` `getStateDisplay`/`getStateOrder` |
| 244 | G0244 | G0245 | repeated comparison outcome == 'self-resolved' | 3/4/7 | unchanged | — | noise | Machine-stamped outcome with one producer (ticket-close-closer.js); readers apply the same bucket. Not a duplicated decision. |
| 245 | G0245 | G0252 | string set {'backlog', 'started', 'unstarted'} as switch/array/table-… | 3/4/4 | unchanged | — | borderline | `lib/providers/state-map.js` (`isTerminalState`, `getStateOrder`) — state rank sets; covered by state-type-label-rank-maps |
| 271 | G0271 | G0267 | named constant UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]… | 3/3/3 | unchanged | — | noise | (`lib/workspace.js` `UUID_REGEX` exists) |
| 272 | G0272 | G0308 | string set {'backlog', 'unstarted'} as array/or-chain [stateTypes, ID… | 3/3/3 | unchanged | — | real | Ready set is queue-config stateTypes, re-inlined in recommendation-facts.js:201 and workspace-api-mocks.js:68. The isReadyState helper from 10-23 is … |
| 273 | G0273 | G0262 | near-duplicate function find() (also: componentFind), ~9 statements, … | 3/4/4 | unchanged | — | noise | union-find helper, generic |
| 290 | G0290 | G0302 | text contract marker: [close-out-merges] | 3/3/3 | unchanged | — | noise | Log-prefix literal repeated in two route catches while lib/close-out-merges.js keeps its own LOG; inert console tag, no consumer or test depends on i… |
| 291 | G0291 | G0281 | tiny rule copied as a helper (anonymous)() (also: loadLoops), 3 copie… | 3/3/3 | unchanged | — | borderline | The 13 calls already route through getLoopsForWorkspace; the duplicated part is the deps bundle plus lean:true in three fan-outs. Low-value consolida… |
| 305 | G0305 | G0297 | repeated comparison kind == 'evidence' | 3/3/3 | unchanged | — | noise | feedback kind literal |
| 316 | G0316 | G0315 | repeated comparison harness == 'opencode' | 3/4/4 | unchanged | — | noise | Four opencode checks are separate rules (option list, web-target refusal, model-id shape, running-total usage) that share a literal. |
| 353 | G0353 | G0352 | repeated comparison verdict == 'credential_dead' | 3/3/3 | unchanged | — | real | Server sites use exported CREDENTIAL_DEAD_VERDICT, but public/proxy.js:256 hardcodes 'credential_dead'. A rename would silently empty the browser fil… |
| 382 | G0382 | G0379 | repeated comparison setting == 'halt' | 3/3/4 | unchanged | — | real | Owner-only halt undo gate repeats at render-settings-workspace:49 and :215 while the route enforces it via haltRefusal; one predicate in workspace-ch… |
| 390 | G0390 | G0390 | tiny rule copied as a helper constructor(), 5 copies of 1-4 statements | 3/5/5 | unchanged | — | noise | Five cache and store constructors with different option sets and no shared base; a constructor signature is not a rule. |
| 391 | G0391 | G0391 | string set {'Deep Dive', 'Front Page', 'The Column', 'The Wire', 'Wea… | 3/4/4 | unchanged | — | real | `lib/ship-biscuit.js` `DESKS` (exported) |
| 396 | G0396 | G0397 | near-duplicate function stableStringify(), ~7 statements, same vocabu… | 3/3/3 | unchanged | — | real | one export of `stableStringify` in `lib/recap-cache.js` or a leaf module (LIN-3736 already proposes `lib/utils/`); 3 copies: `recap-cache.js:27`, `ru… |
| 414 | G0414 | G0413 | string set {'no-owner', 'not-owner', 'owner', 'unavailable'} as array… | 3/3/4 | unchanged | — | real | owner/not-owner/no-owner/unavailable validated in workspace-owner, exported as RUNNER_SETUP_STATES in render-runner-setup, and re-mapped by an if-cha… |
| 426 | G0426 | G0425 | named constant MS_PER_DAY=86400000 | 3/3/3 | unchanged | — | noise | `MS_PER_DAY` constant, inert |
| 446 | G0446 | G0444 | tiny rule copied as a helper cleanup(), 3 copies of 1-4 statements | 3/3/3 | unchanged | — | noise | `cleanup()` per store |
| 495 | G0495 | G0486 | tiny rule copied as a helper stableById() (also: byWorkspaceId), 3 co… | 3/3/3 | unchanged | — | noise | sort comparators |
| 526 | G0526 | G0495 | repeated comparison stateType == 'backlog' | 3/3/3 | unchanged | — | borderline | keepCard backlog rule is copied into public/ship.js:166 from lib/ship-layout.js:353; ship.js header says the inlining is deliberate (no build step). … |
| 536 | G0536 | G0524 | string set {'E', 'N', 'NE', 'NW', 'S', 'SE', +2} as array/table-keys … | 3/3/5 | unchanged | — | noise | (`lib/ship-layout.js` `BEARINGS` exists) |

| rank | id | detector | decision | a/f/s | status |
|---|---|---|---|---|---|
| 27 | G0027 | cmp | repeated comparison target == 'local' | 2/5/5 | unchanged |
| 28 | G0028 | record | literal record repeated verbatim {Cache-Control="no-cache", Connection="keep-al… | 2/5/7 | unchanged |
| 29 | G0029 | set+discrim | string set {'aborted', 'done', 'failed', 'skipped'} as array/Set/or-chain/table… | 2/8/10 | unchanged |
| 31 | G0031 | cmp | repeated comparison status == 'queued' | 2/5/6 | unchanged |
| 32 | G0032 | contract | text contract heading: what ci did not prove | 2/6/8 | unchanged |
| 38 | G0038 | cmp | repeated comparison marker == 'pending' | 1/5/11 | unchanged |
| 47 | G0047 | clone | tiny rule copied as a helper clear(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| 50 | G0050 | cmp | repeated comparison disposition == 'resumable' | 2/4/8 | unchanged |
| 53 | G0053 | record | record assembled from the same sources {id=ID.id, title=ID.title, labels=Logica… | 2/3/3 | unchanged |
| 54 | G0054 | contract | text contract marker: [db-indexes] | 2/2/9 | unchanged |
| 56 | G0056 | clone | near-duplicate function clear() (also: clearHistory), ~7 statements, fuzzy | 1/4/4 | unchanged |
| 58 | G0058 | cmp | repeated comparison provider == 'github' | 2/2/3 | unchanged |
| 59 | G0059 | cmp | repeated comparison provider == 'github-projects' | 2/2/2 | unchanged |
| 61 | G0061 | cmp | repeated comparison state == 'record' | 2/3/3 | unchanged |
| 62 | G0062 | contract | text contract marker: [dispatch] | 2/3/4 | unchanged |
| 63 | G0063 | record | literal record repeated verbatim {effort=null, harness=null, model=null} | 2/2/2 | unchanged |
| 64 | G0064 | const | named constant TOKEN_REFRESH_BUFFER_MS=300000 | 2/2/2 | unchanged |
| 65 | G0065 | cmp | repeated comparison rawTeam == 'all' | 2/2/2 | unchanged |
| 66 | G0066 | set | string set {'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'} … | 2/2/2 | unchanged |
| 67 | G0067 | cmp | repeated comparison getAttribute() == 'true' | 1/4/7 | unchanged |
| 68 | G0068 | contract | text contract marker: [ci-wake-sweep] | 2/2/5 | unchanged |
| 69 | G0069 | contract | text contract marker: [liveness-alarm-sweep] | 2/2/2 | unchanged |
| 70 | G0070 | cmp | repeated comparison kind == 'more-of-parent' | 2/2/3 | unchanged |
| 71 | G0071 | cmp | repeated comparison kind == 'search' | 2/2/2 | unchanged |
| 72 | G0072 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, ac… | 2/2/2 | unchanged |
| 73 | G0073 | cmp | repeated comparison kind == 'capture' | 2/2/2 | unchanged |
| 74 | G0074 | cmp | repeated comparison urlKey == 'test-workspace' | 2/2/6 | unchanged |
| 75 | G0075 | record | record assembled from the same sources {githubEnabled=getProvider().entryCta.is… | 2/2/2 | unchanged |
| 76 | G0076 | cmp | repeated comparison via == 'proxy' | 2/2/3 | unchanged |
| 77 | G0077 | cmp | repeated comparison finishReason == 'length' | 2/5/7 | unchanged |
| 78 | G0078 | set+discrim | string set {'decision-answer', 'decision-withdrawal-reversed', 'decision-withdr… | 2/5/5 | unchanged |
| 79 | G0079 | cmp | repeated comparison target == 'web' | 2/4/5 | unchanged |
| 80 | G0080 | set+discrim | string set {'github', 'github-projects'} as Set/array/or-chain [REMINT_KINDS, I… | 2/6/6 | unchanged |
| 82 | G0082 | const | named constant CONTEXT_FETCH_TIMEOUT_MS=45000 | 2/2/2 | unchanged |
| 85 | G0085 | cmp | repeated comparison subscription == 'none' | 1/3/3 | unchanged |
| 86 | G0086 | clone | tiny rule copied as a helper bump() (also: touchAndEvict, noteCredential), 3 co… | 2/3/3 | unchanged |
| 87 | G0087 | contract | text contract marker: [aborted] | 2/3/9 | unchanged |
| 88 | G0088 | cmp | repeated comparison source == 'free' | 2/3/3 | unchanged |
| 89 | G0089 | cmp | repeated comparison kind == 'decision' | 1/4/6 | unchanged |
| 90 | G0090 | const | named constant DANGEROUS_CHARS_REGEX=/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ | 2/4/4 | unchanged |
| 91 | G0091 | const | named constant MAX_NAME_LENGTH=1000 | 2/4/4 | unchanged |
| 94 | G0094 | cmp | repeated comparison mode == 'add-source' | 2/6/28 | unchanged |
| 95 | G0095 | clone | tiny rule copied as a helper onEvent() (also: (anonymous)), 5 copies of 1-4 sta… | 2/4/5 | unchanged |
| 99 | G0099 | clone | tiny rule copied as a helper buildPromptFilename(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 100 | G0100 | set | string set {'autopilot', 'blind-read', 'blocked', 'breakdown', 'bug', 'close-ou… | 2/3/3 | new |
| 103 | G0103 | clone | near-duplicate function (anonymous)() (also: relayDispatchRefusal), ~10 stateme… | 2/2/2 | unchanged |
| 104 | G0104 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 105 | G0105 | clone | near-duplicate function clear(), ~7 statements, structurally identical | 2/8/8 | unchanged |
| 106 | G0106 | cmp | repeated comparison readyState == 'loading' | 1/4/4 | unchanged |
| 108 | G0108 | cmp | repeated comparison toLowerCase() == 'bug' | 2/3/3 | unchanged |
| 109 | G0109 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| 110 | G0110 | cmp | repeated comparison phase == 'proposed' | 2/4/5 | unchanged |
| 113 | G0113 | contract | text contract heading: workflow | 1/3/15 | grown |
| 114 | G0114 | discrim | string set {'1', 'true'} as or-chain [ID.query.cachedOnly, ID.query.noDescend, … | 2/3/6 | unchanged |
| 117 | G0117 | cmp | repeated comparison name == 'list_pending_decisions' | 2/3/3 | unchanged |
| 120 | G0120 | cmp | repeated comparison tagName == 'SELECT' | 1/3/3 | unchanged |
| 121 | G0121 | cmp | repeated comparison kind == 'close-out' | 2/4/4 | grown |
| 123 | G0123 | set+discrim | string set {'done', 'failed'} as or-chain/table-keys [ID.terminalStatus, PILL_G… | 2/3/3 | unchanged |
| 124 | G0124 | cmp | repeated comparison kind == 'periodical' | 2/3/3 | unchanged |
| 125 | G0125 | cmp | repeated comparison value == 'true' | 2/3/3 | unchanged |
| 126 | G0126 | cmp | repeated comparison state == 'closed' | 2/5/5 | unchanged |
| 127 | G0127 | cmp | repeated comparison id == '__periodicals__' | 2/4/5 | unchanged |
| 128 | G0128 | clone | tiny rule copied as a helper enqueueGuard() (also: haltRefusal), 3 copies of 1-… | 1/3/3 | unchanged |
| 130 | G0130 | cmp | repeated comparison kind == 'recap' | 2/2/3 | unchanged |
| 135 | G0135 | record | record assembled from the same sources {urlKey=ID.urlKey, identifier=ID.identif… | 1/3/3 | unchanged |
| 136 | G0136 | clone | tiny rule copied as a helper header() (also: setupNoticeHtml), 3 copies of 1-4 … | 1/3/3 | unchanged |
| 139 | G0139 | cmp | repeated comparison section == 'prompt' | 2/2/2 | unchanged |
| 140 | G0140 | cmp | repeated comparison section == 'reasoning' | 2/2/2 | unchanged |
| 143 | G0143 | contract | text contract marker: [pending] | 2/2/4 | unchanged |
| 144 | G0144 | set | string set {'backlog', 'done', 'failed', 'in-progress', 'todo'} as table-keys [… | 2/3/3 | unchanged |
| 145 | G0145 | cmp | repeated comparison section == 'recent-activity' | 2/3/5 | unchanged |
| 148 | G0148 | record | record assembled from the same sources {urlKey=ID.urlKey, workspaceId=ID.id, ow… | 2/3/3 | unchanged |
| 149 | G0149 | cmp | repeated comparison agentState == 'queued' | 2/3/4 | unchanged |
| 153 | G0153 | cmp | repeated comparison kind == 'bootstrap' | 2/3/9 | unchanged |
| 154 | G0154 | const | named constant HOUR_MS=3600000 | 2/4/4 | unchanged |
| 160 | G0160 | const | named constant COMPANION_INSTANCE_PREFIX="companion:v1:" | 2/3/3 | unchanged |
| 161 | G0161 | cmp | repeated comparison phase == 'error' | 2/3/3 | unchanged |
| 162 | G0162 | cmp | repeated comparison state == 'open' | 2/5/6 | unchanged |
| 163 | G0163 | set+discrim | string set {'complete', 'error'} as Set/or-chain [LOOP_TERMINAL_AGENT_STATES, T… | 2/3/4 | unchanged |
| 165 | G0165 | cmp | repeated comparison protocol == 'https:' | 2/2/2 | unchanged |
| 169 | G0169 | clone | tiny rule copied as a helper (anonymous)(), 5 copies of 1-4 statements | 1/3/5 | unchanged |
| 176 | G0176 | clone | tiny rule copied as a helper constructor(), 6 copies of 1-4 statements | 2/6/6 | unchanged |
| 178 | G0178 | clone | tiny rule copied as a helper msSince() (also: (anonymous)), 3 copies of 1-4 sta… | 2/3/3 | unchanged |
| 179 | G0179 | record | record assembled from the same sources {runs=ID.runs, priced=ID.priced, unprice… | 2/2/2 | unchanged |
| 181 | G0181 | clone | tiny rule copied as a helper (anonymous)(), 6 copies of 1-4 statements | 1/4/6 | unchanged |
| 183 | G0183 | set+discrim | string set {'http:', 'https:'} as array/or-chain [[...].includes, ID.protocol] | 2/4/4 | unchanged |
| 184 | G0184 | const | named constant POLL_MS=5000 | 1/3/3 | unchanged |
| 185 | G0185 | contract | text contract marker: [working] | 2/3/3 | unchanged |
| 187 | G0187 | cmp | repeated comparison kind == 'brief' | 2/3/4 | unchanged |
| 188 | G0188 | cmp | repeated comparison source == 'live' | 1/3/4 | unchanged |
| 189 | G0189 | cmp | repeated comparison status == 'aborted' | 1/3/11 | unchanged |
| 190 | G0190 | cmp | repeated comparison turnKind == 'boot' | 2/3/18 | unchanged |
| 193 | G0193 | cmp | repeated comparison code == 'OUTPUT_TRUNCATED' | 2/3/3 | unchanged |
| 197 | G0197 | clone | near-duplicate function relativeTime() (also: renderDeployInfo), ~22 statements… | 2/2/2 | unchanged |
| 198 | G0198 | cmp | repeated comparison disposition == 'gone' | 2/2/5 | unchanged |
| 199 | G0199 | cmp | repeated comparison state == 'unknown' | 2/3/5 | unchanged |
| 200 | G0200 | cmp | repeated comparison status == 'merged' | 2/3/4 | unchanged |
| 201 | G0201 | clone | near-duplicate function groupLoopsByLineage() (also: runsByLineage), ~10 statem… | 2/2/2 | unchanged |
| 202 | G0202 | record | record assembled from the same sources {urlKey=ID.proxyUrlKey, createdBy=ID.pro… | 2/2/2 | unchanged |
| 203 | G0203 | record | literal record repeated verbatim {label="__ai__", name=null, why="Generate the … | 2/2/2 | unchanged |
| 204 | G0204 | clone | near-duplicate function firstPromptLine() (also: toStackHeadline), ~6 statement… | 2/2/2 | unchanged |
| 205 | G0205 | cmp | repeated comparison rung == 'run-task' | 2/2/2 | unchanged |
| 206 | G0206 | set | string set {'done', 'next-step', 'pr'} as array | 2/2/2 | unchanged |
| 207 | G0207 | discrim | string set {'done', 'pr'} as or-chain [ID.filledRung, ID()] | 2/2/3 | unchanged |
| 208 | G0208 | set | string set {'canceled', 'completed', 'duplicate'} as array [TERMINAL_TYPES] | 2/2/2 | unchanged |
| 209 | G0209 | clone | near-duplicate function computeFitZoom(), ~11 statements, same vocabulary (dial… | 2/2/2 | unchanged |
| 212 | G0212 | clone | near-duplicate function (anonymous)(), ~7 statements, same vocabulary (dialect … | 2/2/2 | unchanged |
| 213 | G0213 | clone | near-duplicate function clampTimelineWindow() (also: clampWindow), ~12 statemen… | 2/2/2 | unchanged |
| 214 | G0214 | clone | near-duplicate function computeTimelineFit(), ~10 statements, same vocabulary (… | 2/2/2 | unchanged |
| 215 | G0215 | clone | near-duplicate function computeTimelineZoom(), ~15 statements, same vocabulary … | 2/2/2 | unchanged |
| 216 | G0216 | clone | near-duplicate function renderChip(), ~8 statements, fuzzy | 2/2/2 | unchanged |
| 217 | G0217 | clone | near-duplicate function renderSegmentBar(), ~17 statements, fuzzy | 2/2/2 | unchanged |
| 218 | G0218 | clone | near-duplicate function renderStatusPill(), ~18 statements, fuzzy | 2/2/2 | unchanged |
| 219 | G0219 | clone | near-duplicate function renderSurface(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 220 | G0220 | clone | near-duplicate function renderTag(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 221 | G0221 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 1/3/3 | unchanged |
| 222 | G0222 | record | record assembled from the same sources {remaining=ID.remaining, limit=ID.limit} | 2/2/3 | unchanged |
| 224 | G0224 | clone | tiny rule copied as a helper ui(), 4 copies of 1-4 statements | 1/4/4 | unchanged |
| 225 | G0225 | cmp | repeated comparison status == 'skipped' | 2/3/3 | unchanged |
| 226 | G0226 | discrim | string set {'closed', 'multiple-prs', 'no-pr', 'not-ready'} as or-chain [ID.sta… | 2/3/3 | unchanged |
| 229 | G0229 | clone | tiny rule copied as a helper buildBriefMessages() (also: buildRoadmapGapMessage… | 2/8/8 | unchanged |
| 234 | G0234 | set | string set {'cli', 'web'} as Set/array [RESUMABLE_TARGETS] | 1/3/3 | unchanged |
| 235 | G0235 | contract | text contract marker: [usage] | 1/3/4 | unchanged |
| 237 | G0237 | const | named constant MAX_IDENTIFIER_LENGTH=100 | 2/2/2 | unchanged |
| 238 | G0238 | cmp | repeated comparison mergedBy == 'close-out' | 2/2/2 | unchanged |
| 239 | G0239 | cmp | repeated comparison built == 'unknown' | 2/2/2 | unchanged |
| 241 | G0241 | cmp | repeated comparison reason == 'free-tier' | 2/2/3 | unchanged |
| 242 | G0242 | cmp | repeated comparison status == 'proposed' | 2/2/2 | unchanged |
| 243 | G0243 | cmp | repeated comparison tierOf() == 'deferred' | 2/2/3 | unchanged |
| 247 | G0247 | set | string set {'cdn.linear.app', 'linear.app', 'uploads.linear.app'} as Set [LINEA… | 2/2/2 | unchanged |
| 248 | G0248 | set+discrim | string set {'home-up-next', 'in-progress', 'project', 'recent-activity'} as or-… | 2/2/2 | unchanged |
| 249 | G0249 | set | string set {'High', 'Low', 'Medium', 'No priority', 'Urgent'} as array [PRIORIT… | 2/2/2 | unchanged |
| 250 | G0250 | clone | tiny rule copied as a helper (anonymous)(), 4 copies of 1-4 statements | 2/3/4 | unchanged |
| 251 | G0251 | cmp | repeated comparison pageMode == 'backlog' | 2/2/2 | unchanged |
| 252 | G0252 | cmp | repeated comparison singleUse == 'true' | 2/2/2 | unchanged |
| 253 | G0253 | clone | tiny rule copied as a helper countFor() (also: lookupsFor), 3 copies of 1-4 sta… | 2/3/3 | unchanged |
| 254 | G0254 | const | named constant ARCHIVE_PAGE_SIZE=30 | 2/2/2 | unchanged |
| 255 | G0255 | const | named constant STALE_AFTER_MS=86400000 | 2/2/2 | unchanged |
| 256 | G0256 | clone | near-duplicate function (anonymous)(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| 257 | G0257 | record | record assembled from the same sources {promptMeta=ID.promptMeta, defaultPrompt… | 2/2/2 | unchanged |
| 258 | G0258 | cmp | repeated comparison status == 'priced' | 2/2/3 | unchanged |
| 259 | G0259 | cmp | repeated comparison view == 'sessions' | 2/2/2 | unchanged |
| 261 | G0261 | record | literal record repeated verbatim {lastCensusSnapshot=null, lastCensusStateHash=… | 2/2/2 | unchanged |
| 263 | G0263 | cmp | repeated comparison openRouterSource == 'free' | 2/3/3 | unchanged |
| 265 | G0265 | cmp | repeated comparison format == 'md' | 2/2/2 | unchanged |
| 266 | G0266 | cmp | repeated comparison turnKind == 'auto-wake' | 2/2/5 | unchanged |
| 269 | G0269 | cmp | repeated comparison by == 'close-out' | 2/2/2 | unchanged |
| 274 | G0274 | clone | tiny rule copied as a helper isId() (also: shortString, (anonymous), isSafeSing… | 1/4/6 | unchanged |
| 277 | G0277 | cmp | repeated comparison view == 'digest' | 2/2/2 | unchanged |
| 281 | G0281 | discrim | string set {'gone', 'resumable', 'task-bound'} as or-chain | 2/2/2 | unchanged |
| 282 | G0282 | cmp | repeated comparison verdict == 'approve' | 1/3/3 | unchanged |
| 283 | G0283 | record | literal record repeated verbatim {effort="none", harness="none", model="none"} | 2/2/2 | unchanged |
| 285 | G0285 | cmp | repeated comparison category == 'upstream' | 2/2/2 | unchanged |
| 286 | G0286 | cmp | repeated comparison state == 'none' | 2/2/2 | unchanged |
| 287 | G0287 | cmp | repeated comparison viewer == 'owner' | 2/2/3 | unchanged |
| 288 | G0288 | discrim | string set {'comment', 'description'} as ternary-chain/or-chain [ID.where] | 2/2/2 | unchanged |
| 289 | G0289 | clone | near-duplicate function deleteByConnection() (also: deleteUserPreferences, dele… | 1/3/3 | unchanged |
| 293 | G0293 | cmp | repeated comparison state == 'dead' | 2/2/3 | unchanged |
| 296 | G0296 | clone | near-duplicate function listForWorkspaces() (also: listUnansweredForWorkspaces)… | 1/3/3 | unchanged |
| 297 | G0297 | discrim | string set {'answered', 'dismissed'} as or-chain [ID.outcome] | 2/4/7 | unchanged |
| 300 | G0300 | cmp | repeated comparison tier == 'not reported' | 2/2/2 | unchanged |
| 301 | G0301 | cmp | repeated comparison outcome == 'dismissed' | 2/3/4 | unchanged |
| 306 | G0306 | cmp | repeated comparison mode == 'new' | 1/3/5 | unchanged |
| 307 | G0307 | cmp | repeated comparison status == 'fulfilled' | 2/4/6 | unchanged |
| 308 | G0308 | clone | near-duplicate function cleanup(), ~8 statements, fuzzy | 1/3/3 | unchanged |
| 309 | G0309 | cmp | repeated comparison deriveTerminalStatus() == 'done' | 1/3/3 | unchanged |
| 311 | G0311 | cmp | repeated comparison kind == 'backlog' | 2/2/2 | unchanged |
| 313 | G0313 | contract | text contract marker: [as-asked] | 2/2/10 | unchanged |
| 314 | G0314 | clone | near-duplicate function constructor(), ~5 statements, fuzzy | 1/3/3 | unchanged |
| 315 | G0315 | clone | tiny rule copied as a helper resolveCanonicalDegraded() (also: resolveCanonical… | 1/3/3 | unchanged |
| 324 | G0324 | cmp | repeated comparison state == 'reached' | 2/2/2 | unchanged |
| 327 | G0327 | set | string set {'acting', 'deciding', 'orienting', 'reporting', 'watching'} as arra… | 2/2/2 | unchanged |
| 329 | G0329 | set | string set {'blocked', 'queued', 'resolved', 'silent', 'terminal', 'unknown', +… | 2/3/3 | unchanged |
| 334 | G0334 | set | string set {'dispatch', 'record', 'resume'} as Set/table-keys [ON_ANSWER_EFFECT… | 2/2/2 | unchanged |
| 335 | G0335 | discrim | string set {'indeterminate', 'mid-turn'} as or-chain [ID.disposition] | 2/2/2 | unchanged |
| 338 | G0338 | cmp | repeated comparison kind == 'decision-withdrawn' | 2/2/2 | unchanged |
| 339 | G0339 | set | string set {'fable', 'haiku', 'opus', 'sonnet'} as array [CLAUDE_MAPPABLE_MODEL… | 2/2/3 | unchanged |
| 340 | G0340 | clone | near-duplicate function get(), ~7 statements, fuzzy | 2/6/6 | unchanged |
| 342 | G0342 | cmp | repeated comparison haltMode == 'pause' | 2/2/2 | unchanged |
| 343 | G0343 | cmp | repeated comparison haltMode == 'stop' | 2/2/2 | unchanged |
| 344 | G0344 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1, wo… | 2/2/2 | unchanged |
| 349 | G0349 | cmp | repeated comparison name == 'send_follow_up' | 2/2/3 | unchanged |
| 351 | G0351 | contract | text contract heading: adversarial second-read | 2/2/2 | unchanged |
| 352 | G0352 | cmp | repeated comparison role == 'owner' | 2/3/4 | unchanged |
| 356 | G0356 | cmp | repeated comparison role == 'user' | 2/3/6 | unchanged |
| 358 | G0358 | cmp | repeated comparison kind == 'review' | 2/2/2 | unchanged |
| 360 | G0360 | cmp | repeated comparison kind == 'plan' | 2/3/3 | unchanged |
| 363 | G0363 | contract | text contract heading: blind read | 2/2/4 | new |
| 364 | G0364 | const | named constant DAY_MS=86400000 | 2/2/2 | unchanged |
| 365 | G0365 | const | named constant MAX_REASON_LENGTH=500 | 2/2/2 | unchanged |
| 367 | G0367 | cmp | repeated comparison kind == 'blind-read' | 2/2/2 | new |
| 368 | G0368 | cmp | repeated comparison message == 'reverseOutcome: row is not self-resolved' | 2/2/2 | unchanged |
| 371 | G0371 | cmp | repeated comparison variant == 'standard' | 2/2/2 | unchanged |
| 372 | G0372 | set | string set {'inside', 'outside', 'total', 'unknown'} as array/table-keys [[...]… | 2/2/2 | unchanged |
| 374 | G0374 | clone | near-duplicate function _pruneToCapacity(), ~6 statements, fuzzy | 2/5/5 | unchanged |
| 375 | G0375 | clone | tiny rule copied as a helper clampText(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 381 | G0381 | contract | text contract heading: workspace api access (auto-appended) | 2/2/2 | unchanged |
| 387 | G0387 | cmp | repeated comparison code == 'ERR_FR_TOO_MANY_REDIRECTS' | 2/2/2 | unchanged |
| 388 | G0388 | cmp | repeated comparison message == 'unexpected redirect' | 2/2/2 | unchanged |
| 389 | G0389 | clone | near-duplicate function generateBrief() (also: generateFeedbackTitle, generateR… | 2/5/5 | unchanged |
| 392 | G0392 | const | named constant LANE_KEYS=[blocked,queued,resolved,silent,terminal,unknown,worki… | 2/2/2 | unchanged |
| 393 | G0393 | clone | near-duplicate function peakToolCount() (also: toolPeakOf), ~9 statements, fuzzy | 2/2/2 | unchanged |
| 397 | G0397 | set | string set {'/common-actions.css', '/escalation-kpis.css', '/style.css'} as arr… | 1/3/3 | unchanged |
| 399 | G0399 | clone | near-duplicate function listEvents() (also: listTraces), ~9 statements, fuzzy | 2/2/2 | unchanged |
| 400 | G0400 | cmp | repeated comparison completeness == 'complete' | 1/3/7 | grown |
| 401 | G0401 | cmp | repeated comparison kind == 'leftover' | 1/3/3 | grown |
| 405 | G0405 | cmp | repeated comparison s == 'complete' | 2/2/2 | unchanged |
| 407 | G0407 | record | literal record repeated verbatim {_id=0, createdAt=1, createdBy=1, urlKey=1} | 2/2/2 | unchanged |
| 408 | G0408 | const | named constant TIMELINE_WINDOW_MS=86400000 | 2/2/2 | unchanged |
| 410 | G0410 | record | record assembled from the same sources {urlKey=ID.urlKey, prUrl=ID.prUrl, headS… | 2/2/3 | unchanged |
| 411 | G0411 | set | string set {'autopilot', 'save', 'triage'} as table-keys/Set [SENDING_STATUS, D… | 2/2/3 | unchanged |
| 413 | G0413 | set+discrim | string set {'dark', 'light'} as array/or-chain [VALID_THEMES, ID.session.theme] | 2/2/2 | unchanged |
| 415 | G0415 | clone | tiny rule copied as a helper getAccount() (also: getById, getWorkspace, getWork… | 2/3/4 | unchanged |
| 416 | G0416 | const | named constant DEFAULT_HUMAN_NICK="John" | 2/2/2 | unchanged |
| 418 | G0418 | cmp | repeated comparison type == 'backlog' | 2/2/3 | unchanged |
| 419 | G0419 | set | string set {'first go', 'firstGo'} as array | 2/2/2 | unchanged |
| 420 | G0420 | set | string set {'login', 'signed up'} as array | 2/2/2 | unchanged |
| 421 | G0421 | set | string set {'merge clicked', 'mergeClicked'} as array | 2/2/2 | unchanged |
| 422 | G0422 | set | string set {'pr opened', 'prOpened'} as array | 2/2/2 | unchanged |
| 423 | G0423 | clone | near-duplicate function delete(), ~7 statements, fuzzy | 2/5/5 | unchanged |
| 424 | G0424 | cmp | repeated comparison trim() == '---' | 1/5/5 | unchanged |
| 425 | G0425 | clone | tiny rule copied as a helper get(), 5 copies of 1-4 statements | 2/5/5 | unchanged |
| 427 | G0427 | clone | near-duplicate function briefUrl() (also: recapUrl, scanUrl), ~6 statements, fu… | 1/3/3 | unchanged |
| 428 | G0428 | cmp | repeated comparison field == 'harness' | 2/3/3 | unchanged |
| 429 | G0429 | discrim | string set {'fresh', 'stale'} as if-chain [ID.status] | 1/3/4 | unchanged |
| 434 | G0434 | cmp | repeated comparison provider == 'email' | 2/2/2 | unchanged |
| 436 | G0436 | set+discrim | string set {'jira', 'linear'} as Set/or-chain [REFRESH_TOKEN_KINDS] | 2/2/2 | unchanged |
| 437 | G0437 | contract | text contract marker: [credential-adopted] | 2/2/3 | unchanged |
| 442 | G0442 | cmp | repeated comparison source == 'model' | 2/2/2 | unchanged |
| 443 | G0443 | cmp | repeated comparison source == 'workspace' | 2/2/2 | unchanged |
| 444 | G0444 | cmp | repeated comparison type == 'heading' | 2/2/2 | unchanged |
| 445 | G0445 | clone | tiny rule copied as a helper (anonymous)(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 447 | G0447 | clone | near-duplicate function formatFossilThreshold() (also: formatStaleThreshold), ~… | 2/2/2 | unchanged |
| 448 | G0448 | cmp | repeated comparison filter == 'set' | 2/2/2 | unchanged |
| 449 | G0449 | cmp | repeated comparison mode == 'resume' | 2/2/3 | unchanged |
| 450 | G0450 | cmp | repeated comparison stage == 'blind-read' | 2/2/2 | new |
| 452 | G0452 | clone | near-duplicate function list() (also: listByWorkspace), ~9 statements, fuzzy | 2/4/4 | unchanged |
| 453 | G0453 | contract | text contract marker: [string] | 2/3/4 | unchanged |
| 454 | G0454 | clone | tiny rule copied as a helper fetchBriefStatus() (also: fetchContext, fetchRecap… | 1/3/3 | unchanged |
| 455 | G0455 | cmp | repeated comparison act == 'copy' | 2/2/3 | unchanged |
| 458 | G0458 | cmp | repeated comparison scope == 'job' | 2/2/3 | unchanged |
| 463 | G0463 | clone | near-duplicate function get(), ~9 statements, structurally identical | 2/4/4 | unchanged |
| 464 | G0464 | clone | near-duplicate function orderByDependency(), ~59 statements, same vocabulary (d… | 2/4/4 | unchanged |
| 465 | G0465 | clone | tiny rule copied as a helper delete(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 466 | G0466 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 467 | G0467 | clone | tiny rule copied as a helper put(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 468 | G0468 | clone | near-duplicate function canonicalOf() (also: canonicalise), ~12 statements, str… | 2/2/2 | unchanged |
| 469 | G0469 | clone | near-duplicate function revokeByCreator() (also: revokeByOwner), ~9 statements,… | 2/2/2 | unchanged |
| 470 | G0470 | clone | near-duplicate function (anonymous)() (also: graphql, request), ~15 statements,… | 1/3/3 | unchanged |
| 471 | G0471 | clone | tiny rule copied as a helper (anonymous)() (also: isActive), 3 copies of 1-4 st… | 2/3/3 | unchanged |
| 472 | G0472 | clone | tiny rule copied as a helper _docsSorted() (also: _docsFor), 3 copies of 1-4 st… | 1/3/3 | unchanged |
| 473 | G0473 | clone | tiny rule copied as a helper sweepStale() (also: sweep, pruneTombstones), 3 cop… | 2/3/3 | new |
| 476 | G0476 | record | record assembled from the same sources {id=ID._id, by=ID.by, prUrl=ID.prUrl, he… | 2/2/2 | unchanged |
| 478 | G0478 | cmp | repeated comparison scope == 'default' | 2/2/2 | unchanged |
| 480 | G0480 | set | string set {'preset-save', 'undo'} as array [[...].includes] | 2/2/3 | unchanged |
| 481 | G0481 | const | named constant DUPLICATE_KEY_CODE=11000 | 2/2/2 | unchanged |
| 482 | G0482 | const | named constant FORMER_MEMBER="former member" | 2/2/2 | unchanged |
| 485 | G0485 | clone | near-duplicate function clusterSiblingsInLane() (also: computeShipReachableIds,… | 2/3/7 | unchanged |
| 486 | G0486 | cmp | repeated comparison field == 'model' | 2/3/3 | unchanged |
| 487 | G0487 | cmp | repeated comparison stateType == 'completed' | 2/3/3 | unchanged |
| 488 | G0488 | clone | tiny rule copied as a helper createDashboardDrilldownRoutes() (also: createDash… | 1/3/3 | unchanged |
| 489 | G0489 | clone | tiny rule copied as a helper union(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 491 | G0491 | set | string set {'halt', 'modelRoutingProxyWrites', 'periodicals'} as table-keys/arr… | 2/2/2 | unchanged |
| 492 | G0492 | set | string set {'none', 'pause', 'stop', 'unknown'} as table-keys [HALT_VALUE, HALT… | 2/2/2 | unchanged |
| 493 | G0493 | clone | tiny rule copied as a helper deleteAll(), 4 copies of 1-4 statements | 2/4/4 | unchanged |
| 494 | G0494 | clone | near-duplicate function buildPassagePlannerKickoff() (also: buildPassageRunnerK… | 1/3/3 | unchanged |
| 498 | G0498 | const | named constant PROJECTION_RISK_TYPES=Set[overdue,unestimated-critical,velocity-… | 2/2/2 | unchanged |
| 502 | G0502 | set | string set {'overdue', 'unestimated-critical', 'velocity-declining'} as Set [PR… | 2/2/2 | unchanged |
| 503 | G0503 | contract | text contract marker: [credential-rejected] | 2/2/2 | unchanged |
| 504 | G0504 | const | named constant REPO_RE=/^[A-Za-z0-9._-]{1,100}$/ | 2/2/2 | unchanged |
| 505 | G0505 | clone | near-duplicate function assignLanes(), ~32 statements, same vocabulary (dialect… | 2/2/2 | unchanged |
| 506 | G0506 | clone | near-duplicate function assignSegments(), ~21 statements, same vocabulary (dial… | 2/2/2 | unchanged |
| 507 | G0507 | clone | near-duplicate function buildChainLabel(), ~10 statements, same vocabulary (dia… | 2/2/2 | unchanged |
| 508 | G0508 | clone | near-duplicate function cohereSubtaskGroups(), ~39 statements, same vocabulary … | 2/2/2 | unchanged |
| 509 | G0509 | clone | near-duplicate function computeCrossLaneColumns(), ~108 statements, same vocabu… | 2/2/2 | unchanged |
| 510 | G0510 | clone | near-duplicate function groupByAssignee() (also: groupByProject), ~10 statement… | 2/2/4 | unchanged |
| 511 | G0511 | clone | near-duplicate function groupByStatus(), ~12 statements, same vocabulary (diale… | 2/2/2 | unchanged |
| 513 | G0513 | clone | near-duplicate function mergeLabels(), ~6 statements, fuzzy | 2/2/2 | unchanged |
| 514 | G0514 | clone | near-duplicate function mergeLanes(), ~9 statements, same vocabulary (dialect c… | 2/2/2 | unchanged |
| 518 | G0518 | cmp | repeated comparison grouping == 'dependency' | 2/2/4 | unchanged |
| 519 | G0519 | cmp | repeated comparison rawKey == 'duplicate' | 2/2/2 | unchanged |
| 522 | G0522 | set | string set {'/library.css', '/style.css'} as array [stylesheets] | 2/2/2 | unchanged |
| 523 | G0523 | discrim | string set {'assignee', 'dependency', 'project', 'status'} as switch | 2/2/2 | unchanged |
| 524 | G0524 | discrim | string set {'dependency', 'project'} as or-chain | 2/2/2 | unchanged |
| 525 | G0525 | discrim | string set {'implicit', 'label', 'state'} as switch [ID.type] | 2/2/2 | unchanged |
| 527 | G0527 | cmp | repeated comparison tone == 'bad' | 1/3/3 | unchanged |
| 528 | G0528 | clone | tiny rule copied as a helper toRecord(), 3 copies of 1-4 statements | 2/3/3 | unchanged |
| 529 | G0529 | const | named constant COMPLETED="completed" | 2/2/2 | new |
| 534 | G0534 | set | string set {'digest', 'gap', 'northStarReading', 'product', 'technical', 'traje… | 2/2/5 | unchanged |
| 541 | G0541 | cmp | repeated comparison orientation == 'vertical' | 2/2/6 | unchanged |
| 545 | G0545 | record | literal record repeated verbatim {AFT="aft", DRIFT="drift", FORWARD="forward", … | 2/2/2 | unchanged |
| 546 | G0546 | const | named constant MAX_CUSTOM_PRESETS=20 | 2/2/2 | unchanged |
| 547 | G0547 | const | named constant MAX_PRESET_NAME_LENGTH=50 | 2/2/2 | unchanged |
| 549 | G0549 | clone | near-duplicate function (anonymous)(), ~7 statements, fuzzy | 2/2/2 | unchanged |
| 550 | G0550 | clone | near-duplicate function bearingToAngle(), ~8 statements, structurally identical | 2/2/2 | unchanged |
| 551 | G0551 | clone | near-duplicate function buildSegments(), ~59 statements, same vocabulary (diale… | 2/2/2 | unchanged |
| 552 | G0552 | clone | near-duplicate function cardMatchesHeading(), ~13 statements, same vocabulary (… | 2/2/2 | unchanged |
| 553 | G0553 | clone | near-duplicate function clusterSubtaskSiblings(), ~35 statements, same vocabula… | 2/2/2 | unchanged |
| 554 | G0554 | clone | near-duplicate function computePosition(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 555 | G0555 | clone | near-duplicate function hash32(), ~11 statements, fuzzy | 2/2/2 | unchanged |
| 556 | G0556 | clone | near-duplicate function layoutIndex(), ~30 statements, same vocabulary (dialect… | 2/2/2 | unchanged |
| 557 | G0557 | clone | near-duplicate function list(), ~7 statements, structurally identical | 2/2/2 | unchanged |
| 558 | G0558 | clone | near-duplicate function orientationLayout(), ~57 statements, same vocabulary (d… | 2/2/2 | unchanged |
| 559 | G0559 | clone | near-duplicate function pickAngle(), ~10 statements, fuzzy | 2/2/2 | unchanged |
| 560 | G0560 | clone | near-duplicate function placeDriftBucket(), ~22 statements, fuzzy | 2/2/2 | unchanged |
| 561 | G0561 | clone | near-duplicate function placeSegmentBucket(), ~44 statements, same vocabulary (… | 2/2/2 | unchanged |
| 562 | G0562 | clone | near-duplicate function pushProjectSegments() (also: pushProjectSegs), ~8 state… | 2/2/2 | unchanged |
| 564 | G0564 | record | record assembled from the same sources {label=ID[].name, projectName=ID[].name,… | 2/2/2 | unchanged |
| 566 | G0566 | cmp | repeated comparison kind == 'label' | 2/2/3 | unchanged |
| 567 | G0567 | cmp | repeated comparison kind == 'project' | 2/2/3 | unchanged |
| 568 | G0568 | cmp | repeated comparison projectSector == 'port' | 2/2/2 | unchanged |
| 569 | G0569 | cmp | repeated comparison projectSector == 'starboard' | 2/2/2 | unchanged |
| 570 | G0570 | cmp | repeated comparison sector == 'drift' | 2/2/2 | unchanged |
| 571 | G0571 | cmp | repeated comparison sector == 'ship' | 2/2/2 | unchanged |
| 572 | G0572 | cmp | repeated comparison stateType == 'unstarted' | 2/2/2 | unchanged |
| 575 | G0575 | discrim | string set {'E', 'W'} as or-chain | 2/2/2 | unchanged |
| 576 | G0576 | set | string set {'orchestration', 'resumed', 'wake', 'work'} as table-keys/array [DI… | 2/2/2 | new |
| 577 | G0577 | discrim | string set {'resumed', 'wake'} as or-chain [ID.role] | 2/2/2 | new |
| 578 | G0578 | record | record assembled from the same sources {access_token=ID.access_token, refresh_t… | 2/2/2 | unchanged |
| 579 | G0579 | cmp | repeated comparison error == 'invalid_grant' | 2/2/2 | unchanged |
