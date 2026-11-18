#!/usr/bin/env bash
# Recreates walks/5/replay-4469/store.json from empty (walk 5 model): LIN-4448 and LIN-4469 as they stood just
# before LIN-4469's first stage (implementation) was dispatched, 2026-11-13T22:39:18.494Z. Generated; see seed-log.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LAYER="$HERE/../model/layer.mjs"
STORE="$HERE/store.json"; export LAYER_STORE="$STORE"
rm -f "$STORE"
L() { node "$LAYER" "$@"; }
idof() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))'; }
# substitute @@NAME@@ with the shell variable NAME (record ids captured earlier)
sub() { local s="$1" v; for v in $(grep -o "@@[A-Z0-9_]*@@" <<<"$s" | sort -u | tr -d @); do s="${s//@@$v@@/${!v}}"; done; printf "%s" "$s"; }

# Area: LLM & prompts (registry docs/areas/areas.json @ b937237a4), by Harbour. Its lessons and Waiting entries,
# docs/areas/llm-and-prompts.md @ b937237a4, verbatim (wrapped lines joined): 20 lessons, 23 Waiting.
A_LLM=project
P=$(cat <<'J2'
{"says": "Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`): text grows only with its ticket and reason beside the ceiling and `FROZEN_TOTAL_BYTES`; old reasons go to \"Ceiling history\" in `scripts/prompt-template-change-log.md`.", "checked-at": "b937237a4"}
J2
)
P=$(sub "$P")
A_LLM_L1=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J3'
{"says": "Grounding lists in `lib/prompt-formatters.js` are shared (`WORK` serves several stages, `GROUNDING_NOTES` unknown kinds): give one stage its own list (LIN-4371).", "checked-at": "b937237a4"}
J3
)
P=$(sub "$P")
A_LLM_L2=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J4'
{"says": "Keep scoping and both Survey renders byte-identical unless a ticket is about them (replays compare them, LIN-4369).", "checked-at": "b937237a4"}
J4
)
P=$(sub "$P")
A_LLM_L3=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J5'
{"says": "The Surveys get no area notes pointer: survey-place reads no shape reports, which feed the notes. Scoping cites its pointer in its final message; both share `AREA_NOTES_WHERE` (LIN-4346).", "checked-at": "b937237a4"}
J5
)
P=$(sub "$P")
A_LLM_L4=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J6'
{"says": "`lib/prompt-template-defs.js` and the budget test change in almost every merge: rebase, then re-measure. Its fixture passes no context (the empty-context branch), so dropping one can raise a ceiling while real renders shrink (LIN-4393).", "checked-at": "b937237a4"}
J6
)
P=$(sub "$P")
A_LLM_L5=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J7'
{"says": "The `## As asked` block's words have one owner, `lib/as-asked.js`: import its spellings, never retype the heading or end line (LIN-4362).", "checked-at": "b937237a4"}
J7
)
P=$(sub "$P")
A_LLM_L6=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J8'
{"says": "The blind read's kind, heading and verdict words have one owner, `lib/prompts/blind-read-words.js`; the verdict prose (\"better, the same or worse\") is built there from the words. Import them; the scan in `tests/unit/stage-kind-tables.test.js` fails on a literal elsewhere, but a row key of a table it lists. Prove a move byte-identical by rendering every kind, fresh and fix round (LIN-4466).", "checked-at": "b937237a4"}
J8
)
P=$(sub "$P")
A_LLM_L7=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J9'
{"says": "The code routes' order lives once, in `CODE_ROUTES` (`lib/code-routes.js`). A new route is an entry with its `emits`, plus the one \"Code route order\" line in `docs/architecture/prompt-system.md` and in `docs/architecture/source-map.md`; `tests/unit/lin-4465-code-routes.test.js` fails until all three agree. Point at the list; never restate the order or count the routes in prose (LIN-4465).", "checked-at": "b937237a4"}
J9
)
P=$(sub "$P")
A_LLM_L8=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J10'
{"says": "`lib/prompt-template-defs.js` cannot import what imports `lib/prompt-templates.js` (a cycle): shared words live in an import-free leaf, as `lib/prompts/leftover-words.js` (LIN-4376) and `lib/prompts/autopilot-precedence.js` (never restate a rank; LIN-4382).", "checked-at": "b937237a4"}
J10
)
P=$(sub "$P")
A_LLM_L9=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J11'
{"says": "Prompt words banning a kind of how do not hold it (LIN-4369's replay: closing one channel moved it to the next). Hold the shape in code or a test (`SIZE_RECORD_SHAPE`, `lib/size-of-move.js`, arm 3) or hold the reader's side (arm 4).", "checked-at": "b937237a4"}
J11
)
P=$(sub "$P")
A_LLM_L10=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J12'
{"says": "A stage lead's first sentence is the selector's purpose line: changing it means new router snapshots, `scripts/eval/meta-prompt.baseline.txt` and routing ceiling (LIN-4369).", "checked-at": "b937237a4"}
J12
)
P=$(sub "$P")
A_LLM_L11=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J13'
{"says": "`lib/prompts/autopilot-precedence.js`: check real rows reach a server guard before prompt text bypasses it (LIN-4349). A scoped run's Periodical is opt-in by goal: no tail, no flag (LIN-4415).", "checked-at": "b937237a4"}
J13
)
P=$(sub "$P")
A_LLM_L12=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J14'
{"says": "`lib/periodicals.js`: close-out merges a Periodical's PR and sets Done as for any task; give no Periodical its own merge rule: notes are prompt input (LIN-4390). The rule is retyped in five files; only a test links them.", "checked-at": "b937237a4"}
J14
)
P=$(sub "$P")
A_LLM_L13=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J15'
{"says": "Model facts come from the OpenRouter catalog: add no model list or rate (LIN-4358); tests seed `tests/unit/helpers/pinned-catalog.js`.", "checked-at": "b937237a4"}
J15
)
P=$(sub "$P")
A_LLM_L14=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J16'
{"says": "`lib/library.js` takes a shelf doc's summary by position (`firstParagraphAfterTitle`): a paper that opens with a figure keeps its alt text under 12 words, or the alt text becomes the summary; a rewritten first paragraph re-pins `tests/fixtures/library-doc-summaries.json` (LIN-4428).", "checked-at": "b937237a4"}
J16
)
P=$(sub "$P")
A_LLM_L15=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J17'
{"says": "A blind reader's limits are instructions, not access: with the repository checked out it can still see commit subjects (`git worktree add` prints the head's) and area notes. Both slipped, harmlessly, in the LIN-4436 pilot. Code hands a blind stage SHAs and PR URLs, never a PR body or commit log.", "checked-at": "b937237a4"}
J17
)
P=$(sub "$P")
A_LLM_L16=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J18'
{"says": "`lib/periodicals.js`: Stability defers to a repo's committed declaration of its measures and names none (LIN-4424): change Harbour's measures in `docs/reviews/stability-measures/README.md` and its script, never in the shared template; a test links the bullet's list to that README.", "checked-at": "b937237a4"}
J18
)
P=$(sub "$P")
A_LLM_L17=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J19'
{"says": "A new stage kind is one record in `lib/prompts/stage-kinds.js`, with every field: its template, lead, signals, labels, grounding, contract, intent, catalogue line and verb-override entry follow from it, and `tests/unit/lin-4467-stage-kind-record.test.js` fails on a missing field. The public catalogue is generated (`node scripts/gen-llms-catalogue.mjs`). A kind in `SPINE` (`lib/run-view.js`) also moves the run page's \"n of N\", the session and task-page goldens (`UPDATE_RENDER_SESSION_GOLDEN=1`, `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`) and the E2E count pins; read the golden diff before accepting it (LIN-4437).", "checked-at": "b937237a4"}
J19
)
P=$(sub "$P")
A_LLM_L18=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J20'
{"says": "`formatCiGateCheck` (`lib/prompt-formatters.js`) renders in implementation, review and close-out: a rule for one stage gets its own formatter beside it. Prove the others unchanged by rendering every kind, fresh and fix round, at HEAD and on the branch, not by the budget test, whose ceilings are caps (LIN-4441).", "checked-at": "b937237a4"}
J20
)
P=$(sub "$P")
A_LLM_L19=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J21'
{"says": "The blind-read scan in `tests/unit/stage-kind-tables.test.js` reads `git ls-files`: a new file is not scanned until it is committed, so a local pass before the first commit proves nothing about it (LIN-4467).", "checked-at": "b937237a4"}
J21
)
P=$(sub "$P")
A_LLM_L20=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J22'
{"to": "@@A_LLM@@", "says": "`lib/recommendation-input.js`: the pinned-kind and in-app renders (`lib/dispatch-entrance.js`, `routes/proxy-compute.js` twice, `routes/workspace-api-prompts.js`) build context by hand: a new field must reach all five (LIN-4368 missed one; LIN-4393 leftovers.)"}
J22
)
P=$(sub "$P")
A_LLM_W1=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J23'
{"to": "@@A_LLM@@", "says": "`lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in for John's \"per task breakdown of options\"; its size words are unexplained. (John, LIN-4393.)"}
J23
)
P=$(sub "$P")
A_LLM_W2=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J24'
{"to": "@@A_LLM@@", "says": "`lib/prompts/stage-kinds.js`: `CUT` writes the closing contract's token order (`DECISION:` before `BLOCKED:`) into a scope line beside `ASK`. Its \"cut\" and the plan-review and review \"narrowing\" (`lib/completion-signals.js`) name one thing; no test links them. (John, 8 Nov.)"}
J24
)
P=$(sub "$P")
A_LLM_W3=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J25'
{"to": "@@A_LLM@@", "says": "`lib/prompts/stage-kinds.js`: one record per stage kind (LIN-4467). The per-kind tables that stay, each with its owner and reason: `JOBS` (`lib/llm-jobs.js`), pure data on purpose so its census test is not vacuous (19 of its 39 rows are not template kinds); the route and writes pins (`tests/unit/lin-4253-stage-traits.test.js`), hand-typed on purpose, the one check not read back from the record; `SPINE`, `BUCKET_OF_KIND`, `FIRST_PASS_KINDS` and `OFF_SPINE_KINDS` (Runs & dispatch, A13); the six non-template labels and the two orchestration step words (`lib/run-view.js`), which no record carries; the byte ceilings (`tests/unit/prompt-size-budget.test.js`), which cover the registry. `VIRTUAL_PROMPTS` (`lib/workflow-config.js`) is gone: its one reader is the record's key. (Survey tally, LIN-4248; piece 3, LIN-4467.)"}
J25
)
P=$(sub "$P")
A_LLM_W4=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J26'
{"to": "@@A_LLM@@", "says": "`lib/prompts/stage-kinds.js`: the one-record refactor's witness (`tests/fixtures/lin-4467-witness.js`) stays in the suite as a permanent test. It pins a sha256 for all 40 renders and for each table, so a later wording change in any stage must regenerate `tests/fixtures/lin-4467-witness.json` as well as move the byte ceilings and the change log; and its fix-round mode differs from fresh for `implementation` only. Decide whether to retire it once piece 5 (LIN-4469) has re-pinned, fold it into `tests/unit/prompt-size-budget.test.js`, or keep it as a ratchet: a decision about the test suite, not a fix. (LIN-4467 blind read.)"}
J26
)
P=$(sub "$P")
A_LLM_W5=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J27'
{"to": "@@A_LLM@@", "says": "`lib/call-budget.js`: the budget rule is untested live on anthropic/claude-haiku-5.5; before moving a call there, replay LIN-4352's snapshot through `scripts/replay-brief.mjs`: block [2] WHOLE, four sections, finishReason=stop, any retry's reasoning bound accepted. REFUSED: change the rule first. (John, LIN-4358.)"}
J27
)
P=$(sub "$P")
A_LLM_W6=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J28'
{"to": "@@A_LLM@@", "says": "`lib/call-budget.js`: split: `resolveReasoningBudget`/`isReasoningModel` stay in `lib/openrouter.js`; tool hops and the routing pair get the budget, not the retry; `canReason` has test callers only. (Area reads CG/CH.)"}
J28
)
P=$(sub "$P")
A_LLM_W7=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J29'
{"to": "@@A_LLM@@", "says": "`lib/openrouter.js`: `SUGGESTED_MODEL_IDS` and `DISPATCH_MODEL_SUGGESTIONS` (`lib/model-routing-harnesses.js`) repeat ids by hand, unchecked; the first is also the cold-catalog fallback. (Area reads CG/CH.)"}
J29
)
P=$(sub "$P")
A_LLM_W8=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J30'
{"to": "@@A_LLM@@", "says": "`lib/periodicals.js`: `docs/areas/` is spelled in 26 lines across 11 code files (`lib/`, `routes/`, `public/`, `server.js`, `scripts/`), up from 17 in 10 at the 10 Nov reading, and two leaves now spell the directory: `REGISTRY_PATH` (`lib/prompts/area-registry-path.js`) and `NOTES_DIR` (`lib/prompts/area-note-format.js`, LIN-4420), neither derived from the other. Moving the notes means editing both leaves and the prose. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`; count, Documentation Review; recounted, Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J30
)
P=$(sub "$P")
A_LLM_W9=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J31'
{"to": "@@A_LLM@@", "says": "`lib/periodicals.js`: two sizes of move: a ceiling for Periodical prompts (+18.8% in the window, 185,952 to 220,882 B; only a sha256 tripwire), and an index or series archive for `docs/reviews/` (109 top-level reports, 88 MB). (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)"}
J31
)
P=$(sub "$P")
A_LLM_W10=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J32'
{"to": "@@A_LLM@@", "says": "`lib/prompt-formatters.js`: eight stage kinds are told notes bind, yet `tests/unit/area-notes.test.js` checks shape only and close-out writes review-worded entries to main unreviewed: no content boundary on who adds a Lesson. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)"}
J32
)
P=$(sub "$P")
A_LLM_W11=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J33'
{"to": "@@A_LLM@@", "says": "`lib/prompts/autopilot-kickoff.js`: a dispatch holder's `goal` is \"Goal from the human\" (ranked first), a periodical mint `note` \"the operator\" (`lib/periodicals.js`): attribute both to the minting token. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)"}
J33
)
P=$(sub "$P")
A_LLM_W12=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J34'
{"to": "@@A_LLM@@", "says": "`lib/library.js`: summaries come from first-paragraph position, so an opening image's alt text can become the summary and every shelf rewrite churns `tests/fixtures/library-doc-summaries.json`; a `summary:` front-matter field would end both, but changes every doc's summary source. (Survey global, LIN-4428.)"}
J34
)
P=$(sub "$P")
A_LLM_W13=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J35'
{"to": "@@A_LLM@@", "says": "`lib/periodicals.js`: a reading's finding with no file in an area to cite goes to the closing comment, \"never in a ticket\", a live secret included, while `CONSEQUENCE_TEST` (`lib/prompts/leftover-words.js`) sends a find that touches safety to a ticket. The two rules in this area answer the live-secret case oppositely; having Periodicals render the gate needs John's ruling on that case first. (LIN-4401, LIN-4431.)"}
J35
)
P=$(sub "$P")
A_LLM_W14=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J36'
{"to": "@@A_LLM@@", "says": "`lib/prompts/leftover-words.js`: since `CONSEQUENCE_TEST` (LIN-4401), outside finds gather as Waiting entries in other areas' notes where tickets used to be filed. LIN-4414's one retirement per build drains only the areas a build touches, so rarely touched notes (other-features) will grow; their Waiting counts are the honest measure. (LIN-4431.)"}
J36
)
P=$(sub "$P")
A_LLM_W15=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J37'
{"to": "@@A_LLM@@", "says": "`lib/prompt-template-defs.js` (retrospective-audit Reporting) and `lib/periodicals.js` (`areaNotesRoutes`) each state the docs-only notes-PR rule in their own words; one shared constant in `lib/prompts/leftover-words.js` would make it one, at the cost of re-pinning the 13 Periodical prompt hashes. (LIN-4432.)"}
J37
)
P=$(sub "$P")
A_LLM_W16=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J38'
{"to": "@@A_LLM@@", "says": "`lib/prompts/leftover-words.js`: the first-match area lookup is spelled three ways: `CONSEQUENCE_TEST`'s \"first match wins\" parenthetical, `docs/areas/README.md` (\"take the first area with a pattern that matches its path\") and the blind-read prompt's own sentence (`lib/prompt-template-defs.js`, the `blind-read` template), which shipped as piloted (LIN-4437), so it was not retyped after the pilot. One constant in the leaf would make it one, at the cost of re-piloting that sentence. (LIN-4436 leftovers.)"}
J38
)
P=$(sub "$P")
A_LLM_W17=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J39'
{"to": "@@A_LLM@@", "says": "`lib/prompt-formatters.js`: `formatLocalTestRule` names this repo's runner command (`node scripts/run-unit-tests.mjs tests/unit/<files>`) in a template that also drives other repos, and `CLAUDE.md` spells the same rule; a repo-supplied test command would make the line right elsewhere and give it one spelling. (LIN-4441 leftovers.)"}
J39
)
P=$(sub "$P")
A_LLM_W18=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J40'
{"to": "@@A_LLM@@", "says": "`lib/periodicals.js`: \"search the repo for a committed tool (no path is written here) and run it\" is spelled four times: Drift & Coherence's census bullet, Seams & Tangles' two bullets and Stability's declaration bullet. One shared helper would make it one, at the cost of re-pinning those three templates' hashes. (LIN-4424 leftovers; Survey global.) The rule it answers, whether a review may run a tool the repo commits, is itself worded per template: Stability's run bullet says \"introducing no tooling beyond what the repo commits\", while Recent Headwinds (which reads the same rework and churn trajectory) and Drift & Coherence still say \"introducing no new tooling\", Code Quality says \"introduce no new tooling\", and Seams & Tangles allows committed tools in its own bullets. No `periodicalBullet` helper owns it; deciding it is one rule re-pins every template that states it. (LIN-4424 blind read.)"}
J40
)
P=$(sub "$P")
A_LLM_W19=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J41'
{"to": "@@A_LLM@@", "says": "`lib/model-routing-harnesses.js`: a dispatch record's `model` names the routed id (\"anthropic/claude-opus-4.8\" for the `opus` route), but the claude-code harness runs a Claude id by its family token (`isModelRunnableOn`, `CLAUDE_MAPPABLE_MODEL_FAMILIES`), and on blind-read dispatches d9bdf6d8, cced07ee and 0399b2e2 it ran `claude-opus-5-5`, so a record can misname the model that ran. Cost is already priced from the model the worker reports. Waiting: make the record carry the model the worker reports, or update the routed id. (LIN-4396 review.)"}
J41
)
P=$(sub "$P")
A_LLM_W20=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J42'
{"to": "@@A_LLM@@", "says": "`lib/prompts/leftover-words.js`: the retirement line's words have one home and one checker (`lib/dispatch-leftover-answer.js`), but which entry to settle (the busiest touched area, else another) and the three forms are restated by hand in `docs/areas/README.md`, simple-dispatcher's docs/areas/README.md, `docs/proxy-integration.md` (with the refusal kinds) and `docs/architecture/dispatch-and-proxy.md`, and the verbatim guard reads only `lib/` and `routes/`. simple-dispatcher's README says a waiting entry also leaves when \"a follow-up is filed for it\", where this README says only when the consequence test sends it to a ticket. A cross-repo seam; simple-dispatcher's side is named here, not edited. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J42
)
P=$(sub "$P")
A_LLM_W21=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J43'
{"to": "@@A_LLM@@", "says": "`lib/prompts/area-note-format.js`: the one reading of a waiting entry in code does not hold what a cited path is; that rule is in the guard (`tests/unit/area-notes.test.js`, a listed extension), in `lib/dispatch-leftover-answer.js` (any one to six characters, its comment calling it the guard's rule) and in simple-dispatcher's guard. A retirement line can name a path the guard would not read as one. Borderline. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)"}
J43
)
P=$(sub "$P")
A_LLM_W22=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J44'
{"to": "@@A_LLM@@", "says": "`lib/prompts/blind-read-words.js`: the blind read's kind has a constant and a scan, but every other kind in the same lists is still a literal (`SPINE` in `lib/run-view.js`, the `COMMENT_KINDS` rows in `lib/run-trail.js`, `CODE_ROUTES` in `lib/code-routes.js`), so the next stage added has two conventions to choose from. Decide whether every kind gets a constant or only this one. LIN-4467 made one record per stage kind (`lib/prompts/stage-kinds.js`) but keys it by literals, so the question stands; the record is where a constant per kind would live. (LIN-4466 blind read; LIN-4467 leftovers.)"}
J44
)
P=$(sub "$P")
A_LLM_W23=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)

