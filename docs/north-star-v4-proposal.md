# North star v4: proposal and diff against v3

**Status: applied.** John accepted this draft on 13 November 2026 ("I like it, much nicer. Please apply it.") and asked for it to be applied; `docs/north-star.md` now carries the v4 text below with a provenance line. This file is the record of the diff against v3 and of the sentence of John's behind each change.

**Provenance.** Drafted 13 November 2026 by a Claude session (Claude Code on the web) in conversation with John Kershaw, as D17 decided ("The north star is updated early, the way v3 was made… It takes the lasting parts: the goal, the measures in order, leaving things better, and using what exists"; session wording, John: "Agreed!", 9 Nov). John asked for it to be done with subagents: "I agree on the north star being next. Likely wants a few specific subagents to research, survey, and propose, likely with discussion from me?" (13 Nov). One subagent built a bank of John's verbatim words since v3; one surveyed where the north star is read in code and tests; one drafted; a fresh-context reader ran the second read; the session revised twice with John. The record of that work is `docs/plans/survey/` (`discussion.md` D1, D17; `log.md`, 13 Nov; `gate-2026-11-13.md`).

**What it takes, and what it leaves out.** Per D17, only the lasting parts: the goal (toward settled), leaving things better, and using what exists, plus one principle John set on 13 Nov (Harbour is often one contributor among several). The plan-for-now stays out: the outside Jira team, the stretches and lanes, the weekly figure, models per stage, and what is in flight. D1's five measures were drafted in and then cut, because John read that level of detail as "in the weeds", not at a north star's specificity; they stay in D1 and the Stability Review.

