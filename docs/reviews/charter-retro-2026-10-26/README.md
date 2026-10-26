# Retro: charter LIN-3490, 23–26 Oct

**For John.** About ten minutes on a phone. Written 26 Oct 2026 from the record, not from the inputs. Live state was read about 09:00–09:25Z. Anything that moved after that is not reflected.

**Read these first.**
- **Process:** most findings were already known. The rules existed but fired late, stayed out of the runbook, or were contradicted at launch.
- **Product:** the code is larger, not smaller. The UI doesn't match the design, and nothing checks it against the design.
- **Decisions:** 8 rulings are open, and LIN-3952 is approved but wedged. Section 6 has the questions only you can answer.

**Labels.** *checked* = I re-read the claim against the record. *not checked* = taken from an input and not re-read. Times are record times (comment `createdAt`), not the operator's labels, which run 5–15 minutes late. Full detail is in [evidence.md](evidence.md). The inputs are verbatim in [inputs/](inputs/).

---

## 1. Findings

**Struggled**
- **Plan loops ran past the rule.** LIN-3977 got six Request Changes (20:56–21:55, 25 Oct). The split came as LIN-3986 at 21:59. LIN-3983 got five plan-review blocks (03:23–03:52, 26 Oct), then LIN-4003 at 03:59. *Checked.* Input 2 said round 2 blocked on lanes; the record says history paging and a judge guard.
- **Several PRs confused the stage engine.** Misroutes on LIN-3846, LIN-3912, LIN-3956, LIN-3969, LIN-3975 and LIN-3983. Stacked #2169 has no CI, because `test.yml` runs only on PRs into `main`. The briefs said both "more than one PR is fine" and "This is one PR". *Checked.*
- **Close-outs stalled off the code.** A deploy behind main (LIN-3956), a conflicted PR with no CI (LIN-3980), and flakes (LIN-3969, LIN-3985). *Checked.* "Commits nobody reviews" is *not checked*.

**Expanded**
- **Scope and pace grew, each step at your call.** The UI goal grew three times. Costs was added 25 Oct 10:59Z and paused 18:40Z after LIN-3937 aborted at $52 priced. Lanes went to three heavy, against `improvement-cycles.md:32`. The budget pause moved from 70% to 90%. *Checked* for the commits and tickets; the 80% and 91% meter readings are *not checked*.
- **Tickets multiplied.** 234 filed since 23 Oct: 120 Done, 5 Canceled, 3 In Progress, 106 open. 104 of the open ones have never run. Priced spend is $1,478, a floor. This repeats `tasks-generate-tasks.md:34`. *Checked* from input 6.
- **The code grew.** Production code +9,725 lines since `8e59ed62`. Decision points +2,310. Two internal measures improved: CSS duplicate blocks 35 → 29, knot pairs 11 → 9. *Checked*, with three corrections to input 1 (Next-run deleted lines, `.btn` at about 11 files, test growth).

**Wedged**
- **LIN-3952 is approved and stuck.** Conditional Approve at 05:15Z. PR #2165 is still open. Its ruling `lin3952-nojob-dispatch-audience` reads `gone`. *Checked* live.
- **Rulings piled up.** 8 are unanswered and none has been pressed. LIN-3833 had 8 rulings, not 7 as input 2 says. *Checked.*

**Overcomplicated**
- **Process text grew around the work.** A ~1.9 KB rules block on every ticket restates CLAUDE.md and the templates. Predictions on work tickets were read as inputs (LIN-3975 research 02:33; LIN-3977 plan-review 21:04). Input 4 says a review held the LIN-3952 prediction. It didn't: the 03:39 review says "+191, explained". *Checked* for the prediction claim; the rules-block claim is *not checked* rule by rule.
- **The client copies server rules.** `public/prompt-section.js` went from 1,479 to 2,302 lines. `FINISHED_STATE_TYPES` repeats `common.js`. The "web needs Claude Code" rule exists only on the client. *Checked.*
- **Docs grew as snapshots.** `ui-pieces.md` is 72.5 KB and its status figures are stale. *Checked.*

