# C2 — Rulings

Route: RULINGS. Commit 6f6c5d2 (SD `cf6369d`). 18 Nov. Read by a census reader. `SD:` = simple-dispatcher. All claims [checked] unless marked.

## How the route works today

- **Raise (loop).** A session ends a turn with `DECISION:` plus JSON (`decision_id`, `options`, `on_answer`…). SD teaches it at the self-check (SD:hook.js:491-500, :1430), scans the turn (SD:hook.js:588-650) and posts `[decision] {json}` as `kind:'decision'` feedback (SD:hook.js:777-797). The runner kit posts the same itself (docs/runner-prompt.md:169-179).
- **Raise (scan).** A person runs a scan. A model reads the task (lib/scan.js:26). A found decision goes to the task store with `on_answer` forced to `record` (lib/scan.js:150-157).
- **Carry.** Only as feedback on the loop's dispatch row, re-derived per read (lib/session-telemetry.js:702, lib/digest-feedback.js:94, lib/pipeline-loops.js:260-268). No ruling record exists.
- **Open or not.** `collectUnansweredDecisions` (lib/unanswered-decisions.js:701) clusters loops, then drops answered, withdrawn, superseded and shelved rows. It adds the newest outcome-free scan row per task.
- **Shown** on the badge, the Rulings tab, cards, the task page, Home, the chat tool and the KPIs (routes/dashboard-rulings.js:39). Agents read `GET /api/proxy/rulings` (routes/proxy-rulings.js:404).
- **Answered** by a signed-in person only.
  - The reply posts a comment on the anchor issue ending `— Ruling recorded via Harbour` (routes/workspace-api-issue-write.js:408).
  - The same request stamps `decision-answer` on the loop row (lib/dispatch-store.js:4303) or `outcome:'answered'` on the scan row (lib/task-decisions-store.js:475).
  - Dismiss, shelve, keep and answer-without-comment are other routes (routes/dashboard-rulings.js:214-430). Agents only propose (routes/proxy-rulings.js:1-30).
- **Resume.**
  - `effect:'resume'`: the comment goes first, then `POST …/api/dispatch` with `followUpTo` set to the anchor loop (public/common.js:1038-1040, :1106-1180). SD resumes the session matching `rootItemId` or `itemId` (SD:followup.js:35-60).
  - `record`: comment only; `dispatch`: a fresh run.
- **Later stages read it.** A comment ending in the mark is a ruling (lib/run-trail.js:211-214), quoted by the selector (lib/openrouter.js:945-955) and the facts (lib/recommendation-facts.js:476).
- **Ends.**
  - By answer or dismiss, or by agent `WITHDRAW:` (SD:hook.js:818-840).
  - When the ticket closes: loop decisions are withdrawn and scan rows self-resolved (lib/ticket-close-closer.js:285, :299). A newer scan also supersedes.
  - A shelf hides a ruling until `resurfaceAt`, then it returns with `lapseCount` (lib/unanswered-decisions.js:762-769).

**Keying, side by side**

| Holder | Key |
|---|---|
| SD session | `postedDecisionIds[]`, `decisionItemIds[decision_id]→itemId` per session (SD:hook.js:788-795) |
| Loop decision | feedback on dispatch row `_id`. Grouped `${lineageId ?? loopId}::${decision_id}` (unanswered-decisions.js:434). Worker joined to autopilot by `sessionId` and the same issue (:480-491) |
| Row | `anchor.loopId` = lineage root (reply and resume target); `stampLoopId` = content loop (:859-880) |
| Answer stamp | per row (digest-feedback.js:115); discharge = lineage-wide union (unanswered-decisions.js:323) |
| Withdrawal | per row only (:304) |
| Scan decision | `scan_<issueId8>_<inputHash12>`, task plus content hash (task-decisions-store.js:169-171); newest per `${urlKey}::${issueId}` counts (unanswered-decisions.js:909-917) |
| Shelf, suggestion | `${urlKey}::${loopId or taskDecisionId}::${decisionId}`, or legacy `${urlKey}::${decisionId}` (shelved-rulings-store.js:69-71, dismissal-suggestions-store.js:113-114, unanswered-decisions.js:33-39) |
| Browser | `${urlKey}::${anchor.loopId ?? taskDecisionId}::${decisionId}` (public/observation.js:173-177) |
| Comment | the anchor issue (`/api/comments/:issueId`) |
| Size ruling | ticket description `## Size of the move`, `**Decided by:**` (lib/size-of-move.js:65-69) |

