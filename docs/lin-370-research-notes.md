# LIN-370 — Comprehension-Debt Review Periodical: Research Notes

## Status

Research grounding for LIN-370 (a child of the LIN-367 grounding,
[`docs/lin-367-research-notes.md`](./lin-367-research-notes.md)). The goal is the
**minimal, codebase-grounded approach** for adding a sixth-class review template —
*Comprehension-Debt Review* — to the existing periodicals system, with the
cold-hand-off standard and anti-padding constraints kept front of mind. This note
exists so the implementation step inherits a verified picture rather than the
ticket's (and LIN-367's) pre-LIN-386 prose.

## Re-grounding / staleness check (the one that matters)

The ticket and the LIN-367 notes were both written on **2026-06-10**. Since then
**LIN-386 landed (2026-06-11, commit `4b1592c`)** and changed the periodical
contract out from under them:

- **Old contract (what the ticket/notes describe):** Stage-2 task *proposes* follow-ups
  but does not create them, and is left **In Progress**.
- **Current contract at HEAD (LIN-386):** the minted review task **self-concludes** —
  mints a *bounded* (~top-3 by severity) set of follow-up tasks itself, posts a
  severity-ranked summary comment, and **moves itself to Done**. A review task left
  open is re-recommended for `review` forever (the bug LIN-386 fixed).

The new template MUST follow the self-conclude contract. The shared-contract test in
`tests/unit/periodicals.test.js` (the `shared two-stage contract (all periodicals)`
describe loop) now enforces this for *every* registry entry automatically, so a new
template that copies the current scaffold verbatim is covered without bespoke work.

`lib/periodicals.js` and its test were re-read at HEAD (`4b1592c`); the LIN-386 +
LIN-369 deltas are the only changes since the ticket, and both are already reflected
in the scaffold a new template would copy. No other ticket-referenced surface changed.

## The codebase as it stands (verified)

- **Adding a periodical is a documented, seam-ready operation.** `lib/periodicals.js`
  carries an explicit *"ADDING A NEW PERIODICAL (LIN-369)"* checklist (write
  `generate<Name>Prompt()` repeating the shared Stage-1 scaffold **verbatim**, add a
  registry entry, keep it implementation-agnostic, name the altitude difference, update
  the test count + id/title map, spot-check the repo first). The six existing builders
  *intentionally* repeat the scaffold rather than share a helper — an in-code NOTE says
  "Factor a helper later if the contract stabilises." So this is append-only by design.
- **A periodical-report convention exists** for the executor to discover at run time:
  `docs/reviews/` (e.g. `docs/reviews/drift-coherence-review-2026-06-10.md`). The
  template must NOT bake this in (the test forbids file literals / baked report
  locations), but its existence means the first run produces a real baseline, not a
  blocked no-op.
- **The finding class is real (checklist item 6 confirmed).** 51 of 66 `lib/` modules
  cite a `LIN-` ticket in comments. That heavy ticket-citation culture is itself the
  central comprehension-debt signal: a bare `(LIN-369)` tag near non-obvious code is
  exactly the ticket's second criterion — *"the only explanation lives in closed Linear
  tickets or merged PR bodies rather than near the code."* Large modules with
  non-obvious behavior and thin in-code rationale exist today (e.g. `swim-graph.js`
  ~141 lines / ~0 rationale markers; `roadmap.js`, `swim-lanes.js`, `ship-layout.js`
  carry heavy layout/algorithm logic). First run will find a genuine baseline.

## Feasibility: identifying the risk signals without breaking anti-padding

The ticket names three risk signals. Each maps cleanly onto the existing scaffold's
report/severity machinery, and each has an anti-padding counterweight already idiomatic
to the periodicals:

| Risk signal (from ticket) | How the template frames it | Anti-padding counterweight |
|---|---|---|
| Behavior non-obvious & no doc/comment/ticket explains *why* (constraint-comments, not what-comments) | A finding is a **load-bearing, non-obvious decision** whose rationale is unrecoverable from code + local docs | Self-evident code needs no rationale; restating *what* is itself a finding, never a fix |
| The only explanation lives in closed tickets / merged PR bodies, not near the code | Treat a bare ticket/PR reference next to non-obvious code as the debt signal — the *why* is offsite | A reference that already paraphrases its constraint in-code is **not** debt |
| A newcomer could not safely modify the module (cold-hand-off standard) | The verdict test: *could a cold reader change this module without silently breaking an unstated constraint?* | If a cold reader can, there is no debt — a clean module is a valid result |

Output requirement (ticket): mint tasks to **capture missing rationale where the risk
is real**, guarding against doc-inflation. This is the same shape as the Documentation
Review's "treat unjustified doc growth (inflation) as a finding in its own right" — the
fix is a *minimal constraint-comment / why-note near the code*, never net-new prose, and
the bounded-follow-up cap (~3) + "err toward under-creating" already in the scaffold
pace the queue.

## The cold-hand-off standard (terminology reconciliation)

