# E — Method: what Harbour's own papers measured

Cites are `file:line`. Papers are in `wt-main/docs/papers/harbour/` (`.md` dropped); `gate` = `course/gate-2026-11-14.md`; `stab` = `wt-main/docs/reviews/stability-review-2026-11-14.md`. **SR** = rests on a self-reported or loop-prompted reading. Most gate-rule numbers are from the September loop; look-first, blind read, notes and seal are November.

## Step by step

| Step | Best evidence it helps | Measured cost | Verdict |
|---|---|---|---|
| Look-first + size record | None for ordinary tickets: blind score +0.39 vs baseline +0.38, then +0.37 vs +0.50 (cleaner-than-it-started:44); "no quality evidence" (gate:57) | 2.48 sessions, $2.88 a task; sessions 5→7 (stab:184,197) | Unproven (SR) |
| Research session | 75–78% of its units acted on (step-overlap:73-78); named 1 of 44 review faults (step-overlap:131); sent back 31% with it, 36% without (ticket-record-and-quality:47) | $48 vs $37 median ticket (same line) | Unproven |
| Plan | Two-thirds is new (step-overlap:64); fully prescribed tickets run 5.5/6/9 sessions vs 9/11/23 (how-a-task-is-composed:87-89) | More code-review send-backs on prescribed children: 47%, 71% vs 29%, 38% (:91) | Earns its place on large or open work |
| Plan-review, one round | 13 of 17 light-group fault catches (proportional-process-backtest:34,202); repeat rounds found something new in 30 of 41 (where-judgement-happens:93-94) | Sent back 33% with, 35% without, at $80 vs $31 (ticket-record-and-quality:48) | Earns one round where behaviour is open |
| Plan-review loop | Send-backs ask for one more list member, never a new design (review-loops:25-30) | 11 of 94 approved first time; loops a third of session time (review-loops:13-17) | Costs more than it gives |
| Code review, one outside reader | 44 real faults fixed in 18 of 100 tickets (which-rules-pay:29-31); all 43 in changes of 50+ lines (between-the-sessions:188-190) | Median $4.59 a round (what-the-reviews-checked:21-22); narration 45% of text, 25% read (review-consumption:16-18) | Earns its place |
| Class check, requirements check | 19 changes (12 faults); 10 (7) (which-rules-pay:188-189) | About 10 extra legs each; class check filed 28 follow-ups (:147) | Earn their place |
| Looking at the running result | On 11 of 44 faults; close-out's 3 own faults all found live (which-rules-pay:86-88,133) | 2,325 words, best ratio (:186); a miss cost $79.51 to repair (what-the-reviews-checked:65-66) | Earns its place |
| Mutation check | 107 findings, 97 tests-only, no real fault (which-rules-pay:125-131) | About 36 of 88 extra legs | Costs more than it gives; later value unmeasured |
| Close-out filing follow-ups | 12 of 54 filed tickets later changed production code (which-rules-pay:145-146) | 1.95 tickets each, 74% never worked (tasks-generate-tasks:34); 0.34 of the 0.74 ratio (root-task-ratio:49) | Costs more than it gives |
| Leftover step | After-answers on 31 tickets, "counted, not scored" (cleaner-than-it-started:64) | Feeds notes (gate:58) | Unproven |
| Tidy-after | 9 areas (15 tickets) better in both blind passes; 1 of 4 ordinary pairs (cleaner-than-it-started:46) | 47–85% of the parent's cost (:64) | Earns its place when it deletes copies (SR: prompt "partly circular", :38) |
| Blind read before merge | 20 better, 2 same, 0 worse, self-report (stab:31,69) | One session, $1.02, every task (stab:186,195) | Unproven (SR) |
| Area notes, Retires line | A third of Lessons fully held by a check already (beyond-the-code:34-35) | 13 of 110 claims false; Waiting 82→118 after Retires (gate:51-52); seven safety finds stranded (gate:25) | Costs more than it gives as prose |
| Consequence test | Minted per landing 1.37→1.12 (stab:246) | Note inflow sped up (gate:53); "neither row alone is an improvement" (stab:251) | Unproven |
| As-asked seal, cut rule | Before it, 611 of 653 tickets kept ≥95% of the request (tasks-are-tasks:138) | 15 rulings in a day, about 10 the lane could settle (every-choice-was-right-at-the-time:108); "effect not shown" (gate:56) | Cut rule costs more than it gives; seal unproven |
| Periodicals | Caught a worse area both blind passes missed (cleaner-than-it-started:50) | Found none of 107 cross-session incidents (what-hides-between-sessions:20) | Earn their place as outside readers, not as filers |
| Model supervision | A fifth of the bill is judgement (what-supervisors-do:18-19) | 77% of tokens mechanical; 31% of wakes change nothing (:20-23) | Costs more than it gives; belongs in code |

## The lightest loop the evidence supports

**(a) Small fix** (≤49 production lines, ≤3 files, no auth, data-store, prompt or CI path): build, one independent review that runs the thing, merge. That group went wrong 2.0 per 100 against 12.1 (proportional-process-backtest:140), and review caught a fault on 8 of 328 (:201). A lean replay cost 4.1% of tokens, but scored 5 better, 1 equal, 7 worse on its pre-registered rule (replay-small-work:35,63-65), so the reader stays. Lane tickets got the same quality on a quarter of the words (ticket-record-and-quality:67-75). Sort by paths touched, never ticket text: the text rule let 36 faults through (proportional-process-backtest:43-46). Prompt text and runbooks are not "docs" (:41-43).