# Area: Agent API (proxy) (registry docs/areas/areas.json @ b937237a4), by Harbour. Its lessons and Waiting entries,
# docs/areas/agent-api.md @ b937237a4, verbatim (wrapped lines joined): 8 lessons, 11 Waiting.
A_API=project
P=$(cat <<'J46'
{"says": "`proxyLimiter` runs before `authenticateProxyToken` on purpose, so its key may trust a bearer only after auth has proved it (`provenCredentials` in `routes/proxy.js`); a key from an unverified bearer gives each junk bearer a fresh bucket and floods reach the token store (LIN-4378). The limiters skip under `NODE_ENV=test`, so a limiter test drives the real chain with it flipped off, as `tests/unit/lin-4378-proxy-limiter-per-credential.test.js` does.", "checked-at": "b937237a4"}
J46
)
P=$(sub "$P")
A_API_L1=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J47'
{"says": "A recommend surface must not offer what the verb refuses: a rule for recommend-and-dispatch goes in `CODE_ROUTES` (`lib/code-routes.js`, iterated by `codeRouteOf` in `lib/openrouter.js`), which GET /recommend (`routes/proxy-compute.js`) and the task page also reach; a descent-arm check (`lib/dispatch-entrance.js`) covers one surface, without run facts. A caller's bypass rides the call options (`skipLiveWait`), never the recommendation context (LIN-4392).", "checked-at": "b937237a4"}
J47
)
P=$(sub "$P")
A_API_L2=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J48'
{"says": "`/cost/:identifier` (`routes/proxy-compute.js`) is pinned by frozen baselines. A change to its window or shape moves `tests/fixtures/cost-replay/expected-changes.json` (W9 checks paths, not values, so pin moved values in `tests/unit/cost-read.test.js`), `tests/fixtures/cost-replay/goldens-lin4197.json` (amend its header with the reason; record with `tests/fixtures/cost-replay/record-lin4197.mjs`) and the `docs/passage-runner-prompt.md` drift guard. `tests/fixtures/cost-replay/goldens.json` stays the baseline: re-recording it erases the change list (LIN-4404).", "checked-at": "b937237a4"}
J48
)
P=$(sub "$P")
A_API_L3=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J49'
{"says": "A check on comment bodies keys on the comment's opening line, never on any line: reviewers write the same `### Leftovers` heading mid-comment, so matching any heading line would refuse the verdict that gates merge (`routes/proxy-writes.js` `refusedByLeftoverAnswer`; caught at LIN-4414's plan review). Test it against real comments, review verdicts included (`tests/unit/dispatch-leftover-answer.test.js`).", "checked-at": "b937237a4"}
J49
)
P=$(sub "$P")
A_API_L4=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J50'
{"says": "A format check on an optional create or PATCH field refuses (400); it is never the field's `present` gate. As a `present` gate it skipped the value, and the write succeeded without it: a Jira key or a Linear identifier in `parentId` vanished. Check presence first, then the writable contract, then the format (`routes/proxy-writes.js`, LIN-4451 create, LIN-4452 PATCH).", "checked-at": "b937237a4"}
J50
)
P=$(sub "$P")
A_API_L5=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J51'
{"says": "A typed error a provider method gains reaches a caller only if every route calling that method maps it: `refs`/`partial` in the proxy write `SPEC`, and each session or feedback catch by hand. Provider tests passed while all three create lanes answered a bare 500 for a landed create. Pin it at the route boundary (`routes/proxy-writes.js`; `tests/unit/lin-4452-create-lane-envelope.test.js`).", "checked-at": "b937237a4"}
J51
)
P=$(sub "$P")
A_API_L6=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J52'
{"says": "Every proxy write mount names its operation: `requireWriteScope('<op>')` for a readWrite route, `requireStageWrite('<op>')` for a grant-gated one, with `<op>` in `STAGE_WRITE_OPS` (`lib/stage-writes.js`; the gate is `lib/stage-write-gate.js`). A stamped token is refused any operation its allowance does not list, so a route nobody named would be refused to a reading stage without a word, and an unnamed name throws at mount. A new write route adds its operation to that list and a row to `CENSUS` in `tests/unit/lin-4468-stage-write-allowance.test.js`, or the census fails (LIN-4468).", "checked-at": "b937237a4"}
J52
)
P=$(sub "$P")
A_API_L7=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J53'
{"says": "A token minted for a stage carries its `writes` and ticket, or has a reason not to. Pass both into the mint helpers (`lib/proxy-preamble.js`), or read them from the row (`lib/item-stage-stamp.js`). A wake, immediate or held, takes the stamp of the session it resumes, the parent, not the row that reported (`stampForWakeParent`; a held release gets the producing build's id from the store). A mint with neither is unrestricted, which is right only for a person's or a `custom` mint, listed with its reason in `tests/unit/dispatch-entrance-mint-sweep.test.js`. The refire broker minted unrestricted tokens for read-only rows because its mint was a bare `createToken`, which no helper-name search finds (LIN-4468).", "checked-at": "b937237a4"}
J53
)
P=$(sub "$P")
A_API_L8=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J54'
{"to": "@@A_API@@", "says": "`routes/proxy-compute.js`: the recap/brief GET and POST handlers repeat one error-mapping chain and match provider errors by an \"OpenRouter\" substring; one helper beside `failureOf`, keyed on an error code, would hold \"whole or loud\". (Review, 8 Nov, on LIN-4358; area reads CG/CH.)"}
J54
)
P=$(sub "$P")
A_API_W1=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J55'
{"to": "@@A_API@@", "says": "`lib/proxy-instructions.js`: the rate-limit rule (60/min per token; on a 429 wait `Retry-After`) is restated in ~eight places (quote one); it keys on the proven credential, else the IP (`routes/proxy.js`), so \"per token\" is wrong before auth. (Area reads CE/CF, LIN-4378; Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)"}
J55
)
P=$(sub "$P")
A_API_W2=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J56'
{"to": "@@A_API@@", "says": "`routes/proxy-reads.js`: GET /issues returns no `createdAt`, so the stability measure's tickets-minted row bisects single-issue reads for it (`scripts/stability-measures-tracker.mjs` `idSpanSearch`: 22 probes on the 8 Nov window, with 404, trashed and bracket edge cases). A `createdAt` on the list, or a created-before filter, would replace them with one read. (LIN-4421 leftovers; Survey global.)"}
J56
)
P=$(sub "$P")
A_API_W3=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J57'
{"to": "@@A_API@@", "says": "`routes/proxy-writes.js`: \"no step may change them\" (the `## As asked` words) is written twice, in `AS_ASKED_LEAD` and in `BRIEF_HINT` (`lib/as-asked.js`); the census pins the markers, not this rule; `lib/proxy-instructions.js` spells \"a day\" beside `LANDED_MIN_GAP_MS`. Borderline, LOW. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)"}
J57
)
P=$(sub "$P")
A_API_W4=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J58'
{"to": "@@A_API@@", "says": "`routes/proxy.js`: recommend-and-dispatch's `skipLiveWait` exempts any `followUpTo`, so a follow-up into an *ended* session of another stage proceeds while one is live. Requiring `followUpTo` in the live row's lineage needs a lineage read per hop (`lib/dispatch-entrance.js` sets it; wait and race: `lib/run-live-wait.js`). (LIN-4392 review.)"}
J58
)
P=$(sub "$P")
A_API_W5=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J59'
{"to": "@@A_API@@", "says": "`lib/proxy-instructions.js`: the catalog omits the `leftover` row kind and the hold on a build's DONE wake until its leftover row ends (`lib/dispatch-leftover.js`; the architecture doc has it). Its `kind` contract, \"prompt-template keys plus custom\", misses 23 `DISPATCH_KINDS` and the `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`). (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)"}
J59
)
P=$(sub "$P")
A_API_W6=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J60'
{"to": "@@A_API@@", "says": "`lib/proxy-instructions.js`: the guide (`docs/proxy-integration.md`) lacks eight routes the code serves (seven `model-routing`, `POST runner/usage/:id`, which the kit's contract also has no row for); the catalog lacks three snapshot and prompt routes. Generate or test them from the catalog: a size of move. (The verb-override list is derived from the stage-kind records since LIN-4467.) (Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)"}
J60
)
P=$(sub "$P")
A_API_W7=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J61'
{"to": "@@A_API@@", "says": "`lib/proxy-instructions.js`: `recommend` and `recommend-and-dispatch` give a fresh, unsized ticket survey-task, survey-place, then scoping (`lib/recommendation-look-first.js`), and a live step `prompt: null` with `liveWait`. The guide's GET /recommend omits this (the catalog has it), so an agent takes a Survey step as its task. (LIN-4370, Done; Documentation Review, 10 Nov.; `docs/reviews/documentation-review-2026-11-10.md`.)"}
J61
)
P=$(sub "$P")
A_API_W8=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J62'
{"to": "@@A_API@@", "says": "`routes/proxy-model-routing.js`: with `modelRoutingProxyWrites` on (any member), every readWrite key, leaf workers' included, can set any harness or model workspace-wide; a non-`claude-code` harness puts later bootstraps inline. No runnable check; `urlKey` filters untested. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)"}
J62
)
P=$(sub "$P")
A_API_W9=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J63'
{"to": "@@A_API@@", "says": "`routes/proxy.js`: a stage's token now carries its stage's write allowance and its one ticket (LIN-4468), so the proxy holds a reading stage to its writes. It does not yet hold its reads: a dispatch token can still GET ticket context (`/brief/`, `/issues/`, relations), and the blind read (LIN-4437) is blind by its prompt and preamble only, so a reader that ignores them can read the ask and the plan. Holding that needs a read guard per stage on the stamped token; the table in `lib/stage-writes.js` has no read column yet. By the consequence test it breaks nothing today, blocks no work and touches no safety. (LIN-4396 plan, witness 2; LIN-4468.)"}
J63
)
P=$(sub "$P")
A_API_W10=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J64'
{"to": "@@A_API@@", "says": "`routes/proxy-compute.js`: about 16 production sites (this file x7, `server.js` x3, `routes/test.js`, and others) compare a credential to `'test-token'` inline, beside the one helper (`isHermeticTestToken`, `lib/should-mock-ai.js`) that only two production modules import. Each is gated on `NODE_ENV=test`, so production behaviour is right today; injecting transports from tests, instead of production code recognising the token, would remove these checks and the `testTransport` declaration (`lib/dispatch-factory.js`). It spans several areas. (LIN-4456 review and Survey global, 13 Nov.)"}
J64
)
P=$(sub "$P")
A_API_W11=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)

