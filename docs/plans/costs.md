# Costs: what the work cost, and what you paid (design note)

Status: design note, for operator approval. Docs only; the build tickets are filed after approval.
Checked at Harbour origin/main `87a766b`. Sample figures are Harbour's own workspace, read through the proxy on 25 Oct 2026.

## Why

John, 24–25 Oct: Harbour should give people "a centralised cost management centre", "a lovely, simple, tidy way for people to easily understand costs, in a way that makes optimisation both easy and safe for an average user". Token cost at list price is the primary figure, because it "stays constant irrespective of how much the subscription was used"; discounts and subscriptions are "a layer on top", kept cleanly separate and "flexible enough we can add support for all the various other discounts and subscriptions out there". Agents do the optimising (trials, judges, reverting); the page shows the evidence.

Today cost is computed in five places, each its own way, and the totals do not reconcile: "figures not matching is a smell of complexity and tangles in the underlying code". This note fixes what the page shows and what must be true underneath it. It does not choose files, functions or schemas; the build tickets' plan stages do.

## What is true now

- **Agent sessions are priced from stored tokens.** A `claude-code` session posts cumulative token counts; its cost is derived from the static rate table by `computeUsageCostUsd` (`lib/model-pricing.js:347`, LIN-1495, doc at `lib/session-telemetry.js:35-46`). `/cost` derives it when read; the observation read model stores the derived value and re-derives on a version bump (`lib/observation-sessions-store.js:66-94`).
- **A cumulative session that crosses a long-context threshold prices to null** (`lib/model-pricing.js:362-369`). Haiku 5.5 carries a 100k override, so most Haiku sessions are unpriced today (`:159-167`). In the sample's 29 days, 114 sessions sent no usage at all, and 7 Haiku sessions priced to null.
- **Harbour's own calls carry OpenRouter's billed cost** per call in the call log (`lib/llm-call-log.js`). A call's `urlKey` may be null (`:14`, `:59`), so some calls belong to no workspace and appear in no per-workspace total.
- **Five surfaces show cost or price, each computed its own way:** `/cost` per ticket (`lib/task-cost.js`, `routes/proxy-compute.js:643`); Health's "Harbour's AI calls" block, 30 days of calls only (`lib/render-settings.js:605-627`, `routes/settings.js:260`); the KPI pages' "Cost per finished task", over `[done]`-marked lineages (`lib/terminal-marked-task-cost.js`, `lib/render-kpis.js:162`); the observation feed; and the model picker's display prices (`lib/openrouter.js`).
- **They do not reconcile.** Over 30 days, Harbour's calls linked to tickets LIN-2850 onward total $153.73; John's OpenRouter bill is about $200 a month. Some of the gap is calls with no ticket or no workspace; how much is unknown.
- **Every published figure reads 30 days back; storage keeps everything** (`lib/read-horizon.js:1-21`, LIN-3157/LIN-3163). The KPI daily rollup already holds per-workspace daily counts past the horizon (`lib/kpi-daily-rollup.js`, LIN-3724, backfilled by LIN-3731, indexed by LIN-3811). The public KPI page's oldest rolled-up day is 1 Sep 2026.
- **Every issue provider reports when a ticket was completed** (`completedAt` in `lib/providers/{linear,github,github-projects,jira,local}/index.js`).
- **Charts have a shared helper**: `HarbourCharts.draw`, `sparkline`, `numbersTable` and a rate/total toggle (`public/chart-helpers.js`, LIN-3710). Settings pages are built from shared rows (LIN-3846, LIN-3890).

## The page

A new Settings area, **Costs**, in the Workspace group after Models. Purpose line: "What the work cost at list price, what you actually paid, and why." It replaces Health's AI-calls block; Health keeps a one-line link here.

The prototype (sample data from 26 Sep–24 Oct) is in `docs/plans/costs/`. It is the reference for layout, copy and charts, and is not production code. Top to bottom, each section answers one question:

1. **Headline: what did this period cost?** One sentence ("17–24 Oct: 238 tasks finished. At list price the work cost $2,029. You paid $93: 5% of list, or $0.39 a finished task."), then two bars, token cost against what you paid, then two trend chips.
2. **Worth a look: is there anything to do?** At most two items. The first is always the biggest lever: the largest share of token cost on a job not changed recently, with a link to Models.
3. **What you got: what did each finished task cost?** Three tiles (tasks finished, token cost per task, paid per task), each with a small this-period-against-last bar. Then **Day by day**: cost per finished task as a dot per day and a 7-day line, and tasks finished as columns beneath on the same days. A band marks the period; a dashed line marks each model change; a Token cost / What you paid switch.
4. **Where it goes: what is it spent on?** A part-to-whole bar by kind of work (Judge, Plan, Make, Steer, Sort, Harbour calls), token cost by day stacked by kind (with the same switch), and the top jobs with model, runs, typical run and cost.
5. **What changed: did our changes help?** Each model change from the change log, with cost per run before and since.
6. **How you pay: how does list price become what I paid?** The ways you pay, in order, beside a waterfall from token cost to what you paid. The itemised receipt sits behind "Show the receipt".
7. **More detail**, folded: cost per finished task as a histogram; Not counted; For agents (`GET /api/proxy/costs`).

Phone: the same order in one column.

## Decisions

### 1. Two numbers, never blended

**Token cost** is what the work would cost at list price. **What you paid** is token cost after the ways you pay. Every figure on the page is one or the other and says which. Changing how you pay never changes a token-cost figure.

### 2. Finished task

A **finished task** is a ticket that reached a completed state, counted on the UTC day of the provider's `completedAt`. Per-task figures divide a period's cost by the tickets finished in it, so work on tickets still open counts and a quiet day looks dear. The 7-day figure divides 7 days' cost by 7 days' tickets (a ratio of sums), never a mean of daily ratios. Rework measures come later and are out of scope.

