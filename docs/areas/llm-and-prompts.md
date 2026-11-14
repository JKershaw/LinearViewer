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
- The blind read's kind, heading and verdict words have one owner, `lib/prompts/blind-read-words.js`;
  the verdict prose ("better, the same or worse") is built there from the words. Import them. The scan
  in `tests/unit/stage-kind-tables.test.js` fails on a literal elsewhere, except as a row key of a table it
  lists; the stage kinds' tables are views of `STAGE_KINDS`, so that list names the record (LIN-4466, LIN-4470).
  Prove a move byte-identical by rendering every kind, fresh and fix round (LIN-4466).
- A stage kind's name is a literal once, as its key in `STAGE_KINDS` (`lib/prompts/stage-kinds.js`). A kind whose
  words code outside the record reads gets one leaf constant that the record imports: the blind read has one, and no
  other kind gets one, since a second constant per kind would be a second home (LIN-4470).
- The code routes' order lives once, in `CODE_ROUTES` (`lib/code-routes.js`). A new route is an
  entry with its `emits`, plus the one "Code route order" line in
  `docs/architecture/prompt-system.md` and in `docs/architecture/source-map.md`;
  `tests/unit/lin-4465-code-routes.test.js` fails until all three agree. Point at the list; never
  restate the order or count the routes in prose (LIN-4465).
- `lib/prompt-template-defs.js` cannot import what imports `lib/prompt-templates.js` (a
  cycle): shared words live in a leaf that imports only leaves, as `lib/prompts/leftover-words.js`
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
- A new stage kind is one record in `lib/prompts/stage-kinds.js`, with every field: its template, lead,
  signals, labels, grounding, contract, intent, catalogue line and verb-override entry follow from it, and
  `tests/unit/lin-4467-stage-kind-record.test.js` fails on a missing field. The public catalogue is generated
  (`node scripts/gen-llms-catalogue.mjs`). A kind in `SPINE` (`lib/run-view.js`) also moves the run page's "n of N", the
  session and task-page goldens (`UPDATE_RENDER_SESSION_GOLDEN=1`, `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`) and the
  E2E count pins; read the golden diff before accepting it (LIN-4437).
- `formatCiGateCheck` (`lib/prompt-formatters.js`) renders in implementation, review and close-out:
  a rule for one stage gets its own formatter beside it. Prove the others unchanged by rendering every
  kind, fresh and fix round, at HEAD and on the branch, not by the budget test, whose ceilings are caps (LIN-4441).
- `tests/fixtures/lin-4467-witness.json` stays as a ratchet: a sha256 for all 40 real-context renders, fresh and fix
  round. A rendered-text change regenerates it (`node tests/fixtures/lin-4467-witness.js --write`) beside the byte
  ceilings and the change log; its byte counts are the real-context witness the budget's caps are not (LIN-4469).
- The blind-read scan in `tests/unit/stage-kind-tables.test.js` reads `git ls-files`: a new file is not
  scanned until it is committed, so a local pass before the first commit proves nothing about it (LIN-4467).
- `lib/prompts/area-registry-path.js` imports nothing (`tests/unit/area-map-placement.test.js`); leaves import it (LIN-4470).

## Waiting

Twelve entries remain. Each one names its file, why it is not scheduled, and its owner or blocker. Settled, moved and
kept are counted apart in LIN-4470's PR and measurement (`docs/areas/README.md`: a move is not an exit).

