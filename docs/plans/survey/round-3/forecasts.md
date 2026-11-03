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