**(b) Ordinary task**: a ticket that states the behaviour, with file pointers; build; one review (class check, requirements, running result); a close-out that merges and checks live. One plan-review round only when behaviour is open, and a person decides before a second (review-loops:30). Add a tidy-after only when the change left copies (cleaner-than-it-started:56).

**(c) Large rebuild**: look-first as a map; the person sizes the move (the-place-became-somebodys-job:39); a tidy-first where the seam is tangled (one clean case, unwedge-or-breakdown:14-19); one plan and one plan-review at the parent, since 49% of children re-planned anyway (step-overlap:199); pieces that each delete what they replace, under a count that cannot rise (56→6, the-place-became-somebodys-job:45,63); an outside read after a quiet period (stab:134-136).

## Task size

- Size is the only term that predicts sessions: ×1.31 per e-fold of lines (how-a-task-is-composed:74-76).
- Small and settled: median 6 sessions, 2% split. Large and open: 30 sessions, 40% split, 73% with two or more plan-reviews (:56-58).
- PRs of ≤400 lines were sent back 21% at $18; larger ones 44% at $59 (ticket-record-and-quality:49).
- One decision: 7 sessions, median PR 108 lines. Three or more: 10–13.5 sessions (how-a-task-is-composed:68-73).
- A floor exists: at least half a change's cost is fixed (between-the-sessions:91-92), and light work used the same dispatches as heavy work of its size (proportional-process-backtest:113-120).
- Favoured: one decision, behaviour settled, about 100–200 production lines. A tested optimum: not found.

## What makes work spiral or converge

Causes: the plan and plan-review enumeration loop (why-work-spirals:14); gates and close-outs filing 2.1 tickets per one closed, with Done work causing 1.52 more (tasks-generate-tasks:13-17; root-task-ratio:19); behaviour left open (how-a-task-is-composed:65-67); rules added six to one over removed (how-process-changes-land:21-23); moves that add an owner beside its copies (cleaner-than-it-started:56).

What cut it: deleting the thing described (steering-text:24-27); settling pieces, Waiting 120→120 over 29 landings (stab:245); the count ratchet; a ruling ending a loop (review-loops:30); no plan-review, 40–65 minutes (why-work-spirals:26, unchecked). The class rule raised repeat send-backs 43%→50% (how-process-changes-land:75-77).

## Parallel lanes

- Four lanes merged 29 PRs in a day; 48 of 353 files were shared; one visible conflict; main CI 30 of 30 green (lanes-across-the-seam:54-56,245-249). "One day, not a rate" (:376-377).
- Git and CI coordinated. One of five asks was answered; three went to a ticket nobody read (:127-131). One "agreed" was never agreed (:202-210).
- The person's load: both tidy lanes idled overnight on rulings (every-choice-was-right-at-the-time:38,108); a two-hour wait was a neighbour waiting on John (lanes-across-the-seam:119-121).
- Split by area with a named owner per side (:76); settle the one real boundary first; give every ask a fallback and deadline (:316); post on the ticket being worked; reserve shared files such as `server.js` and the control area (:240,251-254).
- The right number of lanes: not found.

## The person's seat

- 0.28 rulings per finished task; at most 72% of tasks needed no person (stab:54,58).
- In September, John made 26 of 260 consequential decisions; he took part in 15 of 28 events needing more than one layer, on wrong premises and false reports (where-judgement-happens:27,147-148).
- The wrong questions reach him: clauses, not choices; about 15 of 45 withdrawn rulings were calls the run settled itself (every-choice-was-right-at-the-time:108).
- He is needed for the size of a move, ending a loop, retiring a choice (:32), and product preference.

## Tricks that worked

- A 93-token file pointer: $0.357 against $0.783 (what-should-an-agent-leave-behind:26; one control run).
- A behaviour line on the ticket (how-a-task-is-composed:103-105).
- Ask "what does the page do with every field?" and finish the grep (what-the-reviews-checked:71-72,83-85).
- Six code rules caught 9 of 19 incidents five hours early (what-hides-between-sessions:21-26).
- Sequence in code around one model call: 3 of 20 to 19 of 20 (between-the-sessions:174-175).
- Checkers outside the session corrected about 20 of 24 papers (:216).
- Write the ledger; it is 97% read (review-consumption:16-18).
- A hand tally of 17 better was overturned by blind readers (the-place-became-somebodys-job:75).

## Where the papers disagree, and what nobody measured

- Plan-review: "probably" droppable (ticket-record-and-quality:21-22); repeat rounds earn their keep (step-overlap:138-139); it is the spiral's engine (why-work-spirals:14).
- Lean: recommended (between-the-sessions:182), yet "correct is not yet" proven (:226).
- Look-first: "Yes" (the-place-became-somebodys-job:15) against "tasks on average: not shown" (cleaner-than-it-started:38) and no convergence witnessed on code (stab:134).
- Small diffs: Harbour's gradient against an outside study finding none (what-lowers-the-verification-cost:19).
- Notes: minted fell while Waiting rose; a blind self-verdict used as a measure (gate:66).

Not measured: any single process change's effect on cost (how-process-changes-land:26-27); a forward lean trial (replay-small-work:69); who started a dispatch (stab:56); whether tidied areas go quiet (stab:113-114); unwedge against breakdown (unwedge-or-breakdown:14); whether unworked follow-ups were real debt (tasks-generate-tasks:111-113).