# Area: Runs & dispatch (registry docs/areas/areas.json @ b937237a4), by Harbour. Its lessons and Waiting entries,
# docs/areas/runs-and-dispatch.md @ b937237a4, verbatim (wrapped lines joined): 20 lessons, 22 Waiting.
A_RUNS=project
P=$(cat <<'J66'
{"says": "A run-row field that is always present with a default is one entry in `RUN_FIELDS` (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once dropped on one hop of four.", "checked-at": "b937237a4"}
J66
)
P=$(sub "$P")
A_RUNS_L1=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J67'
{"says": "Every exit from the queue except a take archives through `_archiveItem` (`lib/dispatch-store.js`); a new exit must archive through it too.", "checked-at": "b937237a4"}
J67
)
P=$(sub "$P")
A_RUNS_L2=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J68'
{"says": "The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in `lib/dispatch-store.js`, shared by `addFeedback` and the held-wake release (LIN-4373). Its guards (LIN-1059, 1165, 1357, 2297, 4080, 4166) run in an order that matters: change the pair whole, keep the wake suites passing, and update the two census pins (`lin-3134-declared-mint-census`, `lin-4080-addItem-census`) if the write moves.", "checked-at": "b937237a4"}
J68
)
P=$(sub "$P")
A_RUNS_L3=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J69'
{"says": "\"This run's PR\" is the session's own report: `prUrlOfFeedback` (`lib/dispatch-wake.js`) takes a PR on a report line before the `[done]` `url`, which older runners filled by mention count (LIN-4375).", "checked-at": "b937237a4"}
J69
)
P=$(sub "$P")
A_RUNS_L4=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J70'
{"says": "Two `[done]` posts can reach a decide-then-enqueue at once, so \"no row yet\" is no guard: claim first, compare-and-set on the row (`claimHeldWake`). LIN-4373 relied on the read and queued two leftover rows (LIN-4375).", "checked-at": "b937237a4"}
J70
)
P=$(sub "$P")
A_RUNS_L5=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J71'
{"says": "A claim whose holder skips is released on every path out (`releaseHeldWakeClaim`). A stamp left by a skip held the re-report forever (LIN-4375 review).", "checked-at": "b937237a4"}
J71
)
P=$(sub "$P")
A_RUNS_L6=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J72'
{"says": "Any session can park `[pending]` on CI and finish on a ci-wake `custom` row (`lib/ci-wake-sweep.js`). A rule keyed on the producing kind misses that ending: read the lineage (`heldWakeHolderOf`, `resolveFollowUpRoot`). LIN-4373 covered eligibility, not the held wake's terminals. Over a ticket's runs, read it batched: `listHistory`'s `withLineage`, never a walk per row (`runFact`, `lib/recent-runs.js`, LIN-4459: the walks go up, a parked stage's ending is below it).", "checked-at": "b937237a4"}
J72
)
P=$(sub "$P")
A_RUNS_L7=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J73'
{"says": "Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and sit in `ROW_ONLY_KINDS` (`lib/dispatch-fields.js`); kind-keyed maps are tested against both. A new bucket can pull a kind into the round-trip walk, which `OFF_SPINE_KINDS` stops (LIN-4376).", "checked-at": "b937237a4"}
J73
)
P=$(sub "$P")
A_RUNS_L8=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J74'
{"says": "The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor` (LIN-4373), released by the holder's terminal or `_archiveItem` under the build's guard key, so it wakes once. Leftover wording lives in `lib/dispatch-leftover-hook.js`, bound into the store late (`setHeldWakeReleaseNote`) because most releases have no request; a new held-wake feature brings a hook (`lin-4377-store-knows-no-leftover` counts the word and forbids the `formatHeldWakeNote` import).", "checked-at": "b937237a4"}
J74
)
P=$(sub "$P")
A_RUNS_L9=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J75'
{"says": "A feedback-entry kind is one row in `FEEDBACK_KINDS` (`lib/dispatch-feedback-kinds.js`) that declares every role; readers filter the table, and its row order is the runner prompt's bytes. A shared constant is imported from its owner (`HALT_MODES`, `followUpTarget`, `NEVER_RAN` in `lib/dispatch-terminal.js`). The decision-stamp set had four copies in `lib/`; the LIN-4455 censuses (`lin-4455-feedback-kinds-table`, `lin-4455-constants-owners`) fail on a new one.", "checked-at": "b937237a4"}
J75
)
P=$(sub "$P")
A_RUNS_L10=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J76'
{"says": "Price a pulled extra like any piece: a cost read that rode along with LIN-4201 landed alone as LIN-4226.", "checked-at": "b937237a4"}
J76
)
P=$(sub "$P")
A_RUNS_L11=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J77'
{"says": "A task timeline lane is running from the page's open session ids (`isOpenState`), never the cost row; a lineage's own `incomplete`, not the shared `lineagesTruncated`, decides \"not complete\" (LIN-4405, `lib/task-timeline.js`).", "checked-at": "b937237a4"}
J77
)
P=$(sub "$P")
A_RUNS_L12=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J78'
{"says": "A test that dispatches a close-out passes a `closeOut` seam (`resolveProvider`): the readiness guard reads comments for every close-out since LIN-4438, and without the seam it reaches the real provider and fails open, a pass the hermetic watcher catches only in CI.", "checked-at": "b937237a4"}
J78
)
P=$(sub "$P")
A_RUNS_L13=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J79'
{"says": "Close-out readiness is one decision, `closeOutDecision` (`lib/run-closeout-state.js`, LIN-4460): every surface renders or enforces its answer. A new reason is a row of `CLOSE_OUT_REASONS` plus a row in `lin-4438-blind-read-gate` and `lin-4460-close-out-decision`, whose census reads code, not comments.", "checked-at": "b937237a4"}
J79
)
P=$(sub "$P")
A_RUNS_L14=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J80'
{"says": "When a person acts, Harbour follows (LIN-4447, John): a landing whose every PR reads merged stands the gate aside; a Done ticket with no close-out on its landing stands only the recommendation's read aside. Harbour never sets Done.", "checked-at": "b937237a4"}
J80
)
P=$(sub "$P")
A_RUNS_L15=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J81'
{"says": "What a comment is, and which PRs are the task's, are read once in `lib/run-trail.js`: a comment kind is a row of `COMMENT_KINDS` (`lin-4458-comment-kind-census` fails on a kind test elsewhere), and the box, the guard, the owner's check and the merge take their PRs from `readTrail().landing`, statuses keyed by PR URL: the cited list (newest first) and the landing (oldest first) order PRs differently, so a shared index points at the wrong PR (LIN-4458).", "checked-at": "b937237a4"}
J81
)
P=$(sub "$P")
A_RUNS_L16=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J82'
{"says": "A reader that classifies by kind routes `custom` before `bucketOf`: `BUCKET_OF_KIND` maps `custom` to orchestration, and `bucketOf` falls back to orchestration silently, so check membership (`lib/wall-clock-summary.js`). `dispatchesOf` turns a missing kind into `custom` (`lib/cost-read.js`): confirm a custom kind from its own row before trusting it (LIN-4426).", "checked-at": "b937237a4"}
J82
)
P=$(sub "$P")
A_RUNS_L17=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J83'
{"says": "A full PR URL's repository and number come from `prOf` beside `prUrlsIn` (`lib/run-ledger.js`), for the task page and measure 1 alike; compare repositories case-blind, as GitHub does (LIN-4439).", "checked-at": "b937237a4"}
J83
)
P=$(sub "$P")
A_RUNS_L18=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J84'
{"says": "A per-dispatch figure (its model, cost or completeness) is the fold's answer, carried through `lib/cost-read.js`; a reader never re-ranks `byModel` itself. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)", "checked-at": "b937237a4"}
J84
)
P=$(sub "$P")
A_RUNS_L19=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J85'
{"says": "The Harbour calls read is `lib/cost-read-calls.js` (LIN-4457): `readCalls`, `appCallsOf` and `callsSurfaceOf` are pure over docs their caller keys to one workspace (`listInHorizon(urlKey)`). The instance-wide boundary is the `urlKey` / `instanceWide` guard on `lineageRecords` and `readCost` (LIN-4226), not these readers. A new calls shape goes beside them, and `appCallsOf([])` is the one empty shape.", "checked-at": "b937237a4"}
J85
)
P=$(sub "$P")
A_RUNS_L20=$(L add lesson --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J86'
{"to": "@@A_RUNS@@", "says": "`lib/dispatch-wake.js`: `reportedPrUrlOf` and SD's `sessionPrs` pick a PR by one order, linked only by a comment; changing one moves a PR link. (Drift & Coherence Review, 10 Nov; `docs/reviews/drift-coherence-review-2026-11-10.md`.)"}
J86
)
P=$(sub "$P")
A_RUNS_W1=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J87'
{"to": "@@A_RUNS@@", "says": "`lib/dispatch-leftover-hook.js`: a death between `claimHeldWake` and the enqueue, or a failed release write, leaves the wake held. No sweep: a lease sees no re-report, a sweep scans history, and clearing stamps reopens LIN-4375's double queue. (LIN-4377.)"}
J87
)
P=$(sub "$P")
A_RUNS_W2=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J88'
{"to": "@@A_RUNS@@", "says": "`lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature first needs composable hooks. (Operator, LIN-4377.)"}
J88
)
P=$(sub "$P")
A_RUNS_W3=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J89'
{"to": "@@A_RUNS@@", "says": "`lib/runner-kit/contract.json`: the row-shape rule is written twice (`checkRowShape`; SD's `columnProblems`); `CONTRACT_SHA256` pins the bytes, not the rule. (Operator, LIN-4377.)"}
J89
)
P=$(sub "$P")
A_RUNS_W4=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J90'
{"to": "@@A_RUNS@@", "says": "`lib/runner-kit/contract.json`: no row pins a follow-up to a finished, unhalted session (rows cover pause and stop), though the leftover step resumes its build that way (`lib/dispatch-leftover.js`). (Seams & Tangles, 10 Nov.; `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)"}
J90
)
P=$(sub "$P")
A_RUNS_W5=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J91'
{"to": "@@A_RUNS@@", "says": "`lib/session-summary.js`: do stored run paragraphs keep pre-cutover figures? (Survey tally: LIN-4201.)"}
J91
)
P=$(sub "$P")
A_RUNS_W6=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J92'
{"to": "@@A_RUNS@@", "says": "`lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records. (Survey tally: LIN-3257.)"}
J92
)
P=$(sub "$P")
A_RUNS_W7=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J93'
{"to": "@@A_RUNS@@", "says": "`lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in SD; one shared fold would turn a transcript into requests. (Survey tally: LIN-4203, LIN-4195.)"}
J93
)
P=$(sub "$P")
A_RUNS_W8=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J94'
{"to": "@@A_RUNS@@", "says": "`lib/run-live-wait.js`: a read, not a claim: two different-kind calls racing on one ticket both pass; claim compare-and-set, like `claimHeldWake` (LIN-4392). (Moved from the LLM & prompts note by LIN-4459.)"}
J94
)
P=$(sub "$P")
A_RUNS_W9=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J95'
{"to": "@@A_RUNS@@", "says": "`lib/run-live-wait.js`: the run-outcome words have two homes. `QUEUED`/`RUNNING` live here (they moved with `isLiveRun` to avoid an import cycle), while `WAITING_ON_A_PERSON`, `'closed'` and `'aborted'` stay in `lib/recent-runs.js`, and `lib/recommendation-look-first.js` still imports them from there. One home (for example a leaf module of outcome words) touches importers in LLM & prompts, so it is larger than a fix. (LIN-4459 blind read.)"}
J95
)
P=$(sub "$P")
A_RUNS_W10=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J96'
{"to": "@@A_RUNS@@", "says": "`lib/recent-runs.js`: a parked stage whose lineage has ended is dated by its park time, not the lineage's end, because the `withLineage` wire row from `listHistory` (`lib/dispatch-store.js`) carries no end time. It sorts too early in the selector's five, and can land on the wrong side of a \"since the latest review\" cut, such as the ended-read count in `lib/recommendation-blind-read.js`. Fix: `listHistory` reports the lineage's end time, a store change that alters the Dispatch route's output. (LIN-4459 blind read.)"}
J96
)
P=$(sub "$P")
A_RUNS_W11=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J97'
{"to": "@@A_RUNS@@", "says": "`lib/run-trail.js`: a foreign PR cited by full URL before the first review (a research note, a plan) joins a first landing, so the blind read must name it (`tests/unit/lin-4438-blind-read-gate.test.js` row 15, kept as a stated limit): no caller holds the task's repository, so the landing cannot tell another repository's PR from this task's. A task-repository fact, or a kind stamped on a comment when it is posted, would let the landing drop it. (LIN-4438; why-not written by LIN-4458.)"}
J97
)
P=$(sub "$P")
A_RUNS_W12=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J98'
{"to": "@@A_RUNS@@", "says": "`lib/cost-read-calls.js`: `readCalls` states the figure rule (`totalUsd` only when everything is priced and complete; `pricedUsd` never counts a partial) in its own words, and the lineage figure in `lib/cost-read.js` states it again, so a change to the rule is made twice. One shared helper would make it one, but it reaches the lineage path and its goldens: larger than a fix. (LIN-4457 leftovers; Survey global on LIN-4457.)"}
J98
)
P=$(sub "$P")
A_RUNS_W13=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J99'
{"to": "@@A_RUNS@@", "says": "`lib/dispatch-feedback-kinds.js`: the table's `mayCarryWake` column is `true` on every row (unknown kinds pass too), so `findWakeEvent` (`lib/dispatch-terminal.js`) never skips a kind, while `lastWakeEntry` (`lib/run-view.js`) skips the decision-stamp kinds as \"never a wake marker\". Two wake scans disagree about stamps, and the column only records `findWakeEvent`'s behaviour. Removing the column or making it true to both readers means deciding whether `findWakeEvent` should skip stamps, which changes wake minting and every reader of stored rows. (LIN-4455 blind read.)"}
J99
)
P=$(sub "$P")
A_RUNS_W14=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J100'
{"to": "@@A_RUNS@@", "says": "`lib/dispatch-factory.js`: `refusesHermeticToken` skips access for a provider that declares `testTransport` (`LinearProvider`, `lib/providers/linear/index.js`), but nothing links that declaration to the transport swaps it describes (`routes/test.js` `installTestTokenLinearTransport`, `tests/fixtures/hermetic-linear.js`), so a new installer or a change to Linear's can drift from it silently. Closing it means deciding where test transports register (for example installers that declare which provider they cover, plus a census test), across providers, web routes and fixtures: larger than a fix. (LIN-4456 blind read, 13 Nov.)"}
J100
)
P=$(sub "$P")
A_RUNS_W15=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J101'
{"to": "@@A_RUNS@@", "says": "`lib/task-page-loader.js`: `fmtWhen` (the absolute UTC stamp, `8 Nov, 14:40 UTC`) stays in the loader, so `lib/components/time.js` and `lib/render-task-timeline.js` import a page-formatting helper from a runs-and-dispatch module, the tangle LIN-4472 removed for `relativeAgo`. Moving it into `lib/time-words.js` first needs a call on whether that leaf also owns absolute stamps; about five importers. (LIN-4472 blind read.)"}
J101
)
P=$(sub "$P")
A_RUNS_W16=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J102'
{"to": "@@A_RUNS@@", "says": "`lib/run-trail.js` `readTrail`: a re-review after a not-ready close-out that names the PR only as `#N` leaves the landing empty. The decision's gate (`closeOutWaitsOn`, `lib/run-closeout-state.js`) then opens with no blind read, and since LIN-4458 the box reads `no-pr`, the person's check sets no Done and the merge recorder records nothing (pinned in `tests/unit/lin-4458-landing-consumers.test.js`). The review prompt asks for the head, not the PR URL. Fix: fall back to the anchor close-out's PRs when nothing after the anchor cites one, or have the review prompt require the full URL (LLM & prompts' side). No live trail has this shape. (LIN-4458 review.)"}
J102
)
P=$(sub "$P")
A_RUNS_W17=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J103'
{"to": "@@A_RUNS@@", "says": "`lib/close-out-readiness.js` (the ladder lane) and `lib/recommendation-blind-read.js`: an outside merge on a ticket still In Progress is not seen, because neither reads a PR (the recommend path makes no GitHub read by contract, and the ladder reads none). The recommendation still routes a blind read, and the ladder still refuses on the gate. John accepted this on 13 Nov: \"no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up.\" Pinned by `tests/unit/lin-4460-close-out-decision.test.js` (named for that ruling). Why not now: a PR read on the recommend path costs budget (`PR_STATE_READ_COST` against the 36/h anonymous limit in `lib/pr-state-store.js`), needs token resolution on a path that has none, and the process-wide PR cache is not workspace-scoped. Supplying a landing-merged fact later is one more input to `closeOutDecision`. (LIN-4460.)"}
J103
)
P=$(sub "$P")
A_RUNS_W18=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J104'
{"to": "@@A_RUNS@@", "says": "`lib/close-out-readiness.js` `readCloseOutChain`: every caller gets the derived box, but the merge recorder (`lib/close-out-merges.js`) wants only the reads, so it passes `actor: 'harbour'`, `runnerReady` and `owner` for a state it discards. A reads-only chain (trail, statuses, stop-at) with each surface calling `deriveCloseOutState` would drop those flags, at the cost of the check route, the guard and the tests that read `state` from the chain (`lin-4438-blind-read-gate`, `close-out-readiness-chain`): larger than a fix. (LIN-4460 leftovers; Survey global.)"}
J104
)
P=$(sub "$P")
A_RUNS_W19=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J105'
{"to": "@@A_RUNS@@", "says": "`lib/run-trail.js` `readTrail`: `closeOutOnTrail` (the decision's advice fact) and `closeOutAfterReview` (the selector's TRAIL FACTS line, `lib/recommendation-facts.js`) agree whenever a review is on record and differ only without one. Folding them to one fact changes `followsPerson` for a Done ticket with no review and touches the selector's facts on the LLM & prompts side. (LIN-4460 leftovers.)"}
J105
)
P=$(sub "$P")
A_RUNS_W20=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J106'
{"to": "@@A_RUNS@@", "says": "`lib/ci-wake-sweep.js` `prRefsFromPark` parses a runner's park message with its own `FULL_PR_URL_RE` (scheme optional, repo key case-folded) beside `prUrlsIn`/`prOf` (`lib/run-ledger.js`). Its comment-side read already goes through `extractPrUrls`. Moving it onto `prUrlsIn` changes which park messages wake (a scheme-less URL would stop matching), so it needs its own witness. (LIN-4458 review.)"}
J106
)
P=$(sub "$P")
A_RUNS_W21=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)
P=$(cat <<'J107'
{"to": "@@A_RUNS@@", "says": "`lib/run-evidence.js`: the run page keeps two answers to \"which PR is the task's\". The close-out box counts `readTrail().landing` through `closeOutDecision` (LIN-4460 retired `deriveState`'s status decision: no reader outside the tests and the GET body reads it), but `deriveState` over `extractPrUrls` (every cited PR) still drives `state.pr`, `done`, `checked.now` and `resolveRunPrRef` (read by the `routes/dashboard.js` pr-state route), `state.prUrls` (`lib/pr-state-store.js`), and `lib/ci-wake-sweep.js` matches parks against every cited PR. Whether the page's PR and the CI-wake sweep follow the landing is a product decision touching several callers. Also, `readRunEvidence` reads the landing's sole PR and hands `buildRunEvidence` a bare `prStatus`, which `buildRunEvidence` re-pairs with the landing after reading the trail again: the same positional coupling the URL-keyed `Map` removed from the decision. Passing the status keyed by URL with the landing already read is a signature change for about 25 call sites (`tests/unit/run-evidence.test.js`, `routes/dashboard.js`), so larger than a fix. (LIN-4458 blind read; LIN-4460.)"}
J107
)
P=$(sub "$P")
A_RUNS_W22=$(L add finding --by Harbour --at 2026-11-13T22:29:42Z "$P" | idof)

