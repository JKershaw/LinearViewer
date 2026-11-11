# Reports & operator tools

Area notes for `reports-and-operator-tools` in the registry. Format and rules: README.md.

## Waiting

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