## Sites

| ID | Site | Role | What it does | Reached from |
|---|---|---|---|---|
| C2-01 | SD:hook.js:491-500, :1430; reapers.js:1490 | instructs | DECISION/WITHDRAW format | every SD stop |
| C2-02 | SD:hook.js:561-650 | carries | parses the block, size gate | hook paths :2133 |
| C2-03 | SD:hook.js:777-797 | writes | posts feedback, records ids | C2-02 |
| C2-04 | SD:hook.js:818-840 | ends | `decision-withdrawn` to the asking item | WITHDRAW: scan |
| C2-05 | SD:followup.js:35-60 | carries | resume target from `followUpTo` | follow-up dispatch |
| C2-06 | docs/runner-prompt.md:169-179 | instructs | runner posts `decision` before `BLOCKED:` | lib/prompts/runner-kickoff.js:41 |
| C2-07 | routes/dispatch.js:1603-1661; lib/dispatch-feedback-kinds.js:73-74 | writes | feedback route; `decision-answer` not runner-writable | SD, runner |
| C2-08 | lib/session-telemetry.js:702; lib/digest-feedback.js:94, :115, :207, :294 | carries | parse, settled check, withdrawal, resolved | lib/pipeline-loops.js:260-268 |
| C2-09 | lib/unanswered-decisions.js:81, :155 | reads | disposition and effect | C2-10 |
| C2-10 | lib/unanswered-decisions.js:701-960 | reads | THE predicate | C2-24…C2-32 |
| C2-11 | lib/unanswered-decisions.js:568, :978 | reads | `openDecisionLoopIds`, `rulingStandingOf` | dashboard-rulings.js:111; task-page-loader.js:932, :1119; C2-12 |
| C2-12 | lib/ruling-standing.js:28-40 | reads | `readRulingStanding` | task-page-loader.js:1266, :1440; home-row-states.js:87 |
| C2-13 | lib/ruling-settled.js:10-14 | guards | 409 `ruling-settled` shape | dashboard-rulings.js:224, :228, :328; workspace-api-scan.js:390; workspace-api-issue-write.js:474, :618-637 |
| C2-14 | lib/dispatch-store.js:4255, :4303-4356 | writes | settled check; CAS answer/dismiss stamp | C2-22, C2-24 |
| C2-15 | lib/dispatch-store.js:4378-4412, :4447 | ends | withdraw; reverse a withdrawal | C2-27; dashboard-rulings.js:263 |
| C2-16 | lib/task-decisions-store.js:206, :346, :431, :475, :506, :561, :604, :650 | writes | scan rows: record, outcome, reverse, answer, list | C2-18, C2-22, C2-24, C2-27, C2-12 |
| C2-17 | lib/scan.js:26-44, :150-157 | instructs | scan prompt; id; `record` effect | C2-18 |
| C2-18 | routes/workspace-api-scan.js:228, :314, :371-390, :444-498, :535-544 | writes | scan, dismiss, retire, unretire | scan UI [client reported] |
| C2-19 | lib/shelved-rulings-store.js:69-71, :111, :152 | writes | shelves, `lapseCount` | C2-24; C2-10 |
| C2-20 | lib/dismissal-suggestions-store.js:113, :127, :188, :243, :330 | writes | proposals; `attachStandingSuggestions` | C2-24, C2-25 |
| C2-21 | server.js:100-103, :659-680 | carries | builds 3 stores | composer |
| C2-22 | routes/workspace-api-issue-write.js:107-200, :357-474 | writes | comment plus mark; stamps; dedupe; 409 | public/common.js:991 |
| C2-23 | lib/run-trail.js:100, :211-224 | reads | `RULING_MARK`, `isRuling` | openrouter.js:945; recommendation-facts.js:476, :515 |
| C2-24 | routes/dashboard-rulings.js:39-130, :214-452 | reads/writes | feed; dismiss, reverse, answer, shelve, keep | routes/dashboard.js:70 |
| C2-25 | routes/proxy-rulings.js:191-250, :279-380, :404-452 | reads/writes | agent read; suggest-dismissal/-answer | routes/proxy.js:26 |
| C2-26 | routes/dashboard-session-state.js:230-245; routes/dashboard.js:395 | reads | session rows, no shelves/scans | task-page-loader.js:580 |
| C2-27 | lib/ticket-close-closer.js:70-114, :241-305, :333 | ends | ticket-closed withdraw, self-resolve | server.js:3267; proxy-writes.js:623 |
| C2-28 | lib/observer-sweep.js:181, :316 | reads | answered/withdrawn → `resolved` | observer census |
| C2-29 | lib/question-card.js:109, :185; lib/render-session.js:517; lib/render-task-page.js:804 | shows | question cards, `if_unanswered` | session, task pages |
| C2-30 | lib/task-page-loader.js:580, :932, :1119, :1266, :1440; lib/home-row-states.js:87 | reads | task page, Home rows | page routes |
| C2-31 | lib/chat-tools.js:443, :1727-1798 | reads | `list_pending_decisions` | flight-companion.js:387; task-chat.js:693 |
| C2-32 | routes/dashboard-kpis.js:46-70, :209-210; lib/escalation-kpis.js:16 | shows | escalation KPIs | render-observation.js:265 |
| C2-33 | lib/render-observation.js:43, :224, :263-306 | shows | Rulings tab, waiting block | `/observation?view=rulings` |
| C2-34 | lib/components/navbar.js:176, :325-327; public/common.js:3142-3160 | shows | badge, gated on `runControls` | every page |
| C2-35 | public/observation.js:173, :1883, :1991, :2612-2647, :2719-2725, :2913, :2966-2973, :3523-3560 | shows/writes | poll, render, shelve, dismiss, answer, keep, reply | Observation |
| C2-36 | public/common.js:991-1014, :1038, :1106-1180, :1231-1255 | writes | `postComment`, `deliverReply`, dismiss→follow-up | observation.js, session.js |
| C2-37 | public/question-cards.js:248-250 | shows | 409 read as "answered elsewhere" | cards |
| C2-38 | lib/prompt-template-defs.js:736 (review), :860 (close-out) | instructs | check rulings before any `DECISION:` | stage prompts |
| C2-39 | lib/prompt-template-defs.js:635, :787; lib/prompts/stage-kinds.js:27, :29 | instructs | cut needs an answered ruling; `DECISION:` before `BLOCKED:` | DECIDE (stage-kinds.js:61, :117, :201, :227, :254) |
| C2-40 | lib/prompt-template-defs.js:478-489; lib/prompts/stage-kinds.js:250 | instructs | scoping: policy, or size pending | scoping |
| C2-41 | docs/autopilot-operating-manual.md:446, :467-490 | instructs | "it's yours — answer it"; ruling shape; no re-raise | lib/prompts/autopilot-manual.js:25 |
| C2-42 | lib/proxy-instructions.js:561-697 | instructs | agent API text for the rulings routes | instructions endpoint [reported] |
| C2-43 | lib/size-of-move.js:65-69, :191, :268, :405 | guards | policy decider, size record check | proxy-writes.js:400-406; recommendation-facts.js:523; recommendation-look-first.js:149 |
| C2-44 | lib/workspace-preferences.js:37-38 | carries | `sizePolicy` retired | — |
| C2-45 | routes/test.js:1267-1327 | guards | clear/read the three stores | e2e |
| C2-46 | tests/unit: unanswered-decisions, open-decision-loop-ids, lin-4143-standing-characterization, rulings-resolution-contract-drift, decision-lifecycle-stamp-drift | guards | predicate pins | test:unit [headers] |
| C2-47 | tests/unit: task-decisions-store, shelved-rulings-store, dismissal-suggestions-store, dispatch-store-decision-answer/-withdrawal, lin-4241-settled-ruling-store, ticket-close-closer | guards | store pins | test:unit [headers] |
| C2-48 | tests/unit: proxy-rulings-routes, proxy-writes-rulings-pins, comment-write-route, test-routes-task-decisions, lin-4241-settled-ruling-client, observation-ruling-delivery, (navbar-)rulings-badge(-client), stage-intent-cut, size-of-move(-guard); fixtures/task-decision.js | guards | routes, client, prompt, size | test:unit [headers] |
| C2-49 | e2e observation-rulings, session-decision-layout; visual rulings-screenshots | guards | tab, badge, cards | Playwright [headers] |
| C2-50 | 72 test files hit these modules | guards | wider pins | [grep only] |

