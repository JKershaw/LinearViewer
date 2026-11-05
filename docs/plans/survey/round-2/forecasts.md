# Round 2 forecasts (Survey v2, verbatim from LIN-4150)

Posted 3 Nov 17:17 to 17:19 UTC, before any work began. Not edited.

## Survey v2: LIN-4164 @ cf6369dfd

**1. Where it binds**

- **One SD constant, read in three places.** `config.js:584` `REAP_INACTIVITY_MS` (21600000). Its only reader is `cleanupCompletedSessions` (`reapers.js:3415`, `:3424`, `:3452`), which drops the record and the clone together, on purpose (`:3366`: "a resume needs both"). `resolveFollowUpTarget` (`followup.js:51`) rejects with `no-session` once the record is gone.
- **A copy in Harbour that nothing keeps in sync.** `LinearViewer/lib/unanswered-decisions.js:48` hardcodes 21600000 to decide `resumable` vs `gone` (`:83`). A third copy sits in `tests/unit/unanswered-decisions.test.js:13`. Drift is tracked as LIN-2201 (`:41`). Harbour ages from `terminalCompletedAt`, SD from max(updatedAt, transcript), never earlier, so one shared number keeps Harbour's "resumable" safe.
- **Tests that pin the 6h shape.** In SD: `test/liveness-gate.test.js:117` (equals 21600000); `test/cleanup-liveness-gate.test.js` (hardcoded `7 * HOUR` means "past the floor", 4 places); `test/lin3431-characterization.test.js` (5 hardcoded hours); `test/blocked-reap.test.js:42` asserts `BLOCKED_REAP_MS > REAP_INACTIVITY_MS`. In Harbour: `proxy-rulings-routes.test.js:173,200` and `dashboard-routes.test.js:200` use "7h ago means gone", and `unanswered-decisions.test.js:138,162` use 24h and 2d as "well past".
- **An ordering decision.** `BLOCKED_REAP_MS` is 7 days (`config.js:603`). Its comment (`:601`) and the test above assume it sits above the terminal floor. A 7-day terminal floor ties with it and fails `>`.
- **Stale prose.** `followup.js:50` ("~1h"), `docs/session-lifecycle.md:285`, `hook.js:995`, `reapers.js:3356-3371,3486-3490`, `config.js:581-601`, `state-store.js:33`.

**2. Why it's hard**

Mostly it isn't: one constant, one reader. The friction is the cross-repo copy and pinned fixtures, which fail loudly. The one real choice is **ordering**: raise `BLOCKED_REAP_MS` too, or relax the assertion to `>=` (the shield still matters when equal, since a child can be newer than its parent).

**3. Menu**

- **Just drill.** Raise the default (for example to 8 days, or 7 days with `>=`), fix SD tests to derive from the constant, bump Harbour's two copies, flip the 7h/24h fixtures, and fix the stale prose. Copies this leaves behind: Harbour `lib/unanswered-decisions.js:48` and its test's `:13`, which still drift on the next change.
- **Small tidy first.** SD tests read `REAP_INACTIVITY_MS` instead of hardcoded hours; Harbour's test imports the lib constant (test copy deleted). Cheap and complete.
- **Consolidate.** SD exposes the window (for example on the poll response) and Harbour reads it, deleting its constant. Closes LIN-2201, but it's a cross-repo contract with a fallback: more than this task needs.
- **Theseus (split record from clone).** Resume is keyed to the cwd, so a reaped clone must be rebuilt at the same path with its branch state. Large; only worth it if disk bites (§5).

**Recommend:** small tidy, then drill, in both repos.

**4. Prediction**

One plan-review round, two at most (the ordering choice is the likely finding). Pieces: (a) SD: constant, `blocked-reap` ordering, tests derived from the constant, prose and docs; (b) a Harbour PR: `lib/unanswered-decisions.js` plus 3 tests, test constant deduped. Files: those, plus the SD files in §1 and 4 tests. What bites later: deploy order (SD first is safe; Harbour first labels rows `resumable` that SD rejects), and disk.

**5. Couldn't check by reading**

- **Disk.** The live host is 92% full (77 GB free). `du` shows about 467 MB per clone, and the oplog shows 90 to 150 sessions a day, so a week means hundreds of clones. APFS `clonefile` (the darwin default) may share most blocks, which `du` can't see. Watch `df` over a day before choosing 7 vs 14 days.
- **sessions.json growth.** About 8.7 KB per record; 1,000 records is about 9 MB, under the 2,000-record witness (`test/cycle-cost-witness.test.js`). But every `updateState` re-serialises it under the lock, and the witness doesn't time hook writes. Time `updateState` on a 1,000-record fixture.
- **Claude `--resume` after 7 days:** asserted by the ticket, unverified here.



