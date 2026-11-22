**Title:** Layer slice 4: rulings as records, and the ticket section goes

**Repository:** JKershaw/LinearViewer (Harbour). simple-dispatcher needs no change: it forwards any `/api/proxy/*` path, and its `DECISION:` and `WITHDRAW:` markers stay as they are.

**What this is for.** Slices 1–3 moved hand-offs, plans, verdicts and changes into records. Two things still travel as text, and this slice moves them and removes the scaffolding that carried them.
- **Rulings are kept in several places at once.** Loop rulings live on dispatch-row feedback, scan rulings in `task-decisions`, and shelves and suggestions in two more stores. A predicate stitches them together on every read, keyed by loop, lineage, task and decision id.
- **The answer is posted as a comment carrying `RULING_MARK`.** On a resume, the worker gets either the option label or the typed text, never both, and not the question. So a qualification you add to an option doesn't reach the worker.
- **A second `DECISION:` on a row disappears,** because the feed shows only the last one.
- **The brief still carries the ticket.** The brief agents are pointed at is a model-written summary of the ticket and its comments, with its own cache and model, and the recap is a second one. The record parts are built only when the caller passes `?run=`, and no prompt says to. So the parts addressed to a stage may never have reached it.
- **Who wrote a comment is guessed from its text** (`isRuling`, `opensAsAgentNote`, `isPersonComment` and selector rule 1), because agents and people post through the same credential.

**After this slice:**
- A ruling is a `question` record and its answer is a `decision` record.
- Every page and every agent reads rulings from records.
- The worker gets the question, the chosen option and your words together.
- The brief is built from records alone.
- Stage runs write no comments, and a person's comment becomes a finding.

**What we want.** The design's slice 4 row is the how, read with §3 (the brief), §5 (rulings), §7 (the tracker) and §9 (in flight). In short:

**Rulings**
- When Harbour receives `decision` feedback, it writes a `question` record:
  - `by` the row's stage, or `autopilot` for a row with no run;
  - `in` the task, `about` the asking run where there is one;
  - `to` the owner (or the deciding stage the feedback names);
  - with the ask, the options and the recommended option.

  Every decision entry on a row becomes its own question. `decision-withdrawn` ends its question `withdrawn`.
- Answering is one route, used by the Rulings page, the task page card and Home.
  - It writes a `decision` (`by` the person, `answers` the question). The answer holds the chosen option and the person's own words, both.
  - The question ends `answered`.
  - The effect then runs from the asking run, as it does today (resume, record or dispatch).
  - A resumed worker's prompt carries the question, the chosen option and the person's words.
  - A question that has already ended is refused, as the 409 does today.
- **Dismissing ends the question `withdrawn`, `by` the person,** with the reason "not worth asking". If the asking run is waiting, it resumes with "proceed on your best judgment". It is the same on every surface. The false-escalation measure counts questions a person withdrew.
- The Rulings page shows what is open for the signed-in person: questions and findings addressed to them.
- Shelving retires (John: unused), with its store and its resurface timer.
- A suggested answer or dismissal is a finding `to` the person, `about` the question, written through `/records`.
- Harbour posts one marked summary per decision, as it does for plans and verdicts, so people still see each answer on the ticket.
- **Open questions are in every brief.** The brief shows the task's open questions and standing decisions, so a stage sees what is already asked or decided before it asks. The asking stage builds nothing its open question contests. There's no code gate.
- **Retired in the same move:**
  - the unanswered-decisions predicate and its keyings (`buildRulingRef`, loop and lineage keys);
  - the `task-decisions`, `dismissal-suggestions` and `shelved-rulings` stores, and the two scripts that import `TaskDecisionsStore`;
  - the agents' rulings route (`GET /api/proxy/rulings`) and its `suggest-answer` and `suggest-dismissal` routes, with their write operations, and the `/rulings?includeResolved` instructions;
  - answers as comments, `RULING_MARK`, `isRuling` and the `decision-answer` stamp.

  Every reader moves onto question and decision records: the ticket closer, the observer sweep, the KPIs, session and Home row states, account erasure, and the chat tools' `list_pending_decisions` (still read-only).
- The scan retires, with its routes, page, fingerprint and the `harbour-comments` ledger it alone reads: stages raise their own questions.
- [to confirm: size] The size of the move becomes a decision `scope`d to the task (design §5). The description's size section, its parser and its guard retire. *Or:* it stays in the description, read whole.

**The brief**
- The brief is built from records, parts 1–8, for the run the dispatch credential names. No `?run=` is needed.
  - A row with no run, and a person's copy token, read the task's brief as a person's copy does today.
  - The blind read still gets no brief.