**Added rules**
- **Added:** split after two same-class plan-review blocks (LIN-3932, 03:03Z), which is not in the runbook; one ruling per question (LIN-3959); churn fixes LIN-3903 to LIN-3906.
- **Broken:** "A running ticket is not amended" (`theseus-method-long.md:320`). Items were added to LIN-3952 (00:50:31), LIN-3975 (02:49:43) and LIN-3992 (01:52:25). *Checked.*

**Tidy first**
- **Worked as moves:** byte-identical moves, each judged at 0 differences. `workspace-api.js` went from 3,782 to 882 lines; `dashboard.js` from 3,072 to 872. *Checked.*
- **Didn't reduce code:** `routes/` went from 26,955 to 28,559 lines. The Settings consolidation (LIN-3889, `ab481a49`) was copied within a day: the decision panel (`dfeabc20`) repeats `settings.css` line for line. *Checked.*

**Make it easy**
- **The pages don't look like the design.** Input 3 rates Home Large, Models Large, Settings Small, and shared state colour Large. *Checked* in code: `.row-state` has one colour (`style.css:1109`), and `.opened-task-go` is blue (`run-control.css:137`). Input 3's design judgements are *not checked*.
- **The cause is a chosen policy.** LIN-3892 says "No prototypes, screenshots or design review pages go to builders". It rests on your LIN-3757 comment of 23 Oct 20:40 that prototypes "may be over specific". The briefs came from old-page surveys. Reviews compared each build with its own ticket. *Checked.*
- **The visual judge measures regression, not design.** It compares base with head, so a page can read green and still have the wrong layout. LIN-3962 and LIN-3991 say the judge sees pages only at rest. *Checked.*

**What worked, and should be kept**
- Unwedge tickets: LIN-3986 and LIN-4003, each under an hour.
- Questions answered before launch, leading to one plan and no plan-review (LIN-3980, LIN-3986, LIN-4003, LIN-3992, LIN-3995). *Checked.*
- Byte-identical moves with a judge and a prediction.
- Light-lane fixes at 20–40 minutes each.
- The judge caught real defects where it could reach them.
- Deleting Next run (LIN-3912, −7,681 lines).
- Landing is the page closest to its design.

**Unclear in the record.** Whether you saw the briefs. Inputs 2 and 4 disagree, and the record does too. The pre-launch comments on LIN-3975 to LIN-3983 are relays, and the operator's 01:24Z comment on LIN-3952 cites "the LIN-3978 brief John reviewed". This is a question for you (§6). The charter's "Running now" text is stale; I have not used it as current.

---

## 2. Known before?

I count the research's 13-row table as **6 known, 6 partly, 1 not found**. The research headline says "eleven of twelve", which doesn't match its own table. Full table in [evidence.md](evidence.md).

- **Known, and why it failed:** the plan-loop rule, the amend-ban, the ticket-growth rule and the stale-charter rule were all written down. The plan loop waited for the 5-round bound (`improvement-cycles.md:85`). The amend-ban (`theseus-method-long.md:320`) was broken at runtime.
- **Partly known:** several PRs (LIN-3906 covers one PR in ordered commits, not sequencing); lanes (`improvement-cycles.md:32`); the judge at rest (LIN-941, Backlog since 3 Jul).
- **Not found:** predictions moved onto work tickets. I found no record of a reason.

---

## 3. Where things stand

**Code.** Main is `973d08eb`. Production code is up about 4.8% since `8e59ed62`. `public/prompt-section.js` is 2,302 lines. `routes/` is 28,559 lines. CSS duplicates are down from 35 to 29. *Checked.*

| Page | Ticket state (live) | Against its design (input 3) |
|---|---|---|
| Settings | Done | Small gap |
| Settings › Models | LIN-3952 In Progress; #2165 open, approved with conditions | Large |
| Home | Done (7 tickets) | Large |
| Task page | PR 1 merged `2ab5e675`; #2169 open, no CI; implementation since 06:52Z | No prototype |
| Run page | LIN-3976 Todo, not started | No prototype |
| Live Console | Round 1 merged 02:51Z; round 2 LIN-4002 Todo | No prototype |
| Dispatch | LIN-3978 Todo, not started | No prototype |
| Landing | Done | Closest to its design |
| Observation | PR 1 merged `d3f67854`; #2172 open, implementation since 08:25Z | No prototype |
| Swipe | LIN-3982 Todo, not started | No prototype |
| Plain: Privacy, Terms, Account | Done; LIN-3997 Backlog | Not reviewed |
| Plain batches | LIN-3970 to LIN-3973, Backlog | Not started |
| Unticketed | Swim, feedback widget, Audit fold, stylesheet review, D&I re-run | Not started |