# Parent LIN-4448, filed 2026-11-13T12:08:14.585Z. asked = its ## As asked block, byte-exact (heading excluded).
P=$(cat <<'J108'
{"ref": "LIN-4448", "asked": "**Repository:** JKershaw/LinearViewer (Harbour).\n\n**What this is for.** The tightest tangle in Harbour is between LLM & prompts and Runs & dispatch: the links between the two areas grew from 32 one way and 50 the other to 38 and 55 over batch 1 (Seams run 12). On this side:\n\n* the list of routes that code settles without asking a model is copied about nine times, and `docs/architecture/prompt-system.md` and `public/llms.txt` already describe it wrongly (Drift, row 154);\n* the blind read's name and heading are retyped outside the file that defines them (Drift, row 151);\n* batch 1 added rules to the prompts as text (the frozen prompt total rose about 21,000 bytes, to 378,915). John on that limit: \"That limit is to push against lists if rules. Worth knowing, but not hard and fast.\";\n* LIN-4350 asks to fold the rules together into plainer, more general instructions.\n\nThe safety pass (A5, LIN-4400) found two themes here: merge and read-only limits that exist only in prompt text (LIN-1242, LIN-1273, LIN-3417), and tokens inside prompt text (LIN-1372, LIN-1395, LIN-1408). Both are part of A12 (LIN-4416). The area's note holds 26 Waiting entries.\n\n**What we want.**\n\n* Each rule has one home; the copies are gone, and the docs say what the code does.\n* A limit that matters is held in code, not only in a prompt's words.\n* Fewer rules are restated as lists in prompt text.\n* The area's Waiting entries are settled, or each says why it can't be yet.\n* Each piece finishes one move and names what it retired; piece sizes vary, leaning larger.\n* The Runs & dispatch side of the seam is A13's.\n\n**Done when**\n\n* the cases above are settled, or John has ruled they can wait;\n* the safety tickets named above are closed in code for that reason, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.\n\n**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.\n\n*End of what was asked. Steps write below this line; nothing above it changes.*", "done-when": "* the cases above are settled, or John has ruled they can wait;\n* the safety tickets named above are closed in code for that reason, or John has ruled they can wait;\n* the area's Waiting entries are settled or say why not;\n* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times."}
J108
)
P=$(sub "$P")
PARENT=$(L add task --by John --via driving-session --at 2026-11-13T12:08:14.585Z "$P" | idof)