- `lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in for John's "per task
  breakdown of options"; its size words are unexplained. Owner: John, who decides whether the policy stands.
  (John, LIN-4393.)
- `lib/call-budget.js`: the budget rule is untested live on anthropic/claude-haiku-5.5; before moving a call there,
  replay LIN-4352's snapshot through `scripts/replay-brief.mjs`: block [2] WHOLE, four sections, finishReason=stop, any
  retry's reasoning bound accepted. REFUSED: change the rule first. Blocker: that live replay, run by a person. Owner:
  John (LIN-4358).
- `lib/call-budget.js`: the split: `resolveReasoningBudget` and `isReasoningModel` stay in `lib/openrouter.js`; tool hops
  and the routing pair get the budget, not the retry. Not scheduled: no ticket takes it, and the area reads (CG/CH) named
  it as the next move for this file. Owner: this area, which needs a ticket to take it. (Area reads CG/CH.; `canReason`
  left this entry in LIN-4470: it had test callers only.)
- `lib/prompt-template-defs.js` (six of the spellings): `docs/areas/` is spelled in 19 lines across 12 code files (`lib/` and `scripts/`,
  JavaScript files only; `git grep -c docs/areas -- lib routes public server.js scripts` gives 28 lines in 14 files, the
  other two being Markdown under `scripts/`). `lib/periodicals.js`, which this entry cited first until 14 Nov., spells it
  nowhere (recounted, Drift & Coherence Review, 14 Nov.; `docs/reviews/drift-coherence-review-2026-11-14.md`). The leaves spell the directory and the registry's file
  name once each: `NOTES_DIR` and `REGISTRY_FILE` in `lib/prompts/area-registry-path.js`, which derives `REGISTRY_PATH`
  from them and which `lib/prompts/area-note-format.js` re-exports (LIN-4470). The prose spellings remain, mostly prompt text that names the registry
  for a reader. Moving the notes means editing them. Blocker: a move of the notes directory itself, which no ticket asks
  for. (Drift & Coherence Review, 10 and 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
- `lib/periodicals.js`: two sizes of move: a byte ceiling for Periodical prompts (+18.8% in the window, 185,952 to
  220,882 B, 10 Nov.), and an index or series archive for `docs/reviews/` (109 top-level reports, 88 MB, 10 Nov.). At
  HEAD the Periodical prompts are pinned by a sha256 tripwire only (`tests/unit/lin-4313-periodical-prompt-bytes.test.js`)
  and have no byte ceiling. Kept: a ceiling is a budget decision, to be taken from bytes measured after piece 5's re-pin
  (LIN-4469); the archive has no owner yet. (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)
- `lib/library.js`: summaries come from first-paragraph position, so an opening image's alt text can become the summary
  and every shelf rewrite churns `tests/fixtures/library-doc-summaries.json`; a `summary:` front-matter field would end
  both, but changes every doc's summary source. Kept: it is the library's own source, not a stage's, and no shelf doc
  needs it yet. Owner: Library. (Survey global, LIN-4428.)
- `lib/periodicals.js`: a reading's finding with no file in an area to cite goes to the closing comment, "never in a
  ticket", a live secret included, while `CONSEQUENCE_TEST` (`lib/prompts/leftover-words.js`) sends a find that touches
  safety to a ticket. The two rules in this area answer the live-secret case oppositely; having Periodicals render the
  gate needs John's ruling on that case first. Owner: John. (LIN-4401, LIN-4431.)
- `lib/prompts/leftover-words.js`: since `CONSEQUENCE_TEST` (LIN-4401), outside finds gather as Waiting entries in other
  areas' notes where tickets used to be filed. LIN-4414's one retirement per build drains only the areas a build touches,
  so rarely touched notes (other-features) will grow. Kept as an observation: the honest measure is each note's Waiting
  count, which CI prints, and no fix is scheduled. (LIN-4431.)
- `lib/prompt-template-defs.js`: the blind read's own area sentence (the `blind-read` template: "A file's area is the first
  area in ...") keeps its own words, as piloted (LIN-4437). Kept: re-piloting it is a person's run; owner: John. Every
  other spelling of the lookup renders `areaLookup` (LIN-4469). (LIN-4436 leftovers; LIN-4469.)
- `lib/prompt-formatters.js`: `formatLocalTestRule` names this repo's runner command
  (`node scripts/run-unit-tests.mjs tests/unit/<files>`) in a template that also drives other repos, and `CLAUDE.md`
  spells the same rule. Blocker: a per-repo test-command setting, which is a product call. Owner: John. (LIN-4441 leftovers.)
- `lib/periodicals.js`: the policy, whether a review may run a tool the repo commits, is worded per template. Drift &
  Coherence and Recent Headwinds say "introducing no new tooling", Code Quality says "introduce no new tooling", and
  Stability says "introducing no tooling beyond what the repo commits"; Seams & Tangles allows committed tools in its own
  bullets. The search clause itself is one spelling now (`committedSearch`, LIN-4469; it lives beside its bullets in
  `lib/periodicals.js`). Deciding the policy is one rule that re-pins every template that states it. Owner: John, a policy
  call. (LIN-4424 blind read.)
- `lib/prompts/leftover-words.js`: the retirement line's words and rule have one home in this repo: the leaf, and its
  checker `lib/dispatch-leftover-answer.js`, which reads the one cited-path predicate (`lib/prompts/area-note-format.js`,
  LIN-4470). Kept, in simple-dispatcher, another repository: its README, its `docs/areas/README.md` and its guard restate
  the three forms and the cited-path rule, and its waiting entries also leave on "a follow-up is filed for it", which this
  repo's README does not say. That repo's owner changes its copies; this repo does not edit them. The refusal table in
  `docs/proxy-integration.md` stays restated on purpose: it is the API contract's. (Drift & Coherence Review, 13 Nov.;
  `docs/reviews/drift-coherence-review-2026-11-13.md`.)
- `lib/recommendation-facts.js`: `assembleTrailFacts` builds `prUrls` from every comment's PR links, with no kind filter,
  beside the one landing (`readTrail().landing`, `lib/run-trail.js`, whose `COMMENT_KINDS` gives blind reads, Survey
  reports and area reads no landing). That list feeds the selector's "PRs linked on the trail" line and the look-first
  gate's "has a PR" (`lib/recommendation-look-first.js`). So a `## Survey open-0` report that cites a related PR turns the
  look-first route off: survey-place and scoping are skipped while the landing is empty (reproduced,
  `docs/reviews/_evidence-2026-11-14-drift/look-first-survey-pr-repro.mjs`). `lib/run-trail.js`'s header says the prompt is
  a view of the trail and cannot disagree. Fix: read the PR list from the trail (the landing, or the table's PR column),
  then re-pin the selector facts. The other side is Runs & dispatch (`lib/run-trail.js`). (Drift & Coherence Review,
  14 Nov.; `docs/reviews/drift-coherence-review-2026-11-14.md`.)
- `lib/prompts/stage-kinds.js`: each record's `catalogue.group` decides the Default and More split that
  `scripts/gen-llms-catalogue.mjs` writes into `public/llms.txt`, while the split the pages show is `DEFAULT_PROMPT_KEYS`
  (`lib/render-prompt-opts.js`). They agree today and no test links them, so changing the UI's defaults leaves the
  generated catalogue wrong while its byte-for-byte test stays green. Read one from the other. Also,
  `docs/architecture/source-map.md` says every per-kind table is a view of the record, but about eight kind-keyed tables
  remain (`GENERATE`, `BUCKET_OF_KIND`, `FIRST_PASS_KINDS`, `JOBS`, `SPINE` and others, each listed with a reason by
  `tests/unit/stage-kind-tables.test.js`), and each `catalogue.line` retypes the kind's display name. (Drift & Coherence
  Review, 14 Nov.; `docs/reviews/drift-coherence-review-2026-11-14.md`.)
- `lib/prompts/prompt-context.js`: its header says every prompt surface that renders a stage from a fetched context hands
  `generatePrompt` this one projection, so a new field reaches all of them from here. The routed and code-routed
  recommendation (`composeRoutedRecommendation`, `lib/openrouter.js`) passes `prepareRecommendationInput`'s hand-built
  superset instead (`lib/recommendation-input.js`, adding `focusedChild`, `runs` and `allRuns`), which a test pins to carry
  every projected field. So a new field is still two edits, and a template that read `runs` would render differently on
  recommend than on the pinned path. Correct the header, or derive the superset from the projection. (Drift & Coherence
  Review, 14 Nov., second read; `docs/reviews/drift-coherence-review-2026-11-14.md`.)
