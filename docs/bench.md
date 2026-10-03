# Harbour Bench: a mini benchmark on our own tasks

> **Status: proposal, 3 October 2026. Nothing here is built yet.** It turns pieces that already
> exist (the LIN-3189 replay scripts, the `/cost` lineage, the blind reader, the capability
> ledger) into one run that can be repeated for any harness and model. The companion playbook
> for bringing a new harness in is simple-dispatcher's `docs/adding-a-harness.md`; this bench
> is that playbook's first gate.
>
> **Decided the same day (John):**
> - Start on one cheap target to prove the plumbing, then expand slowly; Harbour's whole spend is
>   about $300 a month.
> - Only headline results are public. The evidence is recorded in a separate repository, so it
>   does not bloat this one.
> - Opus, run through Claude Code, is the judge for now.
> - It runs on the normal dispatcher host.
>
> Sections 7 to 11 reflect these decisions.

## The short version

- **Twenty real, finished tasks** from LinearViewer and simple-dispatcher. Each is frozen at the
  commit its work started from, with the ticket text as it stood when the original agent was
  dispatched.
- **Any configuration** (harness, model, effort) runs over them one task at a time. Each run
  gets a fresh copy of the repository that holds no commit from after the task started.
- **Quality is scored by machine first:**
  - the tests the original change shipped;
  - the tests of the later fix, where the original shipped a fault;
  - the unit suite, for regressions.

  Then one blind read compares the result with what actually shipped.
- **Cost and time** come from each harness's own report, checked against a dedicated API key's
  meter.
- **Cheap, and it starts small.**
  - The plumbing proof runs one cheap target on five tasks, for about $3 of OpenRouter spend.
  - The first full run puts the same target on all twenty tasks, twice, for about $20.
  - Challengers then join one at a time, cheapest first.
  - The judge runs on the Claude subscription, so it spends quota, not cash.
- **Honest about its size.** Twenty tasks find big differences, such as "cannot do our work" or
  "does it for a tenth of the price". Small differences are ties, and a tie goes to the cheaper
  configuration.
- **Headline public, evidence private.** Each run's headline row goes into this repository. The
  evidence goes into a separate private repository, proposed as `harbour-benchmarks`: packets,
  records, diffs, judge reads and transcripts.

## Why our own