---

## Survey v2: LIN-4165 @ cf6369dfd

**It mostly exists.** LIN-1290's delta relay, `postAssistantTextDelta` (hook.js:226), posts every unseen text block as `assistant-text`, but `SD_ASSISTANT_TEXT_RELAY` defaults OFF (config.js:1289, README.md:200). With the flag off, the `self-check` and `zero-tool-challenge` stops post no text (hook.js:1855, 1872). A follow-up's answer turn ends at that self-check, so only the later DONE turn reaches Harbour. That is the lost reply. Harbour already stores the kind (lib/dispatch-store.js:98) and draws every entry (lib/render-session.js:89), so it likely needs no code.

### 1. Where it binds
- **Three gates for one decision:** `relayAssistantText` (hook.js:384) plus the inline checks at 1855 and 1872.
- **Flag-on output differs from today's.** The delta path drops `textLabel`, so the `[onboarding]` prefixes go (hook.js:1319, 1332). It also drops the `[recap unavailable]` marker (hook.js:184). Both break "keep existing feedback working".
- **The cursor starts at 0,** so a session in flight at deploy time posts its whole history on its next stop.
- **`allow` (hook.js:2211)** relays nothing even with the flag on, so turns on a COMPLETED session (human or CI-wait) stay invisible.
- **OpenCode:** `postTurnFeedback` (opencode-runner.js:497) posts only each turn's final text.
- **Tests pinning default OFF:** test/assistant-text-relay.test.js. Label and marker shapes: test/feedback-metadata.test.js:88–224. Flag-on ordering is already pinned (test/decision-emission.test.js:216, 294).
- **Harbour readers that shift with more entries:** `correlateDecisionCase` (lib/digest-feedback.js:224) builds a decision's "case" from the assistant-text run before it, which gets longer. `rowVerdict` (lib/pipeline-churn.js:172) has more text to falsely match a verdict in.
- **Harness:** the system suite's fake-agent posts directly (test/system/harness/fake-agent.js:18), so hook.js's relay never runs there. The runtime-witness rule needs a recorded e2e run.

### 2. Difficulty
Low. It is a flag flip plus label and marker parity and cursor seeding. The flush-race and decision-ordering problems are already solved and tested.

### 3. Menu
- **Just drill.** Flip the default ON, keeping the flag as a rollback (the `ZERO_TOOL_DONE_GUARD` idiom). Add label and marker parity, seed the cursor, update the pins. Copies left: the 1855/1872 gates, `postTurnText` as the fallback, OpenCode's `postTurnFeedback`, and the silent `allow`.
- **Small tidy first.** Route 1855/1872 through `relayAssistantText`, deleting the inline gates (about 20 lines). One gate is left to flip.
- **Consolidate.** Delete the flag and `postTurnText`'s hook use. This gives one owner but loses the rollback lever and means rewriting the flag-off tests.
- **Theseus.** Not warranted.

**Recommend:** a small tidy (one gate), then drill with the flag kept as a rollback.

### 4. Prediction
One plan-review round, two if the `allow` or OpenCode scope is contested. Pieces:
1. One gate.
2. Label and marker parity.
3. Cursor seeding.
4. Flip the default.
5. A decision on `allow` for COMPLETED turns.
6. Optional OpenCode parity.
7. An e2e witness.

Files: hook.js, config.js, README.md, test/assistant-text-relay.test.js, test/feedback-metadata.test.js, test/tool-activity-relay-seams.test.js, maybe opencode-runner.js.

Expected to bite later:
- Decision cards with long multi-block cases.
- Item docs that grow without bound: there is no feedback cap, and every entry is embedded as `data-feedback`.
- "Comment on your ticket instead" prompts to retire. They are not in either repo, so probably in presets.

### 5. Couldn't check
- **Whether prod already sets the flag** (live .env). Check the host .env, or look for assistant-text after a self-check status on a recent dispatch.
- **Page weight and render cost** of a session with hundreds of entries. Load a long flag-on dispatch in staging.
- **Stop-hook latency** from sequential POSTs. Time the oplog `feedback.post` rows in the e2e run.
- **`extractVerdict` false positives.** Run pipeline-churn over flag-on data.
- **Where the prompt instruction lives.** Search Harbour presets.



