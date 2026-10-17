# Rung 5c: design-first rebuild of the dispatch entrance in one PR, prediction (written before launch)

**Baseline** (`1f8010a0`, kit `shape.mjs`; code lines / decision points / worst):
- `routes/dispatch.js` 1,150 / 348 / 122;
- `routes/proxy-dispatch.js` 1,005 / 289 / 93;
- `routes/proxy-kickoff.js` 295 / 71 / 62.

That's 2,450 code lines, the largest rung. It launches after the factory rebuild (LIN-3580) merges, so it designs against the rebuilt factory.

About 15 test files read these files as source text (enqueue, mint, redaction and runner censuses; the credential fingerprint pin; token-chain order; inventory counts). The ticket carries the efficiency and comment-retention wording.

**Run**
- Not split: about 60%. Merges: about 60%. Done without a ruling: about 30%. It's the most pinned and security-adjacent ticket so far.
- 2–5 hours.

**Result**
- 1,950–2,300 code lines (a 6–20% cut). The pins fix much of the structure.
- Worst function below 60: about 60%. Decision points down 10–25%.
- My replay (10,396 requests per seed, coverage at least 99.5%) finds no agent-visible regression: about 60%. If one ships, it's most likely in the duplicate guard, a refusal's status or code, or long-poll or keepalive timing.
- At least one source-text pin is satisfied only awkwardly, for example a census row kept with a helper name: about 70%.
