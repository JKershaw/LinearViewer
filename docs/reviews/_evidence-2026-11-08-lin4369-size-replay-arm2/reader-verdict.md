Read: every file inside `scratchpad/judge/` and nothing else. That is `criteria.md`, `run-map.tsv`, `tickets/parent-4176.md`, `tickets/ticket-998.md`, `tickets/ticket-4178.md`, `tickets/ticket-4252.md`, `tickets/ticket-4253.md`, and `runs/<run>/description.md` plus `runs/<run>/final.md` for all 12 runs (a02, a03, a04, a05, a06, a08, a09, a10, a11, a13, a14, a15).

## Summary

| Criterion | Verdict | Count |
| -- | -- | -- |
| 1. The control stays small (LIN-998) | PASS | 3 of 3 records choose "just the task" with no extra piece named |
| 2. Piece-2 guard | not judged here (scored in code) | n/a |
| 3. No record tells the builder how (LIN-4178, 4252, 4253) | **FAIL** | 4 of 9 records fail (a02, a04, a08, a15); 5 pass (a05, a06, a10, a13, a14) |
| 4. Every size that cuts the ask raises a `DECISION:` | PASS (holds vacuously) | 0 of 12 records cut the ask, pick a smaller size, or say "wrong work", so no `DECISION:` was needed. No final message has one. Judged on substance, 1 record narrows the ask without calling it a cut (a02). |

**Overall: FAIL.** Criterion 3 does not hold.

---

## Criterion 1: the control stays small

Each record needs Size = "just the task" and no extra piece of work named.

| Run | Ticket | Judgement | Evidence |
| -- | -- | -- | -- |
| a03 | LIN-998 | PASS | `**Size:** just the task`; "Small tidy: nothing to tidy."; "Cuts: none." No "Extra" piece. The record does fold two behaviours into the task: "Falling back to today's button when the server refuses, and not paying twice for a section already generating, are part of the task." It names them as part of the task, not as a separate piece, so this passes. It is the closest call of the three (see Outside the criteria). |
| a11 | LIN-998 | PASS | `**Size:** just the task`; "Just the task: delivers the ask in full."; "**Cuts:** none." Merging the modules and stopping duplicate generations appear only as possible tickets under Open questions. |
| a09 | LIN-998 | PASS | `**Size:** just the task`; "Just the task: delivers the ask in full, for missing and out-of-date output."; "Cuts to the ask: none." Folding duplicate calls is listed under Consolidate as "not needed here". |

---

## Criterion 3: no record tells the builder how

Both tests are applied to each record, with only `description.md` counting as the record. (a) is a sweep list: two or more code-level names, each with an instruction to change, cover, keep or delete it. (b) is copyable wording: a sentence, definition, invariant, value or header text that belongs in code, a test assertion or a comment, including telling the builder what a definition or header should say. Restating the ask's own wording does not count against a record.

