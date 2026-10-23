# Every LLM use, classed and routed from one place (LIN-3820)

Status: design note, for John's ruling. Docs only. The build is a set of child tickets filed after the ruling (listed at the end).
Covers both repositories: Harbour (`JKershaw/LinearViewer`) and `JKershaw/simple-dispatcher` (SD).
Checked at Harbour origin/main `040a3e76` and SD origin/main `1798790`, the ticket's own anchors. Nothing in the files the ticket cites has changed since it was written.
Out of scope: which model goes where (`docs/papers/harbour/cheaper-capacity.md` Next), and setting up the Max API credit lane (LIN-3821).

## Why

John, 23 Oct: "Right now the settings are awkward, and my gut feeling is there's a much easier way to handle this … we can also categorise and class each use of an llm in both Harbour and agents. There's a clean mental model (which scales)."

The awkwardness has one cause. **Routes are chosen per code path, not per kind of thinking, and in three places that do not know about each other.** So every move the paper recommends ("judging to Sonnet 5.5, building to Haiku 5.5") is many edits across two settings sections and a host file, with nothing recorded and nothing checked. Five symptoms come from that one cause:

1. **No shared vocabulary.** App calls are keyed by ten operation names, of which the call log uses some and not others. Agent sessions are keyed by 18 prompt kinds, of which about six run (`prompt-kinds.md`). A wake, a follow-up and a Collective run have no key of their own.
2. **Three resolvers.** `resolveAiOperationModel` for app calls, the `dispatch-factory` precedence list for sessions, and SD's own `workspaces.json` fill. Two are hand-mirrored lists ("Nothing automated catches this", `lib/render-settings.js:124-137`).
3. **Nothing checks a route when it is set.** Harness, model and effort are opaque strings (`lib/workspace-preferences.js:327`, `lib/dispatch-validation.js:71-84`). A bad pair is found when SD refuses the launch.
4. **Nothing records why.** Who set a value, when, from what, and why are not kept anywhere.
5. **The record of what ran cannot be grouped by kind of thinking.** The evidence exists (`/cost`, `llm-call-log`), but it is keyed by the same scattered names, and some calls are not named at all.

A good outcome: John moves "judging" to a new route in one edit with a reason. The next dispatch uses the new route. The call log and the cost endpoint show what that class costs and how often its work passes. An agent can read all of this, ask what route a use would get, and propose a change.

## What is true now

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

### Pieces to reuse

- **The proposal Apply/Decline pattern:** `lib/run-proposals-store.js` (durable, no TTL), surfaced like rulings through the operator decision queue (`lib/unanswered-decisions.js`).
- **The grants vocabulary:** `lib/proxy-scopes.js:26` (`GRANTS = ['take','dispatch']`, closed and server-assigned) and `lib/require-grant.js`.
- **The window estimate:** `lib/weekly-budget.js`.
- **The pricing table and its conformance sweep:** `lib/model-pricing.js`, `pricing-conformance-sweep`. The sweep already fetches the OpenRouter catalogue.
- **The SD host heartbeat** (SD `host-heartbeat.js`, LIN-1952), which already reports host facts to Harbour.
- **The capability ledger's absent-entry rule** (`docs/papers/harbour/capability-ledger-method.md:51-57`), which exists only as prose.

## The model

The ticket's four nouns and two records hold up. I keep them and change three things: a sixth class, routes that are partial below the class, and a rule that keeps the judge of an experiment fixed.

**The vocabulary is code. The choices are data.** A use exists because a line of code calls a model, so the list of uses, and the class each one starts in, live in code beside that call, guarded by a census test. Routes, overrides, lanes, experiments and their log are per-workspace data, changed in the UI or over the proxy, and they take effect on the next call.

### Use

A use is a named place an LLM is called. Its id has the form `<surface>.<name>`, with `surface` either `app` (Harbour calls OpenRouter) or `agent` (a session SD launches). Uses are as fine-grained as the code can tell apart. Each registry entry carries:

- its default class;
- its legacy keys (`opKind`, call-log `feature`, dispatch `kind`), so existing history maps onto uses without a backfill;
- a one-line description.

**A wake is not a use.** It continues the session it wakes, so it carries that session's use and route. This is true today for warm wakes and becomes true for cold ones with D1 below.

### Class

A class is the kind of thinking a use needs. It is where "the cheapest model that clears this task's bar" gets decided (`clear-the-bar.md`). I propose **six classes**: John's five, plus **Plan**.