# Scoping (dispatch adacf8d5, 13:25:35): the ## Size of the move record, then the cuts ruling it raised (13:28:06.963).
P=$(cat <<'J109'
{"in": "@@PARENT@@", "scope": "@@PARENT@@", "answer": "**Size:** rebuild the area", "why": "**Why:** Rebuilds the area around one definition per stage kind, from which routes, write limits, labels and docs derive, and has the proxy refuse writes a stage may not make; otherwise copies return and read-only stays words.\n**Cuts:**\n\n* \"the safety tickets named above are closed in code\": the merge limit (LIN-3417) stays with simple-dispatcher.\n* \"the safety tickets named above are closed in code\": the token tickets (LIN-1372, LIN-1395, LIN-1408) stay with the harness.\n  **Decided by:** pending a ruling"}
J109
)
P=$(sub "$P")
SIZE=$(L add decision --by scoping --at 2026-11-13T13:28:06.963Z "$P" | idof)
P=$(cat <<'J110'
{"in": "@@PARENT@@", "to": "John", "asks": "LIN-4448 cuts: should the merge limit (LIN-3417 and the merge half of LIN-1273) and the token tickets (LIN-1372, LIN-1395, LIN-1408) wait for A12 (LIN-4416) and simple-dispatcher instead of closing in code here?", "options": ["Agree both cuts: they wait for A12 and simple-dispatcher; LIN-4448 closes only the read-only limit, through the proxy's write guard", "Keep the merge limit in LIN-4448's scope (needs work in simple-dispatcher)", "Keep both in LIN-4448's scope"], "recommended": "Agree both cuts: they wait for A12 and simple-dispatcher; LIN-4448 closes only the read-only limit, through the proxy's write guard"}
J110
)
P=$(sub "$P")
Q_CUTS=$(L add question --by scoping --at 2026-11-13T13:28:06.963Z "$P" | idof)
# John's answer (comment 643eef60, ruling lin4448-safety-cuts resolved 15:33:40.054).
P=$(cat <<'J111'
{"in": "@@PARENT@@", "scope": "@@PARENT@@", "links": {"answers": "@@Q_CUTS@@"}, "answer": "Agree both cuts: they wait for A12 and simple-dispatcher; LIN-4448 closes only the read-only limit, through the proxy's write guard", "why": "Ruling lin4448-safety-cuts, recorded via Harbour."}
J111
)
P=$(sub "$P")
D_CUTS=$(L add decision --by John --via Harbour --at 2026-11-13T15:33:39.997Z "$P" | idof)
# Scoping's resume (custom 56407915, 15:33:40.160) rewrote "Decided by". Exact time not in the material: the
# 15:34:51.926 snapshot is the first to show it.
P=$(cat <<'J112'
{"why": "**Why:** Rebuilds the area around one definition per stage kind, from which routes, write limits, labels and docs derive, and has the proxy refuse writes a stage may not make; otherwise copies return and read-only stays words.\n**Cuts:**\n\n* \"the safety tickets named above are closed in code\": the merge limit (LIN-3417) stays with simple-dispatcher.\n* \"the safety tickets named above are closed in code\": the token tickets (LIN-1372, LIN-1395, LIN-1408) stay with the harness.\n  **Decided by:** a ruling"}
J112
)
P=$(sub "$P")
L revise "$SIZE" --by scoping --at 2026-11-13T15:34:51.926Z --reason 'Decided by: a ruling (John'\''s answer to lin4448-safety-cuts).' "$P" >/dev/null

