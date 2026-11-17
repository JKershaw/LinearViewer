# What this stage really wrote

State: LIN-4469 moved Todo to In Progress (the 22:59:50 snapshot). Description: unchanged (snapshots 22:39:30 and 22:59:50 match).

## Comment on LIN-4469 at 22:58:22 (id cc7fbe5d)

## Implementation summary (LIN-4469, piece 5)

PR: https://github.com/JKershaw/LinearViewer/pull/2447 (branch `feat/lin-4469-prompt-folds`, commit 3533f37c2). CI: `CI success` green, with unit tests, unit tests (proxy, clock +400d), 4 E2E shards and secret scan all passing.

**Done**
- Four mandates in `lib/proxy-preamble.js` drop the tracker clauses the guard refuses. The code, branch and PR prohibitions stay in words (no code backstop), and so do the merge sentences (cut by ruling).
- Look-into's "post nothing to Linear unless the person asks" exception retired, per John's ruling (LIN-4448 comment bdcd3128).
- Shared constants in `lib/prompts/leftover-words.js`: `areaLookup` and `NOTES_PR`. Periodical readings and retrospective-audit use them. Stability's wording settles the four committed-tool spellings (`committedSearch`, `lib/periodicals.js`).
- "narrowing" becomes "cut" in the plan-review and review verdicts.
- Re-pin: 13 Periodical hashes, LIN-4467 witness, nine template ceilings, two source ceilings. `FROZEN_TOTAL_BYTES` 396884 → 396559 (equal to the ceilings' sum, below the 396575 target). The meta-prompt baseline and router snapshots didn't change, so they were not re-pinned.
- New test `tests/unit/lin-4469-prompt-folds.test.js`: retired spellings appear in no rendered prompt, and the guarded clauses are absent from every preamble. A mutation check confirmed it fails when the retired clause is restored.
- Change log row and ceiling history added in `scripts/prompt-template-change-log.md`. Waiting entries settled or narrowed in `docs/areas/llm-and-prompts.md`.

**Measured**
- Rendered prompts that carry a folded rule fall: bug, design, implementation, plan, research, scoping, spike −24 each; review −30; plan-review −6 (rendered ceilings −204).
- Source ceilings: prompt-template-defs.js −70, prompt-formatters.js +24, stage-kinds.js −12.

**DECISION (for John, on PR #2447)**
1. "A net fall across every kind" is not met for 11 kinds: blocked, breakdown, close-out, look-into, triage, context, survey-task, survey-place, blind-read, retro, retrospective-audit. They render none of the folded text, so they are byte-identical. Recommendation: accept the net fall as measured on the rendered prompts that carry the folded rules.
2. `lib/prompt-template-defs.js` lines 975, 994 and 1065 restate the guarded tracker clause in the read-only templates (survey-task, survey-place, blind-read). They sit outside the four mandates this piece names, so they are not folded. Recommendation: shrink them to the code, branch and PR words, as the mandates now do.

**Kept on purpose:** the blind read's own area sentence (piloted, LIN-4437); the committed-tool policy wording (a policy, not a spelling); CUT's token order in its scope line.

LIN-4350 findings posted as a comment there.

## Ruling raised at 22:58:35 (lin-4469-cuts, to John), the session's closing lines

BLOCKED: Piece 5 is implemented, tested and CI-green on PR #2447, but two cuts to the ask are not agreed until John rules on them. The unfolded template clauses in `lib/prompt-template-defs.js` (lines 975, 994, 1065) are a third, separate gap I left unfolded.
DECISION: {"decision_id":"lin-4469-cuts","question":"LIN-4469 PR #2447: accept two cuts to the ask?","options":[{"id":"accept","label":"Accept: net fall on rendered prompts that carry folded rules; 11 kinds byte-identical"},{"id":"fold","label":"Fold the guarded clause in survey-task, survey-place and blind-read templates too"}],"recommended":"accept","free_text":true,"if_unanswered":{"effect":"hold"},"on_answer":{"effect":"resume","record_on":"LIN-4469"}}

## Not in the material

A findings comment on LIN-4350 (cited by review as `eeb740b0`); its text is not in the material.
