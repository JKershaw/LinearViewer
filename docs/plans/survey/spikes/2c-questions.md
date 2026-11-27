# Spike 2c: questions overtaken by events

27 Nov. Read-only. Code at main `5c33e4415`. Live reads saved in the scratchpad, `questions/`.
Marks: **shown** (with a citation) or **unknown**. Times are UTC.

## The answer in brief

- 14 questions exist in all, 19 to 25 Nov. None has been asked since 25 Nov 05:19 [shown: `records?kind=question`].
- 7 were settled somewhere else before their record ended. Only one of those 7 cost real time: 2fea4d20, about 2.2 h of one held lane.
- 4 of the 7 came from the switch-over: the answer came through the old ruling path and nobody ended the record. That path is gone now.
- No question that was really John's call was overtaken. Scope, stop or go, and gate rules got answers in 0.2 to 0.9 h, and his words often changed the plan.
- Events can settle a fact or an engineering call. They can't settle a preference. So an overtaken question is a sign it wasn't John's to answer.
- **Is it an issue?** Small and cheap at this volume. Linking questions to their subject or adding a doorbell treats the symptom. The fault is earlier: the asker blocked on a question when it already had a default it would accept.

## The questions

"Held" means what waited on it. "Settled first by" means what decided it before the record ended.

| id | asker (ticket) | asks | open h | end | held | settled first by |
|---|---|---|---|---|---|---|
| aaf40304 | review (LIN-4463) | a pass figure for "reads better" | 86.6 | answered | nothing (lane paused) | no; John rejected the premise |
| fbdb0930 | implementation (LIN-4504) | how to set the fleet pause | 1.7 | answered, ended by close-out | the run, about 9 min | the operator set the pause at 19:17 |
| dec1b780 | breakdown (slice 3) | re-review after close-out's commits? | 59.9 | dismissed | P8, about 6 h overnight | an answer on 21 Nov 07:01 (decision-8161ced3) |
| a9961da7 | breakdown (slice 3) | import the verdicts once? | 59.9 | dismissed | P4/P5, about 6.6 h | an answer on 21 Nov 07:32 (decision-f1f78039) |
| 6a487149 | review (LIN-4531) | move the census to LIN-4529? | 7.7 | answered, ended by close-out | LIN-4531 overnight | John's comment, about 07:48 |
| c2af1113 | implementation (LIN-4532) | the chat answer path | 1.1 | dismissed | nothing | the autopilot, 11:59, as an engineering call |
| 829a69b1 | blocked (LIN-4463) | restart the lane; how big? | 0.2 | answered, not the recommended option | LIN-4463, 4342, 4343 | no |
| d7c086e8 | autopilot (LIN-4416) | approve the shortlist? | 0.2 | answered: change it | the whole build | no |
| 6c882b7c | autopilot (LIN-4416) | one more plan round? | 0.9 | answered | the build | no |
| 4ac79968 | autopilot (LIN-4416) | ship, or one more round? | 0.5 | answered | the merge | no |
| 0bbfc433 | autopilot (LIN-4549) | pin review again, or change the rule? | 0.7 | answered, with a new rule | LIN-4546 pieces 2-7 | no |
| d2640e4b | research (LIN-4342) | commit the backlog copy, or seed? | 6.7 | answered: its own default | nothing | the asker's default, which went ahead |
| e7563442 | autopilot (LIN-4559) | do or drop 3 clean-ups? | 0.1 | withdrawn by the asker | nothing | the asker: "Engineering call, not a person's" |
| 2fea4d20 | autopilot (LIN-4508) | redeploy c48d188? | 3.1 | answered: wait | LIN-4560, 4561 | the d22e7fa deploy, about 06:15 |

Sources [shown]: each record's versions and `ended`; the decisions; log.md at 23 Nov 12:40 and 13:20, 24 Nov 07:15 to 13:37, and 25 Nov 05:28 and 06:28.
fbdb0930's 19:17 pause: log.md, "20 Nov, 19:17". c2af1113: the LIN-4532 comment of 23 Nov 11:59.
Askers by stage: autopilot 6, review 2, implementation 2, breakdown 2, research 1, blocked 1.
Ends: answered 10, dismissed 3, withdrawn by the asker 1.

## 1. What it cost

- **2fea4d20, the one with a real cost.** LIN-4561 was held 05:19 to 08:25. For 2.2 h of that, the question was already overtaken.
  - John's answer chose "wait for the next merge". That is what the asker had said it would do if nobody answered.
  - LIN-4561's own merge deployed main at 14:31 (LV #2537) [shown: LIN-4561 comments]. So holding it bought nothing. Did LIN-4561 need c48d188 live? Unknown; its done-when doesn't say so.
  - No wrong work and one answer from John. The autopilot had no runs between 05:17 and 08:25 [shown: spike 4 §3].
- **dec1b780, a9961da7.** Breakdown carried on once the 21 Nov answers came, at about 6 h. The records sat open for 53 more hours with nothing waiting on them. They cost 2 dismiss clicks.
  - Both were booked as false escalations, though both were answered [shown: `lib/records/question-facts.js:9-12`].
