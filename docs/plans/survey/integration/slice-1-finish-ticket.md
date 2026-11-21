**Title:** Layer slice 1, finished: the last traces of what it retired go, in code, tests and saved cases

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Slice 1 (LIN-4491) moved hand-offs onto records and retired the routes they used: the Waiting lists, the `Retires:` conveyor, the run ledger's count, and more (the design's slice table, row 1). It landed and works. A read-only check on 21 Nov found traces of the retired routes still in the code, the tests and the saved test cases, with nothing planned to remove them. John: the work should be completed correctly, not patched.

**Known traces** (where to start, not the whole list):
- `ANY_EXTENSION` in `lib/prompts/area-note-format.js`, with a comment about "the retirement-line checker". That checker went in LIN-4495. Only `tests/unit/lin-4470-note-leaves.test.js` still uses it (census C1-17).
- `tests/fixtures/leftover-answers/lin-4393-review.json` and `lin-4415-builder-answer.json`: saved answers in the retired `### Leftovers` / `Retires:` shape, which nothing reads.
- The ledger-count shape (`openItems`, with inside/outside/unknown) is still written by `lib/close-out-merges.js` and `lib/close-out-events-store.js`, as zeros or `unknown`, beside the new `openFindings` (C1-29, C1-30). The stated reason is old stored events, and some readers still use the field.
- `legacyLedgerOf` in `lib/close-out-findings.js` (five callers), with `LEDGER_HEADING` in `lib/run-ledger.js`, still recognises the pre-cutover `### What CI Did Not Prove` heading, so close-out holds on old reviews (C1-26).

**What we want.**
- Everything the slice table lists as retired for slice 1 is gone: from the code, the tests, the saved test cases and the scripts. Check the whole row against the census sites, not only the traces above, and report what you checked.
- Where something still depends on a retired thing (old stored events, old reviews), move it onto the right data, rather than keeping a reader of the old shape. A one-off change to stored data is fine; production is reachable as the standing answers say.
- Tests and saved test cases are part of the work. Convert them to the new shape, or delete them if nothing needs them. No translators, no stopgaps.
- If a retired thing is also used by what slice 3 is still moving (for example the ledger parse, which slice 3's P5 branch uses), say so in a finding to LIN-4520 rather than leaving it unnamed.

**Not in this ticket:** slice 2's traces (a separate ticket follows); slice 3's comment paths, which LIN-4520 removes; anything the slice table keeps until a later slice.

**Done when**
- a search for each name retired in slice 1's row finds nothing outside `docs/`, or each hit is reported with the reason it stays and the ticket that ends it;
- no stored-data reader of a retired shape is left;
- the unit and e2e suites are green;
- Harbour still works for every route.

**Where to read:** `docs/plans/survey/integration/design.md` §10 (row 1) and `docs/plans/survey/integration/census/` on branch `claude/cool-rubin-6acj5j`.

**John's answers to questions that came up in earlier slices:**
- Retire everything the design's slice table lists for this slice. Don't keep slimmer versions of retired things.
- If something else depends on what's retired, move it onto the right data rather than keeping the old thing.
- Tests and saved test cases are in scope. Move them to the new shape in the same piece; no translators or stopgaps, in code or tests.
- Production is reachable: use `railway ssh` into the harbour-cat container (`railway run` can't reach the database). Never print the production environment.
- If you need the fleet paused for a cutover, say so; the driving session sets and clears it.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
