# What this stage really wrote

Written in the autopilot's wake 1df3249b (dispatched 23:04:17.401). The ruling's `raisedAt` is null in the material; the comment below says it was raised by 23:05:04.

## Comment on LIN-4469 at 23:05:04 (id fab0cf08)

### Engineering settlement for LIN-4469, and a corrected ruling (autopilot)

The review (Needs Discussion) found that the open ruling `lin-4469-cuts` states a wrong fact: it says 11 kinds are byte-identical. Measured in real context (preamble included), only the four `work` kinds (blocked, breakdown, close-out, retrospective-audit) are identical; look-into and retro fall 74, context, survey-task and survey-place 23, blind-read 24, triage 67. The ruling is replaced by a one-question version with the corrected figures (`lin-4469-witness`).

**Settled here (engineering, no ruling needed): fold the tracker-write clauses in the four sibling places.** `lib/prompt-template-defs.js` lines 975 (survey-task), 994 (survey-place), 1065 (blind-read) and 268 (triage; its scope rule stays, its write clauses go). They are the same idiom as the class this ticket bounds, tracker-write prose the guard now refuses, and under John's standing rule (LIN-2825, amended by LIN-3006) an item of the same class is inside whether or not the plan listed it. The ask's "shrink only" is read as: touch only what the guard backs. So the code, branch and PR prohibitions stay in words (no backstop), as in the four mandates. Both the builder and the reviewer recommend this.

**For the next build step:** (a) the fold above, with ceilings and `FROZEN_TOTAL_BYTES` re-pinned once more and a lower total; (b) the review's Fixes 1 to 5; (c) a `### Leftovers` answer with a `Retires:` line naming an entry the diff removes; (d) the corrected figures in the PR's decision text, the change-log row and the LIN-4350 comment.

**Still John's:** only the witness sentence, "a net fall across every kind", which cannot hold for the four `work` kinds because they carry none of the folded text. Merge waits on that answer.

## Ruling raised on LIN-4448 (lin-4469-witness, to John, on_answer resume, record_on LIN-4469)

```json
{
 "decision_id": "lin-4469-witness",
 "question": "LIN-4469 asks for a net rendered-byte fall across every kind. Four work kinds (blocked, breakdown, close-out, retrospective-audit) carry none of the folded text, so they stay byte-identical in real context; the other kinds fall. Accept that as meeting the ask?",
 "options": [
  {
   "id": "accept",
   "label": "Accept: the witness holds for every kind that carries folded text; the four work kinds cannot fall"
  },
  {
   "id": "require",
   "label": "Require a fall for all four: fold more text out of those kinds' prompts"
  }
 ],
 "recommended": "accept",
 "free_text": true,
 "if_unanswered": {
  "summary": "The cut stays unagreed: the build fixes continue, but PR #2447 does not merge"
 },
 "on_answer": {
  "effect": "resume",
  "record_on": "LIN-4469"
 }
}
```
