# Round 3 forecasts (Survey open-0, verbatim from LIN-4150)

Posted 3 Nov about 21:11 UTC, before any work began. Not edited.

## Survey open-0: LIN-4176 @ 9e397e6be

**Why it will be hard**

1. **"One read" has to answer different questions over different populations.** The fold and membership are already shared; what differs is the question and the rows: per issue (`/cost`); per job over 30 days, capped (`readModelsHistory`, `lib/model-routing-history.js:17`); per kind/model over the newest N rows with no time bound (`routes/dashboard-effort.js:159`); per lineage start day (`windowedSpend`); per `[done]` lineage (`/kpis`); and per loop group keyed `lineageId ?? loopId` (`lib/run-view.js:167`)—not lineage membership. "Same figure for the same issue or period" holds only once population and window are part of the read: is "in period" row `dispatchedAt`, lineage start or call `timestamp`; 30d or a row cap? That is the real design work.

2. **Three input shapes.** `buildTaskCost` takes formatted rows with full feedback. The KPI path takes a Mongo projection whose usage is `digestOr('kpiUsageEntry', {$last…})` (`lib/kpi-stats.js:460`). Run-view takes loops, and lean builds carry no feedback, so they read "not reported". One read needs one row source or a shared fetch layer; the KPI projection is shaped for speed.

3. **Harbour's own calls follow a second rule.** Worker cost goes through lineage membership. Call-log cost goes by the call's issue tag (`summarizeByIssue`). `summarize` still turns a null cost into 0 (`lib/llm-call-log.js`, the per-doc `cost` fold), and it feeds Health and Ship's Biscuit, which is fixed at 30d (`routes/ship-biscuit.js:155`). "Never silently zero" fails there today.

