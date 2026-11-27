# Log sweep brief (27 Nov)

You're reading one slice of a working log, every line, to find anything important that isn't already kept somewhere better. Once we're confident nothing has slipped through, the log will be deleted (it stays in git history).

**The log:** `/home/user/LinearViewer/docs/plans/survey/log.md`, about 850 KB and 5,533 lines, 2 to 27 Nov 2026. It is the working diary of a long project on Harbour, a control plane that dispatches AI agent sessions on tickets, and its runner, simple-dispatcher. Its owner is John. It includes his decisions in his own words, plus a lot of routine (hourly check-ins, "no change").

**Your slice:** the lines given in your task. Read all of them, using the Read tool with offset and limit, in pieces. Don't skim, and don't rely on keyword search.

**Pull out only what matters for future work:**
1. John's decisions, rulings, preferences and principles, quoted exactly, with the line number;
2. lessons and methods that worked or failed, and why;
3. open items, follow-ups and promises not yet visibly done;
4. facts future work needs: how things work, gotchas, where things live, access and ops know-how. Never copy a secret.
5. Skip routine status, superseded plans (unless the reason they were dropped matters) and my own narration.

**Then check each item against the kept files.** Report it only if it isn't already captured there in substance. All paths are under `/home/user/LinearViewer/`:
- `docs/plans/survey/journey.md`, the curated story and handovers to 24 Nov;
- `docs/plans/survey/notes-review.md`;
- `docs/plans/survey/spikes/plan.md` and `spikes/0-ledger.md` (85 items with statuses);
- the other `spikes/*.md`;
- `docs/plans/survey/integration/design.md`, `docs/plans/survey/layer/design.md`, `docs/plans/survey/horizon/README.md`;
- `CLAUDE.md`, and simple-dispatcher's at `/home/user/simple-dispatcher/CLAUDE.md`;
- `docs/papers/harbour/` (findings that became papers).

Use Grep across these to check. Where you can't tell, report the item as "unsure".

**Write your result** to `/home/user/LinearViewer/docs/plans/survey/spikes/log-sweep/<slice letter>.md`. List only the gaps, each as:
- **[kind]** the item in one or two plain lines, then `log.md:<line>`, then *missing* or *partly captured in <file>*, with what's missing.

Use these kinds: decision, lesson, open, fact. Add "unsure" at the end where it applies. End with one line: `Read lines X–Y in full; N gaps.` Keep it under about 80 lines; be selective, and favour what a future session would regret losing.

Don't edit any other file. Return a summary of at most 6 lines.