Every state above was read live at 09:00–09:25Z.

---

## 4. How to proceed

### Before the external test next week

- **A. Finish in-flight work and change nothing else.** Steer the tester to Landing and Settings. *Trade-off:* no new work, but Home, the tester's first page, keeps its Large gap.
- **B. A, plus one small shared-CSS ticket.** Fix one primary colour (with LIN-739's contrast), state colour on rows, and a left-aligned title. *Trade-off:* one new ticket, which needs your approval. The retro files none.
- **C. Rebuild Home's opened task and the Models table from their prototypes.** *Trade-off:* closes the Large gaps but is another first pass at L size. The meter is already at 91%.

**Recommendation: B.** It fixes the shared gaps once, across Home, Models and the task page.
**Strongest case against:** the tester meets Home first, and Home's Large gap is layout, not colour. B may not change what the tester sees first.

### Open work

- **Run page, Dispatch, Swipe.** *Recommendation:* hold them until the design method changes. None has a prototype. *Case against:* they may be needed for the test.
- **LIN-3952.** Options: any-member (today's behaviour and the builder's recommendation), owner-only (the operator's pre-fill), or park. *Recommendation:* finish with any-member; it's your call. *Case against:* owner-only matches the operator's rules block, and parking leaves #2165 open.
- **The 104 never-run tickets.** *Recommendation:* one triage pass to close or park them. Don't work them. *Case against:* some may be needed for the test.

### Process

- **Builders see the design and check against it.** *Recommendation:* yes. *Case against:* you chose to withhold prototypes, and over-specific tickets ran badly before (12 Oct charter).
- **Design-review findings go into the page's own ticket**, not new tickets. *Recommendation:* yes.
- **"Split after two" goes into the runbook;** predictions stay off work tickets; the rules block shrinks to what the templates don't say. *Recommendation:* yes, all three.
- **Lanes.** The runbook says one heavy at a time; three ran. *Recommendation:* keep the runbook rule until you change it.

---

## 5. Candidate follow-ups

None is filed. I checked each against the record. Title search covered all 3,947 tickets, so "none" means no title match.

1. **Shared colour and title.** One primary colour, state colour on rows, left-aligned title. **No existing ticket.** Adjacent: LIN-739 (Landing CTA contrast, Backlog), LIN-3123 (light-theme status colours, Backlog).
2. **Move run rules from the client to the server.** **LIN-3546 covers only part**: it decomposes the `prompt-section.js` init, not the rule move. Widen it.
3. **Judge coverage of open, failed and running states.** **LIN-941 covers it** (card-state snapshots, Backlog). LIN-3996 is separate: judge tests don't run in CI.
4. **Runbook: split after two, no amendments to running tickets, predictions off work tickets.** **No existing ticket.** LIN-3651 (Done) set the loop bound; LIN-3932 is the source.
5. **One PR per ticket, or CI on stacked bases.** **No existing ticket.** LIN-3906 (Done) is the one-PR precedent; LIN-3075 and LIN-4005 (both Backlog) are adjacent.

---

## 6. Questions only you can answer

1. Which pages must the external test cover?
2. Should builders see prototypes?
3. LIN-3952: any-member, owner-only, or park?
4. Did you see the LIN-3978 brief? The record disagrees with itself.
5. Which of the 8 open rulings do you press, and which do you clear? The IDs are in [evidence.md](evidence.md).
6. Should design-review findings become new tickets?
7. Are Swim, the feedback widget, the Audit fold, the stylesheet review and the D&I re-run in or out of scope?
8. Keep three heavy lanes against `improvement-cycles.md:32`?

**Production checks from input 5 (not checked by me):** LIN-3719 backfill (dry run, then `--write`); LIN-3882's six model pins; LIN-3977's checks (Live Console as runner owner, reduced motion); Home on a phone in light and dark; Landing at 390px and the preview card; `/account` and the workspace-not-found page on Plain.
