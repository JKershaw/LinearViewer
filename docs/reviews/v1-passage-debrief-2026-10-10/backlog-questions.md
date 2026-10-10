# E. The backlog: periodicals, duplication, the interface, the Collective

Read-only. LinearViewer `origin/main` at `ce3c4ee8` (10 Oct). Harbour data comes from the FC's GET helper. The clone's history starts on 12 Sep, so anything older comes from docs and tickets.

## 1. Periodicals

**What exists.** There are 15 templates, all weekly, three of them advisory (`lib/periodicals.js:799-920`). Each runs in two stages (`:19-45`):
- **Stage 1** researches the repo and files one review task.
- **Stage 2** runs that task. It writes a severity-ranked report to `docs/reviews/`, files at most about 3 follow-ups, comments and closes.

All 15 are told to "Stay review-only" and change no code (`periodicalBullet.reviewOnly`, 15 call sites).

**Aimed at duplication.** Code Quality covers duplication, dead code and hotspots (`:340-361`). Drift & Coherence covers decisions implemented N times, fragmented conventions and dependency direction (`:363-385`). Data & Fetch owns the fetch slice. All of them report and file tickets; none of them cleans.

**How one runs, end to end.**
- Nothing in the code fires one. The scheduler's five jobs (`server.js:756-919`) include no periodical. `cadence` is "a fallback floor for LIN-1629, not a trigger" (`:57`); LIN-1629 (filed 26 Jul) is Todo.
- A person presses **Mint** or **Mint + Autopilot** on the Periodicals group (`lib/render.js:556-590`). The group needs the `periodicals` workspace flag, which is off by default.
- An unscoped Autopilot's first act is `GET /periodicals`, and a template reading `due` comes before the stack (`lib/prompts/autopilot-kickoff.js:757-770`). This is a prompt rule, not code.
- The proxy refuses Done on a review task without a change link and an adversarial second-read record (`lib/periodical-report-gate.js`).

**Today (helper).** 7 templates read `due`; they last ran 26–27 Sep, five of them within 13 seconds. The other 8 read `never` within the 30-day window.

**Track record.**
- **Since June:** 42 reports from 13 of the 15 templates, 67 run tickets and 109 follow-ups (`what-hides-between-sessions.md:194-195`). In `docs/reviews/`, Performance/Scale and Data & Fetch have no report.
- **Incidents:** they were the first to find none of the 107 incidents on record. Their only first find was their own four-week outage (LIN-3104).
- **Cost:** the 26 Sep batch cost about 109M weighted tokens, 3.1% of September.
- **Follow-through:** Drift & Coherence says the duplication grew: the workspace lookup went from 4 to 17 sites, the error-envelope residue from 76 to 87. Its fix tickets LIN-675, LIN-2388 and LIN-2389 are still Backlog. So are Code Quality's 26 Sep tickets, LIN-3112, LIN-3113 and LIN-3114.
- **Second read:** LIN-2323's second read disagreed with 9 of the 12 reports carrying a verdict (`what-hides…:211-213`), and its sunset date was never checked (`how-process-changes-land.md:151-156`).

**Adding one.** Write a builder on `buildPeriodicalScaffold`, add a registry entry, and update `tests/unit/periodicals.test.js`, which pins the count at 15 (checklist at `:66-91`). A schedule is extra work: either LIN-1629, or a new scheduler job (`server.js`, a sweep module, and the `source-map.md` roster, which tests check).

*Inference:* a periodical that cleans would need a contract other than the shared one, which is review-only and files at most 3 tickets.

## 2. Duplication

**What the papers say.**
- **`coherence-as-it-grows.md` (v3, checked).**
  - Copied text fell from 2.5% to 1.2% while the code grew 4.5×.
  - What grew is the number of places holding one decision: the timestamp parse went from 1 file to 18.
  - There are 33 declared twins and 33 parity-test files. 103 of 398 production files hold a detected site.
  - Unreconciled decisions cause 45% of escaped defects and 36% of send-backs. A PR touching one is 5× larger and sent back 2.5× as often.
  - Filing tickets, parity tests and shared helpers did not finish the job; "deletion finishes" (LIN-420, LIN-3300).
  - Ten or eleven twins exist because `public/` cannot import `lib/`.
- **`one-job-many-paths.md` (unchecked).** Five live candidates:
  - GitHub priority is offered, then dropped;
  - "waiting for a person" is derived three ways;
  - recommendation input is prepared four times;
  - the bookkeeping classifier has five copies;
  - the credential ranking rule is copied.
- **`how-process-changes-land.md`.** The process code holds 47 half-finished items: 21 switches, 19 dual paths and 7 parked experiments. Adds outnumber removals about 6 to 1.
- **`growth-atlas.md`.** Since June, product code grew 2.9× while tests grew 10.6×. Product lines per Done ticket stayed flat.

