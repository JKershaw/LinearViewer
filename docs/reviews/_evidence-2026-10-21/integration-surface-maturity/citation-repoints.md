# Citation re-points: run-3 line citations checked by content at the pin (LIN-3766, S-evidence step 4)

Pins: LinearViewer `c5694b68`, simple-dispatcher `bb1da78`. Run 3 wrote its cites against `b5c528c4` (LinearViewer) and `3b1e734` (simple-dispatcher). Every group below was checked by **content** (the claim, not the line number) by a fresh-context sub-agent, then the PASS anchors were re-verified mechanically.

## How the groups were derived and checked

- **Groups** are the unique `(path, line-ref)` pairs found by the C10 rules in the run-3 report (`rerun-outputs.md` Q28, Q29): strict `path.ext:N[-M][,…]` form (98 unique), bare `` `:N` `` form resolved by the paragraph rule (36 new), and the `server.js:633/700/730/757` slash form (3 new). **Total 137** (the plan's 143 does not reproduce; see Q29). The simple-dispatcher cites carry a `simple-dispatcher/` prefix or resolve only there.
- **Mechanism.** Three batches (46 / 46 / 45) went to three fresh-context sub-agents, each given the claim text from the run-3 report and the text the cite pointed at when written. Each returned only counts and its non-PASS rows and wrote its full rows to scratch.
- **Second pass (plan-review N7).** The plan's fallback clause named a second pass without describing one. Here it is: a script re-resolves every PASS row's new location at the pin and requires the sub-agent's verbatim anchor string to appear within ±3 lines of it. Result: 110 of 111 PASS rows verified mechanically; 1 (G83) matched at one of two locations and was read by hand (adjudication column). The orchestrator also reviewed every non-PASS row and the sub-agents' own flagged judgement calls, and overrode one verdict (G7).
- **Fallback trigger (split S-evidence out as its own subtask if non-PASS + UNRESOLVED exceeds about 40, or two passes disagree).** Not fired: non-PASS + UNRESOLVED = 27, and the two passes disagreed on 2 rows (G7, G83), both settled by reading the code.

## Counts

| View | PASS | REVERSED | RETIRED | UNRESOLVED | Total |
| -- | -- | -- | -- | -- | -- |
| Sub-agent verdicts as returned | 111 | 18 | 7 | 1 | 137 |
| **Final, after the two orchestrator adjustments (G7 override; G83 confirmed)** | **110** | **19** | **7** | **1** | **137** |
| Final, excluding 4 rule false positives (G72, G133, G134, G135: bare `:N` cites that point at report lines or duplicate another group, not code) | 110 | 19 | 4 | 0 | 133 |

The plan expected about 15 non-PASS plus UNRESOLVED rows and "98 re-point rows: 84 PASS / 11 REVERSED / 3 RETIRED". The groups here are not the same unit (137 groups, not 98 rows), so the figures are not like-for-like; the claim families they collapse into are in `summary.md`.

## Non-PASS rows

| G | Cite | Run-3 report lines | Final verdict | Sub-agent verdict | New location | Note | Adjudication |
| -- | -- | -- | -- | -- | -- | -- | -- |
| G2 | `LV:lib/dispatch-repo-guard.js:25` | L80, L284 | **RETIRED** | RETIRED | - | lib/dispatch-repo-guard.js and lib/workspace-repos.js deleted (LIN-3333 retired repo= lines); no knownWorkspaceRepos in code |  |
| G3 | `LV:lib/chat-tools.js:119` | L81, L284 | **RETIRED** | RETIRED | - | knownWorkspaceRepos import gone; workspace-repos.js deleted, no production importers remain |  |
| G7 | `LV:routes/proxy-writes.js:341` | L147, L694 | **REVERSED** | PASS | LV:routes/proxy-writes.js:429-429 | gated PATCH state-setting route | Orchestrator override of the sub-agent's PASS. The cite re-points (`proxy-writes.js:341` is now `:429`), but the claim text "Exactly two routes can set a state on an issue" is false at the pin: 3 update-path writers (1 gated) plus 2 ungated create routes (`rerun-outputs.md` Q15, Q16, Q17). This is the R7 widening, not a re-point. |
| G17 | `LV:lib/free-tier-store.js:148-149` | L192, L626 | **REVERSED** | REVERSED | LV:lib/free-tier-store.js:149 | Key bug fixed (LIN-689): tryUse uses _getGlobalHourKey (global:hour) for read and write, defined :97-99 |  |
| G18 | `LV:lib/free-tier-store.js:197-199` | L193, L626 | **REVERSED** | REVERSED | LV:lib/free-tier-store.js:225 | No double prefix now; recordUsage uses _getGlobalHourKey(hour), same key as tryUse :149 |  |
| G25 | `LV:lib/free-tier-store.js:148-149,197-198` | L202, L702 | **REVERSED** | REVERSED | LV:lib/free-tier-store.js:97-99 | Double-prefixed key fixed by shared _getGlobalHourKey; tryUse :149 and recordUsage :225 use it |  |
| G40 | `LV:lib/proxy-instructions.js:624,845` | L251 | **REVERSED** | REVERSED | LV:lib/proxy-instructions.js:645,882 | Text now says the runner honors a set halt; no longer says it does not |  |
| G41 | `LV:public/dispatch.js:757,788` | L251 | **REVERSED** | REVERSED | LV:public/dispatch.js:768-773 | Comment now says runner honours stored halt (LIN-2995 runner.mjs haltAction), on next poll; no pending LIN-2995 |  |
| G42 | `LV:routes/proxy-halt.js:9,104` | L251 | **REVERSED** | REVERSED | LV:routes/proxy-halt.js:8-9 | Header now says the runner honours the stored halt (pause leaves fresh items, stop sweeps) |  |
| G43 | `LV:server.js:633` | L269 | **REVERSED** | REVERSED | LV:server.js:801 | observer-sweep still registered but scheduler now registers 7 jobs (801 868 898 928 948 980 1009), not four |  |
| G44 | `LV:server.js:700` | L269 | **REVERSED** | REVERSED | LV:server.js:868 | observer-pass moved; total now 7 jobs not four |  |
| G45 | `LV:server.js:730` | L269 | **REVERSED** | REVERSED | LV:server.js:898 | credential-invariant-sweep moved; total now 7 jobs not four |  |
| G46 | `LV:server.js:757` | L269 | **REVERSED** | REVERSED | LV:server.js:928 | pricing-conformance-sweep moved; total now 7 jobs not four |  |
| G56 | `LV:lib/pipeline-loops.js:808` | L336 | **RETIRED** | RETIRED | n/a | LIN-2187 comment removed from lib/pipeline-loops.js; only tests/unit/pipeline-loops.test.js:2112 refs remain |  |
| G65 | `LV:routes/proxy.js:20-30` | L396, L612 | **REVERSED** | REVERSED | LV:routes/proxy.js:1277-1611 | now 14 sub-routers mounted (added alarm, runner-prompt, runner), not 11 |  |
| G72 | `LV:routes/proxy.js:9,104` | L406 | **UNRESOLVED** | UNRESOLVED | n/a | old cite pointed at a header comment; unclear what :9,104 referred to (maybe proxy-halt.js); no verifiable target | Rule false positive, not a code gap: the bare `:9,104` in the run-3 table row for `routes/proxy-halt.js` (line 406) resolved to the nearest preceding path `routes/proxy.js:1553`; the cite belongs to `routes/proxy-halt.js` and is the same cite as G42. Counted as one of the script's groups, not as an independent claim. |
| G73 | `LV:routes/proxy.js:1570` | L407 | **REVERSED** | REVERSED | LV:routes/proxy.js:1577-1578 | mount holds, but proxy-kickoff.js no longer imports consumer-poll-warning (now via lib/dispatch-entrance.js:63) |  |
| G74 | `LV:routes/proxy.js:1328` | L408 | **REVERSED** | REVERSED | LV:routes/proxy.js:1332-1333 | mount holds, but proxy-reads.js no longer imports dispatch-repo-guard (none in routes/) |  |
| G86 | `LV:tests/e2e/dispatch-halt.spec.js:124` | L668 | **RETIRED** | RETIRED | n/a | the toContainText('LIN-2995') assertion is gone; spec now only has Stop requested checks (:126) |  |
| G87 | `LV:tests/unit/render-dispatch-exec-controls.test.js:43` | L668 | **REVERSED** | REVERSED | LV:tests/unit/render-dispatch-exec-controls.test.js:42-53 | test now asserts guide-halt-note no longer carries stale pending-LIN-2995 claim |  |
| G88 | `LV:docs/runbooks/harbour-degraded.md:60` | L669 | **REVERSED** | REVERSED | LV:docs/runbooks/harbour-degraded.md:62 | now reads "stop flows abort -> error" with no "once LIN-2995 lands" |  |
| G89 | `LV:docs/runbooks/harbour-degraded.md:7` | L671 | **REVERSED** | REVERSED | LV:docs/runbooks/harbour-degraded.md:5-6 | now says the runner honors the halt on its next poll; no pending LIN-2995 |  |
| G90 | `LV:docs/dispatch-integration.md:130` | L672 | **REVERSED** | REVERSED | LV:docs/dispatch-integration.md:137 | now says "The runner honors it"; no pending LIN-2995 |  |
| G131 | `LV:docs/reviews/integration-surface-maturity-review-2026-09-26.md:592` | L793 | **REVERSED** | REVERSED | docs/reviews/integration-surface-maturity-review-2026-09-26.md:630 | report now has the WITHDRAW delta (lines 30, 382-388, 630 flow-operator-decisions row), so it is no longer silent | Historical narrative, not a code cite: run 3's Adversarial Second-Read quotes the state of its own draft ("The report is silent"). The run-3 report was fixed afterwards, so the quoted state no longer exists. Nothing to re-point. |
| G133 | `SD:dispatcher.js:229-230` | L801 | **RETIRED** | RETIRED |  | cite is a line number inside a review report, mis-resolved to unrelated EXECUTING comment; at bb1da78 dispatcher.js and halt.js have no withdraw wiring (hook.js, reapers.js do) | Rule false positive: bare `:229-230` in run 3's Second-Read cites lines of the run-3 report (its R10), not code, and resolved to `dispatcher.js`. Not a code cite. |
| G134 | `LV:routes/proxy-rulings.js:228` | L801 | **RETIRED** | RETIRED |  | cite is a line in run-2 report, not code; mis-resolved | Rule false positive: bare `:228` cites a line of the run-2 report, not code; resolved to `routes/proxy-rulings.js`. Not a code cite. |
| G135 | `LV:routes/proxy-rulings.js:24-26` | L801 | **RETIRED** | RETIRED |  | cite is the report own lines 24-26, not code; mis-resolved | Rule false positive: bare `:24-26` cites the run-3 report's own lines, not code; resolved to `routes/proxy-rulings.js`. Not a code cite. |

### PASS rows that carry an adjudication note

- **G83** `LV:lib/prompt-template-defs.js:1043,1202`: Second-pass anchor check matched only `:1102` for the literal anchor. Read by hand: `lib/prompt-template-defs.js:969` carries the same includeResolved / no-re-raise contract in different words ("Before raising a `DECISION:` on a finding, check it is not already covered (LIN-2991/LIN-3022)"), so both locations hold.
- **G108** `LV:CLAUDE.md:126`: Re-pointed to `docs/architecture/source-map.md:143` (run 3 said `:108`). The parenthetical in the run-3 row is also stale: `CLAUDE.md` is 110 lines at the pin, not 106.

## All 137 groups

`New location` is where the claim lives at the pin; the anchor is a verbatim string within ±3 lines of it (machine-verified for PASS rows).

| G | Cite (repo:path:ref) | Forms | Run-3 report lines | Verdict | New location | Anchor |
| -- | -- | -- | -- | -- | -- | -- |
| G1 | `LV:lib/periodical-runs.js:147-148` | bare+strict | L79, L718 | PASS | LV:lib/periodical-runs.js:137-138 | function _laneKey(row) { |
| G2 | `LV:lib/dispatch-repo-guard.js:25` | strict | L80, L284 | RETIRED | - | - |
| G3 | `LV:lib/chat-tools.js:119` | strict | L81, L284 | RETIRED | - | - |
| G4 | `SD:halt.js:219` | strict | L91, L247, L349 | PASS | SD:halt.js:223-223 | function resolveEffectiveHalt({ harbourHaltByToken |
| G5 | `LV:routes/proxy-writes.js:309` | bare+strict | L100, L152, L695 | PASS | LV:routes/proxy-writes.js:374-374 | const gate = checkPeriodicalReportGate({ |
| G6 | `LV:routes/workspace-api.js:4111` | bare+strict | L101, L142, L149, L693 | PASS | LV:routes/workspace-api.js:3410-3410 | router.patch('/workspace/:urlKey/api/issues/:issueId' |
| G7 | `LV:routes/proxy-writes.js:341` | strict | L147, L694 | REVERSED | LV:routes/proxy-writes.js:429-429 | provider.updateIssue(token, issueId, input) |
| G8 | `LV:routes/proxy.js:3487` | strict | L148, L694 | PASS | LV:routes/proxy-writes.js:429-429 | provider.updateIssue(token, issueId, input) |
| G9 | `LV:routes/proxy-writes.js:22` | strict | L151, L695, L716 | PASS | LV:routes/proxy-writes.js:46-47 | import { checkPeriodicalReportGate } from |
| G10 | `LV:routes/proxy-writes.js:300` | bare | L151 | PASS | LV:routes/proxy-writes.js:366-366 | if (!extractPeriodicalGateId(guard?.description)) |
| G11 | `LV:routes/proxy-writes.js:300-341` | bare | L151, L695 | PASS | LV:routes/proxy-writes.js:359-380 | async function refusedByPeriodicalGate |
| G12 | `LV:routes/workspace-api.js:4173` | bare | L153, L693 | PASS | LV:routes/workspace-api.js:3451-3451 | if (stateRef) input.stateId = await resolveIssueStateRef |
| G13 | `LV:routes/workspace-api.js:4180` | bare | L153, L693 | PASS | LV:routes/workspace-api.js:3455-3455 | await provider.updateIssue(token, issueId, input) |
| G14 | `LV:public/llms.txt:97` | bare+strict | L155, L156, L697 | PASS | LV:public/llms.txt:111-111 | [data-testid="issue-edit-link"] |
| G15 | `LV:public/task-edit.js:91` | strict | L155, L696 | PASS | LV:public/task-edit.js:93-93 | var patchUrl = '/workspace/' |
| G16 | `LV:routes/workspace-api.js:4164` | bare+strict | L159, L693 | PASS | LV:routes/workspace-api.js:3443-3443 | const guard = await provider.issueWriteGuard(token, issueId); |
| G17 | `LV:lib/free-tier-store.js:148-149` | bare | L192, L626 | REVERSED | LV:lib/free-tier-store.js:149 | - |
| G18 | `LV:lib/free-tier-store.js:197-199` | bare | L193, L626 | REVERSED | LV:lib/free-tier-store.js:225 | - |
| G19 | `LV:routes/test.js:988` | bare+strict | L194, L701 | PASS | LV:routes/test.js:1216-1216 | await freeTierStore.recordUsage(urlKey) |
| G20 | `LV:lib/chat-request.js:54` | bare | L195, L358, L436 | PASS | LV:lib/chat-request.js:172-172 | export function resolveChatCredential({ sessionApiKey }) |
| G21 | `LV:lib/chat-request.js:80` | bare+strict | L195, L358, L436, L626 | PASS | LV:lib/chat-request.js:213-213 | export async function checkFreeTierGate({ isFreeTier |
| G22 | `LV:routes/ship-biscuit.js:194` | bare+strict | L196, L699 | PASS | LV:routes/ship-biscuit.js:186-186 | const check = await checkFreeTierGate({ isFreeTier |
| G23 | `LV:routes/workspace-api-roadmap.js:338` | bare+strict | L197, L700 | PASS | LV:routes/workspace-api-roadmap.js:313-313 | return freeTierStore.tryUse(req.workspace.urlKey); |
| G24 | `LV:routes/workspace-api-roadmap.js:828` | bare+strict | L197, L700 | PASS | LV:routes/workspace-api-roadmap.js:803-803 | const gate = await checkFreeTierGate({ isFreeTier |
| G25 | `LV:lib/free-tier-store.js:148-149,197-198` | strict | L202, L702 | REVERSED | LV:lib/free-tier-store.js:97-99 | - |
| G26 | `LV:lib/dispatch-store.js:843-871` | bare+strict | L209, L620, L703 | PASS | LV:lib/dispatch-store.js:948-974 | async cleanup() { |
| G27 | `LV:lib/dispatch-store.js:849` | bare | L210, L703 | PASS | LV:lib/dispatch-store.js:955-957 | const expired = await this.collection.find({ |
| G28 | `LV:lib/dispatch-store.js:869` | bare | L210, L703 | PASS | LV:lib/dispatch-store.js:966-968 | const result = await this.collection.deleteMany({ |
| G29 | `LV:lib/render.js:505,524` | bare+strict | L226, L705 | PASS | LV:lib/render.js:437,453 | periodicalId: id, |
| G30 | `LV:routes/dispatch.js:277` | bare+strict | L227, L706 | PASS | LV:lib/dispatch-entrance.js:1111-1111 | const { prompt, kind, periodicalId, attachProxy |
| G31 | `LV:routes/dispatch.js:615` | bare | L227, L706 | PASS | LV:lib/dispatch-entrance.js:371-371 | periodicalId: (r) => r.periodicalId |
| G32 | `LV:lib/dispatch-store.js:1740` | bare+strict | L228, L707 | PASS | LV:lib/dispatch-store.js:2083-2083 | Object.assign(item, normalizeRunFields(doc)); |
| G33 | `LV:lib/dispatch-store.js:2563` | bare | L228, L707 | PASS | LV:lib/dispatch-store.js:3033-3033 | Object.assign(item, normalizeRunFields(doc)); |
| G34 | `LV:routes/proxy-dispatch.js:56-133` | strict | L230, L708 | PASS | LV:routes/proxy-dispatch.js:118-198 | function formatDispatchWatch(item, meta = null |
| G35 | `LV:routes/proxy-dispatch.js:90` | bare | L231, L708 | PASS | LV:routes/proxy-dispatch.js:150-150 | repo: item.repo |
| G36 | `LV:routes/proxy-dispatch.js:92-97` | bare+strict | L232, L719 | PASS | LV:routes/proxy-dispatch.js:152-158 | Attribution (LIN-1948, fix 3b) |
| G37 | `LV:routes/proxy.js:600-605` | strict | L232, L719 | PASS | LV:routes/proxy-dispatch.js:152-158 | dispatchedBy: item.dispatchedBy |
| G38 | `LV:lib/dispatch-store.js:134-142` | bare+strict | L233, L709 | PASS | LV:lib/dispatch-store.js:104-114 | export const PERIODICAL_PROJECTION = { |
| G39 | `SD:dispatcher.js:31,1470-1503` | strict | L246, L664 | PASS | SD:dispatcher.js:1618-1628 | resolveEffectiveHalt: resolveEffectiveHaltDep |
| G40 | `LV:lib/proxy-instructions.js:624,845` | strict | L251 | REVERSED | LV:lib/proxy-instructions.js:645,882 | - |
| G41 | `LV:public/dispatch.js:757,788` | strict | L251 | REVERSED | LV:public/dispatch.js:768-773 | - |
| G42 | `LV:routes/proxy-halt.js:9,104` | strict | L251 | REVERSED | LV:routes/proxy-halt.js:8-9 | - |
| G43 | `LV:server.js:633` | slash+strict | L269 | REVERSED | LV:server.js:801 | - |
| G44 | `LV:server.js:700` | slash | L269 | REVERSED | LV:server.js:868 | - |
| G45 | `LV:server.js:730` | slash | L269 | REVERSED | LV:server.js:898 | - |
| G46 | `LV:server.js:757` | slash | L269 | REVERSED | LV:server.js:928 | - |
| G47 | `LV:lib/http-keepalive.js:29` | strict | L271, L593 | PASS | LV:lib/http-keepalive.js:83 | state.interval = setInterval( |
| G48 | `LV:server.js:3954` | strict | L271, L593 | PASS | LV:server.js:4599 | setInterval(runHourlyCleanup, CLEANUP_INTERVAL_MS) |
| G49 | `SD:reapers.js:38` | strict | L289 | PASS | SD:reapers.js:38-39 | statExitSentinel: statExitSentinelPort |
| G50 | `LV:routes/workspace-api.js:2724-2740` | bare+strict | L327, L711 | PASS | LV:routes/workspace-api.js:2936-2944 | const rasterType = sniffRasterType(buffer); |
| G51 | `LV:routes/workspace-api.js:3437,3443` | strict | L327 | PASS | LV:routes/workspace-api.js:2938-2944 | X-Content-Type-Options', 'nosniff' |
| G52 | `LV:lib/agent-turn.js:536` | strict | L335 | PASS | LV:lib/agent-turn.js:584-586 | boot once LIN-2622 |
| G53 | `LV:lib/effort-readout.js:597` | strict | L335 | PASS | LV:lib/effort-readout.js:597 | The effort column is empty by design |
| G54 | `LV:lib/workspace.js:89` | strict | L335 | PASS | LV:lib/workspace.js:96 | once LIN-2018 remaps Jira team ids |
| G55 | `LV:lib/account-workspace-store.js:27` | strict | L336 | PASS | LV:lib/account-workspace-store.js:28 | wired to NO route until LIN-1329 |
| G56 | `LV:lib/pipeline-loops.js:808` | strict | L336 | RETIRED | n/a | n/a |
| G57 | `SD:dispatcher.js:31,1470-1503` | strict | L349, L801 | PASS | SD:dispatcher.js:1618-1628 | resolveEffectiveHalt: resolveEffectiveHaltDep |
| G58 | `LV:routes/dashboard.js:2134` | bare | L350 | PASS | LV:routes/dashboard.js:2582 | router.get('/workspace/:urlKey/effort-readout' |
| G59 | `LV:routes/dashboard.js:2160` | bare | L350 | PASS | LV:routes/dashboard.js:2608 | /api/effort-readout' |
| G60 | `LV:routes/dashboard.js:48,49` | strict | L350 | PASS | LV:routes/dashboard.js:52-53 | import { renderEffortReadoutPage } |
| G61 | `LV:lib/unanswered-decisions.js:264` | strict | L387, L630, L799, L816 | PASS | LV:lib/unanswered-decisions.js:269 | export function isDecisionWithdrawn(loop) |
| G62 | `LV:lib/pipeline-loops.js:63-136` | strict | L388, L630, L799, L817 | PASS | LV:lib/pipeline-loops.js:218-262 | withdrawal: digest.withdrawal ?? null |
| G63 | `LV:routes/proxy-rulings.js:103,163,248` | strict | L389, L630, L799 | PASS | LV:routes/proxy-rulings.js:190-250 | async function readRulings(urlKey |
| G64 | `LV:routes/dashboard.js:1673` | strict | L390, L630, L817 | PASS | LV:routes/dashboard.js:2087 | rulings/reverse-withdrawal' |
| G65 | `LV:routes/proxy.js:20-30` | strict | L396, L612 | REVERSED | LV:routes/proxy.js:1277-1611 | n/a |
| G66 | `LV:routes/proxy.js:1549` | strict | L402 | PASS | LV:routes/proxy.js:1550-1551 | createAgentStatusRoutes({ agentStatusStore |
| G67 | `LV:routes/proxy.js:1544` | strict | L403 | PASS | LV:routes/proxy.js:1545-1546 | createComputeRoutes({ recapCacheStore |
| G68 | `LV:routes/proxy.js:1574` | strict | L404 | PASS | LV:routes/proxy.js:1581-1582 | createDispatchRoutes({ authenticateProxyToken |
| G69 | `LV:routes/proxy.js:56-133` | bare | L404 | PASS | LV:routes/proxy-dispatch.js:118-198 | function formatDispatchWatch(item, meta = null |
| G70 | `LV:routes/proxy.js:1578` | strict | L405 | PASS | LV:routes/proxy.js:1611 | createProxyFlightCompanionRoutes({ proxyLimiter |
| G71 | `LV:routes/proxy.js:1553` | strict | L406 | PASS | LV:routes/proxy.js:1554-1560 | createProxyHaltRoutes({ workspaceHaltStore |
| G72 | `LV:routes/proxy.js:9,104` | bare | L406 | UNRESOLVED | n/a | n/a |
| G73 | `LV:routes/proxy.js:1570` | strict | L407 | REVERSED | LV:routes/proxy.js:1577-1578 | n/a |
| G74 | `LV:routes/proxy.js:1328` | strict | L408 | REVERSED | LV:routes/proxy.js:1332-1333 | n/a |
| G75 | `LV:routes/proxy.js:1566` | strict | L409 | PASS | LV:routes/proxy.js:1574 | createRulingsRoutes({ proxyLimiter |
| G76 | `LV:routes/proxy.js:1324` | strict | L410 | PASS | LV:routes/proxy.js:1328-1329 | createTokenExchangeRoutes({ proxyTokenStore |
| G77 | `LV:routes/proxy.js:1272` | strict | L411 | PASS | LV:routes/proxy.js:1276-1277 | createTokensAdminRoutes({ proxyTokenStore |
| G78 | `LV:routes/proxy.js:1332` | strict | L412 | PASS | LV:routes/proxy.js:1336-1337 | createProxyWriteRoutes({ onTicketWrite |
| G79 | `LV:routes/proxy.js:22,300-341` | bare | L412 | PASS | LV:routes/proxy-writes.js:374-378 | checkPeriodicalReportGate({ |
| G80 | `LV:routes/dashboard.js:48` | strict | L419 | PASS | LV:routes/dashboard.js:52 | import { computeEffortReadout |
| G81 | `LV:routes/dashboard.js:49` | strict | L420 | PASS | LV:routes/dashboard.js:53 | import { renderEffortReadoutPage } |
| G82 | `LV:lib/providers/jira/oauth.js:28-36` | strict | L464, L623, L714 | PASS | LV:lib/providers/jira/oauth.js:28-36 | doc-derived, unobserved (D3) |
| G83 | `LV:lib/prompt-template-defs.js:1043,1202` | strict | L630, L799 | PASS | LV:lib/prompt-template-defs.js:969,1102 | No re-raise (LIN-2991/LIN-3022) |
| G84 | `LV:docs/incidents/2026-09-22-harbour-db-reads-hang.md:148` | strict | L658 | PASS | LV:docs/incidents/2026-09-22-harbour-db-reads-hang.md:148 | Runner-local halt / auto-pause |
| G85 | `SD:halt.js:219` | strict | L664, L801 | PASS | SD:halt.js:223 | function resolveEffectiveHalt({ harbourHaltByToken |
| G86 | `LV:tests/e2e/dispatch-halt.spec.js:124` | strict | L668 | RETIRED | n/a | n/a |
| G87 | `LV:tests/unit/render-dispatch-exec-controls.test.js:43` | strict | L668 | REVERSED | LV:tests/unit/render-dispatch-exec-controls.test.js:42-53 | n/a |
| G88 | `LV:docs/runbooks/harbour-degraded.md:60` | strict | L669 | REVERSED | LV:docs/runbooks/harbour-degraded.md:62 | n/a |
| G89 | `LV:docs/runbooks/harbour-degraded.md:7` | strict | L671 | REVERSED | LV:docs/runbooks/harbour-degraded.md:5-6 | n/a |
| G90 | `LV:docs/dispatch-integration.md:130` | strict | L672 | REVERSED | LV:docs/dispatch-integration.md:137 | n/a |
| G91 | `LV:routes/workspace-api.js:3450` | strict | L693 | PASS | LV:routes/workspace-api.js:3410-3455 | router.patch('/workspace/:urlKey/api/issues/:issueId' |
| G92 | `LV:routes/proxy.js:58,3446-3465` | strict | L695 | PASS | LV:routes/proxy-writes.js:46-47 | import { checkPeriodicalReportGate } |
| G93 | `LV:public/llms.txt:96` | bare | L697 | PASS | public/llms.txt:110-111 | data-testid="create-task" |
| G94 | `LV:routes/workspace-api.js:3434` | strict | L698 | PASS | routes/workspace-api.js:2935-2936 | force a download and break legitimate |
| G95 | `LV:routes/workspace-api.js:4164` | bare | L698 | PASS | routes/workspace-api.js:3443-3445 | const guard = await provider.issueWriteGuard(token, issueId); |
| G96 | `LV:lib/chat-request.js:82` | strict | L699 | PASS | lib/chat-request.js:212-216 | const check = await freeTierStore.tryUse(urlKey); |
| G97 | `LV:routes/ship-biscuit.js:196` | strict | L699 | PASS | routes/ship-biscuit.js:186-189 | const check = await checkFreeTierGate( |
| G98 | `LV:routes/workspace-api-roadmap.js:310,795` | strict | L700 | PASS | routes/workspace-api-roadmap.js:313-313 | return freeTierStore.tryUse(req.workspace.urlKey); |
| G99 | `LV:routes/test.js:882` | strict | L701 | PASS | routes/test.js:1216-1216 | await freeTierStore.recordUsage(urlKey) |
| G100 | `LV:lib/dispatch-store.js:746-778` | strict | L703 | PASS | lib/dispatch-store.js:948-973 | async cleanup() { |
| G101 | `LV:lib/live-console.js:78-85` | strict | L704 | PASS | lib/live-console.js:79-87 | export const DEFAULT_LANE_STALE_MS = 60 * 60 * 1000 |
| G102 | `LV:lib/render.js:499,518` | strict | L705 | PASS | lib/render.js:431-448 | name: title, |
| G103 | `LV:routes/dispatch.js:292,548` | strict | L706 | PASS | lib/dispatch-entrance.js:1111-1114 | const { prompt, kind, periodicalId, attachProxy |
| G104 | `LV:routes/dispatch.js:340-341` | bare | L706 | PASS | lib/dispatch-validation.js:146-148 | periodicalId must be one of the known periodical |
| G105 | `LV:lib/dispatch-store.js:343,840` | strict | L707 | PASS | lib/dispatch-store.js:2039-2043 | _formatHistoryItem(doc) { |
| G106 | `LV:routes/proxy.js:569-632` | strict | L708 | PASS | routes/proxy-dispatch.js:118-150 | function formatDispatchWatch( |
| G107 | `LV:lib/dispatch-store.js:75-89` | strict | L709 | PASS | lib/dispatch-store.js:104-112 | export const PERIODICAL_PROJECTION = { |
| G108 | `LV:CLAUDE.md:126` | strict | L710 | PASS | docs/architecture/source-map.md:143 | worker-lane-kickoff.js |
| G109 | `LV:docs/architecture/source-map.md:108` | strict | L710 | PASS | docs/architecture/source-map.md:142-143 | worker-lane-kickoff.js |
| G110 | `LV:routes/workspace-api.js:3434-3443` | bare | L711 | PASS | routes/workspace-api.js:2935-2944 | const rasterType = sniffRasterType(buffer); |
| G111 | `LV:routes/workspace-api.js:3437` | bare | L711 | PASS | routes/workspace-api.js:2938-2938 | const rasterType = sniffRasterType(buffer); |
| G112 | `LV:routes/workspace-api.js:3443` | bare | L711 | PASS | routes/workspace-api.js:2944-2944 | res.set('X-Content-Type-Options', 'nosniff'); |
| G113 | `LV:routes/dispatch.js:1115-1205` | strict | L712 | PASS | routes/dispatch.js:1020-1100 | router.get('/workspace/:urlKey/api/dispatch/presets' |
| G114 | `LV:routes/dispatch.js:1312-1406` | bare | L712 | PASS | routes/dispatch.js:1020-1100 | router.get('/workspace/:urlKey/api/dispatch/presets' |
| G115 | `LV:routes/dispatch.js:1315` | bare | L712 | PASS | routes/dispatch.js:1023-1023 | router.get('/workspace/:urlKey/api/dispatch/presets' |
| G116 | `LV:routes/dispatch.js:1406` | bare | L712 | PASS | routes/dispatch.js:1091-1100 | router.delete('/workspace/:urlKey/api/dispatch/presets/:presetId' |
| G117 | `LV:routes/dashboard.js:1567-1587` | strict | L713 | PASS | routes/dashboard.js:2330-2397 | const unansweredRulings = collectUnansweredDecisions( |
| G118 | `LV:routes/dashboard.js:1916` | bare | L713 | PASS | routes/dashboard.js:2330-2330 | const unansweredRulings = collectUnansweredDecisions( |
| G119 | `LV:routes/dashboard.js:1916-1983` | bare | L713 | PASS | routes/dashboard.js:2330-2397 | const unansweredRulings = collectUnansweredDecisions( |
| G120 | `LV:routes/dashboard.js:1981-1983` | bare | L713 | PASS | routes/dashboard.js:2395-2397 | return computeEscalationKpis({ |
| G121 | `LV:lib/dispatch-store.js:153` | strict | L715 | PASS | lib/dispatch-store.js:257-257 | this.ttl = options.ttl |
| G122 | `LV:lib/dispatch-store.js:226` | bare | L715 | PASS | lib/dispatch-store.js:257-257 | this.ttl = options.ttl |
| G123 | `??:proxy.js:58` | strict | L716 | PASS | routes/proxy-writes.js:46-46 | import { checkPeriodicalReportGate } |
| G124 | `LV:routes/proxy-writes.js:410` | strict | L717 | PASS | routes/proxy-writes.js:475-475 | { description: next } |
| G125 | `LV:routes/proxy.js:3556` | strict | L717 | PASS | routes/proxy-writes.js:475-475 | { description: next } |
| G126 | `LV:lib/periodical-runs.js:142` | strict | L718 | PASS | lib/periodical-runs.js:137-138 | return row.repo |
| G127 | `LV:routes/dashboard.js:1429` | strict | L720 | PASS | routes/dashboard.js:1967-1968 | const shelvedRulings = shelvedRulingsStore |
| G128 | `LV:routes/dashboard.js:1551` | bare | L720 | PASS | routes/dashboard.js:1967-1968 | const shelvedRulings = shelvedRulingsStore |
| G129 | `LV:routes/dashboard.js:1514` | strict | L721 | PASS | routes/dashboard.js:2215-2215 | const record = await shelvedRulingsStore.shelve({ |
| G130 | `LV:routes/dashboard.js:1801` | bare | L721 | PASS | routes/dashboard.js:2215-2215 | const record = await shelvedRulingsStore.shelve({ |
| G131 | `LV:docs/reviews/integration-surface-maturity-review-2026-09-26.md:592` | strict | L793 | REVERSED | docs/reviews/integration-surface-maturity-review-2026-09-26.md:630 | — |
| G132 | `LV:routes/dashboard.js:16,1673` | strict | L799 | PASS | routes/dashboard.js:2087-2087 | rulings/reverse-withdrawal', workspaceFromUrl |
| G133 | `SD:dispatcher.js:229-230` | bare | L801 | RETIRED | — | — |
| G134 | `LV:routes/proxy-rulings.js:228` | bare | L801 | RETIRED | — | — |
| G135 | `LV:routes/proxy-rulings.js:24-26` | bare | L801 | RETIRED | — | — |
| G136 | `LV:routes/proxy-rulings.js:103` | strict | L816 | PASS | routes/proxy-rulings.js:190-190 | async function readRulings(urlKey, { includeResolved = false } |
| G137 | `LV:routes/proxy-rulings.js:248` | bare | L816 | PASS | routes/proxy-rulings.js:405-405 | const includeResolved = req.query.includeResolved === 'true'; |