The ticket says the Documentation Review periodical "already uses" a **cold-hand-off
standard**. There is no literal `cold-hand-off` string in the code; it maps to two
existing phrases the new template should echo:
- the universal scaffold closer — *"specific enough to this codebase to run cold"*;
- Documentation Review's README bullet — *"does a newcomer get oriented fast, without
  drowning?"*.

So the comprehension-debt review's central test ("could a newcomer safely **modify**
the module") is the *modification*-altitude sibling of Documentation Review's
*orientation*-altitude newcomer test. Same standard, one altitude deeper.

## The one structural constraint: altitude vs. Documentation Review (avoid double-flagging)

This is the only real design tension, and it is the same shape as how Drift & Coherence
(LIN-369) had to carve itself away from Code Quality. **Documentation Review already
flags** "*inline comments — do they explain **why** rather than restate **what** — flag
both non-obvious code missing rationale and stale/misleading comments*." That overlaps
the comprehension-debt remit at the line/comment altitude.

The clean separation (which the template must state explicitly, per checklist item 4):

- **Documentation Review** works at the **doc-surface / per-comment** altitude: is *this
  comment* accurate, present, why-not-what? Line-level hygiene.
- **Comprehension-Debt Review** works at the **module / system** altitude: can a cold
  reader reconstruct *why this module is shaped the way it is* — the load-bearing
  constraints and design decisions whose only record is offsite (closed tickets, PR
  bodies)? It is about **rationale reconstructability of the whole unit**, not the
  accuracy of any one comment.

The template should name Documentation Review by title and say it does not re-flag a
missing single why-comment that review owns — it flags a module whose *design rationale*
is unrecoverable. (This mirrors Drift & Coherence's "do not re-flag what the Code Quality
Review owns" sentence.)

## Surface Assessment

**Verdict: refactor NOT required — this lands cleanly on the existing seam.**

- **Consumer test:** the only consumer in this ticket's implementation path is the
  `PERIODICALS` registry array, which already takes `{ id, title, mode, cadence,
  lastRunAt, generatePrompt }` entries. Adding a seventh entry + a new
  `generateComprehensionDebtPrompt()` is the documented append path; no existing
  signature changes.
- **Who-pays test:** no bystander is taxed. The other five (six) prompt builders, the
  renderer (`buildPeriodicalNodes`), and `lib/render.js` are untouched. Only the test's
  registry-count (`6 → 7`) and id/title map change, plus an optional specifics block —
  exactly the checklist's step 5.
- **Improvement noticed, not required:** the in-code NOTE flags that the six builders
  duplicate the Stage-1 scaffold and a helper *"later if the contract stabilises."*
  Extracting that helper now would touch all existing builders (bystander tax) and the
  code itself defers it — so it is explicitly **out of scope** for LIN-370. Add the
  seventh by copying the scaffold verbatim, consistent with the established pattern.

No new file, module, route, store, or dependency is needed.

## Recommended approach (minimal, for the implementation step)

1. Add `generateComprehensionDebtPrompt()` to `lib/periodicals.js`, copying the current
   (post-LIN-386, self-conclude) Stage-1 scaffold **verbatim**. Bespoke parts only:
   - orient sentence: orient to the modules with non-obvious behavior and where design
     rationale is/should be recorded (discover the convention, don't assume);
   - the "Run the review" bullet built around the three risk signals + the cold-reader
     *modification* verdict test, framing the fix as a **minimal constraint-note near the
     code**, never net-new prose (anti-inflation);
   - one sentence naming the altitude difference vs. **Documentation Review** (it owns
     per-comment hygiene; this owns module-level rationale reconstructability — don't
     double-flag).
   Keep the shared bullets (read prior runs, uncapped report, bounded ~3 follow-ups,
   self-conclude + summary comment + close, review-only, run-cold closer) byte-for-byte.
2. Registry entry: `{ id: 'comprehension-debt', title: 'Comprehension-Debt Review',
   mode: 'corrective', cadence: 'weekly', lastRunAt: null, generatePrompt }`.
3. `tests/unit/periodicals.test.js`: bump the count (`6 → 7`), add `'comprehension-debt':
   'Comprehension-Debt Review'` to the expected id/title map, and (optional) a small
   specifics block asserting the bespoke language (cold reader / modify, rationale,
   non-obvious, names Documentation Review, anti-inflation). The shared-contract loop
   covers the rest automatically.
4. Do **not** add a helper, a report-location literal, proxy mechanics, or any `.js`
   file literal to the prompt — the shared-contract test (`stays general`) will fail.

## One-line summary for the next action

Append a seventh self-concluding periodical (`comprehension-debt`) that copies the
current scaffold verbatim and adds only: the three risk signals, the cold-reader
*modification* verdict test, a minimal-constraint-note (anti-inflation) fix framing, and
an explicit altitude split from Documentation Review. Refactor not required; the
scaffold-duplication helper is a noticed-but-deferred improvement, out of scope.
