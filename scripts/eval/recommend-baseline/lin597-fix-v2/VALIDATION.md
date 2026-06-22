# LIN-597 — over-advance guard validation (paired before/after)

Meta-prompt Step-3 change: make **"no committed scope ⇒ never `implement`"** explicit and
one-directional (`lib/prompts/meta-prompt-template.js`). Validated against the recommend-baseline
hard-case harness on the LIN targets (`ONLY=LIN K=6`, `openai/gpt-5.4-mini`).

Apples-to-apples paired run, same targets / same K, code reverted vs. applied:
- **before:** `../lin597-prefix-baseline/`
- **after:** this dir (`lin597-fix-v2/`)

| metric | before | after |
|---|---|---|
| terminal-action accuracy (11 LIN targets × K=6) | 61/66 | **63/66** |
| over-advance (`implement` chosen on a non-implement target) | 4 | **3** |
| LIN-215@plan over-advance (rich-but-unscoped) | 1 | **0** |
| LIN-385@plan over-advance (nothing-done) | 2 | **1** |
| LIN-385@breakdown correct (multi-session plan → breakdown) | 4/6 | 4/6 (parity) |
| LIN-489 / LIN-428 / LIN-596 @implement, LIN-428@review | all ✓ | all ✓ |

**Read:** over-advance narrows on exactly the no-committed-scope targets the change targets,
with no regression to the clearly-planned `implement`, `breakdown`, or `review` cases.

**Honesty caveat (per the ticket):** this is a single K=6 paired run on a target set with
documented severe run-to-run variance (the same LIN-385 nothing-done state has swung 0%→67%
over-advance across prior captures). The direction is correct and the implement cases are
preserved, but the magnitude should not be over-read from one paired sample.

**Iteration note:** a first wording (v1) eliminated over-advance on the no-scope targets but
*eroded* the multi-session→breakdown branch (LIN-385@breakdown 4/6 → 2/6) because the
parenthetical over-blessed "committed plan → implement". The shipped wording fires the guard
ONLY when scope is absent and explicitly preserves both committed-plan routes
("fits one session" → implementation, "needs multiple sessions" → breakdown), restoring
LIN-385@breakdown to parity.