---

## Survey v2: LIN-4166 @ 048c3319a

**1. Where it binds**

- **One decision site.** `addFeedback` in `lib/dispatch-store.js` (~3290–3355) walks the producing row's `followUpTo` chain to the root (`_resolveEdgeDoc`, :2970), then calls `buildWakeFollowUp(edgeDoc, …)` (`lib/dispatch-wake.js:163`). That reads the *root's* `sessionId`. This is why a question to a finished worker wakes its autopilot. The per-item guard (`terminalWakeItems`) is keyed on the producing row, so every new follow-up wakes again. `buildWakeFollowUp` never sees the producing row, so the new flag has to be read at the store seam. The precedent is the LIN-4080 parent-stopped gate (:3346). It sits before the grant read, the credential and the CAS, so a suppressed wake burns nothing.
- **Not `subscription`.** That enum is an edge property, read only off the root (§6). The follow-up's own value is ignored, and SD's `subscription.js` maps unknown values to null. Adding `'none'` to `SUBSCRIPTION_LEVELS` would overload the enum and leak into kickoff/recommend validation.
- **Carrying the field.** One entry in `RUN_FIELDS` (`lib/dispatch-fields.js`) covers all four store hops. A sparse key would need hand spreads in `addItem`, `_archiveItem` and both formatters. The seam reads the *history* doc, so a drop on the archive hop would silently disable the feature (the LIN-1698/1932 class).
- **Entrance** (`lib/dispatch-entrance.js`): add a `ROW_FIELDS` entry (:360), a `STEPS` rule and a lane-list entry. `ROW_KEYS.session` picks the field up automatically. `ROW_KEYS.proxy` (:403) is hand-listed: that's the copy you'd miss.
- **Tests pinning shape:** `dispatch-fields.test.js` (FIELD_NAMES/DEFAULTS, "23"), `lin-3134-default-path-characterization.test.js`, `dispatch-store-issue-binding.test.js` (literal key lists). All mechanical.
- **Docs:** `lib/proxy-instructions.js:805/823`.
- **SD @ cf6369dfd:** no change. The §5 matrix is Harbour-side.

**2. Difficult?** No. There's one site, one field declaration, and a fast store-level harness (`createMockCollection`; copy `lin-4080-run-stopped-wake-gate.test.js`). Two rulings to make:
- require `followUpTo` (reject otherwise, like `cascadeNeedsAbort`);
- not inherited. `inheritFromAnchor` (`lib/dispatch-factory.js:704`) carries only issue fields, so a later real-work follow-up still wakes.

**3. Menu**

- **Just drill:** a boolean (say `noWake`) in RUN_FIELDS, ROW_FIELDS, ROW_KEYS.proxy and STEPS, gated on `doc` beside LIN-4080. Copies it leaves unchanged:
  - `lib/liveness-detectors.js:472/517` (`answered`/`isAnswer`) still counts any follow-up into a lineage as an answer to its `[pending]`, so a question would mask a real wait.
  - The other follow-up producers can't set the flag: `lib/follow-up-dispatch.js` `enqueueFollowUp`, chat-tools `send_follow_up`, the reply box. That's fine for this scope; name it.
- **Small tidy first:** derive `ROW_KEYS.proxy`/`recommend` from a shared base. Cheap, but this task doesn't need it.
- **Consolidate:** "does this terminal owe a wake" already has one owner. Nothing to gather.
- **Theseus:** no. The cost is far out of proportion.

**Recommend: just drill.** Gate beside LIN-4080 and record liveness `isAnswer` as a named follow-on.

**4. Prediction**

1 plan-review round, maybe 2 over the field name and the not-inherited rule. Pieces:
1. field + validation + docs;
2. store gate + tests: terminal, blocked and pending all suppressed; witness not burned; a normal follow-up still wakes; the field survives take → archive.

Files: `lib/dispatch-fields.js`, `lib/dispatch-entrance.js`, `lib/dispatch-store.js`, `lib/proxy-instructions.js`, the three pinned tests above, and a new gate test.

**Bites later:** SD repoints `itemMetadata.itemId` onto each follow-up row (`dispatcher.js:330`). If a quiet question reaches a worker that is still live or parked for its autopilot, all of that worker's later feedback lands on the quiet row and is suppressed: the hourly close-out `[pending]`, a reaper `[failed]`, even its real `[done]`. The parent would never hear. Consider refusing the flag unless the target row is terminal.

