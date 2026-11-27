# Sizing explore: what Harbour already has for John's 27 Nov picture

*Read-only map, 27 Nov. Code cited is main at `5c33e4415` (paths relative to the repo root). Log, discussion and asks are in `docs/plans/survey/`. "Unconfirmed" means I did not see it in the code or the record.*

## 1. What exists today

**How a stage decides how much to tidy**
- **Scoping sets the size of the move**, kept fuzzy. It reads the two Surveys' reports, the findings, the area notes, and a subtask's parent size. It weighs sizes "from just the task up to rebuilding the area it touches", applies the standing policy and writes one `decision` record on the task (`answer` the size, `why` one sentence) (`lib/prompt-template-defs.js:439-471`, especially 462-467). A finding "binds" only when the asked change would not work without it. Anything merely nearby or worth doing "stays in the Surveys" (`:463`). There is no closed list of sizes any more: LIN-4542 retired it (`c960bdb76`).
- **A person's word on the size is a ruling**, and scoping follows it and says so (`:462`). Since LIN-4535 that word arrives as a comment, which becomes the person's finding.
- **Every deciding stage owns its engineering choices.** The intent line DECIDE says "Engineering choices, fixing at the cause and refactoring included, are yours" (`lib/prompts/stage-kinds.js:24,29`). Research adds: "A refactor that removes the cause … or that this task calls, counts as necessary" (`:224`).
- **Research's Surface Assessment gives three verdicts:** lands cleanly, refactor required, or improvement noticed, not required. A refactor counts as required only when it passes a cause-or-consumer test and a who-pays test. A second copy of something the code already models is always refactor required (`lib/prompt-template-defs.js:402-424`).
- **Plan:** a required refactor becomes its own blocking subtask that lands first. Any other refactor is "folded in, scoped down or noted" (`:205`).
- **The Surveys ask the tidy question directly.** survey-place asks "What would leave the place better … at a cost this task could carry? And what would be better still, but is not this task's to carry?" (`:957-959`). The prompt asks for no costs or prices, so a priced menu is not produced by code (D6 assumed one existed, `discussion.md:274`).
- **Look-first** sends survey-task, then survey-place, then scoping, on a fresh leaf ticket with no size decision. It stands aside while the newest run is waiting on a person (`lib/recommendation-look-first.js:1-40,155-167`).

**Leftover step, blind read and close-out**
- **Leftover step** (`lib/dispatch-leftover.js:131-157`; rule in `lib/prompts/leftover-words.js:24`). The builder is asked "what did your change leave behind at its edges?". It fixes fix-sized leftovers on the PR branch. Anything else becomes a finding: to `close-out`, or to `project` when no task owns it.
- **Blind read** (`lib/prompt-template-defs.js:999-1050`). It reads the diff with no ticket and gives exactly one verdict: better, same or worse (`lib/prompts/blind-read-words.js:27`). A fix-sized find inside the change's area becomes a finding to `close-out`. Anything larger, or outside the area, goes to `project` (`:1040`). A `worse` verdict does **not** hold the merge, since only the read's existence is checked (`lib/recommendation-blind-read.js:9`). Since LIN-4544 there is one blind read per change (`d4ad0c5dc`).
- **Close-out** fixes the blind read's fix-sized inside findings. Each fix must stay "the size of a fix": one needing new design goes back to review. Outside finds stay findings to project, and close-out files no tickets (`lib/prompt-template-defs.js:805,814,829-831`).
- **The project pile is a backlog that no task has to clear.** John works it from the project page (`integration/design.md` §6, §8; asks D3/D4 in `discussion.md`).

**Where "no worse than it found it" is expressed**
- **The words themselves are not in code.** The idea lives as the "no new mess" measure: A1/D8, "On average a task should leave the code a little better, and never worse" (`asks.md:13-19`). A1 was filed as LIN-4396, and its piece 3 is the blind read before close-out (`lib/recommendation-blind-read.js:1`).
- **John's "two dials" (5 Nov)** is the closest match to his picture: "make no new mess", always on; and "how much to tidy", the human's budget (`review-notes.md:264,301-307`).
- **In code, the idea is carried by four things:** the leftover step, the blind read's verdict and findings, close-out's fixes, and the policy line "a small, clear ticket stays just the task" (`lib/prompt-template-defs.js:48`). Nothing enforces "no worse": the blind read reports, and does not gate.