| Class | The question it answers | Why it is its own class |
|---|---|---|
| **Judge** | Is this work right? | The ledger's high bar. The instrument every other outcome is measured with. |
| **Plan** | How should this be done, and what is true? | The ledger: cheap models build to standard but their plans "went round plan-review twice". Planning's bar is the judge's, not the builder's. |
| **Make** | Produce the change. | The bar a Flash-level model has cleared. |
| **Steer** | What happens next? Supervise. | An error here costs a whole wrong session, or a wrong order of sessions. |
| **Sort** | Classify, route or extract something small. | An error is cheap and gets corrected downstream. |
| **Tell** | Summarise for a person. | A person reads the output. No action follows from it unchecked. |

Plan is the one change to John's set. Without it, "move Make to Haiku" would also move plan, research and design. The ledger's evidence points the other way for those three. If John would rather keep five classes and see whether the data separates them, nothing else in this design changes. A class split later is a registry edit, and the witness test (Migration) keeps every route where it was until someone moves one on purpose.

### Every existing use, placed

Borderline uses are marked †, with the reason.

**App** (all on the OpenRouter lanes):

| Use | Today's key | Class |
|---|---|---|
| `app.recommend` (stage selection) | `recommend` | **Steer** † |
| `app.next-run` | `next-run` | Steer |
| `app.task-chat` | `task-chat` | Steer |
| `app.flight-companion` (turn, boot, proxy) | `flight-companion` | Steer |
| `app.scan` | `scan` | Sort |
| `app.scan-retire` | `scan` (log: `scan-retire`) | Sort |
| `app.feedback-title` | none | Tell |
| `app.recap` | `recap` | Tell |
| `app.brief` | `brief` | Tell |
| `app.run-summary` | `run-summary` | Tell |
| `app.session-summary` (on demand and precompute) | `session-summary` / hard-coded | Tell |
| `app.run-paragraph` | hard-coded | Tell |
| `app.ship-biscuit` | `ship-biscuit` | Tell |
| `app.roadmap` (six layers) | workspace model | Tell |
| `app.roadmap-orientation` | workspace model | Tell |
| `app.roadmap-chat` | workspace model | Tell |
| `app.observer-pass` | workspace model | Tell † |

**Agent:**

| Use | Today's kind | Class |
|---|---|---|
| `agent.review`, `agent.plan-review`, `agent.retrospective-audit` | same | Judge |
| `agent.retro` | `retro` | Judge |
| `agent.plan`, `agent.research`, `agent.design`, `agent.scoping`, `agent.breakdown`, `agent.spike`, `agent.look-into`, `agent.context` | same | Plan |
| `agent.implementation`, `agent.bug` | same | Make |
| `agent.close-out` | `close-out` | **Make** † |
| `agent.autopilot`, `agent.blocked`, `agent.periodical` | same | Steer |
| `agent.triage` | `triage` | Sort |
| `agent.custom` (custom prompts, Collective, follow-ups) | `custom` | Steer † |
| (`defer` is resolved away before dispatch, so it is never a session) | | |

- † **Stage selection is Steer, not Sort.** It decides which session runs next. A wrong pick costs a whole session, and the prompt system makes it the one path for every recommendation. Sort is for picks whose errors are cheap.
- † **Close-out is Make, not Judge.** Its template is "finish approved work: make the fixes review asked for, merge, … set Done". The judging is done before it starts. Its risk is a false Done claim, which is a matter for granularity by occurrence, not for its class.
- † **The observer pass is Tell** while it is report-only (`lib/observer-pass.js:13-21`). It becomes Steer if `observerAuthority` ever gets an acting branch.
- † **`custom` is Steer** because its callers are mostly supervisors and their follow-ups. The fix at the cause is for those callers to say which use they are (Proxy). After that, `custom` means only "a prompt John wrote by hand".

### Route

A route is what serves a call: `{ lane, harness?, model, effort? }`.

- **Lane: who pays, under what limits.** Lanes are data: `claude-subscription`, `anthropic-api`, `openrouter-paid`, `openrouter-free`, and later LIN-3821's BYOK lane. A lane record holds its id, payer, kind of limit, which surface and harness can use it, a **credential reference** (a name such as `sd:anthropic-api`, never a secret), and what happens when it runs out. At switch-over the lane is derived exactly as today: claude-code → subscription, opencode → `openrouter-paid`, app → whichever key the request already carries. It only becomes a real choice when SD holds more than one credential per harness (LIN-3821).
- **Harness (agent only):** `claude-code` or `opencode`. The runner kit counts as a harness variant for validation, because it has its own limits.
- **Model:** an id in the lane's catalogue. `null` keeps its meaning today: "the harness's own default".
- **Effort:** `low…max` or `null`.

