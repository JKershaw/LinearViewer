**Title:** Layer slice 4: rulings as records, and the ticket section goes

**Repositories:** JKershaw/LinearViewer (Harbour), and one piece in JKershaw/simple-dispatcher after Harbour's side has landed.

**The plan to follow.** The integration design at `claude/cool-rubin-6acj5j@a99ad84e5` (`docs/plans/survey/integration/design.md`), with the layer at `docs/plans/survey/layer/design.md`. Its §3, §5, §7, §9 and §10 slice 4 row were revised on 22 Nov to match this ticket, and they hold the detail: which routes, stores, caches, prompts and scripts go. Where the copy on main differs, the revised design is the plan. This slice's pull request brings the revised design to main.

**What this is for.** Slices 1–3 moved hand-offs, plans, verdicts and changes into records. Two things still travel as text:
- **Rulings.** Agents ask by writing a `DECISION:` block into their reply, which is scraped from the text. Rulings are kept across several stores, stitched together on every read. An answer is posted as a comment, and the worker gets the option or your typed words, never both and never the question. So a qualification you add doesn't reach it.
- **The brief.** The brief agents are pointed at is a model-written summary of the ticket and its comments. The record parts addressed to a stage were built only when asked for in a way no prompt used, so they may never have reached it. Who wrote a comment is guessed from its text.

**What we want:**
1. **The full ruling hand-off.** An agent asks through the records API, as many questions as it needs, and can ask at every point of the change. Your answer is a decision record holding the option you chose and your own words. It wakes the agent that asked, which receives the original question, the option and your exact words together.
2. **Stopped stays stopped.** A run that was stopped stays stopped when you answer, and the page says so, as today. Your decision stays on the task for the next stage to read.
3. **Dismissing means dismissed,** the same everywhere. A waiting agent is told its question was dismissed.
4. **The brief is built from records alone,** for the agent's own run. The task as filed stays its opening part. A correction made after filing reaches stages as a comment or a decision, not by editing the description.
5. **Your comments reach the work.** A comment a person writes after the cutover reaches its task once, as a finding under its actual author, and so reaches the next stage. Harbour's summaries, older comments, and comments Harbour's own runs post (such as a Periodical's report) are not a person's. A comment whose author can't be placed is left out, never credited to the owner. Stage runs write no comments; what they used to say goes into their records.
6. **The size of the move stays fuzzy.** Scoping settles it under the standing policy (err larger) and says why, as today. It asks you, and that work waits, only to cut part of the ask or call it the wrong work.
7. **The text-based machinery is retired,** as the design lists:
   - the scraped `DECISION:` path, and simple-dispatcher's teaching of it;
   - the old ruling stores and the predicate that stitches them;
   - answers as comments;
   - the scan and shelving;
   - the formal size section;
   - the model-written brief and recap;
   - the text rules for who wrote a comment.
8. **Cutover.** Before the old ruling stores go, any ruling still open, this slice's own included, is answered. Shelved ones are ignored. There's no import.

**Not in this slice:**
- lessons (slice 5);
- wakes (slice 6);
- the rulings page's rebuild;
- provider sync;
- making Git and PRs optional in prompts;
- close-out's hand-back findings with no owner, and fresh plan review for edited piece plans;
- stopping a run and its queued work (LIN-4523).

**Witness:** the first suitable task after deployment shows a question asked, answered with an option and a qualifying sentence, and the agent resuming with all three. A person's comment on it reaches the next stage. No separate test with real model calls.

**Readings** (reported after, never a gate): open rulings and time to answer; brief bytes against 13–14 Nov and slice 3; records addressed to a held run, and how long each sat.

**Done when** items 1–8 hold, the witness is recorded, the readings are reported, and Harbour works throughout.

**Standing answers (John):**
- Retire what this slice moves; don't keep slimmer versions; move dependants onto the right data.
- Tests and saved test files move to the new shape in the same piece, with no translators or stopgaps.
- Nothing in code requires a PR or Git.
- No evals with real model calls.
- Recorded history stays as it is.
- Settle engineering questions yourself; only John's calls go to him as rulings.
