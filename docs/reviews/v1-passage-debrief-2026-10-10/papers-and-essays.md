# B: The Passage's papers and essays (LIN-3099)

Read from `origin/main` at `ce3c4ee8` (10 Oct) and from LIN-3099. A bare name means `docs/papers/harbour/<name>.md`.

## 1. Start and count

**The Passage started on 26 Sep 2026.** LIN-3099 was created at 2026-09-26T18:49:49Z, and its title says "(ratified 2026-09-26, 60 tasks)".

**How I counted.** Every `.md` added under `docs/papers/harbour/` since then (not `-sources/`, `-scripts/` or `figures/`), classed by its front-matter `kind:`. Data, check and notes files count with their paper.

**Result: 34 papers and essays (29 papers, 5 essays).**
- Plus 17 checks, 1 pre-registration and 1 unlabelled audit (`fleet-complexity-read`).
- That makes 53 documents and about 260,000 words (`wc -w`), 46 of them from 29 Sep–1 Oct.

**The debrief's claim holds.** Better: "Thirty-four papers and essays (29 research papers, 5 essays) were added along the way, most independently checked: 53 documents in all."

## 2. Groups

**(a) The treasure hunt, 29 Sep–1 Oct: 26 papers and 2 essays.**

The Passage paused at about 20:00Z on 29 Sep and resumed at 06:07Z on 1 Oct; the FC handover calls this "the steady-base research (the "treasure hunt")". The spark was `fleet-complexity-read`, commissioned by John on 29 Sep.

- **Papers:** steady-base, growth-atlas, reliability-baseline, where-the-effort-goes, measuring-throughput, what-supervisors-do, test-estate, why-throughput-halved, which-rules-pay, model-choice, browser-flakes, proportional-process-backtest, what-doubled-the-dispatches, wake-inventory, why-legs-repeat, held-or-fresh, where-judgement-happens, starting-context, step-overlap, cost-mix, how-process-changes-land, prototype-concepts, replay-small-work, what-hides-between-sessions, steady-base-menu, prompt-kinds.
- **Essays:** paid-where-written, between-the-sessions.
- **Checks:** steady-base-check, survey-check 1–13.
- **Cost:** the papers took "10.0% of September's weighted tokens" (`steady-base-menu` §6).

Key findings:
- Process outgrew product, and supervision was a third of the cost, mostly mechanical (claims i and iii).
- Dispatches per correct change went from 7.6 to 20.0 at 12 July, "Mostly wakes" (`what-doubled-the-dispatches`).
- 35% of September's wakes were relays up the chain, and 97% of those changed nothing (`wake-inventory`).
- 92 of 107 incidents were invisible to any single session (`what-hides-between-sessions`).
- The whole menu of fixes is worth ×1.57–2.38 (`steady-base-menu`).

**(b) The turn, 3–7 Oct.**

- *Harbour Should Fix Things Like a Skilled Developer*: essay, 3 Oct.
- *Persistent Mind, Ephemeral Hands*: essay, 4 Oct.
- `one-job-many-paths`: paper, 7 Oct, by GitHub Copilot.

Key findings:
- The stages logged 231 observations outside their ticket's frame. 46% were "noted and left", and "The underlying cause was fixed in 10 of the 37 tickets" (`like-a-skilled-developer`).
- That essay is the turn's design: LIN-3326 calls itself "the close-out part of "Harbour Should Fix Things Like a Skilled Developer"".
- On 4 Oct, LIN-3300 deleted the path where a model wrote prompts: "236 lines added, 1,248 removed" (`one-job-many-paths` §4).
- People reject 39% of plans but only 3% of permission requests (`persistent-mind-ephemeral-hands`).

**(c) 8 Oct.**

- `coherence-as-it-grows`: versions 1 to 3 in one day, plus its check.
- *The Second Copy*: essay.
- `what-the-selector-needs`: not yet checked.

Key findings, from `coherence-as-it-grows` unless noted:
- Duplicated text fell from 2.5% to 1.2%, but one timestamp parse spread from 1 file to 18.
- 86 of 190 escapes (45%) and 143 of 397 send-backs (36%) trace to a decision held in several places that went out of step. The send-back share rose from 22% (July) to 47% (October).
- The 15% of PRs touching such a decision are 5× the size and sent back 2.5× as often.
- 72% of the rows set aside to conclude "quality held" are coherence faults.
- In the selector, four fixes score 82 of 90 against 39 of 90 on main, while trimming the prompt "fixes none" (`what-the-selector-needs`).

**(d) Also in the window.**
- All seven maintenance-leg periodical reports are on main (`docs/reviews/*-2026-09-26.md`), which answers the retro's "I didn't confirm that all seven periodicals landed".
- The public Harbour Library (LIN-3342, 8 Oct).

## 3. Claims

