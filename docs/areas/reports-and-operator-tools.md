# Reports & operator tools

Area notes for `reports-and-operator-tools` in the registry. Format and rules: README.md.

## Lessons

- A measure whose source is missing or unreadable reads `not measured: <reason>`, never 0;
  zero is a reading only from a source that was read (a commit with no notes directory has 0
  Waiting entries). New stability rows use the row shape in `scripts/stability-measures-core.mjs`
  (measured, partial with its unreadable count, not measured) and count Waiting entries with
  the frozen reader `countFrozenWaiting` in `lib/records/waiting-import.js`, never a regex of their own (LIN-4420; LIN-4495).
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
  `parseBlindRead` from `lib/run-trail.js`, never a parser of its own; anything else is
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
