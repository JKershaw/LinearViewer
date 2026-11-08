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
- Prompt words that ban a kind of how do not hold it. Two replay arms of scoping's size
  record (LIN-4369) banned definitions and lists in prose, and runs wrote them anyway. The
  guard in `lib/size-of-move.js` sees only code-shaped how (backticks, paths, call syntax,
  numbered steps), so arm 3 holds the record's shape there instead: four lines, any other
  refused (`SIZE_RECORD_SHAPE`). Hold a shape in code or with a test.
- A stage lead's first sentence is the selector's purpose line for that stage. Changing it
  changes the routing prompt: regenerate the router snapshots and
  `scripts/eval/meta-prompt.baseline.txt`, and raise or lower the routing ceiling (LIN-4369).
- Closing one channel moved the how into the next one in every arm of LIN-4369's replay:
  done-means, then definitions, then comments, then the final `[done]` report. When a
  stage must not hand over how, close every channel it writes to, or hold the reader's
  side (LIN-4369 arm 4).

## Waiting

- `lib/size-of-move.js`: what counts as code-shaped how is written twice: the checker's
  patterns here, and the `SIZE_RECORD_HOW` line in `lib/proxy-instructions.js`. No test links
  them. Arm 3 removed the scoping prompt's own list, which was the third copy; the record's
  shape is rendered from `recordShape()` everywhere. (LIN-4369 leftovers.)
- `lib/prompt-formatters.js`: scoping, survey-task and survey-place are left out of the
  area notes pointer so LIN-4369's replay renders unchanged, while scoping's own prose
  says to read the area's notes. Replay arm 4 passed (PR #2356), so this can be done now:
  give scoping and both Surveys the pointer and drop scoping's "the area's notes" prose in
  the next change to scoping's prompt. (LIN-4371; LIN-4369 leftovers.)

- `lib/should-mock-ai.js`: `isHermeticTestToken` is a third spelling of the test-token
  check, beside `isTestToken` in `routes/workspace-api-steps.js` and the inline
  `isTestMode` checks in `routes/proxy-compute.js` and `routes/task-chat.js`. A new owner
  nothing has moved to yet. (John, 7 Nov, on LIN-4347.)
- `lib/recap-cache.js`: `parentAsked` sits between `extractHashableContext` and that
  function's doc comment, so the comment now reads as `parentAsked`'s. (John, 7 Nov.)
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
- `lib/prompt-template-defs.js`: the prompt-size ceiling history moved into
  `scripts/prompt-template-change-log.md`, a file meant as an append-only follow-on-ratio
  log, between its Columns and Rows sections. The ceilings it records are the templates'
  (`tests/unit/prompt-size-budget.test.js`). (John, 8 Nov.)
- `lib/prompt-template-defs.js`: a new stage kind is still a row in about nine parallel
  tables (`GROUNDING_BY_KIND`, the rendered ceilings, completion signals, stage labels and
  more), some unguarded. `route: null` now says "never offered" (LIN-4253); folding the
  per-kind tables into the stage's one definition is open. (Survey tally, LIN-4248.)
- `lib/call-budget.js`: the budget rule (catalog headroom, then one retry with an explicit
  reasoning bound) has never run live on Haiku 5.5 (anthropic/claude-haiku-5.5). Before any
  call moves back to Haiku 5.5, replay LIN-4352's brief: save GET
  /api/proxy/issues/LIN-4352/snapshots?limit=1 (snapshot 82b963e0) as snap.json, then run
  OPENROUTER_API_KEY=… node `scripts/replay-brief.mjs` snap.json anthropic/claude-haiku-5.5.
  It passes when block [2] prints WHOLE with four sections and a final finishReason=stop,
  and any retry row shows the reasoning bound accepted (not a 400). REFUSED means the rule
  changes first. Line [1] says why Haiku stopped on 7 Nov. (John, 8 Nov, on LIN-4358: "Let
  it merge"; the replay gates the next move to Haiku 5.5, not PR #2362.)
