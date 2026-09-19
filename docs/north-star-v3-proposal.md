# North star v3: proposal and diff against v2

**Status: a proposal. This file is not the north star.** `docs/north-star.md` stays at v2 until John applies this diff himself, in a PR he merges, and pastes the result into the Roadmap page's north-star input so the LIN-2254 doc-hash stamp matches. Nothing here edits the normative document.

**Provenance.** Drafted 19 September 2026 by a Claude session (Claude Code on the web, interactive proxy session, read then readWrite; no dispatch lineage) in conversation with John Kershaw, the same session that wrote `docs/ladder.md`. It folds the LIN-2694 proposal (Archive #5, "The Cheap Ships") where a sentence of John's supports it, and replaces the v2 stranger clause with the rung rule the ladder implies. The header note follows the authorship rule John adopted on LIN-2926 (19 Sep 2026, all five mechanics).

**Size.** v2 is 385 words, v3 is 602. About 245 words are new or changed, roughly 40% of v3; the step clause is the largest block. The drafting rule set a one-third bound; this is 7 points over it. The flagged row in the provenance table is the place to cut if John wants it under.

## The mechanics this draft was written under (LIN-2926)

1. Every new or changed clause cites a sentence of John's from the conversation that produced it (table below). A clause with none is flagged, not hidden.
2. The change ships as a diff against v2 (below), not as a fresh document.
3. A fresh-context second read asks one question: **which clause has no sentence of John's behind it?** The expected answer is the one row flagged below; anything else the reader finds is a defect in this draft.
4. A waiting period before it takes effect; John names the days.
5. When applied, the document carries: drafted by (this session), accepted by (John, date), diff against (v2).

## Proposed v3, in full

    # North star — v3, the self-funding loop, one step at a time

    *(a waypoint: drafted with agents, accepted only by the human, versioned, provenance recorded — this document is the normative layer)*

    **Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, funds itself doing it — and proves every word.**

    **Verified beats claimed.** Work counts only when its evidence chain closes: CI green, merged, ledger discharged. done is a claim; the artifact is the fact.

    **Cost per verified task, visible and falling — in the money actually spent.** Every session attributes its spend to the lane that billed it; cash the operator feels is the headline, API-equivalent keeps it honest. Every cycle forecasts the next and scores the last against actuals. Routing, plan-review, and re-grounding economy are judged by this number alone — and pricing is policy, never judgement: no agent reasons about price; defaults are config, changed only behind an eval, reverted in one line. Frontier price buys judgement only: work-shaped legs run on the cheapest tier that passes the verifier; plan-review, review, close-out and rulings may run on the frontier. The subscription is a lane, not a ceiling: the exchange rate at which the API lane costs less than the plan is a published number.

    **Operator minutes and sessions are the scarce resources.** Silent failures and detection gaps outrank feature work — a halt the system didn't report costs more than the halt. Follow-on tasks and wakes per verified task are tracked taxes; work that shrinks them ranks high. No autonomous run starts without a declared task budget, enforced at the seam — a run that cannot finish inside its bound hands back; it does not sprawl. False-escalation rate is a headline KPI: every surface that asks a human is judged by how often the answer was "why was I asked this?".

    **Gates buy evidence, never delay.** Every phase gate is a measured artifact, not a declared intention — and not a calendar habit: shorten a gate by densifying evidence, never by waiving it. Time to any milestone is a policy choice and cost is a scope choice; neither excuses the other.

    **Finish transitions before starting capabilities.** A substrate 90% migrated is a liability, not progress. The longest blocked chain and the oldest open compat lane are standing priorities.

    **Meet a developer at the saved prompt, and make the next step safe before it is visible.** People come to trust agents in steps: they ask and copy; they drive a session by hand; they save the prompts that work; they hand over one task; they ratify a run of several; they feed tasks into a standing loop. Each step is gated by trust and budget. Harbour meets them at the saved prompt, where the grounded next prompt is the whole product: log in, connect a tracker and a repo, click a task, copy, go. Every feature names the step it serves; a person sees their step and the next one; handing over the first task means one task, one bounded run, and a human click before merge. Login → connected → first evidence-verified merge, without talking to the operator, is that step's bar. Secure defaults assume hostile input; payments land only behind the hardening gate; the free tier is a published, ring-fenced line item. The measure is people per step and where they stop.

    **Every claim reachable from its evidence; every contract legible in one screen.** Reports cite dispatches, KPIs cite outcomes, relaxations name their adversarial follow-up. Complexity that breaks legibility is a defect even when locally justified.

## Diff against v2

```diff
--- docs/north-star.md	2026-09-18 20:21:09.368648665 +0000
+++ /tmp/claude-0/-home-user/b26aec7c-ba1b-5cc0-abc0-a8f1a6bad478/scratchpad/v3.md	2026-09-19 08:57:32.724317412 +0000
@@ -1,19 +1,19 @@
-# North star — v2, the self-funding loop
+# North star — v3, the self-funding loop, one step at a time
 
-*(a waypoint: revised by the human only, versioned, and never edited by any agent — this document is the normative layer)*
+*(a waypoint: drafted with agents, accepted only by the human, versioned, provenance recorded — this document is the normative layer)*
 
-**Harbour completes verified backlog work at a cost and cadence a solo operator can sustain, funds itself doing it — and proves every word.**
+**Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, funds itself doing it — and proves every word.**
 
 **Verified beats claimed.** Work counts only when its evidence chain closes: CI green, merged, ledger discharged. done is a claim; the artifact is the fact.
 
-**Cost per verified task, visible and falling — in the money actually spent.** Every session attributes its spend to the lane that billed it; cash the operator feels is the headline, API-equivalent keeps it honest. Every cycle forecasts the next and scores the last against actuals. Routing, plan-review, and re-grounding economy are judged by this number alone — and pricing is policy, never judgement: no agent reasons about price; defaults are config, changed only behind an eval, reverted in one line.
+**Cost per verified task, visible and falling — in the money actually spent.** Every session attributes its spend to the lane that billed it; cash the operator feels is the headline, API-equivalent keeps it honest. Every cycle forecasts the next and scores the last against actuals. Routing, plan-review, and re-grounding economy are judged by this number alone — and pricing is policy, never judgement: no agent reasons about price; defaults are config, changed only behind an eval, reverted in one line. Frontier price buys judgement only: work-shaped legs run on the cheapest tier that passes the verifier; plan-review, review, close-out and rulings may run on the frontier. The subscription is a lane, not a ceiling: the exchange rate at which the API lane costs less than the plan is a published number.
 
-**Operator minutes and sessions are the scarce resources.** Silent failures and detection gaps outrank feature work — a halt the system didn't report costs more than the halt. Follow-on tasks and wakes per verified task are tracked taxes; work that shrinks them ranks high. No autonomous run starts without a declared task budget, enforced at the seam — a run that cannot finish inside its bound hands back; it does not sprawl.
+**Operator minutes and sessions are the scarce resources.** Silent failures and detection gaps outrank feature work — a halt the system didn't report costs more than the halt. Follow-on tasks and wakes per verified task are tracked taxes; work that shrinks them ranks high. No autonomous run starts without a declared task budget, enforced at the seam — a run that cannot finish inside its bound hands back; it does not sprawl. False-escalation rate is a headline KPI: every surface that asks a human is judged by how often the answer was "why was I asked this?".
 
 **Gates buy evidence, never delay.** Every phase gate is a measured artifact, not a declared intention — and not a calendar habit: shorten a gate by densifying evidence, never by waiving it. Time to any milestone is a policy choice and cost is a scope choice; neither excuses the other.
 
 **Finish transitions before starting capabilities.** A substrate 90% migrated is a liability, not progress. The longest blocked chain and the oldest open compat lane are standing priorities.
 
-**A stranger can trust it in one sitting — and the free tier is a published line item.** Login → connected → first evidence-verified merge, without talking to the operator. Secure defaults assume hostile input; payments land only behind the hardening gate; what the free tier costs is ring-fenced and visible from day one.
+**Meet a developer at the saved prompt, and make the next step safe before it is visible.** People come to trust agents in steps: they ask and copy; they drive a session by hand; they save the prompts that work; they hand over one task; they ratify a run of several; they feed tasks into a standing loop. Each step is gated by trust and budget. Harbour meets them at the saved prompt, where the grounded next prompt is the whole product: log in, connect a tracker and a repo, click a task, copy, go. Every feature names the step it serves; a person sees their step and the next one; handing over the first task means one task, one bounded run, and a human click before merge. Login → connected → first evidence-verified merge, without talking to the operator, is that step's bar. Secure defaults assume hostile input; payments land only behind the hardening gate; the free tier is a published, ring-fenced line item. The measure is people per step and where they stop.
 
 **Every claim reachable from its evidence; every contract legible in one screen.** Reports cite dispatches, KPIs cite outcomes, relaxations name their adversarial follow-up. Complexity that breaks legibility is a defect even when locally justified.
```

## Provenance, clause by clause

All quotes are John's, 19 September 2026, from the planning conversation that produced this draft. Punctuation is normalised from speech-to-text; words are his.

| Change | Sentence of John's behind it |
|---|---|
| Title and opening sentence: "keeps human intent in command of AI execution: it meets a developer where they are" | *"Harbour exists to keep human intent in charge of AI agents, right, so we have to factor in humans."* |
| Cost clause, added: frontier price buys judgement only; the subscription is a lane, not a ceiling; the exchange rate is a published number | *"we're not at the point where we can just throw a hundred dollars [at] cheap models and assume we can get, say, a hundred tasks over the line, but that will be an amazing place to get to"* and *"we get cheap models that we can run in parallel, which means this becomes very, very doable."* Source proposal: LIN-2694 items 1 and 3, filed at John's request to fold Archive #5 into the run. |
| Operator clause, added: false-escalation rate is a headline KPI | *"it's got four rulings, none of which are actually relevant, so it's somewhat not yet met that bar, which makes it something where I pay attention to it."* Source proposal: LIN-2694 item 5. |
| Step clause: the ladder of steps, and the saved prompt as Harbour's first job | *"First people will ask Claude a question, copy the answer, carry on with the day. Next people open Claude Code and essentially walk through their work, meandering left and right … this is where they learn to trust Claude. Then people start bundling up tasks … they save their prompts … this is where the majority of developers today are."* And: *"Harbour's first parlour trick is essentially giving them those prompts. They log in, they get their prompt, off they go. That is the core of Harbour."* And: *"a user just logs in with an email address, adds a git repo with a couple of clicks, and then sees all of their tasks, potentially in Jira, and then can just click a task, get the next prompt, copy-paste it into Claude and off they go."* |
| Step clause: "each step is gated by trust and budget"; "the measure is people per step and where they stop" | *"we have to factor in how people will actually use it and how far along they'll go, and that's based on trust and budget and other factors like that."* |
| Step clause: "make the next step safe before it is visible"; "every feature names the step it serves; a person sees their step and the next one; handing over the first task means one task, one bounded run, and a human click before merge" | **No independent sentence of John's.** These are the agent's proposals from the ladder table, which John agreed to (*"Fantastic, we're on the same page"*; *"I love it, yes"*). Flagged for the second read. Keeping, striking or rewording them is John's call. |
| Step clause: the hand-over bar, secure defaults, hardening gate, free tier | Carried over from v2's stranger clause, unchanged in substance. The v2 head sentence "A stranger can trust it in one sitting" is replaced, not dropped: its content is the bar for handing over the first task. |
| Header note | Per the rule adopted on LIN-2926. John's words there: *"it's still my intent … even though the risk is that it brings in some bias that the model brings in a way that I don't necessarily notice."* |

**Not folded from LIN-2694.** Item 2 (context is handed, not searched) and item 4 (verification scales with output, so it must be mechanical): no sentence of John's in the source conversation. They stay open on LIN-2694 for a separate ruling. One phrase of item 3 was dropped on purpose, "the fleet is sized to the work, not to the week's window", because it contradicts John's stated practice: *"I'm using my subscription quite often for just personal use, so it's already up to like 50% this week."*

**Biases the second read should look for**, named in advance: over-structuring (the numbered ladder is the obvious candidate), a pull toward the measurable ("the measure is people per rung"), and recency (this conversation over long-held intent; the unchanged v2 clauses are the check).

## Revisions

- 19 Sep 2026, second draft: after John's review, the step clause defines the steps in place and drops rung numbers so the document stands without `docs/ladder.md`; the claim that most developers are at the saved prompt was removed as empirical, not normative. Title follows.

## How to apply

1. LIN-2926 is ruled: adopted. The header note stands.
2. Rule on the flagged row above: keep, strike or reword.
3. Apply the diff to `docs/north-star.md` in a PR John merges. The version stamp in the title moves to v3.
4. Paste the new text into the Roadmap page's north-star input so `GET /api/proxy/north-star` reports `docVersion.drift: false` against the doc at HEAD.
5. Then plan the saved-prompt passage: the planner's Step-1 read will quote v3, and the chain under LIN-614 is now inside its stack read.
