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
- The `## As asked` heading and `BRIEF_HINT` have one owner, `lib/records/words.js`: import them,
  never retype the heading (LIN-4362, LIN-4536).
- The blind read's kind, heading and verdict words have one owner, `lib/prompts/blind-read-words.js`;
  its verdict prose is built there. Import them. The scan
  in `tests/unit/stage-kind-tables.test.js` fails on a literal elsewhere, except as a row key of a table it
  lists; the stage kinds' tables are views of `STAGE_KINDS`, so that list names the record (LIN-4466, LIN-4470).
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
- Words banning a kind of how do not hold it, nor does a text guard (LIN-4369). Hold the reader's
  side with a record; a `when` naming a facts value imports it (`SIZE_NOT_DECIDED`, LIN-4542).
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
- A prompt that sends a stage to records names the read (the query): the brief shows only the last stage's run (LIN-4533).