- **Public scores do not transfer.**
  - The capacity levers map already ruled to price a lane "on Harbour's own probes ... not on
    the leaderboards" (`docs/reviews/capacity-levers-map-2026-08-15.md`).
  - Most leaderboard numbers are vendor-reported, and they fold harness and model into one score.
  - They also leak. An audit of SWE-bench Pro found that in 33 of 38 cheated trials the agent ran
    `git log --all` or `git show <gold-hash>` and pasted the merged fix
    ([Datacurve, 26 May 2026](https://deepswe.datacurve.ai/blog/deepswe)).
- **Our tasks are particular.** They follow each repository's CLAUDE.md, its test idioms and its
  invariants, and only our own tasks measure that.
- **Most of it is already built.** The LIN-3189 replay (`scripts/survey-replay-*.mjs`,
  `docs/papers/harbour/replay-small-work.md`) already did the core loop:
  - built worktrees at a parent commit and gave fixed prompts;
  - ran the shipped tests and the fix tests on the result;
  - checked fences;
  - had a blind frontier reader judge the result against what shipped.

  The bench makes that replay repeatable, with harness and model as the variables. It also fixes
  the two flaws the replay found in itself: hindsight in the ticket text, and the future sitting
  in the shared object store.

**What the bench does not answer:**
- **Process.** `docs/papers/harbour/model-choice.md` found that cost per correct change moved
  with dispatches per change, not with the model tier. That question stays with the scorecard and
  the papers.
- **Routing defaults.** The bench is a screen, not a verdict. A default changes only after a
  production trial behind the unchanged review gate
  (`docs/papers/harbour/capability-ledger-method.md`).

## 1. A task

A task is a directory, built once per task set and never edited afterwards. It lives in the private
evidence repository (section 8):

```
task-sets/<task-set>/<LIN-n>/
  task.json     track, repo, base sha, original merge sha, frozenAt, size band, area, sources
  prompt.md     the frozen ticket text the agent receives
  hidden/       what the agent never sees: shipped tests, fix tests, the known finding
  reference/    what shipped: the original diff or comment, and what it cost and took
```

- **Base commit.** The parent of the original change's first-parent merge on `main`, as the replay
  used. A task therefore needs exactly one first-parent merge.
- **Frozen text.** The title, description and comments as they stood when the original leg was
  dispatched, not as they read now.
  - **Why:** the replay used the final description and found it leaked the answer. Eight
    descriptions carried what shipped. Four tickets replayed from the earlier text moved two blind
    verdicts from better to worse (`replay-small-work.md`).
  - **Sources, in order:**
    1. The latest task snapshot captured before the original dispatch
       (`GET /api/proxy/issues/:identifier/snapshots`, `lib/task-snapshot-store.js`).
    2. Otherwise, the ticket as read in the original session's transcript.
    3. Otherwise, the task is not eligible.
  - **Comments** are kept only if they were created before that moment.
- **Reference.** What shipped and what it cost: the original leg's sessions from
  `GET /api/proxy/issues/:id/cost`, which gives the realised harness, model, effort, cost and
  duration of each session.
  - Count every implementation session up to the merge, including send-back rounds, because the
    candidate gets one shot at what the original got several.
  - This gives every run a free baseline row.

Nothing from a packet lands in this repository; only the headline does.

## 2. Three tracks, twenty tasks

Implementation, review and research are where we lean on general-purpose harnesses, and where a
check exists.

| Track | Tasks | The agent gets | Hidden checks | Blind read |
|---|---|---|---|---|
| Implementation | 10 | the frozen ticket (the approved plan is in it), in a box at the base commit | the original change's unit tests; the fix's tests where the original shipped a fault; the unit suite for regressions | the candidate's diff against the shipped diff |
| Review | 6 | the frozen ticket, and the diff the original reviewer first saw | 4 PRs with a known blocking defect, 2 clean PRs | does the must-fix list name the known defect? |
| Research | 4 | the frozen ticket at research time | the production files the eventual change touched; every `file:line` citation must resolve | the candidate's note against the original research comment |

A committed script applies the selection before anything runs, as `scripts/survey-replay-select.mjs`
did.

**Every track**
- The ticket is Done, with one first-parent merge on `main`, merged in the last eight weeks.
- Its frozen text is recoverable.
- Checking it needs no credentials, network, production data or browser.
- At least five of the twenty come from simple-dispatcher.

**Implementation**
- **The shipped change includes unit tests, and the frozen text names the interface those tests
  call.** Otherwise a correct candidate fails on naming alone. The replay coded such failures
  *interface* rather than *behaviour*. The same SWE-bench Pro audit found its verifier rejecting
  correct work in 24% of trials.
- **Spread across sizes and areas.**
  - Sizes: 1–49, 50–299 and 300+ production lines, the bands `model-choice.md` uses.
  - Areas: lib, routes, a page, runner or harness code, prompts.
- **At least three with a known fault.** Candidates are escapes with an introducer in
  `docs/papers/harbour/reliability-baseline-defects.json`. Read them by the strict rule (drop any
  reason saying the fault predates the change), and keep only those whose fix shipped unit tests.
- **At least one harness-code ticket.** This is the shape where Flash was green and wrong four
  times in six (`docs/reviews/pre-ramp-harness-run-2026-09-14.md`).
- **At most one page ticket**, judged by reading until the bench runs a browser.

**Review**
- **Four PRs with a known blocking defect.**
  - Candidates are the tickets with a classified blocker in
    `docs/papers/harbour/reliability-baseline-review-blockers.json` (18 of its 29 have one).
  - The fix must have landed on the same PR. The diff the reviewer first saw is then the PR head
    just before the review comment.
  - One of the four may be an escape instead: the introducing PR's diff, with the later fault as
    the known finding. This is the hard case, where our own review missed it.
- **Two clean PRs**, approved first pass, with nothing escaped within 30 days.

**Research**
- Research legs whose ticket then shipped, so the merged diff says where the change actually
  landed.

## 3. The box

Each run gets a fresh directory, built from scratch.

- **No future.**
  1. Clone the repository and check out the base commit.
  2. Delete every other ref, expire the reflog and run `git gc --prune=now`.
  3. Assert that `git cat-file -e <original merge sha>` fails.

  The replay's worktrees shared the object store, so the answer was one `git show` away. The
  SWE-bench Pro audit shows agents do reach for it.
- **Dependencies** come from the base commit's own lockfile (`npm ci`, cached by lockfile hash).
  They are not symlinked from a later clone.
- **No credentials except the model's.** No `gh` login, no Harbour proxy token, no git remote.
  simple-dispatcher's opencode launch copies the `gh` config and token into its scratch HOME
  (`harnesses.js`, the GitHub CLI auth block). The bench adapter must not.
- **No web for implementation and review.** LinearViewer is a public repository, so every merged
  answer is on GitHub. Research may use the web, and the fence check flags any fetch of the
  repository itself.
- **Fences checked afterwards.** Scan the transcript for:
  - reads outside the box;
  - git commands naming other refs;
  - network calls;
  - spawned subagents.

  `scripts/survey-replay-fences.mjs` already has the patterns. A violation voids the run.

## 4. A configuration and its adapter

A configuration is a harness, a model and an effort. A variant such as the stepper can be added
later. Each harness needs a **bench adapter**: a small module that launches the harness headless
in the box with the prompt, and returns one record per run.

| Field | What it holds |
|---|---|
| `config` | harness, harness version, model as requested, effort |
| `realisedModel` | the model the harness says actually ran |
| `outcome` | `done`, `failed`, `blocked`, `timeout` or `infra` |
| `declared` | what the agent declared in the completion self-check |
| `wallMs`, `turns` | wall-clock time and model turns |
| `tokens` | input, output, cache read and cache write |
| `costUsd`, `costSource` | dollars, and whether they are `native`, `priced` from tokens, or `null` |
| `diff`, `transcript` | paths to the final diff and the session transcript |

**Rules every adapter keeps**
- **Record the model that actually ran**, from the harness's own output. If it differs from the
  model requested, void the run. Until 12 July every claude-code session ran at the frontier tier
  whatever the dispatch asked for (`model-choice.md`, LIN-1285).
- **Cap the spend and the time.**
  - Use a dedicated API key per configuration, with a credit limit equal to its budget. An
    OpenRouter key's own usage figure is then the ground truth for spend. A shared key's $20 daily
    cap killed three bake-off launches.
  - Stop the run at 45 minutes for implementation, and at 20 minutes for review and research.
- **Ask for the outcome.** After the task turn, send simple-dispatcher's completion self-check
  (`SELF_CHECK_PROMPT` in `hook.js`) and record what the agent declares.
  - A run that declares DONE and fails its checks is a **false done**, the failure that matters
    most.
  - Example: gpt-oss-120b reported `[done]` after six seconds and fifteen tokens
    (`docs/reviews/cheap-implementer-bakeoff-2026-09-13.md`).
- **Pin the harness version and flags**, and write them into the record.

**The first two adapters are the two production harnesses.**

- **claude-code.** Run `claude -p` with these flags:
  - `--output-format json`: the result carries `total_cost_usd` and a per-model breakdown, both
    client-side estimates;
  - `--model` and `--effort`;
  - `--max-budget-usd`, as the spend cap;
  - `--dangerously-skip-permissions`, as production launches, plus `--permission-prompts none`, so
    anything that would still prompt is denied instead;
  - `--disallowedTools WebFetch,WebSearch` on the implementation and review tracks;
  - simple-dispatcher's dispatch settings, without the Stop hook.

  Do **not** pass `--bare`: it skips CLAUDE.md, which every production session reads. The
  documentation says `--bare` will become the default for `-p`, which is why the flags are pinned.

  On timeout, send SIGINT before SIGTERM, because a SIGTERM exits 143 and records no result. For a
  killed run, fall back to the usage in the transcript (`walkUsage` in simple-dispatcher's
  `transcript.js`).
- **opencode.** Use simple-dispatcher's own `opencode-runner.js`. It already:
  - runs `opencode serve` headless;
  - sends the self-check as a second turn;
  - rolls up the whole session's usage (LIN-2835).

  A bench mode writes the record to a file instead of posting it to Harbour, and denies opencode's
  web tool in its permission config on the implementation and review tracks.

The full contract, including how a third harness is added, is in simple-dispatcher's
`docs/adding-a-harness.md`.

## 5. Scoring

### Implementation

Score in this order:

1. **Shipped tests.** Copy the original change's unit test files onto the candidate's final tree
   and run them by file. Code each failure as *interface* (it calls a name the candidate never
   created) or *behaviour*.
   - `scripts/survey-replay-tests.mjs` runs them and prints each failure; the replay coded them
     by hand.
   - A rule can do the first pass: "is not a function", "Cannot find module" or a missing export
     means *interface*.
2. **Fix tests** (known-fault tasks only). Run the fix commit's tests. They fail on what shipped:
   do they fail on the candidate?
3. **Regressions.** Run the unit suite at the base and on the final tree. In LinearViewer that is
   `npm run test:unit`; in simple-dispatcher, `npm test`. A test that passes at the base and fails
   afterwards is a regression.
4. **Blind read.**
   - **The judge** is fixed: frontier tier, fixed effort, and the replay's blind-reader prompt from
     `scripts/survey-replay-emit.mjs`.
   - **What it sees:** the frozen ticket and two unlabelled diffs. The original is A on odd ticket
     numbers.
   - **What it answers:** A better, equivalent, or B better.
   - **One order is enough.** The replay's swapped second read agreed on all 12 tickets it
     completed. The first position was preferred 9 times and the second 10 (`replay-small-work.md`).

A task is **resolved** when all of these hold:
- no shipped test fails on behaviour;
- nothing regresses;
- the blind read is not "worse".

Interface-only failures go to the blind read. **Faults avoided** are counted separately, on the
known-fault tasks.

### Review

- **The contract.** The candidate ends with a verdict line and a numbered must-fix list, the
  replay's reviewer contract.
- **The judge's one question.** It reads the list beside the known finding and the fix diff, and
  answers: does any must-fix item name this defect?
- **The score:**
  - known defects caught, out of 4;
  - clean PRs blocked, out of 2.
- **Must-fix items raised on clean PRs** are listed in the report for anyone to read.

### Research

- **File recall:** the share of the eventual change's production files that the note names.
- **Citations:** the share of `file:line` citations that exist at the base.
- **Blind read** against the original research comment.

A note is **useful** when all of these hold:
- it names at least half the files;
- at least nine in ten of its citations resolve;
- the blind read is not "worse".

These thresholds are provisional. The raw numbers are kept so the thresholds can change later.

### Cost

- **Source, in order:**
  1. The harness's own figure, where it gives one.
  2. Otherwise, priced from tokens with `computeUsageCostUsd` in `lib/model-pricing.js`. It has no
     DeepSeek, GLM or Gemini rows today, so either add them or use the native figure.
  3. Otherwise, `null`. Flag it; never guess.
- **Claude runs on the subscription** are reported in API-equivalent dollars, which is Harbour's
  convention.
- **The judge's cost** is reported but not charged to the configuration.

### Failures

- **Infra.** The run died before its first tool call: launch, login, key cap, or a stale model
  catalogue.
  - Retry it once.
  - A second infra failure counts against the harness's reliability, not its quality.
  - Every launch failure in the bake-off was plumbing.
- **Timeout.** The task counts as unresolved.
- **False done.** The agent declared DONE, but the task is not resolved.

## 6. Reading the results

The headline table has one row per configuration and run, plus a "what shipped" row priced from
`/cost`.

| Configuration | Implementation resolved | Faults avoided | Review: caught / clean blocked | Research useful | False done | Infra | $ per resolved task | Median minutes |
|---|---|---|---|---|---|---|---|---|
| what shipped | — | — | — | — | — | — | from `/cost` | from `/cost` |
| *each configuration* | of 10 | of 3+ | of 4 / of 2 | of 4 | count | count | | |

**Three rules for reading it**

1. **The first configuration runs twice** (step 2 in section 9). The tasks its two runs disagree on
   are the bench's own noise.
2. **Compare on the same tasks.** For two configurations, count the tasks one resolved and the
   other did not.
   - On twenty tasks, only a lopsided split means much. 6–0 or 8–1 is a difference: an exact sign
     test puts both under 0.05. 4–2 is a tie.
   - The Jev routing trial used the same paired test (McNemar) on its fixtures.
3. **Ties go to the cheaper configuration**, by cost per resolved task and then by time. This is the
   north star's rule: work-shaped legs run on the cheapest tier that passes the verifier.

A bench result becomes a capability-ledger entry, not a routing change. A default moves only after
a preset trial in production behind the unchanged Opus review gate, as the bake-off ran it. The
change reverts in one line.

## 7. What it costs

**Starting small.** The bench's cash is OpenRouter spend on a dedicated key with a credit limit, so
a runaway configuration cannot overspend. The judge (Opus, through Claude Code) and any Claude
configuration run on the subscription. They spend quota from the fleet's weekly window, not cash.

| Step | What runs | OpenRouter cash | Subscription quota |
|---|---|---|---|
| 1. Plumbing proof | the cheap target on 5 tasks (3 implementation, 1 review, 1 research) | ≈ $3 | 5 judge reads |
| 2. First full run | the cheap target on all 20 tasks, twice | ≈ $15–20 | 40 judge reads |
| 3. Each later challenger | one configuration on the tracks it is a candidate for | ≈ $5–50 for an OpenRouter model; $0 for a Claude model | 20 judge reads, plus the run itself for a Claude model |

**Proposed cap:** about $30 a month of bench cash, a tenth of Harbour's current spend, enforced by
the key's limit. Claude configurations run only when the weekly window has headroom.

**Per-configuration reference.** These are estimates from medians we have already measured, for when
a step 3 configuration is chosen. Fleet legs also carry Harbour's chores (proxy reads, the PR, CI
waits), so a lean bench run should cost less; treat the figures as ceilings.

| Configuration | Implementation (10) | Review (6) | Research (4) | Total, one run |
|---|---|---|---|---|
| DeepSeek Flash on opencode | ≈ $5 | ≈ $1 | ≈ $2 | ≈ $8 |
| GLM-5.3 on opencode | ≈ $38 | ≈ $6 | ≈ $6 | ≈ $50 |
| Sonnet 5 (claude-code: quota; opencode: cash) | ≈ $45 | ≈ $11 | ≈ $10 | ≈ $66 |
| Opus 5 on claude-code (quota) | ≈ $100–190 | ≈ $28 | ≈ $26 | ≈ $155–245 |

**Where the figures come from**
- **Medians** come from `docs/reviews/model-effort-routing-proposal-2026-09-11.md`:
  - Sonnet implementation: $4.54;
  - Opus implementation: $18.72, from a small sample chosen for hardness;
  - Opus review: $4.67;
  - Opus research: $6.37.
- **Flash and GLM** are $0.45 and $3.75 a ticket, from the bake-off.
- **Sonnet's review and research** are scaled down from Opus by the 2.5× token price ratio.
- **A judge read** is about $0.50 of quota.

**Time.** About five hours of host time for a full run of one configuration, one task at a time,
because CPU contention already cost the bake-off a launch.

## 8. Where it lives, and what is public

- **Public, in this repository: the headline only.**
  - One row per run in a results table here, with section 6's columns.
  - Each row carries the date, the task-set id, the configuration (harness version, model id as
    routed, effort) and the totals, split by repository.
  - A `/bench` page can render the table later, if that is ever wanted.
- **Private, in a separate repository (proposed: `harbour-benchmarks`): everything else.**
  - The method (this document moves there once the repository exists), the runner and the
    adapters.
  - Per task set, under `task-sets/<task-set>/`: the selection and the task packets (frozen prompt
    text and hidden-test lists).
  - Per run, under `runs/<task-set>/<configuration>/`:
    - the run records and diffs;
    - the judge prompts and replies;
    - the gzipped transcripts.
  - It is private because simple-dispatcher is private, and because transcripts can carry anything
    a session printed.
- **Privacy rules.**
  - simple-dispatcher tasks appear in public only as counts.
  - Run `lib/secret-scan.js` over the headline before it lands here, and over the evidence before
    it is committed there. A bake-off implementer once quoted a planted secret in its PR body
    (LIN-2573, `docs/papers/harbour/capability-ledger.md`).
- **Contamination.**
  - A model trained after a LinearViewer task merged may have read the answer. Each row records the
    model's stated training cutoff where one is published, and flags tasks merged before it.
  - simple-dispatcher's tasks are private and never at risk, which is another reason to split
    results by repository.
- **Every row becomes a capability-ledger entry**, worded the ledger's way: what the configuration
  was seen to do, on how many tasks, and what it was never tried on.

## 9. Building it, one step at a time

1. **Plumbing proof.** One cheap target, five tasks, about $3. It needs:
   - a selection script;
   - frozen packets;
   - the box builder, with its no-future assertion;
   - a bench mode for `opencode-runner.js`;
   - the scorers;
   - the run record;
   - the headline row.

   Most of it is the replay's scripts with new inputs: `survey-replay-select`, `-prepare`, `-emit`,
   `-fences`, `-tests`, `-cost` and `-analyse`. It is done when every stage has produced its
   artifact for all five tasks, and the key's own usage figure agrees with the summed record costs.
2. **First full run.** The same target on all twenty tasks, twice. It gives the first headline row,
   and the bench's own noise.
3. **Challengers, one at a time,** cheapest first (section 10).
4. **Later, only if it earns it:**
   - **One command.** `npm run bench -- --tasks 2026-10 --config opencode:<model> --tracks impl,review`:
     idempotent per task and configuration, resumable, and budget-guarded.
     - An optional mode adds one review round (implement, fixed reviewer, fix), the lean pipeline
       the replay ran.
   - **A feature.** Settings shows each harness and model choice's bench row beside it, and a new
     harness or model version triggers a re-bench. For any workspace: pick twenty Done tasks,
     freeze them, and let your own runner bench the configurations you are weighing.
   - **An export to Harbor's task format.**
     - Harbor is Laude Institute's open-source evaluation framework; despite the name, it is not
       ours.
     - A task there is an `instruction.md`, a `task.toml`, an `environment/` Dockerfile, and a
       `tests/` script that writes a reward.
     - Harbor's pre-integrated agents (claude-code, codex, opencode, gemini-cli, goose, aider,
       openhands and more) would then cover harnesses we have no adapter for. It needs Docker, and
       it runs those agents its own way.