4. **The before/after proof.** `/cost` replays easily. Models, effort-readout and the KPI pages read live windows inside route handlers. Without a captured fixture per surface, proof drifts back to live data (tidy 3's lesson).

5. **"No issue loses a figure" carries a risk in.** Tidy 5 left 114 of 198 issues with no lineage, never compared with before. State the baseline (post-tidy-5) or this gate is ambiguous.

6. **LIN-4148 lives in the read.** A lineage's issue is decided at read time from whatever the newest-2000 sibling fetch returns (`routes/proxy-compute.js`, about line 690). Any shared read that keeps a row cap keeps the bug. Storing the issue on the lineage edges toward the fenced-out producer side.

7. **Size.** About 15 readers. The `/kpis` label clash ("Cost per finished task" means `[done]` lineages, not tickets) is an open question for John. Plus 6+ USD formatters (Q9). Unlikely to review in one sitting as one PR.

**What I'd do first**

First, a reader table at 9e397e6be (surface, question, population, window, input shape, unpriced rule), and each surface's output captured on one fixed set of stored and call-log rows as the "before" golden. That shows whether the read is really `(population, window, groupBy)`, makes the agreement test writable, and supplies the before/after inputs. Then settle three things up front:
- one definition of "in period";
- LIN-4148: fetch founders by anchor with no cap, rather than a new stored field;
- the `/kpis` label: ask John at the start, not at the end.

Consider two PRs: (a) the worker-cost read with `/cost`, Models, effort and the KPI pages; (b) call-log readers, unpriced display and formatting.



---

## Survey open-0: LIN-4127 @ 537981731

**Short version: the code change is easy. The parts that bind are one parse decision and the witness.**

**What I measured** (scratch worktree at 537981731, unit suite only, no E2E):
- `npm test` with the flag unset: 3358 pass, 46 fail. The 46 are caused by this machine (leak-trap census paths, the git probe, the fake-opencode spawns), not by the flag.
- `SD_WORKER_USAGE_RELAY=1` set in the environment: the same 46 fail, with identical names.
- A throwaway copy with only the default changed to `true` at `config.js:1350`: 47 fail. The extra one is `defaults OFF when the env var is unset` (`test/worker-usage-relay.test.js:72`), the test the ticket already plans to rewrite.

LIN-3234 did its job: the tests that delete the key and the strict OpenCode fetch mocks all stayed green. Line numbers have moved since `cf6369d`: the flag is now `config.js:1342-1350` and the comment is at 1342-1347.

**Why it's still not trivial**

1. **The parse idiom changes what counts as "off".** The ticket asks for default on with explicit `0/false/no/off` turning it off. That is the `ZERO_TOOL_DONE_GUARD` idiom, which LIN-4165 (`a7e5173`) just copied for `ASSISTANT_TEXT_RELAY`. Under that idiom, `garbage` and `''` become **on**. But `worker-usage-relay.test.js:82-86` asserts both are **off**, so "keep the explicit-off cases" conflicts with the test. `''` is also odd here: `load-env.js:28` treats an empty value as unset and fills it from `.env`, but `config.js` treats `''` as set. Decide which behaviour you want, and say it in the commit.

2. **The flag also gates OpenCode.** `opencode-runner.js:1125/1322` reads the same const, so after the change every OpenCode run adds two `GET /session/:id` roll-up fetches by default. The ticket only talks about the claude-code hook. They are best-effort, but the PR should name this. The stale "default OFF" comments at `hook.js:421` and `opencode-runner.js:582` also need updating.

3. **The witness is the real work.** The live host's `.env` already sets `=1` from the stopgap, so it can't produce the witness the ticket asks for. To get one, you have to remove a line that is currently keeping usage flowing. The order matters: merge, pull on the host, then take the line out of `.env`. Do it the other way round and usage goes dark again, which is the exact failure behind this ticket. Proving "no SD_WORKER_USAGE_RELAY in its environment" is also harder than reading `.env`. The hook loads `.env` itself, but how the session's environment is inherited depends on the launch driver: osascript launches with `scrubClaudeEnv(process.env)` (`terminal-driver.js:1060`), and tmux windows inherit the tmux server's global env.

**What I'd do first**

Settle the polarity question (point 1) and write it into the test before touching config. Then plan the witness as a procedure, not an afterthought:
- `grep SD_WORKER_USAGE_RELAY .env` returns nothing (the backup is already at `state/.env.backup-20261102-lin4126`)
- record the hook environment's value for the session, or the `tmux show-environment -g` / dispatcher-restart evidence
- quote the `feedback.post` oplog row whose `msg` starts `[usage]` (written at `hook.js:154`)



---


# Quality-of-life forecasts (Survey open-0, verbatim from LIN-4150)

Posted 3 Nov about 22:30 UTC, before any work began.

## Survey open-0: LIN-4180 @ 600f1be1c

**Cause.** `test/system/harness/harbour.js:16` defaults `HARBOUR_DIR` to `/home/user/LinearViewer`, then runs `spawn('node', ['server.js'], { cwd })` with no `'error'` listener. If the cwd is missing, Node reports `spawn node ENOENT` and names the binary, not the directory. I reproduced this. The fix is small, but these points make it harder than one line:

1. **Two copies of the default.** `test/system/mutation/run-mutations.js:21` has its own copy, and `test/system/README.md:18` and `docs/testing-and-ci.md:15` repeat the path. Fix one and the others drift, so resolve the path in one shared helper.
2. **More than one way to fail.** A directory with no `server.js`, or a checkout with no `node_modules`, makes the child exit at once. But `waitForServer` doesn't watch for the child's `exit`, so it polls for 45s and then dumps logs. "Found but not runnable" needs a plain message too.
3. **The message would print about 24 times.** `node --test` runs the 25 files as parallel child processes, and each boots its own Harbour. One pre-flight (`--test-global-setup` works on Node 25, or a pre-step in the npm script) says it once. That's a change to how the runner is wired, not just the harness.
4. **Finding a checkout automatically has traps.** On the runner host the layout is `<workspace>/simple-dispatcher` next to `<workspace>/LinearViewer`, and that sibling has `server.js` and `node_modules`. So the sibling works, with four catches:
   - **Worktrees.** A builder in a `/tmp` worktree has no sibling, so resolve from the parent of `git rev-parse --git-common-dir`, not `__dirname`.
   - **The leak trap.** `test/leak-trap.js` fails the run for any *read* under `/tmp` outside the run root, so probing for candidates inside a test child can break the run. Probe in the runner parent or the pre-flight.
   - **The mutation runner.** It edits Harbour source (`lib/dispatch-wake.js`) and then reverts it. Pointed at a discovered sibling that is a live working copy, it would edit that copy. I'd keep it on an explicit `HARBOUR_DIR` only.
   - **Which commit.** The sibling is at whatever commit its own task left it. Print the resolved path and its `HEAD` so each result can be traced to a commit.
5. **No test covers it.** CI runs only `npm test` (`ci.yml:5`). Make the resolver a pure function with a unit test in `test/*.test.js`, or the fix itself goes untested.

**What I'd do first.** Write `test/system/harness/harbour-dir.js`: `resolveHarbourDir({ env, root, exists })`. It tries, in order:
1. `HARBOUR_DIR`. If it's set and wrong, report that; don't fall through to the next candidate.
2. The sibling of the main checkout.
3. `~/LinearViewer` (`deploy/provision.sh:373`).
4. `/home/user/LinearViewer`.

A candidate must contain `server.js`, and a missing `node_modules` gets its own message. On failure, list every path tried and end with `set HARBOUR_DIR=/path/to/LinearViewer`. Unit-test it, then wire it into `harbour.js`, the pre-flight and `run-mutations.js` (explicit only). Last, add the `'error'` listener and the `exit` race in `startHarbour` as a backstop.



---

## Survey open-0: LIN-4181 @ 600f1be1c

**Why it'll be hard: the failure count depends on where you run from, not on the commit.** I ran `npm test` three times at 600f1be1c on this host, all in the same hour:

| Seat | Fail | Leak-trap rows |
|---|---|---|
| Workspace clone (`~/development/simple-dispatcher-workspaces/<id>/simple-dispatcher`) | **1** | 0 |
| Worktree at `/tmp/survey-open-LIN-4181` | **4** | 704 `shared` |
| Worktree with `TMPDIR` inside its own `state/` | **119** | 8,912 `state` |

None is 46, so the 3 Nov baseline came from an unrecorded location. Until that's fixed, "clean" is a moving target.

**Causes (all in the test harness, not the product):**

1. **Clone root follows the checkout's location.** `config.js:1029` defaults `WORKSPACE_CLONE_ROOT` to a folder next to the checkout. From `/tmp` that's `/private/tmp/simple-dispatcher-workspaces`, which the leak trap counts as shared temp. That's all 704 rows (`cycle-cost-witness.test.js:190`, `resources-host-sampler.test.js`, `dispatcher-terminal-retry-dep.test.js:123`). From the production checkout `~/development/simple-dispatcher`, the same default points at the *live* clone root. `test/isolate-run.js` pins only `SD_STATE_DIR` and `TMPDIR`.
2. **This host puts the session TMPDIR inside the production checkout's `state/`** (`TMPDIR=/Users/autopilot/development/simple-dispatcher/state/session-tmp/<session>`). `isolate-run.js` makes its run root under that TMPDIR. `leak-trap.js classify()` checks `state` before it checks the run root, so every write a test makes in its own sandbox counts as a state leak. That's the 119 row (simulated in the worktree), and what a run inside `~/development/simple-dispatcher` gets. I'd guess the 46 sits on this axis. The fake-opencode failures only appeared in this row, so they're probably not a separate cause.
3. **A test that checks the host rather than the code.** `git-launch-probe.test.js:123` fails from every location, with the message "the host git shim may have been repaired since this ticket was written". It asserts that the host's fault still exists. This is the ticket's "can't run here, say why" case: check the precondition and `t.skip(reason)` when it doesn't hold. The injected-`execFn` cases still cover the probe logic.

**Guardrails.** Don't widen the shared roots or exempt paths per test; keep `leak-trap.test.js` and `isolate-run.test.js` green. For (2), keep the run root out of `state/` rather than exempting it in `classify`, which would hide real writes to `state/`.

**Not checked:** the system suite. Its main-vs-branch difference may be (1) again: a clone and the main checkout see different paths. Check that before calling it flaky.

**What I'd do first:**
1. Reproduce this table, add the 3 Nov location, and post it on LIN-4181 as the baseline, naming where builders should run.
2. In `test/isolate-run.js`, pin `WORKSPACE_CLONE_ROOT` into the run root and refuse a run root inside `STATE_DIR`. That one file should clear most failures everywhere.
3. Turn `git-launch-probe.test.js:123` into a skip that states its reason.
4. Then re-run everything, system suite included.



---

## Survey open-0: LIN-4182 @ 600f1be1c

**Short version:** the rule itself is easy. The risk is in where the helper lives, and in the urge to tidy things beyond the ticket.

**What's there.** There are 16 hand-rolled on/off parsers, not only the ones in `config.js`:
- `config.js`: 11 module-level constants (`LAUNCH_BREAKER_ENABLED` :830, `AUTO_PAUSE_ENABLED` :855, `CLOSE_WINDOW_ON_DONE` :1274, `ZERO_TOOL_DONE_GUARD`, `ASSISTANT_TEXT_RELAY`, `TOOL_ACTIVITY_RELAY`, `OPENCODE_TELEMETRY_RELAY`, `WORKER_USAGE_RELAY`, `RESOURCE_RELAY`, `TICKET_MARKER_RELAY`, `HOST_HEARTBEAT`), plus two parsers that take a parameter: `SD_ALLOW_ROOT` (:398) and `SD_SKIP_GIT_PROBE` (:484).
- Outside it: `oplog.js:33` (`SD_OPLOG`), `resource-metrics.js:40` (`SD_RESOURCE_METRICS`), and `instance-guard.js:129` `isTruthy` (`SD_SKIP_INSTANCE_GUARD`).
- `SD_REAP_LEFTOVER_CLAUDE` (:1284) takes `off` or `log`, so it is not an on/off flag. Its comment says `on` must never mean anything. Leave it out, and say so.

**The good news.** The two idioms already follow one rule: only the word for the opposite of the default changes anything. Unset, empty, whitespace and garbage all give the default. Default-on flags look for `0|false|no|off`; default-off flags look for `1|true|yes|on`. Both are trimmed and case-insensitive. So `flag(raw, default)` can keep today's behaviour exactly, with no odd-value change to name. Tests already pin both halves: `worker-usage-relay.test.js:82` (garbage → on) and `tool-activity-relay.test.js:72` (garbage → off). The trap is a "smarter" helper that recognises both word sets, or warns and falls back. For a default-on flag, that changes what garbage means, and LIN-4127 chose its meaning on purpose.

**Why it's harder than it looks:**
1. **Where the helper lives.** `oplog.js`, `resource-metrics.js` and `instance-guard.js` deliberately don't require `config.js`. Requiring `config.js` runs `loadEnv()` at load time. If they import the helper from `config.js`, they pick up `.env` loading as a side effect, and `SD_OPLOG=0` in `.env` could start working where today it may not, depending on which module loads first. That would be an unnamed behaviour change. Put the helper in a dependency-free leaf module, the way `state-dir.js` is.
2. **Two call shapes.** `rootSkipPermissionsRefusal`, `gitLaunchProbe` and the instance guard take the raw value as a parameter so tests can inject it. The helper has to parse a raw value, not only read `process.env[name]`.
3. **Test isolation is partial.** `test/helpers/fresh-config.js` clears only `SD_*_RELAY` keys. A re-require test of `CLOSE_WINDOW_ON_DONE`, `HOST_HEARTBEAT` or the breaker flags sees whatever the host has set. Test the pure function directly.
4. **Leave alone:** `load-env.js` keeps quotes and inline comments (`SD_X="0"` reads as garbage, so the default), and it refills empty keys from `.env`. Different seam: mention them, don't fix them here.
5. **Comments to update.** About a dozen comments say things like "same idiom as CLOSE_WINDOW_ON_DONE (copied verbatim)". Change them in the same commit, or they'll send readers looking for copies that are gone.

**What I'd do first.** Write one table-driven characterisation test against the current code. It should take all 16 sites through `1/0/true/false/yes/no/on/off` in mixed case and padded, plus `''`, `'   '`, `garbage` and unset, and record what each returns. Then add `parseFlag(raw, default)` in a leaf module, swap the sites over one at a time, and keep that table green. If no row changes, there's nothing to name, and the PR can say so.



---

## Survey open-0: LIN-4183 @ 600f1be1c

**Why it's harder than "extract a function"**

1. **It isn't one copy; it's 17 copies that have drifted.** At 600f1be1c, 17 test files drive `hook.js` `main()` with the same pieces: a `fs.readSync` stdin mock, a `workspaces.json` stub, `globalThis.fetch`, a no-op `process.exit`, and an `updateState` seed. About 11 are close to `decision-emission.test.js` (they have a `MODULES` list and a fetch that returns 200 OK). The rest have diverged in ways the tests depend on:
   - `MODULES` lists differ. Some include `../refusal`, `decision-withdrawal` adds `../dispatcher`, and 5 files have no list.
   - `close-on-done-runtime` and `hook-done-post-runtime` hold fetch on a promise and call `main()` *without awaiting it*, so they can read state mid-flight.
   - `completion-unconfirmed-reaper-handoff` runs reapers after `main()`.
   - `tool-activity-relay-hold` sets up more than one Stop.

   A helper shaped only like `decision-emission` will fit about two thirds of these. The rest need seams: a fetch override, a way to start `main()` without awaiting it, and extra modules to reload.

2. **Setup order matters because of state read at require time.** `hook.js:16` reads the relay and timing flags out of `config` when it loads, and `hook.js:29` captures `HOOK_STARTED_AT`. `config` loads `.env` (LIN-3234). So the helper has to: set env, stub `loadEnv`, clear the require cache, and only then `require('../hook')`. If it gets the order wrong, tests still pass on CI and fail on a machine whose `.env` sets a relay flag. `test/helpers/fresh-config.js` (`isolateRelayEnv`, `stubLoadEnv`) already solves part of this and should be built on, not copied a second time.

3. **Global patching under two preloaded traps.** `npm test` preloads `isolate-run.js` (the leak trap, which fails on temp files outside the run root) and `state-cache-trap.js`. A helper that runs fine under bare `node --test` can still fail under `npm test`. Cleanup has to undo every patch in reverse; a missed restore leaks into the next test.

4. **"Keep checking what they check today" is easy to break without noticing.** A mechanical migration can drop small but load-bearing details while every test stays green. Examples: `executingWindow: { refire: true }` in close-on-done, which exempts the session from the zero-tool guard; whether a tool-activity line is seeded; `selfCheckAsked`.

**What I'd do first**

- Before touching anything, record each of the 17 files' test names and pass counts as a baseline to diff against.
- Write `test/helpers/stop-hook.js` from `decision-emission`'s `setup()`, built on `fresh-config`. It should take `{ env, session, transcript, fetch, extraModules }` and return `{ runStop, startStop, posts, stateFile, oplogFile, cleanup }`. `startStop` returns the un-awaited promise for the mid-flight cases.
- Migrate `decision-emission` and `worker-usage-default` (the LIN-4127 copy) first. Next, the other nine that match closely. Last, `close-on-done-runtime`, as the proof that the fetch override and `startStop` seams are enough.
- Leave `stalled-verify-early-refire-runtime` alone. It has a `MODULES` list but never drives the hook.

**Sizing:** the smallest complete version is the helper plus the ~11 near-identical files. Bringing the 5 divergent ones in is where the seams get tested; if one of them needs a flag that exists only for it, leave that file as it is.



---


# Rebuild 2 forecast (open-0)

## Survey open-0: LIN-4195 @ 723052153

Read at Harbour `723052153`, runner `cc2650a6d`.

**Why it will be difficult**

1. **"Last entry" lives in storage, not only in the fold.** Rebuild 1 put the fold in one place, but what callers fetch is still "the row's last `kind:'usage'` entry": `usageStateOf` (`lib/cost-read.js`), the KPI `$last` projection (`lib/kpi-stats.js:460`) and the digest's frozen `kpiUsageEntry` (`lib/digest-feedback.js:394`). Records kept elsewhere must be fetched and joined by every caller, not changed in one place.
2. **The current channel can't carry the records.** A feedback message is capped at 2000 chars (`lib/dispatch-feedback-validation.js:18`, `SD:feedback.js:6`). Non-terminal posts get one attempt with no retry, and an unknown `kind` is dropped silently. One Haiku session made 486 requests. That needs a batch endpoint, and Harbour must ship it before the runner posts to it.
3. **The runner chose snapshots on purpose.** `SD:hook.js:410-422` explains why: a delta cursor on a fire-and-forget POST under-reports forever. Records stay safe only if Harbour upserts by message id and the runner re-sends anything not acknowledged. Streamed messages grow across lines (LIN-3229), so "posting again changes nothing" has to mean a per-field max, not insert-if-absent.
4. **Pricing keys on harness, not on record kind.** `isRunningTotal` is `harness !== 'opencode'` (`lib/row-usage.js:21`). A per-request record tagged `claude-code` still prices Haiku over 100k to null. `computeUsageCostUsd` also returns null when every token count is 0, so a `<synthetic>` record would mark its whole lineage as not fully priced.
5. **The cutover can double-count.** Sessions in flight at deploy, and lineages resumed across it, will hold both snapshots and records. A rule has to pick one per lineage. It holds only if the new runner sends the whole transcript backlog, not from a cursor seeded at the end.
6. **A killed session has no transcript path.** The Stop hook writes `transcriptPath`, so a session killed before its first Stop has none. `reapers.js` never reads transcripts, and nothing in the runner reads `subagents/`.
7. **The call log isn't "no new shape".** `llm-call-log` holds prompt/completion/total tokens and billed cost, with no cache split, and about 42 sites read it as "Harbour's calls". Putting worker rows in it means filtering at every one of those sites.
8. **The witness needs transcripts.** The replay corpus (`tests/fixtures/cost-replay/`) is dispatch rows carrying snapshots. A before/after on the same input needs transcripts, run through the runner's old fold. The live measure needs the runner host's transcripts as its denominator.

**What I'd do first**

1. Decide where records live and what Harbour accepts: a batch endpoint, an upsert-by-max on `requestId`, and a record kind that pricing reads instead of harness. Ship it accepting but unread, with the cutover rule written down.
2. Build a transcript corpus covering Haiku over 100k, a subagent, mixed models, a `<synthetic>` tail, a session killed before Stop, and one resumed across the deploy. Record "before" by running today's runner fold over it, with a change list that must see every listed difference.
3. Only then switch the runner, and the read last.

