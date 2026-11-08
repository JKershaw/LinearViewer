# LLM & prompts

Area notes for `llm-and-prompts` in the registry. Format and rules: README.md.

## Lessons

- Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`). A lesson lands as code
  or a test first. Prompt text grows only with its ticket and reason beside the ceiling it
  raises, and `FROZEN_TOTAL_BYTES` rises with it. The reason a raise replaces moves to
  "Ceiling history" in `scripts/prompt-template-change-log.md`.
- Grounding note lists in `lib/prompt-formatters.js` are shared: `WORK` serves several
  stages and `GROUNDING_NOTES` is also the unknown-kind fallback. To change what one stage
  gets, give it its own list; don't edit a shared one (LIN-4371).
- Keep the scoping and the two Survey renders byte-identical unless the ticket is about
  them: replays compare them byte for byte (LIN-4369).
- `lib/prompt-template-defs.js` and the budget test change in almost every merge.
  Rebase onto whatever lands first and re-measure; don't trust a ceiling you measured
  before the rebase.
- The `## As asked` block's words have one owner, `lib/as-asked.js`. Import its spellings;
  never retype the heading or the end line (LIN-4362).
- `lib/prompt-template-defs.js` cannot import a module that imports `lib/prompt-templates.js`
  (a cycle). Words a template shares with such a module live in an import-free leaf under
  `lib/prompts/` both import: `lib/prompts/leftover-words.js` holds the leftover heading and
  `LEFTOVER_RULE`, rendered verbatim by the leftover prompt, review and close-out (LIN-4376).
- Prompt words that ban a kind of how do not hold it. Two replay arms of scoping's record
  (LIN-4369) banned definitions and lists in prose; runs wrote them anyway. The guard in
  `lib/size-of-move.js` sees only code-shaped how, so arm 3 holds the shape there: four
  lines, any other refused (`SIZE_RECORD_SHAPE`). Hold a shape in code or a test.
- A stage lead's first sentence is the selector's purpose line for that stage. Changing it
  changes the routing prompt: regenerate the router snapshots and
  `scripts/eval/meta-prompt.baseline.txt`, and raise or lower the routing ceiling (LIN-4369).
- In every arm of LIN-4369's replay, closing one channel moved the how into the next:
  done-means, definitions, comments, the final `[done]` report. To keep how out, close
  every channel a stage writes to, or hold the reader's side (LIN-4369 arm 4).
- Model facts come from the OpenRouter catalog: add no model list or rate (LIN-4358).
  Tests seed `tests/unit/helpers/pinned-catalog.js`.

## Waiting

- `lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in
  for the "per task breakdown of options" John expects, and the size words and cut ruling
  ask questions they never explain. Revisit both when per-task options land. (John, 8 Nov,
  LIN-4393.)
- `lib/size-of-move.js`: what counts as code-shaped how is written twice: the checker's
  patterns here, and the `SIZE_RECORD_HOW` line in `lib/proxy-instructions.js`. No test links
  them. Arm 3 removed the scoping prompt's own list, which was the third copy; the record's
  shape is rendered from `recordShape()` everywhere. (LIN-4369 leftovers.)
- `lib/prompt-formatters.js`: scoping and both Surveys are left out of the area notes
  pointer so LIN-4369's replay renders unchanged, while scoping's prose says to read the
  area's notes. Arm 4 passed (PR #2356): give the three the pointer and drop scoping's
  "the area's notes" prose in the next change to scoping's prompt. (LIN-4371, LIN-4369.)
- `lib/should-mock-ai.js`: `isHermeticTestToken` is a third spelling of the test-token
  check, beside `isTestToken` in `routes/workspace-api-steps.js` and the inline
  `isTestMode` checks in `routes/proxy-compute.js` and `routes/task-chat.js`. A new owner
  nothing has moved to yet. (John, 7 Nov, on LIN-4347.)
- `lib/as-asked.js`: the "When it could go" paragraph is repeated three times, once per
  function. (John, 7 Nov.)
- `lib/prompts/stage-intent.js`: `docs/architecture/prompt-system.md` lists the eight
  deciding stages by name, a second copy of `DECIDE`'s membership that no test watches.
  (John, 8 Nov.)
- `lib/prompt-template-defs.js`: who may agree to a reduced ask has two names, "cut" in
  `CUT` (`lib/prompts/stage-intent.js`) and "narrowing" in the plan-review and review
  verdict text here and in `lib/completion-signals.js`. No test links them. (John, 8 Nov.)
- `lib/prompts/stage-intent.js`: `CUT` writes the closing contract's token order
  (`DECISION:` before `BLOCKED:`) into a scope line, beside `ASK`, which asks for a
  different shape. (John, 8 Nov.)
- `lib/prompt-template-defs.js`: the ceiling history (`tests/unit/prompt-size-budget.test.js`)
  moved into `scripts/prompt-template-change-log.md`, an append-only follow-on-ratio log,
  between its Columns and Rows. (John, 8 Nov.)
- `lib/prompt-template-defs.js`: a new stage kind is still a row in about nine parallel
  tables (`GROUNDING_BY_KIND`, rendered ceilings, completion signals, stage labels…), some
  unguarded. `route: null` says "never offered" (LIN-4253); folding the per-kind tables
  into the stage's one definition is open. (Survey tally, LIN-4248.)
- `lib/call-budget.js`: the budget rule has never run live on anthropic/claude-haiku-5.5.
  Before a call moves to it, save GET /api/proxy/issues/LIN-4352/snapshots?limit=1
  (82b963e0) as snap.json; run OPENROUTER_API_KEY=… node `scripts/replay-brief.mjs`
  snap.json anthropic/claude-haiku-5.5. Pass: block [2] WHOLE, four sections, final
  finishReason=stop, any retry's reasoning bound accepted. REFUSED: change the rule
  first. (John, 8 Nov, LIN-4358.)
- `lib/call-budget.js`: split rule: `resolveReasoningBudget`/`isReasoningModel` stay in
  `lib/openrouter.js`; tool hops and the routing pair get the budget, not the retry;
  `canReason` has test callers only. (Area reads CG/CH, 8 Nov.)
- `lib/openrouter.js`: `SUGGESTED_MODEL_IDS` and `DISPATCH_MODEL_SUGGESTIONS`
  (`lib/model-routing-harnesses.js`) repeat ids by hand, unchecked; the first doubles as
  the cold-catalog tool fallback. (Area reads CG/CH, 8 Nov.)
