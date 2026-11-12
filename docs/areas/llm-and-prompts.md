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
- `lib/library.js` takes a shelf doc's summary by position (`firstParagraphAfterTitle`): a paper
  that opens with a figure keeps its alt text under 12 words, or the alt text becomes the
  summary; a rewritten first paragraph re-pins `tests/fixtures/library-doc-summaries.json` (LIN-4428).
- A blind reader's limits are instructions, not access: with the repository checked out it can still
  see commit subjects (`git worktree add` prints the head's) and area notes. Both slipped, harmlessly,
  in the LIN-4436 pilot. Code hands a blind stage SHAs and PR URLs, never a PR body or commit log.
- `lib/periodicals.js`: Stability defers to a repo's committed declaration of its measures and names
  none (LIN-4424): change Harbour's measures in `docs/reviews/stability-measures/README.md` and its
  script, never in the shared template; a test links the bullet's list to that README.
- A new stage kind is a row in every table `tests/unit/stage-kind-tables.test.js` reads: add it, or list it
  there as out with the reason. A kind in `SPINE` (`lib/run-view.js`) also moves the run page's "n of N", the
  session and task-page goldens (`UPDATE_RENDER_SESSION_GOLDEN=1`, `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`) and the
  E2E count pins; read the golden diff before accepting it (LIN-4437).
- `formatCiGateCheck` (`lib/prompt-formatters.js`) renders in implementation, review and close-out:
  a rule for one stage gets its own formatter beside it. Prove the others unchanged by rendering every
  kind, fresh and fix round, at HEAD and on the branch, not by the budget test, whose ceilings are caps (LIN-4441).

## Waiting

- `lib/recommendation-input.js`: the pinned-kind and in-app renders (`lib/dispatch-entrance.js`,
  `routes/proxy-compute.js` twice, `routes/workspace-api-prompts.js`) build context by hand: a
  new field must reach all five (LIN-4368 missed one; LIN-4393 leftovers.)
- `lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in
  for John's "per task breakdown of options"; its size words are unexplained. (John, LIN-4393.)
- `lib/should-mock-ai.js`: `isHermeticTestToken` is a third test-token check beside
  `isTestToken` (`routes/workspace-api-steps.js`) and inline `isTestMode` in
  `routes/proxy-compute.js` and `routes/task-chat.js`. (LIN-4347.)
- `lib/prompts/stage-intent.js`: `CUT` writes the closing contract's token order (`DECISION:`
  before `BLOCKED:`) into a scope line beside `ASK`. Its "cut" and the plan-review and review
  "narrowing" (`lib/completion-signals.js`) name one thing; no test links them. (John, 8 Nov.)
- `lib/prompt-template-defs.js`: a stage kind is a row in ~fourteen parallel tables
  (`GROUNDING_BY_KIND`, ceilings, completion signals, labels…): fold into one definition.
  The guard half is settled: `tests/unit/stage-kind-tables.test.js` fails on a missing row
  (LIN-4437). (Survey tally, LIN-4248.)
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
- `lib/library.js`: summaries come from first-paragraph position, so an opening image's alt text
  can become the summary and every shelf rewrite churns `tests/fixtures/library-doc-summaries.json`;
  a `summary:` front-matter field would end both, but changes every doc's summary source.
  (Survey global, LIN-4428.)
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
- `lib/prompts/leftover-words.js`: the first-match area lookup is spelled three ways: `CONSEQUENCE_TEST`'s
  "first match wins" parenthetical, `docs/areas/README.md` ("take the first area with a pattern that
  matches its path") and the blind-read prompt's own sentence (`lib/prompt-template-defs.js`, the
  `blind-read` template), which shipped as piloted (LIN-4437), so it was not retyped after the pilot. One constant in the leaf would make it
  one, at the cost of re-piloting that sentence. (LIN-4436 leftovers.)
- `lib/prompt-formatters.js`: `formatLocalTestRule` names this repo's runner command
  (`node scripts/run-unit-tests.mjs tests/unit/<files>`) in a template that also drives other
  repos, and `CLAUDE.md` spells the same rule; a repo-supplied test command would make the line
  right elsewhere and give it one spelling. (LIN-4441 leftovers.)
- `lib/periodicals.js`: "search the repo for a committed tool (no path is written here) and run it"
  is spelled four times: Drift & Coherence's census bullet, Seams & Tangles' two bullets and
  Stability's declaration bullet. One shared helper would make it one, at the cost of re-pinning
  those three templates' hashes. (LIN-4424 leftovers; Survey global.)