**Size or scope calls still in prompts or code**
- **The standing policy:** `STANDING_SIZE_POLICY` (`lib/prompt-template-defs.js:47-48`), rendered in scoping (`:457`).
- **Only a person can make a cut.** The CUT line says delivering less than the ask is "not yours" and must be raised as one `question`, then end `BLOCKED:` (`lib/prompts/stage-kinds.js:27`). Scoping applies the same rule to a size smaller than the ask, or to calling the ticket "wrong work" (`lib/prompt-template-defs.js:466`).
- **The selector reads the size as a fact:** `sizeFactOf` returns "not decided" when no size decision exists (`lib/recommendation-facts.js:382-390`; `lib/records/words.js:57`). Scoping is routed again once a person has answered its size question (`lib/prompts/stage-kinds.js:233`).
- **Implementation is told not to trust a "refactor" label** and to check each old behaviour still holds (`lib/prompt-template-defs.js:648`).

**Questions: how raised, shown and answered**
- **Raised by the run:** a run writes a `question` record with `short` (at most 200 characters), `asks`, `options` (a list of strings), `recommended` and `if-unanswered`. A run that can't go on ends `BLOCKED:` (`lib/prompts/handoff-words.js:31,33`; `lib/records/kinds.json` question kind and `limits`). A person can also add a question from the task page (`lib/render-task-records.js:34`).
- **Shown on one card** (`lib/question-record-card.js:116-145`): the task line, the one-line lead, the full ask behind a fold, one button per option with the recommended one first, an own-words box, Answer, and "this wasn't worth asking". The same card appears on Home, the run page, the task page, the Rulings page and Flight Companion (`routes/question-answers.js:1-12`).
- **Answered through one route** (`routes/question-answers.js`; behaviour table in `lib/question-answers.js:1-28`). The answer is a `decision` record holding both the option and the person's words. It resumes the asking run if that run is resumable. A run that was stopped stays stopped, and the decision stands for the next stage.
- **How rich a question can be:** the fold renders paragraphs, bulleted and numbered lists and line breaks only, with no links, images or tables (`lib/question-record-card.js:56-92`). An option is a single line of text, with no field for a description or cost. There is **no card variant or question type**: one renderer serves every question, and the kind has no type field.

**Pausing mid-chain**
- **This already works.** A question plus `BLOCKED:` parks the run. Look-first stands aside, and the answer resumes the same run with the question, the option and the words (`lib/question-answers.js:5-8`; `lib/recommendation-look-first.js:167`). Live examples: "a cut ruling holds the ticket overnight, which is by design" (`log.md:2960`), and `lin4531-census-move`, where the autopilot resumed after John's answer (`log.md:5240`).
- **Known costs** (from the log, not re-checked in code): the same question raised on two loops asked John twice (`log.md:2981,3036`). An option that needs a hand action can be approved by one click without the action happening (`log.md:3017,3059`).

**Per-workspace settings a toggle could use**
- **Workspace features:** on/off flags with a logged reason and Undo. A new key must be added to `LOGGED_WORKSPACE_FEATURES` (`routes/settings.js:101-104`) and to the change log's `SETTINGS` (`lib/workspace-change-log.js:40`). `periodicals` is the existing example.
- **The workspace preferences store** (`lib/workspace-preferences.js`), where `sizePolicy` once lived.
- **A project-scoped decision record** (`decision.scope = 'project'`, `lib/records/kinds.json`). It appears in part 4 of every task's brief (`lib/records/brief.js:109-114`), and the layer calls it "a person's standing direction" (`layer/design.md` §3.2). Unconfirmed: whether any page lets a person write a project-scoped decision. The task page adds only findings and questions, and supersedes decisions (`lib/render-task-records.js:34-37`).

## 2. The removed size setting

