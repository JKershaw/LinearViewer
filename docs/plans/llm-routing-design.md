# Every LLM use, classed and routed from one place (LIN-3820)

Status: design note, version 2, after John's direction on 23 October. Docs only. Version 1 (the policy-and-resolver design, "shape B") is in git history. John dismissed its ruling and asked for something simpler.
Queued behind the UI overhaul: build after LIN-3757 (UI overhaul, step 1) has chosen its direction. The page described here must follow that direction.
Covers both repositories: Harbour (`JKershaw/LinearViewer`) and `JKershaw/simple-dispatcher` (SD). Facts checked at Harbour `040a3e76` and SD `1798790`.
Out of scope: which model goes where (`docs/papers/harbour/cheaper-capacity.md`, Next), and setting up the Max API credit lane (LIN-3821).

## Why

John, 23 October:

- "Right now the settings are awkward, and my gut feeling is there's a much easier way to handle this."
- "It feels like over time specific models will start to specialise, so we need this system to be simple to maintain, granular, but also allow simple presets/grouping."
- "It should also be clear which are agents, which are the smaller calls in Harbour. I think groups and individual overrides could be nice."

The awkwardness has one cause: **models are chosen per code path, in three places that do not know about each other.** Those places are the app-call overrides, the per-kind dispatch defaults and presets, and SD's `workspaces.json`. Nothing checks a choice when it is made, and nothing records why it was made.

A good outcome:

- John can see every job an LLM does, what it costs, and which model does it.
- He can move one job, or a whole group, to another model in one edit with a reason.
- The next run uses the new model.
- An agent can read the same table and change it the same way, with the same record.

## What changed from version 1

Version 1 built a policy engine: versioned policies, a multi-step resolver with a trace, lanes as data, experiments, a proposals queue, and a week of shadow resolution. It came to about sixteen tickets. John asked for the simple version. Because specific models will come to specialise per job, the per-job setting is the real thing. Groups are a convenience for setting many jobs at once.

Kept from version 1:

- the six groups and where each use sits;
- the stock-take of today's code (below);
- the five defects found while taking stock (D1–D5).

Dropped, and listed under Deferred:

- lanes as data;
- experiments as a feature;
- the proposals queue;
- policy versions and the resolver trace;
- shadow mode.

## What is true now (unchanged from version 1)

Every claim below was read at the anchors. Lines are Harbour unless marked SD.

### App calls (Harbour calls OpenRouter itself)

There are 25 call sites. All go through four functions in `lib/openrouter.js` (`getRecommendation`, `getRecommendationStream`, `streamChat`, `streamChatWithTools`), and every one falls back to `DEFAULT_MODEL` (`:31`).

