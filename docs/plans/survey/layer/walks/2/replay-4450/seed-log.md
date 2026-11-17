# Seed log: replay-4450

Strict store (no `--retro`), state at 2026-11-13T13:44:54Z. `seed.sh` rebuilds it from empty; `check` is clean.

**Ids:** LIN-4445 `task-1`, LIN-4450 `task-2` (piece `plan-1`), LIN-4451 `task-3`, LIN-4452 `task-4`.

**Written, and from where**
- Areas providers, llm-and-prompts, other-features (`area-1`–`3`) from `areas.json` and the notes at `4b5001ddf` (commit time 12:01:48Z). That gives 18 lessons and 31 Waiting findings. providers has no note yet.
- `task-1`: `asked` byte-exact from `## As asked` (1159 bytes), by John via driving-session at 12:08:08.
- Size record (`decision-1`, by scoping); Design comment: shape B (`decision-2`).
- Plan pieces `plan-1`–`3` (Sessions 1–3) by design, plus the plan's session-fit and plan-review-due decisions.
- Plan review: each piece has a v2 that adds the review notes, routed as breakdown routed them (2, 3, 6 / 4, 5 / 1). Its verdicts are `approve`, `on` v2.
- Breakdown: the children, and two decisions each (plan-review due: no; fits one session) resting `on` their piece's verdict.
- No settings: the material shows no choice John made once outside the ask.

**Refusal (verbatim):** `revise task-1 --by breakdown` gave `"breakdown writes only child tasks"`, and design is refused the same way. Harbour wrote the parent's paths instead (union of the pieces' paths).

**Estimated times:** Size record 13:25, plan 13:40:00, LIN-4451/4452 13:44:10/15.

**Judgement calls:** pieces carry each session's words verbatim. Test paths follow the `tests/unit/*.test.js` convention, not checked. Lessons that cite no file take their area's paths. Area globs (`lib/prompt-*.js`) are literal to the layer, and `lib/` overlaps everything.

**Not placed:** the parent's two Survey comments (consumed by design), parent stage runs, blocked-by relations (the layer has no link type for them; `order` and the session-fit `why` carry them), child titles.

`real/` and `step.mjs` were already in this folder. I did not read them.