- **Added by LIN-4368** (`eeda7e448`, 8 Nov 00:12): a workspace preference `sizePolicy`, either `ask` (the default) or `err-larger`. It was set in Settings > Running as "Size of the move" ("Ask each time" / "Err larger"), required a reason, and had a change-log row and Undo. Running's status line showed "Ready · ask" and so on. One loader fed the policy into every scoping render.
- **It came bundled** with the `## Size of the move` description section: a closed list of five sizes, a "Decided by" line, and a proxy guard (`SIZE_RECORD_HOW`, `_POLICY_CUT`, `_DROPPED`) in `lib/size-of-move.js`. Under `ask`, scoping raised every size as a `DECISION:` ruling (`scripts/prompt-template-change-log.md:90,131`).
- **How it came about:** John's conversational "err larger" became a mechanism in the operator's brief. The Surveys wrote "put the standing policy in workspace preferences", the size call made it a requirement, and Harbour built it faithfully (`log.md:3065-3072`).
- **Why it was removed**, in John's words (`log.md:3060,3071`): "The setting makes zero sense for someone who doesn't know specifics of how Harbour works … doesn't match my mental model of how this will flow … It asks a mandatory question without doing the work to explain the question … A default option for hands off operation is fine." Also: "technically it's correct, but it's also obviously wrong and a mistake." His call: "I'd be happy to remove the feature cleanly, and we add settings to the list for discussion" (`log.md:3090`).
- **The diagnosis** (`log.md:3061`; `discussion.md:292`): it was named after an internal concept, showed only the value you'd switch to, demanded a reason, and mixed who decides with which way to lean.
- **Removed by LIN-4393** (`393c7686b`, 8 Nov 15:34). Err larger became built-in behaviour, so hands-off running didn't fall back to "ask".
- **Later, 9 Nov, D6** (`discussion.md:265-295`; `log.md:3234`). John: "the setting we removed wasn't wrong per se, just unusable". Decided: the size is "just another ruling" ("how much tidying on this task?"), with the sizes as options, a rough cost for each, and a recommended pick leaning larger. A plain setting chooses who answers ("ask me" or follow the default), and asks only when there's a real choice. Rule for every setting: it must make sense to a new user.
- **D6 was drafted as ask A9** (`asks.md:198-217`) and **never filed**. It was held (`log.md:3603`), then overtaken on 22 Nov: "size works as today", and settings stay on the list for later discussion (`log.md:5228`; `integration/design.md:128`).
- **Still in code:**
  - `preferences.sizePolicy` is stored and unread (`lib/workspace-preferences.js:37-39`).
  - Old change-log rows still read, and are not undoable (`lib/workspace-change-log.js:24-28,148,158-160`).
  - Area notes and walk-8 fixtures mention it.
  - `lib/size-of-move.js` and the section guard are gone since LIN-4542.

## 3. "Err larger" today

**Still live, in code and in the prompt.** `STANDING_SIZE_POLICY` reads: "err larger: take the larger move when the look shows it pays, and when in doubt; it does not mean inflating every ticket, and a small, clear ticket stays just the task." It is rendered into every scoping prompt (`lib/prompt-template-defs.js:47-48,457`) and never decides a cut (`:464,466`).

**History:**
- 7 Nov: "lean larger where the look shows it pays, not by default; small stays small" (`log.md:2930`). The code's "and when in doubt" leans further than this.
- 8 Nov: "err larger means one fuller change, not more tickets", after it was read as more pieces (`log.md:3019,3024`).
- It is the value John chose, not a standing answer of his (`log.md:3091`).
- It is the default under D6 (`discussion.md:444`).

## 4. Against John's picture

| Part of the picture | Status | Evidence |
|---|---|---|
| Default: leave the code no worse | **Exists, different shape.** Err larger is the default (it leans *larger*, not "no worse"). The no-mess part is the leftover step, the blind read and close-out's fixes, and it reports rather than enforces (a `worse` verdict doesn't hold the merge) | §1 |
| A toggle that makes it stop and ask about bigger tidy-ups | **Missing.** There is no setting. D6/A9 described it and was never filed. The pieces a toggle would use exist: workspace features, the preferences store, project-scoped decisions | §1, §2 |
| Asking about authority to refactor nearby code | **Partly.** A cut must be asked. Going *larger* is decided by scoping under err larger without asking. Nearby, non-binding finds go to the Surveys or `project`, not to a question | `stage-kinds.js:27-29`; `prompt-template-defs.js:463-466` |
| Pausing mid-chain like a normal question | **Exists.** Question, `BLOCKED:`, answer, the same run resumes | §1 |
| Size options shown with room for information | **Different shape.** One card for every question: one-line lead, the ask folded, single-line options. There is no per-option detail or cost, no special card type, and no page built for sizing | `question-record-card.js` |
| A sizing menu with costs | **Missing in code.** survey-place asks what fits "at a cost this task could carry" but produces no priced menu. The sizes are free text since LIN-4542 | `:957-959` |
| The UI shows a running ticket, or very little | **Exists in part** (not examined in depth): the task page's stage bars, "Sessions on one clock" (LIN-4405), a records section that lists the size decision, the live run transcript (LIN-4560), and a quiet Home (LIN-4552). Unconfirmed: whether superseding a size decision mid-run changes anything downstream | `render-task-page.js:1-30`; `render-task-records.js:28,37` |
