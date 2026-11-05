# Comprehension-Debt Review — run of 2026-11-05

**Task:** LIN-4300 (periodical run 5). **Mode:** review only. No code, config or docs under review were changed; this report and `docs/reviews/_evidence-2026-11-05-comprehension/` are the only files written.
**Window:** from run 4's grounding (LinearViewer `76fc3e91`, SD `1798790`; report `comprehension-debt-review-2026-10-23.md`, LIN-3825) to `main` HEAD.
**Grounding:** LinearViewer **`af55cb73`**, simple-dispatcher (SD) **`07c88f7`**. Both `main` = `origin/main` after a fresh fetch; no commit landed on either repo after the ticket was minted (2026-11-05T19:33Z). Every `file:line` below was read at those SHAs. Window size: LinearViewer 263 commits (`lib routes public server.js`: 367 files, 80 added, 7 deleted); SD 46 commits (38 non-test files, 8 added).
**Method:** the author re-ran the ledger checks (C1 grep, retention check, heartbeat spike, deleted-file orphans, the carried items), and four fresh-context readers each walked one area (router splits and Settings; costs and model routing; Home, keys and the grown modules; SD). Every promoted finding was re-read by the author at HEAD. Lines the author did not re-read are marked *reader*.
**Evidence:** `docs/reviews/_evidence-2026-11-05-comprehension/` (README lists each file).

## Headline

1. **The window left its areas more legible, not less.** Of the 21 areas in §3, 12 are better for a cold reader, 6 unchanged, 1 mixed and 2 worse. The new modules carry their reasons. Model headers: SD's `instance-guard.js:3-30`, `env-flag.js:3-21`, the `STOP_OUTCOMES` table (`hook.js:441-480`), Harbour's `lib/task-state.js:10-13`, `lib/cost-read.js:1-36`, `lib/run-controls.js:20-23`, and every `lib/model-routing*.js` header. The two splits moved their reasons with the code: the retention check finds **0 refs dropped** across the dashboard rebuild and all six `workspace-api-*` moves.
2. **The top finding is the same class as last run, recurring at about one new member a day (R1).** LIN-3827 retired run 4's stale "INERT / no caller yet" claims in Harbour on 10-25. Since then the window has written **at least 15 new sites (more than 20 lines)**, and the author re-read 11 of those sites as false. They sit on model routing, the cost store, the agent-facing proxy instructions, the dispatch entrance and Home. LIN-3827's SD half never landed: PR #286 has been open for 11 days and **now conflicts with `main` on `config.js`**. Nothing guards against the class coming back; LIN-3827's ruling put the guard out of scope. A cheap spike (forward-tense ticket references resolved against the tracker) catches 4 of these with 1 false positive, so a partial guard is feasible.
3. **Debt concentrates in what rebuilds leave behind, not in what they build.** Examples: the Settings rebuild's leftover `render-settings.js` comments describe a retired section and lost a cross-repo warning (R4). The `routes/dashboard.js` header still lists the 18 routes that moved out. Home's run offers are assembled inside the task-page loader (R2). SD comments cite line numbers that are now wrong in 12 of 13 samples (R3).
4. **Carried items mostly held.** N3 (`[working]` grammar) is unchanged; re-run against SD's real producer, `state:'running'` is still unreachable. N2 is unchanged, while `dispatch-entrance.js` changed 10 times in the window. N13 is re-ranked down: the arm order of `runStallFailsafe` *is* stated at each load-bearing arm.

## 1. Findings (severity-ranked)

### R1 — `stale-status-claims-recur` (C1, run 5) — **Medium+** — *recurring; top finding*
Code still lands in beats ("piece 1 … piece 4", "until LIN-3855 retires them"). Each beat writes a present-tense status, and the next beat wires the code up without retiring it. **Cold-hand-off test: fails.** Each claim is wrong in the direction that lowers a reader's caution ("nothing reads this", "inert", "left alone until …") about code that is live.

**(a) Run 4's SD half was never discharged.** LIN-3827 (Done) scoped three SD sites. By operator ruling the SD PR (#286, `d58a6c93`) was left for the operator to merge. At HEAD it is still OPEN and `git merge-tree` reports a conflict in `config.js`. Still false at `07c88f7`:
- SD `opencode-liveness.js:7`: "C1 IS INERT: nothing in reapers.js calls readOpenCodeLiveness yet". It is called at `reapers.js:1926,2222,2889,2918,2975,3211`.
- SD `reapers.js:1775-1777`: "LANDS INERT — nothing calls this yet". `resumeOpenCodeOverNativeId` is the default dependency at `:1929` and is called at `:2230,2464`.
- SD `reapers.js:36-38`: "opencode arm (:1754)". `:1754` is inside `refireSentinelOverResume` (`:1690`); the arm is at `:2221-2244`.

SD's own present-tense rewrites in the window (LIN-4240 `580a5ea`, LIN-4233 `07c88f7`) touched only their own pointers in `hook.js` and `docs/module-map.md`, so they did not sweep this class.

**(b) New members born or exposed in the window (Harbour).** All were re-read by the author unless marked *reader*.

