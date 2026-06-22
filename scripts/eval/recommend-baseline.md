# Recommendation engine — red baseline (LIN-432)

The committed baseline the LIN-431 subtasks (2–5) compare against. Produced by the
LOCAL recommendation pipeline via `scripts/eval-recommend-baseline.mjs` — never the
deployed `/api/proxy/recommend` (which runs production and won't see branch changes).

**Fixtures-only (LIN-587):** context comes from committed bundles under
`scripts/eval/fixtures/recommend/*.json` — no proxy token, no network for context.
Only the LLM leg needs `OPENROUTER_API_KEY`. Real-task fixtures (Harbour HAR-149/545/616,
LinearViewer LIN-385/389/428) are curated real text; the descent chains are reconstructed
to `started` (the real tasks have since closed). Synthetic FIX-448-leaf is deliberately
constructed (see its note). Regenerate real fixtures with `scripts/eval/build-recommend-fixtures.mjs`.

**Latest baseline:** `scripts/eval/recommend-baseline/2026-06-12/`
- `table.md` — compact per-run table (descent path / terminal / action / prompt length)
- `run.json` — full capture incl. every prompt + reasoning

## Regenerate

```
# the eval itself (context from committed fixtures; only the LLM call needs a key):
OPENROUTER_API_KEY=<key> node scripts/eval-recommend-baseline.mjs

# refresh the real-task fixtures from the proxy (text-free recipe; needs read tokens):
PROXY_TOKEN=<linearviewer read> HARBOUR_PROXY_TOKEN=<harbour read> \
  node scripts/eval/build-recommend-fixtures.mjs
```
