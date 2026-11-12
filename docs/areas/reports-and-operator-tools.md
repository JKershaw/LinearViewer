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

## Waiting

- `scripts/stability-measures.mjs`: the runner's Waiting reads `not measured: runner checkout
  older than head` whenever the runner has had no commit since the head landing, even when the
  checkout is current, since only the tip's time is compared. A review run at HEAD will often hit
  it; settling it needs the runner fetched first or its upstream compared. (LIN-4420 leftovers.)
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
- `lib/account-erasure.js`: the shared anonymisation's `arrayFilters` is unasserted for other
  accounts: a filter matching every element (so every `trimHistory` `by` in a row naming the
  erased account, a co-member's included, becomes `erased`) passes all 407 tests. Assert that a
  co-member's entry survives. (Test Coverage Gap Review, 11 Nov.; `docs/reviews/test-coverage-gap-2026-11-11.md`.)
