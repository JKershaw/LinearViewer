# Research-routing eval (standalone research infra)

A/B harness for the recommendation meta-prompt's **routing decision** (the
`→ **action**` it emits). Decoupled from `lib/` on purpose: it treats the
meta-prompt as plain text so you can iterate a candidate in isolation, prove a
lift, and only then make a single manual edit to the live prompt.

## Files

| File | Role |
|------|------|
| `../eval-research-routing.mjs` | the harness (reads the two prompt files, runs cases, grades) |
| `meta-prompt.baseline.txt` | **Arm A** — faithful snapshot of the LIVE meta-prompt |
| `meta-prompt.candidate.txt` | **Arm B** — the variant under test (edit this) |

Both use placeholders `{{ISSUE_CONTEXT}}` / `{{IDENTIFIER}}`, filled per case. The
snapshot is for a leaf task (no subtasks/comments), `featureFlags:{}` — exactly
what the proxy sends — so cases must likewise be leaf tasks to stay faithful.

> **Scope (LIN-327).** This harness grades the **leaf** routing decision only. The
> `defer` action and its node-shaped "descend vs. node-work" routing are emitted on
> *node* prompts (`hasSubtasks:true`), which this leaf snapshot does not cover. The
> end-to-end defer regression — a parent with a research-needing leaf resolving to
> `research` at the leaf (not `implement` at the parent) — is exercised by the
> recommend-recursion eval/unit tests in **LIN-329**, where the traversal that makes
> that resolution observable actually lives.

## Workflow

1. **Edit `meta-prompt.candidate.txt`** — change the wording you want to test.
2. **Run A/B** (cost-conscious: start with a focused subset + `K=1`):
   ```bash
   OPENROUTER_API_KEY=... ONLY=gathering K=2 node scripts/eval-research-routing.mjs   # decisive cases
   OPENROUTER_API_KEY=... K=2 node scripts/eval-research-routing.mjs                  # full suite
   ```
   Read: **research recall ↑**, **over-fire ↓**, **off-vocab ↓**, accuracy ↑.
3. **Ship when proven** — copy the winning wording into the live prompt
   `lib/prompts/meta-prompt-template.js` (Step 1). Routing lives only in the
   meta-prompt, so there is no handwritten mirror to update.
4. **Verify the port for free** — regenerate the snapshot and diff:
   ```bash
   node scripts/eval/regen-baseline.mjs && diff scripts/eval/meta-prompt.baseline.txt scripts/eval/meta-prompt.candidate.txt
   ```
   If the only diff is whitespace, the live template == the proven candidate
   (proof-by-construction — no API spend). Then reset candidate to baseline.

## Env knobs

`GEN_MODEL` (default sonnet) · `K` runs/arm/case (default 2) · `ARMS` A|B|AB
(default AB) · `ONLY` substring case filter · `MAX_TOKENS` output cap (default
600 — only need through the action line). **Input (~5k-tok prompt) dominates
cost**; iterate on a small `ONLY` subset before the full suite.

## Regenerating the baseline snapshot

When `lib/prompts/meta-prompt-template.js` changes, regenerate Arm A so it stays
faithful: `node scripts/eval/regen-baseline.mjs`.