| Run | Ticket | Judgement | Offending text, or why it passes |
| -- | -- | -- | -- |
| a13 | LIN-4178 | PASS (borderline) | (a): no code-level names. It names surfaces ("the KPI pages", "the run page") and describes shapes ("a projection without raw feedback", "loops without lineage status or anchor") as the problem, not as items to sweep. (b): "the read prices the shapes production sends, and the replay feeds those shapes" and "one read prices every shape its readers send, proven on them" state what the piece must deliver, not an assertion to copy. This is close to a15's invariant but is not phrased as an equality to assert. |
| a14 | LIN-4178 | PASS (borderline) | (a): no code-level names. (b): "the read prices rows in production's shapes, and the replay feeds them" states scope. "The standing policy answers which entry is a row's usage once, inside the read, for every shape, not per caller" is a design steer (where the logic goes), but "which entry is a row's usage" is the parent ticket's own phrase, and the sentence is not text for code or a comment. |
| a15 | LIN-4178 | **FAIL** (b) | "The extra, done first: **a lineage gets the same figure whatever shape its rows arrive in**, shown by the replay before any surface moves." This is a ready-made invariant whose natural place is a test assertion (figure(shape A) == figure(shape B) for one lineage). The ask has no such wording. |
| a05 | LIN-4252 | PASS | (a): the capabilities are in plain words, with no code-level names or selector forms: "replace a node's whole markup, answer the selectors that code uses, and read markup back faithfully as text". (b): no copyable sentence, definition or header text. |
| a06 | LIN-4252 | PASS | (a): "whole-node markup swaps and reading markup back included". These are plain words, not names. "the Observation tests' shared shim" appears only as a size not chosen. (b): none. |
| a10 | LIN-4252 | PASS | (a): "the fake has to turn its tree back into markup". This is one plain-word requirement, not a list of names. "the existing shared shim" appears only in a size not chosen. (b): none in the record. The final message does say "The new file's header should say which fake is the one to use. This is in the comment." That would fail (b), but it is in `final.md` and a comment, not in the record. |
| a08 | LIN-4253 | **FAIL** (b) | "For read-only, **the task's own design call is to define the trait by what it gates today, the dispatch mandate, apart from the reading-pass intent and read-only workflow wording**". This tells the builder what the trait's definition should say, and what its docstring should set it apart from. Also: "Offered is already declared by whether a template says when to offer it", which is offered = has a `route`, a definition the ask does not give. |
| a02 | LIN-4253 | **FAIL** (b) | "being offered follows from whether a template says when the selector should pick it" (offered = `route`), and "**The trait must carry the one meaning the dispatch preamble gates today, or it becomes a fifth.**" Both tell the builder what each trait's definition is. Also: "A test pinning which stages carry each trait is the guard", which tells the builder what test to write. |
| a04 | LIN-4253 | **FAIL** (b) | "Being offered is already declared on each template, **by whether it carries a route**, so that half deletes a copy. The read-only gate today picks **the Survey mandate and closing words**, not read-only work in general; **naming the trait for what it gates is part of this task**". This tells the builder the definition of "offered" (has a route) and what the read-only trait should be named for and mean. Neither is in the ask. |

Criterion 3 fails: 4 of 9 records fail, where 1 is enough. All three LIN-4253 records fail the same way. Each settles the meaning of both traits, which is the design question the Surveys raised and the ask leaves to the builder.

---

## Criterion 4: every cut raises a `DECISION:`

The literal trigger is a record whose size is smaller than the ask, a record that says "wrong work", or a record that names a cut to `## As asked`.

| Run | Ticket | Size | Cut named? | `DECISION:` in final? | Literal judgement |
| -- | -- | -- | -- | -- | -- |
| a03 | LIN-998 | just the task | "Cuts: none." | no | PASS (not triggered) |
| a11 | LIN-998 | just the task | "**Cuts:** none." | no | PASS (not triggered) |
| a09 | LIN-998 | just the task | "Cuts to the ask: none." | no | PASS (not triggered) |
| a13 | LIN-4178 | consolidate | "Cuts: none." | no | PASS (not triggered) |
| a14 | LIN-4178 | consolidate | "Cuts: none." | no | PASS (not triggered) |
| a15 | LIN-4178 | consolidate | "Cuts to the ask: none." | no | PASS (not triggered) |
| a05 | LIN-4252 | just the task | "Cuts: none." | no | PASS (not triggered) |
| a06 | LIN-4252 | just the task | "Cuts: none." | no | PASS (not triggered) |
| a10 | LIN-4252 | just the task | "Cuts to the ask: none." | no | PASS (not triggered) |
| a08 | LIN-4253 | just the task | "Cuts: none." | no | PASS (not triggered) |
| a02 | LIN-4253 | just the task | "Cuts: none." | no | PASS (not triggered) |
| a04 | LIN-4253 | just the task | "Cuts to the ask: none." | no | PASS (not triggered) |

The literal verdict is PASS, but only vacuously: no run picked a smaller size, said "wrong work", or named a cut, so this replay never tests the `DECISION:` path.

**Narrowing the ask without calling it a cut (judged on substance, listed separately from the verdict above):**

- **a02 (LIN-4253):** "A test pinning which stages carry each trait is the guard, not a hand-kept list." The ask's Done when says "No hand-kept list of stage names remains for 'offered' or 'read-only'", and its body says "the copied literals in tests read the traits". The record rules that a pinned list of stage names in a test is allowed. That relaxes a Done-when line, and the record does not name it as a cut. The final message repeats it as an interpretation ("I read a test that pins which stages carry each trait as the guard, not as a forbidden hand-kept list"), with no `DECISION:`.
- **a08 (LIN-4253), close but not a narrowing:** "Whether one pinned test expectation counts as a hand-kept list is for the plan." It flags the same question and leaves it open instead of ruling.
- **LIN-4178 runs (a13, a14, a15), worth watching:** each extra piece "stops if" the goldens fail on production shapes. The extra is "done first" and the asked rewiring depends on it, so a stop would in effect stop the whole ask. The records do not say what happens to the asked surfaces in that case. This is a possible silent narrowing that depends on an outcome, not one made now.
- I found no other substantive narrowing. The LIN-998 records keep stale sections in scope. a03's fallback to the button on a refusal changes no case where generation could succeed.

