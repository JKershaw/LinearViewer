# Model and effort routing proposal — 2026-09-11

A recommended default model and effort level for each dispatch kind on the `claude-code`
harness. Written from two sources: Harbour's own dispatch telemetry for the last 30 days
(read over the workspace proxy on 2026-09-11) and the published Anthropic and third-party
guidance on effort levels and model choice. This is a proposal, not a change. Nothing in the
Settings dispatch defaults or SD's `workspaces.json` has been altered.

## The short version

| Kind | Model | Effort | Change from today | Confidence |
|---|---|---|---|---|
| autopilot (orchestrator) | Opus 5 | high | none | high |
| research | Opus 5 | **medium** | effort down | medium |
| plan | Sonnet 5 | high | none (already Sonnet in practice) | high |
| plan-review | Opus 5 | high | none | high |
| implementation | Sonnet 5 | high | none | high |
| implementation, multi-ticket lane | Sonnet 5 | **xhigh** | effort up, per-dispatch only | medium |
| bug | Opus 5 | high | none | medium |
| review | Opus 5 | **medium** | effort down | medium |
| close-out | Opus 5 | **medium** | effort down | medium |
| triage | Sonnet 5 | **medium** | model and effort down | medium |
| breakdown | Opus 5 | high | none | medium |
| design, spike, scoping, custom, periodical | Opus 5 | high | none | low (rare kinds) |

Three things to know before reading the justification.

1. **Every run in the last 30 days ran at the same effort.** The `effort` field only started
   being stamped on 2026-09-04, and every stamped value is `high`. Unstamped runs before that
   carried no `--effort` flag, and Claude Code's documented default is `high`. So the data can
   say a lot about Opus versus Sonnet, and nothing at all about effort levels. Every effort
   recommendation below rests on published guidance, not on our results.
2. **The current configuration is not quite "Opus everywhere except implementation and
   triage".** In the data, `plan` runs on Sonnet 5 five times out of six (127 Sonnet runs, 27
   Opus), and `triage` runs on Opus (5 runs). The presets that carry plan and implement legs on
   Sonnet are doing the routing. The table above treats what is actually running as the
   baseline.
3. **Effort down is the whole saving.** Model choice is already roughly right. The three
   effort reductions (research, review, close-out) touch about a third of worker spend, and
   published measurements put `high` to `medium` at roughly 25 to 45 percent less token spend
   per task on routine work. That is on the order of 10 to 15 percent of total worker spend,
   if the published curves hold here. They may not, which is why the plan ends with a sweep.

## What our data says

Population: 1,068 worker sessions across 155 issues, dispatched between 2026-08-24 and
2026-09-11, with $6,687 of API-equivalent priced cost. Sessions are joined to their issue via
the `/cost` endpoint and to their outcome via the per-issue dispatch list and issue comments,
using Harbour's own `computeIssueRoundTrips` walk from `lib/plan-review-round-trips.js`, so
the survival numbers below are the same instrument the `/effort-readout` page uses.

### Where the money goes

| Kind | Sessions | Share of spend | Median cost | Median minutes |
|---|---:|---:|---:|---:|
| autopilot (Opus) | 113 | 23.8% | $9.27 | 140 |
| implementation (Sonnet) | 172 | 19.1% | $4.54 | 19 |
| implementation (Opus) | 12 | 4.1% | $18.72 | 57 |
| review (Opus) | 188 | 14.0% | $4.67 | 11 |
| close-out (Opus) | 156 | 11.2% | $4.17 | 10 |
| research (Opus) | 78 | 8.8% | $6.37 | 14 |
| plan-review (Opus) | 118 | 8.1% | $4.45 | 10 |
| plan (Opus) | 27 | 3.9% | $9.48 | 21 |
| plan (Sonnet) | 127 | 3.8% | $1.74 | 7 |
| custom (Opus) | 6 | 1.7% | $22.31 | 64 |
| breakdown (Opus) | 9 | 0.4% | $2.80 | 8 |
| triage (Opus) | 5 | 0.2% | $1.99 | 5 |
| design, spike, bug, scoping, blocked | 13 | 0.9% | $2.50 to $6.70 | 6 to 20 |

### Did the cheaper model hold up at the next gate?

First-pass survival is "the gate after this kind returned Approve on the first attempt".

