# Reports & operator tools

Area notes for `reports-and-operator-tools` in the registry. Format and rules: README.md.

## Lessons

- A measure whose source is missing or unreadable reads `not measured: <reason>`, never 0;
  zero is a reading only from a source that was read (a commit with no notes directory has 0
  Waiting entries). New stability rows use the row shape in `scripts/stability-measures-core.mjs`
  (measured, partial with its unreadable count, not measured) and count Waiting entries with
  `countWaiting` from `lib/prompts/area-note-format.js`, never a regex of their own (LIN-4420).
- Churn passes `--diff-merges=first-parent` explicitly: with merge diffs off, the 8 Nov window's
  14 merge landings vanish and churn reads a plausible 8,590 / 3,055 instead of 10,235 / 3,677.
  Filter its paths with the kit's `compileScope`, not a git pathspec, so churn and line totals
  share one scope (LIN-4420).
- A landing names only its own ticket (`ownTicket` in the core: first id in a squash subject,
  else the merge's branch, else its PR title). Whole-message matching read 163 tickets in the
  8 Nov window against 106 and gave precedents fake last landings. A session is a `/cost`
  lineage, not a non-wake row (LIN-4393: 14 rows, 5 wakes, 8 sessions). Proxy reads go
  through `createProxyClient` in `scripts/stability-measures-tracker.mjs` (paced, honours
  429 `Retry-After`), and a null `totalUsd` keeps its cause apart from a failed read (LIN-4421).
- An issue-number search needs a known existing upper bracket: past the maximum is a 404 too,
  and a trashed issue is a 200 with `trashed: true`. Both count as gaps (LIN-4421).
- Finished tasks are read from the window's landings plus `--lookback-days` (default 3) before
  base, not all of history: a task whose only landings predate the lookback and that finished
  in the window is missed. The bound is printed on the `tasks` row; widen it there, never by
  matching more of each message (LIN-4421).
- "Went blocked" is any `[blocked]` feedback entry (`WAKE_FEEDBACK_REGEX` with
  `isWaitingWakeMarker`), never `status` or `deriveBlockedStatus`: both read only the last
  marker, so a lineage that blocked and then finished reads unblocked. Read every member
  `/cost` lists, not roots: on LIN-4393 each member's own resume lines were missing from
  its root's merged read. `dispatchedBy` is never origin (one account for autopilot and
  person), and `/rulings` returns loop rulings only (LIN-4422).
- Measure 1 has one source, the pre-merge `## Blind read`: a landing counts as read only when a
  read naming its PR was posted before its merge, matched through `landingPrUrls` and
  `parseBlindRead` from `lib/run-ledger.js`, never a parser of its own; anything else is
  unread under a named reason. A hand-run Balance cell becomes a sign only in
  `docs/papers/harbour/cleaner-than-it-started-scripts/balance-sign.mjs`, beside the paper's
  coder, which must reproduce both frozen codes files (LIN-4439).
- A landing's subject is read through the core's regexes only: `MERGE_PR` gives a merge landing
  both its branch (`ownTicket`) and its PR number (`landingPr`), so the two never parse it apart
  (LIN-4439 leftovers).
- Rounding, the mean and percentages come from the core (`round`, `mean`, `percent`); a new
  stability module imports them, never re-spells `Math.round(x * 1000) / 10`. A landing or a
  commit is credited to one ticket only through `ownTicket`; `scripts/delivery-composition.mjs`
  uses it too since LIN-4422 (its weekly ticket counts since 1 Oct moved by 1 to 5: down in
  five weeks, up 1 in one) (LIN-4422 leftovers).
- A reference beside a live stability row comes only from a reading the tool wrote itself
  (`--as-reference <label>`) and reads back (`--reference`; `referencesFrom` refuses another
  scope), so both share one definition. The ask's per-day 8 Nov figures stay quoted in
  `docs/reviews/stability-measures/README.md`, never in a reference slot. Rows a starting point
  never had are written `no <label> reading`, not read today and passed off as then, and the
  README names every field a re-run may change; a new live field joins that list (LIN-4423).
