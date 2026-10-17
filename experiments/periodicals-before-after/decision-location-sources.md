# Decision location: sources in docs/papers (origin/main 91fca7dd)

For each source: its claim, the measure it uses, and how a design-first rebuild could move that measure or be measured by it. All paths are under `docs/papers/harbour/`.

---

### the-second-copy.md (essay, v1, 2026-10-08; not independently checked)

- **Claim:** a decision held in more places than any one change reaches costs nothing while it sits and is paid in full when it changes. This draws on Parnas 1972, the clone literature read by its units, migration patterns whose final step is "delete", and agent studies (agents add more and delete less; "Guard-and-Go").
- **Remedies:** leave one place to change, and make done include the delete. Asking does not hold.
- **Measure:** none of its own. It reads coherence-as-it-grows: 45% of escapes, 36% of send-backs, and 5× PR size when a change touches a known multi-site decision.
- **Rebuild link:**
  - A rebuild is the place where "one place plus delete" can be enforced.
  - Test it by whether a rebuild retires sites of a scattered decision. This round's census says it did not: `known-decisions.sh` is identical at both commits.
  - The two extracted modules do bring a computation to one place. Their headers read "so the computation lives here once" and "write that order down once".

### coherence-as-it-grows.md (paper, v3, grounded at d61903f3; checked)

- **Claim:** the code got textually tidier (duplicated text fell from 2.5% to 1.2%). What grew was the number of places holding one small decision, for example a timestamp parse that went from 1 to 18 files. That stock is paid for in escapes, send-backs and change size.
- **Measures:**
  - M1: sites per decision, from `known-decisions.sh` and the census.
  - Declared twins: `coherence-census.mjs admissions`.
  - Exposure: PRs touching a multi-site decision's site.
  - A specified two-arm trial whose primary outcome is "sites per touched decision before/after".
- **Rebuild link:** use the trial's primary outcome per rebuild ticket. Add "the touched decision has one authority" to a rebuild's done-when line.

### theseus.md (paper, v1, grounded at 38fc3b5c; unchecked)

- **Claim:** across 1,941 commits the areas tied 24 two-way tangles and lost 5. 23 of the 24 were tied by a single import. "A consolidation puts its one place in some area, and if that area is the wrong one it ties a knot." Knots untie only by taking something away.
- **Measures:**
  - Seams tool series: knots, links, births and deaths per commit.
  - The Providers contract: 98 provider and method pairs. Credentials are decided outside it, where code names a provider 53 times in 20 files.
- **Rebuild link:**
  - This round reproduces the mechanism directly. LIN-3579's one-place module `home-swipe-prompt-opts.js` landed in the catch-all area and tied the only new knot (pages↔Other features 2/1).
  - Rebuilds untied none.
  - Measure births and deaths of knots per rebuild, and where each extracted module lands.

### drawing-the-ship.md (essay, v2, 2026-10-15; not independently checked)

- **Claim:** draw the code as a voyage, not a place, because the weekly decision (which plank next) shows only in change.
- **The Decision Field board:** draws decisions held in several places as clusters of dots. Its card shows which tickets made a decision and which only read it. Parnas's unit is the decision.
- **The Theseus board:** shows "specks" (scattered sites) and "ingots" (a decision brought to one place).
- **Measure:** no new one. It reads theseus and coherence data.
- **Rebuild link:** a rebuild should turn specks into ingots. Plotting rebuilds as voyage events (lines down, knots ±, specks → ingots) is the before/after picture.

### flow-and-convergence.md (essay, v2, 2026-10-15; not independently checked)

- **Claim:** what keeps a part lean is a limit, not caring and not counting. Harbour caps its prompts and CLAUDE.md, and those stayed lean. Code shape and decision copies were counted but not limited, and they grew.
- **Measure proposed:** a weekly count of "places per decision, tangles between areas, net deletion" beside merges per day, with a limit enforced like a size cap.
- **Rebuild link:**
  - Report net deletion per rebuild. This round: −1,283 code lines repo-wide and −627 decision points.
  - Ask whether a limit, for example "a rebuild may not add a knot", would have caught the one new knot.

### one-job-many-paths.md (paper, v1, grounded at a052a5dd)

- **Claim:** one decision gets made in several places because a new task adds a path without retiring the old one. "The useful unit of consolidation is not the file or the endpoint, but the decision: one authority, reached by every caller."
- **Remedy already in history:** delete the competing implementation and test the real entry paths against the survivor. Not another review stage.
- **Rebuild link:** LIN-3592 (three dispatch entrances) is the test case. It shared pure helpers but "each entrance keeps its own reads, enqueue calls, credential mints, gates and replies, because the source-text censuses pin them by the route they sit in" (`lib/dispatch-entrance.js` header). The verbatim share was 86%. Count whether a rebuild leaves one authority or three.

### paid-where-written.md (essay, v2; independently checked)

- **Claim:** a fix written into code is paid once. A fix written into a prompt, rule or review ledger is paid on every run, so prose fixes ratchet upward.
- **Remedy:** a steady base with byte budgets whose overflow must go into code.
- **Measure:** the rule-bearing share of what a worker carries (about 3%), plus behavioural costs.
- **Rebuild link:** this is decision location in the process, not the code. A rebuild ticket's own rules (pinned lines, done-when) are paid on every rung. Count ticket rule bytes and source-text pins per rung beside the code delta.

### where-judgement-happens.md (paper, v2), with what-the-selector-needs.md and prompt-kinds.md

- **where-judgement-happens:** 260 coded decisions on 36 changes. 61% need context reasoning, 31% a cheaper step, and 8% a stated rule over observable state, which a program could make.
- **what-the-selector-needs:** misroutes come from the facts computed in code and the stage descriptions. Four fixes at the cause put 82 of 90 decision points right, against 39 of 90 on main.
- **prompt-kinds:** the decision tree is "written as a lifecycle".
- **Shared idea** (and CLAUDE.md's invariant): rules written once and facts computed in code.
- **Rebuild link:** a design-first rebuild's requirements doc is where decisions get written once. A measure is how many of a module's branches become declarative tables or lists. `dispatch-entrance.js`'s `firstFailure(checks)` is an example, and so is kpi-stats's "one shared builder" for five derived fields (NOTES.md, rung 6b).

### rebuild-ladder.md (paper, v1, grounded at 350242d5; unchecked)

- **Claim:** design-first rebuilds up to about 930 lines over two files come out flatter, with no visible regression. "Source-text tests were the main constraint."
- **Measure:**
  - code lines, decision points, worst function and independent replay;
  - in NOTES, the verbatim share as well.
- **Rebuild link:** it already measures decision *count* (decision points) but not decision *location*.
  - The second write-up can add: sites per decision, knots tied or untied, entry files, and pins that fix a decision to a file.
  - On those measures, this round moved complexity a lot (−18.6% decision points in rebuilt files) and moved location barely at all (0 knots untied, 1 tied, 0 named-decision sites changed).
