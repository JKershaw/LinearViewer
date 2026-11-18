# What this stage really wrote

Description: unchanged.

## Comment on LIN-4469 at 23:21:48 (id 042f607d)

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
