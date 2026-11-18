# Walk 8 results: the revised page (no paths, no areas, `project`)

*18 Nov.*
- **Page:** `layer/design.md` as revised on 18 Nov (`563993da6`).
- **Model:** built fresh from §3–4 alone (258 lines; its test passes). I read its brief and blind code.
- **Material:**
  - Walk 7's three replays, seeds ported by `port-seeds.py`: area records dropped, area addressees changed to `project`, paths and claims removed, `of` changed to `judgement`.
  - 32 steps, each a fresh agent with walk 7's instructions changed only where the page changed.
  - Yap filled again (43 records).
- **Marks:** counts are [checked] from `tally.mjs`, `steps/*/show.txt` and `queries.json`. Stage notes are [reported]. Readings are [my reading].
- **Expectations:** `expect.md`, committed before the build (`9e0c68e1c`).

## Against the expectations

| # | Prediction | Result | Why |
|---|---|---|---|
| 1 | Only malformed writes refused, fewer than 6 | **Half** | Every refusal was malformed, but there were 23 of them by the stages' reports, against 6 in walk 7. 19 are one mistake: `about`, `on` or `answers` put beside the fields instead of under `links`. Three are a verdict sent without `on`, and one followed from those. Every agent fixed it on the next try. This build's usage notes never show `links` in a write example; walk 7's did [checked: both `BUILD-NOTES.md`]. It's about how intuitive the calls are, not the structure |
| 2 | Area writes go to `project`, nothing invented | **Held** | No stage invented a place or tried to write paths. Finds about the code beyond the task went `to: project` throughout |
| 3 | Project records get read and acted on | **Held, in every task** | 4450: leftover ended a project finding its commit settled (finding-20), and the blind read handed one into its question (finding-76). 4446: survey linked to project findings instead of restating them; leftover revised finding-4. 4469: implementation ended two project findings its PR settled (finding-36, finding-23); leftover found finding-25 by text search and ended it into a lesson. But see "The project pile" |
| 4 | Late briefs 30–50% smaller | **Split** | 4450: 13–55% smaller. 4469: 12–42% smaller. 4446: smaller to step 3, then 15–72% *larger*. Its design stage put the whole 16 KB plan in the plan record (walk 7's: a 6 KB summary), and part 2 carries the current plan in full to every later stage |
| 5 | The blind read sees no review outcome | **Failed** | Two routes, neither through verdict records. (a) The review's run was ended with a reason saying "approve-with-notes … (verdict-90)"; 4450's blind read fetched that run [checked: `get run-93 --by blind-read`]. (b) The review rewrote a finding to John saying "Review approved with notes (verdict-63)"; that finding sat in 4446's blind brief, part 7. Neither blind reader reported using it, and each verdict was its own, but the outcome was in front of them |
| 6 | Stale stays quiet | **Held** | At most 2 flags per task at any step. Each is a verdict on a head that really moved: close-out's after-approval commits, and a leftover head no review saw (4469, as the real reviewer said). 4446's first plan-review verdict went stale on the revised plan and cleared when superseded |
| 7 | Open at each end is owned; walk 7's orphan persists | **Better than predicted** | Walk 7's orphan, a check addressed to ended task-9 with no parent, didn't recur: the same finds went `to: project`. Open at the ends: project findings, checks and findings to John, hand-offs to the sibling tasks, and stale verdicts. Nothing is addressed to an ended task |
| 8 | Nothing lost with the paths | **Held** | No stage reported needing path information that a brief used to give. Every "relied on but not given" list names repository facts (diffs, line numbers, CI, commits), which the store isn't meant to hold. The stages read those from the code themselves |
| 9 | Yap fills cleanly | **Held** | 43 records, no refusals, no invented places [reported]. The bad fits are about the material, not the structure: your words weren't in it (the PR text fetch was refused), and a merge is the only sign of approval, so there are no verdicts |

## What the walk showed

1. **Removing paths cost nothing the stages missed, and it fixed walk 7's orphan.** Finds that belong to the project now have a reader, every brief shows how many are open, and stages did look them up. In walk 7, a leftover wrote a finding to `Harbour`, which no one reads. This time the same find went to `project`.
2. **Blindness can't be had by filtering kinds.** Writers retell judgements in run reasons, revised findings and accounts. Hiding verdict records, then judges' accounts, then (next) judges' runs is patching. Harbour already does the robust thing: the blind read gets no brief and is told to read nothing but the change (`lib/proxy-preamble.js:270-276`).

   **Proposal: remove `blind` from the layer.** Blindness is Harbour's business: no brief, and a route that lets that run's token read only the change it judges and its own records.
3. **The plan rides in every brief.** Part 2 carries the current plan in full, which is right for the stage working from it and dead weight for the rest. Several stages listed "the full plan text" as carried but unneeded (4450 review and blind read, 4446 blind read and others).

   **Proposal:** part 2 carries the plan in full to the actor it is addressed to, and to the others its first paragraph and `get <id>`. That's the same rule part 3 uses: what is addressed to you, in full; the rest, an index.
4. **The project pile grows.** Across the three tasks, 18 records were added `to: project` and 7 ended or handed on. Stages acted on project records when their own work settled one, which is the old leftover step's job, but nothing works the pile down otherwise.

   That's Harbour's workflow, not the store's. The store makes it countable, and the leftover step ending one project record per build is the existing equivalent. The integration design should name who owns it, and report the count per slice.
5. **The API needs a review, as you said.** The evidence from this walk:
   - **Links beside fields:** 19 of the 23 refusals. Accept them as top-level keys, or say where they go in the error and the example.
   - **Version bumps:** a readdress bumps the version, so a reviewer re-pinned a verdict it didn't need to (stale counts content changes only).
   - **Ended records:** they're left out of the brief, so an autopilot had to search for a question that had just been withdrawn.
   - **`approve` or `approve-with-notes`:** stages were unsure which to use when an approval came with notes.
   - **Plans:** a plan has no "implemented" end, so close-out couldn't place a plan that was done.

## Harness notes

- **4469, step 2:** the autopilot really ran alongside implementation. Briefed after implementation's writes, it saw a PR it hadn't seen.
- **4469, step 9:** briefed after the review's last write, as in walk 7 (`timing-note.md`).
- **Single-task replays:** these never put another task's run in the store, so part 6 (other open runs) was always empty. One stage (4469, step 6) reported a parallel session that part 6 would have shown.
- **The Yap filler:** it read `layer.mjs` and an empty `store.json`, outside its allowed set [reported].

## Reading

The revision holds. Taking paths and areas out lost nothing the stages needed, and gave the project's own finds a reader. Two changes come out of this walk, and both are removals or simplifications:
- remove `blind` from the layer and leave blindness to Harbour's routes;
- carry the plan in full only to the actor it is addressed to.

The rest is for the API review, and for the integration design to name who works the project pile down.