## 10. The first runs, and the order after

**Steps 1 and 2: production's cheap tier, on all three tracks.** Read the exact model from Settings
rather than assuming it. Since 25 September, implementation and research run on the cheap tier via
opencode, and the bake-off recommended DeepSeek Flash.

**These runs answer three questions:**
- **How does the cheap tier compare with what shipped?** "What shipped" is the free baseline row.
- **Does a cheap reviewer find what Opus finds?** That is open in `docs/papers/proposals.md`, and
  the review track's known blockers were all found by Opus reviews.
- **Should the cheap implementer be the default or only a preset?** That is LIN-2834's question,
  still Todo. The cheap tier became the implementation default on 25 September with only the
  bake-off's 13 small tickets behind it (`docs/papers/harbour/how-process-changes-land.md`).

**Then, one challenger at a time:**

| Order | Configuration | Question it answers | Cash |
|---|---|---|---|
| a | The same cheap model in a second harness: Dash (LIN-2687) once it has a bench adapter, or another open harness that takes OpenRouter | **the harness effect**, with the model held fixed, at cheap-model prices | ≈ $8 a run |
| b | A second cheap model on opencode (DeepSeek V4 Flash 0731, Gemini Flash or GLM-5.3) | the model effect inside the cheap tier | ≈ $1–50 |
| c | Sonnet 5 on claude-code | the mid tier, against the routing proposal's 84% first-pass approval | quota only |
| d | Sonnet 5 on opencode (`anthropic/claude-sonnet-5`), paired with c | the harness effect at the mid tier | ≈ $66 |