- **c2af1113.** Open 51 min after the autopilot settled it. It cost one dismissal, also booked as a false escalation.
- **d2640e4b.** John saw the card for 6.7 h and confirmed the default. Nothing waited on it.
- **fbdb0930, 6a487149.** The record stayed open 1.5 h and 0.5 h after the real answer. Nothing was lost.
- **The rest, for comparison.** 5 of the 6 were answered in 0.2 to 0.9 h while John was at his desk. In 3 of those 5, his words changed direction (829a69b1, d7c086e8, 0bbfc433). Those questions earned their cost.
  - The sixth, aaf40304, was a rule that shouldn't have existed. John: "a judgement, not a measurement" (decision-7ceddf62).

## 2. The shape: why questions get overtaken

- **(A) Answered through the old path; record never ended. 4 cases:** fbdb0930, dec1b780, a9961da7, 6a487149. All came before records-only answering went live (23 Nov 12:36).
  - The answer routes now end the question [shown: `lib/question-answers.js:20-22`]. The ruling path is retired [shown: `lib/ruling-standing.js:5-6`].
  - **A gap remains:** when a stage writes a decision that `answers` a question, the question is flagged answered but stays `open` [shown: `lib/records/views.js:87-95`; dec1b780 has been flagged answered since 21 Nov 07:02 and stayed open until 23 Nov]. Not seen since the switch-over.
- **(B) An engineering call raised as a question. 2 cases:** c2af1113 (settled by another agent) and e7563442 (the asker took it back itself).
  - This is old: `lin4441-baseline-method`, `lin4358-decisive-row` and `lin4370-live-scoping-wait` [shown: log.md lines 2911, 3080, 3547].
  - The cut rule makes any gap from the done-when John's call (`lib/prompts/stage-kinds.js:27`). c2af1113's done-when was written by breakdown, not John.
- **(C) The default would have happened anyway: John's answer was the asker's `if-unanswered`. 3 cases:** 2fea4d20, d2640e4b, c2af1113.
- **(D) A question about the state of the world. 1 case:** 2fea4d20 (a deploy). It overlaps with (C).
- **Not seen:** two runs asking overlapping things, and an asker that ended with nobody left to resume [shown: every asker the records show was resumed or carried on; aaf40304 resumed its 19 Nov session, log.md 23 Nov 13:20].
  - Also not seen since the switch-over: John answering in a comment.
- **Which dominates:** (A) by count, and it is gone. What remains is (B) plus (C): the asker had an acceptable default and blocked anyway.

## 3. The fundamental issue

- **Most supported: asking and blocking when you already have a default you'd accept.**
  - Every overtaken question had a reversible default the asker could have acted on.
  - No preference question was overtaken: only John can settle a preference, so events can't overtake it.
  - The manual already says this: "Escalate only what a person's preference alone can settle, or what's irreversible" (`docs/autopilot-operating-manual.md:447`).
  - The teaching gives no test for spotting a default, and the cut rule pulls engineering gaps into questions.
- **Not supported:**
  - *No live owner:* every asker was resumed or carried on.
  - *Nothing links a question to its subject:* 2fea4d20's subject was a Railway deploy, which has no record. c2af1113 was settled in a comment. A link would have caught neither.
- **Partly supported:**
  - *Facts, not decisions:* 2fea4d20 mixed a fact with an offer ("redeploy if you like").
  - *A blocking wait rather than a note:* yes, but only because a default existed. The blocking ones that were real (LIN-4416, LIN-4549) were right to hold.

## 4. Options, simplest first

1. **Do nothing.** Since the switch-over: 8 questions in about 40 h. One was costly: 2.2 h of one lane, no wrong work. None asked in the 2 days since.
   - Defensible. The sample is small. (A) has already gone away.
2. **Code keeps the books:** a decision that `answers` a question ends it `answered`, whoever writes it.
   - It removes a state (flagged answered but open) and the false-escalation miscount.
   - It would have ended dec1b780 and a9961da7 on 21 Nov, 53 h sooner. It does nothing for 2fea4d20.
3. **One test in the existing words, replacing rather than adding:** "If you would accept your `if-unanswered`, don't ask. Act on it and tell the person in a finding what you did and how to change it. A question waits only for what no event can settle."
   - The asker still uses its judgement. Prompt size is frozen, so this should replace a sentence.
   - Effect: 2fea4d20 becomes "carry on with LIN-4561 (its merge deploys), redeploy if you want it sooner". d2640e4b becomes a note. c2af1113 and e7563442 are never asked. The 6 real ones are unchanged.
4. **Merge doorbell** (spike 4's A3 fix, now in the clean-up ticket per Call 1): it would have rung the LIN-4508 autopilot at about 06:15.
   - It catches 1 of 14 questions and adds a producer. John has already called it "solves the specific issue".
5. **A link from a question to its subject, or a timer.** Not recommended: there was no subject record to link, and a timer is the patch John named.

**Suggested:** 2 plus 3, or 1. Take the merge doorbell out of the clean-up ticket.

## Unknowns

- Whether LIN-4561 needed c48d188 live before it ran.
- How the volume behaves at a normal pace: 14 questions in 6 days, then none for 2 days.