**What the papers recommend.**
- **Coherence paper:**
  - let the browser load pure `lib/` modules;
  - give the layering rule a place for shared predicates;
  - reshape helpers that callers cannot use;
  - count a change done when its decision has one authority again;
  - give parity tests due dates, and prefer deletion;
  - stop filing from Drift & Coherence and route its findings into the next ticket on that seam (its census script runs in a minute).

  It also specifies a six-week, two-arm trial.
- **One-job-many-paths:** make the unit of work a decision and its callers, with no new review stage, and keep deletion inside the same effort.
- **Steady-base menu:** burn down what is half-finished before a new trial (M30), and make one change at a time between passages (M27).
- **`fleet-complexity-read.md` §3:** ask "who does this protect?" before keeping dual paths, flags and rollbacks.

**LIN-3339 (helper).** In Progress, High, unassigned, no children, and no dispatches. Its scope is to check the five candidates, then consolidate each one that holds up as work that "ends with the old paths gone". Its 8 Oct comment records John: "replacing chunky features in one go … prime time for a rebuild".
- The LIN-3332 task-address work, which the paper said to finish first, is Done. Re-running the paper's command, `bindingScope` is now in 8 files, down from 44.
- Older tickets touch two candidates: LIN-2052 (GitHub priority) and LIN-2845 (waiting not cleared), both Backlog.

## 3. Interface

**Stack.** Pages are server-rendered from template-literal functions on one shell, `lib/components/page.js` ("NOT a new rendering system"). There are 21 components, and each page has its own `public/*.js` and CSS. There is no framework and no build step (CLAUDE.md).

**Task page (LIN-3324, built 6–8 Oct, about 2,900 lines).**
- It reads stored sessions, one tracker read, the brief and recap caches (read only), run evidence, and the task's run facts (`task-page-loader.js:1-40`).
- Its poll reads stored data only and repaints using the page's own render functions.

**Run page (about 3,300 lines).** Includes about 450 lines of the 3,181-line `routes/dashboard.js`.
- Its route reads about ten sources (`dashboard.js:1318-1443,1631-1773`): the transcript, a brief/recap join, a stored paragraph, a waiting banner, the rulings cache, credential health, proposals, dispatch rows, and the tracker through the *active* provider.
- It was built in about 12 slices, between 2 and 5 Oct, on top of the operator's session page (LIN-1003).
- The close-out button takes the issue id from the reply box (`session.js:737-751`).

**What made the task page simple (LIN-3324).**
- The work was framed as "designing the page … Not in permissions or plumbing".
- John reviewed a mockup first.
- The shared step row was lifted out first, byte-identical (LIN-3328).
- One loader; the renderer derives nothing, and it reuses the existing waiting logic "rather than adding a fourth".
- It still has bugs: LIN-3448 is in Backlog.

**LIN-3349 (Backlog, filed 8 Oct).** Rebuild the run page, don't remove it; out of V1 scope. Its comment asks the rebuild to adopt `close-out.js` and `task-run-facts.js` and delete the copies. `docs/v1.md:69` calls the run page's "live view … that page unfinished". *Inference:* that is John's "live view page".

**LIN-482 (15 June).**
- It found the LIN-368 component layer built but half-adopted (about 66 raw `fetch()` calls, tokens mostly not used).
- It recommended finishing adoption, not a redesign or a framework. It ruled out React, Vue and Svelte, and deferred an htmx spike to a "Step 2".
- Step 1 (LIN-491–496) was Done on 15 June. Step 2 was never ticketed.

## 4. The Collective (LIN-450)

**What it is.** An experimental page behind a per-user `collective` flag, off by default (`docs/architecture/experiments.md`).
- You choose characters, each a persona bound to one repo. `POST /collective/start` queues a participant prompt on each one's workspace as a cli/web Claude Code session, and a live consumer must run it. The sessions talk in a Yap channel.
- John watches the channel and can speak into it.
- There are six presets, including Architecture review and Design crit (`lib/collective-preset-defs.js`).
- Writes are restrained by the prompt only.

**Current state.**
- LIN-450 has been Done since 13 June.
- Since 12 Sep its files have changed only in cross-cutting commits.
- Many follow-ups are still open, including LIN-820, LIN-973, LIN-1051–1054 and LIN-1069 ("observe a live facilitated run").

**What it produced.** Two recorded sessions.
- **12 June:** the "un-authorable judge" idea and proposed tickets.
- **3 July:** "the engine already runs", once John pointed the room at the live system.
  - Tickets filed that day match its feedback: LIN-972 (Done) and LIN-973 (Todo).
  - It proposed four tasks, "All unstarted" at the time.
  - Its lesson: "Shared docs make us sound alike."
