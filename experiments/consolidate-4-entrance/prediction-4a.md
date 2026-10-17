# Experiment 4a: convert the dispatch entrance's source-text pins, prediction (written before launch)

**Baseline** (d349e78c, from `inventory.md`):
* 35 unit-test files read the entrance set E as text: `routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js` and `lib/dispatch-entrance.js`.
* 63 test-level pins in 18 of those files key on E. The other 17 files are whole-tree scans.
* By class: A 26, B 20, C 17.
* With the three routers' bodies moved into `lib/dispatch-entrance.js` (the move probe), 37 tests in 11 files fail.

For comparison, rung 4 converted 4 assertions, each shown failing with its guard removed (PR #1899, `experiments/rebuild-exp2/NOTES.md:399`). 4a is about ten times that, with no rebuild attached.

## What the worker delivers

**Classification**
* The worker's own count lands near mine, within ±6 per class: A 20–30, B 15–25, C 15–20. Whole-tree scans stay untouched.
* It finds at least one pin I missed, or drops one I listed, in 60% of runs. The likeliest disagreements:
  * lin-3134's C2(iii) witnesses: A or B?
  * the registration-level pins: C or B?

**Tests added**
* 5–8 new behaviour groups, matching N1–N7 in some packaging; 30–70 new test cases in total.
* 1–3 new test files; 12–16 existing test files edited.
* At least one route sweep enumerates `router.stack`: 75%.
* All three sweeps (redaction canary, proxy grant, session owner) are present: 50%. The session-owner sweep is the likeliest to be dropped or narrowed to a hand-written list, because driving 26 session routes past validation is the most fixture work.

**Production lines changed:** 0, at 95%. Any non-zero diff is a test-only export or a comment, never logic.

**Mutation evidence**
* A failing-then-passing record exists for every A conversion: 60%.
* It exists for every security-relevant A conversion (lin-3383, lin-3134, lin-3136, lin-3137, lin-3384): 75%.
* The likeliest gaps are the six C2(iii) indentation-keyed witnesses, recorded as a group rather than one by one.

**Security guards**
* No security guard ends weaker by its own witnesses: 85%.
* At least one security pin stays B because behaviour can't express it: 90%. `proxy-scopes`' `READ_WRITE` constant versus literal is the near-certain one.
* At least one count inside E is kept rather than loosened to ≥1, "to be safe": 65%. Each one kept partly re-pins the structure 4b has to change.

**Probe re-run.** The PR shows a move probe after the change, with zero A/B pins failing: 40%. The ticket asks for it, but the probe has to be rebuilt from the description.

## Run

| Outcome | Estimate |
|---|---|
| One PR, not split | 80% |
| Merged | 75% |
| Done without a `DECISION:` | 60% |
| Wall time | 2.5–5 h (median 3.5 h) |

A ruling is most likely asked for on one of these:
* replacing an assertion in `lin-3134-default-path-characterization.test.js`, whose header (:1-34) promises it stays unedited;
* loosening counts in a security census.

Wall time: rung 5c took 106 min for a rebuild with no conversions. Here the cost is fixtures and mutation runs (about 45), not design.

Unit-suite time rises by under 5 s; the sweeps are in-process HTTP against fakes.

## What would surprise me
* A converted pin that turns out vacuous: the behaviour test still passes with the guard removed. 25% that review catches one. The likeliest is the N5 limiter case. It can pass for the wrong reason: a 429 left over from an earlier test sharing the module-scope limiter's memory store, or a `workspaceFromUrl` spy that was never wired in.
* The worker changing a route file "to make a seam testable". 5%, and it would breach the ticket.
