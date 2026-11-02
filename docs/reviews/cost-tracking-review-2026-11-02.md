# Cost tracking review — 2026-11-02

Task: LIN-4126 · Parent: LIN-3936 · Docs only: no production code changed.

**Commits read:** Harbour (`JKershaw/LinearViewer`) `d35e8b6eb10357b7ab646e4cb693ea4a3d57ee7c`; runner (`JKershaw/simple-dispatcher`) `cf6369dfdf0a04140a1aeac9a347eea685ca51c7`. Neither repo had a commit after the ticket was created (08:37Z), and both were at `origin/main`. Line references without a prefix are Harbour. `SD:` means the runner.

**Stored records read** (no calls to outside services):
- Harbour's own records through the workspace proxy: the 100 newest dispatch rows with their feedback, `GET /api/proxy/cost/LIN-n` for LIN-3700 to LIN-4125, and the model-routing table and log.
- On the runner host: `state/oplog.jsonl` and `.env` (key names only), the running dispatcher's environment (names only), and the Claude Code transcripts under `~/.claude/projects`.

The scripts and their aggregate outputs are in `docs/reviews/_evidence-2026-11-02-costs/`.

This was written from the code and the records, not from earlier tickets. Section 6 says what earlier work found, so the reader can see where this report agrees with it and where it does not.

## Headline

1. **Since 1 Nov 17:09Z no agent session has reported usage.** In the 100 newest dispatch rows (03:14Z to 08:38Z on 2 Nov), no feedback entry has `kind:'usage'`. The cause is the runner's relay flag:
   - The runner posts usage only when `SD_WORKER_USAGE_RELAY` is set, and it defaults to off (`SD:config.js:1318-1320`).
   - The live runner host does not set it, neither in its `.env` nor in the running dispatcher's environment.
   - That host's oplog holds 0 `[usage]` posts in 80,572 lines (July–August and November).
   - The transcripts on that host show **$238** of agent work at list price in this window. All of it is invisible to Harbour.
   - *Fix: turn the flag on, and make the runner's default on.*
2. **Even with the flag on, the design under-reports by about a third.** Over the same 77 sessions, what the relay would post prices to **$165 of $238 (69%)**. The gap has two causes:
   - **Haiku 5.5 sessions (12 of the 77, $57).** A cumulative Haiku 5.5 session always prices to null. That has been true since implementation moved to Haiku on 24 Oct 20:21Z.
   - **Subagent transcripts ($16.5).** They are never read.
3. **Harbour's own calls are the healthy path.**
   - Every call that completes is logged with OpenRouter's billed cost: one endpoint (`lib/openrouter.js:27`), five call points, each followed by `recordLlmCall`.
   - Its gaps are attribution and failures, not missing rows: which key paid is not recorded, calls that fail or are aborted part-way leave no row, and issue-less calls are invisible per issue.
4. **The figures disagree because cost is summed in three lineage engines with different rules,** plus four ways of treating an unpriced call. Two of these are visible in stored records:
   - The per-issue cost route counts a waking parent's whole lineage under every child issue. One autopilot lineage was counted under 7 issues.
   - A cost frozen at write time sits under a read model that the code says re-prices.
5. **Recommendation:**
   - **Repair now:** the flag, subagents, the wake bug and four other one-file fixes.
   - **Then rebuild the worker usage path with the Theseus method,** into one per-message usage ledger with one reader. Section 5 gives the case for doing both.

---

## 1. The landscape: every path a model call can take

### 1.1 Paths