Dash suits row a well:
- It is ours.
- Its own measurement landed about 40–50% of whole tickets, against about 80–85% of pre-decomposed
  steps with explicit file paths (`docs/collective-session-2026-06-12.md`). The implementation
  track tests exactly that.

**Before each run,** commit the task-set's selection and prompts, and a one-line prediction, on
their own. Results are added afterwards, and anything decided later is marked as a deviation. This
is the archive's pre-registration convention, kept light
(`docs/papers/harbour/replay-small-work-preregistration.md`).

## 11. Decisions

**Decided, 3 October**
1. **Start on one cheap target** and expand slowly.
2. **Publish only the headline**; the evidence lives in a separate private repository.
3. **The judge is Opus, run through Claude Code**, at a fixed effort that never changes within a
   task set.
   - It shares a family with any Claude configuration and may favour it.
   - Add a second judge from another family, for disputed tasks only, if that ever matters.
4. **It runs on the normal dispatcher host.**

**Still open**
1. **The repository.** Its name (`harbour-benchmarks`?) and private visibility.
2. **The monthly cash cap.** Proposed: about $30, set as the bench key's limit.
3. **Cadence.** Proposed: a run when a candidate is worth a look, and a fresh task set each quarter,
   because older LinearViewer tasks drift toward contamination.