**Length.** v3 is 3,944 characters; v4 is 5,230. The binding limit is 8,000 (the Roadmap box's cap, which a test enforces). As with v3, the test is accurate without being too specific.

## The mechanics this draft was written under (LIN-2926)

1. Every new or changed clause cites a sentence of John's (table below); where the wording is the session's and John approved it, the table says so and cites his reply.
2. The change ships as a diff against v3 (below). v3 clauses John's later words don't touch are kept word for word.
3. A fresh-context second read asked: **which clause has no sentence of John's behind it?** **Result:** it confirmed the drafter's three flags (a new title label, glosses on the measures, "old copies" in the finish clause) and found one more ("prefer the simpler of two ways", cited as approved but never shown to John). It also found overstatements: cost's "for now" dropped, the tipping point stated as fact, "many" turned into "rarely", a remark about the current window made permanent, and plan-for-now ("real work and real tidies both run") creeping in. All were fixed before John read the draft: v3's title kept, D1's own words restored ("measured, not optimised, for now"), the tipping point as John said it on 4 Nov, "many" kept, the unsupported phrases dropped, the false-escalation KPI restored.
4. **Waiting period: none.** John asked for it to be applied on acceptance.
5. The applied document carries: drafted with a Claude session (13 November 2026), accepted by John (13 November 2026), diff in this file.

## v4, as applied

    # North star — v4, the self-funding loop, one step at a time

    *(a waypoint: drafted with agents, accepted only by the human, versioned, provenance recorded — this document is the normative layer)*

    **Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, brings codebases toward settled, its own included, funds itself doing it — and proves every word.**

    **Settled is a balance, not smallness.** Harbour's goal is simple code, and healthy growth is fine. Harbour converges work, even if slowly, and resists spiralling out into more work unless that work is tidying. The tipping point is a task that, on average, leaves its code a little better; bigger improvements not tied to a task can come from work like the Periodicals.

    **The measures, in this order when they clash:** no new mess (ordinary work reads neutral or better); the curve (net growth, with what it deletes beside it); speed; the person's seat (questions that were really theirs, and runs that needed no operator); cost per finished task.

    **Verified beats claimed.** Work counts only when its evidence chain closes: CI green, merged, ledger discharged. done is a claim; the artifact is the fact.

    **Harbour is often one contributor among several.** Many real projects aren't changed only through Harbour; when a person chooses to act, Harbour rides along.

    **Cost per verified task, visible in the money actually spent — measured, not optimised, for now.** Every session attributes its spend to the lane that billed it; cash the operator feels is the headline, API-equivalent keeps it honest. Every cycle forecasts the next and scores the last against actuals. A weekly budget helps frame priority. Spend a little more now, save forever: a simpler codebase is cheaper because there is less to do. Pricing is policy, never judgement: no agent reasons about price; defaults are config, a cheaper, better model in the same family can simply become the default, reverted in one line. Frontier price buys judgement only: work-shaped legs run on the cheapest tier that passes the verifier; judgement legs may run on the frontier. The subscription is a lane, not a ceiling: the exchange rate at which the API lane costs less than the plan is a published number.

    **Operator minutes and sessions are the scarce resources.** Silent failures and detection gaps outrank feature work — a halt the system didn't report costs more than the halt. Follow-on tasks and wakes per verified task are tracked taxes; work that shrinks them ranks high. No autonomous run starts without a declared task budget, enforced at the seam — a run that cannot finish inside its bound hands back; it does not sprawl. False-escalation rate is a headline KPI: every surface that asks a human is judged by how often the answer was "why was I asked this?".

    **Gates buy evidence, never delay.** Every phase gate is a measured artifact, not a declared intention — and not a calendar habit: shorten a gate by densifying evidence, never by waiving it. Time to any milestone is a policy choice and cost is a scope choice; neither excuses the other.

    **Leave it better than you found it; finish transitions before starting capabilities.** A move needn't tidy everything, but it leaves its area better and names what it retires. A substrate 90% migrated is a liability, not progress. The longest blocked chain and the oldest open compat lane are standing priorities.

    **Use what exists.** Reach for what Harbour already has before building a new system or layer. A fix that seems more complex than necessary is a reason to look again.

    **Meet a developer at the saved prompt, and make the next step safe before it is visible.** People come to trust agents in steps: they ask and copy; they drive a session by hand; they save the prompts that work; they hand over one task; they ratify a run of several; they feed tasks into a standing loop. Each step is gated by trust and budget. Harbour meets them at the saved prompt, where the grounded next prompt is the whole product: log in, connect a tracker and a repo, click a task, copy, go. Every feature names the step it serves; a person sees their step and the next one; handing over the first task means one task, one bounded run, and a human click before merge. Login → connected → first evidence-verified merge, without talking to the operator, is that step's bar. Secure defaults assume hostile input; payments land only behind the hardening gate; the free tier is a published, ring-fenced line item. The measure is people per step and where they stop.

    **Every claim reachable from its evidence; every contract legible in one screen.** Reports cite dispatches, KPIs cite outcomes, relaxations name their adversarial follow-up. Complexity that breaks legibility is a defect even when locally justified.

    *Provenance: v4 drafted with a Claude session on 13 November 2026 from a planning conversation with John Kershaw, under the authorship rule adopted on LIN-2926; accepted by John Kershaw on 13 November 2026; the diff against v3 and the sentence of his behind each change are in `docs/north-star-v4-proposal.md`.*

## Diff against v3

```diff
@@ -1 +1 @@
-# North star — v3, the self-funding loop, one step at a time
+# North star — v4, the self-funding loop, one step at a time
@@ -5 +5,5 @@
-**Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, funds itself doing it — and proves every word.**
+**Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, brings codebases toward settled, its own included, funds itself doing it — and proves every word.**
+
+**Settled is a balance, not smallness.** Harbour's goal is simple code, and healthy growth is fine. Harbour converges work, even if slowly, and resists spiralling out into more work unless that work is tidying. The tipping point is a task that, on average, leaves its code a little better; bigger improvements not tied to a task can come from work like the Periodicals.
+
+**The measures, in this order when they clash:** no new mess (ordinary work reads neutral or better); the curve (net growth, with what it deletes beside it); speed; the person's seat (questions that were really theirs, and runs that needed no operator); cost per finished task.
@@ -9 +13,3 @@
-**Cost per verified task, visible and falling — in the money actually spent.** Every session attributes its spend to the lane that billed it; cash the operator feels is the headline, API-equivalent keeps it honest. Every cycle forecasts the next and scores the last against actuals. Routing, plan-review, and re-grounding economy are judged by this number alone — and pricing is policy, never judgement: no agent reasons about price; defaults are config, changed only behind an eval, reverted in one line. Frontier price buys judgement only: work-shaped legs run on the cheapest tier that passes the verifier; judgement legs may run on the frontier. The subscription is a lane, not a ceiling: the exchange rate at which the API lane costs less than the plan is a published number.
+**Harbour is often one contributor among several.** Many real projects aren't changed only through Harbour; when a person chooses to act, Harbour rides along.
+
+**Cost per verified task, visible in the money actually spent — measured, not optimised, for now.** Every session attributes its spend to the lane that billed it; cash the operator feels is the headline, API-equivalent keeps it honest. Every cycle forecasts the next and scores the last against actuals. A weekly budget helps frame priority. Spend a little more now, save forever: a simpler codebase is cheaper because there is less to do. Pricing is policy, never judgement: no agent reasons about price; defaults are config, a cheaper, better model in the same family can simply become the default, reverted in one line. Frontier price buys judgement only: work-shaped legs run on the cheapest tier that passes the verifier; judgement legs may run on the frontier. The subscription is a lane, not a ceiling: the exchange rate at which the API lane costs less than the plan is a published number.
@@ -15 +21,3 @@
-**Finish transitions before starting capabilities.** A substrate 90% migrated is a liability, not progress. The longest blocked chain and the oldest open compat lane are standing priorities.
+**Leave it better than you found it; finish transitions before starting capabilities.** A move needn't tidy everything, but it leaves its area better and names what it retires. A substrate 90% migrated is a liability, not progress. The longest blocked chain and the oldest open compat lane are standing priorities.
+
+**Use what exists.** Reach for what Harbour already has before building a new system or layer. A fix that seems more complex than necessary is a reason to look again.
@@ -21 +29 @@
-*Provenance: v3 drafted with a Claude session on 19 September 2026 from a planning conversation with John Kershaw, under the authorship rule adopted on LIN-2926; accepted by John Kershaw on 19 September 2026; the diff against v2 and the sentence of his behind each change are in `docs/north-star-v3-proposal.md`.*
+*Provenance: v4 drafted with a Claude session on 13 November 2026 from a planning conversation with John Kershaw, under the authorship rule adopted on LIN-2926; accepted by John Kershaw on 13 November 2026; the diff against v3 and the sentence of his behind each change are in `docs/north-star-v4-proposal.md`.*
```

## Provenance, clause by clause

Dates are 2026. Quotes are verbatim as the record keeps them (`docs/plans/survey/`: `discussion.md` D-items, `log.md` dated entries; `docs/papers/harbour/tasks-are-tasks.md` for 2 Nov). **Approved** means the words are the session's and John agreed to them with the reply cited.

| Change | Sentence of John's behind it |
|---|---|
| **Opening sentence**, added: "brings codebases toward settled, its own included" | "allowing us to finally leverage Harbour to bring codebases towards settled. Including our own" (2 Nov, in LIN-4149). D1's goal: "Agreed, perfect" (8 Nov). |
| **New:** "Settled is a balance, not smallness." | **Approved.** D1's wording: "Agreed, perfect" (8 Nov). |
| "Harbour's goal is simple code, and healthy growth is fine." | "Harbour's goal is to be simple code … let's not swing far in the other way." (8 Nov). "If we're adding, healthy growth is fine too." (10 Nov). |
| "Harbour converges work, even if slowly, and resists spiralling out into more work unless that work is tidying." | "Harbour should converge work, even if slowly, and resist spiralling out and generating more work (unless it's tidying up)." (round 1, quoted in the A1 ask John approved word for word, 10 Nov). |
| "The tipping point is a task that, on average, leaves its code a little better; bigger improvements not tied to a task can come from work like the Periodicals." | "when a task truly does (on average) leave the codebase in a better place once finished, even a little, we're in a really strong place." and "Even if we rely on things like periodicals when we want to improve not tied to a ticket." (4 Nov). |
| **New:** "Harbour is often one contributor among several. Many real projects aren't changed only through Harbour; when a person chooses to act, Harbour rides along." | "Yeah, if I choose to do something, Harbour is a passenger. This reflects that for many real projects, they're unlikely to be exclusively changed via Harbour." (13 Nov). The softer wording is the session's, after John's "these do read a little strong"; **approved**: "I like it, much nicer." (13 Nov). |
| **Cost head:** "visible and falling" becomes "visible … measured, not optimised, for now" | D1's "Cost per finished task: measured, not optimised, for now" ("Agreed, perfect", 8 Nov). "happy for pricing to go up (it used to be upwards of $30 or even $100 per task)… The pricing limit need not become a red herring." (13 Nov). On keeping "for now": "yes fine" (13 Nov). |
| **Cost, removed:** "Routing, plan-review, and re-grounding economy are judged by this number alone" | D1 puts cost fifth of five measures ("Agreed, perfect", 8 Nov). On the removal: "fine" (13 Nov). |
| **Cost, added:** "A weekly budget helps frame priority." | "We have our weekly limit, which is a fine somewhat informal limit. And that helps frame prioritisation." (13 Nov). |
| **Cost, added:** "Spend a little more now, save forever: a simpler codebase is cheaper because there is less to do." | "A simpler, tidier codebase is simply cheaper by virtue of there being less to do... Spend a little more now, save forever." (2 Nov, in LIN-4149). |
| **Cost:** "changed only behind an eval" becomes "a cheaper, better model in the same family can simply become the default" | "if we find a cheaper better model from the same family, we've yet to have a problem just switching. We can always revert. Happy to just change the defaults rather than adding a new layer." (9 Nov). The revert half is v3's. |
| **Finish clause head**, added: "Leave it better than you found it;" | "We don't need to tidy it all, but it's a perfect example where we can leave it better than we found it." (9 Nov). D17 names "leaving things better" as lasting ("Agreed!"). |
| "A move needn't tidy everything, but it leaves its area better and names what it retires." | The 9 Nov sentence above. "names what it retires" is D8's, **approved**: "Yes, and keeps it simple" (9 Nov). |
| **New:** "Use what exists. Reach for what Harbour already has before building a new system or layer." | "We want to avoid building out some big complex system, and this could simply use rulings?" and "Happy to just change the defaults rather than adding a new layer." (9 Nov). D17 names "using what exists" as lasting ("Agreed!"). |
| "A fix that seems more complex than necessary is a reason to look again." | "It feels like a complex way to solve an issue that either resolves itself, or is masking a bug? Ha! I'm literally thinking 'this seems more complex than necessary'." (13 Nov). |

**Kept word for word:** the title, the italic waypoint line, "Verified beats claimed", the rest of the cost clause, the operator clause (including the false-escalation KPI), "Gates buy evidence, never delay", "A substrate 90% migrated…" and the standing priorities, the step clause, and the legibility clause.

**Considered and left out:** the five measures (John: "in the weeds"); "mixed readings are fine" (likewise); "agents don't worry about price" as its own words (John: "these do read a little strong"; v3's "no agent reasons about price" covers it); the plan-for-now (D17).

## What applying it touches

- **The Roadmap box.** No prompt reads `docs/north-star.md`; the Roadmap prompts read the text pasted for each workspace, and `lib/north-star-resolver.js` only hashes this file to flag a pasted copy that has drifted. **v4 is live for a workspace once it is pasted into its Roadmap north-star box.**
- `docs/roadmap-north-star-input.md` still called the v1 text the canonical copy to paste; its header now points at `docs/north-star.md`.
- `lib/library-metadata.js`: the library date for `north-star.md` moves to 2026-11-13.
- Not touched, because v4 keeps their words: the landing copy (it quotes "human intent in command"), `docs/v1.md` (it quotes the step's bar), and the library summary fixture (the italic line is unchanged).
