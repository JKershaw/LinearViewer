**Title:** Finish layer slices 1 and 2: remove what they left behind

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Slices 1 (LIN-4491) and 2 (LIN-4499) moved hand-offs and plans onto records. Both work, and nothing they left behind has harmed real work. But each left pieces of the old way in place, in the code, the prompts, the tests and the saved test files, and nothing was scheduled to remove them. Several are already open findings. John wants the work finished properly, not patched, before slice 3 continues.

**What's known to be left** (a read-only check on 21 Nov; treat it as where to start, and check the slices' whole lists yourself):

From slice 1:
- The autopilot kickoff prompt (`lib/prompts/autopilot-kickoff.js`, around lines 433 and 573) still tells agents to report "its `### What CI Did Not Prove` ledger", and says review writes it and close-out reads it. Neither is true any more.
- `legacyLedgerOf` (`lib/close-out-findings.js`), with the ledger section check in `lib/run-ledger.js`, still recognises the old ledger section on a review, so close-out can hold on it. It now fires only on Done tasks. Slice 1's list retires this (census C1-26 and C1-28 to C1-31).
- The task page's run evidence (`lib/render-run-evidence.js`) still shows the old ledger box.
- Close-out events still write the old `openItems` counts beside `openFindings`, and nothing reads them (finding-5b2fe3b2).
- `ANY_EXTENSION` in `lib/prompts/area-note-format.js`, left from the retired leftovers checker. Only one test uses it.
- Saved test files in the retired shapes: two in `tests/fixtures/leftover-answers/` that nothing reads, and others under `tests/fixtures/` and `scripts/eval/`.
- The slice 1 test that fails on retired words (`tests/unit/lin-4495-retirement-census.test.js`) doesn't list `### Leftovers` or `What CI Did Not Prove`. That is how these got past it.

From slice 2:
- `lib/asked-of.js` and `lib/legacy-plan-text.js` still read the old `## As asked` block and old plan headings. The design keeps the brief's ticket section until slice 4. But these also feed things slice 4 won't remove: a new task's `asked`, the size record, the selector view, and the refusal of plan headings. Open findings: b559517b (a pasted brief quote can be read as a task's `asked`), 4657b715 (the brief's hint still names the retired block), 987a7853 (a duplicate plan-heading pattern).

**What we want.**
- Everything slices 1 and 2 retired is gone: from the code, the prompts, the tests, the saved test files and the scripts. Prompts say what is true now.
- Where something still depends on a retired thing, move it onto the right data, rather than keeping a reader of the old shape. For slice 2, a task's `asked` and the size record should read records, not the old block. Keep only what the design itself keeps until slice 4, the brief's ticket section, and name it plainly.
- This is code, prompts and tests only. The data moves were done in slices 1 and 2; nothing here needs production.
- Tests and saved test files are part of the work. A saved file is either converted to the new shape or deleted if nothing needs it. A helper that reads the old shape for the tests doesn't count as converting.
- Each slice's retired-words test lists every word its slice retired, so a leftover fails the suite.
- End the findings above that this work settles.

**Leave alone:**
- `tests/fixtures/walk-8/`: slice 3 depends on it as its reference.
- Anything slice 3 still has to move. The verdict and sha parsing in `lib/run-ledger.js`, the comment classifier (`lib/run-trail.js`) and finding-76683071 (LIN-2634 reads as "none open") belong to slice 3's P7, LIN-4520. Where slice 3's code still calls something this ticket removes (for example `scripts/records/slice-3-verdict-import.mjs` calls `legacyLedgerOf`), name it in a finding to LIN-4520 rather than breaking it.

**Done when**
- nothing slices 1 and 2 retired is left, outside what the design keeps until slice 4, and that one exception is named;
- the kickoff prompt no longer mentions the ledger;
- the retired-words tests list every retired word and pass;
- the unit and e2e suites are green, and Harbour works for every route.

**Where to read:** `docs/plans/survey/integration/design.md` §10 (rows 1 and 2) and `docs/plans/survey/integration/census/` on branch `claude/cool-rubin-6acj5j`.

**John's answers to questions that came up in earlier slices:**
- Retire everything the design's slice table lists for this slice. Don't keep slimmer versions of retired things.
- If something else depends on what's retired, move it onto the right data rather than keeping the old thing.
- Tests and saved test files are in scope. Move them to the new shape in the same piece; no translators or stopgaps, in code or tests.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