## Sources

**In this repository**
- `docs/papers/harbour/replay-small-work.md` and `replay-small-work-preregistration.md`: the
  replay design, the hindsight finding, and the position-bias check.
- `docs/papers/harbour/model-choice.md`: tier did not move cost per correct change; the 12 July
  model flag; the size bands.
- `docs/papers/harbour/capability-ledger.md` and `capability-ledger-method.md`: the fixed judge,
  and the rule that an absent entry routes to Opus.
- `docs/reviews/cheap-implementer-bakeoff-2026-09-13.md`,
  `docs/reviews/model-effort-routing-proposal-2026-09-11.md` and
  `docs/reviews/pre-ramp-harness-run-2026-09-14.md`: costs, failure shapes, medians.
- `docs/papers/harbour/reliability-baseline-defects.json` and
  `reliability-baseline-review-blockers.json`: seed lists for known faults and known blockers.
- `docs/north-star.md`: cost per verified task, and the cheapest tier that passes the verifier.

**External**
- [Datacurve, "Gold Solution Retrieval in SWE-Bench Pro"](https://deepswe.datacurve.ai/blog/deepswe),
  26 May 2026: git-history retrieval, and 24% false fails.
- [Claude Code, "Run Claude Code programmatically"](https://code.claude.com/docs/en/headless):
  `-p`, `--output-format json`, `--bare`, `--permission-prompts`, and SIGTERM behaviour. Flags were
  checked against `claude --help` for 2.1.288.
- [Harbor task structure](https://docs.harborframework.com/core-concepts/tasks/overview), read on
  3 October 2026.