- The CLI's own reads are tested end to end in `tests/unit/stability-measures.test.js` on
  fixture repositories (`makeRepo`), with a stand-in `gh` first on PATH and a loopback
  stand-in proxy; a new read gets a case there, not only a hand run. On git 2.46
  `--first-parent` already gives first-parent merge diffs, so dropping the explicit
  `--diff-merges=first-parent` passes the test there; keep the flag for older git (LIN-4423 leftovers).

## Waiting

- `scripts/stability-measures-tracker.mjs`: `createProxyClient` is the one proxy client in
  `scripts/` that paces from the start and honours 429 `Retry-After`. The other 47 scripts that
  read the proxy pace by fixed sleeps (`scripts/pipeline-churn.mjs` sleeps 1.1 s, and 5 s × attempt
  on a 429; the `steady-base-*` and `survey-*` scripts likewise), so the rate rule is spelled two
  ways. One shared client under `scripts/lib/` would retire the copies. (LIN-4421 leftovers; Survey global.)
- `scripts/stability-measures-seat.mjs`: the person's seat reads loop rulings only and cannot
  read person origin, so its operator-free share is an upper bound. Two proxy reads would
  make it whole: an origin field on the dispatch read (the server records it as press
  events in `lib/task-mode-store.js` and `personOriginated` in `lib/dispatch-wake.js`), and
  a read of resolved task-bound rulings (or of `computeEscalationKpis` itself, which already
  reads both halves). Whether a parent's rulings count against its pieces is LIN-4399's
  call. (LIN-4422; LIN-4399 plan review note 1; Survey open-0.)
- `scripts/stability-measures-tracker.mjs`: `readSeat` reads every lineage member's detail,
  one call each: 1,576 members for the 106 finished tasks of the 8 Nov window, about half
  an hour at 50 a minute. A dispatch-detail read by issue or by lineage that returns each
  member's own feedback would cut that to one call per task. (LIN-4422; Survey global.)
- `lib/account-erasure.js`: each collection should be declared once with all its facts
  (name, store module, erasure row, urlKey class, dry-run shape), and opening an
  undeclared name should fail. LIN-4234 gave both guards one source of collection names;
  the other facts still sit in separate tables. Route counts are also pinned by hand in
  several tests. (Survey tally: LIN-4168, LIN-4179, LIN-4198, LIN-4234.)
- `lib/pricing-conformance-sweep.js`: the name says "conformance", but since LIN-4358 there
  is no rate table to conform; the sweep checks that the catalog's prices parse, that models
  in use are priced and that the choice lists name listed models. Renaming moves the
  scheduler job name (its `scheduler-locks` doc), the server.js registration, the
  scheduler census and `docs/architecture/source-map.md`. (LIN-4358 leftovers.)
- `scripts/stability-measures.mjs`: its declaration's contract
  (`docs/reviews/stability-measures/README.md`) is checked from two files. The `DECLARATION`
  block in `tests/unit/stability-measures.test.js` checks that it names every row the tool emits;
  a LIN-4424 test in `tests/unit/periodicals.test.js` reads the same README again to check it
  carries each element the shared Stability prompt asks a declaration for (including the literal
  `node scripts/stability-measures.mjs`), so a prompt-template test depends on one repo's docs
  file. Moving that check into `tests/unit/stability-measures.test.js`, beside the rest of the
  contract, with the prompt's element list exported for it, would give the contract one home.
  (LIN-4424 blind read.)
- `scripts/stability-measures-core.mjs`: `landingPr` reads which PR a landing merged, but the
  survey scripts tell a squash landing by their own trailing-`(#N)` test
  (`scripts/survey-growth-git.mjs`, `scripts/survey-halving-git.mjs`,
  `scripts/survey-tests-friction-git.mjs`), so the rule is spelled four ways. Importing
  `landingPr` would make it one, at the cost of re-checking their frozen survey counts. (LIN-4439 leftovers.)