## Corrections to the inventory (existing-ref.md E4, E10)

- E4, "`DECISION:` lines read by the ONE predicate": **held** (unanswered-decisions.js:4-7). SD parses the line into feedback (SD:hook.js:588); Harbour never reads final messages.
- E4, "keyed by the asking loop": **corrected**. Rows are keyed by lineage plus `decision_id` (:434), with a worker/autopilot join (:480-491). The anchor is the root; the stamp goes on the content loop (:859-880).
- E4, task-keyed scan store: **held**, but the key is task plus content hash (task-decisions-store.js:169-171).
- E4, shelving quote at shelved-rulings-store.js:3: **held**. E4, "PROPOSE … never dismiss": **held** (dismissal-suggestions-store.js:2-3). That store also holds answer proposals (:20-27).
- E4, "one standing read (ruling-standing.js)": **corrected**. Only the task page and Home use it; the other feeds (C2-24…C2-31) call `collectUnansweredDecisions` directly. One predicate, not one read.
- E4, "one settled guard (ruling-settled.js)": **corrected**. That file is the 409 shape only. The guard is the `markDecisionAnswered` CAS (dispatch-store.js:4303-4350) and `answer()`'s `firstStampWins` (task-decisions-store.js:475).
- E4, "answers are posted as comments": **corrected**. The settling write is the stamp or the scan `outcome` (C2-22). Dismiss, answer-without-comment and shelve post no comment (C2-24).
- E4, "no such setting": **held**. `sizePolicy` was removed (workspace-preferences.js:37-38).
- E4, "the standing policy": **held** (size-of-move.js:67, :405).
- E4, "it's yours — answer it": **held**, at docs/autopilot-operating-manual.md:446.
- E4 Lighthouse `registers/decisions.md`: no `registers/` here (ls).
- E10: feature defaults, the settings-areas quote (:4), the model-routing quote (:2-3), "size policy is code": all **held**. No rulings setting exists (grep); the badge is gated on per-user `runControls` (navbar.js:176).

