# What this stage really wrote

## Departure comment on LIN-4445 at 14:08:01

## Session 1 (LIN-4450): where the code moved the plan

PR: https://github.com/JKershaw/LinearViewer/pull/2421. Built as planned (shape B, items 1–6), with these departures, each reasoned in the code:

1. **End-line choice is by digest, not by position.** The plan's "first end paragraph after the heading" fails when the words hold the end sentence as plain or `_…_` text: the reader closes early and the tail is served below the block. The reader now takes the end candidate whose region renders to the stored `rendered`; the writer takes the candidate whose interior renders to the words. Review note 1 resolved this way. `hasMarkerLine` and `splitAsAsked` are unchanged, so Linear is unaffected.
2. **Size limit in bytes.** The 32,768 limit is enforced on UTF-8 bytes of the serialized property (JSON escaping included). Atlassian's docs say bytes on some pages and characters on others; the stricter reading is used. Source: https://developer.atlassian.com/cloud/jira/platform/jira-entity-properties/
3. **Round trip throws on a block that cannot be held** (too large, or interior does not read back). `providerHoldsAsAsked` treats a throw as "cannot hold", so the seal is skipped with the existing log line. The plan's "non-kept read-back" is the same outcome by a different path.
4. **Empty fenced code block fixed in the codec** (in scope per the brief). It rendered as a blank line between fences, which the writer tore apart, so the description refused every later below-the-line write. It now renders as the bare fence, and the write gate accepts an empty fence.
5. **Every provider-side `getIssue` asks for the property**, including the epic and parent reads (review note 2). The fake returns only requested keys, as real Jira does.

**Not done, and the main open risk:** the live check (LIN-4452). No credential for John's Jira is available to this build, so nothing here shows that Jira keeps the rendered digest across an ordinary editor save below the block. If it does not, the reader serves the converted text and the exact-words promise fails silently; the live check has to be able to fail (review note 1, LIN-4445).

**Consequence once merged:** the first-dispatch seal begins sealing Jira-native tickets on live sites, as the plan expects. A failed seal is logged and dispatch continues.

Next: LIN-4451 (session 2) is blocked by this PR merging.

## Summary comment on LIN-4450 at 14:13:35

## LIN-4450: summary

PR: https://github.com/JKershaw/LinearViewer/pull/2421 (branch `feat/lin-4450-jira-as-asked-seal`, commit a98d042c6). CI on the PR: unit tests, the proxy-clock unit variant, all four E2E shards and secret scan are green.

**Built:** a Jira description holds the `## As asked` words byte-exact. The exact words live in the issue property `harbour.asAsked = { v: 1, words, rendered }`, written in the same PUT as the description. `rendered` is a SHA-256 digest. The reader and writer are in `lib/providers/jira/as-asked-region.js`. All description reads go through it, and every provider-side `getIssue` asks for the property. `descriptionRoundTrip` runs the same reader, so Jira holds the seal with no change to `lib/as-asked-seal.js`.

**Also fixed:** an empty fenced code block broke later below-the-line writes (422 via D1). It now renders as the bare fence, and the gate accepts it.

**Verified:** full local unit suite (25,320 tests; the one census failure is fixed); new `tests/unit/jira-as-asked-region.test.js` covers the witnesses in the plan, including byte equality across filing, later writes, description/below writes and human edits, the size boundary, and the empty-fence regression. Departures from the plan are recorded on LIN-4445.

**Not verified:** no live check on John's Jira (LIN-4452). Whether the site keeps the rendered digest across an ordinary editor save below the block is open.

**Next:** LIN-4451 (session 2) is blocked on this PR merging. Merge is for review and the orchestrator.

## PR #2421 body (opened 14:07)

## Body

LIN-4450 (piece 1 of 3 of LIN-4445): a Jira description holds the person's `## As asked` words byte-exact.

## What changed

- **Shape B.** The description shows the block as an ordinary formatted region (h2 heading, `markdownToAdf(words)`, italic end line). The exact words live in the issue property `harbour.asAsked = { v: 1, words, rendered }`, written in the same PUT as the description. `rendered` is a SHA-256 digest of the region's rendering, stored as a digest because it is only ever compared.
- **One reader and one writer** in `lib/providers/jira/as-asked-region.js`. It is the only module that knows both the ADF region and the property. All four description reads in `index.js` go through `readDescription`, and every provider-side `getIssue` asks for the property.
- **Edits in Jira.** An edit to the block is served as the rendering behind the canonical markers, so the person's edit becomes the words, as on Linear. A property with no block is ignored.
- **End-line choice.** The end line is found by digest, not by position. Words may contain the end sentence as plain or underscore text, and the reader takes the candidate whose region renders to the stored digest.
- **Size guard.** The serialized property must be at most 32,768 UTF-8 bytes (Atlassian's documented limit; the docs give it in bytes on some pages and characters on others, so the stricter reading is enforced). Over the limit, the seal is skipped and an oversized `updateIssue` returns 422 naming the size, with no write.
- **Empty fence.** An empty fenced code block now renders as the bare fence. It used to render as a blank line between two fences, so the writer split it and every later below-the-line write was refused (422).
- **Seal.** `descriptionRoundTrip` is a pure write-then-read through the same reader, so `providerHoldsAsAsked` is true for Jira with no change to `lib/as-asked-seal.js`.

## Retires

- The "Jira is skipped" seal claims in `lib/as-asked-seal.js`, `lib/as-asked.js` and the `descriptionRoundTrip` comment.
- The "Jira today" note in `lib/dispatch-factory.js` and the "Jira files unsealed" line in `docs/proxy-integration.md`.
- The Jira cases of the create-seal, dispatch-seal and guard tests that pinned Jira as "cannot hold the block". They now pin it as sealed and kept. The `sealForFiling` provider-skip branch is witnessed with a synthetic lossy round trip.

## Consequence

Once this lands, the first-dispatch seal seals Jira-native tickets on live sites. The first dispatch adds a heading and an end line and writes the property. A failed seal is logged and dispatch continues.

## Not verified live

No credential for John's Jira site. Whether the site keeps the rendered digest across an ordinary editor save below the block is open until the live check (LIN-4452). If Jira normalises the stored ADF, the reader falls back to the rendering and the words quietly become the converted text. That is the risk the live check exists to catch.

## Tests

- `node scripts/run-unit-tests.mjs` (full unit suite): 25,320 tests, 25,319 pass before the census fixture entry landed. The one failure was `key-state-census`, which needed an entry for the fake's per-issue property store. The census test passes after that entry was added, and the affected suites pass on the final tree (874/874).
- New `tests/unit/jira-as-asked-region.test.js` covers the reader cases, byte equality across filing, later writes, description/below writes and human edits, the codec fixed point, the empty-fence regression, the size boundary and escaping, and a grep witness that no description read bypasses the reader.

