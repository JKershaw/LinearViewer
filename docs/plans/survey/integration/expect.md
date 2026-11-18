# Integration: expectations

*Committed 18 Nov before the census reads any code. What I have read already: `existing` (16 Nov, file headers and cited lines at `6f6c5d2`) and today's openings of `how-process-changes-land.md`, `wake-inventory.md`, `rebuild-round.md`, `one-job-many-paths.md`, `consolidate-then-rebuild.md` and the 13 Nov gate. Each line is a guess until the census marks it held or not.*

## What the census will find, by route

- **C1, hand-offs.**
  - Waiting entries are written by stage prompts and read by later prompts. They are carried as Markdown in `docs/areas/*.md`, not in any store.
  - The `Retires:` check in `lib/dispatch-leftover-answer.js` is the only code that reads one.
  - "Record it as not run" lives only in template text, with no reader in code.
  - Run proposals are the only addressed hand-off with a state, and are read only by the run page.
  - I expect fewer than 10 code sites, and most of the route in prompt text and notes.
- **C2, rulings.**
  - This is the widest route. The `DECISION:` predicate, the task-decisions store, shelving, dismissal suggestions, standing, settled, the rulings page and the proxy rulings route make 8 or more modules.
  - Answers are posted to the tracker as comments by one function.
  - The loop's resume reads the answer from that comment or from state, not from a record.
  - I expect two or three keyings of the same ruling (by loop, by task, by session) that the census can show side by side.
- **C3, verdicts and runs.**
  - The classifier (`run-trail.js` COMMENT_KINDS) has 5 to 15 consumers: close-out, the blind-read gate, recommendation facts, run pages and Periodicals.
  - Dispatch rows already carry most of what a run record needs: actor, task, start, end and cost. Path claims are missing.
  - A verdict's tie to a version is missing everywhere. At most, a commit SHA appears in comment prose.
- **C4, the plan and the brief.**
  - The plan is read from the description by a parser in at least two places: prompt context and the prune.
  - `formatIssueContext` is the single entry for ticket text into prompts. `generatePrompt` takes it as one block, so a record-built brief can replace that block without changing `generatePrompt`'s signature much.
  - The copy-down is done by a stage prompt when a breakdown writes children, not by code.
- **C5, lessons, areas, wakes and the proxy.**
  - The area notes are guarded by tests and read by prompts through the area registry.
  - All wakes go through `addFeedback`. Nothing wakes a reader because a record is open for them.
  - The proxy routes are thin over the providers and stores, with one token model (scopes, workspace, runner copies), so new endpoints can sit beside them with little new machinery.
  - A token knows its dispatch, so `by` can come from the token rather than from the caller.

## What the design will likely be

- Five slices in the order given in the journey, with rulings either inside hand-offs or as their own slice.
- **The brief swap is the riskiest slice.** It touches the knot between LLM & prompts and Runs & dispatch, and the frozen prompt-size test.
- **At least one route will want an in-between state,** where old and new both exist for a short time. My guess is the verdict slice, while the classifier's consumers move.
- **The tracker sync will be a summary written outward.** Nothing is read back except the person's words on a new task.

## What would count as the design failing

- A route whose sites can't all be retired or listed.
- A walk 7 step that the integrated Harbour handles worse than the model did.
- A slice that leaves Harbour broken if the next one never lands.
- A design that needs a new mechanism where one already exists (`existing`), or that inherits one of the five routes to avoid (classifier, `Retires:` conveyor and notes, snapshots keyed to ticket text, answers as comments, rulings keyed by loop) without saying when it goes.

## Read against the census and checks (added after, 18 Nov)

- **Held:**
  - Waiting is Markdown, with code only counting it; `Retires:` is its only reader in code (C1).
  - The rulings route is the widest, with several keyings side by side (C2: nine).
  - The classifier has 5–15 consumers (C3: 15).
  - Dispatch rows lack path claims, and nothing ties a verdict to its version except prose (C3).
  - The copy-down and the prune are prompt text (C4).
  - All wakes are follow-ups to an item, with none sideways (C5).
  - Proxy routes sit beside each other on one token model (C5).
  - Rulings became their own slice. The verdict slice was not the in-between case; the brief's ticket section was.
- **Not held:**
  - **"Not run" lives only in template text.** In fact it's a parsed ledger (C1).
  - **Run proposals are the main addressed hand-off.** In fact the rulings are John's to-do list (C1).
  - **Answers are posted by one function.** They are, but a stamp holds them as well (C2).
  - **`formatIssueContext` feeds `generatePrompt`.** In fact the brief door carries the plan, and stage prompts carry no ticket text (C4).
  - **A token knows its dispatch.** It doesn't (C5), and `by` needed a run id (design §2).
  - **The brief swap is the riskiest slice.** The identity of the writer and the in-between brief were.
- **Failure tests:** every census row is placed (`checks/completeness.mjs`), and every slice leaves Harbour whole (§10). The paper walk's 15 worse steps each have an answer in draft 2 (`checks/answers.md`). The walk was not re-run.