| Kind | Producing model | Issues measured | First-pass approval |
|---|---|---:|---:|
| implementation → review | Sonnet 5 | 115 | 84% (97 of 115) |
| implementation → review | Opus 5 | 9 | 56% (5 of 9) |
| plan → plan-review | Sonnet 5 | 43 | 12% (5 of 43) |
| plan → plan-review | Opus 5 | 13 | 15% (2 of 13) |

Two readings.

- **Sonnet implementation is not producing worse code by the review gate's own verdict.** 84
  percent first-pass approval on a large sample, at a quarter of Opus's median cost. The Opus
  implementation sample is too small to rank against it, and those nine were probably chosen
  for hardness, but there is no signal that pulling implementation up to Opus would buy
  anything.
- **The plan gate rejects nearly everything on the first pass regardless of model.** Twelve
  percent versus fifteen percent is the same number at these sample sizes. That is the
  plan-review template doing its job (it is designed to send a plan back once), not a model
  difference. Sonnet plans cost $1.74 against Opus's $9.48 for the same gate outcome, so
  keeping plan on Sonnet is the clear call.

### Failure rates

Terminal `[failed]` markers are rare on every kind and model: 1 of 172 Sonnet implementations,
0 of 27 Opus plans, 1 of 118 plan-reviews, 1 of 188 reviews. Failures cluster on rows with no
session telemetry at all (launch or environment failures), not on model choice. Nothing here
argues for a stronger model anywhere.

### One anomaly worth a five-minute check

In the week since effort started being stamped, sessions launched with an explicit
`--effort high` cost 10 to 25 percent more at the median than same-kind sessions launched
with no flag in the same window (review $5.19 vs $4.67 over 38 and 27 sessions, close-out
$4.63 vs $3.63, plan-review $5.06 vs $4.26). Samples are small and the two groups may differ
in what they were asked to do, so this is not a finding. But it is cheap to rule out the
alternative, which is that the host's Claude Code default is not actually `high`. Run
`/effort` in an interactive session on the host and read what it reports.

## What the published evidence says

Sources are listed at the end. The claims that carry weight for this table:

- **Defaults and levels.** Claude Code's effort levels are `low`, `medium`, `high`, `xhigh`,
  `max`; the default is `high` on every current model. The scale is calibrated per model, so
  `medium` on Sonnet 5 and `medium` on Opus 5 are not the same amount of thinking.
- **Anthropic's own workload curves.** Research and knowledge work are nearly flat: `medium`
  matched the default's accuracy at 70 to 85 percent of the cost, and `low` gave up one to
  three points for a third to a half off. Long-horizon coding is a real trade-off: Opus 5 gave
  up about two points at `medium` for half the cost and about eight points at `low` for a
  quarter of it. Deep reasoning-ceiling work bought about 2.4 rubric points per effort step.
- **Opus 5 specifically.** Anthropic's prompting guide says to "use low and medium liberally
  as your primary control" and that code-review accuracy holds at lower effort settings.
- **Sonnet 5 specifically.** It "respects effort levels strictly"; at `low` there is a stated
  risk of under-thinking. `xhigh` is recommended for the hardest coding and agentic tasks.
- **When `xhigh` earns its cost.** Anthropic positions it for long-running agentic and coding
  tasks, over about 30 minutes, with token budgets in the millions, and says to expect
  meaningfully higher token usage than `high`.
- **`max`.** Anthropic's own wording: on most workloads it adds significant cost for
  relatively small gains and can overthink. Not recommended as a default anywhere.
- **Third-party measurement.** One controlled run in Claude Code (XDA, 2026-08-08) found
  `high` to `medium` cut output tokens by 45 percent across bug-fix, feature, refactor, test
  and debugging tasks with no observed quality loss. Anecdotal reports put the `low` to `max`
  spread at 10x or more in tokens.
- **Model routing.** Anthropic's model matrix places Opus 5 on multi-hour autonomous coding
  and large refactors, Sonnet 5 on everyday coding, Haiku 4.5 on sub-agent and high-volume
  work, and says tuning effort is often a better lever than switching models. Fable 5.1 is the
  escalation when Opus 5 at `xhigh` or `max` still falls short, at twice the price.
