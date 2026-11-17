# What this stage really wrote

## Comment on LIN-4464 at 16:17:18

## LIN-4464 done: baseline area read at e8e92d50a

PR: https://github.com/JKershaw/LinearViewer/pull/2430 (head `ce6cb88aa`), docs only.

**Result.** Both areas read at `e8e92d50a` with the frozen kit (blob `cbec2d848`) and reader prompt (blob `ef1c2ca91`), two fresh passes each.
- LLM & prompts: code 3.3 (passes 3.3 / 3.3), note 3.25 (3.0 / 3.5)
- Front end: server-rendered pages (control): code 3.3 (3.3 / 3.3), note 3.5 (3.5 / 3.5)
- Noise guard not fired on either area.

**Recorded limits.** LLM sample 380,459 B against control 206,545 B (1.84x; N kept at 14). `lib/openrouter.js` and `lib/prompt-template-defs.js` are 59% of the LLM sample. Control files moved since `4b5001ddf` (`render-proxy`, `render-swipe`, `render-task-page`), flagged for the after-read.

**Open PRs.** Fourteen open; none touches a sampled file. #2427 adds 5 lines to the LLM note, outside the baseline.

**Contamination.** Every counted reader read only its own bundle, except one Bash `grep` of its own header lines by a Front-end pass. Recorded in the control report; the pass is counted.

**Retires.** No Waiting entry. Fills the missing-baseline gap. Nothing from pieces 1–6 on main.

**CI.** `CI success` (ci-success) pass, and all seven jobs pass: Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan (source).

**Decisions made:**
- Base `e8e92d50a`, as the brief asks, so both reads share one commit.
- Area names in `{AREA}` are the `areas.json` names. Nothing else in the reader prompt changed.
- N kept at 14 despite the byte imbalance.

Reports: `docs/plans/survey/area-read-reports/llm-and-prompts-e8e92d50a.md`, `docs/plans/survey/area-read-reports/front-end-pages-e8e92d50a.md`. Adoption record: `docs/plans/survey/area-read-adoption-e8e92d50a.md`.
