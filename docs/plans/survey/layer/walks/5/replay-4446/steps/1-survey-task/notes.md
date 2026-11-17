# Notes: 1-survey-task (task-9 / LIN-4446)

**Written (all `in` task-9, all open unless noted):**
- run-10, run: added, revised (v2, account), ended `done`.
- finding-11 → scoping: imports aren't on; need a served place and a purity rule for shared modules.
- finding-12 → area-1: classic scripts and `common.js` globals block one-view-at-a-time; kept out of the slice.
- finding-13 → scoping: 130 vm-based unit tests assume classic scripts.
- finding-14 → review: "lighter" can be faked by cutting comments; count logic and commentary separately.
- finding-15 → implementation: per the-second-copy, delete the old copy and its parity test.
- finding-16 → scoping: the first move (the rule's reading, then the cost-format slice); `on` 11, 12, 13, 15.
- check-17 → John: read the first slice before the next.

Nothing ended or revised beyond my run. Nothing in the store was mine to close.

**Looked up:** `show --task task-9`, to see what already exists; `find --area area-1`, to see the area's findings; `get area-1`; `find --text` for cost-format, build step, common.js, restate, import and parity, to avoid duplicates; open runs on `public/`. finding-5 and finding-6 (shared-piece candidates) exist. I didn't link them, because my real output never used them.

**Refusals:** none.

**What my real output relied on that neither the brief nor a query gave:** every fact came from the repo at 4b5001ddf. That covers `server.js:1228`, the CSP, `lib/components/page.js`, the line counts of `common.js` and `observation.js` (total and comment lines), 68 commits, 130 vm test files and `client-world.js`, `the-second-copy.md` §9–10, `lib/cost-format.js` and its 4 consumers, `cost-read-census.test.js:85`, and `CLAUDE.md:43`.

**Brief carried but unneeded:** lesson-2 (poll discipline). The done-when appears twice.

**Couldn't place:** "why-person" on check is my guess at its meaning.
