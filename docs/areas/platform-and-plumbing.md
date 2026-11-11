# Platform & plumbing

Area notes for `platform-and-plumbing` in the registry. Format and rules: README.md.

## Lessons

- A browser library served from `node_modules` is audited at the version the lockfile
  resolves, not at the version its bundle embeds. `lib/vendor-assets.js` serves the
  Chart.js bundle, which inlines `@kurkle/color` 0.3.2 while the lock
  installs 0.3.4, so `npm audit` checks a copy the browser never runs. When you change what
  this file serves, check the embedded versions in the served file (its banner and inlined
  dependencies), not only `package-lock.json`. (Dependency & Supply-Chain Review, 10 Nov.;
  `docs/reviews/dependency-supply-chain-review-2026-11-10.md`)

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
- `lib/secret-scan.js`: shapes still unmatched beyond the ticketed four: quoted or YAML/JSON secret assignments, env values holding `/` or `.`, credentialed postgres/redis/mysql URIs, a cut PEM inside a blockquote or JSON string, PuTTY keys; Slack tokens are only partly masked. No census pins mint sites, so a new raw random credential would mint unprefixed and unscanned: mint through `lib/harbour-token-format.js`. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `lib/scheduler.js`: its "(e) error containment" unit test sleeps 300 ms of wall clock for
  several 30 ms ticks; under load it fails with the message of the defect it guards (the interval
  stopped after a throw), and a whole-run re-run turned it green. Count ticks or drive a fake clock.
  (Test Coverage Gap Review, 11 Nov.; `docs/reviews/test-coverage-gap-2026-11-11.md`.)