**5. Couldn't check**

- Whether a warm signal and a cold resume both repoint the same way. Read `dispatcher.js:300–400` and send one quiet follow-up on staging.
- Which lane today's post-Done question senders use (proxy or session). That's live data: query recent `followUpTo` rows.
- No CSS or layout is involved. I didn't run the suite; run the three pinned files first.



---

## Survey v2: LIN-4167 @ 048c3319a

**1. Where it binds**

- **The deploy decision isn't in the repo.** At 048c3319a there is no `railway.*`, no deploy job and no `secrets.` in `.github/workflows/`. Railway's dashboard "Wait for CI" decides, and it skips a commit when attempt 1 fails (John, `docs/papers/harbour/how-the-charter-got-complicated-transcript/comment-6.md:46`). A repo fix *adds* a second trigger beside that setting.
- **`ci-success` in `.github/workflows/test.yml`** is the hook. It's `if: always()` and needs `[unit, e2e, secret-scan]`, so "Re-run failed jobs" re-runs it. A deploy step must check every `needs.*.result` and fire only on a `push` to `main` with `github.run_attempt > 1`.
- **"PR runs need no repo secrets"** (unit-job comment, 8c405f0). The token must never reach `pull_request` runs.
- **`tests/unit/node-version-pin.test.js:40`** scans every workflow: any `setup-node` needs `node-version-file: '.nvmrc'`. secret-scan and gitleaks flag inlined tokens.
- **Rollback.** Railway catches up when a later commit passes (same transcript), so re-running an *older* main run would push production backwards. Guard: `github.sha` is still main's head.
- **Deploy that exact commit.** `railway redeploy` repeats the last deployment, which is the previous commit.

**2. Difficulty.** Low in code: one guarded step. The real dependency is John: a Railway token as a GitHub secret, plus service and environment IDs (the project ID is in `docs/operator-execution.md`). The repo can't fix this alone.

**3. Menu**

- **Just drill.** Add a guarded step to `ci-success` that deploys `github.sha` through Railway's API or CLI. It fixes the ticket. It leaves two owners of "when we deploy": Wait-for-CI (the copy left behind) and this step. If Railway ever honours re-runs, the commit deploys twice, which is harmless.
- **Small tidy first.** Nothing to gather. `ci-gate-sweep.mjs` is about prompt surfaces.
- **Consolidate.** Turn off Railway autodeploy and deploy every green main run from Actions. One owner, but every deploy then rides on a token and on Actions. Too much blast radius for this ticket.
- **Theseus.** Not warranted.

**Recommend: just drill**, and record the two-owner split in `docs/architecture/ci.md`.

**4. Prediction.** One plan-review round, two if reviewers debate the head guard or CLI vs GraphQL. Pieces:

- (0, prerequisite) John: `RAILWAY_TOKEN` Actions secret for production, plus the IDs.
- (1) The guarded step.
- (2) A text test, like node-version-pin, pinning push-only, re-run-only and head-guarded.
- (3) Docs: `ci.md`, the CLAUDE.md CI line, and a pointer from `docs/incidents/2026-10-20-railway-build-pause.md`.

Files: `.github/workflows/test.yml`, `tests/unit/<new>.test.js`, `docs/architecture/ci.md`, `CLAUDE.md`.

Likely to bite later:
- The head check races a merge that lands mid-re-run.
- A deploy-capable token sits in every main-push run.
- The close-out footer check (`lib/deploy-info.js`, `RAILWAY_GIT_COMMIT_SHA`) breaks if a CLI or API deploy doesn't inject the SHA. `railway up` may not.

**5. Couldn't check**

- Whether Railway ignores every re-run or only "Re-run failed jobs".
- Which Railway call and token type deploys a given commit.
- Whether the SHA env var is set on non-GitHub deploys.

Check the first two with a `workflow_dispatch` dry run against Railway. Check the footer by deploying the current head through that path. End to end (red, re-run, deploy) can only be proved on real main at the next flake, so the PR should say that, not claim it's verified.



---

## Survey v2: LIN-4168 @ 048c3319a

