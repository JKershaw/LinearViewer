---
title: Can chunks of Harbour be rebuilt from scratch safely, and how should a rebuild be run?
kind: paper
version: 1
date: 2026-10-16
authors: [Claude, for John Kershaw]
model: "Frontier tier, claude-code; one interactive cloud session with John Kershaw (the Flight Companion), not dispatched through Harbour (no dispatch id). The rebuilds themselves ran as Harbour tickets, whose stage models the dispatch lineage reports. The independent replays were built by in-session subagents and run in the main session."
grounded_at: 350242d5 (LinearViewer, origin/main)
cites: [experiments/rebuild-exp2/NOTES.md@38755a39 (and the additions in this PR), experiments/rebuild-exp1/results.md@38755a39, experiments/rebuild-exp2/results-2a.md@38755a39, experiments/rebuild-rung2/@38755a39, experiments/rebuild-rung3/@38755a39, experiments/rebuild-rung4/@38755a39, PR #1891 (2026-10-15), PR #1892 (2026-10-15), PR #1893 (2026-10-15), PR #1894 (2026-10-15), PR #1895 (2026-10-16), PR #1896 (2026-10-16), PR #1897 (2026-10-16), PR #1898 (2026-10-16), PR #1899 (2026-10-16), LIN-3549, LIN-3556, LIN-3557, LIN-3561, LIN-3564, LIN-3565, LIN-3566, LIN-3569, LIN-3570, LIN-3573, LIN-3574, LIN-3575, LIN-3576, LIN-3558, LIN-3568, LIN-1728]
---

# Can chunks of Harbour be rebuilt from scratch safely, and how should a rebuild be run?

Yes, up to the size tried so far: about 930 lines over two files. The method that worked is **design-first**: the
agent sees today's code, writes the requirements and a fresh design before any code, then builds. An
independent replay against the old behaviour, built outside Harbour, judges the result. Three design-first rebuilds
through ordinary Harbour tickets, four files in all, came out flatter: code down by up to 39% in a file, and the worst
function's decision points down by up to 43%. None had a user- or agent-visible regression, and every behaviour change
their replays found was a bug fix or server-log wording. A clean room, where the agent never sees the code, also
simplified, but it was unreliable: one of four samples on identical inputs changed what users see on a third of real
tickets. Along the way the rebuilds
found 9 bugs and 2 missing features in existing code; one of the missing features is used by a quarter of real
tickets.

## Findings

**Design-first rebuilds were the only arms both clearly cleaner and free of visible regressions.**

| Rung | Chunk | How | Code lines | Decision points | Worst function | Independent check | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1A | Jira codec `adf.js` | Informed rewrite (LIN-3556) | 322 → 302 | 153 → 142 | 28 → 26 | Equivalent on 59,718 calls | Merged; kept the old shape |
| 1B | `adf.js` | Clean room, outside Harbour | 322 → 275 | 153 → 127 | 28 → 24 | Many fixes; links with brackets displayed broken | Not merged |
| 2a | `adf.js` | Clean room through Harbour (LIN-3557) | 302 → 284 | 142 → 110 | 26 → 12 | Review caught 2 regressions; the bracket bug shipped | Merged; fixed in LIN-3561 |
| 2b | `adf.js`, 200-test contract | Clean room through Harbour (LIN-3565) | 318 → 297 | 129 → 134 | 12 → 24 | 280 real texts changed, all lists; net a fix, 2 worse | Merged |
| XS | `adf.js` | 3 more clean rooms, outside Harbour | 209–281 | 88–127 | 21–25 | 1 fine; 2 broke 317–345 of 1,037 real texts | Not merged |
| XS | `adf.js` | Design-first, outside Harbour | 318 → 199 | 129 → 90 | 12 → 22 | 0 real texts changed; 4 gate edge cases | Not merged |
| 2 | Roadmap page `render-roadmap.js` | Design-first (LIN-3566) | 375 → 364 | 115 → 88 | 34 → 22 | 0 differences on 8,210 inputs | Merged |
| 3 | Agent API read routes `proxy-reads.js` | Design-first (LIN-3569) | 448 → 378 | 98 → 72 | 31 → 22 | 0 agent-visible regressions on 6,000 requests; 3 fixes | Merged |
| 4 | Agent API write and rulings routes, 2 files | Design-first (LIN-3573) | 929 → 619 | 267 → 196 | 39 → 26 | Rulings identical; writes differ only by 2 fixes | Merged |

Code lines exclude comments and blanks. Decision points count every branch, loop and short-circuit, minus one per
function. Where the worst function rises (2b and XS), it is a single `switch` over node types, which this measure
counts case by case.

**What anchors an agent to the old code is the instruction, not seeing the code.** Asked to rewrite whole, the
agent kept the old structure and built a throwaway oracle to copy behaviour (1A). Asked to design first, agents that
saw the same code built new structures. Two arms, one design-first and one clean room, independently built the
Jira codec's gate by running the round trip rather than modelling the writer in tables.

**A clean room alone is a lottery.** Four samples ran on identical inputs (133 tests plus the comment spec). All
passed every test. Three changed the display of 1 real text; one (XS r2) changed 345 of 1,037. It lost 837 bold and
849 code spans, and its new `*italic*` parsing, partly a fix, left stray markers and broke links inside italics. A replay against the old code, with a display check on
real data, is mandatory.

**Check what users meet, not just round trips.** Every serious miss was a display problem the round-trip tests
could not see: links with brackets, and list and emphasis changes. Generated inputs missed changes that the sample of
real tickets found (rung 2b's 280 list changes; nested lists in 261 texts).

**The comments are part of the contract.** A clean room given the tests but not the comments broke headings and
lists on 317 real texts. A wrong comment led two clean rooms into the same bracket bug. A comment added later called
a display bug "accepted", which the next clean room would have read as spec.

**The rebuilds double as a bug-finder.** Writing requirements from the handlers, then replaying old against new,
surfaced the faults below. In rung 4, the one write handler that didn't follow the shared skeleton held both of its
bugs.

| Found | Where | Reach | Status |
| --- | --- | --- | --- |
| Nested lists flattened on save, and refused when stored in Jira (missing feature) | Jira codec | 261 of 1,037 real texts | Fixed, LIN-3570: 204 now keep their nesting |
| `*single-asterisk*` italics lost (missing feature) | Jira codec | 287 real texts | Fixed, LIN-3570: kept in 258 |
| Inline code with a backslash or backtick displays wrongly | Jira codec | 137 real texts | Fixed, LIN-3564: 8 remain |
| `*` bullets shown as one literal paragraph | Jira codec | 135 real texts | Fixed, LIN-3565 |
| A description write the provider reports as not landed returned 200 | Agent API writes | Any failed description edit | Fixed, LIN-3573: now 502 |
| A credential rejection on a description edit fell through to a generic 500, unlogged | Agent API writes | Rare | Fixed, LIN-3573 |
| A provider-access rejection on the attachments route fell through to a generic 500, unlogged | Agent API reads | Rare | Fixed, LIN-3569 |
| The attachments route checked capability before workspace availability, unlike the other 12 | Agent API reads | Expired session plus unsupported provider | Fixed, LIN-3569 |
| An upstream redirect was relayed as a 302 with no `Location` | Agent API reads | Can't arise in practice | Fixed, LIN-3569 |
| An empty fenced code block doesn't survive the round trip | Jira codec | Rare | Backlog, LIN-3558 |
| A code block containing a line of three backticks closes its fence early | Jira codec | Rare | Backlog, LIN-3568 |

The codec counts come from the private sample of 1,037 real ticket descriptions. They affect Jira-backed workspaces
only.

**Tests that read source text are the main drag on rebuilding.** Nine test files pinned literal strings or
registration counts in rung 4's routers. Four were converted to behavioural tests guarding the same thing, each shown
failing with its guard removed. The rest, including the absence scan that keeps agents from answering rulings
(LIN-1728), constrained the design as written (PR #1899).

**Harbour scales a rebuild by splitting it, and that costs wall-clock, not quality.** Single-file rebuilds of
300–450 lines took about 37–60 minutes from kickoff to merge. Rung 4 took 5 h 17 min. Harbour's plan split it into
three sequential children: the replay harness, the rulings routes, then the write routes and the PR. Two plan-review
rounds came first. The write-routes child then waited about 80 minutes, because the rulings child's close-out was held
on a record-only scope ruling (citation edits).

**Fresh-reader checks of each ticket paid for themselves.** Every draft checked had real traps:
- wrong claims about the code (an attachments "hang" that was really a generic 500);
- quotes stretched past their use;
- a helper filename that would crash a test census;
- module-level dedupe state that would have corrupted a replay (rung 4).

## Method

The ladder ran from 15 to 16 October 2026 on LinearViewer, each rung a little larger, as John Kershaw proposed. Success
was his: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively
simpler, less room for bugs, easy to maintain)." Each rung:

1. **Pick the chunk.** A narrow boundary: one export or one router factory, with injected dependencies and its
   decisions in comments. Measure its shape with `experiments/rebuild-exp1/kit/shape.mjs` (acorn).
2. **Build the independent replay first, outside Harbour.** Old and new run side by side on the same inputs:
   - inputs captured from the tests, 3,000 or more generated cases (seeded), targeted edge cases, and the private
     real-text sample where the module handles text;
   - clock, timezone and environment frozen;
   - comparison of responses, provider calls and arguments, store operations, logs, and display rendered through
     `marked`;
   - self-checks: old against old gives 0 differences, planted changes are caught, and line coverage of the old code
     is 95% or more (98–100% here).
3. **Commit a prediction** before launch.
4. **Write the ticket design-first.**
   - Order: the requirements list, then a fresh design, then the build, then the worker's own replay.
   - Name which source-text tests may be converted.
   - Classify differences as (a) fix, (b) regression, (c) bounded fuzz or (d) unclear, and name what is never fuzz.
   - No live checks, and no paid model calls.
5. **Run a fresh-reader check** of the ticket, by a subagent, and apply its findings.
6. **Launch through Harbour's autopilot** and merge as normal. Rulings are pre-filled for John to press.
7. **Score after merge** with the independent replay (two seeds) and the real-text check, against the prediction.

Clean-room arms instead ran a sealed sub-agent in a temporary folder holding only the tests and a comment-only
spec (one arm had the tests alone). Its transcript was audited for any read outside the folder: 9–16 calls per room, 0 violations. Every arm,
prediction, ticket, replay and scored report is on branch `claude/jolly-knuth-dgn3m1` under `experiments/`, with the
running record in `experiments/rebuild-exp2/NOTES.md`.

## Limits

- **Small samples.** Each design-first rung is one run on one module, so its results are not a rate. The clean room
  has four samples on one module.
- **A stand-in corpus.** The real texts are Linear descriptions, standing in for Jira content. Jira users may write
  differently.
- **Shared blind spots.** The replays' fakes are modelled on the real dependencies in `routes/proxy.js`, so a
  fault in that model is shared by old and new and goes unseen. Rung 4's worker built its own replay independently,
  which narrows this; its findings matched mine exactly.
- **A crude measure.** The decision-point count rewards splitting and penalises `switch` statements, so it tracks
  cognitive simplicity only roughly. No person has yet judged the rebuilt code against John's definition.
- **No independent author.** The same session designed the experiments, wrote the tickets and scored the results;
  the predictions were committed first to limit that.
- **Mixed models.** Harbour's stage models vary from stage to stage and were not held fixed.
- **Bounded fuzz.** Tickets after 16 October 07:00Z accepted listed fuzz on edge cases, at John's direction. Those
  differences are fixes or fuzz by the tickets' own classes, not by an outside standard.

## Next

- **Rung 5, the dispatch core** (`proxy-dispatch`, `proxy-kickoff`, `proxy-compute`; about 2,300 lines). It holds
  the worst functions left in the Agent API, at 93, 62 and 30 decision points. The ladder is paused before it,
  at John's request.
- **`proxy-tokens-admin.js` on its own,** with a security review, then the whole Agent API (about 6,500 lines), to
  see whether a rebuild in one go survives the way Harbour decomposes work.
- **A second codec spring clean:**
  - marks inside marks (code inside bold, a link inside italics; about 200 real texts);
  - `***` and `___` rules (89);
  - underlined headings.
- **A pipeline fix:** a record-only ruling, such as a scope question about citation edits, shouldn't hold a merge
  chain at close-out.
- **A person's reading of the rebuilt code,** to test whether it is cleaner in John's sense, not only by the count.
- One line goes into `proposals.md`: does a design-first rebuild's simplification hold at rung 5's size?
