# LLM & prompts

Area notes for `llm-and-prompts` in the registry. Format and rules: README.md.

## Lessons

- Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`): text grows only with its
  ticket and reason beside the ceiling it raises, and `FROZEN_TOTAL_BYTES` with it; the
  replaced reason moves to "Ceiling history" in `scripts/prompt-template-change-log.md`.
- Grounding note lists in `lib/prompt-formatters.js` are shared (`WORK` serves several
  stages; `GROUNDING_NOTES` is the unknown-kind fallback): give one stage its own list
  rather than edit a shared one (LIN-4371).
- Keep scoping and both Survey renders byte-identical unless the ticket is about them:
  replays compare them byte for byte (LIN-4369).
- The Surveys get no area notes pointer: survey-place reads no reports on the codebase's
  shape, which feed the notes. Scoping's own pointer cites in its final message (its record
  takes no fifth line); both share `AREA_NOTES_WHERE`, so say where notes are there (LIN-4346).
- `lib/prompt-template-defs.js` and the budget test change in almost every merge: rebase,
  then re-measure. Its fixture passes no context, so it measures a prompt's empty-context
  branch: dropping one can raise a ceiling while real renders shrink (LIN-4393). Measure.
- The `## As asked` block's words have one owner, `lib/as-asked.js`. Import its spellings;
  never retype the heading or the end line (LIN-4362).
- `lib/prompt-template-defs.js` cannot import a module that imports `lib/prompt-templates.js`
  (a cycle). Shared words live in an import-free leaf under `lib/prompts/` both import, as
  `lib/prompts/leftover-words.js` holds `LEFTOVER_RULE` (LIN-4376) and
  `lib/prompts/autopilot-precedence.js` autopilot's order: never restate a rank (LIN-4382).
- Prompt words that ban a kind of how do not hold it: in LIN-4369's replay, runs wrote the
  banned how anyway, and closing one channel moved it into the next (done-means, comments,
  the `[done]` report). Hold a shape in code or a test, as `SIZE_RECORD_SHAPE` in
  `lib/size-of-move.js` does (arm 3), or hold the reader's side (arm 4).
- A stage lead's first sentence is the selector's purpose line. Changing it changes the
  routing prompt: regenerate the router snapshots and `scripts/eval/meta-prompt.baseline.txt`,
  and move the routing ceiling (LIN-4369).
- `lib/prompts/autopilot-precedence.js`: before prompt text routes round a server guard,
  check real rows reach it: scoped runs carry `maxTasks: null`, so P4's detour round
  `guardBudget` cost a session (LIN-4349).
- Model facts come from the OpenRouter catalog: add no model list or rate (LIN-4358).
  Tests seed `tests/unit/helpers/pinned-catalog.js`.

## Waiting

- `lib/recommendation-input.js`: the pinned-kind and in-app renders (`lib/dispatch-entrance.js`,
  `routes/proxy-compute.js` twice, `routes/workspace-api-prompts.js`) build prompt context by
  hand, not through this projection: a new field must reach five places, and LIN-4368's
  missed one until review. (LIN-4393 leftovers.)
- `lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in
  for John's "per task breakdown of options"; the size words and cut ruling ask questions
  they never explain. Revisit both when per-task options land. (John, 8 Nov, LIN-4393.)
- `lib/size-of-move.js`: what counts as code-shaped how is written twice: the checker's
  patterns here, and the `SIZE_RECORD_HOW` line in `lib/proxy-instructions.js`. No test links
  them; arm 3 removed the prompt's third copy. (LIN-4369 leftovers.)
- `lib/should-mock-ai.js`: `isHermeticTestToken` is a third spelling of the test-token
  check, beside `isTestToken` in `routes/workspace-api-steps.js` and the inline
  `isTestMode` checks in `routes/proxy-compute.js` and `routes/task-chat.js`; nothing uses
  it yet. (John, 7 Nov, LIN-4347.)
- `lib/as-asked.js`: "When it could go" is repeated in each of three functions. (John, 7 Nov.)
- `lib/prompts/stage-intent.js`: `docs/architecture/prompt-system.md` names the eight
  deciding stages, an unwatched second copy of `DECIDE`'s membership. (John, 8 Nov.)
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
