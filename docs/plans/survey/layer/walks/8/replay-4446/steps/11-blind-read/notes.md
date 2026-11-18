# Notes: 11-blind-read (task-8)

**Written:** verdict-67 (blind-read, better) `on` change-52@3, to John. finding-68 and finding-69 (fix-sized test wording/export) to close-out, which owns change-52 before merge. finding-70 (shim is single-module, the timing rule is unguarded for new consumers; needs a design call) and finding-71 (ship.js / ship-biscuit.js still hand-synced) to project. run-72, ended done. Nothing was ended or handed on: nothing was addressed to blind-read, and close-out's records are still its own.

**Looked up:** `show --task task-8` for the change version and to avoid duplicates. `get change-52` to pin the head (1de016f52 = @3). `find --text` for ship/shim/CostFormat, to check overlap with finding-20/60/66. `find --kind verdict` for an earlier blind-read verdict (none). `find --to blind-read` (none). `get lesson-59` and `get finding-20` for the about links.

**Refusals:**
- `{"error":"field on does not belong to verdict"}`: links go in `"links":{"on":[…]}`. Fixed.
- `{"error":"body must be a JSON object"}`: my own shell glob mistake. Fixed.
- `{"error":"bad time: 2026-11-13T15:12:010.211Z"}`: my own counter bug. Fixed.

**Relied on outside the brief and queries:** the PR diff at 1de016f52 against 4b5001ddf. That covers the test titles and comments, `export const TABLE`, the `SHIM` constant in `tests/unit/shared-modules.test.js`, and the comments in `public/ship.js` and `public/ship-biscuit.js`. The area names (front-end-browser, other-features) came from the area notes on disk.

**Brief carried but not needed:** the whole plan-26 text, decision-29, finding-30, finding-55/64/65/66, finding-61, and the person's words about the views and side rail.

**Couldn't place:** the "Read: PR at X against Y" line has no field, so it went into the reasoning.