### 3. Pricing

- Sessions are priced from their stored tokens by one price function, when read. Correcting a rate re-prices history.
- Harbour calls use OpenRouter's billed cost.
- Anything that cannot be priced is listed under **Not counted** with a count, and left out of every figure, never counted as zero.

### 4. One read model, every reader

One read model produces a workspace's costs by day: token cost by kind of work, job, harness and model; Harbour calls; tickets finished; and the not-counted list. The page, `GET /api/proxy/costs`, Health's link line and any later reader use it, so their numbers agree by construction. Calls with no workspace are reported at the instance level, so the instance total reconciles with the bill.

### 5. History

Costs keep daily records past the 30-day read horizon, like the KPI rollup (extend it or sit beside it; the build decides). The page shows 90 days by default. Days before the oldest record show as a gap with a caption ("No data before 1 Sep 2026"), never as zeros, and labels follow the rollup's wording (rollup note, decisions 7–8). Today's figures are provisional. For Harbour's own workspace, an operator backfill writes every day since records began; it runs as a dry run by default.

### 6. How you pay

How you pay is an ordered list belonging to the workspace and edited by its owner. Each entry is a row of data, never a branch in code:

| Kind | What it does | What it costs |
|---|---|---|
| Subscription | Covers its traffic in full | Its price × the period's days ÷ the month's days × the share counted |
| Allowance | Covers its traffic up to an amount a month | Usually nothing |
| Discount | Takes a percentage off its traffic | Nothing |
| Pay as you go | Always last: whatever is left, at list price | What is left |

Entries apply top to bottom, each to what the ones above left. "Its traffic" is matched on what ran and where: harness, route and model family. Code never names a provider. Known plans (Claude Max 20x, Max 5x, Pro, ChatGPT Plus, the Claude API credit) are a catalogue of data rows; a custom row is always possible. A plan used outside Harbour counts only Harbour's share. Harbour does not measure a plan's limits and draws no window or limit calibration.

### 7. Charts and copy

- Every chart has a plain sentence above it that answers its question, and "Show the numbers" below.
- Two measures get two charts on the same days, never two y-axes.
- Colours follow the entity: the four kinds of work keep fixed colours; token cost is neutral; what you paid is the brand colour.
- Charts use the shared helper. A new form (paired bars, waterfall, part-to-whole) joins the helper, not the page.
- Copy follows the prototype: plain words, no jargon, every number with its unit and period.

### 8. Worth a look

At most two items, read from the same model. Each item only links; nothing on this page changes a model. Phase 2 adds offers ("included, not used", such as an allowance nothing draws on) and what-ifs ("the same calls on another model family"), computed with the same pay rules on the same traffic.

### 9. What changed

Each model-routing change log entry appears with cost per run for that job before and since, and the number of runs behind each figure. Below a minimum number of runs it says "too few to call yet".

### 10. Agents

`GET /api/proxy/costs` returns the read model for a period: token cost, what you paid, the receipt, by day, kind of work, job and model, the changes, and not counted. Agents can change how you pay through the proxy, with a reason, behind a workspace opt-in like `modelRoutingProxyWrites`; each change lands in the Change log.

## Proof

Each part closes on a run that watched it, not on reading the code.

- **Plumbing:** for 30 whole UTC days, Harbour's instance-wide OpenRouter call total matches OpenRouter's own figure within 2%, with the remaining gap named. OpenRouter's activity API needs a management key; confirm the key and field names when building. Every session in the window is either priced or listed as not counted; none is silently zero. The page and `GET /api/proxy/costs` return identical figures for the same period.
- **Page:** end-to-end on a seeded workspace: the headline, tiles and charts match the seed; adding, reordering or removing a way of paying changes what you paid and never changes token cost; a workspace with nothing set up shows list price throughout; a workspace with no history shows the empty state.
- **History:** the backfilled days for Harbour match a direct recount of the stored rows for three sample days.

## Phases

- **Phase 0, plumbing.** Decisions 2–5 and the read half of 10: one price function at read; cumulative over-threshold sessions resolved (see Open questions); calls with no ticket or no workspace counted; the read model; daily history and Harbour's backfill; `GET /api/proxy/costs`; reconciliation with OpenRouter.
- **Phase 1, the page.** The Costs area as above, with subscriptions and pay as you go only; Worth a look with the biggest-lever item only; What changed with cost per run; agent writes to how you pay; Health's AI-calls block replaced by a link.
- **Phase 2, optimising.** Allowances, discounts and the plan catalogue; offers and what-ifs in Worth a look.

## Not in scope

Window or limit calibration for subscriptions; trials, judges and reverting (agents do these); rework and second-round measures; per-person costs; currencies other than US dollars; changing what the public `/kpis` page counts.

## Open questions

- **Label clash.** `/kpis` already says "Cost per finished task" for `[done]`-marked lineages. This page counts tickets set Done. Recommendation: keep the label here with its definition one click away, and file a small follow-up to move `/kpis` to tickets so both agree.
- **Cumulative sessions over a long-context threshold.** Price at the base rate and show "at least", or keep them in Not counted? Recommendation: price at base and flag "at least", because one model's sessions disappearing from every figure distorts comparisons.
- **The period.** The prototype compares 8 days with the 8 before. Recommendation: this month so far against the same days last month by default, because plans and allowances reset monthly, with last 7 and last 30 days as options.
- **Tickets with no Harbour work.** 19 of the 238 tickets finished in the sample had no priced session. Count them (simple, as decided) or only tickets Harbour worked on?
- **Estimating sessions that never reported usage** (114 in the sample's 29 days) is a Paper, not this build.