**(i) Holds, with qualifiers.**
- `growth-atlas.md`: "Product code grew 2.9× across both repos and Harbour's endpoints 2.2×. Test lines grew 10.6×, text pins 12.2× and comment lines 7.1×."
- The base is 1 June. Process series range from 4.6× to 12.2×. From a 6 July base, pins and product are "2.5× and 1.7×".
- "Three times faster" appears in no document. It is my arithmetic: 10.6 ÷ 2.9 ≈ 3.7.

**(ii) The numbers are right; the cause is wrong.**
- `measuring-throughput.md`: "against 95 a week in the weeks from 8 to 29 June", and 47 since mid-July.
- `why-throughput-halved.md`: "Most of the fall is fewer merged tickets (113 a week in June, 65 later)", and "The tier switch is the only candidate dated to the step itself."
- Wakes explain the rise in dispatches per change, not the fall (`what-doubled-the-dispatches.md`).

**(iii) Holds.**
- `where-the-effort-goes.md`: "the layers that supervise a ticket took 35% of the fleet's weighted Claude tokens".
- It rose from 28% to 45% in September; "the whole rise is the passage Runner and its legs".
- `what-supervisors-do.md`: "About three-quarters of September's supervision tokens went to steps whose action was fully determined by observable state". A blind recode puts it at 86%. Both are token shares, not money.

**(iv) Overstated.**
- `which-rules-pay.md`: "Eight of the 24 distinct rules have led a finding that changed production code."
- Over "the last 100 Done tickets that went through code review (completed 11 to 29 September)", and covers review and close-out rules.
- The paper adds: "Zero here does not mean a rule is worthless." Drop "ever".

**(v) The argument of `paid-where-written.md`.**
- A fix in code is paid once; one written into a prompt or rule is paid on every run, so answering incidents with prose ratchets upward.
- The bill is behaviour, not tokens: rule text is "about 3%" of what a worker carries, and "The rules cost through what they make agents do."
- The remedy is a steady base: rigour where it has earned its keep, lean elsewhere, held by budgets and by retiring rules that stop firing.

**(vi) Not supported.**
- No paper measures close-out after the turn.
- The only figure is prompt size, in LIN-3326's commit `893c15d5`: "Rendered close-out 18752 -> 10859 bytes", a 42% cut.
- Say: "close-out's rules were cut by about 40%".

**(vii) Undercounted.**
- On 8 Oct (UTC), 29 PRs merged (26 LinearViewer, two of them papers; 3 Simple Dispatcher), covering 27 tickets.
- 21 of those were set Done that day (Linear `completedAt`), 18 on London time.
- Say: "about 20".

## 4. Essays

Five; *Learning While the Tools Change* (21 Sep) predates the window.

1. **Every Fix Is Paid Where It Is Written** (30 Sep). Its argument is in (v). Striking line: "Two hours of concentration go where the risk is. The fleet spends evenly across everything, and more of it each month."
2. **The Cost Lives Between the Sessions** (1 Oct). Cost and failure gather in hand-offs no single agent sees, so code should hold the sequence while models keep the judgement. Striking line: "A system made of many careful agents does not fail where any one of them is looking."
3. **Harbour Should Fix Things Like a Skilled Developer** (3 Oct). Stages measure scope against their own ticket, so they file the causes they find instead of fixing them. The fix is a developer's authority, with the rules kept separate from the brief. Striking line: "Sent through the normal pipeline, this change would come back as a set of careful line-level substitutions, the storm squeezed into the cup."
4. **Persistent Mind, Ephemeral Hands** (4 Oct). An agent can persist as records, while authority is granted from outside it for one finite task at a time. Striking line: "Delegation may preserve or reduce authority. It may never create authority."
5. **The Second Copy** (8 Oct). A decision kept in several places is paid for when it changes. What holds is one place to change it, with deletion counted as part of being done. Striking line: "The adjustment that made quality hold had removed, by construction, the rows where the hypothesis lives."

## 5. What the brain surgery revealed

1. **The Passage measured its own overhead.** The rise in supervision is "the passage Runner and its legs" (`where-the-effort-goes`), and "For the passage Runner that is 94% of its wakes" changing nothing (`what-supervisors-do`).
2. **Harbour's mind lives in its records.** 0 of 48 sampled decisions needed memory alone (`held-or-fresh`). A fresh session holding the record "could have made the same call 82% of the time" (`where-judgement-happens`).
3. **Its own rules hid its failures.** On the instruction to retry 401 errors: "Applied in every session, it is what kept LIN-3181's 203 rejections quiet for 10 hours." (`what-hides-between-sessions`)
4. **Workers did not get the rules Harbour wrote.**
   - Model-written prompts "nearly always" dropped review's regression step (`prompt-kinds`).
   - That step survives in "about 1% of written reviews" (`survey-check-13`).
   - The meta-prompt was then deleted (`the-second-copy`).
5. **Repeated gates mostly add nothing.** "A repeated close-out changed nothing in 20 of 20" (`why-legs-repeat`).
6. **The research drifted the way the process did.**
   - About 20 of 24 checks corrected a load-bearing claim (`prototype-concepts`).
   - `coherence-as-it-grows` then qualified "quality held".
