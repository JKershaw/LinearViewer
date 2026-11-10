# LLM & prompts

Area notes for `llm-and-prompts` in the registry. Format and rules: README.md.

## Lessons

- Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`): text grows only with its
  ticket and reason beside the ceiling (and `FROZEN_TOTAL_BYTES`); the old reason goes to
  "Ceiling history" in `scripts/prompt-template-change-log.md`.
- Grounding note lists in `lib/prompt-formatters.js` are shared (`WORK` serves several
  stages, `GROUNDING_NOTES` unknown kinds): give one stage its own list (LIN-4371).
- Keep scoping and both Survey renders byte-identical unless the ticket is about them:
  replays compare them (LIN-4369).
- The Surveys get no area notes pointer: survey-place reads no shape reports, which feed the
  notes. Scoping cites its pointer in its final message; both share `AREA_NOTES_WHERE` (LIN-4346).
- `lib/prompt-template-defs.js` and the budget test change in almost every merge: rebase,
  then re-measure. Its fixture passes no context, so it measures a prompt's empty-context
  branch: dropping one can raise a ceiling while real renders shrink (LIN-4393).
- The `## As asked` block's words have one owner, `lib/as-asked.js`. Import its spellings;
  never retype the heading or end line (LIN-4362).
- `lib/prompt-template-defs.js` cannot import a module that imports `lib/prompt-templates.js`
  (a cycle). Shared words live in an import-free leaf under `lib/prompts/`, as
  `lib/prompts/leftover-words.js` holds `LEFTOVER_RULE` (LIN-4376) and
  `lib/prompts/autopilot-precedence.js` autopilot's order: never restate a rank (LIN-4382).
- Prompt words that ban a kind of how do not hold it: in LIN-4369's replay, closing one channel
  moved the banned how to the next. Hold a shape in code or a test, as `SIZE_RECORD_SHAPE` in
  `lib/size-of-move.js` does (arm 3), or hold the reader's side (arm 4).
- A stage lead's first sentence is the selector's purpose line: to change it, regenerate the
  router snapshots and `scripts/eval/meta-prompt.baseline.txt` and move the routing ceiling
  (LIN-4369).
- `lib/prompts/autopilot-precedence.js`: before prompt text routes round a server guard,
  check real rows reach it: scoped runs carry `maxTasks: null`, so P4's detour round
  `guardBudget` cost a session (LIN-4349).
- `lib/periodicals.js`: close-out merges a Periodical's PR and sets Done, as for any task.
  Give no Periodical its own merge rule: notes are prompt input (LIN-4390). The rule is retyped
  in five files; only a test links them.
- Model facts come from the OpenRouter catalog: add no model list or rate (LIN-4358).
  Tests seed `tests/unit/helpers/pinned-catalog.js`.

## Waiting

- `lib/recommendation-input.js`: the pinned-kind and in-app renders (`lib/dispatch-entrance.js`,
  `routes/proxy-compute.js` twice, `routes/workspace-api-prompts.js`) build prompt context by
  hand: a new field must reach five places (LIN-4368 missed one). (LIN-4393 leftovers.)
- `lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in
  for John's "per task breakdown of options"; its size words are unexplained. (John, LIN-4393.)
- `lib/should-mock-ai.js`: `isHermeticTestToken` is a third spelling of the test-token
  check, beside `isTestToken` in `routes/workspace-api-steps.js` and the inline
  `isTestMode` checks in `routes/proxy-compute.js` and `routes/task-chat.js`. (LIN-4347.)
- `lib/as-asked.js`: "When it could go" is repeated in three functions. (John, 7 Nov.)
- `lib/prompts/stage-intent.js`: `CUT` writes the closing contract's token order (`DECISION:`
  before `BLOCKED:`) into a scope line beside `ASK`. Its "cut" and the plan-review and review
  "narrowing" (`lib/completion-signals.js`) name one thing; no test links them. (John, 8 Nov.)
- `lib/prompt-template-defs.js`: a new stage kind is a row in about nine parallel tables
  (`GROUNDING_BY_KIND`, rendered ceilings, completion signals, labels…), some unguarded;
  fold them into one stage definition. (Survey tally, LIN-4248.)
- `lib/call-budget.js`: the budget rule has never run live on anthropic/claude-haiku-5.5. Before a
  call moves to it, replay LIN-4352's snapshot through `scripts/replay-brief.mjs`: block [2] WHOLE,
  four sections, finishReason=stop, any retry's reasoning bound accepted. REFUSED: change the rule
  first. (John, LIN-4358.)
- `lib/call-budget.js`: split rule: `resolveReasoningBudget`/`isReasoningModel` stay in
  `lib/openrouter.js`; tool hops and the routing pair get the budget, not the retry;
  `canReason` has test callers only. (Area reads CG/CH.)
- `lib/openrouter.js`: `SUGGESTED_MODEL_IDS` and `DISPATCH_MODEL_SUGGESTIONS`
  (`lib/model-routing-harnesses.js`) repeat ids by hand, unchecked; the first doubles as
  the cold-catalog tool fallback. (Area reads CG/CH.)
- `lib/periodicals.js`: `areaNotes()` restates the notes' own rules, and `docs/areas/` is spelled
  in 17 lines across 10 code files. (Drift & Coherence Review, 10 Nov;
  `docs/reviews/drift-coherence-review-2026-11-10.md`; count, Documentation Review, 10 Nov;
  `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/periodicals.js`: SD's area-notes guard has diverged (200 lines to 147, adds `sh`), and SD's
  README has no Periodical-entry rules. A Periodical's SD note must cite the report second, but the
  report lives in LinearViewer, so SD's existence check rejects it. (Drift & Coherence Review,
  10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/recommendation-live-wait.js`: a read, not a claim: two different-kind calls racing on one
  ticket both pass. The store should claim it, compare-and-set like `claimHeldWake`. (LIN-4392.)
- `lib/periodicals.js`: Periodical prompts have no size ceiling: +18.8% in the window (185,952 to
  220,882 B), and only a sha256 tripwire covers them. Size of the move: a ceiling. (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/periodicals.js`: `docs/reviews/` has 109 top-level reports (92 MB) and no index. Size of the
  move: an index or series archive. (Documentation Review, 10 Nov.;
  `docs/reviews/documentation-review-2026-11-10.md`.)
