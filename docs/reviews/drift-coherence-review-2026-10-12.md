# Drift & Coherence Review — post-batch-3 gauge, run of 2026-10-12 (trend vs 2026-10-11 post-batch)

**Grounding.** Measured at `LinearViewer` `e24f8d12c47891eab16c25c2be3bd6d6e20624f9` / `simple-dispatcher` `3dc08b5b587b897fa83e4c76cbdb23cd6eec2e82`. Both were fetched from `origin/main` before measuring, and neither moved after this task was created (`git log --since=2026-10-12T06:50Z` is empty in both). `simple-dispatcher` has **0 commits** since the previous edition. Every baseline figure below was re-measured at `15990905` (the 10-11 post-batch grounding) with the same command, not copied from that edition's prose.

**Why this edition exists.** It is the post-batch-3 gauge reading for **LIN-3449** (the coherence loop), and the "places per decision" reading for **LIN-3490**. In the window `15990905..e24f8d12`, LinearViewer took 45 commits (PRs #1834–#1877). Batch 3 is 13 decisions in 15 PRs: #1835–#1850, except #1845 (the LIN-3463 paper). Production (`lib/`, `routes/`, `server.js`, `public/`): 74 files, +2,129 / −1,428. Tests: 110 files, +3,627 / −991.
- **New modules:** `lib/dispatch-fields.js`, `lib/dispatch-refusal.js`, `lib/dispatch-targets.js`, `lib/recommendation-input.js` and `lib/hourly-cleanup.js`.
- **Moved:** the three sample-data files went from `tests/fixtures/` to `lib/sample-data/`.
- **Module counts:** `lib/*.js` 270 → 275; `routes/*.js` 49 → 49.

**File name.** No file existed for 2026-10-12, so the plain series name `drift-coherence-review-2026-10-12.md` is used, following the convention in `docs/architecture/source-map.md` (`reviews/` entry).

**Review-only.** No code, config, secret or under-review doc was changed. The deliverables are this report, its branch and PR, and the Linear updates.

**Headline.**
- **Batch 3 did what it claimed.**
  - **13 / 13 decisions** now reach one authority. **11 are confirmed** by both the old command and a shape-based count.
  - **2 are partial.** LIN-3471 keeps the wire re-projection by design, because C (LIN-3488) was cancelled. LIN-2427 has one resolver and one gate, but the gate is still fed two mock dialects, and 6 older "not configured" gates sit outside it.
  - **0 regressed.**
  - **7 ledger rows resolved in this window**, each by both counts: test-fixture imports, SSE writer, wake regex, keepalive bodies, the HTML error page, the refusal relay and the Date-returning parse twins.
- **The previous top finding was fixed at its reproduced point.** After a headless refresh the 10-11 repro now gives `{token: NEW, scope: NEW}`.
  - The rest of the credential decision did not move: 6 copies, 7 choosers, expiry ranking ×3, 7 persist seams.
  - One wrong-answer path remains, and LIN-3464 widened its reach. The refresh *writer* rotates the first binding of the provider, while the readers pick the binding by token. That path now carries the headless lane too.
- **The highest-severity row is now the runner contract** (High, unchanged since 10-11). The kit moved alone, and LIN-3505 let it raise a ruling. It does so through a prose-only producer that is a **third dialect** beside SD's `hook.js` grammar, read by one tolerant Harbour parser.
- **No new upward edge, cycle or production→test import.** Tarjan: 0 SCCs over 393 nodes / 1,476 edges. The +41 edges are downward imports of the new leaves; LIN-3503, for example, added `liveness-detectors.js` → `consumer-poll-warning.js`.

**Places-per-decision reading (for LIN-3490):**
> *12 Oct, post-batch 3: all 13 batch-3 decisions now reach one authority (11 by both the old command and a shape count; 2 partial by design or by shape); 7 ledger rows resolved and 0 regressed in the window; 23 distinct decisions are still held in more than one place (25 ledger rows, of which 2 are sub-rows of another row): 1 High, 1 Medium-High, 3 Medium, 10 Low-Medium/Medium-Low, 8 Low. 3 of the 23 were born or grew in the window: the kit's decision dialect, the close-out refusal, and the "waiting on a person" rule, which LIN-3504 extended.*

**Method notes (read before comparing counts).**
1. **Old commands are kept verbatim** next to every shape-based count. A row counts as *resolved* only when both agree.
2. **Cycles.** I used the same ~30-line scratch Tarjan walker over static `import` / `export … from` / side-effect imports of `lib/`, `routes/` and `server.js`, kept outside the repo.
   - It **reproduces both baselines exactly**: `6df0fbd5` reads 377 nodes / 1,369 edges / 4 SCCs (15/6/2/4); `15990905` reads 385 / 1,435 / 0.
   - At HEAD it reads **393 / 1,476 / 0**. Dynamic `import()` into `routes/` or `server.js` from `lib/`: 0.
   - The 8 new modules each load alone under `NODE_ENV=test`: 8/8. A second, independent walker run by the credential sub-agent gave the same three figures.
3. **Attribution.** There is no file split this window. Every site delta is attributed to a named PR. The probe figures in the task description were loose greps; where they differ from this report, the method difference is named (`renderErrorPage` 163, `res.status(<var>).json(` 10, `confirm(` 20).
4. **Delegation.** Measurement was split across four fresh-context, read-only sub-agents: credentials and AI gate; error envelopes and dispatch fields; the remaining batch rows with Tarjan and census; and the cross-repo contract. I re-ran their load-bearing claims myself before using them:
   - the writer's binding choice at `lib/workspace.js:372`
   - the three `DECISION` grammars
   - the LIN-3395 client order
   - the `maxTasks`, keepalive and `htmlError` counts at both SHAs
5. **Ledger row count.** The 10-11 post-batch ledger has **53** rows (the dispatching description said 52), and all 53 are carried.

---

## Batch verification (LIN-3449 batch 3)

| ticket | claim (LIN-3449 log, 11 Oct 23:36Z) | measured at `e24f8d12` (baseline `15990905`) | verdict |
|---|---|---|---|
| **LIN-3464** (#1847) | one current token for a legacy workspace; E1/E2 split retired | `getWorkspaceMirrorToken` 0 in production; the only hit is a test asserting it is undefined (`lin-3124-pr1-s0-characterization.test.js:168`). The headless mirror now writes through `applyAccessTokenToWorkspace` (`lib/workspace-token-refresh.js:137`), and `getWorkspaceToken` reads `accessToken` (`lib/workspace.js:791`). **Function-level repro** (scratch script, both SHAs): baseline `{token:NEW, scope:OLD}` → HEAD `{token:NEW, scope:NEW}`. Residue: workspace `credentials.token` is written ×3 (`workspace.js:361,507,691`) and read 0×; `persistOwnerCredential` (`:422,431`) still reads in the retired E1 order (no live divergence found). **Widened reach:** the shared writer rotates `bindings.find(b => b.provider === …)` (`:372`), the first binding of the provider, while readers select by token (finding 2). | **confirmed**; 1 widened residue |
| **LIN-3465** (#1839) | keepalive error replies through `keepaliveError` (74 → 0, 80 sites) | Old command `grep -rnE "keepalive\.send\([45][0-9][0-9], *\{" lib routes server.js`: **74 → 0** (73 real sites plus 1 doc comment). `keepaliveError(` call sites: **0 → 75** (79 at merge; LIN-3470 folded proxy.js's 5 into its relay). Shape: 0 hand-built bodies at any `keepalive.send`. The 8 `keepalive.send(<var>, <var>)` sites forward pre-built bodies (`recommendErrorResponse` ×6, `chargeFreeTierOrReject` ×2); see finding 5. | **confirmed** |
| **LIN-3466** (#1841) | one HTML error page (`htmlError` retired for `renderErrorPage`) | `htmlError` 6 → **0**; `.html(` error sites 9 → 0; raw-text 4xx/5xx 4 → 0. `renderErrorPage` call sites by the 10-11 method: 116 → **124** external (+9 converted by ab227381, −1 via the new `renderServiceUnavailablePage`, `lib/render-pages.js:639`). The probe's 163 counts imports, references and comments; the same command reads 151 at baseline. `textError` and the 5 `.text` wrappers now have 0 callers (LIN-3479, Backlog). | **confirmed** |
| **LIN-2427** (#1846, #1848) | one OpenRouter credential resolver and one AI-availability gate; ruling (b) who-paid note | `resolveProxyLLM` 29 lines → 1 (a comment, `lib/chat-request.js:21`). `resolveChatCredential` has 36 calls. All 13 named gates go through `isAiUnavailable` (`chat-request.js:74`), and `isRecommendationEnabled(` calls are 17 → 1. Who-paid note: 6 → 7 sites. **By shape:** the gate takes the mock flag as a parameter, and the two dialects survive at its callers (`isTestMode` ×6 in proxy routes, `shouldMockAi(workspace)` ×6 in `workspace-api`). **6 more** "not configured" gates sit outside it (`workspace-api-roadmap.js:285,798`, `flight-companion.js:728,888`, `dashboard.js:2798,2984`); all 6 were present at baseline, so the 10-11 count of 13 understated a true 19. `getOpenRouterSource` (`server.js:1017-1025`) restates the oauth > env > free order. | **partial** (by shape) |
| **LIN-3467** (#1843) | one declaration of dispatch targets (4 named lists → 0) | `lib/dispatch-targets.js:17-27` declares all {cli,web,dash,local}, polled {cli,web,dash} and session {cli,web}, and has 9 importers. Bracketed lists 7 → **3**, all inside it; named `*TARGETS =` lists outside it 4 → **0**; the 10-11 lines/files command 16/9 → 7/3. **Not reached:** the default `'cli'` (`RUN_FIELDS.target`, `dispatch-fields.js:53`, which does not import the declaration; plus ~18 server and ~10 client lines). SD (`targets.js:15-18`) and the kit (none) are untouched, which the ticket put out of scope. | **confirmed** (LV); cross-repo unchanged |
| **LIN-3468** (#1838) | one wake-marker regex (`WAKE_FEEDBACK_REGEX`, 3 copies → 0) | The 3 literal copies (`run-view.js`, `liveness-detectors.js`, `task-page-loader.js`) → **0**; all import `dispatch-terminal.js:63`. `public/` 0 at both SHAs. The `[blocked]`/`[pending]` regexes at `render-session.js:70` and `observer-efficacy-signal.js:110` are a different decision (unchanged). SD still restates the regex (`feedback.js:22`). | **confirmed** |
| **LIN-3469** (#1842) | one preparation of recommendation input (4 projections → 1) | All 4 `getRecommendation`/`getRecommendationStream` entrances call `prepareRecommendationInput` (`proxy.js:1488`, `workspace-api.js:949,1275,1345`). It does not overlap the open siblings: the 5 per-site `generatePrompt` context literals (LIN-3478) and the post-call rebuilds (LIN-3477) are untouched. | **confirmed** |
| **LIN-3470** (#1844) | one dispatch-refusal relay (2 → 1) | `mapDispatchRefusal` (`lib/dispatch-refusal.js:39`) is reached by `routes/dispatch.js:887` and `routes/proxy.js:842`, and through the injected `relayDispatchRefusal` by `proxy-dispatch.js:643,1101,1419` and `proxy-kickoff.js:499`. Refusal-tag readers outside it: 29 lines → 1 site, `workspace-api.js:3528-3536` (`runLimitRefusal`), a non-HTTP mapping with an inline `'RUN_LIMIT_UNVERIFIED'` literal. No overlap with `follow-up-dispatch.js`'s pre-built bodies, which cover different refusals. | **confirmed**; 1 low residue |
| **LIN-3471** (A LIN-3486 #1849, B LIN-3487 #1850; C LIN-3488 canceled) | 23 run-row fields declared once in `lib/dispatch-fields.js` | `RUN_FIELDS` 23 entries + 7 rules (`:48-212`), 6 production importers. The store hops read it (`dispatch-store.js:385,1006,2074,3024`); per-field re-normalisation in the store 93 → **0**. Every client-facing entrance validates through `validateRunField`. `maxTasks must` messages 5 → 1 + the trim endpoint's own (`routes/dispatch.js:1381`, kept by the ticket). Other field validators 15 lines / 5 files → the declaration. `typeof <field> !== 'boolean'` 10 → 0. **Kept by design:** wire re-projection, 34 lines in 6 `proxy-dispatch.js` blocks (`:74-119`, `:621-636`, `:1073-1089`, `:1392-1407`, `:1647-1676`, `:1853-1863`), plus `proxy-kickoff.js:489` and `pipeline-loops.js:757-796`, whose `kind`/`target → null` defaults disagree with the declared `'custom'`/`'cli'` (redundant today, not divergent). | **partial by design** (store and validation confirmed) |
| **LIN-3472** (#1837) | sample data in `lib/sample-data`; production → test-fixture imports 7 → 0 | 7 static + 1 dynamic → **0**, outside the `routes/test.js` harness. `tests/fixtures` keeps no second copy; `local-harness.js` imports from `lib/sample-data`. | **confirmed** |
| **LIN-2663** (#1835) | one SSE writer (3 → 1) | `function sendSSE` 3 → **1** (`lib/sse.js:23`); hand-written `event:`/`data:` writes outside it 2 → 0. 9 hand-written `text/event-stream` header preambles remain at both SHAs; LIN-3475 (Backlog) owns them. | **confirmed** |
| **LIN-3473** (#1840) | Date-returning timestamp parses use `toEpochMs` (3 twins → 0) | `toDate`/`_toDate` 3 → **0**; both inline closures use `toEpochMs` (importers 30 → 36). `isNaN(new Date…)` shape 19 → 14, mostly formatters. 3 small private normalisers remain (`routes/proxy-alarms.js:86-91`, `consumer-poll-warning.js:107-108`, `task-page-loader.js:84-86`). | **confirmed** |
| **LIN-3474** (#1836) | the last plain workspace-by-key lookups use the shared finder | Old command `grep -rn "urlKey === urlKey"`: 2 → 2 (leaf + exempt referent `connection-credential.js:678`). Shape 5 → **3**: the plain lookups (`workspace-urlkey.js:240`, `live-console.js:58`) now use the finder; the 3 compound predicates in the key-deciding module remain (`workspace-urlkey.js:197,257,259`). Finder importers 10 → 13. | **confirmed** |

**Batch-level reading:** 11 confirmed, 2 partial (LIN-2427 by shape; LIN-3471 by design), 0 regressed. Neither partial is a regression: both shape residues were present at `15990905`.

**Product −31 / tests +1,143.**
- The window as a whole (45 commits, not only batch 3) changed production by +2,129 / −1,428 across 74 files.
- In tests, batch 3 created no new guard files. It did, however, **re-pin two existing count pins instead of removing them** (row `batch-guard-residue`, §9).

---

## Findings (severity-ranked; delta vs 2026-10-11 post-batch)

### 1. `runner-contract-semantics-cross-repo` — **HIGH — UNCHANGED**, plus new sub-row `decision-dialect-split` (MEDIUM) (LIN-3451, Backlog)

**The kit moved alone; SD did not.** `git log 15990905..e24f8d12 -- lib/runner-kit docs/runner-prompt.md` shows 3 commits: LIN-3213 (#1869), LIN-3505 (#1870) and LIN-3503 (#1871). LIN-3503 re-anchored the kit's `OTHER_CONSUMER_RECENT_MS` bound to Harbour's `NOBODY_LISTENING_MS` in a comment (`runner.mjs:62`), and `runner-kit-helper.test.js` pins that relation. LIN-3505 touched **only** `docs/runner-prompt.md` and one test, as its ticket intended: "the kit has no parser of its own". SD has 0 commits.

**Unchanged rows** (all line moves re-verified):
- **Halt, 4 ways:**
  - Unknown mode: SD fails open (`dispatcher.js:1654`); the kit fails closed (`runner.mjs:214`).
  - Abort under stop: SD processes it (`pacing.js:28,106`); the kit leaves it (`:208`).
  - Stop text: SD `(${session.phase})` (`dispatcher.js:605`); the kit `(stopped by operator)` (`runner.mjs:253`).
  - Pause with a follow-up and no live session: SD posts `[failed]` (`followup.js:40`); the kit leaves it queued (`:209-212`).
- **Target:** SD {cli,web}; the kit reads none; the Harbour runner poll is unfiltered (`proxy-runner.js:94` → `dispatch-store.js:924-925` → `:793`).
- **Repo:** SD alone validates.
- **Row fields:** `queueIfBusy`, `force`, `waitForFollowUps` and `subscription` appear 0 times in the kit.
- **2000-character feedback cap:** SD truncates, the kit throws, Harbour returns 400.
- **Harness:** hard-coded in the kit.

The parity claim is **still false**. It has moved to `docs/runner-prompt.md:216`, and `:220-221` prints the kit's own stop text. The kit comments at `runner.mjs:199-203,235-236` repeat it.

**New sub-row `decision-dialect-split` (MEDIUM).** The kit can now raise a ruling. It does so with a second *producer* grammar, written only as prose:

| party | producer / reader | grammar |
|---|---|---|
| SD | `hook.js:588-659` `scanDecisionBlock` | Anchors on `^DECISION:`, matches braces, parses and **re-serialises**, then posts `'[decision] ' + JSON` (`:561,638,784`) as kind `decision`. A decision may accompany **any** sentinel, `DONE:` included (`:492`). The 2000-character gate counts **including** the prefix (`:650`). Dedupes `decision_id` per session; `WITHDRAW:` → `decision-withdrawn`; accepts `free_text`/`if_unanswered`/`on_answer`. |
| kit | `docs/runner-prompt.md:170-181` (prose only) | `DECISION:` only "just before the `BLOCKED:` line". The session posts "its JSON object as written, from the `{`" via `runner feedback <id> decision '<the JSON>'`: no prefix, no re-serialisation, no validation, no withdrawal, and the size is counted on the raw JSON. |
| Harbour | `lib/session-telemetry.js:669-699` `parseDecision` | `indexOf('{')`, then parse; needs a string `decision_id`. It accepts both producer forms. Its JSDoc (`:662`) documents only SD's form. |

**Cost.**
- The ruling contract is now a three-place edit: SD's code, the kit's prose and Harbour's tolerant reader.
- A Harbour reader that ever keys on the `[decision] ` prefix would silently drop kit rulings.
- A malformed kit decision is stored, produces no ruling, and `[blocked]` still posts. SD at least logs a refusal.
- Cross-party pins: Harbour → kit, 2 files (`runner-prompt-markers.test.js`, 16 → 22 tests; `runner-kit-helper.test.js`). SD → either: 0 runnable pins. No test says the two producers follow one rule.

**Capability gaps from LIN-3213 (recorded, not drift).** The kit's wait debounce (`runner.mjs:76,1008-1020`) has no SD equivalent; SD claims items in-process, so it needs none. The kit's open-items summary at stop (`runner open`, `:83-90,952-955`) tells the operator locally and posts nothing to the rows. SD posts `[dispatcher] going down: <SIGNAL>` on every in-flight row (`shutdown.js:88-104,149`). Harbour parses neither and no rule is restated.

**Ticket.** **LIN-3451 updated** with the dialect sub-row and the line moves. Not minted: LIN-3451 already names the decision, and LIN-3449 parks it.

### 2. `credential-decision-multiplicity` — **MEDIUM-HIGH — IMPROVED** (High → Medium-High; LIN-2150, Todo)

**What moved.** LIN-3464 retired E1/E2 (see the batch table); the reproduced wrong answer from 10-11 is gone. LIN-1550 (#1861) removed `updateWorkspaceTokens`, which had no production caller (one import, otherwise comments). LIN-3444 (#1855) reuses `bindingScopeForConnection`/`selectBestConnection` (`connection-credential.js:843-857`) and adds no chooser.

**What did not move** (same command at both SHAs):

| item | 15990905 → e24f8d12 |
|---|---|
| durable/session credential copies | 6 → 6 (the per-request side-table `connection-binding.js:25-27`, owner-credentials `:14/:520/:548`, the Connection row, the session scalar, the binding copy; plus the 30 s cache at `server.js:2418`) |
| named binding choosers | 7 → 7; reference counts identical (11/2/2/3/2/2/1) |
| token-equality choosers (shape) | 5 → 5 |
| first-of-provider choosers (shape `.find(b => b.provider === …)`) | 4 → 4 (`workspace.js:372,422,593`, `workspace-token-resolver.js:61`) |
| expiry ranking | 3 → 3 (both files: 0-line diff) |
| persist-binding sibling seams | 7 → 7 |
| legacy never converts | still `prior !== 'none'` (`connection-credential.js:1280`) |
| `legacyFallbackTarget` ≡ `selectIssueSourceBinding` | still there, 1 caller |
| `credential-invariant-sweep.js` | unchanged: 3 pairings (`:116-131`, `:135`, `:148`) + unreferenced-connection report (`:167`); none became vacuous, because it never watched E1/E2 |

**One remaining wrong answer, and LIN-3464 widened its reach.**
- `applyAccessTokenToWorkspace` is the shared credential writer for every refresh lane. It rotates the **first** binding whose provider matches (`lib/workspace.js:372`). Five readers identify the active binding by **token match**.
- On a row with two bindings of one provider where the second is active, the measurement sub-agent reproduced this at function level, at both SHAs:
  - After a refresh, the call scope flips to the first site, carrying the NEW token (a Jira call to the wrong site, with no error).
  - At baseline only the interactive lanes (`server.js:1260,1723`, `routes/workspace-api.js:1694`) behaved this way.
  - Since LIN-3464 the headless lane (`workspace-token-refresh.js:137`, reached from `suspect-credential-refresh.js:198` and `:228`) does too. Before LIN-3464, the headless lane kept the right site with a stale token.
- I re-read the writer line and its callers.
- Reach is limited to rows from before LIN-3334 that still hold two bindings of one kind. How many such rows production holds is **not measured** (it is production data, not source).

**Cost.** Any change to "which credential" still touches 4+ lanes, two count pins (re-pinned this window, §9) and the hash-pinned resolver, and the writer and readers answer "which binding" by different rules.

**Ticket.** **LIN-2150 updated** for the whole decision. The writer/reader binding rule is **not minted**. Its scenario (two bindings of one provider on one workspace) already has a named owner: **LIN-2188** (Backlog, "Same-provider multi-binding: binding-instance identifier"). LIN-2188 records the scenario as an accepted limitation, to be scheduled "when it becomes real". LIN-2188 is updated with the writer residue, which is a second consequence of the same scenario. If John wants it in batch 4, the single decision is: "the refresh writer rotates the binding whose token matches the pre-refresh token (the readers' rule); with no match, keep first-of-provider".

### 3. `human-wait-derivation-split` — **MEDIUM — NEW row** (pre-existing, and **grew in the window** through LIN-3504; LIN-3339 candidate 2, "waiting for a person")

**The decision:** which run state means "waiting on a person", and from which channel.
- **Marker set.** The authority is the exported `WAITING_WAKE_MARKERS` (`lib/digest-feedback.js:56`). Two copies carry "keep in parity" comments: `lib/render-run-steps.js:159` (whose comment still points at `routes/dashboard.js` and `pipeline-loops.js`) and `routes/dashboard.js:338`. Five more places inline `=== 'blocked'`: `run-view.js:232`, `task-page-loader.js:148`, `dispatch-terminal.js:225`, `unanswered-decisions.js:71` and `observer-sweep.js:97`. Two more decide the channel or the label: `pipeline-loops.js:312` maps agent-status `blocked` to `agentState: 'waiting'` (the root of the banner/clock split below), and `recent-runs.js:39` labels a run "waiting on a person" from the wire status.
- **Channel, where the sites diverge:**
  - The session banner (`routes/dashboard.js:354-363` `loopIsWaiting`) treats `agentState === 'waiting'` **or** a `[blocked]` marker as waiting.
  - The run-page waiting clock (`lib/run-view.js:226-243` `waitingClock`) reads the feedback marker **only**.
  - So a run that reports `blocked` through agent-status alone shows "waiting on you" in the banner and no clock on the run page.
  - `observer-sweep.js:97` takes the union, like the banner. `live-console.js:122` maps the agent-status words `pending` and `waiting` to `blocked`, a third mapping, on the console only.
- **Measured against the paper.** `one-job-many-paths.md` §2 recorded this as a high-priority candidate. LIN-3468 consolidated the *regex* but not the *set* or the *channel*.
- **It grew in the window** (corrected after the second read). LIN-3504 (#1868, "answered/ended session stops showing its [blocked] question") **created** `task-page-loader.js:148`: `const stale = wake && wake.marker === 'blocked' && state !== 'waiting'`. That line is absent at `15990905`. It is a new inline copy of the marker set and a **third "is the question still open" rule**, on the task page only, beside the wire's resume-marker rule (`dispatch-terminal.js:219-227`) and `loopIsWaiting`/`deriveSessionWaiting` (`routes/dashboard.js:354-412`). Its own JSDoc (`:139-140`) says `loop.waitingMessage` keeps the stale line for other pages. LIN-3448 (#1876) also touched this file.
- **Cost.**
  - Changing who counts as waiting means 3 set copies, 5 inline checks, the agent-status mapping, the recent-runs label and 3 staleness rules, across server and presentation. Ordinary feature PRs are still adding copies (LIN-3504).
  - The banner and the clock already answer differently for one input.
  - Whether agent-status should start a clock is an open behaviour question (paper §2), so a ticket needs that ruling first.
- **Ticket.** **LIN-3339 updated**: the candidate holds, with current sites. Not minted, because the behaviour choice (does agent-status start a clock?) has to be settled before a child ticket can be written in LIN-3449's style.

### 4. `ai-availability-gate-duplication` — **MEDIUM-LOW — IMPROVED, partial** (LIN-2427, Done)

Covered in the batch table. **Remaining:**
- **Mock dialects.** The gate is a function of `(credential, mockFlag)`, and the two route families still compute `mockFlag` differently: proxy uses `isTestMode` (test-token only), `workspace-api` uses `shouldMockAi(workspace)`. So under `NODE_ENV=test` a local-provider session is still mocked on `/workspace/:k/api/recap` but gets a 503 on `/api/proxy/recap`. That is inferred from code, not reproduced over HTTP.
- **Gates outside it.** There are 6 more not-configured gates (listed in the batch table), so 13 of 19 now go through the gate.
- **Authority overlap.** `getOpenRouterSource` (`server.js:1017-1025`) and `isRecommendationEnabled` (`openrouter.js:605`, 1 call) restate parts of the same decision beside `resolveChatCredential`/`isAiUnavailable`.
- **Data-mock predicate.** Still ×34 (multi-line count; the single-line grep gives 30 at both SHAs). It is a distinct decision, as before.
- **Pre-existing, outside the ticket.** `lib/run-paragraph-hook.js:28-31` reads raw `OPENROUTER_API_KEY` untrimmed, so a whitespace key counts as configured on the precompute lane. That is the class LIN-961 fixed elsewhere.

**Cost:** a 6-site edit plus two dialects to change when AI counts as available. Not promoted; below the cut.

### 5. `routes-error-envelope-fragmentation` — **LOW-MEDIUM — IMPROVED** (keepalive half resolved; producer residue)

- The 10-11 JSON command reads 0 at both SHAs. `keepalive-error-envelope-writer` and `html-error-page-two-writers` are **resolved** (batch table).
- **What is left is the producers:** 9 pre-built `{status, body: {error…}}` objects outside `lib/errors.js`:
  - `routes/proxy.js:1532,1535,1539`
  - `lib/follow-up-dispatch.js:68,81,101,156,161`
  - `chargeFreeTierOrReject` (`routes/proxy.js:1363-1370`), present at baseline and missed by 10-11
- They reach the wire through 16 forwarding sites: 8 `res.status(<var>).json(`, the same 8 sites as at baseline, and 8 `keepalive.send(<var>, <var>)`.
- `errorEnvelope` (`lib/errors.js:178`) still has 1 caller, and `follow-up-dispatch.js:101` still hand-builds `{error, code, category, retryable}`.
- **Cost:** one field added to the envelope means 1 helper plus 9 producers. Not promoted.

### 6. `close-out-merged-refusal-split` — **LOW-MEDIUM — NEW row** (born in the window, LIN-3395 #1877)

- **The new refusal.** LIN-3395 made "this PR's merge is already on record" one predicate (`close-out-events-store.js` `findMergedByPr`/`hasMergedEvent`). It refuses the close-out **press record** (`routes/workspace-api.js:4631-4636`, 409 `CLOSE_OUT_ALREADY_MERGED`).
- **The order problem.** The client enqueues the close-out session **first** and records the press **second**: `public/close-out.js:116` (`dispatchPrompt`) then `:128` (`/close-out-press`). `public/session.js:830` then `:843` follow the same order.
- So a stale-tab press after a merge still launches a close-out session; only the record is refused. Inferred from code order, not reproduced end to end.
- **No dispatch-side check.** The dispatch factory's `closeOutRefusal` (`dispatch-factory.js:739`) does not consult the merged record, and `run-evidence.js:102` decides "merged" from live PR state, a second source.
- **Cost:** two answers to "is close-out still needed", plus a refusal that sits on the wrong side of a two-step client flow. Not promoted.

### 7. `dispatch-entrance-field-duplication` — **LOW-MEDIUM — IMPROVED** (Medium → Low-Medium; partial by design)

Covered in the batch table. **Remaining, by design:** the wire re-projection that C would have removed. The next always-present run field is about 8 hand edits on the wire against 1 in the store.

**Outside the declaration:**
- the "is this run budgeted" predicate, written 3 ways: `dispatch-factory.js:644` (accepts non-integers), `pipeline-loops.js:1063` and `autopilot-kickoff.js:322`
- the `variant` validator, twice with different messages: `routes/dispatch.js:464` and `proxy-kickoff.js:146`
- the default target `'cli'`, restated outside `lib/dispatch-targets.js` (~28 lines)

**Census `mirrored`:** 3 of 43 window PRs (#1839, #1846, #1850) show mirrored lines. In each, the repeated lines are calls to the new shared module, restated at every entrance. That is adoption, not a copied rule.

### 8. LIN-3339 candidates re-measured (pre-existing; new ledger rows)

**`decision-stamp-classifier-copies` — LOW-MEDIUM.**
- The authority is `isDecisionLifecycleStampEntry` (`lib/digest-feedback.js:86`). Five membership copies sit beside it: `run-view.js:129`, `session-telemetry.js:60`, `wall-clock-summary.js:64`, `public/dispatch.js:1132` and `public/session.js:283`.
- The drift test (`tests/unit/decision-lifecycle-stamp-drift.test.js`) lists four and still omits `run-view.js`, exactly as the paper recorded.
- The `session-telemetry.js` copy is justified by a cycle (`digest-feedback.js` imports from it). A dependency-free leaf would retire all five.

**`provider-write-field-contract` — LOW-MEDIUM.**
- GitHub inherits `ui.priority: true` (`lib/providers/interface.js:250`); the comment says GitHub maps a real priority field.
- But `updateIssue` builds its patch without priority (`lib/providers/github/index.js:834-854`).
- The proxy catalogue documents the silent drop on PATCH. The session edit form still offers the control.
- API Quality owns the wire contract; the split capability decision is ours.

**LIN-3339's other three candidates:**
- "Recommendation input prepared four times": **resolved** (LIN-3469).
- "Waiting for a person": finding 3.
- "Copied credential-ranking rule": expiry ranking ×3, unchanged (finding 2).

### 9. Resolved this window (by both the old command and a shape count)

| row | detail |
|---|---|
| `production-to-test-fixture-imports` | 7 → 0 |
| `sse-frame-writer-duplication` | 3 → 1; header preambles stay with LIN-3475 |
| `wake-marker-regex-copies` | 3 → 0 in LV |
| `keepalive-error-envelope-writer` | 74 → 0 |
| `html-error-page-two-writers` | 2 writers → 1 |
| `dispatch-refusal-relay-duplication` | 2 HTTP relays → 1 |
| `tolerant-date-parse-date-twins` | 3 → 0 |

`lib-import-cycles` and `provider-auth-router-upward-imports` stay at 0.

### 10. Unchanged or low (re-measured)

| row | measurement at `e24f8d12` |
|---|---|
| `provider-resolution-incantation` | improved 5 → 3 by shape; the 3 are compound predicates in the key-deciding module itself |
| `connection-binding-predicate-drift` | `legacyFallbackTarget` remains |
| `run-page-identity-scrape` | `public/session.js:740,742,868` (0-line diff; LIN-3349 Backlog) |
| `periodical-report-filename-convention-split` | `periodicals.js:881`; 0-line diff |
| `ui-divergences-registry-staleness` | native `confirm(` 10 by the 10-11 method (comment lines excluded); loose 21 |
| `owner-word-collision` | 4 |
| `run-family-render-primitives` | 2/38 (`render-run-evidence.js`, `render-run-steps.js`) |
| `server-formatter-duplication` | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 |
| `simple-dispatcher-api-base-duplication` | SD 2; Harbour inline 30 |
| `persist-binding-sibling-seams` | 7 |
| `runner-liveness-assumption` | `liveness-detectors.js:79` |
| `periodic-loop-two-mechanisms` (new, informational) | The leased `lib/scheduler.js` (5 jobs) runs beside a bare hourly `setInterval` (`server.js:4524`). LIN-3424 made that hourly loop the only session sweeper (route-level sweeps 3 → 0, `lib/hourly-cleanup.js:84-91`). That consolidated the sweep onto the unleased mechanism, so it runs on every instance. Stability hand-off. |

**One-place decisions made outside LIN-3449 in this window, checked for overlap:**

| ticket | result |
|---|---|
| LIN-3503 | clean: one `NOBODY_LISTENING_MS` (`consumer-poll-warning.js:26`), imported by `liveness-detectors.js:70`; the old names have 0 references. The kit's `OTHER_CONSUMER_RECENT_MS` (10 min) is a separate, narrower value, but it is **coupled** to Harbour's: `runner.mjs:62` states the bound, and `runner-kit-helper.test.js` pins `OTHER_CONSUMER_RECENT_MS <= NOBODY_LISTENING_MS`. That is a cross-party pin, not drift. |
| LIN-3447 | clean: pure extraction, 1 caller |
| LIN-3424 | clean, apart from the mechanism note above |
| LIN-3269 | clean: one `runsUsed >= limit` (`free-tier-store.js:320`). The client copies of the "runs exhausted" check (`public/prompt-section.js:240-243,346-349`) pre-date the window. |
| LIN-3446 | clean: client-only, consumes the relay's `DUPLICATE_DISPATCH` |
| LIN-3395 | finding 6 |

### 11. Gauge-validity notes for LIN-3449 (not findings)

**`batch-guard-residue`: slightly worsened.**
- Batch 3 added **0** new guard files; all 9 new test files are behavioural.
- But it **re-pinned two count pins instead of deleting them**: `lin-3124-pr1-count-pins.test.js:175` (4 → 3) and `lin-3124-pr2-credential-census.test.js:41` (13 → 12), both in #1847.
- It re-keyed two scans (#1841 `owner-credential-durable-delete-census.test.js:189,235`; #1844 `run-limit-gating.test.js:253`) and added one `readFileSync` scan of `lib/dispatch-refusal.js` (`run-limit-gating.test.js:262`).
- Outside the batch, #1872 (`server-lifetime-retention-wiring.test.js:26,64,97-99`) and #1852 (`lin-3136-copy-surface-census.test.js:280-290`) added source scans.
- The three batch-1 guards are unchanged. Under LIN-3449's rule 4, a re-pinned count pin is a guard kept alive.

**Census (repo-native).**
- `admissions`: **123 → 123** (65 files, 34 sync tests at both SHAs; identical hit sets).
- `mirrored`: 3 / 43 PRs, all of them adoption of a new shared module (finding 7).
- `coupling --since 2026-10-11`: the script hard-codes `origin/main`, so I ran a scratch copy with only that string swapped. It found 56 PRs, 27 pairs and 18 with no import edge, all in `routes/`. The top unlinked pairs are `proxy-dispatch` ↔ `proxy-kickoff` (5), then `dispatch` ↔ `proxy` / `proxy-dispatch` / `proxy-kickoff` (4 each). That is the dispatch-entrance family, consistent with finding 7.
- TODO/FIXME added in the window: 0.

**Not flagged.**
- `lib/render-session.js:70` and `observer-efficacy-signal.js:110` `[blocked]|[pending]` regexes: a different decision from the wake regex.
- `lib/brief.js`'s prose fence strip: as at 10-11.

**Gaps stated.**
- SD-internal duplication was not re-audited; SD has 0 commits.
- Duplicated decisions among `public/` classic scripts remain largely invisible to the import walk and the census. Findings 3 and 8 found some by reading.
- Finding 2's production reach (rows with two bindings of one provider) is production data, not source, so it is unbounded here.
- Findings 4 and 6 are inferred from code, not reproduced over HTTP.

---

## Classes and their bounds

| class | how bounded | members |
|---|---|---|
| batch-3 decisions | LIN-3449's 11 Oct 23:36Z log table | 13: LIN-3464, 3465, 3466, 2427, 3467, 3468, 3469, 3470, 3471 (3486/3487/3488), 3472, 2663, 3473, 3474 |
| decision producers of `[decision]` rulings | read every writer of kind `decision` plus the kit prompt | 2 producers (SD `hook.js`, kit prose); 1 reader (`parseDecision`, 4 call sites) |
| binding choosers | named-function grep plus 2 shape greps at both SHAs | 7 named + 5 token-equality + 4 first-of-provider (the writer at `workspace.js:372` is one) |
| "waiting on a person" deciders | grep for `WAITING_WAKE_MARKERS` and `'blocked'` comparisons over `lib/`, `routes/`, `public/`, widened by the second read | 1 authority, 2 set copies, 5 inline checks (1 born in the window, `task-page-loader.js:148`), the agent-status mapping `pipeline-loops.js:312`, the label `recent-runs.js:39`, 2 channel rules (banner union vs clock feedback-only), 3 staleness rules |
| AI "not configured" gates | the 13 from 10-11 plus a grep for the not-configured 503 shape | 19: 13 behind `isAiUnavailable`, 6 outside |
| error-body producers outside `lib/errors.js` | grep for `{ status, body:` and the free-tier producer | 9 producers, 16 forwarding sites |
| run-row wire projections | `agentB` renorm script over the 23 names | 8 blocks (6 `proxy-dispatch`, 1 `proxy-kickoff`, 1 `pipeline-loops`) |
| production rows holding two same-provider bindings | **unbounded here**: production data, not source | — |

---

## Cross-repo contract verdicts (Harbour · SD · runner kit)

| field | verdict at `e24f8d12` / `3dc08b5` | delta vs 10-11 post-batch |
|---|---|---|
| halt | still differs 4 ways (finding 1); parity claim `runner-prompt.md:216`, kit comments `runner.mjs:199-203,235-236` | unchanged (High) |
| sentinel / `DECISION` / markers | kit can raise a ruling in a third producer form; `[pending]`, withdrawal, `[evidence]` and heartbeat still absent; LV wake copies 0; SD restates the wake regex (`feedback.js:22`) and cites `:53` (now `:63`); kit restates the terminal regex (`runner.mjs:80` ≡ `dispatch-terminal.js:36`) | **improved** capability; **new** `decision-dialect-split` |
| `target` | Harbour declares once (`dispatch-targets.js`); SD {cli,web} matches Harbour's *session* set, not its *polled* set {cli,web,dash}; kit filters nothing (it can take a `dash` item, inferred); poll unfiltered | Harbour improved; cross-repo unchanged |
| `repo` | SD alone validates; kit ignores | unchanged |
| row fields SD acts on, kit ignores | `queueIfBusy` (`followup.js:108`), `force` (`followup.js:62`, `abort.js:94`), `waitForFollowUps` (`dispatcher.js:1290`), `subscription` (`:1302`); LIN-3486 only reordered JSON keys, with every field a runner reads still projected | unchanged |
| `harness` | kit `'claude-code'` (`runner.mjs:59,133-136,468,470`) | unchanged (low) |
| 2000-char cap | SD truncates (`feedback.js:6`), kit throws (`runner.mjs:79,909`), Harbour 400 (`dispatch-feedback-validation.js:17`); new sub-split for decisions (prefix counted in SD, not in kit) | unchanged; +1 sub-split |
| error envelope on runner routes | `proxy-runner.js`, `runner-kit.js`: 0 commits; poll, take and feedback handlers untouched by LIN-3465/3466 | held |
| `kind`, `terminal`, `effort`, `model`, status enum | clean | held |
| API base | SD 2 copies; kit takes `baseUrl` from the server | unchanged |
| liveness | `ACTIVE_FRESH_MS` (`liveness-detectors.js:79`) assumes SD heartbeats; kit posts none. Kit polls feed `NOBODY_LISTENING_MS` (20 min); the LIN-3213 debounce only suppresses repeated `work` reports, so Harbour's reading is unchanged | unchanged (inferred) |
| CI | LV Node 20, `ci-success` `needs:[unit,e2e,secret-scan]`; SD Node 22, one job, no aggregate | unchanged |

---

## Sibling Hand-offs

**Documentation Review:**
- `docs/runner-prompt.md:216` parity claim, and its "Markers, exactly as Harbour reads them" block, which lists `DECISION: {…}` although Harbour stores the bare JSON or `[decision] {…}`
- `lib/session-telemetry.js:662` JSDoc describes only SD's decision form
- `lib/render-run-steps.js:155-156` cites the marker set in `routes/dashboard.js` / `pipeline-loops.js`; the authority is `digest-feedback.js:56`
- `observer-sweep.js:62` cites `pipeline-loops.js:47`
- `docs/architecture/source-map.md` mentions none of the 5 new modules or `lib/sample-data/`
- `lib/sample-data/mock-data.js` header still says "Mock data for E2E tests"
- SD `feedback.js:19` cites `dispatch-terminal.js:53` (now `:63`)
- SD `module-map.md`, `CLAUDE.md`, `substrate.md` and `session-lifecycle.md` never mention the kit
- LIN-3451 body citations: `runner.mjs:196` → `:214`; `:235` → `:253`; `dispatch-store.js:1057` → `:924`/`:793`; `runner-prompt.md:219` → `:216`; `dispatcher.js:603` → `:605`
- A LIN-3074 comment cites `runner.mjs:186` (now `:204`)
- Carried from 10-11: `docs/v1.md:110`, `lib/workspace-lookup.js:4-6`, `lib/connection-binding.js:11-12`, `server.js` `getWorkspaceAccessToken` caller note

**Design & Interface:**
- A revoked guest link reads "This page does not exist." on first load (`task-share.js:80-81`) but "This link is no longer available." on poll (`public/task-page.js:465`)
- The themed `render-email-auth` error pages and `renderWorkspaceNotFoundPage` beside `renderErrorPage`

**Stability:**
- `periodic-loop-two-mechanisms`: the session sweep now runs on the unleased hourly loop on every instance
- LIN-3395's refusal sits after the dispatch (finding 6, the user-visible part)

**Test Coverage:**
- Batch 3's +1,143 test lines
- The two re-pinned count pins
- No cross-party test that SD's and the kit's decision producers follow one rule
- The decision-stamp drift test omits `run-view.js`

**Code Quality:** the runner kit's missing HTTP timeouts (`runner.mjs:609-621`, unchanged).

**Security Review:**
- `getWorkspaceAccessToken` without an owner (unchanged)
- The kit's `runner feedback <id> decision '<the JSON>'` puts agent-written JSON inside single quotes on a shell line. An apostrophe in a label breaks the command (inferred); quoting is a trust-boundary question.

**API Quality:** GitHub priority offered and dropped (`provider-write-field-contract`), which the proxy catalogue documents.

**Data & Fetch Architecture, Dependency & Supply-Chain:** nothing new.

---

## Follow-ups (highest severity only)

Written in LIN-3449's agreed child-ticket style: one decision, the behaviour settled up front, and Done when one place decides, every caller uses it and the old copies are deleted. No guards, sweeps or count pins. Linear was searched before minting.

**Minted: none.** A ticket already owns each top-three finding, so this edition updates rather than mints. That follows the "search before minting; err toward under-creating" rule:
- finding 1: LIN-3451
- finding 2: LIN-2150, plus LIN-2188 for the writer residue
- finding 3: LIN-3339

Finding 3 also needs a behaviour ruling before a child ticket can be written in LIN-3449's style.

**Updated, not minted:**
- **LIN-2188**: the refresh writer's first-of-provider binding choice (finding 2), a second consequence of the same-provider multi-binding scenario it owns, now on the headless lane since LIN-3464. The one-line decision for a batch-4 ticket, if wanted, is in finding 2.
- **LIN-3451**: runner contract unchanged, plus the `decision-dialect-split` sub-row and line moves (finding 1)
- **LIN-2150**: the credential row re-measured after LIN-3464 (finding 2)
- **LIN-3339**: the "waiting for a person" candidate holds, with current sites and the behaviour question it needs answered first (finding 3); also the stamp-classifier and provider-write candidates (finding 8)

**Not promoted:**
- findings 4–8, below the cut
- the unchanged rows

---

## Ticket trend

| ticket | state at dispatch | change this window |
|---|---|---|
| LIN-3464, 3465, 3466, 2427, 3467, 3468, 3469, 3470, 3471 (3486, 3487), 3472, 2663, 3473, 3474 | Done | **converted**; 11 confirmed, 2 partial (LIN-2427 by shape, LIN-3471 by design) |
| LIN-3488 (wire re-normalisation) | Canceled | by John: scope added beyond LIN-3471's approval; its residue is recorded under `dispatch-entrance-field-duplication` |
| LIN-3451 (runner contract) | Backlog | unmoved and still parked; the kit moved around it (LIN-3505 split its decision part out); updated |
| LIN-2150 (credential migration) | Todo | unmoved; E1/E2 left the row via LIN-3464; updated |
| LIN-3349 (run-page rebuild) | Backlog | unmoved; `session.js` 0-line diff |
| LIN-3339 (One job, many paths) | In Progress | no commits; 1 of 5 candidates resolved (LIN-3469); the other 4 hold; updated |
| LIN-3074 (halt copy / runbook) | Backlog | unmoved |
| LIN-3347 (SD dead repo-guard refs) | Backlog | unmoved (SD 0 commits) |
| LIN-3475 / 3476 / 3477 / 3478 / 3479 | Backlog | already-minted batch candidates; their residues re-measured: 9 SSE preambles, 3 rebuilds, 5 `generatePrompt` literals, the dead `.text` wrappers |

**The promotion path keeps converting.** Every follow-up the 10-11 post-batch edition minted (LIN-3464, LIN-3465) or updated (LIN-2427) merged in batch 3 within two hours of that gauge (posted 15:38Z; merges 16:31Z–17:26Z). The rows that remain open are the ones nobody has put in a batch: the cross-repo contract, the wider credential decision, and the LIN-3339 candidates that need a behaviour ruling first.

---

## Adversarial Second-Read

**Tier used: Tier 2.** The reader was a fresh-context sub-agent with no memory of the report-writing turn. Tier 1, a separately dispatched session, was unavailable: this session's proxy token carries no `dispatch` grant (the `/instructions` grants line reads "(none)").

**Question asked:** "What is the largest item in this window that this report missed or misfiled?" The reader got only that question, the report path and PR #1878, both SHAs and the window bounds (`15990905..e24f8d12`, SD `3dc08b5`).

**Fields:** `Adversarial second-read verdict: DISAGREE` · `Differed from top finding: NO` · `Disposition: fixed in place`

**Reader's full answer:**

1. *Verdict: DISAGREE.* The top finding holds. Finding 3 has a material provenance error, and there are three smaller factual errors.
2. *Differs from the report's top finding: NO.* Every runner-contract citation the reader checked matches source, and nothing it found outranks a High cross-repo contract split.
3. *Largest missed/misfiled item: `human-wait-derivation-split` (finding 3) is filed as pre-existing, but it changed in the window.*
   - The report said "In this window the only change to these files was LIN-3468's regex import", the ledger said "pre-existing", and the LIN-3490 reading said only 2 rows were "born in the window".
   - `git log --oneline 15990905..e24f8d12 --` over the finding's own files returns 8 commits, including LIN-3504 (5cb05987, #1868) and LIN-3448 (6575161b, #1876).
   - **`task-page-loader.js:148` was created in the window by LIN-3504:** `const stale = wake && wake.marker === 'blocked' && state !== 'waiting';`. A grep for `=== 'blocked'` at `15990905` has no hit in that file; at `e24f8d12` it does. It is a new inline copy of the marker set, not an import of `WAITING_WAKE_MARKERS`.
   - It is also a new rule for "is the question stale", on the task page only. Its own JSDoc (`:139-140`) says `loop.waitingMessage` "stays on the loop for other pages… it mirrors the stale `[blocked]` line".
   - That makes at least three rules for "is the question still open":
     - the wire's resume-marker rule (`deriveBlockedStatus`, `dispatch-terminal.js:219-227`)
     - `loopIsWaiting`/`deriveSessionWaiting` (`routes/dashboard.js:354-412`)
     - LIN-3504's task-page rule
   - The class bound also misses `lib/pipeline-loops.js:312` (`if (agentStatus === 'blocked') return 'waiting';`), the root of the banner-vs-clock split, and `lib/recent-runs.js:39`, which labels "waiting on a person".
   - Cost: the row is growing through ordinary feature PRs, not sitting still. The LIN-3490 reading should say 3 rows were born or grew in the window, and the edit cost is larger than 3 + 5.
4. *Factual errors:*
   - (a) "Batch 3 is 13 decisions in 14 PRs": there are 15 batch PRs (#1835–#1844, #1846–#1850); #1845 is the LIN-3463 paper.
   - (b) Finding 1's `git log … -- lib/runner-kit docs/runner-prompt.md` returns 3 commits, not 2. a0d9c0de (LIN-3503) edits `runner.mjs:62` to bound the kit's window by Harbour's `NOBODY_LISTENING_MS`, pinned by `runner-kit-helper.test.js`. Calling it "a deliberately separate decision" is loose.
   - (c) The headline says "No new import edge" while edges go 1,435 → 1,476; LIN-3503 added `liveness-detectors.js` → `consumer-poll-warning.js`. The intended claim is "no new upward edge".
   - (d) The "2 High" in the LIN-3490 reading are one decision (`cross-repo-halt-vocabulary` is a sub-row of `runner-contract-semantics-cross-repo`), and `cross-repo-sentinel-decision-marker-vocabulary` overlaps `decision-dialect-split`. So "25 decision rows" overstates distinct decisions by 1–2.
5. *Checked and correct:*
   - window size and diff stats; new modules; 0 upward and 0 production→test imports
   - `keepalive` 74 → 0 and `keepaliveError` 75; `htmlError` 6 → 0; `sendSSE` 3 → 1; `getWorkspaceMirrorToken` → 0
   - `dispatch-targets` 9 and `dispatch-fields` 6 importers; `prepareRecommendationInput` at all 4 entrances
   - the 8 keepalive forwarding sites; its regex finds 9, but the 9th, `proxy-flight-companion.js:324`, is a 200/429, not a pre-built error body
   - the 6 not-configured gates outside `isAiUnavailable`
   - every finding-1 citation; no Harbour reader keys on the `[decision] ` prefix (`FEEDBACK_ENTRY_KINDS`, `dispatch-store.js:89`); marker tests 16 → 22
   - finding 2's writer and lane; finding 6's client order and 409
   - 53 + 6 ledger rows; LIN-3486's poll rows unchanged except for key order
   - nothing larger in the other non-batch PRs. LIN-2392's unguarded "17 templates" at `render-landing.js:373` is Documentation's.

**Disposition: fixed in place.** I re-checked each item at HEAD before applying it:
- `git grep "'blocked'" 15990905 -- lib/task-page-loader.js` is empty, and `git log` shows LIN-3504 and LIN-3448 on that file.
- `pipeline-loops.js:312` and `recent-runs.js:39` are as quoted.
- The runner-kit log shows 3 commits.
- The PR list covers #1835–#1850 with #1845 being the paper.

The changes:
- Finding 3 now says the row grew in the window through LIN-3504, and its class bound and cost add the agent-status mapping, the label and the 3 staleness rules.
- The headline says "no new upward edge".
- The PR count is 15.
- Finding 1 and the LIN-3503 row record the kit↔Harbour bound and its pin.
- The LIN-3490 reading counts **23 distinct decisions** (25 rows; halt and the decision dialect are sub-rows), now 1 High / 1 Medium-High / 3 Medium / 10 Low-Medium or Medium-Low / 8 Low, with **3** born or grown in the window.

The top finding, the severity order and the follow-up set are unchanged. Finding 3 stays Medium. Its ticket path is unchanged too: LIN-3339 is updated, because a behaviour ruling is still needed first.

---

## Compact trend ledger

`07-12` was never recovered (lost edition, task LIN-1231), so every 07-12 cell is `not recovered` and nothing is interpolated. Row names are stable. All 53 rows of the 10-11 post-batch ledger are carried in order, and their earlier cells are copied verbatim by script. The 6 new rows are appended. Severity is this run's grade.

| finding | severity | 06-25 | 07-12 | 08-29 | 2026-09-26 | 2026-10-11 | 10-11 post-batch | 10-12 post-batch-3 | delta |
|---|---|---|---|---|---|---|---|---|---|
| `lib-import-cycles` | resolved | clean | not recovered | 3 elementary cycles / 3 modules / 5 edges (latent) | kpi 3 (unchanged) + **new 2-node `dispatch-store ↔ digest-feedback`** (latent) | 4 SCCs / 27 members: provider 15 + **6 (kpi + dispatch/digest merged via `milestone-funnel`)** + new `run-evidence↔run-closeout-state` + new 4-node routes cycle (latent, 27/27 load alone) | **0 SCCs / 0 members** (385 nodes / 1,435 edges); walker reproduces 10-11 baseline exactly at `6df0fbd5`; 0 dynamic upward imports | **0 SCCs** (393 nodes / 1,476 edges); walker reproduces 15990905 (385 / 1,435 / 0) and 6df0fbd5 (377 / 1,369 / 4) exactly; 0 static / 0 dynamic upward imports; 8/8 new modules load alone | held resolved |
| `provider-auth-router-upward-imports` | resolved | 2 edges, no cycle | not recovered | 4 edges, all inside static cycles; SCC 13 (re-measured by this run at `292ac962`; not stated in the 08-29 edition) | 4 edges; **SCC 13→15** (+`github-install-flow`, +`render-settings`) | SCC 15 (unchanged); edges **4→5** (+`render-swipe.js:23`→`routes/workspace.js`) | **0** `lib/`→`routes/`/`server.js` edges (static and dynamic); SCC 15 gone; one wiring table `routes/provider-auth-routers.js:21` | 0 static / 0 dynamic `lib/`→`routes/`/`server.js` edges | held resolved |
| `routes-error-envelope-fragmentation` | low-medium | 5 importers, ~53 residue | not recovered | 14 importers, 68 residue (routes-only); `dashboard.js` half-adopter | 26 importers but **adoption flat** (11 from the `proxy.js` split); residue **76 → 87** matched-SHA; `flight-companion.js` **0 → 8** | 35 importers (no split artifact; 8 born-adopters + 1 genuine); residue **87→93** (`task-chat` +4, `runner-kit` +2) | 10-11 command **0** (LIN-3460); 43 importers; shape: **74** `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`, never seen by the command) + 8 pre-built `{status,body}` + 8 `res.status(<var>).json(` | 10-11 command **0** (both SHAs); `res.status(<var>).json(` **8** in routes+server.js (same 8 sites; the probe's 10 adds 2 `lib/` lines and reads 10 at baseline too); **9** pre-built `{status, body}` producers (the 8 + `chargeFreeTierOrReject` `routes/proxy.js:1363-1370`, present at baseline) forwarded by 16 sites; `errorEnvelope` 1 caller; `lib/errors.js` importers 43→42 | improved (keepalive half resolved); producer residue 9 (1 newly counted, not new) |
| `production-to-test-fixture-imports` | resolved | — | not recovered | 7 sites | 7 sites | 7 sites | 7 sites | **0** static / 0 dynamic outside `routes/test.js` (7 + 1 → 0, LIN-3472); no second copy left in `tests/fixtures` | **resolved** (LIN-3472) |
| `periodical-report-filename-convention-split` | medium-low | — | not recovered | id↔filename join non-mechanical | same | same (`periodicals.js:881`) | same (`periodicals.js:881`); this edition adds a `-post-batch` suffix | same (`periodicals.js:881`, 0-line diff) | unchanged |
| `dispatch-kind-vocabulary-cross-repo` | — | — | not recovered | 3 hardcoded keys | 3-key subset | `NO_BOOTSTRAP_KINDS` deleted (LIN-3199); bare `'wake'` literal only (18 lines / 10 files) | held resolved (SD 0 commits) | held (SD 0 commits) | held |
| `provider-resolution-incantation` | low | 4 sites | not recovered | 16 sites | **17 sites** (18 raw incl. canonical helper body) | **18 sites** (21 raw lines); new `superseded-selection.js:53` written to evade the count pin | 09-26 command **2** raw lines (leaf + exempt referent) = 0 hand-rolled; **shape: 5** (`workspace-urlkey.js:196,240,256,258`, `live-console.js:58`); pin replaced by a name-keyed guard | old command **2** raw (leaf + exempt referent); shape **3**, all compound predicates in the key-deciding module (`workspace-urlkey.js:197,257,259`); plain lookups 0 (LIN-3474); finder importers 10→13 | **improved** (5→3 by shape) |
| `ui-divergences-registry-staleness` | low | — | not recovered | registry 4 / actual 6 | registry 4 / actual **9** | native `confirm()` **9→10** (`proxy.js:389`) | native `confirm()` 10 | native `confirm(` **10** by the 10-11 method (comment lines excluded); loose grep 21 | unchanged |
| `simple-dispatcher-api-base-duplication` | low | — | not recovered | 2 | 2 | 2 (kit takes `baseUrl` from server) | 2 | SD 2 (`config.js:17`, `feedback.js:5`); Harbour inline `${req.protocol}://${req.get('host')}` 30 | unchanged |
| `cross-repo-halt-vocabulary` | **high** (sub-row of `runner-contract-semantics-cross-repo`) | — | not recovered | — | independently-defined `{pause,stop}` / `{mode,setAt,setBy}`; LIN-3074 | value single-authority; **meaning diverges 4 ways** SD↔kit; docs claim parity; LIN-3074 covers copy only | meaning diverges 4 ways (SD 0 commits, kit diff empty); `runner-prompt.md:219` parity claim stands | meaning diverges 4 ways (unknown mode SD fail-open `dispatcher.js:1654` / kit fail-closed `runner.mjs:214`; abort under stop; stop text `:605` vs `:253`; pause + follow-up `followup.js:40` vs `runner.mjs:209-212`); parity claim now `runner-prompt.md:216` | unchanged |
| `cross-repo-sentinel-decision-marker-vocabulary` | **medium** | — | not recovered | — | grammar split clean; word vocabulary duplicated | kit cannot emit `[pending]`/`[decision]`; wake regex ×3 un-imported; 1 cross-party pin | kit cannot emit `[pending]`/`[decision]`; wake regex authority `dispatch-terminal.js:63`, 3 copies; SD cite 10 lines stale | kit can now raise a ruling (LIN-3505) through a prose-only third producer form (see `decision-dialect-split`); `[pending]`/withdrawal still absent from kit; LV wake copies 0; SD restates the wake regex at `feedback.js:22` and still cites `:53` (now `:63`) | improved (capability); new dialect sub-row |
| `target-vocabulary` | medium-low | — | not recovered | — | 3 disagreeing LinearViewer lists + inline copies; SD owns runner set | LV 17 lines / 9 files (+`runner-owner-gate.js:22`); 3 lists persist; kit/Harbour poll unfiltered vs SD `cli`/`web` | 7 bracketed lists unchanged; 16 lines / 9 files (this run's method; 10-11's 17 not reproducible) | LV: one declaration `lib/dispatch-targets.js:17-27` (bracketed lists 7→3, all inside it; named lists 4→0; 9 importers). Default `'cli'` still restated ~18 server + ~10 client lines (`RUN_FIELDS.target` `dispatch-fields.js:53` does not import the declaration). SD `targets.js:15-18` {cli,web}; kit reads none; runner poll unfiltered (`proxy-runner.js:94`→`dispatch-store.js:924`) | **improved** (LV); cross-repo unchanged |
| `sse-frame-writer-duplication` | resolved | — | not recovered | — | 2 byte-identical copies of canonical `lib/sse.js:23 sendSSE` | 2 copies; **LIN-2663** tracks (not minted) | 2 copies (LIN-2663) | `function sendSSE` **1** (`lib/sse.js:23`); hand-written frames outside it 2→0; 9 hand-written `text/event-stream` header preambles remain (LIN-3475, Backlog) | **resolved** (LIN-2663); preamble residue owned by LIN-3475 |
| `routes-proxy-decomposition` | — | — | not recovered | — | `routes/proxy.js` 7,315→1,591 lines, 11 injected sub-routers | held (`proxy.js` 11 sub-routers); no new split this window | held | held | held |
| `cross-repo-repo-list` | **medium-low** | — | not recovered | deliberate | deliberate; LIN-2974 Done | Harbour list **deleted** (LIN-3333); SD alone validates; kit ignores `item.repo`; LIN-3347 SD-side only | unchanged | unchanged (SD alone validates `dispatcher.js:159-187`; kit ignores `item.repo`; LIN-3347 Backlog) | unchanged |
| `ci-convention-split-across-repos` | informational | — | not recovered | Node 20 vs 22 | same; `ci-success` `needs:[unit,e2e,secret-scan]` | same (Node 20 vs 22; `ci-success` `needs:[unit,e2e,secret-scan]`) | same | same (LV Node 20, `ci-success` `needs:[unit,e2e,secret-scan]`; SD Node 22, no aggregate) | unchanged |
| `semicolon-style-split` | low (informational) | unchanged | not recovered | unchanged | unchanged | unchanged (not re-measured; no style change observed) | not re-measured (new `routes/provider-auth-routers.js` omits semicolons) | not re-measured (#1873 added one missing `;` on a LIN-3487 import) | unchanged |
| `client-escape-html-duplication` | — | resolved | not recovered | held | held | held (1 definition) | held (not re-measured; `public/` diff touches only `common.js`/`observation.js`) | held (same count at both SHAs) | held |
| `client-shared-helper-duplication` | — | largely resolved | not recovered | resolved, held | held | held (`formatElapsed` pair noted under `server-formatter-duplication`) | held | held | held |
| `client-section-fetch-idiom-duplication` | — | resolved | not recovered | held (19 files) | held (**20 files**) | held (**23 files**) | held (24 files by `git grep -l window.api`, same at `6df0fbd5`) | held (24 files by `git grep -l window.api`, same at 15990905) | held |
| `linear-cli-parallel-graphql-surface` | — | resolved | not recovered | held | held | held (module absent) | held | held | held |
| `store-module-uniformity` | — | clean (10) | not recovered | clean (22) | clean (**24**) | **32/33** (33 stores); 1 naming outlier `pr-state-store` | 33 stores (no new store) | 33 stores (no new store) | held |
| `server-side-escaping` | — | clean (26) | not recovered | clean (45) | clean (**46**) | clean (**55**) | 55 importers | 54 importers (55 at 15990905; `routes/workspace.js` dropped with `htmlError`) | held |
| `dispatch-payload-centralization` | — | clean (5) | not recovered | clean (8) | clean (8) | clean (**5** by the 09-26 command; the 09-26 "8" was mis-stated) | held (not re-measured) | held (not re-measured) | held |
| `renderer-provider-abstraction` | — | clean | not recovered | clean | clean | held (not re-measured beyond provider seam) | held (not re-measured) | held (not re-measured) | held |
| `cache-module-family` | — | — | not recovered | clean | clean (7) | clean (7, two families) | held (not re-measured) | held (not re-measured) | held |
| `lib-components-primitive-adoption` | — | not assessed | not recovered | clean (30/30) | clean (**31/31**) | **36/38** (2 fragment modules) | 36/38 | 36/38 | held |
| `state-store-write-seam` (SD) | — | not assessed | not recovered | clean | clean | clean (incl. 3 new SD modules) | held (SD 0 commits) | held (SD 0 commits) | held |
| `phase-vocabulary-centralization` (SD) | — | not assessed | not recovered | clean, exemplary | clean, exemplary | clean (incl. 3 new SD modules) | held (SD 0 commits) | held (SD 0 commits) | held |
| `target-harness-axis-orthogonality` | — | not assessed | not recovered | clean | clean | clean | held | held | held |
| `test-seam-separation` | — | not assessed | not recovered | clean | clean | clean | held | held | held |
| `css-token-layer` | — | not assessed | not recovered | clean, 1 ratified outlier | does not reproduce (sibling-owned) | sibling-owned (Design & Interface) | sibling-owned | sibling-owned | routed |
| `runner-contract-semantics-cross-repo` | **high** | — | not recovered | — | — | **NEW: kit re-implements SD reactions; diverged on halt ×4, target, repo, markers** | unchanged on every row (LIN-3451, Backlog); corrections: `cascade`/`maxSessionsPerTask` never read by SD | halt ×4, target, repo, row fields (`queueIfBusy`/`force`/`waitForFollowUps`/`subscription`, 0 in kit), 2000-char cap ×3 behaviours, harness hard-code: all unchanged; kit `runner.mjs`/`broker.mjs` untouched by LIN-3505; LIN-3213 added `runner open` + wait debounce (capability gaps vs SD, not drift); decision now raisable in a third form | unchanged (High); +1 sub-row (`decision-dialect-split`) |
| `connection-binding-predicate-drift` | low-medium | — | not recovered | — | — | shared predicate + 3 inline copies lacking stale-marker guard; +1 copied selector | 3 copies → predicate (11 calls / 6 files); `legacyFallbackTarget` ≡ `selectIssueSourceBinding` remains | `legacyFallbackTarget` ≡ `selectIssueSourceBinding` remains (1 caller); predicate reference counts identical | unchanged |
| `run-page-identity-scrape` | medium | — | not recovered | — | — | `session.js:738-742,866` task id from neighbouring widget; LIN-3349 | `session.js:740,868`; LIN-3349 | `public/session.js:740,742,868` (0-line diff); LIN-3349 Backlog | unchanged |
| `dispatch-entrance-field-duplication` | low-medium | — | not recovered | — | — | `maxSessionsPerTask` ×5; fields re-serialised 6×/4× | cap field **deleted** (LIN-3461; 41-file PR); sibling `maxTasks` 116 lines / 15 files, validator ×5; other validators 15 lines / 5 files; store projections ×3 | 23 fields + 7 rules declared once (`lib/dispatch-fields.js:48-212`, 6 importers); store re-normalisation over the 23 names 93→**0**; `maxTasks` message 5→1 (+ trim's own `routes/dispatch.js:1381`); other validators 15/5→declaration; `maxTasks` 111 lines / 15 files. **Wire re-projection kept by design (LIN-3488 cancelled):** 34 lines in 6 `proxy-dispatch.js` blocks + `proxy-kickoff.js:489` + `pipeline-loops.js:757-796` (defaults `kind`/`target` → null vs declared `'custom'`/`'cli'`) | **improved** (partial by design) |
| `owner-word-collision` | low | — | not recovered | — | — | `viewerIsOwner:true` ×4 = "session member" | 4 sites | 4 sites | unchanged |
| `run-family-render-primitives` | low | — | not recovered | — | — | 2 fragment modules hand-build pills/buttons/details | 2/38 | 2/38 | unchanged |
| `persist-binding-sibling-seams` | low | — | not recovered | — | — | ×7 sibling seams | 7 seams; fallback bodies differ (feeds `credential-decision-multiplicity`) | 7 (`auth.js:303,430`, `jira-auth.js:328,700,798`, `account-merge.js:169`, `routes/test.js:77`) | unchanged |
| `server-formatter-duplication` | low | — | not recovered | — | — | `formatDuration`/`formatUsd`/`formatElapsed` copies | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 | `formatDuration` ×3, `formatUsd`/`fmtUsd` ×3, `formatElapsed` ×2 | unchanged |
| `wake-marker-regex-copies` | resolved | — | not recovered | — | — | 3 new LV copies, none import `dispatch-terminal.js:61` | 3 (`run-view.js:136`, `liveness-detectors.js:130`, `task-page-loader.js:60`) | LV literal copies 3→**0**; all import `dispatch-terminal.js:63` (LIN-3468); `public/` 0; SD copy tracked in the cross-repo row | **resolved** (LV) |
| `runner-liveness-assumption` | low | — | not recovered | — | — | `ACTIVE_FRESH_MS` assumes SD heartbeats; kit posts none (inferred) | `liveness-detectors.js:81`; kit posts no heartbeat | `liveness-detectors.js:79`; kit posts no heartbeat (its polls feed `NOBODY_LISTENING_MS`, not `ACTIVE_FRESH_MS`) | unchanged |
| `workspace-urlkey-consolidation` | — | — | not recovered | — | — | `deriveUrlKey` used by all 7 bind arms; per-arm derivations deleted (LIN-3382); Linear `org.urlKey`… (cell truncated in the 10-11 edition) | held (module untouched) | held (module untouched by LIN-3474) | held |
| `credential-decision-multiplicity` | **medium-high** | — | not recovered | — | — | — | ≥6 credential copies, ≥7 binding choosers, E1/E2 token precedences; session-scan returns `{token:NEW, scope:OLD}` after headless refresh (function-level repro); sweep watches 3 pairings | E1/E2 retired (`getWorkspaceMirrorToken` 0); the 10-11 repro now gives `{token:NEW, scope:NEW}`. Unchanged: 6 credential copies, 7 binding choosers (reference counts identical), expiry ranking ×3, 7 persist seams, sweep 3 pairings, legacy never converts (`connection-credential.js:1280`). The refresh writer rotates the first binding of the provider (`lib/workspace.js:372`) while readers match by token; LIN-3464 put the headless lane on that writer | **improved** (High → medium-high); structure unchanged |
| `keepalive-error-envelope-writer` | resolved | — | not recovered | — | — | — | 74 hand-built `keepalive.send(4xx/5xx,{error})` (73 at `6df0fbd5`) | old command 74→**0**; shape: 0 hand-built bodies; `keepaliveError` 75 sites; the 8 `keepalive.send(<var>, <var>)` sites forward pre-built bodies (counted under `routes-error-envelope-fragmentation`) | **resolved** (LIN-3465) |
| `html-error-page-two-writers` | resolved | — | not recovered | — | — | — | `htmlError` 9 vs `renderErrorPage` 116 (+4 raw text), pages differ | `htmlError` 6→**0**, `.html(` 9→0, raw-text 4xx/5xx 4→0; `renderErrorPage` 116→124 external sites (+9 from LIN-3466 exactly, −1 via `renderServiceUnavailablePage`); themed `render-email-auth` family unchanged (Design) | **resolved** (LIN-3466) |
| `ai-availability-gate-duplication` | medium-low | — | not recovered | — | — | — | 2 OpenRouter key resolvers; 13 inline 503 gates, 2 mock dialects; data-mock predicate inline ×34 (38 at `6df0fbd5`) | key resolvers 2→**1** (`resolveChatCredential`, 36 calls; `resolveProxyLLM` comment-only); the 13 named gates→`isAiUnavailable` (`chat-request.js:74`). Remaining: the mock flag is a parameter still fed 2 dialects (`isTestMode` ×6, `shouldMockAi(workspace)` ×6); **6 more** not-configured gates outside it (`workspace-api-roadmap.js:285,798`, `flight-companion.js:728,888`, `dashboard.js:2798,2984`; present at baseline, so the true total was 19); `isRecommendationEnabled` (1 call) and `getOpenRouterSource` (`server.js:1017-1025`) restate the order; data-mock predicate ×34 | **improved**, partial |
| `dispatch-refusal-relay-duplication` | resolved | — | not recovered | — | — | — | refusal→HTTP relay written twice (`routes/proxy.js:878-1010`, `routes/dispatch.js:880-918`); LIN-3461 mirrored a branch into both | HTTP relay 2→**1** (`lib/dispatch-refusal.js:39`, reached by `routes/dispatch.js:887` and `routes/proxy.js:842` + 4 injected callers); 1 non-HTTP mapping left (`workspace-api.js:3528-3536`, inline `'RUN_LIMIT_UNVERIFIED'`) | **resolved** (LIN-3470); 1 low residue |
| `tolerant-date-parse-date-twins` | resolved | — | not recovered | — | — | — | 3 private Date-returning parses (`liveness-alarm-store:287`, `pipeline-loops:264`, `session-telemetry:66`), junk semantics differ | `toDate`/`_toDate` 3→**0**; both inline closures use `toEpochMs` (36 importers); 3 small private normalisers remain (`proxy-alarms.js:86-91`, `consumer-poll-warning.js:107-108`, `task-page-loader.js:84-86`) | **resolved** (LIN-3473) |
| `timestamp-parse-consolidation` | — | — | not recovered | — | — | — | `toEpochMs` 30 importers; ticket grep 0 (LIN-3453) | `toEpochMs` 36 importers | held |
| `loose-json-consolidation` | — | — | not recovered | — | — | — | 1 owner, 8 importers; no brace-slice elsewhere (LIN-3114) | 1 owner, 8 importers | held |
| `ai-mock-predicate-consolidation` | — | — | not recovered | — | — | — | `shouldMockAi` 1 definition, 8 importers (LIN-3459) | `shouldMockAi` 1 definition | held |
| `batch-guard-residue` | informational | — | not recovered | — | — | — | 3 batch-1 source-scan guards (lin-2389, lin-3452, loose-json); batch 2 added none | batch 3 added **0** new guard files, but re-pinned 2 count pins instead of deleting them (`lin-3124-pr1-count-pins.test.js:175` 4→3, `lin-3124-pr2-credential-census.test.js:41` 13→12), re-keyed 2 scans, and added 1 `readFileSync` scan (`run-limit-gating.test.js:262`); outside the batch #1872 and #1852 added scans; the 3 batch-1 guards are unchanged | slightly **worsened** (pins re-pinned, not removed) |
| `decision-dialect-split` | **medium** (sub-row of `cross-repo-sentinel-decision-marker-vocabulary`) | — | not recovered | — | — | — | — | kit `DECISION:` is a prose-only producer (`runner-prompt.md:170-181`: raw JSON, only before `BLOCKED:`, no prefix, validation, dedupe or withdrawal) beside SD's `hook.js:588-659` (`[decision] ` + re-serialised JSON, any sentinel, 2000-char gate incl. prefix, dedupe, `WITHDRAW:`); one tolerant reader `parseDecision` (`session-telemetry.js:669`) | **new row** (LIN-3505) |
| `human-wait-derivation-split` | **medium** | — | not recovered | — | — | — | — | "which marker means waiting on a person": exported `WAITING_WAKE_MARKERS` (`digest-feedback.js:56`) + 2 copies "keep in parity" (`render-run-steps.js:159`, `routes/dashboard.js:338`) + 5 inline `'blocked'` checks (`run-view.js:232`, `task-page-loader.js:148` (new, LIN-3504), `dispatch-terminal.js:225`, `unanswered-decisions.js:71`, `observer-sweep.js:97`) + agent-status mapping `pipeline-loops.js:312`; banner unions `agentState === 'waiting'` (`dashboard.js:356`), clock reads feedback only (`run-view.js:226-243`); 3 staleness rules | **new row** (LIN-3339 candidate; pre-existing, grew in the window via LIN-3504) |
| `decision-stamp-classifier-copies` | low-medium | — | not recovered | — | — | — | — | `isDecisionLifecycleStampEntry` (`digest-feedback.js:86`) + 5 membership copies (`run-view.js:129`, `session-telemetry.js:60`, `wall-clock-summary.js:64`, `public/dispatch.js:1132`, `public/session.js:283`); parity test lists 4, not `run-view.js` | **new row** (LIN-3339 candidate; pre-existing) |
| `provider-write-field-contract` | low-medium | — | not recovered | — | — | — | — | GitHub inherits `ui.priority: true` (`providers/interface.js:250`) but `updateIssue` drops priority (`providers/github/index.js:834-854`); the proxy catalogue documents the drop | **new row** (LIN-3339 candidate; pre-existing) |
| `close-out-merged-refusal-split` | low-medium | — | not recovered | — | — | — | — | "this PR is already merged" refuses the close-out *record* (`workspace-api.js:4631-4636`, LIN-3395) but the client enqueues first (`public/close-out.js:116` then `:128`); `closeOutRefusal` (`dispatch-factory.js:739`) does not check it; `run-evidence.js:102` decides "merged" from live PR state | **new row** (LIN-3395) |
| `periodic-loop-two-mechanisms` | informational | — | not recovered | — | — | — | — | leased `lib/scheduler.js` (5 jobs) beside the bare hourly `setInterval` (`server.js:4524`, `lib/hourly-cleanup.js`), which LIN-3424 made the only session sweeper | **new row** (pre-existing; Stability hand-off) |

*Measured at `LinearViewer` `e24f8d12` / `simple-dispatcher` `3dc08b5`. Next run: re-ground every row against HEAD, not against this prose.*
- *Keep both counts for `routes-error-envelope-fragmentation` (the 10-11 command plus the 9 producers), `provider-resolution-incantation`, and the AI gate (named gates plus not-configured shape).*
- *Keep the Tarjan walk; a single new SCC would be news.*
- *Watch items: whether LIN-3451 is unparked now that the kit moves alone; whether LIN-2188's scenario is declared real (the writer residue); a ruling on whether agent-status starts a waiting clock (LIN-3339).*
