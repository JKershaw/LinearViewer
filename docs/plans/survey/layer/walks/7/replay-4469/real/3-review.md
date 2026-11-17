# What this stage really wrote

Description: unchanged. The comment landed at 23:03:57, 43 seconds after John's answer (step 4), which it does not mention: it treats `lin-4469-cuts` as open.

## Comment on LIN-4469 at 23:03:57 (id 39207a24)

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