- **Prices.** Opus 5 $5 in / $25 out per million tokens; Sonnet 5 $2 / $10; Haiku 4.5 $1 / $5;
  Fable 5.1 $10 / $50. Sonnet is 2.5x cheaper than Opus per token, which matches the 4x to 5x
  per-session gap we measure once Sonnet's shorter runs are counted.

## Justification, row by row

**autopilot: Opus 5, high.** The orchestrator holds fleet context for two hours at a time and
makes the dispatch decisions everything else depends on. Anthropic's guidance for
long-horizon agentic work is `high` or `xhigh` with the full task up front. The August
capacity review already named "orchestrator to Sonnet" as a lever gated on evals, and that is
the right way to attempt it, as a measured trial, not as a config default. Leave it.

**research: Opus 5, medium.** Research is the workload where Anthropic's curves are flattest,
with `medium` matching the default at 70 to 85 percent of cost. Our research runs are 14
minutes and $6.37 at the median, and research is the one kind with no downstream gate to
measure it against, so this is the safest place to take the first effort step down. Stay on
Opus: the staleness check and the surface-assessment verdict are judgement calls that the
plan then depends on.

**plan: Sonnet 5, high.** Already the practice, and the gate data says it is fine. Keep `high`
rather than `medium` because Sonnet respects effort strictly and the plan is where
under-thinking would be most expensive downstream.

**plan-review: Opus 5, high.** A judgement gate that stops bad plans before implementation
spends on them. It is 8 percent of spend at $4.45 a run. Anthropic's "review accuracy holds
at lower effort" claim is about code review; plan review is closer to design review and the
cost of a false approve is a whole implementation run. Keep it, and treat it as the second
sweep candidate after code review if that one holds.

**implementation: Sonnet 5, high.** 84 percent first-pass review approval over 115 issues at
$4.54 median. No evidence that Opus does better, strong evidence that it costs four times as
much. For an ordinary single-ticket implementation, `high` is Anthropic's recommended balance.

**implementation as a multi-ticket lane: Sonnet 5, xhigh, set on the dispatch.** Worker lanes
like the LIN-2737 run carry ten tickets in one session and run 50 minutes and up. That is
exactly the shape Anthropic describes for `xhigh`. Rather than raising the kind default, set
`effort: "xhigh"` on the lane dispatch itself, which the dispatch API already accepts.

**bug: Opus 5, high.** Two runs in the window, so no data. Debugging is the task class where
third-party reports say effort matters most, and the bug template's class check is a
judgement step. Keep the stronger model until there is a reason not to.

**review: Opus 5, medium.** The largest cheap win. Anthropic states directly that Opus 5
code-review accuracy holds at lower effort, and review is 14 percent of spend across 188 runs.
The review template's mutation-check and ledger duties are procedural and well specified, which
is the kind of work that tolerates less deliberation. Stay on Opus: the gate's value is
judgement, and Sonnet at `high` would be a model change and an effort change at once, which
the sweep plan below deliberately avoids.

**close-out: Opus 5, medium.** Close-out consumes a ledger the reviewer already wrote and
executes a checklist: discharge each item with cited evidence, merge, set Done, post the
summary, file follow-ups. It is 11 percent of spend at 10 minutes a run. The irreversible
writes argue for keeping Opus; the well-specified shape argues for `medium`. The three floors
(missing ledger blocks, green CI never discharges, risky claims need cited evidence) are
template rules, not reasoning feats.

**triage: Sonnet 5, medium.** Five-minute, $2 runs that classify and route. Anthropic's
guidance for classification is that it does well at low effort, and Sonnet's stated
under-thinking risk at `low` is why this says `medium` rather than `low`. Negligible spend
either way; this row is about matching the tool to the job.

**breakdown: Opus 5, high.** Nine runs, $2.80 each. Decomposing a parent into children is a
planning act whose mistakes multiply. Too cheap to be worth tuning.

**design, spike, scoping, custom, periodical: Opus 5, high.** Rare, long, judgement-heavy
(a periodical review runs an hour and costs $22). Leave at the default.

