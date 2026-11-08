# Reports & operator tools

Area notes for `reports-and-operator-tools` in the registry. Format and rules: README.md.

## Waiting

- `lib/account-erasure.js`: each collection should be declared once with all its facts
  (name, store module, erasure row, urlKey class, dry-run shape), and opening an
  undeclared name should fail. LIN-4234 gave both guards one source of collection names;
  the other facts still sit in separate tables. Route counts are also pinned by hand in
  several tests. (Survey tally: LIN-4168, LIN-4179, LIN-4198, LIN-4234.)
