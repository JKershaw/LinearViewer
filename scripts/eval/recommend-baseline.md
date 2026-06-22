# Recommendation engine — red baseline (LIN-432)

The committed baseline the LIN-431 subtasks (2–5) compare against. Produced by the
LOCAL recommendation pipeline via `scripts/eval-recommend-baseline.mjs` — never the
deployed `/api/proxy/recommend` (which runs production and won't see branch changes).

**Fixtures-only (LIN-587):** context comes from committed bundles under
`scripts/eval/fixtures/recommend/*.json` — no proxy token, no network for context.
Only the LLM leg needs `OPENROUTER_API_KEY`. Real-task fixtures (Harbour HAR-149/545/616,
LinearViewer LIN-385/389/428) are curated real text, re-frozen at key in-progress moments
(LIN-596) — each node keeps its first `keep` comments so `state` and the trimmed trail
agree. Graded leaf-only targets re-use one real leaf at several decision moments to cover a
spread of next-actions. Synthetic FIX-448-leaf is deliberately constructed (see its note).
Regenerate from the committed `_source/` captures with `scripts/eval/build-recommend-fixtures.mjs`.

**Scored (LIN-596):** each target carries `expect` (acceptable terminal action[s]) +
`descentExpect` (terminal id the descent should reach). The harness grades deterministically
(no LLM judge) and emits **terminal-action accuracy** + **descent-correct rate**.

**Latest baseline:** `scripts/eval/recommend-baseline/2026-06-22/`
- `table.md` — scored summary + per-run capture (descent path / terminal / action / grade)
- `run.json` — full capture incl. every prompt + reasoning + the scored summary

## Regenerate

```
# the eval itself (context from committed fixtures; only the LLM call needs a key):
OPENROUTER_API_KEY=<key> node scripts/eval-recommend-baseline.mjs

# refresh the real-task fixtures from the proxy (text-free recipe; needs read tokens):
PROXY_TOKEN=<linearviewer read> HARBOUR_PROXY_TOKEN=<harbour read> \
  node scripts/eval/build-recommend-fixtures.mjs
```