**Not recommended anywhere as a default:** `max` (Anthropic's own overthinking warning),
`low` (no kind here is both short and intelligence-insensitive enough, and Sonnet under-thinks
there), Haiku 4.5 (no effort control, and nothing here is a pure classification sub-agent),
Fable 5.1 (twice the price, and no gate in the data is failing for lack of capability).

## How to apply it

All of this fits the existing Settings dispatch defaults, which take a model, harness and
effort per kind via `byKind`. The per-kind rows would be:

```
research        claude-opus-5    medium
plan            claude-sonnet-5  high
plan-review     claude-opus-5    high
implementation  claude-sonnet-5  high
bug             claude-opus-5    high
review          claude-opus-5    medium
close-out       claude-opus-5    medium
triage          claude-sonnet-5  medium
```

with the top-level default left at `claude-opus-5` / `high` to cover every other kind. The
lane `xhigh` goes on the individual dispatch, not in defaults. SD needs no change: it already
resolves `effort` on the same chain as `model` and passes `--effort` on every `claude-code`
launch and resume.

## Do not apply it all at once

The reason this document leans on published curves is that we have no effort data of our
own. The fix is to generate some, one kind at a time, using the instrument that already
exists. The `/workspace/:urlKey/effort-readout` page joins effort, cost, duration and
first-pass gate survival per kind, and since 2026-09-04 the effort column is populated.

1. **Week 1: review to `medium`.** Highest spend of the three, best-supported by Anthropic's
   own statement, and its outcome is measurable: first-pass approval of the implementations it
   reviews should not move, and the number of `[failed]` or re-review rounds should not rise.
   Compare against the 84 percent baseline above.
2. **Week 2: research to `medium`, close-out to `medium`.** Research has no gate, so watch
   plan first-pass approval for the plans that follow it (baseline 12 to 15 percent, expect no
   change). Close-out has a hard floor in the template; watch for ledger items marked
   discharged without cited evidence in the close-out comments.
3. **Then decide about plan-review**, using the review result as the prior.
4. **Do not touch autopilot effort in this pass.** If the orchestrator tier is to be
   cheapened, the August capacity review's route (a scheduler plus small-context calls, or
   Sonnet gated on evals) is the one to take.

Two rules for the sweep, from Anthropic's own cost-optimisation guidance: change one kind at a
time so the readout can attribute the movement, and judge by cost per completed task rather
than per session, since a cheaper run that needs a second round is not cheaper.

## Sources

Anthropic documentation and posts:

- Effort parameter: https://platform.claude.com/docs/en/build-with-claude/effort
- Claude Code model configuration and effort: https://code.claude.com/docs/en/model-config
- Choosing a model: https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- Prompting Claude Opus 5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5
- Prompting Claude Sonnet 5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5
- Prompting Claude Fable 5.1: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
- Pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Claude Opus 5 announcement: https://www.anthropic.com/news/claude-opus-5
- Claude Sonnet 5 announcement: https://www.anthropic.com/news/claude-sonnet-5
- Claude Fable 5.1 announcement: https://www.anthropic.com/claude-fable-and-mythos-5-1
- The per-workload effort curves (research flat, long-horizon coding a real trade-off,
  reasoning-ceiling work linear) and the re-run-failures-at-higher-effort result are from
  Anthropic's cost-optimisation guidance as bundled in the Claude API skill's
  `shared/cost-optimization.md`, section 2.6 and 2.7.

Third-party:

- XDA, high to medium in Claude Code, 45 percent fewer output tokens: https://www.xda-developers.com/changed-one-setting-in-claude-code-token-burn-dropped/
- Opus 4.7 effort levels in practice (Maio): https://anthonymaio.substack.com/p/opus-47-the-five-effort-levels-in
- Sonnet 5 vs Opus 5 real-world comparison (dev.to): https://dev.to/tonyspiro/claude-sonnet-5-vs-opus-5-a-real-world-comparison-2026-1o67

In-repo:

- docs/reviews/capacity-test-run-review-2026-08-14.md (Opus vs Sonnet spend breakdown, lever #3 model tiering)
- docs/reviews/capacity-levers-map-2026-08-15.md
- lib/plan-review-round-trips.js and lib/effort-readout.js (the survival instrument used above)

Data handling: the 30-day telemetry was read over the workspace proxy on 2026-09-11 via
`GET /api/proxy/issues/{id}/cost` for LIN-2300 through LIN-2760, then
`GET /api/proxy/dispatch?issueIdentifier=` and `GET /api/proxy/issues/{id}` for the 155
issues with worker sessions. No writes were made.