- **Resolver.** `resolveAiOperationModel` (`lib/workspace-preferences.js:229-241`): `forceDefault` → `resolveFreeTierModel()`, else `byKind[opKind].model || prefs.modelId || DEFAULT_MODEL`. `resolveWorkspaceModel` (`:174-185`) is the same without the per-kind step.
- **`AI_OPERATION_KINDS`** (`:209`): `recommend, recap, brief, scan, run-summary, session-summary, next-run, flight-companion, ship-biscuit, task-chat`.
- **Outside that list but logged:** `scan-retire` (shares `scan`'s override), `feedback-title`, `roadmap` (six layers), `roadmap-orientation`, `roadmap-chat`, `observer-pass`. These take the workspace model; roadmap and flight-companion also accept a per-request model.
- **Hard-coded, not resolved at all:** the session-summary precompute (`lib/session-materializer-precompute.js:71`) and the run paragraph (`lib/run-paragraph.js:203-206`). Both use `DEFAULT_MODEL` and a key that falls back to the free-tier key (`lib/run-paragraph-hook.js:30-37`). **They skip the free-tier clamp.**
- **The clamp is a convention, not a gate.** Each call site must pass `forceDefault: isFreeTier` itself. `PLANS[].clampsModel` exists but nothing reads it (`lib/plan-allowance.js:91-108`).
- **The call log** (`lib/llm-call-log.js:11-30`): `urlKey, feature, via, issueIdentifier, model, provider, tokens, cost, finishReason, maxTokens, reasoningTokens, durationMs, timestamp`. `model` is the model that actually served the call (`lib/openrouter.js:369`). The log has no requested model, no lane or key, and no failures: a call that errors, times out or aborts is never logged. Four call sites log `feature: null, urlKey: null` (run summary, session summary, the precompute, the run paragraph), so every reader, all of which filter by `urlKey`, misses them. A streamed recommendation is logged only after parsing (`:1180-1204`), so a paid call that fails to parse is lost.
- **The scheduler:** only `observer-pass` (`server.js:869`) calls a model.
- **Offline eval scripts** (`scripts/eval-*.mjs`) call OpenRouter directly and are never logged. They choose their models on purpose and stay outside the policy.

### Agent sessions (Harbour stamps a dispatch row, SD launches it)

- **Kinds.** `DISPATCH_DEFAULT_KINDS` (`lib/prompt-templates.js:206`) has 18 entries: `blocked, bug, plan, look-into, triage, breakdown, research, scoping, design, spike, context, plan-review, implementation, review, close-out, retrospective-audit, retro, autopilot`. `DISPATCH_KINDS` adds `defer, periodical, custom`, which get only the workspace-wide row. `wake` is in no list.
- **Who sends what.** The autopilot kickoff sends `autopilot`. Recommend-and-dispatch sends the stage router's action. Periodicals send `periodical`. Feedback sends `triage` or `autopilot`. Collective, chat `send_follow_up`, flight-companion Apply and the CI wake sweep send no kind, so their rows read `custom`. Wake rows are written straight to the store (`lib/dispatch-wake.js:204-221`) and skip the factory.
- **Precedence** (`lib/dispatch-factory.js:458-525`, field by field): explicit field, then selected preset (`byKind`), then the anchor's `presetConfig`, then (harness only) the anchor's own harness, then workspace `dispatchDefaults` (`byKind`, then workspace-wide), then the default harness interpose (`claude-code`). A source row scoped to a different harness from the one in force cannot donate its model or effort (LIN-1694).
- **Presets** (`lib/dispatch-presets-store.js`, CRUD at `routes/dispatch.js:1037-1114`, session auth only). Only the session UI lane and the kickoff honour `presetId`.
- **The row is stamped** with the resolved `kind, model, harness, effort` (`lib/dispatch-factory.js:1004-1024`). It does not record which tier decided them. `presetSnapshot` is stamped only on `autopilot` rows (`:587-595`).
- **Validation when set:** opaque strings, at most 1,000 characters and no control characters (`server.js:4080-4149`). An effort outside `low…max` only triggers a `console.warn` at dispatch (`lib/dispatch-validation.js:204-213`).
- **SD fills the blanks again** (SD `harnesses.js:499-555`): harness from the payload, then `workspaces.json`, then `DEFAULT_HARNESS`; model and effort from the payload, then `workspaces.json`, then nothing. It refuses a model that cannot be mapped to the harness (SD `executors.js:382-405`; claude-code accepts `opus/sonnet/haiku/fable/default` or `claude…`, opencode wants `provider/model`). opencode always routes through OpenRouter (SD `opencode-runner.js:89-103`) and never receives effort. SD makes no LLM calls of its own. Its injected turns (resume bootstrap, self-check) are billed to the session they run in.
- **Wakes and resumes.** A warm wake is delivered into the running process and keeps the launch model. A cold resume keeps the original harness (SD `dispatcher.js:901`), but re-resolves model and effort from the follow-up row and then `workspaces.json` (SD `:945-949`). A wake row has no model, so **a cold resume or a stall re-fire runs `claude --resume` with no `--model`** (SD `reapers.js:1695-1698`). In practice this gives Claude Code's own default. The ticket's snapshot invariant therefore already fails for cold resumes.
- **Subagents.** Nothing configures a subagent's model in an SD session. The in-repo runner kit (`lib/runner-kit/runner.mjs:630-638`) runs dispatch items *as* subagents and maps a model to `opus/sonnet/haiku`. It cannot map `fable`, and it drops effort.
- **What comes back.** `[usage]` carries `harness, model, effort, lane, costUsd` as actually used (SD `hook.js:359-378`, `opencode-runner.js:589-604`). It is sent only when `SD_WORKER_USAGE_RELAY` is on, which is off by default (SD `config.js:1269-1271`). `/cost` builds `workerSessions` from it (`lib/task-cost.js:85-186`). A lineage is priced at the last model seen.
- **Lanes are implicit.** claude-code reports `subscription`, or `api` if any `ANTHROPIC_*` variable is set (SD `hook.js:846-849`). opencode reports `openrouter`. App calls use the session key, the workspace key, the env key or the free-tier key (`lib/chat-request.js:172-177`). Nothing names a lane as a choice.

## The model

**Job.** A job is one named use of an LLM: a kind of agent session (review, implementation, autopilot…) or a Harbour call (recommend, brief, recap…). Every job sits on one of two **surfaces**:

- **agent sessions:** long sessions the runner launches;
- **Harbour calls:** short calls Harbour makes itself, through OpenRouter.

Each job carries a short plain-language description of what it does, and belongs to one group. The list of jobs lives in code beside the code that calls the model. A census test fails if a call site or a dispatch kind has no job.

**Group.** Six groups, each a kind of thinking:

| Group | Does |
|---|---|
| Judge | decides whether work is right |
| Plan | works out how, and what is true |
| Make | writes the change |
| Steer | decides what happens next, supervises |
| Sort | classifies or picks something small |
| Tell | summarises for a person |

Placements:

- **Agent sessions:**
  - Judge: review, plan-review, retrospective-audit, retro.
  - Plan: plan, research, design, scoping, breakdown, spike, look-into, context.
  - Make: implementation, bug, close-out.
  - Steer: autopilot, blocked, periodical, custom.
  - Sort: triage.
- **Harbour calls:**
  - Steer: recommend, next-run, task-chat, flight-companion.
  - Sort: scan, scan-retire.
  - Tell: brief, recap, run-summary, session-summary, run-paragraph, ship-biscuit, roadmap (and its orientation and chat), feedback-title, observer-pass.

Version 1 gives the reasons for the borderline ones: stage selection is Steer; close-out is Make; the observer pass is Tell while it only reports; `custom` is Steer.

**Setting.** What a job runs on:

- **Agent sessions:** where it runs (the harness: Claude Code, on the Claude subscription, or opencode, on OpenRouter or the API credit), the model, and the effort (Claude Code only; opencode never receives effort).
- **Harbour calls:** only the model.

**Group default.** Each group has one setting per surface it has jobs on. A job with no setting of its own follows its group, field by field. So a job can have its own model and still take its group's effort.

**Presets.** A preset is a named snapshot of the whole table: every group default and every job's own setting. Applying one is a single logged change. Saving the current table as a preset is one action. Examples: "All Opus (safe)", "Lean", "Credit lane".

**Change log.** Every change records:

- who made it, and how (the page or the proxy);
- when;
- what changed, from what to what;
- why: a reason is required.

Undo is a new entry that restores the earlier value. The 23 October move of autopilot from Opus 5.5 to Sonnet 5.5 is entered first, with its original time and actor (see the comment on LIN-3820).

**How a run gets its setting.** The order is short:

1. Fields given explicitly on the dispatch.
2. The job's own setting.
3. Its group default.

Two rules stay as today:

- the free-tier clamp on Harbour calls is checked first;
- a resume keeps its session's harness.

The dispatch row is stamped with the result and the job, as it is today with the model, harness and effort. SD keeps launching from the stamped row and holds the credentials.

**Wakes** are not jobs. A wake continues the session it wakes, on that session's setting. Fix D1 makes that true for cold resumes, which today run without `--model`.

**Checks when a value is set.** A choice that cannot run is not offered, rather than refused at launch:

- Claude Code offers Claude models;
- opencode offers the OpenRouter catalogue Harbour already fetches;
- effort is not offered for opencode.

One list of what each harness can run replaces the two hand-mirrored ones.

## The settings page

The page is **Settings › Models**, the first sub-page of Settings. This section describes what it does and why, not how it looks. Build it with the shell, tokens and shared components Harbour already has (`lib/components/`, the settings page's existing patterns), and in the direction LIN-3757 chooses.

John saw a clickable prototype of this page on 23 October and called it "the benchmark for UI UX standard I want for Harbour". He also said an agent given code or screenshots "may be over specific". So the prototype is deliberately not attached. Its lessons are the principles below.

**Principles (the bar):**

1. **Readability over style.** Plain words, generous spacing, one row per job, and a one-line description saying what each job does.
2. **Rank by what matters.** Jobs are ordered by spend, biggest first. Each row shows its spend, a bar for its share, and the typical cost of one run. The long tail folds behind "show".
3. **Summary before detail.** The two surfaces are separate views, each headed with its run count and spend, so agent sessions and Harbour calls are never confused.
4. **Say where every value comes from.** Each row's model and effort reads either "from Make" (following the group) or "set here", with a one-click way back to the group.
5. **Decide in context.** Changing a job opens a panel with what is needed to decide:
   - the job's numbers;
   - where it runs;
   - "follow the group" as the default;
   - a short list of sensible models, each with its price for a typical run and whether Harbour has run it for this job;
   - a search over every model the chosen harness can run;
   - effort.
6. **Make wrong choices impossible, not refused.** Picking an OpenRouter-only model switches the harness to opencode, and the effort control disappears there.
7. **Stage, explain, undo.** Edits collect as pending changes, saved together with one reason. The log offers undo.
8. **Works on a phone.** Rows stack, and the change panel becomes a full-screen sheet.

**Views:**

- agent sessions;
- Harbour calls;
- group defaults, showing how many jobs each group reaches and how many are set individually;
- presets;
- the change log;
- a filter for jobs set individually.

**Numbers come from what Harbour already records.** The cost endpoint gives agent sessions, and the call log gives Harbour calls. They cover a recent window; the default length is the builder's call. A job with no runs in the window shows as such. It is never left out.

## Over the proxy

An agent can do what the page does:

- **Read:** jobs, groups, each job's effective setting and where it comes from, presets, and the log.
- **Change:** a job, a group, or apply a preset. Each change takes a reason.

Writes are logged with the token's attribution. The recommendation is that only the workspace owner's tokens may write (question 2). Endpoint names and shapes are the builder's call. They follow the proxy's existing conventions and are documented in the proxy instructions.

## Migration: the switch changes nothing

At switch-over, every job resolves exactly as it does today:

- each `dispatchDefaults.byKind` row becomes that job's own setting, partial fields kept partial;
- each `aiModelOverrides.byKind` entry does the same for the matching Harbour call;
- every group default takes today's workspace-wide value.

The witness is a generated test over every job and a matrix of stored preferences, comparing old and new answers. Existing dispatch presets keep working per dispatch (question 3).

## Deliberate fixes, each its own ticket

These change behaviour, so each is named as an intended difference in the witness test.

- **D1. Cold resumes and stall re-fires run without `--model`** (SD `reapers.js:1695-1698`, `dispatcher.js:945-949`). Stamp wake rows with their session's setting, and have SD use it. This bears on reading the 23 October autopilot move: check the `[usage]` model on wake sessions before comparing that week.
- **D2. The session-summary precompute and the run paragraph skip the free-tier clamp.**
- **D3. Effort is silently dropped** on opencode and the runner kit, and the runner kit cannot map `fable`.
- **D4. The proxy instructions say `/dispatch` interposes no default harness.** The code does (`lib/proxy-instructions.js:790`).
- **D5. Subagent tokens in SD sessions are probably not counted,** and a lineage that changes model is priced at its last model.

## Deferred from version 1

Each can be added later without changing the model above:

- **Lanes as data:** who pays, limits, what happens when one runs out.
- **Experiments as a feature.** Until then, a trial is a preset applied for a while and read on the page.
- **The proposals queue.** Until then, an agent comments on a ticket, or writes over the proxy with an owner token.
- **Routing by the size or risk of a change.**
- **Subagents as jobs.**

## Questions for John

1. **Six groups as placed?** Recommend yes.
2. **Who may write over the proxy?** Recommend owner tokens only.
3. **Per-dispatch presets.** Keep `presetId` working as today, or retire it in favour of table presets? **Open.** John, 23 October: "that's a specific area we're prototyping next, along with the expandable task section on the home page." The answer comes from that prototype. Until then, `presetId` keeps working as today.
4. **D1 now, ahead of the queue?** **Answered, 23 October: yes, D1 first,** as its own ticket, not waiting on LIN-3757.

## Breakdown (filed when LIN-3757 has chosen its direction)

Status, 24 October: item 2 (LIN-3853) is built. `lib/model-routing.js` (pure table, migration, resolution), `lib/model-routing-store.js` (the store, log, undo, presets) and `routes/settings-model.js` (the three old forms, writing through the store). The witness (`tests/unit/model-routing-witness.test.js`) holds the resolvers frozen at `6ea1371e` against the store; its intended-differences table is empty and waits for D2 and D3. The first log entry (the 23 Oct autopilot move) was dropped by ruling; the log starts at each workspace's migration, and the move is on the charter (LIN-3490).

| # | Ticket | Repos | Done when |
|---|---|---|---|
| 1 | Jobs: the registry with group and description; census test; name the four call sites the call log misses | LV | Every call site and dispatch kind is a job; the test fails on one that is not |
| 2 | One settings store: job settings, group defaults, presets, change log; both surfaces resolve from it; migration and witness test | LV | The witness test is green and the store is the single source of truth; the old forms still write, through the store (item 4 retires them) |
| 3 | Proxy: read and write, with reasons and log | LV | An agent can read the table and change a job or group, and the log shows it |
| 4 | Settings › Models page, to the principles above and LIN-3757's direction | LV | John can move a job or a group in one edit with a reason, on desktop and phone |
| D1–D5 | The fixes above (D1 may go first) | both | Each named as an intended difference in the witness test |
