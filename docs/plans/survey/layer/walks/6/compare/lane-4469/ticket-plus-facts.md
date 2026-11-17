# Ticket LLM & prompts: prompt folds after the guard, one re-pin (piece 5)

(as Harbour captured it at the start of this stage)

## Description

## As asked

Piece 5 of LIN-4448's plan (behaviour **E**). **Fewer rules restated as lists in prompt text.** This lands only after piece 3 (records) and piece 4 (proxy guard).

**Approach**

* Shrink only the **tracker-write clauses the guard now refuses**, in `ONE_COMMENT_MANDATE`, `NONE_MANDATE`, `BLIND_COMMENT_MANDATE` and `TICKET_FIELDS_MANDATE` (`lib/proxy-preamble.js`), down to what the stage is told about its token.
* **Keep these in words** (review note 1): the code, branch and PR prohibitions, which have no code backstop because the runner's GitHub credential is outside the proxy, and the merge sentences (cut by ruling). Name them as kept, with the reason, in the change-log entry.
* Look-into's "unless the person asks" clause is dropped only if John has ruled to retire it (the DECISION on LIN-4448, asked on piece 4). Otherwise it is reworded to match `one-comment`.
* Each of these becomes one constant in `lib/prompts/leftover-words.js`: the docs-only notes-PR rule, the committed-tool wording ("search the repo for a committed tool"; the four wordings settle on **Stability's**), and the first-match area lookup. Also the retirement-line wording in this repository's docs (simple-dispatcher's copy stays named, and is its owner's).
* Fold `CUT` and "narrowing" (`lib/prompts/stage-intent.js` / `lib/completion-signals.js`) into one vocabulary. If piece 3's record already settled it, say so.
* The blind read's piloted sentence stays as piloted. Re-piloting is a person's run, and the Waiting entry says so.
* **Re-pin once, together:** the 13 Periodical hashes, the router snapshots, `scripts/eval/meta-prompt.baseline.txt` and a lowered `FROZEN_TOTAL_BYTES`, with reasons in `scripts/prompt-template-change-log.md`.

**Testing (witnesses)**

* Real-context rendered bytes show a net fall across every kind, fresh and fix round.
* The existing prompt tests pass.
* A new test fails if a retired duplicate phrase appears in more than one template.

**LIN-4350:** report what this piece found to LIN-4350 in a comment. Don't absorb that ticket: it spans two repos.

**Collisions:** `lib/prompt-template-defs.js` and the budget test, after piece 3.

**Retires:** the Waiting entries for the docs-only notes-PR rule, the committed-tool wording, the first-match lookup, `CUT` vs "narrowing", and the retirement line's restatement in this repo's docs. Also the tracker clauses in the four mandates.

---

**Parent:** LIN-4448 (LLM & prompts, left simpler). The full approved plan is the parent's description, section `## Implementation Plan`, and its amendments are in the parent's comment `### Plan Review Verdict` (72406236-9316-4004-98ee-70d8fba0cb09). The parent's `## As asked` block sets the scope.

Session fit: fits one session

Plan-review due: no — covered by LIN-4448's approving plan-review (comment 72406236-9316-4004-98ee-70d8fba0cb09, rev 1)

**Grounding commits:** the plan was written at `JKershaw/LinearViewer` main `2bf788b6d` (surveys at `4b5001ddf`) and reviewed at `c205190fd`. The breakdown re-checked at `5dcf5bcda`. The only change since is LIN-4457 (#2424), and the one plan file it touches is the cost-read entry in `docs/architecture/source-map.md`.

**Starting point:** the parent's approved plan. Follow it. Where the code shows it is wrong, change course, and say so in a comment on LIN-4448.

**Every PR names what it retires** (the LIN-4414 rule). It edits the Waiting entries in `docs/areas/llm-and-prompts.md` that it settles. It respects that note's Lessons and leaves `docs/reviews/` reports unchanged.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Current

**Ruling answered (John, 13 Nov, LIN-4448 comment bdcd3128):** retire look-into's "post nothing to Linear unless the person asks" exception. This piece **drops that clause** from look-into's prompt; the `one-comment` rewording option in the section above no longer applies. Record the retirement, citing the ruling, in `scripts/prompt-template-change-log.md` and in the PR's retirement line.

## Comments

### Comment 2026-11-13T21:49:17.132Z

## Condition on LIN-4467's budget raise, for piece 5

LIN-4467 (PR https://github.com/JKershaw/LinearViewer/pull/2444) raises `FROZEN_TOTAL_BYTES` in `tests/unit/prompt-size-budget.test.js` from 378915 to 396884 (396575 at review, plus a net +309 at close-out for deriving the reading-pass lines). It is re-accounting, not growth: the text moved into the newly budgeted `lib/prompts/stage-kinds.js` from files the total did not cover, and all 80 rendered prompts are byte-identical.

It was accepted on one condition that falls on this piece: **LIN-4469 must show a net rendered-byte reduction and lower `FROZEN_TOTAL_BYTES` below 396575** (the figure the settlement named), with the reduction measured on rendered prompts, not on source moved out of measured files. John on the limit: "That limit is to push against lists of rules. Worth knowing, but not hard and fast."

Named monitor: `tests/unit/prompt-size-budget.test.js` fails on any growth past the ceiling. Only this piece landing can show the reduction.

The record's source ceiling (`lib/prompts/stage-kinds.js`, 43348) is part of what to lower if wording moves out of it. `lib/prompt-template-defs.js` and the budget test are shared with this piece; LIN-4467 lands first.


### Comment 2026-11-13T22:58:22.994Z

## Implementation summary (LIN-4469, piece 5)

PR: https://github.com/JKershaw/LinearViewer/pull/2447 (branch `feat/lin-4469-prompt-folds`, commit 3533f37c2). CI: `CI success` green, with unit tests, unit tests (proxy, clock +400d), 4 E2E shards and secret scan all passing.

**Done**
- Four mandates in `lib/proxy-preamble.js` drop the tracker clauses the guard refuses. The code, branch and PR prohibitions stay in words (no code backstop), and so do the merge sentences (cut by ruling).
- Look-into's "post nothing to Linear unless the person asks" exception retired, per John's ruling (LIN-4448 comment bdcd3128).
- Shared constants in `lib/prompts/leftover-words.js`: `areaLookup` and `NOTES_PR`. Periodical readings and retrospective-audit use them. Stability's wording settles the four committed-tool spellings (`committedSearch`, `lib/periodicals.js`).
- "narrowing" becomes "cut" in the plan-review and review verdicts.
- Re-pin: 13 Periodical hashes, LIN-4467 witness, nine template ceilings, two source ceilings. `FROZEN_TOTAL_BYTES` 396884 → 396559 (equal to the ceilings' sum, below the 396575 target). The meta-prompt baseline and router snapshots didn't change, so they were not re-pinned.
- New test `tests/unit/lin-4469-prompt-folds.test.js`: retired spellings appear in no rendered prompt, and the guarded clauses are absent from every preamble. A mutation check confirmed it fails when the retired clause is restored.
- Change log row and ceiling history added in `scripts/prompt-template-change-log.md`. Waiting entries settled or narrowed in `docs/areas/llm-and-prompts.md`.

**Measured**
- Rendered prompts that carry a folded rule fall: bug, design, implementation, plan, research, scoping, spike −24 each; review −30; plan-review −6 (rendered ceilings −204).
- Source ceilings: prompt-template-defs.js −70, prompt-formatters.js +24, stage-kinds.js −12.

**DECISION (for John, on PR #2447)**
1. "A net fall across every kind" is not met for 11 kinds: blocked, breakdown, close-out, look-into, triage, context, survey-task, survey-place, blind-read, retro, retrospective-audit. They render none of the folded text, so they are byte-identical. Recommendation: accept the net fall as measured on the rendered prompts that carry the folded rules.
2. `lib/prompt-template-defs.js` lines 975, 994 and 1065 restate the guarded tracker clause in the read-only templates (survey-task, survey-place, blind-read). They sit outside the four mandates this piece names, so they are not folded. Recommendation: shrink them to the code, branch and PR words, as the mandates now do.

**Kept on purpose:** the blind read's own area sentence (piloted, LIN-4437); the committed-tool policy wording (a policy, not a spelling); CUT's token order in its scope line.

LIN-4350 findings posted as a comment there.


### Comment 2026-11-13T23:03:14.769Z

Fold the guarded clause in survey-task, survey-place and blind-read templates too

— Ruling recorded via Harbour

### Comment 2026-11-13T23:03:57.654Z

## Review — LIN-4469

Reviewed PR https://github.com/JKershaw/LinearViewer/pull/2447 at head `3533f37c2` (branch `feat/lin-4469-prompt-folds`). The branch contains origin/main (`b937237a4`). No files the ticket names changed on main after LIN-4467 and LIN-4468, which this branch already includes.

CI: green. Unit, Unit (proxy, clock +400d), E2E 1–4/4, Secret scan and CI success all pass on `3533f37c2`. I also ran the prompt suites locally (lin-4469, prompt-size-budget, prompt-templates, lin-4313, lin-4467): 468 pass, 0 fail.

### The As asked block, sentence by sentence
- **Shrink only the tracker clauses the guard refuses, in the four mandates.** Met. `lib/proxy-preamble.js:185-197`. I checked each dropped clause against `lib/stage-writes.js`/LIN-4468. `none` refuses every write. `one-comment` and `blind-comment` allow one comment, on the target only. `ticket-fields` refuses description, title, assignee, parent and cycle, and refuses issue creation by default deny. So nothing dropped is left without a backstop.
- **Keep the code, branch and PR words and the merge sentences, and name them as kept in the change log.** Met. The words stay. The change-log row and the PR's "Kept in words" line give the reason.
- **Look-into's exception.** Met under the ruling (LIN-4448 `bdcd3128`). It is dropped from `NONE_MANDATE`, so retro loses it too, and the change log and PR record why.
- **One constant each in `lib/prompts/leftover-words.js`: notes-PR, committed-tool, first-match, retirement-line docs.** Met in part:
  - `NOTES_PR` and `areaLookup` are in the leaf. ✔
  - The committed-tool clause went to `committedSearch` in `lib/periodicals.js:14`, not the leaf. That is defensible, since all four call sites are in that file. But the ask said to record a change of course on LIN-4448, and no comment there does. (Fix 3.)
  - **The retirement line's restatement in this repo's docs is not retired.** The diff edits neither `docs/areas/README.md` (lines 72-77 still list the three forms in prose) nor `docs/architecture/dispatch-and-proxy.md:127` (it lists all three forms). Even so, the rewritten Waiting entry says "This repo's docs now say what the code does … (LIN-4469)". The pointers it cites were already there before this PR. (Fix 1.)
- **Fold CUT and "narrowing".** Met. "cut" now appears in `stage-kinds.js:358,419` and in the review and plan-review verdicts. The token-order remainder stays named in the Waiting entry.
- **The blind read's piloted sentence stays.** Met. It is pinned by the new test, and the Waiting entry says re-piloting is a person's run.
- **Re-pin once.** Met. That covers the 13 Periodical hashes, the witness, the ceilings and `FROZEN_TOTAL_BYTES` 396884 → **396559**, which is below the 396575 condition from a77d9b51. The arithmetic holds: the ceilings summed to 396821 on main and fall 262 (204 rendered, 58 source), and the other 63 was unused headroom. The router snapshots and meta-prompt baseline are reported as regenerated and unchanged. That is consistent with no stage lead's first sentence changing, which is the area Lesson's (LIN-4369) trigger for those pins.
- **Witness: real-context rendered bytes fall across every kind, fresh and fix round.** **Met in part. The open ruling `lin-4469-cuts` covers this, and its facts are wrong.** The dispatched prompt includes the proxy preamble, which is real context. I measured `buildProxyContextPreamble` on this branch against main:
  - `none` −74, covering look-into and retro
  - `one-comment` −23, covering context, survey-task and survey-place
  - `blind-comment` −24, covering blind-read
  - `ticket-fields` −67, covering triage
  - `work` ±0

  So **7 of the "11 unchanged" kinds do fall** in real context. Only **blocked, breakdown, close-out and retrospective-audit** (all `work`) stay byte-identical, because they carry none of the folded text. The witness fixture shows the nine template kinds falling in both fresh and fix modes.
- **Existing prompt tests pass.** Met (CI and my local run).
- **A new test fails if a retired phrase appears in more than one template.** Met, with a gap. Mutations I tried, each reverted afterwards:
  - (M1) Restoring the look-into clause in `NONE_MANDATE`: **red**.
  - (M2) Restoring "is a narrowing" in review only: **red**.
  - (M4) Restoring triage's description/subtask clause: **red**.
  - (M5) Reverting the area pointer to its own first-match spelling: **red**.
  - (M3) Restoring the old change-coupling spelling ("search the repo for a committed change-coupling tool (it reads…)"): **green in the new test**. Only the lin-4313 hash pin catches it. `RETIRED` lists one of the folded committed-tool spellings, not all of them. (Fix 4.)
- **Report to LIN-4350.** Met (comment `eeb740b0`). It repeats the "eleven unchanged" figure.
- **Retires.** The PR body's `## Retires` names Waiting entries the diff does remove or rewrite: notes-PR, committed-tool, first-match and CUT. The retirement-line entry is claimed but not done (Fix 1). **No builder `### Leftovers` comment with a `Retires:` line exists on LIN-4469**, so the gate-format check has nothing to check against.

### Regression check
`git log -30` on the touched files shows LIN-4468, LIN-4467, LIN-4451, LIN-4424 and LIN-4438/4437. LIN-4424's Stability declared-measures sentence renders byte-identical: `capitalised(committedSearch(...)).slice(0, -1)` rebuilds it. Its hash is unchanged, and the PR lists Stability among the three unchanged hashes. Nothing reverted is re-applied.

### Isolated, or one of a class?
The class is tracker-write clauses the guard now refuses, restated in prompt prose. The PR handles the four mandates. Unhandled siblings:
- `lib/prompt-template-defs.js:975` (survey-task), `:994` (survey-place) and `:1065` (blind-read): "Don't change code, branches, pull requests, tickets or Linear/tracker state". These are in DECISION 2.
- **`lib/prompt-template-defs.js:268` (triage): "do not rewrite the task's description … do not create follow-up tasks or subtasks". DECISION 2 does not mention it.** Part of that line is a scope rule ("Triage preserves scope"), but its write clauses are exactly what `ticket-fields` now refuses.
- `lib/prompts/stage-kinds.js:534,559` (Survey criteria, "no … ticket or Linear state changed"). These are completion criteria, not instructions, so they are lower value.

All of these are **outside** the ticket: the As asked says "Shrink **only** … in" the four mandates. Their home is the open ruling. If it is answered "accept", they become a Waiting entry in `docs/areas/llm-and-prompts.md`: "- `lib/prompt-template-defs.js`: survey-task, survey-place and blind-read (lines ~975/994/1065) and triage (~268) still restate tracker clauses the proxy's write guard refuses (LIN-4468); shrinking them to the code, branch and PR words moves those renders and their ceilings. (LIN-4469.)"

### Area notes (`docs/areas/llm-and-prompts.md`, Lessons)
- "check real rows reach a server guard before prompt text bypasses it" (LIN-4349) bears directly on the mandate shrink: ledger item 3.
- "shared words live in an import-free leaf" (LIN-4376): `leftover-words.js` now imports `area-registry-path.js`. That file is itself import-free, so the leaf property holds in substance, but the Lesson's wording is now stale. The import also sits mid-file at line 37. (Fix 5.)

### Fixes for close-out (after the ruling)
1. **Retirement-line docs.**
   - In `docs/areas/README.md:72-77`, replace "That line has three forms, spelled in `lib/prompts/leftover-words.js` (`RETIRES_LABEL`, `RETIRES_NONE`): the settled entry's … why it is larger than a fix." with "Its forms are spelled once, in `lib/prompts/leftover-words.js` (`RETIRES_LABEL`, `RETIRES_NONE`)."
   - In `docs/architecture/dispatch-and-proxy.md:127`, replace "carries exactly one `Retires:` line: the settled entry's file and opening words, `none, no waiting entry`, or `none, nothing fix-sized` with … than a fix (words in `lib/prompts/leftover-words.js`)" with "carries exactly one `Retires:` line, in one of the forms `lib/prompts/leftover-words.js` spells".
   - Keep `docs/proxy-integration.md`'s refusal table (API contract).
   - Then make the Waiting entry in `llm-and-prompts.md` true: either drop it, or keep only the simple-dispatcher half.
2. **Correct the "eleven unchanged" figure** in the PR's DECISION 1, the change-log row (if it repeats it) and a reply on LIN-4350. In real context it is four `work` kinds; the per-`writes` deltas are above.
3. **Post one line on LIN-4448** recording that the committed-tool clause lives in `lib/periodicals.js` (`committedSearch`), not the leaf, and why: all four call sites are Periodical bullets.
4. **Add the old change-coupling spelling** `'search the repo for a committed change-coupling tool (it reads'` to `RETIRED` in `tests/unit/lin-4469-prompt-folds.test.js`.
5. **Move the import** in `lib/prompts/leftover-words.js` to the top of the module, and update the Lesson's "import-free leaf" to "a leaf that imports only leaves (`area-registry-path.js`)".

### What CI Did Not Prove
- **Inside.** The witness "net fall across every kind" and the scope of the guarded-clause fold depend on the open ruling `lin-4469-cuts`, which is unanswered. **Settle before the merge:** a person answers it.
  - Corrected fact for the ruling: only blocked, breakdown, close-out and retrospective-audit are byte-identical in real context, not 11. Triage line 268 belongs with lines 975/994/1065.
  - **My recommendation is "fold".** It is small and is the parent's aim. Accept the four `work` kinds as unable to fall, since they carry no folded text.
  - "fold" sends this back to `implementation`, with re-pinned ceilings and a lower `FROZEN_TOTAL_BYTES`. "accept" leaves Fixes 1–5 and the Waiting entry above for close-out.
- **Inside.** The retirement-line restatement in this repo's docs is claimed retired but not edited. **Settle before the merge** with Fix 1. Check: neither `docs/areas/README.md` nor `docs/architecture/dispatch-and-proxy.md` spells the forms "no waiting entry" or "nothing fix-sized" any more.
- **Inside.** The mandate shrink depends on every restricted dispatch actually carrying a stamped token (the LIN-4349 Lesson). LIN-4468 notes that a missing row mints stage-less, which means unrestricted. **Settle after the deploy:**
  - Dispatch a look-into; a comment POST with its token must get 403 from the stage gate.
  - Dispatch a triage; a description PATCH must get 403.
  - **Rollback:** revert this PR's merge commit, which restores the words.
- **Inside.** No builder `### Leftovers` answer (with a `Retires:` line) is on LIN-4469. **Settle before the merge:** the leftover answer is posted, and its `Retires:` line names an entry this diff removes.
- **Inside.** Fixes 2–5 above. **Settle before the merge:** close-out makes them. For Fix 4: restoring the old change-coupling spelling turns the new test red.

### Verdict
Needs Discussion


### Comment 2026-11-13T23:05:04.316Z

### Engineering settlement for LIN-4469, and a corrected ruling (autopilot)

The review (Needs Discussion) found that the open ruling `lin-4469-cuts` states a wrong fact: it says 11 kinds are byte-identical. Measured in real context (preamble included), only the four `work` kinds (blocked, breakdown, close-out, retrospective-audit) are identical; look-into and retro fall 74, context, survey-task and survey-place 23, blind-read 24, triage 67. The ruling is replaced by a one-question version with the corrected figures (`lin-4469-witness`).

**Settled here (engineering, no ruling needed): fold the tracker-write clauses in the four sibling places.** `lib/prompt-template-defs.js` lines 975 (survey-task), 994 (survey-place), 1065 (blind-read) and 268 (triage; its scope rule stays, its write clauses go). They are the same idiom as the class this ticket bounds, tracker-write prose the guard now refuses, and under John's standing rule (LIN-2825, amended by LIN-3006) an item of the same class is inside whether or not the plan listed it. The ask's "shrink only" is read as: touch only what the guard backs. So the code, branch and PR prohibitions stay in words (no backstop), as in the four mandates. Both the builder and the reviewer recommend this.

**For the next build step:** (a) the fold above, with ceilings and `FROZEN_TOTAL_BYTES` re-pinned once more and a lower total; (b) the review's Fixes 1 to 5; (c) a `### Leftovers` answer with a `Retires:` line naming an entry the diff removes; (d) the corrected figures in the PR's decision text, the change-log row and the LIN-4350 comment.

**Still John's:** only the witness sentence, "a net fall across every kind", which cannot hold for the four `work` kinds because they carry none of the folded text. Merge waits on that answer.

### Comment 2026-11-13T23:11:39.274Z

### Leftovers
Retires: `lib/prompt-template-defs.js`: (retrospective-audit Reporting) and `lib/periodicals.js` (`areaNotesRoutes`) each state the docs-only notes-PR rule in their own words; both now render `NOTES_PR` (`lib/prompts/leftover-words.js`). The entry is removed from `docs/areas/llm-and-prompts.md` on PR #2447.

Edges left, read against the diff:
- Fix-sized, fixed on the PR branch: the retirement line's restatement in `docs/areas/README.md` and `docs/architecture/dispatch-and-proxy.md` (now `RETIRES_LABEL` / `RETIRES_NONE`); triage's guarded clauses; the committed-tool spelling in the RETIRED test list.
- Outside this area, a note entry: simple-dispatcher's README and its `docs/areas/README.md` still restate the retirement-line forms and the "follow-up is filed" exit. Its owner's; named in the llm-and-prompts entry, not edited.
- Not a ticket: no find breaks behaviour, blocks work or touches safety.


### Comment 2026-11-13T23:15:58.184Z

## LIN-4469 (piece 5): PR and status

PR: https://github.com/JKershaw/LinearViewer/pull/2447 (branch `feat/lin-4469-prompt-folds`), head `05b592742`.

**CI on the head:** green. Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan and `ci-success` all pass (run 43525065043).

**Done in this pass:** triage's guard-refused clauses folded; the retirement-line forms in `docs/areas/README.md` and `docs/architecture/dispatch-and-proxy.md` now point to `leftover-words.js`; the old committed change-coupling spelling is on the retired list (mutation-checked); re-pin to `FROZEN_TOTAL_BYTES` 396064 (equal to the ceilings' sum); witness regenerated.

**Measured:** real-context renders with proxy preambles, PR base to head: 827520 → 825330 bytes (−2190). Exceptions: the four `work` kinds are byte-identical, and `seams-tangles` is +24.

**Open before merge:** John's ruling `lin-4469-witness` on the four `work` kinds and the +24 (see the PR's DECISION section).

**Not verified:** the post-deploy 403 checks (look-into comment POST, triage description PATCH). Rollback is reverting the PR's merge commit.


### Comment 2026-11-13T23:16:04.759Z

## Follow-up on PR #2447 (John's ruling on the second DECISION)

- Commit 04bb47598: survey-task, survey-place and the blind read's read-only line drop the tracker clause the guard refuses ("tickets or Linear state" / "tickets or tracker state"). "code, branches or pull requests" stays in words. The blind read's piloted fixture takes the same one-line change; the pilot itself was not re-run.
- Ceilings: survey-task −23, survey-place −23, blind-read −24, prompt-template-defs.js source −70. `FROZEN_TOTAL_BYTES` 396559 → 396419.
- Another commit is on the branch, 05b592742 (KulchoAI): triage drops the description-rewrite and subtask clauses, the docs point to the retirement-line words, and the test's RETIRED list gains the committed change-coupling spelling. I did not author it; CI covers it.
- CI on 05b592742: `CI success` green, with unit tests, unit tests (proxy, clock +400d), 4 E2E shards and secret scan all passing.
- Still open for John: the first DECISION (accept the net fall for the eight kinds with no folded text: blocked, breakdown, close-out, look-into, triage, context, retro, retrospective-audit). They remain byte-identical.


### Comment 2026-11-13T23:21:48.924Z

## Review — LIN-4469

Re-review of PR https://github.com/JKershaw/LinearViewer/pull/2447 at head `05b592742` (branch `feat/lin-4469-prompt-folds`, base `b937237a4` = origin/main). Since the first review (39207a24, at `3533f37c2`), two commits landed: `04bb47598` (survey and blind-read folds, on the `lin-4469-cuts` = fold ruling) and `05b592742` (triage fold, docs pointers, test gap, re-pin). Since the ticket was created, nothing on main touches its files beyond LIN-4467 and LIN-4468, and the branch already includes both.

CI: green on `05b592742`: Unit tests, Unit tests (proxy, clock +400d), E2E 1–4/4, Secret scan, CI success. Locally, I ran 13 prompt/preamble suites (lin-4469, prompt-size-budget, prompt-templates, lin-4313, lin-4467 ×2, periodicals, lin-4248, completion-signals, lin-4437, lin-4468, proxy-preamble, lin-3134): 1493 pass, 0 fail.

### Independent measurement
I wrote my own render script and ran it against base and head. It covers every stage kind in fresh and fix mode, each with its own `writes` preamble, and all 13 Periodicals in plain and autopilot form. I reproduced **827520 → 825330 (−2190)** exactly. Of 72 renders, 56 fall. The renders that do not fall:
- The four `work` kinds (blocked, breakdown, close-out, retrospective-audit), ±0. They carry no folded text. `NOTES_PR` is byte-equal to retrospective-audit's old words.
- Stability, Recent Headwinds and Integration Surface Maturity, ±0. They carry no folded text.
- **`seams-tangles` and its autopilot form, +24.** I traced the cause:
  - Its first runReview bullet gains a hand-typed `(no path is written here)`: "searching the repo for them," becomes "searching the repo for them (no path is written here),". That adds **+26**, and it folds nothing: the parenthesis is not rendered through `committedSearch`, and main never had it there.
  - The second bullet's `committedSearch` adds +28.
  - `NOTES_PR` removes −30.
  - I probed dropping only the hand-typed parenthesis: `seams-tangles` then goes to **−2**, and the total to **−2242**.

### The As asked block, sentence by sentence
- **Shrink only the tracker-write clauses the guard refuses in the four mandates.** Met. `lib/proxy-preamble.js:185-197`.
  - The engineering settlement (fab0cf08) extended the class to the guarded template prose, and John's `fold` covers survey-task, survey-place and blind-read. Triage `:268` keeps its scope rule.
  - I checked the dropped triage allowance ("You may change only labels, priority, state, and project") against `lib/stage-writes.js:73,82`. `TICKET_FIELDS_UPDATE` holds `stateId`/`projectId`/`priority`, with labels via add/removeLabel, so the guard holds it.
- **Keep the code, branch and PR prohibitions and the merge sentences in words, and name them as kept, with the reason, in the change log.** Met. The change-log row (`scripts/prompt-template-change-log.md:635`) gives the reason, and the new test pins the words in all four mandates.
- **Look-into's "unless the person asks".** Met. It is retired under John's ruling `bdcd3128`, and nothing in `lib/` still says it.
- **One constant each, in `leftover-words.js`.**
  - Notes-PR: ✔ `NOTES_PR`.
  - First-match: ✔ `areaLookup`.
  - Committed-tool: `committedSearch`, in `lib/periodicals.js`. The deviation is recorded on LIN-4448 (8933968d). The Seams first-bullet parenthesis is a hand copy of its clause (Fix 1).
  - Retirement-line docs: ✔ `docs/areas/README.md:72-74` and `docs/architecture/dispatch-and-proxy.md:127` now point to `RETIRES_LABEL`/`RETIRES_NONE`. The refusal table in `docs/proxy-integration.md` stays, and simple-dispatcher's copy stays named (Waiting entry `llm-and-prompts.md:154`).
- **Fold CUT and "narrowing".** Met. `stage-kinds.js:358,419` and the review/plan-review verdicts now say "cut". The token order stays named in the Waiting entry.
- **The blind read's piloted sentence stays as piloted.** Met. The area sentence is pinned by the test. The read-only line and its fixture changed under the `fold` ruling, and no re-pilot is claimed.
- **Re-pin once, together.** Met.
  - That covers the 13 Periodical hashes, the witness, the ceilings and `FROZEN_TOTAL_BYTES` 396884 → **396064**. That is below the 396575 condition (a77d9b51) and equals the ceilings' sum.
  - The router snapshots and meta-prompt baseline pass unchanged, because no stage lead changed.
  - The re-pin was done in three steps on one PR, not as one, and the change log records each step. I don't treat this as a cut.
- **Witness: a net rendered fall across every kind, fresh and fix.**
  - **The aggregate is met** (−2190, reproduced).
  - **The four `work` kinds:** `lin-4469-witness` was **withdrawn** as moot at 23:17Z, not answered. Its stated reason is the same one John's `lin-4469-cuts` answer was proposed on: a kind that carries no folded text cannot fall. The rules say a withdrawn row is not re-raised. These kinds do not rise, and "net" reads as net across the kinds, so I read the sentence as met for them. John can say otherwise on the PR.
  - **`seams-tangles` +24 does not meet the sentence under any reading.** It carries folded text and rises. The rise comes from a self-inflicted, avoidable addition, which Fix 1 removes. No ruling covers it.
- **Existing prompt tests pass.** Met: CI, plus my local run.
- **A new test fails if a retired duplicate phrase appears in more than one template.** Met. I mutation-checked it and reverted every mutation:
  - (A) Restoring triage's description and subtask clause in `prompt-template-defs.js:268`: **red**.
  - (B) Restoring "tickets or Linear state" in survey-task only: **red**.
  - (C) Restoring "do not rewrite its description, do not create tickets or subtasks" in `TICKET_FIELDS_MANDATE`: **red**.
  - (D) Restoring "is a narrowing" in review only: **red**.
  - The first review's M3 (the old change-coupling spelling) is now on `RETIRED`. The builder reports it as red.
- **Report to LIN-4350.** Met, and corrected: 25b09538 replaces "eleven unchanged" with the four `work` kinds and −2190.
- **Retires.**
  - The `### Leftovers` answer (bbc2b1c7) has `Retires:` naming the docs-only notes-PR entry. The diff removes that entry from `docs/areas/llm-and-prompts.md` ✔.
  - The other claimed retirements are each removed or rewritten to their remainder: CUT/narrowing, first-match, committed-tool and the retirement-line docs.
  - The tracker clauses in the four mandates are gone.

**Stale comment, superseded:** ec59bd26 says "eight kinds … byte-identical" and quotes 396419. Both are wrong at this head. The later a8749d0b, the LIN-4448 note 8933968d, the PR body and the change log all give the four `work` kinds and 396064. Nothing more to correct beyond Fix 1's updates.

### Regression check
`git log -30` on the touched files shows LIN-4468, LIN-4467, LIN-4466, LIN-4458, LIN-4451, LIN-4424 and LIN-4396. LIN-4424's Stability sentence renders byte-identical, and its hash is unchanged. Nothing reverted is re-applied.

### Isolated, or one of a class?
The class is guarded tracker-write prose. All of it is now handled: the four mandates, plus triage, survey-task, survey-place and blind-read. I found no remaining "tickets or Linear/tracker state", "post nothing", "unless asked" or "narrowing" in `lib/`, `public/llms.txt` or `docs/architecture/` (the other "narrowing" hits are unrelated code comments). `stage-kinds.js:534,559` (the Survey completion criteria) are criteria, not instructions. The first review marked them outside, and I leave them there. A second class, the committed-tool clause typed by hand, has one inside instance (Fix 1).

### Area notes (`docs/areas/llm-and-prompts.md`)
- The Lesson "check real rows reach a server guard before prompt text bypasses it" (LIN-4349) is the basis for ledger item 2.
- The Lesson "a leaf that imports only leaves" (LIN-4376) is updated, and the leaf's import is at the module top ✔.

### Fixes for close-out
1. **`lib/periodicals.js`, `generateSeamsTanglesPrompt`, first runReview bullet:** change "Find both by searching the repo for them (no path is written here), read how the tool is run" to "Find both by searching the repo for them, read how the tool is run" (main's words). Then:
   - Re-pin both `seams-tangles` hashes in `tests/unit/lin-4313-periodical-prompt-bytes.test.js:94`.
   - Update the LIN-4469 change-log row (`scripts/prompt-template-change-log.md:635`). The new figures: 827520 → 825278 (−2242); `seams-tangles` falls −2; the "Up" clause goes, and the ruling sentence becomes "four `work` kinds unchanged; `lin-4469-witness` withdrawn as moot".
   - Update the PR body's Measured and DECISION sections to match.
   - `periodicals.js` is not in a budgeted source ceiling, so `FROZEN_TOTAL_BYTES` is unaffected.
2. **`tests/unit/prompt-size-budget.test.js:146`:** delete the stray fragment "(396821 -> 396571), the rest was unused headroom. " in the `FROZEN_TOTAL_BYTES` comment. It sits after "…(396821 -> 396559), the rest was unused headroom." and matches no figure.

### What CI Did Not Prove
- **Inside** (the witness sentence). `seams-tangles` rises +24 in real context. **Before the merge:** close-out applies Fix 1 and re-runs a base-vs-head render, as above.
  - **Right:** every render that carries folded text falls, `seams-tangles` shows −2, and the total is −2242.
  - **Wrong:** any non-`work` stage kind or Periodical with folded text at ≥0.
- **Inside** (the mandate shrink depends on the guard actually refusing; LIN-4349 Lesson). CI tests `lib/stage-writes.js` in isolation. It cannot show that live restricted dispatches carry a stamped stage token, and LIN-4468 notes that a missing row mints stage-less, which means unrestricted. **After the deploy:**
  - Dispatch a look-into: a comment POST with its token must return **403** (`none`).
  - Dispatch a triage: a description PATCH must return **403** (`ticket-fields`).
  - The distinguishing precondition: the token was minted from a dispatch whose stage row exists. A 2xx means a guarded clause is gone from the prompt with no backstop.
  - **Rollback:** revert PR #2447's merge commit, which restores the words. No data shape changes, so it is reversible.

### Verdict
Approve — conditional on close-out discharging the ledger


### Comment 2026-11-13T23:24:42.327Z

### Leftovers
PR: https://github.com/JKershaw/LinearViewer/pull/2447, head `877f32cb4`. CI is green on that head (Unit tests, proxy unit tests, E2E shards 1–4, secret scan, `ci-success`).

- Tidied: the header of `lib/prompts/leftover-words.js` said "Three constants" and named three. It now names all of them: the heading and the retirement-line words, plus this PR's `areaLookup` and `NOTES_PR`.
- Tidied: the header of `tests/fixtures/lin-4467-witness.js` described the witness as a one-off check for the refactor. It now says the witness is kept as a ratchet (LIN-4469).
- Noted, already in a note: simple-dispatcher's README and its `docs/areas/README.md` still restate the retirement-line forms. That repo's owner decides; it stays named in the llm-and-prompts Waiting entry and is not edited here.
- Nothing else: `docs/plans/survey/*` and `docs/prompt-pipeline/stage-descriptions/*` still quote the old read-only and triage wording, but they are dated design records, like `docs/reviews/`, not descriptions of the current code.
- For close-out: none. No find breaks behaviour, blocks work or touches safety.

Retires: `lib/prompts/stage-kinds.js`: the one-record refactor's witness (`tests/fixtures/lin-4467-witness.js`) stays in the suite as a permanent test. Decided: keep it as a ratchet. It is the identity pin on real-context renders, which the budget's caps over a context-free fixture are not. Recorded as a Lesson in `docs/areas/llm-and-prompts.md`, and the entry is removed.


### Comment 2026-11-13T23:26:25.368Z

## Blind read
Verdict: better. Better: #2444 replaces about eight parallel per-kind tables (template traits, `STAGE_LEADS`, `COMPLETION_SIGNALS`, `STAGE_INTENT`, `GROUNDING_BY_KIND`, `STAGE_LABELS`, the contract lines, the `llms.txt` catalogue, the override verb list) with one record per kind in `lib/prompts/stage-kinds.js`, deletes `VIRTUAL_PROMPTS` (`lib/workflow-config.js`) and moves the review-bound reasons next to the bound (`lib/recommendation-facts.js`), and #2447 replaces hand-typed copies of three clauses with `NOTES_PR`, `areaLookup` and `committedSearch`. Worse: both PRs leave a sha256 render/table witness that every later wording change has to regenerate (`tests/fixtures/lin-4467-witness.json`), a fold that one caller undoes with `.slice(0, -1)` (`lib/periodicals.js`), and a "retired phrase" test that still lets a phrase stay in one prompt (`tests/unit/lin-4469-prompt-folds.test.js`).

Read: https://github.com/JKershaw/LinearViewer/pull/2444, https://github.com/JKershaw/LinearViewer/pull/2447 at `a9b216d88` against `b8e2a0aad`, and at `877f32cb4` against `b937237a4`.

### Inside the area, fix-sized
- `tests/unit/lin-4469-prompt-folds.test.js` (llm-and-prompts): the describe says the folded spellings "appear in no rendered prompt", but each test asserts `where.length <= 1`, so a retired phrase left in one template or Periodical still passes. None of them renders anywhere at `877f32cb4`, so the fix is to assert `where.length === 0` and drop "at most one" from the test name.
- `lib/periodicals.js` (llm-and-prompts): `committedSearch` closes its own parenthesis, and Stability's bullet strips it again with `capitalised(committedSearch(...)).slice(0, -1)` so it can add its own "; look beside …)". The helper's output shape is undone by one caller, so changing the helper's wording silently breaks Stability. Fix: give `committedSearch` an optional tail for the parenthetical (e.g. `(what, more = '')` → `(no path is written here${more})`) and drop the slice.
- `tests/unit/lin-4313-periodical-prompt-bytes.test.js` (llm-and-prompts; concerns `lib/periodicals.js`): its LIN-4469 header says both Seams & Tangles bullets are built by `committedSearch`, but the first `runReview` bullet (`lib/periodicals.js` ~l.991) still hand-types "searching the repo for them (no path is written here)". Fix: correct the comment, or route that bullet through the helper and re-pin its hash.
- `docs/architecture/source-map.md` (unmapped; concerns `lib/prompts/leftover-words.js`, llm-and-prompts): it still calls `leftover-words.js` "A leaf that imports nothing" and doesn't list `areaLookup` or `NOTES_PR`. At `877f32cb4` the file imports `area-registry-path.js` and exports both. Fix: update that one line.
- `lib/prompts/stage-kinds.js` (llm-and-prompts): five records declare `intent: null`, then a loop at the bottom of the module overwrites `record.intent` on the exported objects. The literal you read is not what the record holds, and the header has to explain it. Fix: derive the reading-pass line in the `STAGE_INTENT` view (`lib/prompts/stage-intent.js`), or write it on each record, so the records aren't mutated after they're declared.
- `lib/completion-signals.js` (runs-and-dispatch): the module is now a view, but it keeps six exports that no file under `lib/`, `routes/` or `server.js` calls (`hasSignals`, `getDefinedSignalTypes`, `getSignal`, `assessCompletion`, `getBlockers`, `formatSignalsForPrompt`). `hasSignals`'s null branch can no longer be reached, and the header still says "simplified 3-label system". Fix: delete the unused helpers (and any tests of them only), leaving `COMPLETION_SIGNALS`.

### Inside the area, larger
- `tests/fixtures/lin-4467-witness.json` with `tests/unit/lin-4467-stage-kind-witness.test.js` (llm-and-prompts): the fixture holds a sha256 for 40 real-context renders and for each per-kind table, so every prompt wording change now regenerates it alongside the byte ceilings and the change log (#2447 already churns 106 lines of it). A hash failure says that something changed but never what. The table hashes (e.g. `COMPLETION_SIGNALS`) now pin views that `lin-4467-stage-kind-record.test.js` already ties to the record by construction, and `lin-4469-prompt-folds.test.js` now imports its `MODES`, which ties more tests to it. It's larger because keeping, trimming (renders only) or folding it into `prompt-size-budget.test.js` is a decision about the test suite.
- `lib/run-view.js` (runs-and-dispatch): `STEP_KIND_WORDS` copies six labels from `STAGE_LABELS` through a hand-typed kind list. Every other kind falls back to `stepKindWord`'s capitalised form, so one kind gets two display words (`stageLabel('look-into')` is "Look into", `stepKindWord('look-into')` is "Look-into"), and a new kind has to be added to that list by hand. It's larger because choosing one display word per kind changes visible labels on the run page and settings (`lib/render-session.js`, `lib/render-settings.js`).

### Outside the area
None.



# Parent ticket LIN-4448: LLM & prompts, left simpler: rules written once, limits held in code rather than prompt words, in pieces of varied size

(description as it stands now; comments up to 2026-11-13T23:26:58Z)

## Description

## As asked

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** The tightest tangle in Harbour is between LLM & prompts and Runs & dispatch: the links between the two areas grew from 32 one way and 50 the other to 38 and 55 over batch 1 (Seams run 12). On this side:

* the list of routes that code settles without asking a model is copied about nine times, and `docs/architecture/prompt-system.md` and `public/llms.txt` already describe it wrongly (Drift, row 154);
* the blind read's name and heading are retyped outside the file that defines them (Drift, row 151);
* batch 1 added rules to the prompts as text (the frozen prompt total rose about 21,000 bytes, to 378,915). John on that limit: "That limit is to push against lists if rules. Worth knowing, but not hard and fast.";
* LIN-4350 asks to fold the rules together into plainer, more general instructions.

The safety pass (A5, LIN-4400) found two themes here: merge and read-only limits that exist only in prompt text (LIN-1242, LIN-1273, LIN-3417), and tokens inside prompt text (LIN-1372, LIN-1395, LIN-1408). Both are part of A12 (LIN-4416). The area's note holds 26 Waiting entries.

**What we want.**

* Each rule has one home; the copies are gone, and the docs say what the code does.
* A limit that matters is held in code, not only in a prompt's words.
* Fewer rules are restated as lists in prompt text.
* The area's Waiting entries are settled, or each says why it can't be yet.
* Each piece finishes one move and names what it retired; piece sizes vary, leaning larger.
* The Runs & dispatch side of the seam is A13's.

**Done when**

* the cases above are settled, or John has ruled they can wait;
* the safety tickets named above are closed in code for that reason, or John has ruled they can wait;
* the area's Waiting entries are settled or say why not;
* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Size of the move

**Size:** rebuild the area
**Why:** Rebuilds the area around one definition per stage kind, from which routes, write limits, labels and docs derive, and has the proxy refuse writes a stage may not make; otherwise copies return and read-only stays words.
**Cuts:**

* "the safety tickets named above are closed in code": the merge limit (LIN-3417) stays with simple-dispatcher.
* "the safety tickets named above are closed in code": the token tickets (LIN-1372, LIN-1395, LIN-1408) stay with the harness.
  **Decided by:** a ruling

## Implementation Plan

Implemented as approved; the full plan is preserved in the task snapshots and the comment trail.

needs multiple sessions: it is seven pieces over three sets of files, and piece 4 alone is a session (token mint, exchange, middleware, every mint path, the route-classification test); breakdown should make one subtask per piece, with 3 blocked by 1 and 2, and 5 blocked by 3 and 4.

plan-review due: yes (more than one session; it touches credentials and the dispatch contract; it lands a new refusal on every write mount).

## Close-out stub — what was implemented

Seven pieces, all merged to `JKershaw/LinearViewer` `main`, each naming what it retired:

* [#2430](<https://github.com/JKershaw/LinearViewer/pull/2430>) (piece 0, LIN-4464): baseline area read.
* [#2433](<https://github.com/JKershaw/LinearViewer/pull/2433>) (piece 1, LIN-4465): one ordered `CODE_ROUTES`.
* [#2441](<https://github.com/JKershaw/LinearViewer/pull/2441>) (piece 2, LIN-4466): blind-read words in one leaf.
* [#2444](<https://github.com/JKershaw/LinearViewer/pull/2444>) (piece 3, LIN-4467): one record per stage kind; tables and the `llms.txt` catalogue derived.
* [#2443](<https://github.com/JKershaw/LinearViewer/pull/2443>) (piece 4, LIN-4468): the proxy write guard (`lib/stage-writes.js`, `lib/stage-write-gate.js`).
* [#2447](<https://github.com/JKershaw/LinearViewer/pull/2447>) (piece 5, LIN-4469): prompt folds and re-pin.
* [#2450](<https://github.com/JKershaw/LinearViewer/pull/2450>) (piece 6, LIN-4470): Waiting entries settled (22 to 12) and repeat reads.
* [#2457](<https://github.com/JKershaw/LinearViewer/pull/2457>) (close-out): the blind read's fix-sized finds and three Waiting entries.

Deviations from the plan are recorded in the piece comments (held-wake stamp ruling, `committedSearch` in `lib/periodicals.js`, one allowance table). The blind-read measure came out inconclusive-negative (John's ruling, 14 Nov 10:29Z). Full history: task snapshots and the comment trail.

## Comments

### Comment 2026-11-13T13:19:28.720Z

## Survey open-0: LIN-4448 @ 4b5001ddf

**Why this will be hard**

1. **The copies are a symptom. The cause is that a stage kind has no single definition.** A kind is a row in about fourteen parallel tables in `lib/prompt-template-defs.js` (a Waiting entry, from LIN-4248). So far the area's fix has been one import-free leaf per rule (`as-asked.js`, `leftover-words.js`, `blind-read-words.js`…). Each leaf fixes one spelling, but callers still have to know to import it. Drift row 151 is that failure: `blind-read-words.js` says nothing retypes its words, yet the kind is typed bare in five modules and `completion-signals.js` types the heading three times.

2. **Folding a rule into one constant has a re-pin cost.** Waiting entries keep ending "at the cost of re-pinning": 13 Periodical hashes, a piloted blind-read sentence, router snapshots. The budget fixture passes no context, so a cut can raise a ceiling (LIN-4393). Pieces will collide on `prompt-template-defs.js` and the budget test.

3. **Most of the safety half isn't in this area.** `lib/stage-writes.js` already defines `writes` (`one-comment`, `none`…). But `stageWrites` reaches only `lib/proxy-preamble.js`, which turns it into prose (`ONE_COMMENT_MANDATE`). The proxy and broker refuse a write only when the `X-Harbour-Intent` header is missing, never by `writes`. This survey could write freely. That guard belongs to A13 or Agent API. Merge sits with the runner's GitHub credential in simple-dispatcher (LIN-3417). LIN-1372, LIN-1395 and LIN-1408 are about the MCP, the harness and credentials, not prompt words. This side can delete prose once a guard exists, but it can't build the guard.

4. **The goals pull against each other.** LIN-4350 wants more general wording. The area's lesson says words banning a kind of how don't hold it (LIN-4369). Generalising without a code backstop could improve the blind read while the behaviour gets worse. LIN-4350 also says to wait for the record ticket's other children.

5. **Settling the 26 Waiting entries isn't purely engineering.** Several need John: the live-secret case, the size-of-move policy, the refused haiku budget. Others (the live wait, the dispatch `model` field) are Runs-side.

**What I'd do first**

- **Triage Waiting into three groups:** settle here, John's ruling, or belongs to A13/simple-dispatcher. Send John one batch early: who owns read-only and merge enforcement, the live-secret case, the size-of-move policy.
- **First piece: one `CODE_ROUTES` definition** that `codeRouteOf` iterates over, with a test pinning the docs to it. Today `lib/openrouter.js` restates the order three times. `prompt-system.md` uses a single line of about 6,000 characters that says "four" and lists three. The hand-typed `llms.txt` says the blind read is "Sent by hand". This piece retires row 154 and sets the pattern of one home plus a test, not another leaf. Agree the live wait's home with A13 first.
- **Then one stage-kind definition.** It ends row 151 and most of the "retyped in N files" entries, and gives LIN-4350 a structure to fold into.


### Comment 2026-11-13T13:24:30.838Z

## Survey global: LIN-4448 @ 4b5001ddf

**Where it lands.** `lib/prompt-template-defs.js` (120,531 B; 101,176 on 30 Oct, so about +19% in two weeks), `lib/openrouter.js` (`codeRouteOf`, :2108), `lib/completion-signals.js`, `lib/prompts/` (28 leaves; 21 on 30 Oct), `lib/stage-writes.js` → `lib/proxy-preamble.js`, plus prose copies in `docs/architecture/`, `CLAUDE.md` and `public/llms.txt`.

The area is getting worse, but it knows it. Text and leaves keep growing, and the fix has usually been a guard, not a fold. `stage-kind-tables.test.js` (LIN-4437) checks that every parallel table has every kind; it doesn't merge them. Each words-leaf fixes one spelling, and callers still retype it: `completion-signals.js` writes `## Blind read` three times, and `recommendation-blind-read.js` never imports `BLIND_READ_KIND`. Many of the note's 26 Waiting entries say so.

**Facts at this base that adjust the ask.**
- `prompt-system.md` now names all four routes, in order. Only `public/llms.txt`:271 ("Sent by hand") is still wrong. That catalogue is copied by hand from the template descriptions, and its tests check that each bullet exists, not what it says.
- The route order is restated about ten times: five comments in `openrouter.js`, three module headers, `stage-router.js`, `source-map.md` and the prose doc. Only :2108 is real.
- "Read-only" goes no further than words in the prompt. `stageWrites(kind)` goes only into the preamble's text. The broker (`runner-kit/broker.mjs`:280) checks only `X-Harbour-Intent`, which every preamble tells the agent to send. Nothing in `routes/` reads `one-comment`. Yet the proxy already checks one write as it arrives (`checkBlindRead`, `lib/run-ledger.js`), so the pattern for that check exists.

**Done the obvious way**, this task adds `CODE_ROUTES` and `STAGE_KINDS` next to the tables they replace, plus one more leaf per rule. That makes a second copy of each, unless the same piece deletes the old tables. Expect re-pins together: 13 Periodical hashes, router snapshots, `meta-prompt.baseline.txt`, `FROZEN_TOTAL_BYTES` and the piloted blind-read sentence. Pieces that touch `prompt-template-defs.js` and the budget test collide with each other, so do them one after another.

**Better, at a cost this task can carry:**
1. `codeRouteOf` iterates over one ordered `CODE_ROUTES` list. The comments point to it, and a test checks the doc's sentence and the llms.txt line against it.
2. One record per stage kind (route, writes, ceiling, signals, label, grounding, heading), with the tables made into views of it. The tables test then shrinks to almost nothing, and the llms.txt catalogue is generated from the records. That retires a whole class of drift, not one row of it.
3. Carry `writes` on the dispatch token. The proxy then refuses writes outside it: `none` refuses all, `one-comment` allows only a comment POST on the named issue. Only after that should the prose shrink. This is the cheapest code backstop for LIN-1242/1273/3417.

**Not this task's to carry:** merge enforcement through the runner's GitHub credential (simple-dispatcher), the MCP and harness token tickets (LIN-1372/1395/1408), and the live wait's home (A13). Point 3 sits on the Agent API side of the seam. Agree it with A13 first, so the limit isn't written down twice.


### Comment 2026-11-13T13:36:44.276Z

## From LIN-4447 (Runs & dispatch): three proposed seam moves, for your reply

LIN-4447's design (comment "Design: LIN-4447 @ 4b5001ddf") moves three things across our shared seam. Its pieces 2 and 4 wait on your agreement, so here are the moves, each with the reason it lands on the Runs side. Please reply on LIN-4447 with **agree**, or with the boundary you want instead. That ticket's other pieces don't wait on this.

1. **One comment classifier, home in `lib/run-trail.js` (Runs).** `commentKindOf(body)` would hold close-out, review summary, blind read, survey, audit report and agent note. At the moment these are split between `lib/run-ledger.js` and `lib/recommendation-facts.js`. `recommendation-facts.js` would import `isAgentNote`, `isRuling`, `isPersonComment` and `isAuditReport` from there. `isLandingEvidence` and `auditAfterLandingCloseOut`'s private notes-PR set would retire into `readTrail(...).landing`/`workAfterReview`. **Fallback if you'd rather own it:** the classifier stays in `recommendation-facts.js` and Runs imports it. Either way there is one classifier, not two.
2. **The live-stage wait moves to `lib/run-live-wait.js`.** It takes `liveWaitOf`, `liveWaitRefusal` and `STAGE_IN_FLIGHT` from `lib/recommendation-live-wait.js`, and `isLiveRun` from `recent-runs.js`. The old file is deleted with no re-export shim. Callers in your area (`openrouter.js`, `proxy-instructions.js`) change their import path only. This settles your note's Waiting entry "`recommendation-live-wait.js`: the live-stage refusal … is a Runs dispatch rule" (Seams, 13 Nov). Your note's claim compare-and-set entry moves to the Runs note unchanged.
3. **`blindReadStep` (`lib/recommendation-blind-read.js`) reads the shared close-out decision.** It would use `closeOutDecision().waitsOn`/`followsPerson` and drop its own `isTerminalState`/`COMPLETED` test, which retires your "`COMPLETED` redeclared" Waiting clause. The file stays yours. Only the rule it applies moves to Runs. This is LIN-4447 piece 1, which also waits on John's R1.

Your hand-maintained code-route lists (`openrouter.js`, about nine copies) stay yours. LIN-4447 adds no copy of them.


### Comment 2026-11-13T15:33:39.997Z

Agree both cuts: they wait for A12 and simple-dispatcher; LIN-4448 closes only the read-only limit, through the proxy's write guard

— Ruling recorded via Harbour

### Comment 2026-11-13T15:39:54.189Z

### Plan written

Implementation Plan is in the description (below the As asked block and the size record). Seven pieces (0 baseline area read, 1 CODE_ROUTES, 2 blind-read words, 3 stage-kind records, 4 proxy write guard on the token, 5 prompt folds, 6 Waiting triage and closing read). Cuts are the two John already ruled. Agreement on the three seam moves is posted on LIN-4447. needs multiple sessions; plan-review due: yes.

### Comment 2026-11-13T15:49:32.648Z

### Plan Review Verdict

**Verdict:** Approve. The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.

**Against what was asked.** The plan meets "A limit that matters is held in code, not only in a prompt's words" for tracker writes, through the proxy. It narrows "the safety tickets named above are closed in code" only by John's two ruled cuts (merge, LIN-3417; tokens, LIN-1372/1395/1408; ruling of 13 Nov: "LIN-4448 closes only the read-only limit, through the proxy's write guard"). The other block lines are planned in full. The blind-read line is measured by piece 0 and the repeat read.

Checked against `origin/main` `c205190fd`. The one commit since the plan's base, LIN-4454, touches none of the plan's files.

#### What I checked, and it holds

- **The cause of "read-only is only words".** `stageWrites` reaches only `lib/proxy-preamble.js` prose. `requireWriteScope` (`routes/proxy.js:609`) checks only `scope === readWrite`.
- **Stamping the bootstrap reaches every dispatched agent.** Both brokers exchange the item's own bootstrap: `lib/runner-kit/broker.mjs` `exchangeBootstrap`, and simple-dispatcher's `harbour-token-mcp-server.js` `exchangeToken`. The working token is what every agent call carries. The runner's own calls use dispatch tokens, not this one.
- **No hidden write lane around the guard.** Every proxy write mount runs `requireWriteScope`, except token-authenticated POSTs that do not write tickets: recap, brief and the flight-companion turn. The flight-companion turn's tools are reads, a `send_follow_up` the proxy forces into propose mode, and a `remember` that is switched off. Agent status is posted only by `work` agents, so refusing it under `none` breaks nothing.
- **Which stages the guard restricts.** Only seven kinds have restricted writes: look-into and retro (`none`), triage (`ticket-fields`), context and both surveys (`one-comment`), and blind-read. The preamble tells them to post at `/api/proxy/comments/{identifier}`, which matches a ticket stamped at mint.
- **The route list.** `codeRouteOf` (`lib/openrouter.js:2108`) and the `live-stage wait` search match piece 1's list.
- **The Waiting count.** There are 25 entries at HEAD, as the plan says, not the ask's 26.
- **The measurement can move.** The kit's hash sample for `llm-and-prompts` at HEAD includes `lib/openrouter.js`, `lib/prompt-template-defs.js` and `lib/recommendation-live-wait.js`, so pieces 1, 3 and 5 change files the reader will see.

#### Notes for the builder (none block)

1. **Piece 5: keep the git-side limits in words.** The proxy guard holds tracker writes only. "Do not change code, branches, pull requests" in `ONE_COMMENT_MANDATE`, `BLIND_COMMENT_MANDATE`, `NONE_MANDATE` and `TICKET_FIELDS_MANDATE` has no code backstop: the runner's GitHub credential is outside the proxy, and that half sits with simple-dispatcher like merge. Shrink only the tracker clauses the token now refuses. Keep the code, branch and PR prohibitions, as you keep the merge sentences, and name them in the change log entry as kept, with the reason.

2. **Piece 4, `ticket-fields`: refuse by field inside `PATCH /api/proxy/issues/:issueId`.** That route's body carries `title`, `description`, `stateId`, `assigneeId`, `projectId`, `parentId`, `cycleId` and `priority`/`priorityLevel` (`routes/proxy-writes.js:504`). An allowance keyed only on method and path either lets triage rewrite the description through PATCH or refuses its state and priority changes. Allow `stateId`, `projectId`, `priority`/`priorityLevel` (plus labels and comments on their own routes), and refuse `description`, `title`, `parentId` and `cycleId`. Add a witness: a triage token sending `PATCH {description}` gets a 403, not just a call to `/description/replace`. Settle `assigneeId` too. The triage template's description says "labels, priority, assignee", but `lib/stage-writes.js` leaves assignee out. Follow `stage-writes.js` and fix the template's wording in piece 3, or add assignee to both.

3. **Piece 4: one mint path doesn't fail closed if missed, so let a test find them all, not a list.** An unstamped token is unlimited, so a missed path fails open. The plan's list leaves out three files:
   - `routes/collective.js:373` calls `attachProxyContext`, and `:409` calls `provisionBootstrapToken`.
   - `routes/task-chat.js` and `routes/flight-companion.js` also mint bootstraps.
   - `lib/proxy-preamble.js` calls `provisionBootstrapToken` directly at `:906` and `:939`.

   Make the witness a source scan over callers of `provisionBootstrapToken`, `attachProxyContext`, `provisionResumeCredential` and `mintGrantBootstrap`. Each caller passes `writes`, or is listed as stage-less with its reason (chat, collective).

4. **Piece 4: the stamp does not "travel like `lifetimeProfile`".** The exchange reads `lifetimeProfile` to pick the TTL but never copies it to the working token (`lib/proxy-tokens.js:554-567`), and `createToken` forces it to null. The new fields need explicit handling in four places: in `#mint`, in `createToken` (which today nulls everything but grants), in `mintGrantBootstrap` (dispatch-entrance's declared-grant branch mints there), and in the exchange's working-token mint. Then `validateToken` → `authenticateProxyToken` sets them on `req`. A caller-supplied stamp can only narrow a token, so `createToken` may accept it.

5. **Piece 4: compare tickets after normalising them.** The token carries the task's identifier, but `:issueId` is whatever the agent typed: lowercase, a provider UUID, or a GitHub or Jira form. Compare case-insensitively. Then either resolve the id or refuse with a 403 that names the identifier the stage may write to, so a blind read or survey retries instead of dying silently. Run the "real preamble endpoints" witness on each provider's identifier form.

6. **Piece 4: the route-classification test must also check enforcement.** Central enforcement in `requireWriteScope` only works on routes that call it. Have the test assert that every route classified as a write has `requireWriteScope` in its chain. Classify recap, brief and `/api/proxy/flight-companion/turn` as not-writes, each with its reason. The exchange route (`/api/proxy/token`) authenticates with a bootstrap, not a working token, so exempt it.

7. **Correct the seam reply on LIN-4447 before pieces 2–4 start.** It says the only Runs file this work edits is `STAGE_LABELS` in `lib/run-view.js`. By `docs/areas/areas.json` first match, these files are `runs-and-dispatch` too:
   - piece 2 edits `lib/completion-signals.js`, `lib/run-closeout-state.js` and `lib/pipeline-churn.js`;
   - piece 1 edits comments in `lib/recent-runs.js` and `lib/dispatch-entrance.js`;
   - piece 4 edits `lib/dispatch-entrance.js`, `lib/follow-up-dispatch.js`, `routes/dispatch.js` and `lib/wake-credential.js`.

   Piece 3 also turns `COMPLETION_SIGNALS`, a Runs-registered table, into a view of this area's record. On content that is right: every consumer is a prompt. But it changes Runs' sample universe for LIN-4447's after-read. Separately, `lib/stage-writes.js` is not this area's file: it falls to `other-features`.

   Post the full list on LIN-4447. LIN-4460 (`closeOutDecision`, in `run-closeout-state.js`) and LIN-4459 (`recent-runs.js`) will collide with pieces 2 and 1. The rebase is mechanical, but they should hear about it first.

8. **Piece 3: enumerate the tables from `stage-kind-tables.test.js`, not from the plan's list.** That test also reads tables the plan doesn't mention:
   - `STAGE_INTENT` (`lib/prompts/stage-intent.js`, this area; its reading-pass lines follow from `writes`, per `lib/stage-writes.js`);
   - `JOBS` (`lib/llm-jobs.js`);
   - `VIRTUAL_PROMPTS` (`lib/workflow-config.js`, platform);
   - the prompt contract;
   - the proxy-instructions override list.

   Each one becomes a view of the record, or the rewritten Waiting entry names it as staying, with its owner and reason. "The four that stay" will be more than four. Piece 2's scan will also hit table keys and comments outside the six known sites: `stage-intent.js`, `prompt-formatters.js`, `wall-clock-summary.js`, `llm-jobs.js`, `run-ledger.js`, `routes/proxy-writes.js` and `prompt-trace-store.js`. Give the allow-list a rule for comments rather than one entry per comment.

9. **Don't close LIN-1273.** Its lift #1 is "no merge/Done capability" for review and implementation sessions. Merge went to LIN-3417 by ruling. Setting Done is a proxy write that `work` keeps, and no ticket here takes it. Comment on LIN-1273 that its readonly-run scope is held at the proxy (with the PR), and say where the merge and Done half now sits. Do the same on LIN-1242 for #1 and #9.

10. **Piece 4 makes look-into's "post nothing to Linear unless the person asks" untrue.** A `none` token refuses every write, and the token cannot know a person asked. Dropping that allowance is a "what to retire" call, so ask John as a ruling on piece 4's PR. My recommendation is to retire it: look-into reports in its session, and a person can post the comment themselves. Then piece 5 drops the clause.

11. **Pieces 1, 2 and 4 share files.** Pieces 1 and 2 both edit `lib/recommendation-blind-read.js`. Pieces 1 and 4 both edit `lib/dispatch-entrance.js`. Pieces 1 and 3 both edit `docs/architecture/source-map.md`. The conflicts are small, but whichever piece lands second rebases.

12. **The control area is not quite untouched.** Open PR #2424 (LIN-4457) adds two `aria-label`s to `lib/render-proxy.js`, which is in the control's 14-file sample at HEAD. Record it in both area reads, and check open PRs against the control's sample again before the repeat read. Take this area's baseline and a fresh control read at one base commit, recorded in each report. The kit's fixed table is pinned to `4b5001ddf` and LIN-4447's areas.

**Next:** `implementation`. Make one subtask per piece in the plan's order, with these notes attached to pieces 3, 4 and 5.


### Comment 2026-11-13T15:55:35.944Z

## Breakdown: LIN-4448 @ 5dcf5bcda

I split the approved plan (Plan Review Verdict **Approve**, comment 72406236, rev 1) into seven subtasks, one per piece. Each subtask carries its slice of the plan plus the review's amendments: files, approach, witnesses, collisions, what it retires, the session-fit line, the plan-review line and the grounding SHAs.

**Staleness check.** `origin/main` is `5dcf5bcda`. Since the plan's `2bf788b6d` and the review's `c205190fd`, only LIN-4457 (#2424) and LIN-4454 landed. The only plan file they touch is the cost-read entry in `docs/architecture/source-map.md`. The anchors still hold: `codeRouteOf` is at `lib/openrouter.js:2108`, `requireWriteScope` is at `routes/proxy.js:609`, and there are 25 Waiting entries. The plan stands, so no re-plan was needed.

| Order | Subtask | Piece | Blocked by | Session fit (from the plan) |
|---|---|---|---|---|
| 1 | LIN-4464 | 0: baseline area read (+ control) | — | one session: a docs-only measurement, like LIN-4453's piece 0 |
| 2 | LIN-4465 | 1: one `CODE_ROUTES` list | 4464 | one session: one function plus comment pointers and a docs-pin test |
| 2 | LIN-4466 | 2: blind-read kind and heading from one leaf | 4464 | one session: imports plus a source-scan guard; renders byte-identical |
| 2 | LIN-4468 | 4: proxy write guard on the token | 4464 | one session, the long pole: mint, exchange, middleware, every mint path, the route-classification test. Start first. |
| 3 | LIN-4467 | 3: one record per stage kind | 4465, 4466 | one session: the tables become views, deleted in the same piece |
| 4 | LIN-4469 | 5: prompt folds, one re-pin | 4467, 4468 | one session: one batch, one re-pin |
| 5 | LIN-4470 | 6: Waiting entries and repeat reads | 4469 | one session: small settlements plus the closing measurement |

**Why the graph looks like this.** The baseline goes first and alone, so that nothing changes the area before it is read. 1, 2 and 4 then run in parallel: their files mostly don't overlap, and the shared ones (`recommendation-blind-read.js`, `dispatch-entrance.js`) rebase. 3 needs 1 and 2. 5 needs 3 and 4: the guard comes before the words, and both 3 and 5 touch `prompt-template-defs.js` and the budget test. 6 comes last, and 5 covers the rest transitively.

**Two things I did at breakdown:**
- **Assignee policy (engineering call):** follow `lib/stage-writes.js`, which leaves assignee out of `ticket-fields`. LIN-4467 corrects the triage template's "labels, priority, assignee", and LIN-4468 refuses `assigneeId` under `ticket-fields`. Reason: a stamp may only narrow a token, and nothing asked to widen triage's writes.
- **Seam correction posted on LIN-4447** (comment 097a3442), as review note 7 required before pieces 1, 2 and 4 start. It lists every Runs file each subtask edits. It names the collisions with LIN-4459, LIN-4460 and PR #2427 (LIN-4455; new since the review: it touches `run-view.js`, `wall-clock-summary.js` and `routes/dispatch.js`). It also says that making `COMPLETION_SIGNALS` a view changes LIN-4462's sample.

**New since the review, folded into the subtasks:**
- #2424 has merged. LIN-4464 takes both reads at a base at or after `5dcf5bcda`, so the control's `aria-label` change sits inside the baseline. It also records the open PRs against both samples.
- Two mint callers were missing from both the plan and the review: `routes/proxy-tokens-admin.js:196` (an admin grant mint) and `routes/test.js:229`. Both are listed in LIN-4468, whose source scan must classify them.

**Cuts.** No new cuts. The only narrowings are John's two ruled cuts (13 Nov: "LIN-4448 closes only the read-only limit, through the proxy's write guard"). LIN-4468 comments on LIN-1273 and LIN-1242 (#1, #9) with its PR, and names the merge, Done-capability and staleness parts as still open. It closes neither ticket.

DECISION: When LIN-4468 enforces `none`, look-into's "post nothing to Linear unless the person asks" becomes untrue, because the token can't know that a person asked. Retire that exception? **Recommendation: yes, retire it.** Look-into reports in its session, and a person can post the comment themselves. Then LIN-4469 drops the clause. If you'd rather keep it, look-into gets `one-comment` instead of `none`. LIN-4468 can be built either way, but it shouldn't merge until you answer.


### Comment 2026-11-13T15:57:43.409Z

Retire it: look-into reports in its session and a person posts the comment if they want it

— Ruling recorded via Harbour

### Comment 2026-11-13T15:58:14.076Z

### Ruling applied: look-into exception retired

John's ruling (comment bdcd3128) answers the DECISION in the breakdown summary (4b22eb22). I wrote it into the subtasks under `## Current`:
- **LIN-4468** (proxy guard): look-into stays `none`, and the merge hold is lifted.
- **LIN-4469** (prompt folds): drops look-into's "unless the person asks" clause and records the retirement in the change log.

No open rulings remain on this breakdown. The landing order is unchanged.

### Comment 2026-11-13T16:42:08.689Z

## From LIN-4458 (Runs piece 2): renewing the classifier-home ask, plus the census boundary

LIN-4447's plan asks again at the start of piece 2. Your reply on LIN-4447 (comment 08c9c898, 13 Nov 15:39Z) agreed to move 1: **one comment classifier, `commentKindOf`, in `lib/run-trail.js` (Runs)**, with no fallback. I'm building on that unless you say otherwise on LIN-4458. There will be one classifier either way.

Survey found two points the first ask didn't settle. This is the boundary I'll use; tell me on LIN-4458 if you want it drawn differently:

1. **What the census counts.** It counts kind predicates, meaning "is this comment a close-out / review / blind read / Survey / audit / agent note / ruling / person / plan-review verdict / area read". It does not count value parsers. `extractVerdict` (`lib/plan-review-round-trips.js`) and the verdict word inside `planReviewVerdictOf` stay where they are. Only the "is this a plan-review verdict" heading test moves into the table.
2. **Openings.** The audit and agent-note openings become rows in the classifier's frozen table in `lib/run-trail.js`. Today they are regexes in `lib/recommendation-facts.js`, read only by the classifier. The words the prompts write stay yours: the audit heading in `lib/prompt-template-defs.js`, and `BLIND_READ_HEADING` / `SURVEY_HEADINGS` in `lib/prompts/*-words.js`. The table imports the leaves, so it never retypes `## Blind read`, and LIN-4466's source scan stays green. If you later add a leaf for the audit heading, the table imports it.
3. **One new row: an `area-read` kind.** A `## Area read` comment never carries the landing. This settles the Runs Waiting entry from LIN-4453 that names this piece. It needs no words from your side.

Collision note: LIN-4466 edits `lib/run-ledger.js`, and this piece moves the comment openings out of it. Whichever lands second rebases.


### Comment 2026-11-13T16:42:14.992Z

## LIN-4459 (LIN-4447 piece 4): renewed ask on the live-stage wait move

Your reply 08c9c898 agreed the move. Piece 4 is now built: PR https://github.com/JKershaw/LinearViewer/pull/2432.

What it touches on your side: `lib/openrouter.js`, `lib/proxy-instructions.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-facts.js` and `lib/recommendation-look-first.js` change only their import or comment text. The code-route list in `openrouter.js` is untouched. In `docs/areas/llm-and-prompts.md` the two live-wait entries leave; the claim compare-and-set note moves to the Runs note, unchanged.

Please confirm on LIN-4459 or LIN-4447 that you still agree before the PR merges. If you want a different boundary, say so there and I will change it.


### Comment 2026-11-13T17:06:52.284Z

## LIN-4459 (LIN-4447 piece 4): addition to the renewed ask — the runner-kickoff import and one retired LLM entry

Adding two things my renewed ask (0510ffe0) did not mention. PR: https://github.com/JKershaw/LinearViewer/pull/2432

1. **`lib/prompts/runner-kickoff.js` changes its import only.** It now imports `FEEDBACK_ENTRY_KINDS` from the leaf `lib/dispatch-feedback-kinds.js`, because the PR drops the `lib/dispatch-store.js` re-export (LIN-4455 left it "for existing importers"). Kinds and their order are unchanged, and `runner-kickoff.test.js` (prompt bytes) and the LIN-4455 table test pass.
2. **`docs/areas/llm-and-prompts.md`: the entry opening "`lib/prompts/runner-kickoff.js`: imports `FEEDBACK_ENTRY_KINDS` from the store" is retired.** That entry came from LIN-4455's blind read and asked for exactly this drop on the condition that prompt bytes and kind order do not change.

Your comment 08c9c898 (on LIN-4447) agreed that "whichever of us lands second changes only the import path". Unless you say otherwise on LIN-4459 before then, I am recording that this is covered by that agreement, since the only change in your area's code is an import path and the prompt bytes are unchanged, and proceeding to merge.

### Comment 2026-11-13T20:09:06.483Z

## LIN-4466 (piece 2): placement decision, and the change

I built piece 2 on the approved plan's path. The leaf stays at `lib/prompts/blind-read-words.js`, so there is no move, and the survey's "placement ruling" is settled here.

**Decision: accept the edges, and say so in the PR.** Four Runs/Platform files now import the leaf: `run-view.js`, `pipeline-churn.js`, `run-closeout-state.js`, `workflow-config.js`. Moving the leaf would reopen the approved plan. Runs files already import it (`run-trail.js`, `run-ledger.js`, `recent-runs.js`, `plan-review-round-trips.js`), so the leaf is already a shared home. Recorded on the parent so the cost is visible.

Two coupling calls, both written into code comments:
- `waitsOn: 'blind-read'` (run-closeout-state) and the `blind-read` route name (code-routes) are the same concept as the kind, so they import `BLIND_READ_KIND`.
- `VIRTUAL_PROMPTS.BLIND_READ` is imported, not deleted: the stage-kind guard reads it as a table row.

PR: https://github.com/JKershaw/LinearViewer/pull/2441 (branch `feat/lin-4466-blind-read-one-home`). Renders are byte-identical for every template, fresh and fix round, and `COMPLETION_SIGNALS`. Retires the blind-read Waiting entry in `docs/areas/llm-and-prompts.md`.


### Comment 2026-11-13T20:32:42.089Z

Autopilot note: at 20:32Z, recommend-and-dispatch on this parent chose `review` on LIN-4448 itself (dispatch 2e8edc69) and did not descend into LIN-4466, although GET /recommend/LIN-4466 returns `close-out` (PR #2441 conditionally approved, one ledger item open). The parent has no PR, so a review here has nothing to read. Earlier hops on the same parent descended to the children correctly (LIN-4464 to LIN-4466). I let the read-only review run and sent close-out to LIN-4466 directly, with no verb override. Recorded as the raw material for the engine's descent rule.

### Comment 2026-11-13T20:34:06.118Z

## Review — LIN-4448

Reviewed at head `e666c4b60` (origin/main). The parent ticket has no PR of its own. Its work happens in seven child pieces, so this review checks the parent's state against the `## As asked` block. It does not judge a diff.

CI: not applicable to the parent (no PR). The child PRs carry their own CI: #2430 (LIN-4464) and #2433 (LIN-4465) are merged. #2441 (LIN-4466) is open, and all of its checks are green: unit, proxy +400d, E2E 1–4/4, secret scan.

**Where each piece stands**
| Piece | Ticket | State |
|---|---|---|
| 0 baseline read | LIN-4464 | Done, #2430 merged |
| 1 `CODE_ROUTES` | LIN-4465 | Done, #2433 merged (`e666c4b60`) |
| 2 blind-read leaf | LIN-4466 | In Progress. #2441 is open with green CI and was conditionally approved. It is waiting for close-out (`/recommend/LIN-4466` says `close-out`) |
| 3 stage record | LIN-4467 | Todo (waits for 2) |
| 4 proxy write guard | LIN-4468 | Todo. This is the long pole, and the breakdown said to start it first |
| 5 prompt folds, re-pin | LIN-4469 | Todo (waits for 3 and 4) |
| 6 Waiting entries + repeat reads | LIN-4470 | Todo (waits for 5) |

**The As asked block, sentence by sentence**
- *Each rule has one home; copies gone; docs say what the code does.* **In part.** The route list has been done (piece 1). The blind-read identifiers are built but not merged (piece 2). The stage-kind tables and the `public/llms.txt` catalogue are not started (piece 3).
- *A limit that matters is held in code.* **Not met.** The read-only and write-allowance guard (piece 4) is not started. Under John's ruling (15:33Z), LIN-1273 and LIN-1242 stay open until it lands. LIN-3417 and LIN-1372/1395/1408 are ruled out of scope and go to simple-dispatcher and A12.
- *Fewer rules restated as lists in prompt text.* **Not met.** Piece 5 is not started, and `FROZEN_TOTAL_BYTES` has not been lowered.
- *Waiting entries settled or say why not.* **Not met.** The live note's `## Waiting` section has 23 entries at `e666c4b60` (the plan's base had 25). Piece 6 is not started.
- *Each piece finishes one move and names what it retired.* **Met so far** for pieces 0–2. Each PR names what it retires. #2441 retires the blind-read Waiting entry.
- *Runs & dispatch side is A13's.* **Respected.** Seam edits were posted on LIN-4447. #2432 (the live-wait move) merged at 17:12Z, which answers that open question.
- *Done when: the area reads better in a blind read than the control.* **Not yet measurable.** Only the baseline exists; the repeat read is piece 6.

**Isolated, or one of a class?** At the parent level, the classes are the ones the plan bounded: route copies, identifier copies, stage-kind tables, prompt-only limits and rule lists. Each one already has a child piece. I found no unowned sibling, and no review finding needs a new class.

**Regression or staleness.** Since the breakdown's `5dcf5bcda`, main has gained only pieces 0 and 1, plus Runs-side merges (#2427, #2432). The breakdown already anticipated these (collision list on LIN-4447). The plan's anchors still need re-checking when piece 4 starts: `requireWriteScope` in `routes/proxy.js`, and the mint callers, including `routes/proxy-tokens-admin.js` and `routes/test.js`.

**Process note (not a code finding).** Dispatch chose `review` on a parent that has no diff to read, as the 20:32Z autopilot note records. The engine should descend to the actionable child instead.

### What CI Did Not Prove
- **Inside** (bounded class: prompt-only limits; LIN-1273/LIN-1242 read-only scope). The proxy write guard does not exist yet. Settle it **before the parent closes** by landing LIN-4468, with tests showing a forbidden write returns 403 on real preamble endpoints. That includes triage's description PATCH under `ticket-fields`, and a comment POST to a ticket other than the stamped one under `one-comment`.
- **Inside** (bounded class: stage-kind tables, docs drift row 154). `public/llms.txt` and `docs/architecture/prompt-system.md` still describe routes and stages independently of the code. Settle it **before the parent closes** through LIN-4467, by generating the catalogue from the record and keeping the real-context fresh and fix renders byte-identical.
- **Inside** (bounded class: rules as prompt lists). There is no net reduction in rendered bytes yet. Settle it **before the parent closes** through LIN-4469, with the re-pin showing lower `FROZEN_TOTAL_BYTES` and the reasons recorded in `scripts/prompt-template-change-log.md`.
- **Inside** (Waiting entries + the blind-read measurement in Done when). Settle it **before the parent closes** through LIN-4470. Every retained entry must name its blocker or owner. The repeat `llm-and-prompts` read must beat the `front-end-pages` control, with intervening changes to either sample accounted for.
- **Inside** (piece 2). #2441 is not merged and still has one open ledger item on LIN-4466. Settle it through the close-out already dispatched to LIN-4466.

### Verdict
Request Changes. The parent isn't ready to close: four of the seven pieces haven't started, and one is waiting for close-out. This is not a design problem. The approved plan stands, and the next action is to keep descending into the children. In order: `close-out` on LIN-4466 (already sent), then `implementation` on LIN-4468 (it can start now, independently), then LIN-4467 once #2441 merges, then LIN-4469, then LIN-4470. After that, run review on the parent again.


### Comment 2026-11-13T21:05:20.550Z

## LIN-4468 (piece 4): design correction and decisions, PR #2443

**Correction to the plan.** The allowance is one table, `lib/stage-writes.js` (`STAGE_WRITE_OPS`, `ALLOWED_OPS`), enforced at two points, as the Survey says. The route gate (`lib/stage-write-gate.js`, `requireWriteScope(op)`) refuses the operation before any read. The ticket match runs inside `guardTarget`, after the provider read, because the provider's id resolution is the only place an identifier, a UUID and a provider key meet. The match resolves the stamped ticket through the same provider and compares the two issues' ids. Linear's guard returns no identifier, and GitHub's returns a bare number, so comparing identifiers would not hold.

**The refire lane (survey open-0).** `POST /api/dispatch/broker-token` minted unrestricted tokens for restricted rows, on both its plain and its declared branch. Both now stamp from the refired row's kind and issue. A row that does not exist stays stage-less, as in LIN-3135 R2. A read fault is a 503.

**Engineering choices, recorded in the PR:**
- Default deny. A restricted token is refused every operation its allowance does not name, including the routes nobody classified yet (rulings, halt, model routing, kickoff, dispatch, periodical mint, runner writes). This answers the open question on newly surfaced routes. The team should confirm it.
- `ticket-fields` may create and edit its comments: create only.
- Runner writes carry `requireStageWrite`. Unstamped and `work` runner tokens are unchanged.
- Ticket reads are not gated. The agent-api Waiting entry is rewritten to say the stage is on the token and the read guard remains.
- Collective (`custom`), chat follow-ups (`custom`), the Settings token admin and the test routes stay stage-less, with their reasons in the PR.

Look-into keeps `writes: none`, per John's ruling (bdcd3128). The prompt wording stays until LIN-4469.

PR: https://github.com/JKershaw/LinearViewer/pull/2443


### Comment 2026-11-13T21:23:32.610Z

## LIN-4467 (piece 3): departures from the approved plan, for ruling (PR #2444)

The one-record refactor is built and verified (PR #2444): the 40 renders and every per-kind table match HEAD byte for byte, except the two changes listed under "Also changed". Four departures from the plan's wording, each with its reason:

DECISION: Rule on these before merge. Recommendation: accept 1 and 2 as built, accept 3 to 5 as built.
1. "Import-free" becomes "imports leaves only". The signal text and the contract/intent lines interpolate `as-asked.js` and `size-of-move.js`. The record imports those leaves, `stage-writes.js` and `blind-read-words.js`, and nothing from the registry, the signals or the run views (test-enforced, transitively). This is the leaf-only proposal from the Survey.
2. The route and writes pins (`PINNED`, `tests/unit/lin-4253-stage-traits.test.js`) stay hand-typed, not views. Read from the record they would check the record against itself. This is the Survey's recommendation.
3. Grounding: the record holds the list name; the note functions stay in `lib/prompt-formatters.js`, which maps the names. The Survey's latest proposal.
4. The public catalogue (`public/llms.txt`) is generated from the records and follows the registry order. Two lines move; no bullet's text changes.
5. Budget: `FROZEN_TOTAL_BYTES` rises 378915 to 396575 (+17660). The completion signals and the catalogue wording moved into a budgeted record from files outside the budget. The ceilings and the change log say why.

Also changed, outside the plan's text: triage's description says "state, project" for "assignee" (triage writes no assignee); the verb-override list names all 20 template kinds (it named 16). Both reach served text (dispatch, `/templates`, the catalog), not a rendered prompt.

BLOCKED: merge waits on the ruling on 1 and 2. Both are cuts of the "As asked" wording, and an unanswered cut is not agreed. The PR is open for review.

Retires: the per-kind tables and the hand-copied catalogue bullets (see the PR body); the Waiting entry "a stage kind is a row in ~fourteen parallel tables" is rewritten to name the tables that stay.


### Comment 2026-11-13T21:49:17.529Z

## LIN-4467 (piece 3): the BLOCKED on departures is cleared

The `BLOCKED: merge waits on the ruling on 1 and 2` line in the 21:23Z comment holds nothing. Neither departure cuts the `## As asked` block:

1. "Import-free" became "imports leaves only". The block itself has the record import `blind-read-words.js`, so "import-free" can only mean no non-leaf imports, and the transitive-import test enforces that.
2. The route/writes pins stay hand-typed. The block's witness (ii) has `lin-4253-stage-traits.test.js` shrink "to the tables that stay", so keeping `PINNED` is what was asked.

The budget raise (+17660 at review, +309 at close-out) is accepted on the engineering settlement's condition, now recorded on LIN-4469. The review's reasoning is in its comment on LIN-4467; PR https://github.com/JKershaw/LinearViewer/pull/2444.


### Comment 2026-11-13T21:57:14.981Z

DECISION: held-wake credential stamp (LIN-4468, PR #2443)

- **What happens:** the held-wake release factory (server.js, setWakeCredentialProvisionerFactory) mints the resumed parent's wake token unstamped, so it is unrestricted. A held wake that resumes a restricted parent (look-into, writes none) can therefore write outside its allowance. Before LIN-4468 it was unrestricted too, so this is not a regression. It is still a hole in the claim that the proxy refuses writes outside the allowance.
- **Why the PR does not close it:** the factory receives only {urlKey, createdBy}. Stamping needs the resumed parent id from lib/dispatch-store.js releaseHeldWake (plan.edgeDoc.sessionId), passed into the factory and then into buildWakeCredentialProvisioner's itemStamp. The LIN-4468 brief keeps lib/dispatch-store.js out of scope, so I have not made that change.
- **Recommendation:** allow the change. It is one argument at the factory call (lib/dispatch-store.js ~3506) plus one forwarding line in server.js, with a witness that a held wake to a none parent is refused a comment. It changes no wake-minting logic. The alternative is to keep the hole and list held wakes as a stated exception in the PR. I would take the first.
- **Needed before merge:** your ruling. The rest of the PR is green and ready for review.


### Comment 2026-11-13T22:03:48.087Z

Ruling applied in LIN-4468 (PR #2443, commit f5dab00f6): releaseHeldWake passes the producing build's id to the provisioner factory, and the held wake takes the resumed parent's stage. Witness: tests/unit/lin-4468-wake-stamp.test.js. This DECISION is settled.

### Comment 2026-11-13T22:39:47.874Z

Autopilot note: at 22:39Z recommend-and-dispatch on LIN-4469 (piece 5) sent `implementation` directly (dispatch b86c4a78). The ticket has only `## As asked` and `## Current`, with no size record, plan, PR or earlier run, so the look-first sequence (survey-task, survey-place, scoping) that ran on pieces 0 to 4 did not run. I did not override or abort: piece 5's plan is approved at the parent and review has caught real gaps on every earlier piece. Recorded as raw material for the look-first rule. Watch piece 5's review for an undersized or oversized move.

### Comment 2026-11-13T23:11:46.388Z

## LIN-4469 (piece 5): course changes and one deviation, PR #2447

Head `05b592742`. Scope and measurement as recorded on the PR.

- **Deviation from the plan:** `committedSearch` lives in `lib/periodicals.js`, not in the shared leaf `lib/prompts/leftover-words.js`. Every call site is a Periodical bullet, so the helper stays beside them. Stability's wording is the one spelling.
- **Scope taken on:** triage's guard-refused clauses, and the same clause in survey-task, survey-place and the blind read's read-only line (`04bb47598`, on John's ruling). Triage keeps its scope rule and "findings stay observations".
- **Re-pin:** `FROZEN_TOTAL_BYTES` 396064 (396884 on main), exactly the ceilings' sum. Real-context renders with proxy preambles fall 827520 → 825330 bytes (−2190). Exceptions: the four `work` kinds (blocked, breakdown, close-out, retrospective-audit) are byte-identical, and `seams-tangles` rises +24 from the committed-tool wording. Both are on John's replacement witness ruling `lin-4469-witness`, which gates merge.
- **Not verified:** the post-deploy 403 checks (a look-into token's comment POST, a triage token's description PATCH). Not claimed. Rollback is reverting PR #2447's merge commit.



# Area notes (as committed on main before 2026-11-13T23:26:58Z)

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
  the verdict prose ("better, the same or worse") is built there from the words. Import them; the scan
  in `tests/unit/stage-kind-tables.test.js` fails on a literal elsewhere, but a row key of a table it
  lists. Prove a move byte-identical by rendering every kind, fresh and fix round (LIN-4466).
- The code routes' order lives once, in `CODE_ROUTES` (`lib/code-routes.js`). A new route is an
  entry with its `emits`, plus the one "Code route order" line in
  `docs/architecture/prompt-system.md` and in `docs/architecture/source-map.md`;
  `tests/unit/lin-4465-code-routes.test.js` fails until all three agree. Point at the list; never
  restate the order or count the routes in prose (LIN-4465).
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
- A new stage kind is one record in `lib/prompts/stage-kinds.js`, with every field: its template, lead,
  signals, labels, grounding, contract, intent, catalogue line and verb-override entry follow from it, and
  `tests/unit/lin-4467-stage-kind-record.test.js` fails on a missing field. The public catalogue is generated
  (`node scripts/gen-llms-catalogue.mjs`). A kind in `SPINE` (`lib/run-view.js`) also moves the run page's "n of N", the
  session and task-page goldens (`UPDATE_RENDER_SESSION_GOLDEN=1`, `UPDATE_RENDER_TASK_PAGE_GOLDEN=1`) and the
  E2E count pins; read the golden diff before accepting it (LIN-4437).
- `formatCiGateCheck` (`lib/prompt-formatters.js`) renders in implementation, review and close-out:
  a rule for one stage gets its own formatter beside it. Prove the others unchanged by rendering every
  kind, fresh and fix round, at HEAD and on the branch, not by the budget test, whose ceilings are caps (LIN-4441).
- The blind-read scan in `tests/unit/stage-kind-tables.test.js` reads `git ls-files`: a new file is not
  scanned until it is committed, so a local pass before the first commit proves nothing about it (LIN-4467).

## Waiting

- `lib/recommendation-input.js`: the pinned-kind and in-app renders (`lib/dispatch-entrance.js`,
  `routes/proxy-compute.js` twice, `routes/workspace-api-prompts.js`) build context by hand: a
  new field must reach all five (LIN-4368 missed one; LIN-4393 leftovers.)
- `lib/size-of-move.js`: the built-in policy (`DECIDED_BY.policy`, err larger) may stand in
  for John's "per task breakdown of options"; its size words are unexplained. (John, LIN-4393.)
- `lib/prompts/stage-kinds.js`: `CUT` writes the closing contract's token order (`DECISION:`
  before `BLOCKED:`) into a scope line beside `ASK`. Its "cut" and the plan-review and review
  "narrowing" (`lib/completion-signals.js`) name one thing; no test links them. (John, 8 Nov.)
- `lib/prompts/stage-kinds.js`: one record per stage kind (LIN-4467). The per-kind tables that stay, each with
  its owner and reason: `JOBS` (`lib/llm-jobs.js`), pure data on purpose so its census test is not vacuous (19 of
  its 39 rows are not template kinds); the route and writes pins (`tests/unit/lin-4253-stage-traits.test.js`),
  hand-typed on purpose, the one check not read back from the record; `SPINE`, `BUCKET_OF_KIND`, `FIRST_PASS_KINDS`
  and `OFF_SPINE_KINDS` (Runs & dispatch, A13); the six non-template labels and the two orchestration step words
  (`lib/run-view.js`), which no record carries; the byte ceilings (`tests/unit/prompt-size-budget.test.js`), which
  cover the registry. `VIRTUAL_PROMPTS` (`lib/workflow-config.js`) is gone: its one reader is the record's key.
  (Survey tally, LIN-4248; piece 3, LIN-4467.)
- `lib/prompts/stage-kinds.js`: the one-record refactor's witness (`tests/fixtures/lin-4467-witness.js`) stays in the
  suite as a permanent test. It pins a sha256 for all 40 renders and for each table, so a later wording change in
  any stage must regenerate `tests/fixtures/lin-4467-witness.json` as well as move the byte ceilings and the change
  log; and its fix-round mode differs from
  fresh for `implementation` only. Decide whether to retire it once piece 5 (LIN-4469) has re-pinned, fold it into
  `tests/unit/prompt-size-budget.test.js`, or keep it as a ratchet: a decision about the test suite, not a fix.
  (LIN-4467 blind read.)
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
- `lib/periodicals.js`: `docs/areas/` is spelled in 26 lines across 11 code files (`lib/`, `routes/`,
  `public/`, `server.js`, `scripts/`), up from 17 in 10 at the 10 Nov reading, and two leaves now spell
  the directory: `REGISTRY_PATH` (`lib/prompts/area-registry-path.js`) and `NOTES_DIR`
  (`lib/prompts/area-note-format.js`, LIN-4420), neither derived from the other. Moving the notes
  means editing both leaves and the prose. (Drift & Coherence Review, 10 Nov;
  `docs/reviews/drift-coherence-review-2026-11-10.md`; count, Documentation Review; recounted, Drift &
  Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
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
  those three templates' hashes. (LIN-4424 leftovers; Survey global.) The rule it answers, whether
  a review may run a tool the repo commits, is itself worded per template: Stability's run bullet
  says "introducing no tooling beyond what the repo commits", while Recent Headwinds (which reads
  the same rework and churn trajectory) and Drift & Coherence still say "introducing no new
  tooling", Code Quality says "introduce no new tooling", and Seams & Tangles allows committed tools in its own bullets. No
  `periodicalBullet` helper owns it; deciding it is one rule re-pins every template that states
  it. (LIN-4424 blind read.)
- `lib/model-routing-harnesses.js`: a dispatch record's `model` names the routed id
  ("anthropic/claude-opus-4.8" for the `opus` route), but the claude-code harness runs a Claude id
  by its family token (`isModelRunnableOn`, `CLAUDE_MAPPABLE_MODEL_FAMILIES`), and on blind-read
  dispatches d9bdf6d8, cced07ee and 0399b2e2 it ran `claude-opus-5-5`, so a record can misname
  the model that ran. Cost is already priced from the model the worker reports. Waiting: make the
  record carry the model the worker reports, or update the routed id. (LIN-4396 review.)
- `lib/prompts/leftover-words.js`: the retirement line's words have one home and one checker
  (`lib/dispatch-leftover-answer.js`), but which entry to settle (the busiest touched area, else
  another) and the three forms are restated by hand in `docs/areas/README.md`, simple-dispatcher's
  docs/areas/README.md, `docs/proxy-integration.md` (with the refusal kinds) and
  `docs/architecture/dispatch-and-proxy.md`, and the verbatim guard reads only `lib/` and `routes/`.
  simple-dispatcher's README says a waiting entry also leaves when "a follow-up is filed for it",
  where this README says only when the consequence test sends it to a ticket. A cross-repo seam;
  simple-dispatcher's side is named here, not edited. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
- `lib/prompts/area-note-format.js`: the one reading of a waiting entry in code does not hold what a
  cited path is; that rule is in the guard (`tests/unit/area-notes.test.js`, a listed extension), in
  `lib/dispatch-leftover-answer.js` (any one to six characters, its comment calling it the guard's
  rule) and in simple-dispatcher's guard. A retirement line can name a path the guard would not read
  as one. Borderline. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
- `lib/prompts/blind-read-words.js`: the blind read's kind has a constant and a scan, but every other kind in
  the same lists is still a literal (`SPINE` in `lib/run-view.js`, the `COMMENT_KINDS` rows in
  `lib/run-trail.js`, `CODE_ROUTES` in `lib/code-routes.js`), so the next stage added has two conventions to
  choose from. Decide whether every kind gets a constant or only this one. LIN-4467 made one record per stage
  kind (`lib/prompts/stage-kinds.js`) but keys it by literals, so the question stands; the record is where a
  constant per kind would live. (LIN-4466 blind read; LIN-4467 leftovers.)


# Facts computed from the task records at this moment

(open items with who must act, judgements and decisions with whether they still rest on the current version, areas and their open counts, and an index of other open records)

## 3. Addressed to it
check-148 check [open] v1 by autopilot to review in task-131
  what: Watch piece 5 (PR #2447) for an undersized or oversized move: it went to implementation without survey-task, survey-place or scoping, unlike pieces 0 to 4.
  how: In review, compare what PR #2447 changed against plan-117 piece 5 and the task done-when; say whether the move was too small or too large for one piece.
  about → change-142, task-131
finding-153 finding [open] v2 by review to close-out in task-131
  says: Fix 5 remainder: on merge, revise lesson-10 "import-free leaf" to "a leaf that imports only leaves (`area-registry-path.js`)". The import move is done at 05b592742 (it is at the top of `lib/prompts/leftover-words.js`) and the docs Lesson in `docs/areas/llm-and-prompts.md` is already updated; only the store lesson goes stale.
  about → change-142, lesson-10
finding-166 finding [open] v1 by review to close-out in task-131
  says: Fix 1, before the merge: in `lib/periodicals.js` `generateSeamsTanglesPrompt`, first runReview bullet, drop the hand-typed `(no path is written here)` so it reads "Find both by searching the repo for them, read how the tool is run" (main's words). It folds nothing (it is not rendered through `committedSearch`, and main never had it) and is why seams-tangles and its autopilot form rise +24 (+26 parenthesis, +28 `committedSearch`, -30 `NOTES_PR`). Without it seams-tangles falls -2 and the total is 827520 -> 825278 (-2242). Then: re-pin both seams-tangles hashes in `tests/unit/lin-4313-periodical-prompt-bytes.test.js:94`; update the LIN-4469 change-log row (`scripts/prompt-template-change-log.md:635`) to the new figures, drop the "Up" clause, and make the ruling sentence "four `work` kinds unchanged; `lin-4469-witness` withdrawn as moot"; update the PR body's Measured and DECISION sections. `periodicals.js` is in no budgeted source ceiling, so FROZEN_TOTAL_BYTES is unaffected.
  about → change-142, question-159
finding-167 finding [open] v1 by review to close-out in task-131
  says: Fix 2: in `tests/unit/prompt-size-budget.test.js:146`, delete the stray fragment "(396821 -> 396571), the rest was unused headroom. " from the FROZEN_TOTAL_BYTES comment. It follows "...(396821 -> 396559), the rest was unused headroom." and matches no figure.
  about → change-142
check-168 check [open] v1 by review to close-out in task-131
  what: Before the merge, after Fix 1 (finding-166): re-run a base-vs-head real-context render (base b937237a4): every stage kind in fresh and fix mode, each with its own writes preamble, and all 13 Periodicals in plain and autopilot form.
  how: Right: every render that carries folded text falls, seams-tangles shows -2, and the total is 827520 -> 825278 (-2242). Wrong: any non-work stage kind or Periodical that carries folded text at >= 0. The four work kinds and Stability, Recent Headwinds and Integration Surface Maturity stay equal: they carry no folded text.
  about → change-142, finding-166
finding-173 finding [open] v1 by blind-read to close-out in task-131
  says: `tests/unit/lin-4469-prompt-folds.test.js`: the describe says the folded spellings "appear in no rendered prompt", but each test asserts `where.length <= 1`, so a retired phrase left in one template or Periodical still passes. None renders anywhere at 877f32cb4. Fix: assert `where.length === 0` and drop "at most one" from the test name. (LIN-4469 blind read.)
  about → change-142, area-1
finding-174 finding [open] v1 by blind-read to close-out in task-131
  says: `lib/periodicals.js`: `committedSearch` closes its own parenthesis, and Stability's bullet strips it again with `capitalised(committedSearch(...)).slice(0, -1)` to add its own "; look beside ...)". One caller undoes the helper's output shape, so changing the helper's wording silently breaks Stability. Fix: give `committedSearch` an optional tail for the parenthetical (e.g. `(what, more = '')` -> `(no path is written here${more})`) and drop the slice. (LIN-4469 blind read.)
  about → change-142, finding-40
finding-175 finding [open] v1 by blind-read to close-out in task-131
  says: `tests/unit/lin-4313-periodical-prompt-bytes.test.js`: its LIN-4469 header says both Seams & Tangles bullets are built by `committedSearch`, but the first `runReview` bullet (`lib/periodicals.js` ~l.991) hand-types "searching the repo for them (no path is written here)". finding-166 drops the parenthetical but does not route the bullet through the helper, so the header stays wrong after it. Fix with finding-166: correct the header comment (or route that bullet through the helper and re-pin its hash). (LIN-4469 blind read.)
  about → change-142, finding-166
finding-176 finding [open] v1 by blind-read to close-out in task-131
  says: `docs/architecture/source-map.md` (unmapped; concerns `lib/prompts/leftover-words.js`): it still calls `leftover-words.js` "A leaf that imports nothing" and lists neither `areaLookup` nor `NOTES_PR`. At 877f32cb4 the file imports `area-registry-path.js` and exports both. Fix: update that one line, alongside finding-153's lesson-10 revision. (LIN-4469 blind read.)
  about → change-142, finding-153, lesson-10

## 4. What stands about this task
decision-109 decision [stands] v2 by scoping in task-108
  scope: task-108
  answer: **Size:** rebuild the area
  why: **Why:** Rebuilds the area around one definition per stage kind, from which routes, write limits, labels and docs derive, and has the proxy refuse writes a stage may not make; otherwise copies return and read-only stays words.
**Cuts:**

* "the safety tickets named above are closed in code": the merge limit (LIN-3417) stays with simple-dispatcher.
* "the safety tickets named above are closed in code": the token tickets (LIN-1372, LIN-1395, LIN-1408) stay with the harness.
  **Decided by:** a ruling
decision-111 decision [stands] v1 by John via Harbour in task-108
  scope: task-108
  answer: Agree both cuts: they wait for A12 and simple-dispatcher; LIN-4448 closes only the read-only limit, through the proxy's write guard
  why: Ruling lin4448-safety-cuts, recorded via Harbour.
  answers → question-110
verdict-124 verdict [stands] v1 by plan-review in task-108
  of: plan-review
  outcome: approve
  reasoning: Approve (comment 72406236). The causes it names are the real causes, the proxy guard reaches every dispatched agent's writes, and each gap below can be fixed without changing what the plan decides.

1. **Piece 5: keep the git-side limits in words.** The proxy guard holds tracker writes only. "Do not change code, branches, pull requests" in `ONE_COMMENT_MANDATE`, `BLIND_COMMENT_MANDATE`, `NONE_MANDATE` and `TICKET_FIELDS_MANDATE` has no code backstop: the runner's GitHub credential is outside the proxy, and that half sits with simple-dispatcher like merge. Shrink only the tracker clauses the token now refuses. Keep the code, branch and PR prohibitions, as you keep the merge sentences, and name them in the change log entry as kept, with the reason.

10. **Piece 4 makes look-into's "post nothing to Linear unless the person asks" untrue.** A `none` token refuses every write, and the token cannot know a person asked. Dropping that allowance is a "what to retire" call, so ask John as a ruling on piece 4's PR. My recommendation is to retire it: look-into reports in its session, and a person can post the comment themselves. Then piece 5 drops the clause.
  on → plan-117@1
decision-132 decision [stands] v1 by breakdown in task-131
  answer: Grounding commit origin/main `5dcf5bcda`; the plan stands, so no re-plan was needed.
  why: `origin/main` is `5dcf5bcda`. Since the plan's `2bf788b6d` and the review's `c205190fd`, only LIN-4457 (#2424) and LIN-4454 landed. The only plan file they touch is the cost-read entry in `docs/architecture/source-map.md`. The anchors still hold: `codeRouteOf` is at `lib/openrouter.js:2108`, `requireWriteScope` is at `routes/proxy.js:609`, and there are 25 Waiting entries. The plan stands, so no re-plan was needed.
  on → verdict-124@1
decision-133 decision [stands] v1 by breakdown in task-131
  answer: Session fit: fits one session. Plan-review due: no — covered by LIN-4448's approving plan-review (comment 72406236-9316-4004-98ee-70d8fba0cb09, rev 1)
  why: | 4 | LIN-4469 | 5: prompt folds, one re-pin | 4467, 4468 | one session: one batch, one re-pin |
  on → verdict-124@1
decision-134 decision [stands] v1 by breakdown in task-131
  answer: LIN-4469 is blocked by LIN-4467 (piece 3) and LIN-4468 (piece 4).
  why: The baseline goes first and alone, so that nothing changes the area before it is read. 1, 2 and 4 then run in parallel: their files mostly don't overlap, and the shared ones (`recommendation-blind-read.js`, `dispatch-entrance.js`) rebase. 3 needs 1 and 2. 5 needs 3 and 4: the guard comes before the words, and both 3 and 5 touch `prompt-template-defs.js` and the budget test. 6 comes last, and 5 covers the rest transitively.
  on → verdict-124@1
  about → task-129, task-130
decision-135 decision [stands] v1 by breakdown in task-131
  answer: LIN-4469 blocks LIN-4470 (piece 6).
  why: The baseline goes first and alone, so that nothing changes the area before it is read. 1, 2 and 4 then run in parallel: their files mostly don't overlap, and the shared ones (`recommendation-blind-read.js`, `dispatch-entrance.js`) rebase. 3 needs 1 and 2. 5 needs 3 and 4: the guard comes before the words, and both 3 and 5 touch `prompt-template-defs.js` and the budget test. 6 comes last, and 5 covers the rest transitively.
  on → verdict-124@1
decision-137 decision [stands] v1 by John via Harbour in task-108
  scope: task-108
  answer: Retire it: look-into reports in its session and a person posts the comment if they want it
  why: Ruling lin4448-lookinto-none, recorded via Harbour.
  answers → question-136
decision-138 decision [stands] v1 by breakdown in task-131
  answer: **Ruling answered (John, 13 Nov, LIN-4448 comment bdcd3128):** retire look-into's "post nothing to Linear unless the person asks" exception.
  why: This piece **drops that clause** from look-into's prompt; the `one-comment` rewording option in the section above no longer applies. Record the retirement, citing the ruling, in `scripts/prompt-template-change-log.md` and in the PR's retirement line.
  on → decision-137@1
decision-140 decision [stands] v1 by autopilot in task-131
  answer: ## Condition on LIN-4467's budget raise, for piece 5

It was accepted on one condition that falls on this piece: **LIN-4469 must show a net rendered-byte reduction and lower `FROZEN_TOTAL_BYTES` below 396575** (the figure the settlement named), with the reduction measured on rendered prompts, not on source moved out of measured files. John on the limit: "That limit is to push against lists of rules. Worth knowing, but not hard and fast."
  why: LIN-4467 (PR https://github.com/JKershaw/LinearViewer/pull/2444) raises `FROZEN_TOTAL_BYTES` in `tests/unit/prompt-size-budget.test.js` from 378915 to 396884 (396575 at review, plus a net +309 at close-out for deriving the reading-pass lines). It is re-accounting, not growth: the text moved into the newly budgeted `lib/prompts/stage-kinds.js` from files the total did not cover, and all 80 rendered prompts are byte-identical.

Named monitor: `tests/unit/prompt-size-budget.test.js` fails on any growth past the ceiling. Only this piece landing can show the reduction.

The record's source ceiling (`lib/prompts/stage-kinds.js`, 43348) is part of what to lower if wording moves out of it. `lib/prompt-template-defs.js` and the budget test are shared with this piece; LIN-4467 lands first.

decision-157 decision [stands] v1 by John via Harbour in task-131
  scope: task-131
  answer: fold: shrink the clauses at ~268/975/994/1065 to the code, branch and PR words too; back to implementation, re-pin ceilings and a lower FROZEN_TOTAL_BYTES
  why: Ruling lin-4469-cuts, recorded via Harbour. Comment on LIN-4469 (62f57ef4): "Fold the guarded clause in survey-task, survey-place and blind-read templates too." The comment names three templates; the option chosen also covers triage ~268.
  answers → question-144
  on → question-144@2
  about → change-142, finding-143
decision-160 decision [stands] v1 by autopilot in task-131
  answer: Next build step on PR #2447: (a) the fold decision-157 rules: shrink the tracker-write clauses in `lib/prompt-template-defs.js` ~975 (survey-task), ~994 (survey-place), ~1065 (blind-read) and ~268 (triage: its scope rule stays, its write clauses go) to the code, branch and PR words, which stay because nothing backs them in code; re-pin the ceilings and `FROZEN_TOTAL_BYTES` once more, lower (finding-143); (b) review's Fixes 1 to 5 (finding-149 to finding-153); (c) a `### Leftovers` answer with a `Retires:` line naming an entry the diff removes (finding-154); (d) the corrected figure (4 work kinds identical, not 11) in the PR's decision text, the change-log row and the LIN-4350 comment (finding-150). Merge waits on question-159 only.
  why: Same idiom as the class this ticket bounds (tracker-write prose the guard now refuses); under John's standing rule (LIN-2825, amended by LIN-3006) an item of the same class is inside whether or not the plan listed it. The ask's "shrink only" is read as: touch only what the guard backs. Builder and reviewer both recommend it, and John ruled fold. Posted on LIN-4469 (comment fab0cf08).
  on → decision-157@1
  about → change-142, finding-143, finding-149, finding-150, finding-151, finding-152, finding-153, finding-154, question-159
decision-163 decision [stands] v1 by leftover in task-131
  scope: task-131
  answer: Keep the one-record refactor witness (`tests/fixtures/lin-4467-witness.js`) in the suite as a ratchet; do not retire it or fold it into the budget test.
  why: It is the identity pin on real-context renders, which the budget test caps over a context-free fixture are not (lesson-6). A test-suite decision, not John's call. Recorded as a Lesson in docs/areas/llm-and-prompts.md and its Waiting entry removed; named in the Retires: line of the ### Leftovers comment on LIN-4469 (a2efc9a8).
  about → finding-26, change-142
verdict-169 verdict [stands] v1 by review in task-131
  of: review
  outcome: approve-with-notes
  reasoning: Approve, conditional on close-out discharging the ledger (re-review of PR #2447 at 05b592742, comment 042f607d). CI green; 13 local prompt suites, 1493 pass. Independent render, base vs head: 827520 -> 825330 (-2190) reproduced; 56 of 72 renders fall. Every As asked sentence is met: the four mandates shrink to the token (`lib/proxy-preamble.js:185-197`) and the fold covers triage, survey-task, survey-place and blind-read, with the dropped triage allowance held by `lib/stage-writes.js:73,82`; code, branch, PR and merge words kept and named in the change log; look-into exception retired (bdcd3128); NOTES_PR, areaLookup, committedSearch (in periodicals.js, recorded on LIN-4448 8933968d), RETIRES_LABEL/RETIRES_NONE pointers in docs; CUT/narrowing folded to cut; FROZEN_TOTAL_BYTES 396884 -> 396064, below decision-140s 396575 (re-pin in three steps on one PR, not treated as a cut; router snapshots and meta-prompt baseline unchanged since no stage lead changed); new test red on four mutations; LIN-4350 report corrected (25b09538); Retires: line names a removed entry. The one miss: seams-tangles +24 meets the witness under no reading (finding-166, check-168). Fix 2 (finding-167) is a stray comment. Stale comment ec59bd26 is superseded by later ones. The class (guarded tracker-write prose) is fully handled. After deploy, check-155 stays with John.
  on → change-142@2, plan-117@1, decision-157@1, decision-140@1
  about → task-131, finding-166, finding-167, check-168, check-155
  STALE: on change-142@2, now @3
verdict-172 verdict [stands] v1 by blind-read in task-131
  of: blind-read
  outcome: better
  reasoning: Blind read (LIN-4469 comment d96c0849) of PR #2444 at a9b216d88 against b8e2a0aad and PR #2447 at 877f32cb4 against b937237a4. Better: #2444 replaces about eight parallel per-kind tables (template traits, STAGE_LEADS, COMPLETION_SIGNALS, STAGE_INTENT, GROUNDING_BY_KIND, STAGE_LABELS, the contract lines, the llms.txt catalogue, the override verb list) with one record per kind in lib/prompts/stage-kinds.js, deletes VIRTUAL_PROMPTS (lib/workflow-config.js) and moves the review-bound reasons next to the bound (lib/recommendation-facts.js); #2447 replaces hand-typed copies of three clauses with NOTES_PR, areaLookup and committedSearch. Worse: a sha256 render/table witness every later wording change must regenerate (tests/fixtures/lin-4467-witness.json), a fold one caller undoes with .slice(0, -1) (lib/periodicals.js), and a retired-phrase test that still lets a phrase stay in one prompt (tests/unit/lin-4469-prompt-folds.test.js). Outside the area: none.
  on → change-142@3
  about → area-1, task-108

## 5. Its areas
area-1 LLM & prompts: 24 open addressed to it
area-65 Runs & dispatch: 24 open addressed to it

## 6. Open runs sharing its paths
(none)

## 7. Index of what else is known
lesson-2 lesson → -: Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`): text grows only with its ticket and reason beside the ceiling and `FROZEN_TOTAL_BYTES`; old reasons go to "Ceiling history" in `scripts/prompt-template-change-log.md`.
lesson-6 lesson → -: `lib/prompt-template-defs.js` and the budget test change in almost every merge: rebase, then re-measure. Its fixture passes no context (the empty-context branch), so dropping one can raise a ceiling while real renders shrink (LIN-4393).
lesson-10 lesson → -: `lib/prompt-template-defs.js` cannot import what imports `lib/prompt-templates.js` (a cycle): shared words live in an import-free leaf, as `lib/prompts/leftover-words.js` (LIN-4376) and `lib/prompts/autopilot-precedence.js` (never restate a rank; LIN-4382).
lesson-12 lesson → -: A stage lead's first sentence is the selector's purpose line: changing it means new router snapshots, `scripts/eval/meta-prompt.baseline.txt` and routing ceiling (LIN-4369).
lesson-53 lesson → -: A token minted for a stage carries its `writes` and ticket, or has a reason not to. Pass both into the mint helpers (`lib/proxy-preamble.js`), or read them from the row (`lib/item-stage-stamp.js`). A wake, immediate or held, takes the stamp of the session it resumes, the parent, not the row that reported (`stampForWakeParent`; a held release gets the producing build's id from the store). A mint with neither is unrestricted, which is right only for a person's or a `custom` mint, listed with its reason in `tests/unit/dispatch-entrance-mint-sweep.test.js`. The refire broker minted unrestricted tokens for read-only rows because its mint was a bare `createToken`, which no helper-name search finds (LIN-4468).
change-142 change → -: https://github.com/JKershaw/LinearViewer/pull/2447
finding-147 finding → area-1: Look-first did not run on LIN-4469 (piece 5 of LIN-4448): at 22:39Z recommend-and-dispatch sent `implementation` directly (dispatch b86c4a78). The ticket held only `## As asked` and `## Current`, with no size record, plan, PR or earlier run; on pieces 0 to 4 the look-first sequence (survey-task, survey-place, scoping; `lib/recommendation-look-first.js`) did run. Raw material for the look-first rule: a child piece whose plan is approved at the parent skipped the look, where its siblings did not. Not overridden: the plan is approved and review has caught real gaps on every earlier piece.
check-155 check → John: After deploy, confirm restricted dispatches carry a stamped token so the shrunk mandates are backed: a look-into token comment POST gets 403 from the stage gate; a triage token description PATCH gets 403.