| Site | Claim | Reality at HEAD |
|---|---|---|
| `lib/model-routing.js:55`, `:61-62` | "The shape stays for LIN-3855"; "the two legacy form copies in routes/settings-model.js are left alone, as LIN-3855 retires them" | LIN-3855 landed (`d53bb5bc`, which also edited this file). `routes/settings-model.js` (113 lines) holds no pattern copy. |
| `lib/model-routing.js:8,17,322,347`; `lib/model-routing-store.js:135-137`; `server.js:212` | "the old forms … still read"; `getLegacyView` / `projectLegacy` for "the Settings sections that still render it" | `getLegacyView` has no caller. `server.js:212` imports `projectLegacy` and never uses it (1 occurrence in the file). A reader would keep a projection in sync for a reader that no longer exists. |
| `lib/proxy-instructions.js:678` (**agent-facing**) | `/model-routing` returns `"unrouted": ["run-paragraph"]` | `UNROUTED_JOBS` is `[]` (`lib/model-routing.js:57`) since LIN-3856. An agent reading the published instructions would wrongly report run-paragraph's setting as having no effect. |
| `lib/request-usage-store.js:5-7` | "Nothing reads this collection yet except `listForAnchors`, and that has a single caller in a later piece" | Since LIN-4201/4226 every cost figure reads it through `requestUsageLoader` (`server.js:585-587`). |
| `lib/dispatch-entrance.js:884` | `expandCascadeAborts`: "INERT: nothing issues a cascade at end-of-run yet" | Home's Stop sends `cascade: true` (`public/prompt-section.js:2043`, since `8ecce6bc` LIN-3833, 10-25). The "end-of-run" qualifier is true, but the function is live from a button. |
| `lib/live-console.js:649-651` (`chooseKeyLane`'s doc, `:657`) | waiting runs are "not admitted … today … so LIN-3977 can admit them" | `isLaneMember` (`:386-395`, LIN-3977) admits a run that waits on a person; LIN-3977 is Done. |
| `lib/home-view.js:9`, `:15` | In Progress includes a task with "an open ruling"; "a done task with an open ruling, which is In Progress" | The code says the opposite (`:66-74`, LIN-4114): a waiting task "is not a reason to be In Progress". Following the header puts a task in both Waiting and Running. |
| `lib/session-telemetry.js:400-406` (*added by the second read*) | "usage? (… forward-compat, omitted until the runner emits it)"; "The runner posts a `kind: 'usage'` entry … claude-code posts a CUMULATIVE snapshot on each Stop" | The runner stopped posting snapshots (SD `44ab30e`, Harbour `d7ceb373`, LIN-4203). Unlike its siblings (`row-usage.js:24,89`, `cost-read.js:122`) it has no LEGACY marker. SD twin: `opencode-runner.js:585` "Gated on WORKER_USAGE_RELAY (the snapshot's flag)": the flag now gates records. |
| `lib/observer-state-store.js:79` | `llm-call-log` / `prompt-trace-store` "ship a `cleanup()` nothing calls" | Neither file has a `cleanup` at HEAD. |
| `public/style.css:4161` | "The name stays until LIN-4015 retires the tone names" | LIN-4015 is Done; `.btn--blue` is still named. |
| `routes/dashboard.js:200` | "the temporary session-page mount" | Now the run page's permanent external half (`:706-708`; *reader*). |
| `lib/task-board-view.js:155-157` | a "ready for a next step" rank tier | Removed by LIN-4103 (`24f448b5`); `task-state.js:269` ranks 0, 2, 3 (*reader*). |
| `public/app.js:346-347` | the row record carries container, finished and the subtask line | LIN-4071 (`27ae64ad`) removed them (*reader*). |
| `docs/architecture/source-map.md:58`, `:266` | `settings-model.js` holds "the three old Settings model forms … item 4 retires them"; `projectLegacy` and "the builders the old forms use" | False since `d53bb5bc`. |
| Deleted-file orphans (F7 class recurring) | `public/ship-journey.js:177,635`, `public/ship.js:1272`, `public/common.js:1512,1887` cite `public/next-run.js`; `lib/model-routing-spend.js:5` cites `lib/task-cost.js` as keeper of the unpriced rule; `lib/wall-clock-summary.js:99` contrasts with `buildTaskCost`; `docs/plan-allowance-design.md:18` | All of these files were deleted in the window (LIN-3912, LIN-4129/4179). The rule now lives in `lib/cost-read.js`. |

R4's `render-settings.js` lines belong to the same class and are listed there.

**Bound.** Three instruments, then a caller check per hit:
1. The widened lexical grep (130 Harbour hits, 35 SD; every hit has a verdict in `comprehension-debt-c1-grep.txt`). It found only `dispatch-entrance.js:884`, `model-routing.js:53` and `observer-state-store.js:79` as new members. The rest of what it matched is design vocabulary ("inert flag", "unwired test seam").
2. The forward-reference spike (`comprehension-debt-forward-ref-spike.txt`) found the LIN-3855, LIN-3977 and LIN-4015 members.
3. Reading by the area walkers found everything else.

So the class is **larger than any one instrument sees**; the true count is bounded below by this table, not above. An earlier grep using `\b` silently matched nothing for `INERT` (git's ERE on macOS ignores it); the evidence pattern avoids it.

**Why it recurs.** LIN-3827's operator ruling (25 Oct) put "a recurrence guard (lint)" out of scope. Nine days later the window had re-grown the class. The spike shows a mechanical partial guard works: from 11 forward-tense ticket references, 4 were stale and 1 was historical phrasing, with every date-bound or open-ticket clause correctly passed.

**Fix:** restate each line in the present tense or delete it (comment-only). **Follow-up: LIN-4301** (Harbour sites). The SD half goes to LIN-3827 as a comment (PR #286 needs a rebase), not a new ticket.

### R2 — `home-run-offers-assembled-in-page-loader` — **Medium** — *new*
`lib/home-row-states.js:10` says "task-state.js still decides". The inputs Home's run offers are built from (needsYou, busyOn, container) are assembled in the task page's loader: `rowStateOf` (`lib/task-page-loader.js:1069`) and `buildRowStates` (`:1128`), imported by `home-row-states.js:16,57`. `buildRowStates`'s doc (`:1119`) still says "the In Progress roots", but Home passes the whole subtree index. The loader's header describes only the task page (*reader* for the header range). **Cold-hand-off test: fails.** A change made for the task page silently changes Home's run offers, and nothing at the loader says Home depends on it. Stability 11-04 F2 ranks this cluster as the young hotspot; its size is Code Quality's, and only the missing pointer is ours. **Fix:** one header line in `task-page-loader.js` naming Home and `/state` as consumers of `buildRowStates`, and correct the `:1119` doc. Recorded; not promoted (a one-line note, and LIN-4301 can carry it; see that ticket).

### R3 — `sd-line-number-pointers-rotted` (N8 grown) — **Medium** — *grown*
SD comments cite code by line number, and the window's +830 in `hook.js` and +265 in `reapers.js` moved most targets. The reader sampled 13 pointers and found 12 wrong. Author re-checks:
- `reapers.js:2438` cites the opencode gate at "`:1402-1407`", but `refireSentinelOverResume` is at `:1690`.
- `hook.js:1447` cites `reapers.js:1978` for the `refiredAt` restamp, but `:1976-1979` is evidence classification.
- `reapers.js:36-37` (R1a).

Others (*reader*): `reapers.js:2168-2179` → five `dispatcher.js` lines, `:2250,2252` → `hook.js:1587,1566`, `:1844` → `harnesses.js:270-275`, and `hook.js:1131` → `reapers.js:3411`. The prose around each pointer still carries the reason, so this is debt in the pointers, not in the rationale. **Cold-hand-off test: fails for the pointers** on the module that fails, refires and kills live sessions. Same shape on the Harbour side after the splits: `lib/chat-tools.js:1314`, `lib/unanswered-decisions.js:132` and `lib/observer-sweep.js:40` cite lines past the end of the 876-line `routes/dashboard.js`, and `routes/workspace-api-issue-write.js:331` ("the paired GET above") and `routes/workspace-api-scan.js:607` ("elsewhere in this file") point at routes that moved (*reader*). The LIN-3911 sweep matched file names, not positional words. **Fix:** cite by symbol. Folded into the LIN-3544 comment (most SD sites are in `runStallFailsafe`), not minted.

### R4 — `settings-rebuild-residue` — **Medium** — *new*
The new Settings modules are clear (`lib/settings-areas.js:1-17`, `lib/settings-keys.js:7-16`, `lib/components/settings-ask.js:1-20`, `routes/settings.js:11-16`). What the rebuild left behind is not:
- **A cross-repo warning was dropped.** `lib/render-settings.js:131-138@76fc3e91` said that adding a Claude preset is "only half the change": SD's `CLAUDE_MAPPABLE_MODEL_FAMILIES` must match, "which is exactly how `fable` shipped broken … Update both". `d53bb5bc` removed it. HEAD keeps the mirror at `lib/model-routing-harnesses.js:116-117` with "mirrors Simple Dispatcher's launch guard … read at 955349d" (`:10-12`). That sentence states the safe direction and not the hazard: an edit to the local list alone makes Harbour accept a model SD fails at launch. SD's back-pointer (`executors.js:375-376`) still names `lib/render-settings.js:79` / `public/common.js:671`. The retention counter cannot see this loss, because LIN-1694's ref survives elsewhere (`comprehension-debt-retention-per-rebuild.txt`). **Cold-hand-off test: fails.**
- **Comments describe a retired section.** `lib/render-settings.js:185,218-219,644` refer to "the Dispatch-defaults section" and `dispatch-defaults.spec.js`, both gone in `d53bb5bc`. Also *reader*: the header names `kvNode`/`errorNode` (`:15-16`), which do not exist; the typedef (`:640-648`) documents unread fields; and the `preselectDefault` branch (`:134-173`) has no caller passing true. `lib/render-settings-workspace.js:2-4` and `routes/settings.js:18-20` say the model forms "stay where they were" (*reader*).

**Fix:** restore one constraint line at `model-routing-harnesses.js:116` ("hand-mirrored from SD's executors.js; update both or a page write passes here and fails at launch"), and retire the dead comments. Carried by **LIN-4301**.

### R5 — `addFeedback-phase-order-unstated-at-head` — **Medium** — *new*
`lib/dispatch-store.js` `addFeedback` (`:3303-3773`, *reader* for the span). Each of the window's three new decisions states its own position where it sits:
- LIN-4166, the question-only follow-up: "decided before `_resolveEdgeDoc`" (`:3441-3446`);
- LIN-4080, the wake-mint gate: "before getGrantDeclaration, provisionWakeCredential and the … CAS" (`:3502-3509`);
- LIN-4080, cancelling queued wakes on `[aborted]`: "deliberately NOT at enqueue" (`:3657-3666`).

The JSDoc (`:3264-3301`) names none of them and gives no phase order. `:3623` cites a "fold-at-:1059" that no longer exists. **Cold-hand-off test: partial.** A reader adding a gate can find the local rule only by reading 470 lines on the runner-feedback hot path. Complexity belongs to Code Quality (F-dispatch-store, HIGH; owner LIN-2398). **Fix:** a phase list in the JSDoc (append → wake gates → provision → CAS/mint → abort cleanup → closers → notify → usage) and the rule "a gate that suppresses a wake goes before `getGrantDeclaration`." **Comment on LIN-2398**; not minted.

### R6 — N3 `working-beat-grammar-unowned` — **Medium** — *carried, unchanged (LIN-3828, Backlog)*
Both ends moved in the window: SD `heartbeat.js` +20/−2 (`isHookBookkeeping`, LIN-4030) and `lib/session-telemetry.js` +107/−61. Neither change touched the contract:
- `buildHeartbeatMessage` (SD `heartbeat.js:347-375`) still names no consumer.
- The parser (`lib/session-telemetry.js:155-164`) still names no producer.
- The documented `state: ('running'|'idle'|null)` (`:172`) is still not met.

**The spike now drives SD's real producer** (`comprehension-debt-heartbeat-spike.out.txt`). A tool-in-flight beat (`[working · running] Bash running for 3m · …`) parses to **null**, so `state:'running'` is unreachable; the `/running/` arm at `:194` can only fire on a message that also carries a tool count. Two more real beats parse to null as well: the stall beat and the new **verifying-in-background** beat (`[working · verifying] verifying in background (npm test) · idle 10m`). C3's other member, the park text, is Drift's (`parked-wait-text-cross-repo`, home LIN-2258) and is not re-flagged. **Comment on LIN-3828** with the spike result.

### R7 — N2 `entrance-open-questions-offsite` — **Medium** — *carried, unchanged; risk up*
`lib/dispatch-entrance.js:40-42` still sends the reader to "the PR (the '(d)' items)" with no number, and `grep -c LIN-3608` still gives 0. Only open questions 1 and 4 are marked (`:782`). The file changed in **10 window commits** (LIN-4016, 4034, 4036, 2040, 4080, 4104, 4166, 4248, 4253, 4251). Stability 11-04 F7 reads its churn as "the settled reading has reversed". Each of those edits is a chance to "tidy" an undecided divergence. **Comment on LIN-3608** (its first step from run 4 is still undone).

### R8 — N13 `runStallFailsafe` arm order — **re-ranked Low-Medium** (from Medium)
The reader traced the arms (`reapers.js:1888`; list in §5). The orderings that are load-bearing each state their position at the arm:
- `:2175` "Placed above the opencode/blocked branches";
- `:2252` "Checked BEFORE the refiredAt/refireYieldedNothing branch";
- `:2365` "bootstrap-retry population resolves FIRST";
- `:2389` "Checked BEFORE the refire attempt";
- `:2408` "Positioned after every genuine exhaustion/evidence branch".

Three swaps were traced as load-bearing: fresh-resume skip ↔ opencode/blocked holds; blocked hold ↔ `refireYieldedNothing`; the exhaustion arms ↔ the wedged-terminal hold. Two were traced as not load-bearing (*reader*). So the ordering is recoverable, one arm at a time. What is missing is the overview. The header is stale: `:1866` says "reuses the three existing pure selectors", then lists six, and the function uses eight candidate sources (`findStalledBootstrap` `:2062` and `findParkedOnPendingChild` `:2076` are unlisted). "Only the terminal fallback sets FAILED" (`:1863`) is loose too, because `:2391` and `:2488` also push `fail` (*reader*). **Cold-hand-off test: partial.** LIN-3544's scope (decomposition) does not carry an arm-order note. **Comment on LIN-3544** with the ordered arm list and the header fix, as run 4 asked; not minted.

### Low — recorded, not promoted
- **L1 `routes/dashboard.js:1-41` header** is byte-identical to `@76fc3e91`. It lists the 18 routes that moved to `dashboard-*.js` and omits the four the file still registers (run page `:335`, pr-state `:479`, proposals apply `:532` and decline `:603`). This is run 4's smaller Low, now worse. The offsite map (`docs/architecture/source-map.md:26`) says the run page reads via "NON-lean getSessionsForWorkspace", which is false (`readSessionById`, `:808-811`) (*reader*).
- **L2 "so the route table's order is unchanged"** is given as a reason at `routes/workspace-api.js:632,856,859,893` and in three child headers without saying whether order matters. It does not (the paths are disjoint). Only issue-read/write's shared OPTIONS `Allow` (`workspace-api-issue-read.js:6-10`) is a real order constraint. This is mild rationale-inflation; `:214-216` already shows the right form (*reader*).
- **L3 Model routing has no module map** in `docs/architecture/`. Four of ten files are described only in prose in `ui-pieces.md:367-478`, and `model-routing-validate.js` is in no doc. Each file's own header is good, so a reader can manage (*reader*).
- **L4 Cost-store citations by line number** have drifted: `lib/request-usage-store.js:31-36` cites `dispatch-store.js:1591-1595,2798`, `routes/test.js:884` and `account-erasure.js:909` (all moved). `lib/terminal-marked-task-cost.js:13-14` names the wrong pinning test (the pin is `terminal-marked-task-cost.test.js:902`) (*reader*).
- **L5 SD `hook.js` table** (*reader*):
  - its `exceptions` arrays (`:472-479`) are declarative, checked only by `test/stop-relay-table.test.js`, and `runStopOutcome` ignores them, which nothing at `:459` says;
  - nothing says why block, self-check and zero-tool-challenge post status first;
  - `:371-407` is about 35 lines of history above a 4-line rule that the table now owns.

  The status-last rule (LIN-4239) **is** stated at the table (`:465-470`): a pass on the ticket's main question.
- **L6 SD `request-usage-flush.js:3-8`** says "Three callers" (Stop, reap, cancel). There are five seams (`dispatcher.js:478,651,1175`, `reapers.js:2834,3999`); `docs/module-map.md:337` and `config.js:1336` already list five (*reader*).
- **L7 `lib/key-state.js:4-6`** lists the key-state holders by hand and already misses two (`key-state-holders.js:65,113`). The census test is the real list (*reader*).
- **L8 `public/prompt-section.js:1-10`** still describes a four-state prompt picker. The file is now Home's opened task, run box and Go, and `init` (about `:896-2890`) has no map. The in-window constraints themselves are recoverable (`goState` identity rule `:260-261`). The size belongs to Code Quality and LIN-3546 (*reader*).
- **L9 `lib/settings-keys.js:12`** says "the same note sits in public/proxy.js", but no such note was found (search only; *reader*).
- **L10 N5 phase graph** is unchanged. `phases.js:84` says "A session may only move from a phase to one listed here", while `:104`, mid-row, says "isLegalTransition has no runtime caller; this is documentation only". `reapers.js:2263` leans on the graph as a contract.
- **L11 LIN-3585 at the `reapers.js` `loadState()` sites** (`:192,692,1932,2962,3201,3328,3416`) is still unstated. The trap test still enforces it (*reader*).
- **L12 `lib/session-telemetry.js:535`** says "resources? … inert until a producer exists". SD has a producer behind the default-off `SD_RESOURCE_RELAY` (SD `config.js:1357-1365`). This predates the window.
- **L13 SD `e2e-smoke.js:1722`** says "terminal-driver-only for now", but `:1797` accepts kitty handles. SD `test/lin-4202-opencode-records.test.js:9` describes the removed snapshot behaviour (*reader*).
- **Cross-referenced, not re-flagged:**
  - The SD per-request token-field copies (`request-usage.js:13-19`, `opencode-request-records.js:21`) are unpinned against `USAGE_TOKEN_FIELDS`, and Harbour's intake drops unknown names silently (`request-usage-intake.js:68-84`). Drift owns this as `usage-record-vocabulary-two-readers` ("SD is in step but unpinned", `drift-coherence-review-2026-11-04-run2.md:179`). This review adds only that neither SD copy says it must match.
  - Home's `home-row-states.js:121`, `waiting-section.js:5` and `public/app.js:631` are Drift 11-05's (`:168`).
  - The `model-routing-spend.js:91` claim is cost-review F8's.

### Not a finding
- **Inline markers:** 0 TODO/FIXME/HACK/XXX in LinearViewer `lib routes public server.js` (excluding the constant `TODO_TIER_CAP`) and 0 in SD non-test `*.js`. Re-run this session.
- **SD's "behind an unwired seam" (LIN-4202)** exists only in the subject of commit `765289d`. At HEAD the seam is wired (`opencode-runner.js:802,1097` default to `flushOpencodeRequestRecords`) and no SD source line claims otherwise.
- **`lib/render-ship-biscuit.js:9` "INERT in V1"** is true (`public/ship-biscuit.js:170-173`).
- **`lib/cost-format.js` ↔ `public/cost-format.js`** name each other, say "keep the two in lockstep", and cite `tests/unit/cost-format-parity.test.js`. This is a model twin.

## 2. What was added to the scope, and why
- **Settings' cross-repo hazard (R4).** The ticket listed the Settings rebuild as a split. Reading the parent's pre-split rationale found a cross-repo warning that ref counting cannot see, so this run audited the rebuild's *dropped prose*, not only its dropped refs.
- **The forward-reference spike.** The lexical grep missed most of R1, so this run tested a second instrument against the tracker. It is the evidence for "a partial guard is feasible".
- **`lib/proxy-instructions.js` (agent-facing docs).** Published contracts restate model-routing behaviour, so this run checked them against the code. That found R1's only agent-facing member.
- **Born-in-window files not named by the ticket:** `lib/close-out-merges.js`, `lib/live-anchor.js`, `lib/lineage-membership.js`, `lib/dispatch-session-read.js`, `lib/dispatch-lineage-status.js`, `lib/workspace-change-log.js`, `lib/stage-writes.js`, `lib/pipeline-churn.js`, `lib/llm-jobs.js`, `lib/task-facts-holder.js`, `lib/workspace-issues-memo.js`, `lib/workspace-kpis-cache.js`, `routes/getting-started.js`, `routes/workspace-api-steps.js`, `lib/components/*` (11 files). These were covered by the C1 grep and the forward-reference spike only (a lexical pass). The only hits were design vocabulary, so none is a finding. They were not walked for module-level rationale; that is next run's note 3.
- **Files deleted in the window** and what still points at them (F7 class): 8 Harbour sites and 1 SD doc line (`comprehension-debt-deleted-file-orphans.txt`).
- **SD's new files** (`instance-guard.js`, `env-flag.js`, `state-dir.js`, `request-usage*.js`, `opencode-request-records.js`, `experiments/lin-4171-*`). All were walked except `experiments/` (one-off witness scripts, not runtime).
- **Sibling seams:** the 11-05 Drift and Seams & Tangles reports, Code Quality 11-04, Stability 11-04 and the cost review 11-02 were read for ownership before ranking (§1 cross-references). The Documentation Review has not run since 10-21, so the window is unread at the per-comment altitude. R3's pointer rot and R4's dead comments sit in that gap and are recorded at module level only.

## 3. Per-area verdict for the window

| Area | What changed it | Cold reader: better / worse / unchanged | One-line reason |
|---|---|---|---|
| `routes/dashboard.js` → `dashboard-*.js` | LIN-3742 `b133a713` | **better** | Each child headers its routes and constraints (`dashboard-rulings.js:15-20`, `dashboard-effort.js:22-39`); 0 refs dropped. The parent header is stale (L1). |
| `routes/workspace-api.js` → `workspace-api-*.js` | LIN-3872/3876/3877/3883/3893/3894, LIN-3911 | **better** | The parent header is now a map (`:1-25`); the real order constraint is stated in both children; 0 refs dropped. Some positional pointers broke (R3). |
| Settings rebuild | LIN-3846, 3855, 3890, 3952 | **mixed** | New modules are clear; the leftover `render-settings.js` comments describe retired code, and the LIN-1694 cross-repo warning was lost (R4). |
| Costs & usage | LIN-4195 pieces 0-6, LIN-4129, 4179, 4134, 4136 | **better** | One cost read, named as such in five places; the records-vs-snapshot double-count reason is stated once (`cost-read.js:234-245`). Store header stale (R1). |
| Model routing | LIN-3853, 3855, 3856, 3882, 3952 | **better** | Every file headers what it owns; the stale LIN-3855 clauses, the dead legacy projection and the agent-facing `unrouted` example are R1. |
| Home, state and order | LIN-4016, 4113, 4114, 4139, 4151, 4241-4243, 4293 | **better** | One state owner (`task-state.js:10-13`); "the server decides" is written where the browser would break it (`public/app.js:704-706`). The `home-view.js` header contradicts LIN-4114 (R1). |
| Run controls and keys | `run-controls.js`, `key-state*.js` | **better** | Fail-closed and two-phase-reset reasons stated (`run-controls.js:20-23`, `key-state.js:15-18`); census test enforces the registry. |
| `lib/task-page-loader.js` | +733 | **worse** | Now silently assembles Home's run offers (R2). |
| `lib/dispatch-store.js` | +1.2k | **unchanged** | New decisions state their positions locally; the head still gives no phase order (R5). |
| `lib/live-console.js` | +558 | **better** | LIN-3986's lane rule and its reason are at `:626-647`; one stale sentence (R1). |
| `server.js` | ±1.1k | **better** | Shrank by 58 net; the Home gather moved to `home-pipeline.js` with its order contract (`:31-33`). |
| `public/prompt-section.js` | +1.6k | **unchanged** | In-window constraints are recoverable; the module header is out of date (L8). |
| `lib/dispatch-entrance.js` | 10 commits | **unchanged** | N2 unchanged; `:884` "INERT" now false (R1, R7). |
| Deleted files' neighbours | LIN-3912, 4129, 4179 | **worse** | 8 rationale pointers to files that no longer exist (R1). |
| SD `hook.js` Stop relay | LIN-4218, 4239, 4233, 4240 | **better** | One outcome table with a slot legend; the status-last rule is at the table (`:465-470`); a coverage test and a golden pin the order. |
| SD new modules, `config.js`, `dispatcher.js` | LIN-796, 4199/4202/4203, 4220-4224 | **better** | `instance-guard.js` is exemplary; `env-flag.js` states a do-not-improve rule enforced by test. |
| SD `reapers.js` | +265 | **unchanged (slightly worse)** | The three stale run-4 claims survive (R1a); line pointers rotted (R3); arm order is recoverable per arm (R8). |
| SD test harness | LIN-4220-4224 | **better** | Reasons at `test/child-env.js:1-31`, `stop-group.js:2-17`, `baseline.js:9-25`, `docs/testing-and-ci.md:104-222`. |
| SD `CLAUDE.md` invariants at the code | — | **unchanged** | LIN-459 and LIN-2446 still recoverable; LIN-3585 still absent at the `reapers.js` sites (L11); the phase graph still says two things (L10). |
| Cross-repo `[working]` grammar (C3) | SD `heartbeat.js`, `session-telemetry.js` | **unchanged** | Neither end names the other; `state:'running'` still unreachable (R6). |
| Cross-repo request records (C3) | LIN-4198/4199/4202/4203 | **better** | The SD end names Harbour's route, auth, codes and limit (`request-usage-flush.js:10-16`); the field-name pin is Drift's. |

## 4. Carried-forward ledger

| ID | Status at HEAD | Decision |
|---|---|---|
| **N1** landing-status claims (LIN-3827) | The Harbour half was discharged by `343d34ec`: none of the 13 run-4 Harbour sites appears in this run's grep. **The SD half was not:** PR #286 is open and now conflicts on `config.js`, and the three SD sites are still false. The class re-grew in Harbour. | **Carried as R1.** Comment on LIN-3827 (rebase #286); new Harbour members to **LIN-4301**. |
| **N2** entrance open questions | Unchanged (`:40-42`; 0 × LIN-3608), during 10 commits of churn. | **R7.** Comment on LIN-3608. |
| **N3** `[working]` grammar (LIN-3828) | Unchanged; spike re-run against the real producer. | **R6.** Comment on LIN-3828. |
| **N4** retention rule unenforced (LIN-3829) | **Tool landed** (`3861e1ea`). Not wired into CI or npm scripts (only hit: `test.yml:137 retention-days`); by design it reports and never fails. Run by hand here over 22 window commits: 0 refs dropped by the splits, and every dropped ref is accounted for. Blind spot: a reason dropped while its ref survives elsewhere (R4, LIN-1694). | **Re-ranked Low.** The rule held in practice; sampling is still needed. No ticket. |
| **N5** phase graph documentation-only | Unchanged. | **L10**, carried. |
| **N6** connection-model decision codes | Not re-derived (reader-sourced since run 4). | Carried, Low-Medium, *reader*. |
| **N7** reapers rationale inflation | Not re-derived at `:1139-1185`. The same shape is now visible at SD `hook.js:371-407` (L5). | Carried, Low. |
| **N8** SD cites by line number | Grown: 12 of 13 sampled wrong. | **R3.** |
| **N9** pipeline-loops 5d residue | LIN-2187 still lives only in `tests/unit/pipeline-loops.test.js:2134,2137,2327`. | Carried, Low. |
| **N10** stale twin pointers | Code Quality owns it. | Not re-flagged. |
| **N11** relay redirect gap | The rationale is back at the code: `routes/proxy-reads.js:439` "A redirect could bypass the allowlist, so the relay never follows one." Whether the allowlisted GitHub image host redirects is a behaviour question, not ours. | **Closed** for this series. |
| **N12** proxy-writes residue | Minor; no recurrence. | **Closed.** |
| **N13** `runStallFailsafe` order | Ordering recoverable at each load-bearing arm; the header is stale. | **R8**, re-ranked Low-Medium. Comment on LIN-3544. |
| **F3** label capability gate (LIN-692) | Trap unchanged: Linear `lib/providers/linear/index.js:2246-2247`, Local `:671`, GitHub `:876-883`, all unnoted; Jira noted (`:1286`). | Carried, Low. Comment on LIN-692 with re-anchored sites. |
| **F5** telemetry cross-check policy | Not re-derived. | Carried, Low. |
| Run 4's smaller Lows | `routes/dashboard.js` header: **worse** (L1). `dispatch-store.js:39` "the sweep ticket": unchanged. `runner.mjs:71-72` watchdog constants: unchanged, no stated reason. SD `terminal-driver.js` "exactly FIVE": **closed** (`probeHealth` at `:537`/`:860`; `:802` "fifth port verb"). `github-auth.js` headers, `workspace-token-resolver.js` inflation, `runner-setup.js:43`: not re-derived. | As stated. |
| Next-run notes 4-7 | 4: N2's site list, N6, N7 and the `render` cluster's 7 refs were not re-derived (still *reader*). N9 was re-derived (above). SD `hook.js` cites: confirmed wrong (R3). 5: `lib/prompts/collective-participant.js:126` **true** (`routes/collective.js:196` passes `pickCharacterFields(c)`); `lib/periodicals.js:94` **true** (`withAutopilotTail` `:1078`, rendered at `lib/render.js:674`). 6: held, as R4 shows. 7: respected. | As stated. |

## 5. New territory walked (clean passes recorded as passes)

**Harbour.** Clean or near-clean: `lib/task-state.js`, `ruling-settled.js`, `ruling-standing.js`, `subtree-index.js` (`:9-12`), `home-pipeline.js` (order contract `:31-33`), `public/home-placement.js`, `task-order.js` (LIN-1872 threshold `:140-164`), `run-controls.js`, `key-state.js`, `key-state-holders.js` (census 8/8 pass), `cost-read.js:1-36`, `request-usage-fold.js:1-27`, `usage-snapshot-intake.js:1-10`, `row-usage.js:1-27` (legacy path with a dated deletion bound), `cost-format.js` twins, all ten `model-routing*.js` headers, `render-settings-models.js:1-10`, `public/settings-models.js:1-12`, `model-routing.js:471-486` (`SEEDED_ENTRY` fail-closed), `settings-areas.js`, `settings-keys.js`, `settings-ask.js`, `dashboard-summaries.js:7-13`, `dashboard-rulings.js:15-20`, `dashboard-session-state.js:1-11`, `dashboard-effort.js:22-39`, `tests/unit/lib/dashboard-unit.js:1-22`, `workspace-api.js:1-25`, `workspace-api-issue-read.js:6-10`. Reasons that moved with the code: LIN-1025 → `lib/run-loop-state.js:111-125`; LIN-3713 → `lib/close-out-merges.js:63-64`; LIN-1426's "never sum a cumulative snapshot" → `row-usage.js:7-11`. (`session-telemetry.js:404-406` restates it too, but in a section that still describes the retired producer in the present tense, so it is an R1 member. The first draft listed it here; corrected after the second read.)
**Tag sampling.** The LIN-4195 "piece N / D# / note N" labels have no plan doc in the repo, but almost every sampled use paraphrases locally (`usage-snapshot-intake.js:4-5`, `cost-read.js:19,36`, `request-usage-fold.js:24-27`, `request-usage-store.js:19-20`). **Not debt**, with one Low exception: "the pre-sum fallback (D13)" (`request-usage-loader.js:23`, `workspace-kpis-cache.js:7-8`) is never explained in the repo.

**SD.** Exemplary: `instance-guard.js:3-30`, `env-flag.js:3-21`. Clean: `state-dir.js`, `opencode-request-records.js`, `request-usage.js`, the `dispatcher.js` additions (LIN-4079/4082 accepted exposure stated), `heartbeat.js:29-43` (`isHookBookkeeping`), the test harness. No orphaned references from removing `[usage]`.

**`runStallFailsafe` arms in order** (`reapers.js:1888`; *reader*, spot-checked by the author at `:1863-1870`):
0. gather: transcript heal, seven selectors, relay (`:2076`, union order irrelevant `:2079`);
1. skip gone/terminal (`:2154`);
2. fresh-resume skip (`:2189`);
3. opencode HOLDING (`:2221`);
4. blocked hold (`:2255`);
5. `refireYieldedNothing` (`:2303`);
6. selector-resolution ternary (`:2374`);
7. pending-external cap → fail (`:2391`);
8. breaker/wedged hold (`:2416`);
9. broker re-arm (`:2431`);
10. opencode stalled-pending divert (`:2445`);
11. generic refire (`:2468`).

Load-bearing: 2↔3/4, 4↔5, 5/7↔8. Not load-bearing: 3↔4 (predicates disjoint), the ternary beyond bootstrap-retry.

## 6. Class list and bounds

| Class | Bound | Members |
|---|---|---|
| **C1** stale landing-status claims | widened lexical grep (165 hits, all with verdicts) + forward-reference spike (11 hits) + area reading; caller check per member | SD 3 (R1a); Harbour 15 rows in R1b (15+ lines) + R4's `render-settings.js` lines; true/design remainder in the grep file. **Lower bound only**: claims naming no ticket and using none of the grep's words are found only by reading. |
| **C1′** deleted-file orphans (F7) | grep of every deleted path and its main symbol over `lib routes public server.js docs/architecture CLAUDE.md` and SD | 8 Harbour + 1 SD doc line |
| **C2** unmarked entrance divergences | LIN-3608's list vs in-code markers | unchanged: Q3, Q5, Q6, Q7, Q8 + header pointer |
| **C3** cross-repo text contracts | Harbour readers of SD-emitted text; SD writers of Harbour-read text | `[working]` beat (unowned, R6); park text (Drift, LIN-2258); terminal/WAKE markers (one-way cite); request records (named at SD end; field pin Drift's); Claude model families (R4, cross-repo warning lost); host heartbeat (cited) |
| **C4** rebuild/move commits | ticket list in the description + `git log --grep` over the window | 22 commits (retention file); 0 refs dropped by the splits; 1 reason dropped with its ref surviving (LIN-1694) |
| **C5** comment pointers by line number | sampled (13 SD, 6 Harbour); not exhaustively bounded | 12/13 SD wrong; 6 Harbour wrong (R3) |
| **C6** F3 gate sites | `grep addLabel` in `lib/providers/*/index.js` | linear, local, github unnoted; jira noted |
| **Unbounded** | module-level rationale of the 25 born-in-window files walked lexically only (§2) | next run |

## 7. Follow-ups and comments on existing tickets

| ID | Covers |
|---|---|
| **LIN-4301** (new) | Retire the window's stale status claims and orphan pointers in Harbour (R1b), restore the LIN-1694 constraint line and retire the dead Settings comments (R4); one comment-only PR. The forward-reference check is under "Unvalidated idea" with the spike's numbers. |

Searched first (`/search`): "landing-status", "stale status comment", "present tense", "INERT", "recurrence guard", "model-routing legacy", "projectLegacy", "UNROUTED_JOBS", "request-usage-store", "usage field names", "TOKEN_FIELDS", "cascade stop", "runStallFailsafe", "arm order", "constraint-note", "settings-model legacy". No open ticket covers R1b or R4. LIN-3874 (Backlog) is adjacent: it retires the old preference *fields* and their `workspace-preferences.js` doc comments, and it is gated on a production condition. It does not cover these comment lines, which should not wait for that gate.
**Comments instead of tickets:** LIN-3827 (SD half undischarged, PR #286 conflicts), LIN-3828 (spike against the real producer), LIN-3544 (arm list and header, R3's SD sites), LIN-3608 (N2 still undone, churn), LIN-2398 (R5 phase list), LIN-692 (F3 re-anchored). **Not minted:** R2 (one line, offered to LIN-4301's scope as optional), R3 (to LIN-3544), R5 (LIN-2398), R6 (LIN-3828), R7 (LIN-3608), R8 (LIN-3544).

## 8. Trend ledger

| Run | Date | HEAD | Findings promoted | Notes |
|---|---|---|---|---|
| 1 | 2026-06-12 | `f746725` | baseline | LIN-439 |
| 2 | 2026-06-25 | `8de7da5` | F2–F6 | LIN-674 |
| 3 | 2026-07-01 | `6e5d928` | F7 new; F2–F6 carried | LIN-895 |
| 4 | 2026-10-23 | `76fc3e91` / SD `1798790` | N1–N4 new (+ N5–N13 recorded) | ~2,650 commits; SD first read |
| 5 | 2026-11-05 | `af55cb73` / SD `07c88f7` | R1 (C1 recurred, 1 ticket); R2–R8 recorded, 6 comments | 263 + 46 commits; 12 areas better, 2 worse; N11, N12 closed; N4 re-ranked Low; N13 re-ranked Low-Medium |

## 9. Notes for the next run
1. **C1 is now a standing class.** Re-run the grep *and* the forward-reference spike (`comprehension-debt-forward-ref-spike.txt` gives the pattern; the states come from the tracker). If LIN-4301 landed, both should come back empty apart from the date-bound and open-ticket clauses. Check whether SD PR #286 merged.
2. Run `scripts/code-shape/retention.mjs` over any rebuild in the window, then **read the parent's dropped prose**: the counter cannot see a reason whose ref survives elsewhere (R4).
3. Walk the 25 born-in-window files listed in §2 that this run covered only lexically.
4. Re-run `comprehension-debt-heartbeat-spike.mjs <sd>` after any change to SD `heartbeat.js` or `lib/session-telemetry.js`.
5. Verify the *reader* items this run did not re-derive: R2's loader header, R4's `render-settings.js:15-16,134-173,640-648`, L1–L9, N6, N7.
6. Do not re-flag: N10 (Code Quality), the usage field-name pin (Drift `usage-record-vocabulary-two-readers`), the park text (Drift, LIN-2258), the sizes of `addFeedback` / `init` / `runStallFailsafe` (Code Quality).

## Adversarial Second-Read
**Tier:** 2. The reader was a fresh-context sub-agent with no memory of the report-writing turn. It was given the two repos, the window and the definition of comprehension debt, and none of this report's conclusions. It wrote its own candidate to a scratch file before opening the report.
**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (condensed; nothing of substance changed):**
- **Its own candidate, written before reading the report: the LIN-4195 per-request usage-records cutover across both repos (Medium).** Its load-bearing choices are keyed to a decision register that lives only in Linear (D1/D5/D6/D7/D8/D12/D13, "review note N", "plan N1"), and no `docs/plans` file exists for LIN-4195 or LIN-4176. It also found stale present-tense snapshot claims after LIN-4203: `lib/session-telemetry.js:400-406`, and SD `opencode-runner.js:585` ("the snapshot's flag"). Runners-up it judged well documented: `STOP_OUTCOMES`, `instance-guard.js`, `task-facts-holder.js`, the `REAP_INACTIVITY_MS` duplicate, and `prompt-section.js`'s `goState`. It also noted inflation at `hook.js:370-410`.
- **Missed or misfiled:** `lib/session-telemetry.js:400-406` was filed in §5 as a reason that "moved with the code", but it states the retired snapshot producer in the present tense, with no LEGACY marker. It belongs in R1, with its SD twin `opencode-runner.js:585`. On its own it is Low-Medium, so it does not change the ranking. Smaller: "the pre-sum fallback (D13)" (`request-usage-loader.js:23`) is never explained in the repo, so the D-tags are "not debt" with that one Low exception.
- **Spot-checks:** 16 of 16 hold at HEAD: R1a ×3, PR #286 conflicting, `model-routing.js:55,61-62`, `server.js:212`, `proxy-instructions.js:678`, `request-usage-store.js:5-7`, `dispatch-entrance.js:884` vs `prompt-section.js:2043`, `home-view.js:9,15`, `observer-state-store.js:79`, `style.css:4161`, R4's dropped warning and SD back-pointer, R3's `hook.js:1447`, R2's import chain and `:1119` doc, and L8.
- **Verdict:** AGREE. R1 is real, wide and well bounded, and is correctly the top finding. The reader's own candidate differed (it ranked the records cutover first). After reading the report it accepted that most D-tags are paraphrased locally, and placed the surviving part (the stale snapshot claims) inside R1.

**Author's check:** confirmed at HEAD. SD `44ab30e` ("LIN-4203: stop posting [usage] snapshots") has no `postUsageSnapshot` left in SD source, while `session-telemetry.js:400-406` and SD `opencode-runner.js:585` still read as quoted. Fixed in place: both lines were added to R1's table, §5's clean-pass line was corrected, the D13 exception was recorded in §5, and LIN-4301's scope gained the Harbour line. The SD line goes with LIN-3827's SD PR or a later SD comment PR.

Adversarial second-read verdict: AGREE
Differed from top finding: YES
Disposition: fixed in place