## Loose ends

- **One answer, held two ways.** A tracker comment (read by `isRuling`) and a separate stamp. The stamp is best-effort after the comment (workspace-api-issue-write.js:423-430), so a comment can stand while the ruling stays open.
- **Size ruling, two ways:** the description record and John's comments, outside the stores (size-of-move.js:15-18).
- **One ruling, two keys.** Shelves and suggestions key on `anchor.loopId`, the root (observation.js:2647, :2973). Answers and dismissals stamp `stampLoopId`, the content loop (:2725, :3536).
- **Two precedence rules.** Shelves win by presence; suggestions win by standing (unanswered-decisions.js:751-761).
- **Repeats.** One decision per lineage; joined only for worker/autopilot (:443-453).
- **Feeds disagree.**
  - The session feed passes no shelves or scan rows (C2-26), so a shelved ruling can still show on a session page.
  - `includeResolved` never returns answered task-bound rows (proxy-rulings.js:394-397).
- **Duplicated constant:** `REAP_INACTIVITY_MS` mirrors SD (LIN-2201, unanswered-decisions.js:41-54).
- **Not traced:** public/scan.js, public/session.js answer forms; follow-up enqueue; SD `resumeSession`.
- **Name matches, not rulings:** decision-panel (lib, public, e2e lin-3987), lin-4460-close-out-decision, lin-3890-run-key-ruling. [headers]
