# Wiring

Area notes for `wiring` in the registry. Format and rules: README.md.

## Waiting

- `server.js`: test scaffolding in product code. Under NODE_ENV=test it seeds the catalog
  from `tests/fixtures/openrouter-models-2026-11-08.json`, `scripts/replay-brief.mjs` calls
  `_resetCatalogCacheForTests` (`lib/openrouter-catalog.js`), and two pinned catalogs are
  kept: `tests/fixtures/openrouter-models-2026-11-07.json` is read only by
  `tests/unit/stream-chat-whole-or-loud.test.js`. A catalog-source option on the product
  side would replace the test hooks. (Area reads CG/CH, 8 Nov, on LIN-4358.)
- `server.js`: the app-wide JSON and urlencoded body parsers accept compressed
  request bodies (body-parser's default `inflate: true`). No first-party client sends
  compressed bodies, so `inflate: false` on those parsers is a small parser-hardening move.
  The package advisory is tracked on LIN-620 and is not repeated here. (Dependency &
  Supply-Chain Review, 10 Nov.; `docs/reviews/dependency-supply-chain-review-2026-11-10.md`)
