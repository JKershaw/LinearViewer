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
- A served-path boundary (`lib/vendor-assets.js`) is tested two ways, never by a probe list alone. Its structure: the
  router holds exact routes only, one per allow-listed URL, with no `use()` mount. And raw requests: `fetch` collapses
  dot segments before it sends, so a traversal probe over `fetch` really asks for the root server.js and proves nothing.
  `tests/unit/shared-modules.test.js` sends them with `node:http`. LIN-4471's review found that a static mount of the
  repo root passed every probe the list did not name; the structure test is what catches it.