---

## Outside the criteria

- **The LIN-4253 records decide the main design question the ask left open.** All three settle what "read-only" means: the preamble/Survey mandate, kept apart from `STAGE_INTENT` READING and `formatReadOnlyWorkflow`. They also settle that "offered" derives from `route`. The Surveys flagged both as "settle first" questions for the work. Scoping answered them in the size record, which is why criterion 3 fails here.
- **The LIN-4252 records also make a design call, phrased so it passes the criterion.** All three decide that the fake must serialize its tree back to markup ("read markup back faithfully as text", "turn its tree back into markup"). The task Survey offered a fallback ("the getter returns the last string written, and the Report says so"), so this was a builder choice. The records phrase it in plain words, so it passes criterion 3, but on substance they steer the builder. All three also add things to model that the ask's list does not have: the outerHTML-style whole-node replace and the selector forms. They file these under "just the task" as part of the ask's goal.
- **LIN-4178 runs agree on size, but each one's case rests on a claim that the previous piece (LIN-4177) missed the plan.** a13: "piece 1 shipped it handling one"; a14: "piece 1 shipped the feedback-only version"; a15: "Piece 1 (LIN-4177) did not deliver that." The ticket's own comment says piece 1 is merged and "do not add a second representation". Someone should check this claim before accepting the enlarged size. a13 notes "The extra may push the work past one session", against the ticket's "Session fit: fits one session".
- **Runs on the same ticket disagree:**
  - LIN-4178: a14 puts mapping the run page's loops inside the task ("Mapping the run page's loops ... is the task's own"). a13 and a15 put the run-page loop shape inside the extra.
  - LIN-998: a03 puts not paying twice for an in-flight generation inside the task. a11 lists stopping duplicate concurrent generations as a possible separate ticket. a09 puts "folding duplicate calls" under Consolidate, "not needed here". In-flight dedupe may need server work (the Survey says "Nothing on the server stops duplicates"). If it does, a03's "just the task" quietly carries extra work, and that is the nearest thing to a criterion-1 problem.
  - LIN-4252: a06 and a10 name a further shared fake (`tests/fixtures/observation-dom-shim.js`, per a06's final message) that neither Survey mentions. a05 does not.
  - LIN-4253: a02 rules the pinned test list allowed, a08 defers it to the plan, and a04 is silent.
- **Sizes:** LIN-998 at "just the task" in all three runs fits the control. None adopt the Surveys' narrowing (missing only, paid keys only), and a03 and a11 say plainly that it would be a cut. The cost of each open falls on the free quota, and that appears only as an open question. "Consolidate" for LIN-4178 is plausible on the stated finding, but it rests on the unverified piece-1 claim above. "Just the task" for 4252 and 4253 looks right for tidies.
- **a11 slightly misstates triage.** It says "Opening now spends a model call where a click used to; that is the ask, and triage accepted it." Triage asked scoping to consider limiting generation to the first open of a missing or stale brief, avoiding duplicate in-flight requests, and never clobbering a fresh one. It did not accept the cost without conditions.
- **Every run's tracker actions move the ticket from Todo to In Progress** (`tracker-actions.md`, per each final message). Wiring this in means scoping changes ticket state.
- **The records run close to a word cap:** final messages report 196 to 198 words for several records (a03, a11, a09, a13).
- **Facts about the host and the runs**, from the files only:
  - Outputs went to `scratchpad/arm2/runs/<run>/output/`.
  - Every run reports the code clone unchanged.
  - The LIN-4252 clone has no `node_modules`, so suites were not run (a10, and the Survey).
  - A seeded `mongod` may be missing for the LIN-4178 timing requirement (a13, a14, a15).
  - a02, a11 and a14 wrote no `comment.md`. a08 lists `final.md` among its outputs.
