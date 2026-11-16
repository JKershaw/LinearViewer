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

### Results, marked 16 Nov after the mapping (`mapping.md` §11 has the counts)

- **What I expected to fit: partly held.**
  - Stage outputs and retellings are the largest group: `finding` 74, `computed` 36 and `plan` 28 of 372 parts. That is 37% of parts, not "well over half".
  - Many stage outputs landed as judgements, not `finding`s. I predicted that only as a stretch (item 7).
- **The thirteen predicted misfits: all held.** Three held with a twist:
  - **Item 3.** Rules in code comments grouped with the Lessons (lasting truths), not with standing text.
  - **Item 5.** The near-deadlock was not alone. Three more engine items joined it: a review on a parent with no PR, surveys skipped, and an answer waking a finished session.
  - **Item 7.** Judgements are the largest waiting group, at 27 parts, not a small stretch.
- **"The shape list grows by two or three": broke.** Seven candidate groups emerged: task, verdict, lesson, setting, run record, measure, area.
- **"Fewer than a tenth of the rows land outside the frame": held, with a caveat.** 11 of 220 rows (5%) are wholly outside. But 43 (20%) touch outside somewhere, mostly through the work product.
- **The surprises:**
  - **Rows that don't fit for other reasons: partly.** Three groups were not predicted: measured values (8 parts), the place (3 parts, but every "for the area's future" finding needs it), and run records as a group of their own.
  - **The shapes taking nearly everything cleanly: did not happen.** 83 of 220 rows fit cleanly in every part.

## 2. Before the inventory of what Harbour already has

*Written 16 Nov, before reading code for `existing.md`. All I have looked at so far is the names of files under `lib/` and the lines the traces cite.*

**What I expect to exist as data that code acts on:**
- `who is working`: dispatch rows and lineages.
- run records: cost rows.
- `question` / `decision`: the rulings, but keyed by the asking session's loop.
- task: the local workspace's issues.
- setting: model routing and some settings.
- area: `areas.json`, read by code.
- versions: the task snapshots, but only of the ticket's text.

**What I expect to exist only as prose, with no data behind it:**
- `plan`: lives in a ticket description.
- `finding`: Waiting entries and comments.
- `check`: "not run" lines.
- `ask`: comments on a parent.
- lesson: the notes' Lessons.
- verdict: read by regex or by a prompt, not stored as data.

**The four needs that are not shapes:**
- Waking and the read view exist as general mechanisms: wakes, the brief and the recap, prompt assembly.
- Need 5 is a list of paths in a prompt.
- Nothing notices duplicates.

**Which choice each belongs to** [guess]:
- General: waking, the brief, the stores, dispatch and cost rows, rulings, settings.
- Tied to the ticket as carrier: snapshots (of ticket text), the prune, every comment-based route, the notes.

**What would surprise me:**
- A data store for findings or checks.
- Or a read view that is already built from records rather than ticket text.

### Results, marked 16 Nov after the inventory (`existing.md`)

- **Data that code acts on: held.** Dispatch rows, cost rows, rulings, local issues, settings and model routing, `areas.json`, snapshots of ticket text. One correction: besides loop-keyed rulings, there is a task-keyed store for decisions a scan finds (`lib/task-decisions-store.js`).
- **Prose only: held.** `plan`, `finding`, `check`, `ask`, lesson. The verdict is read from comment prose by a declared classifier and regexes, not stored.
- **The four needs: held.** Waking and the read view are general mechanisms. Need 5 is a list of paths in a prompt. Nothing notices duplicates.
- **Which choice each belongs to: held,** with the refinement in `existing.md`: most mechanisms are general, and only their input is the ticket.
- **The surprises: neither happened outright.**
  - There is no store for findings or checks. But the run proposal (Apply / Decline, no expiry) is the same pattern, used for one case.
  - No read view is built from records. But the brief already aims to be the current plan plus its changelog, rebuilt from ticket text.
- **Not predicted at all:**
  - the comment classifier, which declares kinds over prose
  - the local store's one collection of several kinds
  - shelved rulings with a re-surface timer
  - 35 separate stores
- **Caveat.** Every prediction held, which partly reflects that the traces had already cited much of this code. The expectations were less blind than §1's.

## 3. Before walking the avenues through the traces

*Written 16 Nov after drafting `avenues.md` §1–§3, before walking any moment. The moments are the ones `shapes.md` §4 used, plus one the mapping added: trace 3's LIN-4154, an open ticket no stage found (T3.37).*

