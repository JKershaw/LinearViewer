# Recommendation engine — red baseline (LIN-432)

The committed baseline the LIN-431 subtasks (2–5) compare against. Produced by the
LOCAL recommendation pipeline via `scripts/eval-recommend-baseline.mjs` — never the
deployed `/api/proxy/recommend` (which runs production and won't see branch changes).

**Latest baseline:** `scripts/eval/recommend-baseline/2026-06-12/`
- `table.md` — compact per-run table (descent path / terminal / action / prompt length)
- `run.json` — full capture incl. every prompt + reasoning

## Regenerate

```
PROXY_TOKEN=<linearviewer read token> OPENROUTER_API_KEY=<key> \
  node scripts/eval-recommend-baseline.mjs
```

Add Harbour by supplying `HARBOUR_PROXY_TOKEN` + `HARBOUR_PROXY_BASE` (config, not code).