# Design (dispatch 8e1f52c8, 15:35:24): the Implementation Plan (comment 6bc02d3f, 15:39:54.189). One plan record per
# piece; says = the plan's own paragraph for that behaviour (A-F), paths = the files it names; order = breakdown order.
P=$(cat <<'J113'
{"in": "@@PARENT@@", "says": "Piece 0: That last line is measured with the LIN-4453 kit (`docs/plans/survey/area-read.md`, same frozen reader prompt), run on `llm-and-prompts` and on the control area `front-end-pages` after the last piece. The baseline for this area does not exist yet (LIN-4453 recorded Runs and the control only): taking it is piece 0, before anything lands. Piece 0 (baseline area read) first and alone.", "order": 1}
J113
)
P=$(sub "$P")
P0=$(L add plan --by design --at 2026-11-13T15:39:54.189Z "$P" | idof)
P=$(cat <<'J114'
{"in": "@@PARENT@@", "says": "Piece 1: **A. One route list (piece 1).** `codeRouteOf` takes its order from `CODE_ROUTES`; `skipLiveWait` still skips the first entry only. *Witness:* the existing route tests (`lin-4392`, `lin-4438`, look-first) pass unchanged; a new test fails if a route is added to the list without a prompt-trace name, and pins `docs/architecture/prompt-system.md`, `docs/architecture/source-map.md` and the `blind-read` bullet in `public/llms.txt` against the list (order, count, and \"code sends it\"). The `llms.txt` line is wrong at HEAD (\"Sent by hand\"), so the test fails before and passes after. *Places:* `rg -n \"live-stage wait\" lib docs/architecture public CLAUDE.md` finds seven mentions in `lib/openrouter.js`, two in `lib/recommendation-live-wait.js`, one each in `lib/stage-router.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-look-first.js`, `lib/dispatch-entrance.js`, `lib/recent-runs.js` (six), `CLAUDE.md`, `prompt-system.md` and three in `source-map.md`. Comments become a pointer to `CODE_ROUTES`; the three docs are pinned by the test. The builder runs that search again at the end and puts its output in the PR; reports under `docs/reviews/` are history and are left alone. *Retires:* the hand-ordered chain and the comment copies; the Waiting entry on the four routes. The `stage-router.js` header is a budgeted source (`STAGE_ROUTER_SOURCE_CEILING`): shortening it lowers the ceiling, which is allowed.", "order": 2}
J114
)
P=$(sub "$P")
P1=$(L add plan --by design --at 2026-11-13T15:39:54.189Z "$P" | idof)
P=$(cat <<'J115'
{"in": "@@PARENT@@", "says": "Piece 2: **B. The blind read's words have one home (piece 2).** Nothing outside `lib/prompts/blind-read-words.js` and the template registry types the kind `'blind-read'` in a predicate or the heading `## Blind read`. *Witness:* a source-scan test that fails on any other occurrence, with a short allow-list of table keys (each with a reason); it fails today at the places the Waiting entry names (`lib/recommendation-blind-read.js`, `lib/pipeline-churn.js`, `lib/run-view.js`, `lib/run-closeout-state.js`, `lib/workflow-config.js` `VIRTUAL_PROMPTS.BLIND_READ`, and `lib/completion-signals.js`, which types the heading three times). Rendered prompts must be byte-identical (the blind read's sentence is piloted; do not re-word it). `COMPLETED` redeclared in `recommendation-blind-read.js` is not touched here: it retires with LIN-4447's move 3. *Retires:* the leaf's untrue header claim becomes true; the second constant.", "order": 2}
J115
)
P=$(sub "$P")
P2=$(L add plan --by design --at 2026-11-13T15:39:54.189Z "$P" | idof)
P=$(cat <<'J116'
{"in": "@@PARENT@@", "says": "Piece 3: **C. One record per stage kind (piece 3).** `PROMPT_TEMPLATES`, `STAGE_LEADS`'s traits, `COMPLETION_SIGNALS`, `GROUNDING_BY_KIND`, `STAGE_LABELS` and the `route`/`writes` pins become views of one record each. *Witness:* (i) render every kind, fresh and fix round, with real context (not the context-free budget fixture, LIN-4393), at HEAD and on the branch, byte-identical except where the piece says otherwise; (ii) `stage-kind-tables.test.js` and `lin-4253-stage-traits.test.js` shrink to the tables that stay, and a new kind added to the record but missing a field fails; (iii) the run-page goldens are unchanged (labels are the same strings). This piece edits only the `STAGE_LABELS` literal in `lib/run-view.js` (Runs' file): rebase on LIN-4447's pieces that touch it. *Retires:* those tables, the \"\\~fourteen parallel tables\" Waiting entry (rewritten to name the four that stay and why), and the `llms.txt` prompt catalogue's hand-copied bullets, which are generated from the record (its test then checks content, not just existence).", "order": 3}
J116
)
P=$(sub "$P")
P3=$(L add plan --by design --at 2026-11-13T15:39:54.189Z "$P" | idof)
P=$(cat <<'J117'
{"in": "@@PARENT@@", "says": "Piece 4: **D. A reading stage cannot write what it may not (piece 4).** With a stamped token: `none` is refused on every write mount; `one-comment` and `blind-comment` may POST one comment to the named ticket and nothing else (a second comment on the same ticket is allowed by the token; \"one\" stays the preamble's ask, because a count needs state the token does not carry, and the blind-read shape check already runs at write time); `ticket-fields` may change labels, priority, state, project and comment on the named ticket, with no description rewrite, no create, no relation write; `work` and an unstamped token behave as today. An unknown stamped value fails closed to `none`, not open. *Witnesses, each failing before:* a `none` token gets 403 from each write mount (comment, issue update, description, label, relation, create, dispatch, agent status); a `one-comment` token posts its comment and is refused a comment on another ticket, a description edit and a label add; a triage token is refused a description rewrite. *Every place:* a test that reads the router's registered write routes (POST/PATCH/PUT/DELETE) and fails on one that is not classified in the allowance table, so a route added later cannot bypass it. *Mint paths:* every caller of `attachProxyContext` / `provisionResumeCredential` (`lib/dispatch-entrance.js` twice, `routes/workspace-api-feedback.js` twice, `lib/follow-up-dispatch.js`, `lib/wake-credential.js`, `lib/chat-tools.js`, `routes/dispatch.js`) must pass its stage's `writes`; the test lists any that cannot name a stage as unlimited with the reason. A follow-up's token takes its own kind's `writes`, not its parent's. Preamble prose is unchanged in this piece: guard first, words after.", "order": 2}
J117
)
P=$(sub "$P")
P4=$(L add plan --by design --at 2026-11-13T15:39:54.189Z "$P" | idof)
P=$(cat <<'J118'
{"in": "@@PARENT@@", "says": "Piece 5: **E. Fewer rules as prompt lists (piece 5), only after D has landed.** With the guard in place, `ONE_COMMENT_MANDATE`, `NONE_MANDATE`, `BLIND_COMMENT_MANDATE` and `TICKET_FIELDS_MANDATE` shrink to what the stage is told about its token; the merge sentences stay (cut, ruled). In one batch, with one re-pin of the 13 Periodical hashes, router snapshots, `scripts/eval/meta-prompt.baseline.txt` and `FROZEN_TOTAL_BYTES` (lowered with reasons in `scripts/prompt-template-change-log.md`): the docs-only notes-PR rule, the \"search the repo for a committed tool\" rule (the four wordings settle on Stability's) and the first-match area lookup each become one constant in `lib/prompts/leftover-words.js` (the blind read's piloted sentence stays as piloted: re-piloting is a person's run; the entry says so). *Witness:* the rendered-bytes check shows a net fall; the existing prompt tests pass; a test that none of the retired phrases still appears in a second template. LIN-4350 stays its own ticket (it spans both repos and waits for this one's siblings): this piece takes only the folds the guard and the shared constants make safe, and records for LIN-4350 what it found.", "order": 4}
J118
)
P=$(sub "$P")
P5=$(L add plan --by design --at 2026-11-13T15:39:54.189Z "$P" | idof)
P=$(cat <<'J119'
{"in": "@@PARENT@@", "says": "Piece 6: **F. The Waiting entries (each piece, then piece 6).** Every piece edits the entries it settles and cites them in its retirement line (the LIN-4414 rule). Piece 6 settles the rest by the table below and rewrites the Lessons the new structure replaces (the \"retyped in five files\" lesson, the table lesson). *Witness:* `tests/unit/area-notes.test.js` passes and the note's entry count falls from 25 (the ticket says 26; I count 25 bullets at HEAD, and the builder recounts at the start).", "order": 5}
J119
)
P=$(sub "$P")
P6=$(L add plan --by design --at 2026-11-13T15:39:54.189Z "$P" | idof)