**Predictions:**
- **A, B and D change the same moments.** D differs only where its extraction must spot something stated loosely: a departure from the plan (trace 3, the suite list) and the asks posted in prose (trace 6). I expect it to find the asks and to miss some departures.
- **C leaves the cross-lane moments as they are today:** trace 6's unanswered asks, and Lighthouse's LH051. Branches don't see each other. C is weak on trace 3's browser checks: a file that nothing wakes.
- **No avenue changes the near-deadlock** (trace 6) **or `AGENTS.md`'s growth** (Lighthouse).
- **Close-out's unread edits** (trace 3) become visible in all four, but are read only if the design adds a reader after them. No avenue reads them by itself.
- **LIN-4154** (trace 3) changes in A, B and D through an area: the next task touching that code receives it. In C it changes only if the run reads the area's files.
- **The Lighthouse moments** change in A, B and D only if Lighthouse runs on Harbour. C is already Lighthouse's shape, so it changes them only where its checker is stricter than Lighthouse's.

**What would count as an avenue failing:** a moment where it does worse than today. I predict none does. C equals today on the cross-lane moments.

**What would surprise me:** a moment where all four are unchanged, other than the near-deadlock and `AGENTS.md`.

### Results, marked 16 Nov after the walkthrough (`avenues.md` §4)

- **"A, B and D change the same moments": partly broke.** D is only partial wherever prose stays readable: 3b, 6b, 6c and Lighthouse b. Its asks (6a) and checks (3c) did extract as expected.
- **"C leaves the cross-lane moments as they are": held** (6a). LH051 is partial if ids come from a counter file. C was weak on the browser checks, as expected.
- **The near-deadlock unchanged: held. `AGENTS.md` unchanged: broke slightly.** Its settings would move out in every avenue.
- **Close-out's unread edits: held.** They are visible, but nobody reads them unless a reader is added.
- **LIN-4154: held**, with one condition found: the area must surface open tasks about its paths, not only findings.
- **The Lighthouse moments: held.**
- **Not predicted.** Trace 3a, the correction never sent upward, changes only partly in every avenue. The frame does not force the plan's next version; that needs a rule.
- **No avenue does worse than today: held.**

## 4. Before the spike: agents writing shapes

*Written 16 Nov, before any spike run.*

**The spike.** It tests the axis that separates avenue A from avenue D: who writes the record. It runs on an outside project: Yap, at `14f7e92`, with its open item 18, a CLI client.
- **Arm A.** A fresh agent surveys the task and writes only records, in the catalogue's shapes (`avenues.md` §1).
- **Arm D.** A fresh agent surveys the same task in prose. A second agent, given only that prose and the same shapes, extracts the records.

The raw outputs stay in the session scratchpad, as notes on an outside project. A summary goes in `avenues.md` §5.

**Predictions:**
- **Arm A** fills the required fields for nearly every record. It is weakest at addressees beyond the task, such as an area or "the person", and at `about` links. It writes fewer, more decisive records than D's prose holds.
- **Arm D's extraction** catches most actionable points. It misses or misaddresses at least one hand-off, and merges points the prose repeats.
- **Both** leave some content unplaced. The likeliest is the survey's description of how the code works today: background the next stage reads, but which is neither a finding nor clearly a lesson. That would be a gap in the catalogue.
- **Neither arm** writes a `check`. A CLI client on a local server needs nothing out of reach.

**What would surprise me:**
- Arm A losing substantive points that D's prose has.
- Or the extraction keeping every point with the right addressee.

### Results, marked 16 Nov after the spike (`avenues.md` §5)

- **Arm A fills the required fields: held.** All 44 records pass the field check.
- **Arm A is weakest at addressees beyond the task: broke.** It addressed two areas and another task unprompted.
- **Arm A writes fewer records: held.** 44 against D's 71.
- **The extraction catches most points: held.** None of those I checked was lost.
- **The extraction misaddresses at least one: held, more strongly than predicted.**
  - It inferred addressees in 34 of 71 records.
  - It labelled 18 of 21 questions "product".
  - It found no default stated for 17 of 21 questions.
- **The extraction merges repeats: held.** It also split compound points into near-duplicates.
- **Both leave background unplaced: broke.** Background became lessons in both arms. What went unplaced was priority, uncertainty and provenance.
- **Neither writes a check: broke for arm A,** which wrote three real checks. Arm D's prose named none.
- **The surprises:**
  - **Arm A losing points the prose had: partly.** Each arm had a few points the other lacked, and one run cannot say why.
  - **The extraction keeping every point with the right addressee: did not happen.**
