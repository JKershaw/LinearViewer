# LLM & prompts

Area notes for `llm-and-prompts` in the registry. Format and rules: README.md.

## Lessons

- Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`): text grows only with its
  ticket and reason beside the ceiling and `FROZEN_TOTAL_BYTES`; old reasons go to "Ceiling
  history" in `scripts/prompt-template-change-log.md`.
- Grounding lists in `lib/prompt-formatters.js` are shared (`WORK` serves several stages,
  `GROUNDING_NOTES` unknown kinds): give one stage its own list (LIN-4371).
- Keep scoping and both Survey renders byte-identical unless a ticket is about them
  (replays compare them, LIN-4369).
- The Surveys get no area notes pointer: survey-place reads no shape reports, which feed the
  notes. Scoping cites its pointer in its final message; both share `AREA_NOTES_WHERE` (LIN-4346).
- `lib/prompt-template-defs.js` and the budget test change in almost every merge: rebase,
  then re-measure. Its fixture passes no context (the empty-context branch), so dropping one
  can raise a ceiling while real renders shrink (LIN-4393).
- The `## As asked` block's words have one owner, `lib/as-asked.js`: import its spellings,
  never retype the heading or end line (LIN-4362).
- `lib/prompt-template-defs.js` cannot import what imports `lib/prompt-templates.js` (a
  cycle): shared words live in an import-free leaf, as `lib/prompts/leftover-words.js`
  (LIN-4376) and `lib/prompts/autopilot-precedence.js` (never restate a rank; LIN-4382).
- Prompt words banning a kind of how do not hold it (LIN-4369's replay: closing one channel
  moved it to the next). Hold the shape in code or a test (`SIZE_RECORD_SHAPE`,
  `lib/size-of-move.js`, arm 3) or hold the reader's side (arm 4).
- A stage lead's first sentence is the selector's purpose line: changing it means new router
  snapshots, `scripts/eval/meta-prompt.baseline.txt` and routing ceiling (LIN-4369).
- `lib/prompts/autopilot-precedence.js`: check real rows reach a server guard before prompt
  text bypasses it (LIN-4349). A scoped run's Periodical is opt-in by goal: no tail, no flag
  (LIN-4415).
- `lib/periodicals.js`: close-out merges a Periodical's PR and sets Done as for any task;
  give no Periodical its own merge rule: notes are prompt input (LIN-4390). The rule is retyped
  in five files; only a test links them.
- Model facts come from the OpenRouter catalog: add no model list or rate (LIN-4358);
  tests seed `tests/unit/helpers/pinned-catalog.js`.

## Waiting

- `lib/recommendation-input.js`: the pinned-kind and in-app renders (`lib/dispatch-entrance.js`,
  `routes/proxy-compute.js` twice, `routes/workspace-api-prompts.js`) build context by hand: a
  new field must reach all five (LIN-4368 missed one; LIN-4393 leftovers.)
- `lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in
  for John's "per task breakdown of options"; its size words are unexplained. (John, LIN-4393.)
- `lib/should-mock-ai.js`: `isHermeticTestToken` is a third test-token check beside
  `isTestToken` (`routes/workspace-api-steps.js`) and inline `isTestMode` in
  `routes/proxy-compute.js` and `routes/task-chat.js`. (LIN-4347.)
- `lib/as-asked.js`: "When it could go" is in three functions. (John, 7 Nov.)
- `lib/prompts/stage-intent.js`: `CUT` writes the closing contract's token order (`DECISION:`
  before `BLOCKED:`) into a scope line beside `ASK`. Its "cut" and the plan-review and review
  "narrowing" (`lib/completion-signals.js`) name one thing; no test links them. (John, 8 Nov.)
- `lib/prompt-template-defs.js`: a stage kind is a row in ~nine parallel tables
  (`GROUNDING_BY_KIND`, ceilings, completion signals, labels…), some unguarded: fold
  into one definition. (Survey tally, LIN-4248.)
- `lib/call-budget.js`: the budget rule is untested live on anthropic/claude-haiku-5.5; before
  moving a call there, replay LIN-4352's snapshot through `scripts/replay-brief.mjs`: block [2] WHOLE,
  four sections, finishReason=stop, any retry's reasoning bound accepted. REFUSED: change the rule
  first. (John, LIN-4358.)
- `lib/call-budget.js`: split: `resolveReasoningBudget`/`isReasoningModel` stay in
  `lib/openrouter.js`; tool hops and the routing pair get the budget, not the retry;
  `canReason` has test callers only. (Area reads CG/CH.)
- `lib/openrouter.js`: `SUGGESTED_MODEL_IDS` and `DISPATCH_MODEL_SUGGESTIONS`
  (`lib/model-routing-harnesses.js`) repeat ids by hand, unchecked; the first is also the
  cold-catalog fallback. (Area reads CG/CH.)
- `lib/periodicals.js`: `docs/areas/` is spelled in 17 lines across 10 code files. (Drift &
  Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`; count,
  Documentation Review.)
- `lib/recommendation-live-wait.js`: a read, not a claim: two different-kind calls racing on
  one ticket both pass; claim compare-and-set, like `claimHeldWake` (LIN-4392).
- `lib/periodicals.js`: two sizes of move: a ceiling for Periodical prompts (+18.8% in the window,
  185,952 to 220,882 B; only a sha256 tripwire), and an index or series archive for `docs/reviews/`
  (109 top-level reports, 88 MB). (Documentation Review, 10 Nov.;
  `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/prompt-formatters.js`: eight stage kinds are told notes bind, yet
  `tests/unit/area-notes.test.js` checks shape only and close-out writes review-worded
  entries to main unreviewed: no content boundary on who adds a Lesson. (Security Review, 10 Nov.;
  `docs/reviews/security-review-2026-11-10.md`.)
- `lib/prompts/autopilot-kickoff.js`: a dispatch holder's `goal` is "Goal from the
  human" (ranked first), a periodical mint `note` "the operator" (`lib/periodicals.js`):
  attribute both to the minting token. (Security Review, 10 Nov.;
  `docs/reviews/security-review-2026-11-10.md`.)
- `lib/periodicals.js`: a reading's finding with no file in an area to cite goes to the closing
  comment, "never in a ticket", a live secret included, while `CONSEQUENCE_TEST`
  (`lib/prompts/leftover-words.js`) sends a find that touches safety to a ticket. The two rules in
  this area answer the live-secret case oppositely; having Periodicals render the gate needs
  John's ruling on that case first. (LIN-4401, LIN-4431.)
- `lib/prompts/leftover-words.js`: since `CONSEQUENCE_TEST` (LIN-4401), outside finds gather as
  Waiting entries in other areas' notes where tickets used to be filed. LIN-4414's one retirement
  per build drains only the areas a build touches, so rarely touched notes (other-features) will
  grow; their Waiting counts are the honest measure. (LIN-4431.)
- `lib/prompt-template-defs.js` (retrospective-audit Reporting) and `lib/periodicals.js`
  (`areaNotesRoutes`) each state the docs-only notes-PR rule in their own words; one shared
  constant in `lib/prompts/leftover-words.js` would make it one, at the cost of re-pinning the 13
  Periodical prompt hashes. (LIN-4432.)