**1. Where it binds**
- **The reset is a hand-written list in one seam.** `setLocalSession` (`routes/test.js:1480`) resets the team preference (`:1506`), task facts (`:1593`) and the issues memo (`:1596`). The other seed seams, `/test/set-session` (`:252`), `set-github-session` and `set-jira-session`, reset none of them.
- **Each holder is threaded in by hand.** `createTestRoutes` takes about 45 named dependencies (`routes/test.js:98`, `server.js:1204`). `resetTaskFactsForTest` sits in `server.js:3269`, away from its holder.
- **The holders have different shapes:**
  - Task facts hold an entry plus the refresh's `inFlight`/`lastAttemptAt` maps (`lib/task-facts-holder.js:54,132`).
  - `_workspaceIssuesMemo` is keyed by workspace **id**, not urlKey, and is only ever cleared whole (`server.js:3105,3134`).
  - `sessionsFeedCache` clears per urlKey (`routes/test.js:913`).
  - The comment/stamp dedupe caches hash their keys, so they can only be cleared globally (`:935`).
  - The PR caches are keyed by repo (`lib/github-pr-status.js:295,309`, `lib/pr-state-store.js:51`).
- **About 25 Mongo-backed stores** each have their own `/test/clear-*` route (`routes/test.js:627–1383`). Specs call them one by one.
- **Tests that pin the shape:** `freshDeps()` in `tests/unit/test-routes-worker-workspace-ids.test.js:64` and `test-routes-account-fixtures.test.js`, `lin-3969-seed-clears-queue-tokens.test.js` (a reseed deliberately keeps some state: `keepQueueTokens`), and `tests/e2e/lin-4110-reseed-held-facts.spec.js`.

**2. Why it's hard**
The code isn't tangled; three questions are hard.
- **Scope.** Does "everything under that key" include the Mongo stores, or only the in-memory holders? Folding them in changes what ~160 `beforeEach` blocks rely on.
- **Reset isn't one operation.** Task facts have to be *refilled*, not just cleared. `/state` never fetches (LIN-3324), so a holder that is merely cleared reads cold, and the LIN-4110 failure comes back.
- **"Can't be missed" needs enforcement.** A list, even a central one, is still a list.

**3. Menu**
- **Just drill.** Add `/test/reset-workspace?urlKey=` that calls the existing pieces. That gets you one call, but holders still have to be added to it by hand, so it misses the "can't be missed" requirement. It leaves `setLocalSession`'s inline trio, `/test/clear-workspace-issues-memo`, `resetTaskFactsForTest` and the uncovered set-session, GitHub and Jira seams where they are.
- **Small tidy.** Merge the trio into one `resetKeyState(urlKey)` dependency, delete the `resetTaskFacts` and `clearWorkspaceIssuesMemo` parameters, and call it from all four seed seams. Cheap, but a holder can still be missed.
- **Consolidate.** Build one per-key reset registry. Each holder registers an async `reset(urlKey)` when it is constructed: a refill for task facts, a clear for the others. All seed seams call `registry.reset(urlKey)`, the per-holder parameters are deleted, and a unit test or code-shape guard fails on a holder that isn't registered. This is the ticket, at moderate cost.
- **Theseus.** Split the 2,098-line `routes/test.js` into per-store modules. Out of proportion here.

**Recommend: consolidate.** Scope it to in-memory per-key holders and write down the global-only caches as exceptions. Bring the Mongo-store question to plan review rather than folding the stores in silently.

**4. Prediction**
2 plan-review rounds: one on scope, one on how registration is enforced. The pieces:
1. Registry module and its unit tests.
2. Register task facts (with refill), the issues memo and the sessions feed cache.
3. Wire all four seed seams and delete the old parameters and inline calls.
4. A guard test, plus a CLAUDE.md testing note.

Files: `server.js`, `routes/test.js`, `lib/task-facts-holder.js`, `lib/sessions-feed-cache.js`, a new `lib/` module, the `tests/unit/test-routes-*` tests, CLAUDE.md. The LIN-4110 spec stays unchanged and green.

What may bite later:
- The issues memo's key (workspace id; `uuidForUrlKey`/the shared `LOCAL_WS_UUID`) can't be addressed per urlKey without an id→key map.
- A "clear" registration on task facts would quietly regress LIN-4110.
- Global-only clears cross workers once LIN-625 raises `workers`.

**5. Couldn't check**
- **GitHub/Jira:** whether their fake fetches pass the write gate (`gateRefusalOf`) and whether any spec reads `/state` after reseeding them. Check: run those specs with `--repeat-each=3`.
- **Reseed cost** of the awaited refill: time `/test/set-local-session` before and after.
- **Spec ordering:** run `lin-4110-reseed-held-facts` with `look-alike-controls`, `--repeat-each`.
- **`workers` still 1?** Check `playwright.config.js` before relying on global clears.



---

