# Platform & plumbing

Area notes for `platform-and-plumbing` in the registry. Format and rules: README.md.

## Waiting

- `lib/db-indexes.js`: one shared in-memory collection fake that knows these semantics
  (unique indexes among them). Today `memoryCollection` in
  `tests/unit/helpers/routing-fakes.js` sits beside `fakeCollection` in
  `tests/fixtures/cost-replay/harness.js`, and the "copy fails once" store is written
  inline in several tests. The fake DOM half of this landed as
  `tests/unit/helpers/fake-dom.js`. (Survey tally: LIN-4177, LIN-4178, LIN-4241.)
- `lib/deploy-info.js`: merged to live is not owned in code (no deploy job or Railway
  config in the repository); John holds Railway today. A no-secret "did it go live" check, reading
  the deployed commit, is a candidate on its own. (Survey tally: LIN-4167.)