| # | Path | Where usage starts | How it is recorded | How it is priced | How it is summed | What reads it |
|---|---|---|---|---|---|---|
| P1 | **claude-code session**, main transcript (cli and web targets, `SD:targets.js:16-19`) | `walkUsage` reads the session's main JSONL transcript. It folds lines that share a `message.id` by per-field max and sums the messages. The **last-seen model** labels the whole sum (`SD:transcript.js:424-476`, `:456`) | `postUsageSnapshot` sends a **cumulative** `[usage] {json}` message, `kind:'usage'`, on 7 of the hook's 8 Stop branches (`SD:hook.js:359-377`, `:1800`…`:2156`). It sends only when the flag is on (`SD:config.js:1318`). One attempt, 15s timeout, no retry (`SD:feedback.js:15-17`). Harbour appends the raw string to the row's `feedback[]` in `dispatch-history` (`lib/dispatch-store.js:3146-3207`) | Priced at **read** by `parseUsagePayload` → `computeUsageCostUsd` from the static rate card (`lib/session-telemetry.js:416-475`, `lib/model-pricing.js:347-416`). Also priced at **write** into `feedbackDigest.telemetry.usage.costUsd` (`lib/digest-feedback.js:359`, `:602`) | Last entry wins per lineage. There are three engines (§1.4) | §1.3 readers R1–R15 |
| P2 | **claude-code subagents** (Task/Agent tool) | Separate files at `<session>/subagents/agent-<id>.jsonl` | **Not recorded.** `walkUsage` reads only `transcript_path` (`SD:hook.js:1722`). The comment and test that say sidechain lines are counted (`SD:transcript.js:411-414`, `SD:test/transcript.test.js:488`) describe a layout the host no longer has: 0 sidechain lines in any main transcript since 1 Nov (evidence `measure-window.json`, `sideInMain: 0`) | — | — | — |
| P3 | **Follow-up, resume and wake** of a claude-code session | The same transcript (`--resume`, `SD:executors.js:442`). The row keeps the original `rootItemId` (`SD:dispatcher.js:1097`) | As P1. The snapshot covers the whole lineage so far, posted to the follow-up's row | As P1 | As P1. A wake row carries the *child's* `issueIdentifier` and the *parent's* `rootItemId` (`lib/dispatch-wake.js:222`, `lib/dispatch-store.js:39`) | As P1 |
| P4 | **opencode session** | OpenCode's `GET /session/:id` running total, read before and after the run (`SD:opencode-runner.js:614-648`, `:1322-1341`) | A **delta** per run, with native `costUsd` and `lane:'openrouter'` hard-coded (`SD:opencode-runner.js:586-603`). No 1h cache split, no reasoning tokens. The error and hold paths post nothing (`:1741-1800`, `:803-1060`) | Native cost wins (`lib/session-telemetry.js:471-473`) | Should be **summed** per row. Engine R11 sums; engine R1 keeps only the last entry (§1.4) | As P1 |
| P5 | **runner-kit** (Harbour's own `lib/runner-kit/runner.mjs`) | Reads the subagent's own `agent-<id>.jsonl`. The model is the one with the **most output tokens** (`lib/runner-kit/runner.mjs:578-613`) | Posted only when the orchestrating model runs `runner usage <agentId>`, as `docs/runner-prompt.md:180` tells it to (`runner.mjs:1189-1203`). The orchestrator's own tokens are never posted. A non-200 response throws, with no retry (`:944-948`) | As P1 (labelled `harness:'claude-code'`, `:60`) | As P1 | As P1 |
| P6 | **`local` / Harbour OS spawn** | No producer. `lib/harbour-spawn.js:151-193` only passes a token | Not recorded | — | — | — |
| P7 | **Harbour's own calls** (16 jobs, `lib/llm-jobs.js:64-79`) | OpenRouter only (`lib/openrouter.js:27`), with `usage:{include:true}` (`:1172`, `:1416`, `:1472`, `:1621`, `:2008`) | One endpoint, five call points, each followed by `recordLlmCall` (`:1289`, `:1430`, `:1526`, `:1633`, `:2024`) → `llm-call-log` (`lib/llm-call-log.js:55-89`, `server.js:689-693`). Kept for life (`lib/db-indexes.js:48-52`). No row for a non-OK status, an abort or a timeout (`openrouter.js:1177`, `:1323`, `:1537`, `:1653`). No row says which key paid | OpenRouter's billed `usage.cost` (`extractUsage`, `openrouter.js:504-518`). The rate card is never used for these calls | Per call, so no dedupe is needed. Unpriced calls are handled four ways (§1.4) | R2–R8 |
| P8 | **Paid scripts outside the product** (evals, spikes) | Direct `fetch` or `lib/` with no recorder (e.g. `scripts/eval-research-routing.mjs:566`, `scripts/eval/jev-routing-eval.mjs:78`) | Not recorded | — | — | — |

### 1.2 Pricing

- **One rate card** (`MODEL_PRICING`, `lib/model-pricing.js:111-177`) and one resolver (`resolveWorkerModelId`, `:232-242`). The resolver passes an exact table id through, strips one `-YYYYMMDD` suffix, and maps `claude-<family>-<n>-<m>` to `anthropic/claude-<family>-<n>.<m>`. Anything else is null, including `<synthetic>` and the aliases `opus`/`sonnet`/`haiku`.
- **Long-context tiers** apply to the cumulative prompt total (input + cache read + cache write). If a claude-code session crosses any tier threshold, its cost is **null** (`:360-367`). The reason is that the tier gates a single request, and a cumulative total cannot be split back into requests (`:326-340`).
  - Haiku 5.5's tier starts at 100k (`:164-167`).
  - One Haiku session in this window had a median prompt of 466k *per request*, and 96% of its requests were over 100k (§2.2).
  - So effectively every claude-code Haiku 5.5 session is null.
- **The unpriced registry is in-process and capped at 50** (`lib/unpriced-models.js`), and it is filled only by reads.
- **The hourly conformance sweep** compares the card with the OpenRouter catalog. Its output goes to the console only (`lib/pricing-conformance-sweep.js:213-249`). It reports only ids that do not resolve, so nulls from a crossed tier or a missing tier never appear in it.
- **Model ids are resolved, or prices held, in 9 places.** The full list is in §4. They do not conflict on rates, but they do conflict on alias rules: `lib/openrouter.js:323` uses a different Claude regex, and `lib/model-routing-harnesses.js:57-66` maps `opus` to Opus 5.5 for price hints while usage labelled `opus` prices to null.

### 1.3 Readers

| # | Reader | Source | Lineage rule | Unpriced | Shown on |
|---|---|---|---|---|---|
| R1 | `buildTaskCost` (`lib/task-cost.js:85-188`) | dispatch rows, merged feedback | 3-tier anchor (`:51`); last entry wins **for every harness** (`:120`); **no wake exclusion** | `totalUsd` null if anything is unpriced (`:177`); a cost of 0 counts as priced | the engine behind R2, R7 and R9 |
| R2 | `/api/proxy/cost/:id` (`routes/proxy-compute.js:643-717`) | R1 + `summarizeByIssue` | R1; 30d of history but queued rows unbounded; siblings capped at 2000 | R1 | agents and scripts |
| R3 | `summarizeByIssue` (`lib/llm-call-log.js:255-290`) | call log | — | counted separately | feeds R2 |
| R4 | `summarize` (`lib/llm-call-log.js:164-238`) | call log, 30d | — | **null counted as 0** (`:180`), which contradicts its own docstring (`:148-150`) | Settings › Health (`routes/settings.js:276`); Ship's Biscuit, always 30d whatever the edition's window (`routes/ship-biscuit.js:155`) |
| R5 | `summarizeByFeature('scan')` (`:310-333`) | call log | — | mean of priced calls only | the scan estimate (`routes/dashboard-feed.js:653`) |
| R6 | `harbourSpendByJob` (`lib/model-routing-spend.js:95-102`) | call log | — | counted separately | Settings › Models |
| R7 | `agentSpendByJob` / `typicalByModel` (`lib/model-routing-spend.js:60-79`) | R1 over the newest 2000 rows | R1; `AGENT_JOB_IDS` only, so no wake | counted separately | Settings › Models; Home decision panel (`routes/dispatch.js:688-696`) |
| R8 | `spendByEffectiveModel` (`:132-141`) | R6 + R7 | — | priced only | Models sidebar |
| R9 | `computeEffortReadout` (`lib/effort-readout.js:433-470`) | R1 over the newest 200 rows, **no time bound** | R1 | priced only | `/workspace/:urlKey/effort-readout` |
| R10–R11 | `groupDispatchLineages` + `reduceLineageCost` (`lib/dispatch-lineage.js:158-268`, `lib/terminal-marked-task-cost.js:142-170`) | each row's last usage entry | 2-tier key (`:178`); **wake excluded from attribution** (`:204-209`); opencode **summed**, others last wins, chosen by the *requested* harness | lineage dropped if not fully priced | engine |
| R12 | `computeTerminalMarkedTaskCost` (`lib/terminal-marked-task-cost.js:215+`) | R10/R11 over the KPI projection | R10 | whole issue dropped if any lineage is unpriced | public `/kpis` "Cost per finished task" (`lib/kpi-stats.js:1304-1313`) |
| R13 | `computeWeeklyBudgetGauge` (`lib/weekly-budget.js:157-225`) | R10/R11 | R10 | excluded | **nothing**: computed (`lib/kpi-stats.js:1142`), never emitted |
| R14 | `windowedSpend` (`lib/weekly-budget.js:117-141` ← `lib/workspace-kpi-stats.js:72-99`) | R10/R11 | R10; whole lineage dated to its start day | partial sums, "priced N of M" | `/workspace/:urlKey/kpis` |
| R15 | `run-view.lineageCost` (`lib/run-view.js:251-274`) | loop telemetry; the **digest's frozen cost** on lean builds (`lib/pipeline-loops.js:245`, `:292-295`) | `lineageId ?? loopId`; last loop wins; total shown only for claude-code (*realised* harness) | **0 or null shows as "not reported"** (`:261`) | run and session page |

Research scripts (`scripts/survey-*`) read R2 or transcripts and are not product surfaces. No reader of OpenRouter's credits API exists, so nothing compares any figure with the bill.

### 1.4 Where usage is lost, double-counted, or read differently

**Lost** (most money first):

| # | Loss | Evidence | Size in the window (§2) |
|---|---|---|---|
| L1 | The relay flag is off on the live host | `SD:config.js:1318-1320`; README shows `=0` (`SD:README.md:202`); host `.env` and the process environment do not set it; 0 `[usage]` posts in the host oplog | **all** agent sessions since 1 Nov 17:09Z, $238 |
| L2 | A cumulative Haiku 5.5 session prices to null | `lib/model-pricing.js:164-167`, `:363-367`; implementation moved to Haiku at 2026-10-24T20:21Z (model-routing log) | 12 of 77 sessions, $57 (24%). In records: 124 lineages from 24 to 31 Oct (§2.1) |
| L3 | Subagent transcripts are never read | `SD:hook.js:1722`; no `subagents/` reference anywhere in the runner | 9 files in 4 sessions, $16.5 (7%) |
| L4 | The final snapshot can be taken before the last turn is flushed. When the hook has `last_assistant_message`, it skips the settle and reads the transcript once (`SD:hook.js:1715-1722`). A text-only turn may not be on disk at Stop (`SD:hook.js:1708-1713`) | code; the cause is not witnessed here | not measurable while L1 holds |
| L5 | Usage is never posted for a killed, cancelled or timed-out session, or after the last Stop. Only `Stop` is hooked (`SD:executors.js:84-93`); no reaper posts usage | code | not measurable while L1 holds |
| L6 | A last-seen `<synthetic>` model nulls the whole session. `walkUsage` takes the last model (`SD:transcript.js:456`) and the resolver rejects `<synthetic>` | 2 host sessions resumed on 1 Nov ended on a synthetic message; their main transcripts hold $118 at Opus 5 rates (`measure-nov.json`) | 2 sessions, outside the window by start date |
| L7 | Harbour calls that fail or are aborted part-way leave no row | `lib/openrouter.js:1323`, `:1537`, `:1653` | not in any record, by construction |
| L8 | opencode posts nothing from its error and hold paths, and the next baseline already includes that spend | `SD:opencode-runner.js:1741-1800`, `:803-1060` | no opencode sessions in the window |
| L9 | runner-kit never posts the orchestrator's own tokens, and posts only if the model runs `runner usage` | `lib/runner-kit/runner.mjs:1189-1203` | runner-kit not in use in the window |
| L10 | Paid scripts and `local` spawns record nothing | P6, P8 | unbounded (no records) |
| L11 | An unknown feedback `kind` is dropped silently and stored kind-less, so every usage reader ignores the entry | `lib/dispatch-feedback-validation.js:38` | none seen |

**Double-counted:**

- **D1 (witnessed).** R1/R2 has no wake exclusion. A parent lineage is counted in full under every child issue that a wake row stamped. In the sweep, 11 wake-anchored lineages appear under 2 to 7 issues each, which adds $127.40 of extra counting; the largest, `defb22a2`, is $15.99 counted 7 times (`sweep-summary.txt`). R10 excludes wake rows on purpose (`lib/dispatch-lineage.js:204-209`).
- **D2.** A cross-issue follow-up is counted under both issues on R2. This is documented as a known limitation in `lib/proxy-instructions.js` (the `/cost` entry); R10 counts it once.
- **D3 (latent).** A row whose requested harness says `opencode` but which ran claude-code is summed across cumulative snapshots by R11 (`lib/terminal-marked-task-cost.js:146-151`).

**Read differently** (the same work shows different numbers):

- **Q1.** opencode lineages: R1 keeps the last row's delta (an under-count), R11 sums the rows, and R15 shows "as reported" with no total.
- **Q2.** A cost of `0` counts as priced in R1, R6 and R11, but shows as "not reported" in R15.
- **Q3.** Unpriced Harbour calls: counted as $0 in R4, counted separately in R3/R6, averaged out in R5, and in R1 they null the whole total.
- **Q4.** What is included:
  - R2: worker plus issue-tagged Harbour calls;
  - R4: all Harbour calls;
  - R7/R8: separate sections, summed only in the sidebar;
  - R9, R12, R14, R15: worker only.
- **Q5.** Unpriced handling across a set: all or nothing in R2 and R12; partial sums in R7, R9 and R14.
- **Q6.** Windows:
  - R2: 30d plus unbounded queued rows;
  - R7: 30d, newest 2000;
  - R9: newest 200, no time bound;
  - R14: 30 UTC days, by lineage start day;
  - R12: 30d, `[done]` lineages only;
  - R15: unbounded.
- **Q7.** Re-priced versus frozen: R1, R11 and R2 re-price at every read. R15 on lean builds reads the digest's cost, priced at the last feedback write (`lib/pipeline-loops.js:292-295`), and the digest is stale only when `feedbackVersion` moves (`lib/digest-feedback.js:471-475`). The materializer's version bumps v18–v20 "to reprice" (`lib/observation-sessions-store.js:177-192`) rebuild from those frozen digests.
- **Q8.** Four lineage-anchor definitions: `lib/task-cost.js:51`, `lib/dispatch-store.js:303`, `lib/dispatch-lineage.js:178` and `lib/dispatch-lineage-status.js:69`. Only the R10 one lacks the feedback-tag fallback.
- **Q9.** USD formatting: $0.004 shows as "$0.00", "<$0.01" or "$0.0040" depending on the page (`lib/render-kpis.js:132`, `lib/components/decision-panel.js:33`, `lib/render-settings.js:88`).

---

## 2. Completeness

### 2.1 Dispatch records, 19 Oct – 2 Nov (Harbour's stored records)

Source: `GET /api/proxy/cost/LIN-n` for every issue from LIN-3700 to LIN-4125. This route is a pure read of stored dispatch rows plus the call log (`routes/proxy-compute.js:643-717`). One row below is one worker lineage, dated by its earliest row. Raw per-issue JSON was not committed. The aggregate is `sweep-summary.txt` and the script is `sweep.py`.

| Day (UTC) | Lineages | With usage | Priced | Priced USD | Usage but unpriced |
|---|---|---|---|---|---|
| 19 Oct | 20 | 17 | 17 | $42.78 | — |
| 20 Oct | 142 | 142 | 142 | $161.86 | — |
| 21 Oct | 58 | 58 | 58 | $213.40 | — |
| 22 Oct | 1 | 1 | 1 | $6.20 | — |
| 23 Oct | 287 | 286 | 286 | $435.34 | — |
| 24 Oct | 267 | 256 | 249 | $447.35 | 7 (Haiku 5.5) |
| 25 Oct | 327 | 324 | 258 | $466.09 | 66 (Haiku 5.5) |
| 26 Oct | 126 | 120 | 100 | $197.14 | 20 (Haiku 5.5) |
| 27–28 Oct | 0 | — | — | — | — |
| 29 Oct | 69 | 60 | 47 | $111.19 | 13 (Haiku 5.5) |
| 30 Oct | 104 | 102 | 86 | $198.99 | 16 (Haiku 5.5) |
| 31 Oct | 15 | 15 | 13 | $28.61 | 2 (Haiku 5.5) |
| **1 Nov** | **80** | **0** | **0** | **$0** | — |
| **2 Nov** (to 08:38Z) | **42** | **0** | **0** | **$0** | — |

**Totals.**
- **19–31 Oct:** 1,416 lineages. 1,381 have usage (97.5%) and 1,257 are priced (88.8%).
- **From 24 Oct, when Haiku took implementation:** priced falls to 83%.
- **1–2 Nov:** 0 of 122.

**Lineages with usage but no price.** All 124 are `claude-haiku-5-5` (L2). The sweep records the model, and no other model appears unpriced.

**Double count (D1).** 11 lineages, all anchored on a wake row, appear under more than one issue. The extra counting comes to **$127.40**. The largest is `defb22a2`: $15.99 under 7 issues (LIN-3747 to LIN-3752 and one more).

**How to read it.**
- *With usage* means the lineage has a usage snapshot. *Priced* means it also has a cost.
- The window starts at 19 Oct only because LIN-3700 was created then: the sweep is bounded by issue number, not by the route's 30-day horizon.
- 197 of the 426 issues had no lineage at all (`noLineage: true`). These are mostly tickets never dispatched, or landed inside another ticket's lane.
- A lineage counted under two issues appears once per issue in the table.

### 2.2 Since the live runner booted (1 Nov 17:09Z – 2 Nov ~08:50Z)

**Harbour's records.**
- The 100 newest dispatch rows (03:14Z–08:38Z) have **0** usage entries.
- Feedback kinds present: 2,295 status, 1,058 assistant-text, 650 heartbeat, 101 evidence, 1 decision, 1 decision-withdrawn, 123 kind-less.
- 22 of the rows name a claude-code model; 78 are wakes.
- Per-issue reads agree. LIN-4119 has 5 lineages and LIN-4112 has 8, every one with `noTelemetryCount` set and `totalUsd: null`.
- Source: `dispatch-recent-summary.txt`.

**The runner host's records.**
- The dispatcher (pid started 1 Nov 17:09) has no `SD_WORKER_USAGE_RELAY` in its environment.
- `.env` (dated 14 Jul) holds only `DISPATCH_API_URL`, `POLL_INTERVAL_MS` and `SD_TERMINAL`.
- `oplog.jsonl` has 29,178 `feedback.post` rows (July–August and 1–2 Nov), and none of them starts `[usage]`.
- So this host never relayed usage. The sessions that were priced up to 25 Oct must have come from a runner configured elsewhere. That last point is inferred: no other host's records are reachable from here.

**Transcripts on the host** (77 claude-code sessions whose first message falls in the window; `measure.mjs`, output in `measure-window.json`). For each session, the script computes:
- **truth:** each message priced on its own with Harbour's `computeUsageCostUsd`, so a per-request tier applies per request;
- **relay:** what the runner *would* post (its own fold: one total, last model) priced the way Harbour prices it.

| | Sessions | List price |
|---|---|---|
| Truth: main transcripts | 77 | $221.64 |
| Truth: subagent transcripts (9 files, 4 sessions) | — | $16.54 |
| **Truth: total** | | **$238.18** |
| What the relay would price, if it were on | 65 priced, 12 null | $164.79 (69%) |
| What Harbour holds | 0 | $0 |

- All 12 null sessions are Haiku 5.5 over the 100k tier (L2), worth $57.0 in truth.
- One of them, `15e40be5`, made 486 requests with a median prompt of 466k tokens; 96% of its requests were over 100k.
- No session in the window mixed models. Outside the window, session `9c9e2428` (Sonnet then Opus) shows the effect of a last-model label: the relay would price it at $16.11 against $13.84 in truth.

### 2.3 Harbour's own calls

- In the sweep, the 229 issues with a lineage carry **2,600** issue-tagged Harbour calls in the 30-day window, worth **$51.95**. **0** of them are unpriced. Every call that completed and was tagged with an issue has a price.
- Even so, 111 of those 229 issues read `totalUsd: null`. In every case the cause is the worker side, not the Harbour calls.
- Calls with no issue (run-summary, session-summary, run-paragraph, feedback-title, flight-companion, observer-pass, ship-biscuit, roadmap-orientation/chat) are not visible per issue by design (§1.1 P7). No proxy route reads the whole log, so their share could not be measured from here.
- Failed and aborted calls (L7) leave no row, so no stored record can count them.

### 2.4 Why the rest is missing

In order of size:
1. L1, the flag (everything since 1 Nov 17:09Z).
2. L2, Haiku 5.5 (implementation work since 24 Oct 20:21Z).
3. L3, subagents.
4. *No usage* on 35 of 1,416 lineages (2.5%) from 19 to 31 Oct, at 0 to 11 a day. The cause of each was not established here; the earlier paper (§6) classed most such rows as never launched.
5. L4–L11: present in code, unmeasurable now.

Nothing missing was found to be acceptable as it stands.

---

## 3. Recommendation

### 3.1 For the Theseus method (scattered decisions worth gathering, then rebuilding)

1. **What a unit of usage is, and who folds it.**
   - Today three producers each write their own fold: the runner hook (cumulative, last model, `SD:transcript.js:424-476`), runner-kit (cumulative, most-output model, `lib/runner-kit/runner.mjs:578-613`) and opencode (delta, current model, `SD:opencode-runner.js:619-648`).
   - Then six readers undo the folds in their own ways: `parseUsage`, `usageOf`, the Mongo `$last` in `lib/kpi-stats.js:461`, `deriveKpiFacts`, `run-view.lineageCost` and `reduceLineageCost`. Each needs a rule for "is this harness cumulative?" (`lib/model-pricing.js:363`, `lib/terminal-marked-task-cost.js:111-120`, `lib/run-view.js:420`).
   - Gathered, this becomes one decision: **a usage record is one model request** (message id, session, row, model, the five token fields, timestamp), posted idempotently and summed.
2. **Lineage cost.** Three engines (R1, R10/R11, R15) and four anchor definitions (Q8) disagree on wake rows, opencode, zero and harness source. Gather them into one cost read that every surface asks (R2, R4–R9, R12, R14, R15).
3. **Unpriced, zero and formatting.** There are four treatments of an unpriced call (Q3), two of zero (Q2), and six or more USD formatters (Q9). This is one decision, "how a figure is shown when part of it is unknown". It belongs with item 2.
4. **When cost is computed.** Today it is priced at write in the digest, priced at read elsewhere, and invalidated by hand with version bumps (Q7). One rule should hold: store tokens, price at read.

The method's order applies: find and own (this report), free the seam (the tests that pin text, e.g. `SD:test/transcript.test.js:488` on sidechain lines), consolidate items 2–4 in Harbour, then rebuild item 1 across both repos.

### 3.2 Simple fixes and bugs

| # | Fix | Where | Why |
|---|---|---|---|
| F1 | **Set `SD_WORKER_USAGE_RELAY=1` on the runner host now. Then make the runner's default on**, because Harbour has accepted `kind:'usage'` since LIN-1425 | host `.env`; `SD:config.js:1318-1320`, `SD:README.md:202` | L1. An operational act first, then a one-line default change |
| F2 | Read `<session>/subagents/*.jsonl` in the usage walk, as runner-kit already does (`lib/runner-kit/runner.mjs:783-798`). Fix the stale comment and the test fixture | `SD:hook.js:1722`, `SD:transcript.js:411-414` | L3. This is **LIN-3859**, which stands |
| F3 | Post a final usage snapshot after the transcript settles, and at reap or cancel | `SD:hook.js:1715-1722`, `SD:reapers.js` | L4, L5. This is **LIN-3948**, which stands; under the §5 design it becomes a per-message post at every boundary |
| F4 | Exclude wake rows from founding a lineage in `buildTaskCost`, as `lib/dispatch-lineage.js:204-209` already does | `lib/task-cost.js:85-110` | D1, witnessed |
| F5 | Skip `<synthetic>` (and any model with zero usage) when choosing the session's model | `SD:transcript.js:456` | L6 |
| F6 | `summarize` should count unpriced calls instead of folding them to 0, as its docstring says it does. Ship's Biscuit should read its own window | `lib/llm-call-log.js:180`; `routes/ship-biscuit.js:155` | Q3, and a wrong window |
| F7 | Record which key paid on each call-log row (session OAuth, Harbour's paid key, free-tier key, stored key) | `lib/openrouter.js:451-459`, `lib/chat-request.js:174-178` | Harbour's spend cannot be split from users' spend |
| F8 | Record a row for a stream that is aborted or fails after the request was sent, with the usage seen so far or none | `lib/openrouter.js:1323`, `:1537`, `:1653` | L7. Also corrects the false comment in `lib/model-routing-spend.js` (`harbourSpendByJob`'s "every call writes a row") |
| F9 | Have the conformance sweep also report rows that price to null because of a tier or a missing field, and persist its result somewhere a page can read | `lib/pricing-conformance-sweep.js:181-249` | L2 was invisible to the only freshness check |
| F10 | opencode: post the usage delta from the error and hold paths | `SD:opencode-runner.js:1741-1800`, `:803-1060` | L8 |

L2 (Haiku) has no simple fix in today's design. A cumulative total cannot be split into requests, so the code is right to refuse. Splitting tokens by tier in the runner is possible, but it would copy Harbour's thresholds into the runner (a second copy of the rate card). The §5 design removes the problem instead.

### 3.3 What can be deleted

All verified by grep at `d35e8b6e`. Each item lists all of its references.

| Delete | Evidence |
|---|---|
| `lib/plan-fee-config.js` and its test | no product import (only `tests/unit/plan-fee-config.test.js:4`); also named in `.env.example:127`, `docs/architecture/configuration.md:37`, `docs/architecture/auth.md:185`, `docs/architecture/source-map.md:255`, `docs/plan-allowance-design.md:18` and `scripts/code-shape/areas.json`, which a deletion must update |
| `computeWeeklyBudgetGauge` and its constants and env vars (keep `windowedSpend`, which R14 uses) | its only use is `lib/kpi-stats.js:1142`; `toPublicKpis` never emits it; removed from the page by LIN-3703 (`a9f81290`) |
| The unused parts of `computeTerminalMarkedTaskCost`'s output (cash/unknown lane, in-flight, overhead) | only `pricedTicketCount`, `pricedTicketCostUsd` and the cost shares reach the page (`lib/kpi-stats.js:1206-1210`, `:1304-1313`) |
| The unused import at `routes/proxy.js:42` | `buildTaskCost` and `taskCostAnchorFor` appear once in that file, on the import line |
| `LlmCallLogStore.listCalls` and its index | no product caller; only tests and `lib/db-indexes.js:321` |
| `feedbackDigest.telemetry.usage.costUsd`: store tokens, price at read | it is the source of Q7 |
| The pricing-driven `BUILDER_VERSION` bumps, and the session-level usage in `buildSessionTelemetry` | the feed's allow-lists drop `usage` (`routes/dashboard-feed.js:154-236`), so it has no reader; it reports only the last sibling's snapshot (`lib/session-telemetry.js:769-776`) |

---

## 4. Classes, and how each was bounded

| Class | Bound | Members |
|---|---|---|
| Model-call paths | Producers: grep for `usage`/`input_tokens`/`costUsd` across both repos, plus every executor and target. Harbour's own calls: grep for model endpoints and SDKs (one endpoint, `lib/openrouter.js:27`), then every one of its five call points | P1–P8 (§1.1) |
| Harbour call features | The `feature` values logged, checked against the job registry (`lib/llm-jobs.js:64-79`) and the live routing table (`routing.json`, 16 `harbour-call` jobs) | recommend, task-chat, flight-companion, scan, scan-retire, brief, recap, run-summary, session-summary, run-paragraph, ship-biscuit, roadmap, roadmap-orientation, roadmap-chat, feedback-title, observer-pass |
| Usage producers in the runner | grep for `kind: 'usage'` | `SD:hook.js:359` (claude-code), `SD:opencode-runner.js:586` (opencode); plus `lib/runner-kit/runner.mjs` in Harbour |
| Cost readers | grep for `costUsd`, `totalUsd`, `pricedUsd`, `parseUsage`, `computeUsageCostUsd`, `llm-call-log` and `spend` over `lib/`, `routes/`, `server.js`, `public/` and `scripts/`; every hit is classed | R1–R15 (§1.3), plus research scripts |
| Lineage engines and anchors | callers of `parseUsage` and the `rootItemId` precedence rules | engines R1, R10/R11, R15; anchors at the four sites in Q8 |
| Model resolution and price sites | grep for `claude-`, `pricing`, `/1e6` and `prompt:`/`completion:` | `lib/model-pricing.js`; `lib/openrouter.js:240-251`, `:286-301`, `:323`; `lib/model-routing-harnesses.js:57-66`; `lib/model-routing-spend.js:70-89`; `lib/pricing-conformance-sweep.js:46-59`; `lib/openrouter-catalog.js:96`; `lib/runner-kit/runner.mjs:577-613`; `lib/llm-call-log.js:253-285` |
| Unpriced-call treatments | readers of `cost` in the call log | 0-fold (R4, `lib/agent-turn.js:85-106`), separate count (R3, R6), priced-only mean (R5), null total (R1) |
| **Not bounded:** runner hosts and their configuration | Production data, not source. Only this host's records are reachable | one host seen (one heartbeat consumer, `instanceId 5e8d294b…`) |
| **Not bounded:** Harbour calls with no issue | Production data. No proxy route reads the whole call log | — |

**Closing the set.**
- The searches that would have found a missed path came back empty: no `api.anthropic.com`, `@anthropic-ai`, `api.openai.com` or `/embeddings` in product code, and no `kind:'usage'` producer other than the three above.
- The set would be wrong if a third harness were added (`SD:harnesses.js` lists claude-code and opencode), if a runner other than simple-dispatcher or runner-kit posted to `/api/dispatch/feedback`, or if Claude Code started writing billed calls outside the main and subagent transcripts. That last one is possible: its own title and summary calls do not appear as assistant lines (inferred, not verified).

---

## 5. The simplest reliable design, and whether it is worth it

**Design.** One usage ledger, one price function, one reader.

1. **Producers post one record per model request:**
   ```
   { requestId: message.id, rootItemId, itemId, harness, model,
     inputTokens, outputTokens, cacheWrite5m, cacheWrite1h, cacheRead,
     nativeCostUsd?, at }
   ```
   - The runner sends the records not yet sent (main and subagent transcripts) at every Stop and at reap.
   - opencode posts per message from its session API.
   - Harbour's own calls are already one row per request.
2. **Harbour keeps them in one collection keyed by `requestId`.** Extending `llm-call-log`, already per-request and kept for life, avoids a second representation. A duplicate post is a no-op. Summing is always correct, so the cumulative/delta split and every "last entry wins" rule go away.
3. **Price at read, per request, with `computeUsageCostUsd`.** Long-context tiers then apply per request as the provider applies them, so Haiku 5.5 prices. Mixed-model and subagent sessions price per model.
4. **One read model** answers per issue, per lineage, per day, per job and per payer. Every surface asks it, so the figures agree by construction.

**Against a lighter repair.**
- **The repair: F1–F10 alone.** It would bring completeness from 0% to about 76% of list price in the window: $164.79 relayed plus the $16.54 of subagents F2 recovers, of $238.18.
- **What it leaves:**
  - Haiku 5.5 unpriced: 24% of the window, and the implementation model.
  - The three lineage engines and four anchors, so figures still disagree.
  - Frozen digests.
  - Mixed-model mis-pricing.
  - Every new reader still needing to know which harness is cumulative.
- **Most of the rebuild is not new code.** The per-message fold already exists twice (`SD:transcript.js:424-476`, `lib/runner-kit/runner.mjs:578-613`). The per-request store exists (`llm-call-log`). The price function exists. The rebuild deletes the snapshot path, the digest cost and two of the three engines.
- **Recommendation: do both, in order.**
  1. F1 today (an operational change).
  2. F2, F4, F5 and F6 as small tickets.
  3. Then the Theseus sequence of §3.1: consolidate the readers (items 2–4) while the producers still post snapshots, then move the producers to per-request records.
- **Cost of the rebuild:** small next to its benefit.
- **Cost of not doing it:** that the per-task, per-job and per-day figures John is about to build a page on will not agree with each other or with the bill.

---

## 6. What was tried before, briefly

- **LIN-1425** (`SD:54b5aa0`, 20 Jul) created the snapshot relay. Its commit already assumed sidechain lines sit in the main transcript and that Harbour keeps the last snapshot.
- **The rate card and its later changes:** LIN-1495 (the rate card), LIN-2113 (the 1h cache tier), LIN-2403 (long-context tiers and the cumulative null), LIN-3094 and LIN-3916 (new rows), LIN-3229 (`SD:dfed893`, 30 Oct: the per-field max fold).
- **No reverts** in the usage or pricing files.
- **The paper for LIN-3944** (`docs/papers/harbour/sessions-without-usage.md`, 25 Oct) measured the earlier regime: rows with no usage were 0.22% of reported spend, subagents 9.7%, and a 2.3% Stop-time shortfall. It assumed the relay was on. This report finds it off on today's host, and Haiku 5.5 newly unpriced. Both are larger than anything the paper measured.
- **The four untangle tickets LIN-3937–LIN-3940** proposed consolidating readers into one authority. They were closed before any code moved. §3.1 keeps that idea and adds the producer side, which they did not cover.

## Surface assessment

**Surface Assessment: [refactor required: a per-request usage ledger (extend `llm-call-log` to carry worker requests keyed by message id) with one cost read model that R1–R15 ask, replacing the cumulative snapshot path, the digest's frozen cost and the R1/R10-R11/R15 engines — reason: it removes the confirmed causes of L2 (cumulative totals cannot be tier-priced), D1/Q1/Q2/Q5/Q8 (three engines, four anchors) and Q7 (frozen digests)].**

- **The cause test.** Each cause named is cited above: L2 at `lib/model-pricing.js:363-367`, D1 at `lib/task-cost.js:85-110` against `lib/dispatch-lineage.js:204-209`, Q7 at `lib/pipeline-loops.js:292-295`.
- **The who-pays test.**
  - **Beneficiaries:** every reader R1–R15 comes out simpler, with no cumulative/delta branch and no anchor logic. The runner's hook drops `postUsageSnapshot`'s whole-transcript walk for a cursor over unsent message ids. `llm-call-log` gains rows but no new shape.
  - **Bystanders and what they pay:** the runner adds a per-session cursor of sent ids. That is a new field in `state/sessions.json`, to be written inside `updateState` (the LIN-459 rule). It is a small, named cost.
  - **No second representation:** worker usage moves *out of* `feedback[]` into the existing per-request store rather than being copied.
- **Size and sequencing.** This does not fit one session. It is sequenced as the Theseus moves in §3.1, after F1–F6.