# Plan review (dispatch 007f38ce): Approve, comment 72406236 at 15:49:32.648. One verdict per piece; reasoning
# carries the verdict's lead and the builder notes that name that piece, verbatim.
P=$(cat <<'J121'
{"in": "@@PARENT@@", "links": {"on": ["@@P0@@@1"]}, "judgement": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.\n\n12. **The control area is not quite untouched.** Open PR #2424 (LIN-4457) adds two `aria-label`s to `lib/render-proxy.js`, which is in the control's 14-file sample at HEAD. Record it in both area reads, and check open PRs against the control's sample again before the repeat read. Take this area's baseline and a fresh control read at one base commit, recorded in each report. The kit's fixed table is pinned to `4b5001ddf` and LIN-4447's areas."}
J121
)
P=$(sub "$P")
V_P0=$(L add verdict --by plan-review --at 2026-11-13T15:49:32.648Z "$P" | idof)
P=$(cat <<'J122'
{"in": "@@PARENT@@", "links": {"on": ["@@P1@@@1"]}, "judgement": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.\n\n7. **Correct the seam reply on LIN-4447 before pieces 2–4 start.** It says the only Runs file this work edits is `STAGE_LABELS` in `lib/run-view.js`. By `docs/areas/areas.json` first match, these files are `runs-and-dispatch` too:\n   - piece 2 edits `lib/completion-signals.js`, `lib/run-closeout-state.js` and `lib/pipeline-churn.js`;\n   - piece 1 edits comments in `lib/recent-runs.js` and `lib/dispatch-entrance.js`;\n   - piece 4 edits `lib/dispatch-entrance.js`, `lib/follow-up-dispatch.js`, `routes/dispatch.js` and `lib/wake-credential.js`.\n\n   Piece 3 also turns `COMPLETION_SIGNALS`, a Runs-registered table, into a view of this area's record. On content that is right: every consumer is a prompt. But it changes Runs' sample universe for LIN-4447's after-read. Separately, `lib/stage-writes.js` is not this area's file: it falls to `other-features`.\n\n   Post the full list on LIN-4447. LIN-4460 (`closeOutDecision`, in `run-closeout-state.js`) and LIN-4459 (`recent-runs.js`) will collide with pieces 2 and 1. The rebase is mechanical, but they should hear about it first.\n\n11. **Pieces 1, 2 and 4 share files.** Pieces 1 and 2 both edit `lib/recommendation-blind-read.js`. Pieces 1 and 4 both edit `lib/dispatch-entrance.js`. Pieces 1 and 3 both edit `docs/architecture/source-map.md`. The conflicts are small, but whichever piece lands second rebases."}
J122
)
P=$(sub "$P")
V_P1=$(L add verdict --by plan-review --at 2026-11-13T15:49:32.648Z "$P" | idof)
P=$(cat <<'J123'
{"in": "@@PARENT@@", "links": {"on": ["@@P2@@@1"]}, "judgement": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.\n\n7. **Correct the seam reply on LIN-4447 before pieces 2–4 start.** It says the only Runs file this work edits is `STAGE_LABELS` in `lib/run-view.js`. By `docs/areas/areas.json` first match, these files are `runs-and-dispatch` too:\n   - piece 2 edits `lib/completion-signals.js`, `lib/run-closeout-state.js` and `lib/pipeline-churn.js`;\n   - piece 1 edits comments in `lib/recent-runs.js` and `lib/dispatch-entrance.js`;\n   - piece 4 edits `lib/dispatch-entrance.js`, `lib/follow-up-dispatch.js`, `routes/dispatch.js` and `lib/wake-credential.js`.\n\n   Piece 3 also turns `COMPLETION_SIGNALS`, a Runs-registered table, into a view of this area's record. On content that is right: every consumer is a prompt. But it changes Runs' sample universe for LIN-4447's after-read. Separately, `lib/stage-writes.js` is not this area's file: it falls to `other-features`.\n\n   Post the full list on LIN-4447. LIN-4460 (`closeOutDecision`, in `run-closeout-state.js`) and LIN-4459 (`recent-runs.js`) will collide with pieces 2 and 1. The rebase is mechanical, but they should hear about it first.\n\n11. **Pieces 1, 2 and 4 share files.** Pieces 1 and 2 both edit `lib/recommendation-blind-read.js`. Pieces 1 and 4 both edit `lib/dispatch-entrance.js`. Pieces 1 and 3 both edit `docs/architecture/source-map.md`. The conflicts are small, but whichever piece lands second rebases."}
J123
)
P=$(sub "$P")
V_P2=$(L add verdict --by plan-review --at 2026-11-13T15:49:32.648Z "$P" | idof)
P=$(cat <<'J124'
{"in": "@@PARENT@@", "links": {"on": ["@@P3@@@1"]}, "judgement": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.\n\n8. **Piece 3: enumerate the tables from `stage-kind-tables.test.js`, not from the plan's list.** That test also reads tables the plan doesn't mention:\n   - `STAGE_INTENT` (`lib/prompts/stage-intent.js`, this area; its reading-pass lines follow from `writes`, per `lib/stage-writes.js`);\n   - `JOBS` (`lib/llm-jobs.js`);\n   - `VIRTUAL_PROMPTS` (`lib/workflow-config.js`, platform);\n   - the prompt contract;\n   - the proxy-instructions override list.\n\n   Each one becomes a view of the record, or the rewritten Waiting entry names it as staying, with its owner and reason. \"The four that stay\" will be more than four. Piece 2's scan will also hit table keys and comments outside the six known sites: `stage-intent.js`, `prompt-formatters.js`, `wall-clock-summary.js`, `llm-jobs.js`, `run-ledger.js`, `routes/proxy-writes.js` and `prompt-trace-store.js`. Give the allow-list a rule for comments rather than one entry per comment.\n\n11. **Pieces 1, 2 and 4 share files.** Pieces 1 and 2 both edit `lib/recommendation-blind-read.js`. Pieces 1 and 4 both edit `lib/dispatch-entrance.js`. Pieces 1 and 3 both edit `docs/architecture/source-map.md`. The conflicts are small, but whichever piece lands second rebases."}
J124
)
P=$(sub "$P")
V_P3=$(L add verdict --by plan-review --at 2026-11-13T15:49:32.648Z "$P" | idof)
P=$(cat <<'J125'
{"in": "@@PARENT@@", "links": {"on": ["@@P4@@@1"]}, "judgement": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.\n\n2. **Piece 4, `ticket-fields`: refuse by field inside `PATCH /api/proxy/issues/:issueId`.** That route's body carries `title`, `description`, `stateId`, `assigneeId`, `projectId`, `parentId`, `cycleId` and `priority`/`priorityLevel` (`routes/proxy-writes.js:504`). An allowance keyed only on method and path either lets triage rewrite the description through PATCH or refuses its state and priority changes. Allow `stateId`, `projectId`, `priority`/`priorityLevel` (plus labels and comments on their own routes), and refuse `description`, `title`, `parentId` and `cycleId`. Add a witness: a triage token sending `PATCH {description}` gets a 403, not just a call to `/description/replace`. Settle `assigneeId` too. The triage template's description says \"labels, priority, assignee\", but `lib/stage-writes.js` leaves assignee out. Follow `stage-writes.js` and fix the template's wording in piece 3, or add assignee to both.\n\n3. **Piece 4: one mint path doesn't fail closed if missed, so let a test find them all, not a list.** An unstamped token is unlimited, so a missed path fails open. The plan's list leaves out three files:\n   - `routes/collective.js:373` calls `attachProxyContext`, and `:409` calls `provisionBootstrapToken`.\n   - `routes/task-chat.js` and `routes/flight-companion.js` also mint bootstraps.\n   - `lib/proxy-preamble.js` calls `provisionBootstrapToken` directly at `:906` and `:939`.\n\n   Make the witness a source scan over callers of `provisionBootstrapToken`, `attachProxyContext`, `provisionResumeCredential` and `mintGrantBootstrap`. Each caller passes `writes`, or is listed as stage-less with its reason (chat, collective).\n\n4. **Piece 4: the stamp does not \"travel like `lifetimeProfile`\".** The exchange reads `lifetimeProfile` to pick the TTL but never copies it to the working token (`lib/proxy-tokens.js:554-567`), and `createToken` forces it to null. The new fields need explicit handling in four places: in `#mint`, in `createToken` (which today nulls everything but grants), in `mintGrantBootstrap` (dispatch-entrance's declared-grant branch mints there), and in the exchange's working-token mint. Then `validateToken` → `authenticateProxyToken` sets them on `req`. A caller-supplied stamp can only narrow a token, so `createToken` may accept it.\n\n5. **Piece 4: compare tickets after normalising them.** The token carries the task's identifier, but `:issueId` is whatever the agent typed: lowercase, a provider UUID, or a GitHub or Jira form. Compare case-insensitively. Then either resolve the id or refuse with a 403 that names the identifier the stage may write to, so a blind read or survey retries instead of dying silently. Run the \"real preamble endpoints\" witness on each provider's identifier form.\n\n6. **Piece 4: the route-classification test must also check enforcement.** Central enforcement in `requireWriteScope` only works on routes that call it. Have the test assert that every route classified as a write has `requireWriteScope` in its chain. Classify recap, brief and `/api/proxy/flight-companion/turn` as not-writes, each with its reason. The exchange route (`/api/proxy/token`) authenticates with a bootstrap, not a working token, so exempt it.\n\n7. **Correct the seam reply on LIN-4447 before pieces 2–4 start.** It says the only Runs file this work edits is `STAGE_LABELS` in `lib/run-view.js`. By `docs/areas/areas.json` first match, these files are `runs-and-dispatch` too:\n   - piece 2 edits `lib/completion-signals.js`, `lib/run-closeout-state.js` and `lib/pipeline-churn.js`;\n   - piece 1 edits comments in `lib/recent-runs.js` and `lib/dispatch-entrance.js`;\n   - piece 4 edits `lib/dispatch-entrance.js`, `lib/follow-up-dispatch.js`, `routes/dispatch.js` and `lib/wake-credential.js`.\n\n   Piece 3 also turns `COMPLETION_SIGNALS`, a Runs-registered table, into a view of this area's record. On content that is right: every consumer is a prompt. But it changes Runs' sample universe for LIN-4447's after-read. Separately, `lib/stage-writes.js` is not this area's file: it falls to `other-features`.\n\n   Post the full list on LIN-4447. LIN-4460 (`closeOutDecision`, in `run-closeout-state.js`) and LIN-4459 (`recent-runs.js`) will collide with pieces 2 and 1. The rebase is mechanical, but they should hear about it first.\n\n10. **Piece 4 makes look-into's \"post nothing to Linear unless the person asks\" untrue.** A `none` token refuses every write, and the token cannot know a person asked. Dropping that allowance is a \"what to retire\" call, so ask John as a ruling on piece 4's PR. My recommendation is to retire it: look-into reports in its session, and a person can post the comment themselves. Then piece 5 drops the clause.\n\n11. **Pieces 1, 2 and 4 share files.** Pieces 1 and 2 both edit `lib/recommendation-blind-read.js`. Pieces 1 and 4 both edit `lib/dispatch-entrance.js`. Pieces 1 and 3 both edit `docs/architecture/source-map.md`. The conflicts are small, but whichever piece lands second rebases."}
J125
)
P=$(sub "$P")
V_P4=$(L add verdict --by plan-review --at 2026-11-13T15:49:32.648Z "$P" | idof)
P=$(cat <<'J126'
{"in": "@@PARENT@@", "links": {"on": ["@@P5@@@1"]}, "judgement": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.\n\n1. **Piece 5: keep the git-side limits in words.** The proxy guard holds tracker writes only. \"Do not change code, branches, pull requests\" in `ONE_COMMENT_MANDATE`, `BLIND_COMMENT_MANDATE`, `NONE_MANDATE` and `TICKET_FIELDS_MANDATE` has no code backstop: the runner's GitHub credential is outside the proxy, and that half sits with simple-dispatcher like merge. Shrink only the tracker clauses the token now refuses. Keep the code, branch and PR prohibitions, as you keep the merge sentences, and name them in the change log entry as kept, with the reason.\n\n10. **Piece 4 makes look-into's \"post nothing to Linear unless the person asks\" untrue.** A `none` token refuses every write, and the token cannot know a person asked. Dropping that allowance is a \"what to retire\" call, so ask John as a ruling on piece 4's PR. My recommendation is to retire it: look-into reports in its session, and a person can post the comment themselves. Then piece 5 drops the clause."}
J126
)
P=$(sub "$P")
V_P5=$(L add verdict --by plan-review --at 2026-11-13T15:49:32.648Z "$P" | idof)
P=$(cat <<'J127'
{"in": "@@PARENT@@", "links": {"on": ["@@P6@@@1"]}, "judgement": "plan-review", "outcome": "approve", "reasoning": "Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides. No builder note names this piece."}
J127
)
P=$(sub "$P")
V_P6=$(L add verdict --by plan-review --at 2026-11-13T15:49:32.648Z "$P" | idof)

# Breakdown (dispatch 2d65d300, 15:51:03; comment 4b22eb22 at 15:55:35.944): seven subtasks, one per piece. Written
# here: LIN-4464..LIN-4469 (LIN-4470 comes after this task). Only LIN-4464 (15:54:40.300) and LIN-4469 (15:54:41.773)
# have creation times in the material; 4465-4468 are placed between them in id order. done-when: LIN-4464's
# Acceptance block; for 4465-4468 only the title is in the material.
P=$(cat <<'J128'
{"in": "@@PARENT@@", "links": {"piece": "@@P0@@"}, "ref": "LIN-4464", "done-when": "* Two reports are committed: `llm-and-prompts` and `front-end-pages`, both at the same recorded base commit, made with the frozen prompt.\n* The contamination notes and the open-PR list are recorded in both reports.\n* Nothing from pieces 1–6 has landed before this merges."}
J128
)
P=$(sub "$P")
T4464=$(L add task --by breakdown --at 2026-11-13T15:54:40.300Z "$P" | idof)
P=$(cat <<'J129'
{"in": "@@PARENT@@", "links": {"piece": "@@P1@@"}, "ref": "LIN-4465", "done-when": "LLM & prompts: one ordered CODE_ROUTES list that codeRouteOf iterates (piece 1)"}
J129
)
P=$(sub "$P")
T4465=$(L add task --by breakdown --at 2026-11-13T15:54:40.600Z "$P" | idof)
P=$(cat <<'J130'
{"in": "@@PARENT@@", "links": {"piece": "@@P2@@"}, "ref": "LIN-4466", "done-when": "LLM & prompts: blind read's kind and heading from one leaf (piece 2)"}
J130
)
P=$(sub "$P")
T4466=$(L add task --by breakdown --at 2026-11-13T15:54:40.900Z "$P" | idof)
P=$(cat <<'J131'
{"in": "@@PARENT@@", "links": {"piece": "@@P3@@"}, "ref": "LIN-4467", "done-when": "LLM & prompts: one record per stage kind, tables become views (piece 3)"}
J131
)
P=$(sub "$P")
T4467=$(L add task --by breakdown --at 2026-11-13T15:54:41.200Z "$P" | idof)
P=$(cat <<'J132'
{"in": "@@PARENT@@", "links": {"piece": "@@P4@@"}, "ref": "LIN-4468", "done-when": "LLM & prompts: proxy refuses writes outside the stage's allowance (piece 4)"}
J132
)
P=$(sub "$P")
T4468=$(L add task --by breakdown --at 2026-11-13T15:54:41.500Z "$P" | idof)
# This task, LIN-4469 (piece 5). done-when = its ## As asked block (heading and end line excluded), verbatim;
# paths = the files it names.
P=$(cat <<'J133'
{"in": "@@PARENT@@", "links": {"piece": "@@P5@@"}, "ref": "LIN-4469", "done-when": "Piece 5 of LIN-4448's plan (behaviour **E**). **Fewer rules restated as lists in prompt text.** This lands only after piece 3 (records) and piece 4 (proxy guard).\n\n**Approach**\n\n* Shrink only the **tracker-write clauses the guard now refuses**, in `ONE_COMMENT_MANDATE`, `NONE_MANDATE`, `BLIND_COMMENT_MANDATE` and `TICKET_FIELDS_MANDATE` (`lib/proxy-preamble.js`), down to what the stage is told about its token.\n* **Keep these in words** (review note 1): the code, branch and PR prohibitions, which have no code backstop because the runner's GitHub credential is outside the proxy, and the merge sentences (cut by ruling). Name them as kept, with the reason, in the change-log entry.\n* Look-into's \"unless the person asks\" clause is dropped only if John has ruled to retire it (the DECISION on LIN-4448, asked on piece 4). Otherwise it is reworded to match `one-comment`.\n* Each of these becomes one constant in `lib/prompts/leftover-words.js`: the docs-only notes-PR rule, the committed-tool wording (\"search the repo for a committed tool\"; the four wordings settle on **Stability's**), and the first-match area lookup. Also the retirement-line wording in this repository's docs (simple-dispatcher's copy stays named, and is its owner's).\n* Fold `CUT` and \"narrowing\" (`lib/prompts/stage-intent.js` / `lib/completion-signals.js`) into one vocabulary. If piece 3's record already settled it, say so.\n* The blind read's piloted sentence stays as piloted. Re-piloting is a person's run, and the Waiting entry says so.\n* **Re-pin once, together:** the 13 Periodical hashes, the router snapshots, `scripts/eval/meta-prompt.baseline.txt` and a lowered `FROZEN_TOTAL_BYTES`, with reasons in `scripts/prompt-template-change-log.md`.\n\n**Testing (witnesses)**\n\n* Real-context rendered bytes show a net fall across every kind, fresh and fix round.\n* The existing prompt tests pass.\n* A new test fails if a retired duplicate phrase appears in more than one template.\n\n**LIN-4350:** report what this piece found to LIN-4350 in a comment. Don't absorb that ticket: it spans two repos.\n\n**Collisions:** `lib/prompt-template-defs.js` and the budget test, after piece 3.\n\n**Retires:** the Waiting entries for the docs-only notes-PR rule, the committed-tool wording, the first-match lookup, `CUT` vs \"narrowing\", and the retirement line's restatement in this repo's docs. Also the tracker clauses in the four mandates.\n\n---\n\n**Parent:** LIN-4448 (LLM & prompts, left simpler). The full approved plan is the parent's description, section `## Implementation Plan`, and its amendments are in the parent's comment `### Plan Review Verdict` (72406236-9316-4004-98ee-70d8fba0cb09). The parent's `## As asked` block sets the scope.\n\nSession fit: fits one session\n\nPlan-review due: no — covered by LIN-4448's approving plan-review (comment 72406236-9316-4004-98ee-70d8fba0cb09, rev 1)\n\n**Grounding commits:** the plan was written at `JKershaw/LinearViewer` main `2bf788b6d` (surveys at `4b5001ddf`) and reviewed at `c205190fd`. The breakdown re-checked at `5dcf5bcda`. The only change since is LIN-4457 (#2424), and the one plan file it touches is the cost-read entry in `docs/architecture/source-map.md`.\n\n**Starting point:** the parent's approved plan. Follow it. Where the code shows it is wrong, change course, and say so in a comment on LIN-4448.\n\n**Every PR names what it retires** (the LIN-4414 rule). It edits the Waiting entries in `docs/areas/llm-and-prompts.md` that it settles. It respects that note's Lessons and leaves `docs/reviews/` reports unchanged."}
J133
)
P=$(sub "$P")
TASK=$(L add task --by breakdown --at 2026-11-13T15:54:41.773Z "$P" | idof)

# Breakdown decisions about LIN-4469, in LIN-4469, resting on the approve verdict on piece 5 (comment 4b22eb22).
P=$(cat <<'J134'
{"in": "@@TASK@@", "links": {"on": ["@@V_P5@@@1"]}, "answer": "Grounding commit origin/main `5dcf5bcda`; the plan stands, so no re-plan was needed.", "why": "`origin/main` is `5dcf5bcda`. Since the plan's `2bf788b6d` and the review's `c205190fd`, only LIN-4457 (#2424) and LIN-4454 landed. The only plan file they touch is the cost-read entry in `docs/architecture/source-map.md`. The anchors still hold: `codeRouteOf` is at `lib/openrouter.js:2108`, `requireWriteScope` is at `routes/proxy.js:609`, and there are 25 Waiting entries. The plan stands, so no re-plan was needed."}
J134
)
P=$(sub "$P")
D_BD1=$(L add decision --by breakdown --at 2026-11-13T15:55:35.944Z "$P" | idof)
P=$(cat <<'J135'
{"in": "@@TASK@@", "links": {"on": ["@@V_P5@@@1"]}, "answer": "Session fit: fits one session. Plan-review due: no — covered by LIN-4448's approving plan-review (comment 72406236-9316-4004-98ee-70d8fba0cb09, rev 1)", "why": "| 4 | LIN-4469 | 5: prompt folds, one re-pin | 4467, 4468 | one session: one batch, one re-pin |"}
J135
)
P=$(sub "$P")
D_BD2=$(L add decision --by breakdown --at 2026-11-13T15:55:35.944Z "$P" | idof)
P=$(cat <<'J136'
{"in": "@@TASK@@", "links": {"on": ["@@V_P5@@@1"], "about": ["@@T4467@@", "@@T4468@@"]}, "answer": "LIN-4469 is blocked by LIN-4467 (piece 3) and LIN-4468 (piece 4).", "why": "The baseline goes first and alone, so that nothing changes the area before it is read. 1, 2 and 4 then run in parallel: their files mostly don't overlap, and the shared ones (`recommendation-blind-read.js`, `dispatch-entrance.js`) rebase. 3 needs 1 and 2. 5 needs 3 and 4: the guard comes before the words, and both 3 and 5 touch `prompt-template-defs.js` and the budget test. 6 comes last, and 5 covers the rest transitively."}
J136
)
P=$(sub "$P")
D_BD3=$(L add decision --by breakdown --at 2026-11-13T15:55:35.944Z "$P" | idof)
P=$(cat <<'J137'
{"in": "@@TASK@@", "links": {"on": ["@@V_P5@@@1"]}, "answer": "LIN-4469 blocks LIN-4470 (piece 6).", "why": "The baseline goes first and alone, so that nothing changes the area before it is read. 1, 2 and 4 then run in parallel: their files mostly don't overlap, and the shared ones (`recommendation-blind-read.js`, `dispatch-entrance.js`) rebase. 3 needs 1 and 2. 5 needs 3 and 4: the guard comes before the words, and both 3 and 5 touch `prompt-template-defs.js` and the budget test. 6 comes last, and 5 covers the rest transitively."}
J137
)
P=$(sub "$P")
D_BD4=$(L add decision --by breakdown --at 2026-11-13T15:55:35.944Z "$P" | idof)

# The look-into ruling: the breakdown's DECISION (raised 15:55:54.652, ruling lin4448-lookinto-none), John's answer
# (comment bdcd3128), and the breakdown's resume (custom 4061df13) writing it into LIN-4469 under ## Current.
P=$(cat <<'J138'
{"in": "@@PARENT@@", "to": "John", "asks": "Once the proxy refuses look-into's writes (LIN-4468), look-into can no longer post to Linear when a person asks. Should that exception be retired?", "options": ["Retire it: look-into reports in its session and a person posts the comment if they want it", "Keep it: look-into is allowed one comment on its ticket instead of no writes"], "recommended": "Retire it: look-into reports in its session and a person posts the comment if they want it", "if-unanswered": "LIN-4468 can be built but not merged"}
J138
)
P=$(sub "$P")
Q_LOOK=$(L add question --by breakdown --at 2026-11-13T15:55:54.652Z "$P" | idof)
P=$(cat <<'J139'
{"in": "@@PARENT@@", "scope": "@@PARENT@@", "links": {"answers": "@@Q_LOOK@@"}, "answer": "Retire it: look-into reports in its session and a person posts the comment if they want it", "why": "Ruling lin4448-lookinto-none, recorded via Harbour."}
J139
)
P=$(sub "$P")
D_LOOK=$(L add decision --by John --via Harbour --at 2026-11-13T15:57:43.409Z "$P" | idof)
P=$(cat <<'J140'
{"in": "@@TASK@@", "links": {"on": ["@@D_LOOK@@@1"]}, "answer": "**Ruling answered (John, 13 Nov, LIN-4448 comment bdcd3128):** retire look-into's \"post nothing to Linear unless the person asks\" exception.", "why": "This piece **drops that clause** from look-into's prompt; the `one-comment` rewording option in the section above no longer applies. Record the retirement, citing the ruling, in `scripts/prompt-template-change-log.md` and in the PR's retirement line."}
J140
)
P=$(sub "$P")
D_CURRENT=$(L add decision --by breakdown --at 2026-11-13T15:58:14.076Z "$P" | idof)

# Siblings finishing. LIN-4464's Done time is its completedAt; for 4465-4468 the material has no Done time, so each
# is placed at its squash merge on main (git log), the close-out that merged it being the writer.
L end "$T4464" done 'Piece 0 baseline: PR #2430 merged (docs only); paired area reads for llm-and-prompts and front-end-pages at e8e92d50a.' --by close-out --at 2026-11-13T16:49:08.269Z >/dev/null
L end "$T4465" done 'Piece 1: PR #2433 merged as e666c4b60. Time is the merge commit'\''s.' --by close-out --at 2026-11-13T19:44:59Z >/dev/null
# The review on the parent itself (dispatch 2e8edc69; comment 882fc992 at 20:34:06.118): Request Changes.
P=$(cat <<'J141'
{"in": "@@PARENT@@", "links": {"on": ["@@PARENT@@@1"]}, "judgement": "review", "outcome": "request-changes", "reasoning": "Request Changes. The parent isn't ready to close: four of the seven pieces haven't started, and one is waiting for close-out. This is not a design problem. The approved plan stands, and the next action is to keep descending into the children. In order: `close-out` on LIN-4466 (already sent), then `implementation` on LIN-4468 (it can start now, independently), then LIN-4467 once #2441 merges, then LIN-4469, then LIN-4470. After that, run review on the parent again.\n\n### What CI Did Not Prove\n- **Inside** (bounded class: prompt-only limits; LIN-1273/LIN-1242 read-only scope). The proxy write guard does not exist yet. Settle it **before the parent closes** by landing LIN-4468, with tests showing a forbidden write returns 403 on real preamble endpoints. That includes triage's description PATCH under `ticket-fields`, and a comment POST to a ticket other than the stamped one under `one-comment`.\n- **Inside** (bounded class: stage-kind tables, docs drift row 154). `public/llms.txt` and `docs/architecture/prompt-system.md` still describe routes and stages independently of the code. Settle it **before the parent closes** through LIN-4467, by generating the catalogue from the record and keeping the real-context fresh and fix renders byte-identical.\n- **Inside** (bounded class: rules as prompt lists). There is no net reduction in rendered bytes yet. Settle it **before the parent closes** through LIN-4469, with the re-pin showing lower `FROZEN_TOTAL_BYTES` and the reasons recorded in `scripts/prompt-template-change-log.md`.\n- **Inside** (Waiting entries + the blind-read measurement in Done when). Settle it **before the parent closes** through LIN-4470. Every retained entry must name its blocker or owner. The repeat `llm-and-prompts` read must beat the `front-end-pages` control, with intervening changes to either sample accounted for.\n- **Inside** (piece 2). #2441 is not merged and still has one open ledger item on LIN-4466. Settle it through the close-out already dispatched to LIN-4466."}
J141
)
P=$(sub "$P")
V_PARENT=$(L add verdict --by review --at 2026-11-13T20:34:06.118Z "$P" | idof)
L end "$T4466" done 'Piece 2: PR #2441 merged as dc12ca51b. Time is the merge commit'\''s.' --by close-out --at 2026-11-13T20:42:28Z >/dev/null
# The autopilot's condition on LIN-4467's budget raise, recorded on LIN-4469 (comment a77d9b51, 21:49:17.132;
# the same wake cleared LIN-4467's BLOCKED on the parent, 3475fde4).
P=$(cat <<'J142'
{"in": "@@TASK@@", "answer": "## Condition on LIN-4467's budget raise, for piece 5\n\nIt was accepted on one condition that falls on this piece: **LIN-4469 must show a net rendered-byte reduction and lower `FROZEN_TOTAL_BYTES` below 396575** (the figure the settlement named), with the reduction measured on rendered prompts, not on source moved out of measured files. John on the limit: \"That limit is to push against lists of rules. Worth knowing, but not hard and fast.\"", "why": "LIN-4467 (PR https://github.com/JKershaw/LinearViewer/pull/2444) raises `FROZEN_TOTAL_BYTES` in `tests/unit/prompt-size-budget.test.js` from 378915 to 396884 (396575 at review, plus a net +309 at close-out for deriving the reading-pass lines). It is re-accounting, not growth: the text moved into the newly budgeted `lib/prompts/stage-kinds.js` from files the total did not cover, and all 80 rendered prompts are byte-identical.\n\nNamed monitor: `tests/unit/prompt-size-budget.test.js` fails on any growth past the ceiling. Only this piece landing can show the reduction.\n\nThe record's source ceiling (`lib/prompts/stage-kinds.js`, 43348) is part of what to lower if wording moves out of it. `lib/prompt-template-defs.js` and the budget test are shared with this piece; LIN-4467 lands first.\n"}
J142
)
P=$(sub "$P")
D_COND=$(L add decision --by autopilot --at 2026-11-13T21:49:17.132Z "$P" | idof)
L end "$T4467" done 'Piece 3: PR #2444 merged as 8fea3869f. Time is the merge commit'\''s.' --by close-out --at 2026-11-13T21:58:11Z >/dev/null
L end "$T4468" done 'Piece 4: PR #2443 merged as b937237a4. Time is the merge commit'\''s.' --by close-out --at 2026-11-13T22:29:42Z >/dev/null

echo "seeded: parent=$PARENT task=$TASK piece5=$P5 a_llm=$A_LLM a_api=$A_API a_runs=$A_RUNS v_p5=$V_P5 q_cuts=$Q_CUTS d_cuts=$D_CUTS q_look=$Q_LOOK d_look=$D_LOOK d_cond=$D_COND"
echo "siblings: 4464=$T4464 4465=$T4465 4466=$T4466 4467=$T4467 4468=$T4468"
# Count the records straight from the file (a query would log a read).
node -e 'const s=require(process.argv[1]);const v=Object.values(s.records);console.log("records:",v.length,"versions:",v.reduce((a,r)=>a+r.length,0),"log:",s.log.length)' "$STORE"