**A route is checked when it is set.** A write is refused, and nothing is stored, unless all of these hold:

- the lane exists;
- the harness can use the lane;
- the model is in the lane's catalogue (the claude-code families, or the OpenRouter catalogue Harbour already fetches);
- the effort is a known level, and the harness applies it (opencode and the runner kit do not, so a set effort there is refused rather than silently dropped).

Two cases warn instead of refusing: a model with no price row (its sessions would price as unknown and leave cost per class blind) and a lane with no credential on any live host.

The harness facts come from **SD's heartbeat**. SD publishes its harnesses, their model families, whether each applies effort, and which lanes it holds a credential for (as booleans only). That replaces the two hand-mirrored lists with one contract, owned by the side that launches.

### Policy

A policy is per workspace, versioned, and the single source of truth for both surfaces:

```
{ urlKey, version,
  classes:   { judge: { app: Route, agent: Route }, plan: {…}, … },
  uses:      { 'agent.review': PartialRoute, … },     // overrides
  lanes:     { 'openrouter-paid': { whenOut: 'wait' | { reroute: laneId } }, … },
  experiments: [ Experiment ] }
```

- **A class has one route per surface.** App calls cannot run on a harness, and model ids differ between the two. So "move Judge" can be one edit to two cells, or to one. Most classes live on one surface: Tell is all app; Judge, Plan and Make are all agent; Steer and Sort span both.
- **Routes are complete at class level and may be partial below it.** A use override or a preset can set only `model`, and the rest falls through. This is what presets do today, and LIN-1694's rule still holds: a row scoped to another harness cannot donate its model. The merged result is what validation checks, for every use the change can reach.
- **Presets stay as a narrower scope**, re-keyed from kinds to uses and classes. They keep their snapshot semantics.

**Resolution order.** One function, `resolveRoute({ urlKey, use, issue?, preset?, anchor?, fields? })`, for both surfaces. Each step either decides the route or passes to the next:

1. **Free-tier clamp** (app surface): the first line, as today. Fail-closed: a free-tier request gets the curated free model whatever the policy says.
2. **Explicit per-dispatch fields**, recorded as `decidedBy: 'dispatch'`.
3. **The selected preset**, by use, then by class.
4. **The anchor's preset snapshot.** Then, for harness only, the anchor's own harness: a resume never switches engines.
5. **An active experiment** covering this use or class.
6. **The workspace use override.**
7. **The workspace class route.**
8. **An unregistered use** gets the **strongest route** on its surface. That is the highest-priced route the policy currently assigns there, not counting experiment arms, priced by `lib/model-pricing.js`. It is the ledger's absent-entry rule in code. It needs no extra setting, it follows the policy as the policy moves, and the settings page shows which route it is. The census test makes this a guard, not a path: every call site and kind is registered, so the step fires only for code that skipped registration.

The function returns the route and a **trace**: the step that decided each field. The trace serves the dry run and fills the stamp's `decidedBy`.

**Snapshot semantics.** The dispatch row is stamped with the resolved route, the use, the class, the `policyVersion` and the trace, when it is created. Later policy changes never touch a queued or running row. A change "takes effect on the next dispatch" because that is when resolution runs.

**When a lane runs out**, the lane's `whenOut` decides. The default is `wait`: the dispatch queues, and the page says why. `{ reroute: laneId }` must be set explicitly, is logged like any change, and is stamped on every rerouted call. Nothing spends money silently. Signals that a lane is out:

- the window estimate (`lib/weekly-budget.js`) and Claude's usage-limit refusals;
- OpenRouter's credit endpoint and 402 responses;
- the free tier's daily count;
- John marking a lane out by hand. This is always available, and it is the only signal for the API credit until LIN-3821 finds one.

**Experiments** are policy entries, so starting and stopping one are logged changes:

```
{ id, scope: { use } | { class }, surface,
  arms: [Route, Route], assign: 'by-ticket',
  stop: { until?: date, count?: n }, question: '…', measure: 'first-pass approval' | … }
```

