# What the design work expects, written before each look

*Each section is written and committed before the look it predicts, as `design-plan.md` asks. Results are marked under each section afterwards; the predictions above them are not edited. Marks are as on `situation.md`.*

## 1. Before the mapping

*Written 16 Nov, before placing any trace row. I have read the picture, the shapes, and the head of trace 3, but not the trace rows one by one. The frame's shapes are those of `shapes.md` §6: `plan`, `finding`, `check`, `question`/`decision`, `ask` (to a lane), and who is working on what; need 5 has no shape.*

**What I expect to fit.** Most rows are stage outputs and retellings [guess: well over half]. I expect the outputs to land as `finding`s and `plan` versions, and the retellings (close-out stubs, autopilot summaries, parent restatements, counts) as computed from shapes.

**What I expect not to fit, or to fit only by stretching:**
1. **The notes' Lessons.** A Lesson is a lasting truth about a place. It is for whoever works there next, has no single addressee, and has no natural end except being superseded. Not a `finding`.
2. **Standing text.** Prompt templates, the autopilot manual, `AGENTS.md`, and directions written once in a ticket body. These are the processing components' instructions. It is unclear whether they are information on the layer or the program that runs on it.
3. **Rules written in code comments** (trace 5). The same question as 2, kept in the code.
4. **The task's ask, in the person's words.** It is fixed by design and is none of the five shapes. I expect a shape for the task itself. Its name also collides with the `ask` shape, which means a request to another lane.
5. **The near-deadlock** (trace 6). Outside the frame: two engine rules, not information moving.
6. **The change itself.** The code, the tests and the commits are the work product, outside the frame. The PR body retells the change and may be computed.
7. **Review verdicts.** Approve or Request Changes is a gate on the change with a state that goes stale (trace 6's day-old verdict). It may be a `decision`, a `check`, or a shape of its own. A stretch either way.
8. **The size of a move.** A `decision` whose decider is a standing policy. It fits only if a policy can be a decider.
9. **Out-of-reach systems.** The `check` reaches John, but no shape makes the system reachable. Partly outside.
10. **Harbour's process records:** dispatch and cost rows, snapshots, the brief cache. Dispatch rows are who is working on what. Snapshots are a `plan`'s versions. Cost may have no shape.
11. **Periodical reports and evidence folders.** Their findings fit. A report as a whole document may not.
12. **Two surveys finding the same things** (trace 3). Both land as `finding`s, and the frame has nothing that notices the overlap.
13. **Lighthouse.** Its `due.csv` rows are promises with deadlines, which is something like a task shape. Its run and cost ledgers are process records.

**Overall** [guess]:
- The shape list grows by two or three: something for the task, something for a lasting rule or lesson, and perhaps a review verdict.
- Fewer than a tenth of the rows land outside the frame.

**What would surprise me:**
- Many rows that don't fit for reasons other than the ones above.
- Or the five shapes taking nearly everything cleanly. That would suggest stretching, not fit.