- **Retired:**
  - the ticket section: `generateBrief`, its system prompt, its model operation, and the `brief-cache` collection and its readers;
  - the recap's model summary: `generateRecap`, its system prompt and the `recap-cache` collection. The recap becomes the task's records, shown short, and its readers move to that;
  - the scripts and tests that replay either, except recorded history;
  - the description's plan-section skip (`textWithoutPlan`) and what serves only it;
  - the stage prompts' "read the current description and comment thread" line (`formatDiscussionReference`), replaced by the brief.

  The task page, the session view, the in-app brief route and the chat tools (`get_brief`, `get_recap`) read the records brief.
- **The task's `asked` stays.** It is the ticket as filed, quoted as part 1. Editing the description afterwards reaches no stage. A correction goes in as a comment, which becomes a person's finding, or as a decision.

**The tracker**
- **Stage runs write no comments.** What each stage's comment carried goes into records: the run's account, the findings it ends and why, its change record and its verdict.
  - Close-out's CI state and the tickets it closed go into its account. The blind read's `Read:` line goes into its verdict.
  - That covers the read-only stages' "add findings as a comment", close-out's summary, implementation's and fix-round's summaries, breakdown's summary, the survey reports, the blind-read comment, and "comment on the issue with the blocker".
  - A row with no run (the autopilot coordinator) puts its wrap-up in its final message, shown on its session page.
  - The write stamps' comment allowances (`one-comment`, `blind-comment`) and their mandates go. The blind read stays blind.
  - Stages still change ticket state, descriptions where scoping writes them, and relations.
- At each run's end, Harbour posts one marked line listing what is open in the task (design §7).
- **A person's comment becomes a finding.** Any comment posted after the cutover that isn't a Harbour summary (its existing `**Harbour summary**` opening line, `lib/records/summary.js`) becomes one `finding`, once, `by` the person who posted it as the workspace shows them (else the owner), `to` the task. It reaches the next stage through the brief. Comments from before the cutover don't become findings. No new marker, and no refusal of comment writes. The Periodical gate is outside the layer and stays: a Periodical's report comment becomes a finding on its own ticket, which is harmless.
- The authorship readers move onto records: selector rule 1, look-first's holding comment, and `personSince`/`actedAfter` read a person's open findings and standing decisions in the task.
- **Retired:**
  - the authorship text rules: `isRuling`, `opensAsAgentNote`, `isPersonComment`, `isAgentActivity`, `reportsLandedWork` and selector rule 1's text;
  - the blind read's comment check (`refusedByBlindRead`). The rule that a blind read names exactly the landing changes already holds on its verdict.

**Departures from the design, agreed with John:**
- [to confirm: import] No import of open loop or scan questions (design §9). Rulings open at the cutover are answered before it deploys.
- [to confirm: one per turn] One `DECISION:` per turn. The stage prompts say so, and simple-dispatcher's first-match scan stays.

**Not in this slice:**
- lessons (slice 5);
- wakes (slice 6);
- the rulings page's rebuild (after this slice, on what it leaves);
- provider sync;
- making Git and PRs optional in prompts;
- close-out's hand-back findings with no owner, and fresh plan review for edited piece plans (a later clean-up);
- stopping a run and its queued work (LIN-4523).

**Witness:** after the cutover deploys, on a real task:
1. a stage raises a question;
2. it shows on the Rulings page and the task page;
3. John answers it with an option and a sentence qualifying it;
4. the resumed worker's prompt shows the question, the option and the sentence.

Also: a comment John posts on that ticket reaches the next stage's brief as his finding.

**Readings before it lands** (reported after, never a gate):
- open rulings and time to answer;
- brief bytes, against 13–14 Nov and slice 3;
- as before: records addressed to a held run, and how long each sat.

**Done when**
- rulings are question and decision records, and every surface and agent reads them there;
- a resumed worker receives the question, the chosen option and the person's words;
- dismissing means one thing everywhere;
- the brief is built from records for the credential's run, and the ticket section and the recap's model summary are gone, with their caches, models and scripts;
- stage runs write no comments; a person's comment after the cutover becomes their finding;
- the predicate, the three ruling stores, the scan, the agents' rulings routes, `RULING_MARK`, the authorship text rules and the blind read's comment check are gone;
- the witness is recorded and the readings reported;
- Harbour still works throughout.

**Where to read:** `docs/plans/survey/integration/design.md` and `docs/plans/survey/layer/design.md` on main.

**Standing answers (John):**
- Retire everything this slice moves; don't keep slimmer versions. If something else depends on what's retired, move it onto the right data.
- Tests and saved test files are part of the work and move to the new shape in the same piece. No translators or stopgaps, in code or tests.
- Nothing in code requires a PR or Git. Prompts may assume them for now.
- No evals with real model calls. The stubbed eval test is enough.
- Recorded history stays as it is: dated docs, recorded eval baselines and their sources, and the scripts the papers cite.
- Production is reachable through `railway ssh` into harbour-cat. Never print the production environment. If a cutover needs the fleet paused, say so.
- Every change names what it retires. Settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