- **`by-ticket`:** the arm is a hash of the root issue, so a ticket's whole lineage runs in one arm.
- **Stamps:** each call carries its `experimentId` and `arm`.
- **Results:** the experiment page shows its question and, per arm, cost, rounds and first-pass approval. It also counts in-scope dispatches that a preset or an explicit field pinned elsewhere, so an experiment cannot be starved without anyone seeing.
- **The judge is held fixed.** An experiment on the Judge class cannot start while another experiment that Judge measures is running, unless John overrides with a reason. Otherwise the instrument moves under the measurement (`capability-ledger-method.md`: "The judge is fixed, and routing never changes it"). Each outcome also records the judge's route, so comparisons can be made with the judge held fixed.

### Record: every call is stamped

| Field | App call (`llm-call-log`) | Agent session (dispatch row → `/cost`) |
|---|---|---|
| use, class | new | new (from kind via registry until stamped) |
| route requested | new (`requestedModel`, `lane`) | exists (`model, harness, effort`), plus `lane` |
| route served | `model` exists | `[usage]` exists |
| `policyVersion`, `decidedBy` | new | new |
| `experimentId`, `arm` | new | new |
| cost, tokens, duration | exist | exist |
| outcome | `status: ok / error / aborted` (failures are logged from now on) | verdict, rounds, first-pass approval (C11) |

Rows written before the stamps map onto uses through the registry's legacy keys. Cost per class therefore works on history from day one, as far back as the evidence stores go. When the requested route and the served route differ (Claude ignoring a model, or a provider substituting one), the session page shows it.

### Record: every policy change is logged

`llm-policy-log` is append-only, with one entry per change:

```
{ urlKey, version, at, actor: { accountId, via: 'ui' | 'proxy', tokenId? },
  path: 'classes.judge.agent', from, to, reason, refs: [url | ticket], proposalId? }
```

- **A reason is required.** An empty reason is refused.
- **Writes check the version they read.** Each write carries `baseVersion`, and a stale one is refused, so two edits cannot interleave silently.
- **A revert is a new entry** that swaps `from` and `to`, with its own reason. It is one press on the log.
- **Preset changes** go into the same log under `path: 'presets.<id>…'`.

### Proposals and who may apply

Agents propose and John applies. A proposal reuses the run-proposals shape (durable, no TTL, `proposed | applied | declined`): `{ change, reason, evidence: [queries or links] }`. It appears in the operator decision queue with Apply and Decline, as rulings do. Apply writes the change to the log with the agent's reason and `proposalId`. A `readWrite` token can propose. **Applying needs the workspace owner's session.** I recommend no new grant for now. If John later wants agents to start bounded experiments themselves, that is a third entry in the closed `GRANTS` list (`policy`), assigned by the server and refused by default, the same way `dispatch` was added (LIN-3136).

### The surfaces

**Harbour UI.** One Settings page, "Models", replaces the per-operation AI model overrides section and the dispatch-defaults rows:

- **Classes table.** Each class shows its route per surface and, for this week, calls or sessions, spend, share of the window, and first-pass approval where a judge exists. A row opens to its uses, their overrides, and each use's own volume and spend.
- **Edits.** Moving a class is one edit plus a reason. Reverting is one press on the log.
- **Lane strip.** Window used (estimate), API credit (manual until LIN-3821), OpenRouter credit, free requests used today, and what each lane does when it runs out.
- **Experiments.** Start, stop, and results against the question.
- **Log** and **strongest route** shown on the page.

Presets keep their own section, re-keyed to uses and classes.

**Proxy** (reads need only a token; a proposal needs `readWrite`):

- `GET /api/proxy/llm/uses | classes | lanes | policy | policy/log`
- `POST /api/proxy/llm/resolve`: the dry run. Body `{ use, issueIdentifier?, presetId?, fields? }`; returns the route plus the trace.
- `GET /api/proxy/llm/outcomes?class=&use=&model=&since=`
- `POST /api/proxy/llm/proposals`
- **`/dispatch` and recommend-and-dispatch take `use` or `class`.** Follow-ups inherit their anchor's use. Collective and chat follow-ups declare theirs. The proxy instructions tell agents to dispatch by use or class and never to name a model in prompt text. The explicit `model` field stays, for John, and is stamped `decidedBy: 'dispatch'` so pins are visible.

**SD:**

- **It follows the stamp.** A row that carries `policyVersion` launches on exactly its route. `workspaces.json` defaults fill only unstamped (legacy) rows, with a warning. The production file sets none of these fields today, so this changes nothing at switch-over.
- **It keeps the credentials.** It maps lane id → credential (a host login, an env var injected for that one session, opencode's `auth.json`). It refuses a lane it holds no credential for with a terminal `[failed]` naming the lane. It never substitutes another lane.
- **It publishes the capability manifest** in its heartbeat.
- **It echoes `use` and the lane it actually used** in `[usage]`.

## Shapes considered

### A. Label and log over today's stores

Add `use` and `class` stamps to the call log and the dispatch rows. Add a "class" grouping to the two existing settings sections, where editing a class writes the same value into every row it groups. Add an audit log to both stores.

- **Cost to build:** small, about three tickets. **Risk:** low, because no resolver changes.
- **Cost to live with:** high. Three resolvers and two hand-mirrored lists stay. A class is a UI fiction: a later edit to one row breaks it silently. Validation, audit and the proxy surface each have to be built twice. Lanes and experiments have nowhere to live.
- **Fit:** fails "one source of truth" and "a new use, model or lane is data". It treats the symptom, the hard edits, not the cause, the split.

### B. One policy, one resolver, today's stores folded in (recommended)

As described above. The registry is code, and the policy and its log are data in Harbour. The two resolvers become one. The workspace tiers of `aiModelOverrides` and `dispatchDefaults` are compiled into policy version 1. Presets become a narrower scope of the same policy. SD follows the stamp.

- **Cost to build:** medium to large, about eleven tickets, but the first two are useful under any shape.
- **Cost to live with:** low. One place to read, write, check, audit and expose. A new use is a registry line, and a new model or lane is data.
- **Risk:** the switch-over. That is covered by shadow resolution and the witness test (Migration).
- **Fit:** reuses the proposals store, the decision queue, the grants vocabulary, the pricing table, the window estimate and the heartbeat. It keeps the LIN-1694 row rule and preset snapshot semantics.

### C. Policy as a committed file

Keep the policy in the repo (`config/llm-policy.json`), so a change is a PR, the log is git history, a revert is `git revert`, and an agent's proposal is a PR.

- **Cost to build:** smallest for the audit and proposal parts, because they come free.
- **Cost to live with:** high, in a different way. A change takes effect on deploy, not on the next dispatch. Harbour is multi-workspace and has free-tier users, so a repo file is one policy for everyone, or a file per workspace in public source. "One edit in Harbour's UI" becomes a PR.
- **Fit:** the half worth keeping, a vocabulary in code guarded by a census test, is already in B.

### Recommendation

**B.** It is the only shape that removes the cause: three resolvers keyed by code path. Every "for John" and "for agents" behaviour then falls out of one store, as John's words expect. A treats the symptom, and C fits a single-tenant tool, which Harbour is not.

**What would change my mind:**

- If John wants the two step-down trials from `cheaper-capacity.md` running before B lands, do C1–C2 first (shape-agnostic) and run the trials as today's preset edits. B's experiments then take over the next round.
- If Harbour were one workspace with no free tier and John were content to change routes by PR, C is cheaper.
- If the classes do not survive contact with the data (cost and outcome per class flat across Plan and Make, say), merge them. That is a registry edit. Nothing else in B depends on the class count.

## Migration: the switch-over changes nothing

1. **Compile.** `compileLegacyPolicy(prefs, presets)` builds policy version 1 for each workspace with no policy:
   - **App:** every class's app route is the workspace model (`prefs.modelId || DEFAULT_MODEL`), on the lane the request's key implies. Each `aiModelOverrides.byKind` entry becomes a use override. `app.session-summary` precompute and `app.run-paragraph` get a use override pinned to `DEFAULT_MODEL`, which is what their hard-coding does today. The free-tier clamp stays step 1.
   - **Agent:** every class's agent route is the workspace-wide `dispatchDefaults` row, including its blanks (blank harness → the interpose, blank model → the harness default). Each `byKind` row becomes a use override, with partial fields kept partial. Presets are re-keyed from kinds to uses.
   - The compile is written to the log as version 1, actor `system`, reason "LIN-3820 switch-over: compiled from dispatchDefaults and aiModelOverrides". So John's first real edit has a "from" to revert to. Changes made before the log exists are entered by hand ahead of version 1, with their original date and actor. The first such change is John's move of the autopilot default from Opus 5.5 to Sonnet 5.5 on 23 October, about 18:40Z (the comment on LIN-3820).
2. **Witness test.** For every registered use, crossed with a matrix of fixture preferences (none, workspace-only, `byKind`, partial rows, rows scoped to other harnesses, presets, anchors with and without `presetConfig`, explicit fields, free tier on and off), the old resolver and `resolveRoute` return the same `{harness, model, effort}` and app model. The matrix is generated, not hand-listed. Any registry change, such as a class split or a use moved, must keep this test green, which forces a compensating override in the same change.
3. **Shadow.** Production resolves both ways for a week, serves the old answer, and logs any disagreement with its inputs. Switch-over waits for zero disagreements.
4. **Switch.** Serve `resolveRoute`. The old fields become read-only, and settings writes go to the policy. The old fields are deleted one release later.

**What the switch-over deliberately does not fix.** These were found while taking stock. Each changes behaviour, so each is its own ticket after the switch-over, where the witness test can name it as an intended difference:

- **D1. Cold resumes and stall re-fires run without `--model`.** Stamp wake rows with the parent session's route, and have SD use it. This restores the snapshot invariant for wakes. It also bears on reading John's 23 October autopilot move: only warm wakes are sure to have followed it. A cold-resumed wake ran on Claude Code's own default, so the `[usage]` model per wake should be checked before the week's comparison is read.
- **D2. The two precompute calls skip the free-tier clamp.** Bring them under step 1.
- **D3. Effort is silently dropped** on opencode and the runner kit, and the runner kit cannot map `fable`. Validation refuses these routes from C5 on. D3 cleans up existing rows.
- **D4. `lib/proxy-instructions.js:790` says the proxy `/dispatch` interposes no default harness.** The code does interpose one. Correct the text.
- **D5. Subagent tokens in SD sessions are probably not counted,** and a lineage that changes model is priced at the last model. Check, then fix or state the limit.

## Questions for John

1. **Classes.** Six (adding Plan) or your five? And the four † placements: stage selection is Steer, close-out is Make, the observer pass is Tell, `custom` is Steer. *Recommend: six, as placed.*
2. **Granularity by occurrence** (a docs-only review against a data-path review). *Recommend: a later design.* `resolveRoute` already takes the issue, so adding "facets" later changes no signatures. This design adds no facets, so the switch-over stays provable.
3. **Wakes.** *Recommend: no wake route.* A wake carries its session's use and route, which D1 makes true for cold resumes too. A wake route only means something if wakes become fresh sessions (`held-or-fresh.md`). If they do, a fresh wake becomes its own use (`agent.wake`, Steer) and needs no new mechanism.
4. **Subagents.** *Recommend: out of scope for this design.* Their tokens belong to their session's use, and D5 checks that they are counted. If they come in, each subagent role becomes a use.
5. **Who may apply a change.** *Recommend: the owner only.* Agents propose, John applies with one press. A `policy` grant can come later, scoped to starting experiments.
6. **Strongest route.** *Recommend: computed* as the highest-priced route the policy uses on that surface. The alternative is a value John sets.

## Breakdown (filed as child tickets after the ruling)

C1 and C2 are useful under any shape and can start first.

| # | Ticket | Repos | Done when |
|---|---|---|---|
| C1 | Use registry, census test, legacy-key map. Name the four unnamed call sites | LV | Every call site and kind is registered; the test fails on an unregistered one |
| C2 | Stamp every call: call-log fields, failed and aborted calls logged, log-before-parse; dispatch row fields; `/cost` exposes them | LV, SD (`use` echo) | Every LLM call and session carries its use and class |
| C3 | Policy store, log, `compileLegacyPolicy`, `resolveRoute` with trace; witness test; shadow mode | LV | The witness test is green; shadow is logging disagreements |
| C4 | Switch-over; old fields read-only, then removed | LV | Zero shadow disagreements for a week, then served |
| C5 | Route validation; capability manifest in the SD heartbeat | LV, SD | A bad route is refused at set time; the hand-mirrored lists are gone |
| C6 | SD follows the stamp; lane → credential map; refuses a missing credential | SD | A stamped row launches on exactly its route |
| C7 | Settings "Models" page: classes, uses, cost per class, log with revert, strongest route | LV | One edit moves a class, with a reason, effective on the next dispatch |
| C8 | Proxy: read endpoints, dry run, outcomes, proposals into the decision queue; dispatch by use or class | LV | An agent can read the policy, dry-run a resolution and propose a change |
| C9 | Experiments | LV | Start, stop and results against the question; the judge-fixed rule enforced |
| C10 | Lane status and `whenOut` | LV, SD | Each lane shows its state and its stated behaviour when out |
| C11 | Verdict field on review and plan-review, joined to the judged session | LV, SD | First-pass approval per class and model is a query |
| D1–D5 | The deliberate fixes above | both | Each named as an intended difference in the witness test |
