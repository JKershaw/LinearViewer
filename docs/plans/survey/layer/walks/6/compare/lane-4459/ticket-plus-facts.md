# Ticket Runs & dispatch: live-stage wait moves to lib/run-live-wait.js, reads the lineage's terminal (piece 4)

(as Harbour captured it at the start of this stage)

## Description

## As asked

**Parent:** LIN-4447 (Runs & dispatch, left simpler). The parent's scope is its `## As asked` block. Its approved design and plan are the `## Design` and `## Implementation Plan` sections of the parent description, and the Design comment (6efb91fa) holds the full analysis. **Start from the parent's approved plan and follow it. Where the code shows it is wrong, change course and say so in a comment on LIN-4447.**
**Repository:** JKershaw/LinearViewer. **Grounding commit:** `origin/main` 4b5001ddf. On 2026-11-13 at 14:00Z it was still HEAD, with nothing landed since the ticket was filed.

## Piece 4 (medium): the live-stage wait gets a Runs home

**Before starting:** ask LIN-4448 (A14) again to agree the move.

**Approach:**

* Create `lib/run-live-wait.js` holding `liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT_CODE`, `newestLiveRun` and the live predicate `isLiveRun`.
* **Delete** `lib/recommendation-live-wait.js`, with no re-export or shim. Update its importers: `lib/openrouter.js`, `lib/dispatch-entrance.js`, `routes/workspace-api.js`, `lib/proxy-instructions.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-look-first.js` and `lib/recommendation-facts.js`.
* **Behaviour change in the same move:** a stage parked `[pending]` whose lineage ends `[blocked]` or `[skipped]` is not live. Today `runFact(r, aborted)` (`lib/recent-runs.js:66`) reads only its own row, so the wait holds until the stage is aborted.
* `loadRecentRuns`/`stageRuns` drop wake, abort, custom and autopilot rows, and they window history at `HISTORY_ROWS` before `runFact` sees anything. So resolve the terminal from the **unfiltered** lineage, before filtering and truncation, using the existing `resolveFollowUpRoot` (`lib/dispatch-store.js`) and `heldWakeHolderOf` (`lib/dispatch-leftover-hook.js`). Its callers (`recentRuns`, `loadRecentRuns`) hand the rows over.
* Move the claim compare-and-set note unchanged from the LLM area note to the Runs note.

**Retires:** the old module and `runFact`'s row-only read. **Settles Waiting:** 14, and the LLM-side entry on `recommendation-live-wait.js`, together with A14.

**Testing / witness:**

* Extend `lin-4392-live-stage-wait.test.js` with a `[pending]` stage whose terminal `[blocked]`/`[skipped]` sits on a follow-up or held-wake row that the filter drops. It must fail before the change and pass after it.
* A census: none of the four names is spelled outside `lib/run-live-wait.js`.
* `area-map-placement` stays green. The `run-` prefix already maps the new file to Runs.

Session fit: fits one session
Plan-review due: no — covered by LIN-4447's approving plan-review (comment 12619798-1986-467f-b67c-8bed766a7813, rev 2)

**Binding for every piece (from the parent's Constraints):** compute readiness from the trail on read and never store it. Add no GitHub or provider reads. In the same change, remove the Waiting entries this piece settles and any stale Lesson clause in `docs/areas/runs-and-dispatch.md`, and keep Lessons under 6,144 bytes. Say in the PR what this piece retires. Never recompute stored pre-cutover history, and never edit recorded prompt changelog text. The LLM & prompts side of the seam belongs to LIN-4448 (A14).

*End of what was asked. Steps write below this line; nothing above it changes.*

## Size of the move

**Size:** just the task
**Why:** Moves the live-stage wait to its runs home and has a stage read its outcome from its whole lineage, so a parked stage whose follow-up blocked or skipped stops holding the ticket; no survey finding binds a larger move.
**Cuts:** none
**Decided by:** the standing policy

## Comments

### Comment 2026-11-13T16:25:47.704Z

## Survey open-0: LIN-4459 @ 0092d8d9e

**The ground has moved.** The ticket says 4b5001ddf is still HEAD. origin/main is now 0092d8d9e, 20 commits and 118 files later. "Waiting 14" by position is now a close-out entry. The entry this piece settles is the `runFact` one at `docs/areas/runs-and-dispatch.md:89`, so find it by its text. Lessons is 5,195 bytes.

**The hard part is the mechanism, not the move.**
- `resolveFollowUpRoot` and `heldWakeHolderOf` are **async store methods** in `lib/dispatch-store.js` (3230, 3437) that do their own history reads. `heldWakeHolderOf` is not in `dispatch-leftover-hook.js`, which only calls it.
- `stageRuns`/`recentRuns` are pure and synchronous, and the tests feed them hand-built rows, so "callers hand the rows over" can't reach either helper.
- Both helpers walk **up**, from a follow-up to its root. A parked stage needs the terminal of its **descendants**.
- Calling them per row would add store reads to `codeRouteOf`, which every recommendation surface goes through.

**The store already answers this.** `deriveLineageFields`/`mergeLineageFeedback` merge a lineage's feedback by `rootItemId`. `listHistory`'s `withLineage` option returns each row's wire `outcome` through `wireStatusOf` (`dispatch-store.js:~2120`). `blocked` already maps to `WAITING_ON_A_PERSON`, which isn't live. So the fix may be that `runFact` prefers the lineage outcome. The deeper problem: `recent-runs` works out its own outcome per row beside the store's one wire word (LIN-2122). Two readers of one fact is what LIN-4447 exists to remove. Open question: does a held-wake holder share the stage's `rootItemId`? If not, that is the one case that really needs `heldWakeHolderOf`.

**"Pending" means two things.** In `runFact`, `r.status === 'pending'` is a **queue** row, which has no lineage. The ticket's `[pending]` is a park marker on a **taken** row (`derivePendingPark`). The witness must be a taken row with `[pending]` feedback, or it can pass for the wrong reason.

**Smaller traps:**
- Moving `isLiveRun` creates an import cycle: `formatRecentRuns` uses it, and `QUEUED`/`RUNNING` live in `recent-runs.js`.
- The importer list is wrong:
  - `recommendation-blind-read.js` imports `isLiveRun` from `recent-runs`, not the old module.
  - `recommendation-facts.js` and `recommendation-look-first.js` only name it in comments.
  - Three unlisted test files import the old path (lin-4370, lin-4392, lin-4437), and lin-4392:432 checks the import line with a regex.
- The census says "four names" but lists five, and importers must spell them, so it probably means the module path. Even then, `scripts/prompt-template-change-log.md:188` names the old path and is recorded changelog text you may not edit. Limit the census to `lib/`, `routes/`, `tests/` and `docs/areas/`.
- `docs/areas/llm-and-prompts.md:84-86` holds both the compare-and-set note and the LLM-side entry.

**What I'd do first** (after asking LIN-4448 again): write the failing witness from rows the store really writes. That is a taken stage parked `[pending]`, a ci-wake `custom` continuation and a held-wake holder, with real `rootItemId`/`followUpTo`/`heldWakeFor`. Then check whether `deriveLineageFields` already returns `skipped`/`blocked` for that stage. If it does, comment on LIN-4447 to change course to the lineage read. Do the mechanical move after that.


### Comment 2026-11-13T16:29:16.466Z

## Survey global: LIN-4459 @ 0092d8d9e

Read at `0092d8d9e`. That is 20 commits past the grounding `4b5001ddf`. None of them touch `lib/recent-runs.js` or `lib/recommendation-live-wait.js`. Both area notes did change: the `runFact` Waiting entry is now the 9th bullet, not the 14th, so settle it by its text, not its number.

**Where it lands.** `lib/recommendation-live-wait.js` is small, at 80 lines, and its docblock is good. Its only import is `isLiveRun` from `lib/recent-runs.js`, a 141-line pure module. The move itself is clean. The behaviour change is where the risk sits.

**The obvious way gives lineage a third reading.** The ticket says to resolve the terminal with `resolveFollowUpRoot` and `heldWakeHolderOf`. Both are async store methods that walk one row at a time. `heldWakeHolderOf` lives on `DispatchStore` (`lib/dispatch-store.js:3437`); the leftover hook only calls it. `recentRuns(rows)` is synchronous, and nothing in production calls it. Wiring those walks into `loadRecentRuns` adds N+1 reads and a new definition of "what ended". The codebase already has a lineage definition, in two places:

- `deriveLineageFields` (`lib/dispatch-lineage-status.js:91`) calls itself "the one derivation of lineage status". It merges sibling feedback by `rootItemId`. The Dispatch page, the proxy list (`wireStatusOf`) and the duplicate guard (`lineageEndedIds`, `dispatch-store.js:405`) all read it. `_readHistory` already offers `withLineage`, which gives each row its lineage `outcome` in one batched `_lineageOf` read.
- `lib/lineage-closure.js` stamps `closed`, which `runFact` already treats as not live. It does this when the lineage ends `done`, `failed` or `aborted`. `isLineageClosingTerminal` leaves out `skipped`, and `[blocked]` is a pause. That is why exactly those two outcomes hold the wait.

Asking `listHistory` for `withLineage: true` would let `runFact` read the lineage outcome instead of the row's own. The wait, the duplicate guard and the Dispatch page would then agree on one word, with no new walk. Lineage `blocked` maps to `waiting on a person`, exactly as the row's own `blocked` does today. Check first that a ci-wake `custom` continuation carries the holder's `rootItemId`; the factory's inheritance suggests it does. The new failing test should pin that case before relying on it. If the plan's walk is kept anyway, say on LIN-4447 why the shared derivation could not serve.

**Things the move must update, and what notices if it doesn't:**
- `isLiveRun` is also used by `formatRecentRuns` (`recent-runs.js:139`) and by `recommendation-blind-read.js:47`, which imports it from `recent-runs.js`, not from the old module. If the predicate moves, `recent-runs.js` imports `run-live-wait.js` while `run-live-wait.js` imports `QUEUED`/`RUNNING` from `recent-runs.js`: an import cycle. Either `QUEUED`/`RUNNING` move with it, or `isLiveRun` stays.
- Two of the listed importers, `recommendation-facts.js` and `recommendation-look-first.js`, only mention the old module in comments. Three tests import it: `lin-4392`, `lin-4370` and `lin-4437`. `lin-4392:432` pins the literal import string in `proxy-instructions.js`. Tests and the import fail loudly. Prose fails silently: `docs/architecture/source-map.md:225`, `prompt-system.md`, `agent-api.md:52`, `llm-and-prompts.md:84-86,154`, and the docblocks in `openrouter.js:2066` and `dispatch-entrance.js:1726`. Leave `scripts/prompt-template-change-log.md` as it is, because recorded changelog text is never edited.
- The census as written can't pass. Importers have to spell the names they import, and the ticket lists five names, not four. A useful census instead checks that each name is *defined* only in `run-live-wait.js` and that `recommendation-live-wait` appears nowhere in code or tests.

**Better, and within this task's reach:** read lineage through `deriveLineageFields` and retire `runFact`'s row-only read for good. **Better still, not this task's:** `isLiveRun` (run facts) and `liveOnAnchor` (`lib/live-anchor.js`, enriched loops) are two "live" predicates. So are the wait's read and the duplicate guard's 5-minute check. Settling both pairs into one rule is the claim compare-and-set already noted in Waiting. That work belongs to Runs, later.


### Comment 2026-11-13T16:42:15.485Z

## Summary: LIN-4459 implemented, PR open

PR: https://github.com/JKershaw/LinearViewer/pull/2432 (commit e9a3cb324, branch `feat/lin-4459-run-live-wait`)

- The live-stage wait moves to `lib/run-live-wait.js`. `lib/recommendation-live-wait.js` is deleted, with no shim.
- A stage parked `[pending]` now takes its lineage's end: `blocked`, `skipped` or a terminal word. Witnesses W1 and W2 failed before the change (`running`) and pass after it.
- The departure from the plan (the store's lineage read, not the helper walks) is recorded on LIN-4447.
- Area notes updated: the `runFact` Waiting entry is settled; the LLM-side live-wait entries leave.
- Tests: the three live-wait files (126 tests) and 65 related files (2073 tests) pass locally. CI is the full proof, and its results are on the PR.


### Comment 2026-11-13T16:48:10.976Z

## LIN-4459: CI green on PR #2432

CI run 43465308840 on commit e9a3cb324: Unit tests, Unit tests (proxy, clock +400d), E2E shards 1 to 4, Secret scan and CI success all pass. The PR is open and mergeable; the merge is for review and the orchestrator, not this run.

### Comment 2026-11-13T16:57:24.177Z

### Leftovers
- `lib/recent-runs.js`: `PARKED_LINEAGE_ENDS` restated the terminal words beside `LINEAGE_TERMINAL_STATUSES` (`lib/dispatch-lineage-status.js`); it is now built from that set plus `blocked`. Tidied.
- `lib/recent-runs.js`: `stageRuns`' docblock did not name the parked case. Tidied.
- `lib/dispatch-store.js`: the `withLineage` comments said only the Dispatch page's history asks for it, but `loadRecentRuns` does too now. Tidied.
- `tests/unit/lin-4392-live-stage-wait.test.js`: the new witnesses reused the file's W1/W2 names, and the header did not list them. Tidied.
- `docs/areas/runs-and-dispatch.md` Lessons: the lineage lesson now says that over a ticket's runs you read it batched (`withLineage`), never with a walk per row. Noted in the Runs note.

Retires: `docs/areas/llm-and-prompts.md`, the entry opening "`lib/prompts/runner-kickoff.js`: imports `FEEDBACK_ENTRY_KINDS` from the store". The runner prompt now imports from the leaf `lib/dispatch-feedback-kinds.js`, the store drops its re-export, and tests import from the leaf. The kinds and their order are unchanged.

PR: https://github.com/JKershaw/LinearViewer/pull/2432, head `7424cfb8fa42f28b303138c76f20cbb6cb74b5f2`. CI is green on that head: Unit tests, Unit tests (proxy), E2E shards 1–4, Secret scan and CI success all pass.


### Comment 2026-11-13T16:58:13.452Z

Autopilot cross-check of the implementation step (PR #2432, head 7424cfb): PR open and mergeable; all 8 CI checks passed (Unit, Unit proxy clock +400d, E2E 1-4, Secret scan, CI success). Witnesses W1/W2 in lin-4392 are reported failing before and passing after.

For review to judge, not decided here: the PR also removes the `FEEDBACK_ENTRY_KINDS` re-export from `lib/dispatch-store.js` (LIN-4455 left it "for existing importers"), repoints 8 imports, and changes an existing assertion in `tests/unit/lin-4455-feedback-kinds-table.test.js` from "the store re-exports it" to "the store does not". The PR body does not name this as something the piece retires, and it is outside the ticket's Approach list. Is it inside the bounded class (a shim of the same idiom) or a change an existing test should not absorb silently? Also still to confirm: Lessons under 6,144 bytes, and rebase onto main if LIN-4458 merges first.

### Comment 2026-11-13T17:01:55.610Z

## Review — LIN-4459

Reviewed PR https://github.com/JKershaw/LinearViewer/pull/2432 at head `7424cfb8fa42f28b303138c76f20cbb6cb74b5f2` (base `0092d8d9e`, which is 5 docs-only commits behind `origin/main` `2aab32bf0`; mergeable).

CI: green on head 7424cfb8f, run 43466823788. All 8 checks pass: Unit, Unit (proxy, clock +400d), E2E 1–4, Secret scan, CI success. I also re-ran 333 related unit tests myself (area notes incl. `area-map-placement`, lin-4392/4370/4437/4455, runner-kickoff), both on the head and on a local merge of the head with current `origin/main`: 333/333 pass both times.

### Against what was asked, sentence by sentence
- **Create `lib/run-live-wait.js` with the five names.** Met. `QUEUED`/`RUNNING` move with `isLiveRun`, and `run-live-wait.js` imports nothing from `recent-runs.js`, so there is no cycle.
- **Delete `lib/recommendation-live-wait.js`, no shim, update importers.** Met. The ticket's list was partly wrong (Survey 6dc83aaf): `recommendation-blind-read.js` now imports `isLiveRun` from the new home, the two comment-only files are corrected, and the three test importers move too. `recommendation-live-wait` appears nowhere in `lib/`, `routes/`, `tests/`, `scripts/` or `docs/` outside the historical `docs/plans` and `docs/reviews`. `scripts/prompt-template-change-log.md` is untouched.
- **Behaviour change: a `[pending]` stage whose lineage ends `[blocked]`/`[skipped]` is not live.** Met. `runFact` (`lib/recent-runs.js:76-79`) takes the lineage word only for a row that is parked and has no terminal of its own.
- **Resolve from the unfiltered lineage via `resolveFollowUpRoot`/`heldWakeHolderOf`.** Met by a recorded departure, which the ticket allows ("where the code shows it is wrong, change course and say so"). It is recorded on LIN-4447 in d3553049. The helpers walk up and run per row; the store's batched `withLineage` read (`deriveLineageFields`, the one lineage derivation) reads every row sharing the `rootItemId`, independent of the `HISTORY_ROWS` window and the stage filter. I agree with the departure. I checked that production follow-ups do share the stage's root: `lib/dispatch-factory.js:724` sets `inherited.rootItemId = anchor.rootItemId || fields.followUpTo`, and ci-wake goes through `enqueueFollowUp`, which uses the factory.
- **Move the claim compare-and-set note unchanged.** Met. Only the path changed, plus a "moved from" tag (`docs/areas/runs-and-dispatch.md:91`, and in the module docblock).
- **Retires / Settles Waiting.** Met. The `runFact` Waiting entry is gone from the Runs note, and both live-wait entries are gone from the LLM note.
- **Witness / census / area-map-placement.** Met. The census is read as "defined once, plus the old path gone", as Survey recommended. `area-map-placement` is green.
- **"Before starting: ask LIN-4448 again."** Met in part. The original agreement stands (08c9c898, plus correction 097a3442). The renewed ask (LIN-4448 0510ffe0) was posted at 16:42, after the build, and has no reply yet. It also does not mention the `runner-kickoff.js` import change below. This goes to the ledger.
- **Binding constraints.** Met. Readiness is derived on read; there are no provider reads; Lessons is **5,389 B** (under 6,144); the LLM note's Lessons is 3,950 B; no changelog text is edited. The PR's Retires list misses one item (fix 1).

### Mutation checks (each reverted afterwards)
- Dropped `withLineage: true` from `loadRecentRuns`: W1 (blocked) and W2 (skipped) went red.
- Deleted the parked branch in `runFact`: W1 and W2 went red.
- Dropped `'blocked'` from `PARKED_LINEAGE_ENDS`: W1 went red.
- Removed the `park &&` guard: the "NOT parked" control went red.
The builder's census probe (a second `export const isLiveRun`) is reported red in the PR body.

### Regression check
`git log -30` on `recent-runs.js`, `dispatch-store.js` and the lin-4455 test shows LIN-4370's shared `WAITING_ON_A_PERSON` and LIN-3364's closed-stamp time; both are intact. Nothing is re-applied or reverted.

### Scope question: the `FEEDBACK_ENTRY_KINDS` re-export (autopilot cross-check 64561ac2)
My ruling: **keep it.** It is **inside** the parent's bounded class ("each rule has one home, and the copies are gone"), and it is the same idiom this ticket itself bans for its own module ("no re-export or shim"). The Waiting entry it retires was written by LIN-4455's own blind read, which asked for exactly this drop with the condition "runner prompt bytes and the kinds' order must not change". `runner-kickoff.test.js` and the lin-4455 table test pass. No importer of the store re-export remains in this repo or in simple-dispatcher. The lin-4455 assertion it flips pinned the then-current compatibility state, not a requirement. The leftovers `Retires:` line names a Waiting entry this diff does remove (`docs/areas/llm-and-prompts.md`, the `runner-kickoff.js` entry). Two things are missing: the PR body does not say it (fix 1), and the entry sits on A14's side, so LIN-4448 should hear about it (ledger item 1).

### Isolated, or one of a class?
The class is a parked stage judged by its own row. Every reader of the wait (`liveWaitOf`, look-first's off-switch, blind read's `endedReadsSince`, the selector lines) goes through `loadRecentRuns`, so all of them get the fix at once, and the PR lists that reach. No other row-only park reader turned up. **Outside**, not a defect today: the second live predicate `liveOnAnchor` (`lib/live-anchor.js`) beside `isLiveRun`. It reads a different shape (enriched loops), and the `isLiveRun` docblock already records why. The race fix is already a Waiting entry. No ticket is needed.

### Fixes for close-out
1. **PR #2432 body, `## Retires`:** add a bullet: "The store's `FEEDBACK_ENTRY_KINDS` re-export (`lib/dispatch-store.js`). `lib/prompts/runner-kickoff.js` and the tests import it from the leaf `lib/dispatch-feedback-kinds.js`; the `tests/unit/lin-4455-feedback-kinds-table.test.js` assertion now pins that the store does not re-export it. This settles the LLM & prompts Waiting entry from LIN-4455's blind read."

### What CI Did Not Prove
- **Inside** (the ticket's "ask LIN-4448 again" sentence): LIN-4448 has not confirmed the renewed ask (0510ffe0), and it has not been told about the `runner-kickoff.js` import change or the LLM-note entry that change retires. **Before the merge:** close-out posts that addition on LIN-4448, then either a LIN-4448 reply confirms, or close-out records that 08c9c898 ("agree… no shim… whichever of us lands second changes only the import path") already covers the move and that the runner-kickoff change touches only an import path, with the prompt bytes unchanged (`runner-kickoff.test.js`).
- **Inside** (a claim this change depends on): CI ran on base `0092d8d9e`. If LIN-4458 or LIN-4465 (which edits comments in `lib/recent-runs.js`, per 097a3442) lands first, the PR has to be rebased. **Before the merge:** CI green on the exact commit merged, and lin-4392's LIN-4459 describe block still green. My local merge with today's `origin/main` `2aab32bf0` passed 333/333.
- **Inside** (cost of the behaviour change): every recommendation read (`codeRouteOf`, hit by the autopilot and recommend-and-dispatch) now pays one batched `_lineageOf` read, plus the stale-row self-heal writes `recomputeLineageRows` makes. These are the same reads and writes the proxy list and Dispatch history already do, but CI does not measure latency or write volume. **Named monitor:** the `console.error` "Lineage recompute lost its compare-and-set …" in `lib/dispatch-lineage-status.js`, together with recommendation latency on the proxy route. Only production traffic shows contention. **Named rollback:** revert the PR #2432 merge commit. That is reversible: no schema change, and the heal writes are the derivation the list already persists.
- **Inside** (real-world behaviour): the witnesses build rows through the real store but set `rootItemId` by hand. I confirmed production inheritance by reading the code (`dispatch-factory.js:724`), not from live data. **After the deploy:** find one ticket with a stage parked `[pending]` whose ci-wake `custom` or held-wake follow-up has since posted `[blocked]`/`[skipped]`. `GET /api/proxy/recommendation/<id>` must no longer answer "wait" naming that stage (before the change it did, until an abort). If no such ticket exists yet, record that as "not yet observed" rather than discharged.

### Verdict
Approve — conditional on close-out discharging the ledger


### Comment 2026-11-13T17:04:26.892Z

## Blind read
Verdict: better. It gives two things one home: `FEEDBACK_ENTRY_KINDS` now comes only from `lib/dispatch-feedback-kinds.js`, because the `lib/dispatch-store.js` re-export is gone and every importer moved. The live-wait predicate moved into `lib/run-live-wait.js`, with no import cycle and a census test to guard it. A parked stage whose lineage has ended no longer holds its ticket, and real-store tests in `tests/unit/lin-4392-live-stage-wait.test.js` prove it. On the worse side, the run-outcome words are now split between `lib/run-live-wait.js` (QUEUED/RUNNING) and `lib/recent-runs.js` (waiting on a person, closed, aborted).

Read: https://github.com/JKershaw/LinearViewer/pull/2432 at `7424cfb8f` against `0092d8d9e`.

### Inside the area, fix-sized
- `tests/unit/session-run-transcript-entries.test.js` (runs-and-dispatch, concerns `lib/dispatch-feedback-kinds.js`): the edited header comment now reads "(lib/dispatch-feedback-kinds.js; then —", which is garbled. The same sentence still points to "lib/dispatch-store.js:95" for why `decision-answer` is excluded, but that explanation now lives in `lib/dispatch-feedback-kinds.js`. Fix: reword the parenthesis and point the citation at `lib/dispatch-feedback-kinds.js`, with no line number.
- `lib/recent-runs.js` (runs-and-dispatch): `runFact` now translates the wire word `blocked` into `WAITING_ON_A_PERSON` in two places: the own-row branch and the new parked-lineage branch (`r.outcome === 'blocked' ? WAITING_ON_A_PERSON : r.outcome`). Fix: one small local mapping that both branches use.

### Inside the area, larger
- `lib/run-live-wait.js` / `lib/recent-runs.js` (runs-and-dispatch): the outcomes come from `recent-runs.js` (`runFact`), but to avoid a cycle it now imports `QUEUED`/`RUNNING` from the module that reads them. Meanwhile `WAITING_ON_A_PERSON`, `'closed'` and `'aborted'` stay in `recent-runs.js`, and `lib/recommendation-look-first.js` still imports from there. So the outcome words have two homes. Giving them one home (for example a leaf module of outcome words) means deciding where that home is, and it touches importers in llm-and-prompts, so it is larger than a fix.
- `lib/recent-runs.js` (runs-and-dispatch): a parked stage whose lineage ended is dated by the park's timestamp, not the lineage's end, because the `withLineage` wire row carries no end time (the comment admits this). It therefore sorts too early in the selector's five. It can also land on the wrong side of a "since the latest review" cut, such as `lib/recommendation-blind-read.js`'s count of ended reads. The fix is for `listHistory` in `lib/dispatch-store.js` to report the lineage's end time. That is a store change, so it is larger.

### Outside the area
None.



# Parent ticket LIN-4447: Runs & dispatch, left simpler: each rule written once, the area's waiting work settled, in pieces of varied size

(description as it stands now; comments up to 2026-11-13T17:04:57Z)

## Description

## As asked

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** John: "we've not been applying quite the right force to bend the curve… now want to run both real work, and some real tidies." The Drift & Coherence and Seams & Tangles reviews of 13 Nov found this area carrying rules written in two places that disagree. Batch 1 added several of them:

* Harbour can mark a task Done on a person's check before its blind read, while another check refuses that same task, and a read is then sent to a ticket that's already Done (Drift run 7, `close-out-gate-precedence-split`). John's ruling: "if I choose to do something, Harbour is a passenger. This reflects that for many real projects, they're unlikely to be exclusively changed via Harbour."
* Two pieces of code decide which PRs belong to a task, and they disagree about agent notes, so a blind read can be offered over a PR no review covered (Seams run 12, §3.0a).
* The task timeline decides which model a dispatch used by its own rule, separate from the one the cost figures use (Drift, row 150).
* The check that makes a stage wait while another is live is a runs rule, but it lives with the prompts (Seams, P-LW1).

The area's note holds 20 Waiting entries, and `lib/dispatch-store.js` is 4,530 lines. Seams also tried moving files between areas three ways, and none made the tangle smaller.

**What we want.**

* Each rule in the area has one home, and the copies are gone.
* When a person acts, Harbour follows, and that rule is written once.
* The area's Waiting entries are settled, or each says why it can't be yet.
* Each piece finishes one move and names what it retired. John: "I'd be happy to run a small variety, erring larger, to see", so piece sizes vary, leaning larger.
* The LLM & prompts side of the seam is A14's.

**Done when**

* the cases above are settled, or John has ruled they can wait;
* the area's Waiting entries are settled or say why not;
* the area reads better in a blind read after this work than before it, by more than an untouched area read at the same times.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.

*End of what was asked. Steps write below this line; nothing above it changes.*

## Size of the move

**Size:** rebuild the area
**Why:** Settles the area's duplicated rules and waiting entries together, in both repositories, so a person's act outranks the gate everywhere and one rule decides a task's pull requests; each surface recomputes these, so case-by-case fixes would leave copies.
**Cuts:** none
**Decided by:** a ruling

## Design (chosen approach)

Read at `origin/main` 4b5001ddf, with no commits since the ticket was filed. The full analysis, including the shapes rejected, is in the design comment.

**Cause:** every surface works out close-out readiness and "this task's PRs" again from raw comments, so each rule has copies. Close-out precedence has six: the box, both guard lanes, the check route, `blindReadStep`, and `deriveState` in `lib/run-evidence.js`, which the surveys missed. "This task's PRs" has three readers over a classifier split across two files.

**Chosen: one close-out decision and one trail pass, called by every surface.** Rejected: a per-case fix for each symptom (it leaves the copies, and patching `closeOutSetsDone` would reverse the passenger ruling), and storing readiness once (a stale stored answer goes against the passenger ruling).

Pieces, each naming what it retires:
0\. **Paired blind reads before (prerequisite):** Runs & dispatch plus a control area (`front-end-pages`) on one rubric, recorded here before piece 1 merges; repeat after the last piece.

1. **Larger:** `closeOutDecision` **+** `CLOSE_OUT_REASONS` (precedence-ordered, with copy) in `lib/run-closeout-state.js`, with `actor: 'person'|'harbour'` replacing `byPersonCheck`. The passenger rule is written once (`followsPerson`): a merged landing, or a ticket Done with no Harbour close-out, means the gate stands aside and no read is routed. The exception is an audit notes PR opened after Done. The box, both guard lanes, the route, `blindReadStep` and `run-evidence` render or enforce it. Retires `REFUSED_REASONS`, the second and third `closeOutWaitsOn` asks, the reason literals, the message capitalising, `byPersonCheck` and `deriveState`. Adds a census test, a person-path column in the shared-trail table, and a deliberate flip of row 196. *Waits on R1.*
2. **Larger:** `lib/run-trail.js` holds the one classifier `commentKindOf` and `readTrail`. The landing is the PRs first cited after the anchor (row 14 flips). Work after review is a comment citing a PR the review did not cover, or landing evidence as today, so §3.0a is fixed by failing toward review. The box's PR shape reads the landing, and `extractPrUrls` only records. Retires `isLandingEvidence`, the private notes-PR set and the split classifier. Row 15 is kept as a why-not (it needs the task's repo). Agree the classifier boundary with A14, and recount measure 1.
3. **Small:** `dispatchesOf` carries `fold.last.model`. Retires `dispatchModelOf`.
4. **Medium:** the live-stage wait and `isLiveRun` move to `lib/run-live-wait.js`, and `isLiveRun` reads the lineage's terminal. Retires `lib/recommendation-live-wait.js` (no shim) and `runFact`'s row-only read. Agree with A14.
5. **Medium:** the leftover reads halt modes, `NEVER_RAN` and the follow-up target from their homes; the hook supplies the release note; one `FEEDBACK_KINDS` table carries roles.
6. **Small:** `dispatch-factory` keys its test transport on `isHermeticTestToken` alone.
7. **Small:** `readCalls`/`callsSurfaceOf` split out to `lib/cost-read-calls.js`, with a Runs pattern; instance-wide reads stay out of workspace-keyed stores.

**Waiting (20):** 12 settled by pieces 1–7. Eight say why not, each with its owner: the four simple-dispatcher copies (1, 6, 7, 13) wait on R2; held-wake death (3) waits on the first stuck wake; composable `wakeHook` (5) waits on a second held-wake feature; wake policy (12) waits on John once the shadow has a read; pre-cutover paragraphs (10) are John's, under R2. Lessons stays about 4.3 KB of 6,144 bytes.

**Cuts:** none.

**Rulings (answered by John, 13 Nov, 15:33Z):**

* **R1, passenger scope: "Both: a person's Done and an outside merge"** (comment cf8f5ed6). The recommendation stood. A person's Done and a merge made outside Harbour both outrank the gate, so piece 1 (LIN-4460) keeps the merged-landing row and `followsPerson: 'merged'`.
* **Recommend path and ladder: "Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up"** (comment 90c9f8a4). The accepted limit: an outside merge on a ticket still In Progress still routes the read in `blindReadStep`, and the ladder never reads ticket state. LIN-4460 pins this with a test named for the ruling.
* **R2, simple-dispatcher: "Yes, change both repos so the copies are gone"** (comment 830a4864). This overrules the design's recommendation. Waiting 1, 6, 7 and 13 are settled in both repos by LIN-4461 (piece 8). For Waiting 10, stored pre-cutover paragraphs are kept as written and marked, and history is never recomputed (an engineering call, per the Unblock comment dc7461eb).

With these answered, LIN-4460's merge hold is released. Its PR still needs a recorded review Approve, and piece 0's baseline (LIN-4453, Done) must be on the ticket before it merges.

## Implementation Plan

Read at `origin/main` 4b5001ddf (`git log --since=2026-11-13T12:08:12Z` over the repo: nothing). This plan builds on the Design comment (6efb91fa) and the Unblock comment (dc7461eb). Every claim below was re-read at HEAD; where I disagree with the Design, it says so.

needs multiple sessions: one per piece below (the three small pieces 3, 6 and 7 may share a session, as three PRs).
plan-review due: yes (it needs more than one session, it loosens a gate the passenger rule stands aside from, and it touches merge rules and the dispatch contract)

### What this is for, and what done looks like

Rules in Runs & dispatch are written in more than one place and the copies disagree. Four cases show it: Harbour closes a task on a person's check while the guard refuses the same task; two readers disagree about which PRs are a task's landing, so a read can be offered over a PR no review covered; the timeline and the cost fold name a dispatch's model by different rules; the live-stage wait is a Runs rule living in the prompts side. Cause, not symptom: each surface works out readiness and "this task's PRs" again from raw comments. The fix is one decision and one trail pass that every surface calls, with the person's act as an input (John: "if I choose to do something, Harbour is a passenger").

Done, as the ticket's **Done when** says: the four cases are settled (or John rules one can wait); the 20 Waiting entries are settled or each says why not; a paired blind read after the last piece shows Runs improving more than the untouched control. Each piece below names what it retires. **Cuts to** `## As asked`**: one, agreed by John (13 Nov).** The clause "When a person acts, Harbour follows, and that rule is written once" is written once and followed on every surface that reads the PR, but not on the two surfaces that make no PR read (see piece 1, "What this leaves unsolved"). Every other clause is delivered. One thing looks like a cut and is not: eight Waiting entries stay with a stated why (the ticket allows "or each says why it can't be yet").

Drift from the ask: none. One correction to the Design: its R2 recommended leaving simple-dispatcher out. John has since ruled `lin4447-sd-scope` in scope (13 Nov), and leaving it out would cut "the copies are gone". So simple-dispatcher is piece 8, after 1 to 7.

### Which way, and what was set aside

One close-out decision and one trail pass, each in a Runs-owned module, called by every surface that today re-derives them. Set aside, a line each:

* *A fix per symptom.* Leaves the copies; patching `closeOutSetsDone` to ask the gate would reverse the passenger ruling.
* *A stored readiness record.* A stored answer goes stale when a project changes outside Harbour, which is the reason for the ruling. Readiness is computed from the trail on read.
* *Splitting* `lib/dispatch-store.js` *or moving files between areas.* None of the four cases lives there; Seams run 12 tried three moves.

### Finding every place

The behaviours are named so a place can be recognised: **(a)** "may this task close out, and does Harbour stand aside" (reason, refusal, setDone, who waits on what); **(b)** "which PRs are this task's landing, and has work come since review"; **(c)** "which model did a dispatch use"; **(d)** "is a stage live, and may a new one start"; **(e)** a constant restated beside its home.

Found at HEAD, each classified:

* (a) deciders: `deriveCloseOutState` / `closeOutSetsDone` / `closeOutWaitsOn` (`lib/run-closeout-state.js`); `closeOutNotReady`, `ladderNotReady`, `REFUSED_REASONS` (`lib/close-out-readiness.js`); the check route (`routes/workspace-api-run-evidence.js:300`); `blindReadStep` (`lib/recommendation-blind-read.js:61-65`); `deriveState` (`lib/run-evidence.js:59`, the sixth copy the surveys missed); the close-out press route (`routes/workspace-api-run-evidence.js:350`), a seventh caller of the guard that decides nothing itself. Also a caller: `lib/close-out-merges.js:151` passes `byPersonCheck`, and `lib/dispatch-entrance.js:1328` calls the guard.
* (b) deciders: `extractPrUrls` (`lib/run-evidence.js:35`, box PR shape), `landingPrUrls` / `readGateTrail` (`lib/run-ledger.js`), `isLandingEvidence` and `auditAfterLandingCloseOut` (`lib/recommendation-facts.js`). Consumers of the landing that change with its rule, not copies: the blind-read write check (`routes/proxy-writes.js:723`, which says which PRs a read must name), the blind-read prompt (`lib/prompt-template-defs.js:1293`), `lib/recommendation-look-first.js:154` and `lib/openrouter.js:982` (through `assembleTrailFacts`), `scripts/stability-measures-blind.mjs:101`. *Recorders*, which stay: `ci-wake-sweep.js:337`, `routes/proxy-compute.js:135`, `recordMergedPrs`.
* (c) `dispatchModelOf` (`lib/task-timeline.js:54`).
* (d) `liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT` (`lib/recommendation-live-wait.js`), `isLiveRun` and `runFact` (`lib/recent-runs.js`); importers: `lib/openrouter.js`, `lib/dispatch-entrance.js`, `routes/workspace-api.js`, `lib/proxy-instructions.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-look-first.js`, `lib/recommendation-facts.js`.
* (e) `lib/dispatch-leftover.js`, `_releaseIfHeld` and `releaseHeldWake` in `lib/dispatch-store.js`, `lib/dispatch-feedback-validation.js`.
* Tests and docs that describe today's shape (they flip or move with the pieces): `tests/unit/lin-4438-blind-read-gate.test.js` (rows 14, 15, 196), `lin-4432-audit-notes-pr.test.js`, `lin-4437-blind-read.test.js`, `lin-4392-live-stage-wait.test.js`, `run-evidence.test.js`, `tests/fixtures/run-ledger-trails.js`, `docs/areas/runs-and-dispatch.md` and `llm-and-prompts.md`, `lib/prompt-template-defs.js` prose that names the gate.

How the rest are caught, strongest first: (1) a **census test per behaviour** that fails wherever a copy is still written: no close-out reason literal and no `closeOutWaitsOn` call in `lib/` or `routes/` outside `lib/run-closeout-state.js`; no comment-kind predicate outside `lib/run-trail.js`; no `liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT_CODE` or `newestLiveRun` outside `lib/run-live-wait.js`; (2) an **agreement table** (piece 1) that runs every surface over the same trails, each with its own input shape; (3) this repeatable search, which the builder reruns and reconciles against the list above (a hit not named here is a finding, to put in or out with a reason):
`grep -rnE "closeOutWaitsOn|byPersonCheck|REFUSED_REASONS|landingPrUrls|isLandingEvidence|extractPrUrls|readGateTrail|assembleTrailFacts|dispatchModelOf|isLiveRun|STAGE_IN_FLIGHT_CODE|newestLiveRun|recommendation-live-wait" lib routes scripts tests`.
The grep's hits the first plan did not list, classified: `lib/as-asked.js:46/222/245` (comments naming `assembleTrailFacts`) and `lib/prompt-contract.js:14` (a doc table naming `extractPrUrls`) are prose that the piece renaming or retiring the name updates, and the census tests do not touch them; `scripts/eval/lin-3372-selector-context/harness.mjs:141` is a consumer of `assembleTrailFacts`, which piece 2 keeps exported, so it follows with no change; `scripts/eval/fixtures/recommend/next-stage-choice.json` (9 hits) and `scripts/prompt-template-change-log.md` are recorded text, never edited, and the builder confirms the fixtures' expected routes still hold after row 196 flips (a Done-ticket case may change its expected route, which is then one named fixture edit).

What reading cannot show: code not yet written (a future surface that re-derives readiness) and production comment trails. The census tests catch the first; piece 2's before/after run of `stability-measures-blind` samples the second.

### Area notes that bind this work

`docs/areas/runs-and-dispatch.md` Lessons: the close-out five-lanes lesson (LIN-4438; piece 1 extends it, there are six lanes with `run-evidence`); a close-out test passes a `closeOut` seam (piece 1's person-path tests use it); "a per-dispatch figure is the fold's answer" (piece 3); a full PR URL's repository and number come from `prOf` beside `prUrlsIn` (piece 2 reads PRs only that way); any session can park `[pending]`, read the lineage (piece 4). `llm-and-prompts.md` Waiting entries on `recommendation-live-wait.js` and `COMPLETED` redeclared are A14's, touched by pieces 4 and 1; the entry on `openrouter.js` code routes listed by hand stays A14's and piece 4 adds no new copy. Lessons stays under 6,144 bytes (4,269 at HEAD): each piece removes the Waiting entries it settles and any stale Lesson clause, and only the passenger precedence is a new Lesson, about 300 bytes.

### Order of landing

0 first, and nothing implementation merges before its reports are recorded. Then 3, 5, 6, 7 (independent, no one to wait on). Then 2 and 4, each after one more ask to LIN-4448 at the start of its session. Piece 1 is built after 2. Then 8. Then the repeat of piece 0. Piece 1's decision takes the trail as the named fields `{ review, landing, closeOutAfterReview, workAfterReview }`, which `readGateTrail` already returns and `readTrail` keeps, plus the two the advice row reads (`closeOutOnTrail`, any close-out comment on this landing, and `landingHasNotesPr`, today's private audit notes-PR set), which `readTrail` returns once, so 1 and 2 do not depend on each other's internals; whichever lands second rebases the shared table in `lin-4438-blind-read-gate.test.js`.

### Pieces

**Piece 0: paired readability baseline (no code).** Fresh agents read Runs & dispatch and the untouched control `front-end-pages`, in one window, from each area's files and note only. The areas are too large to read whole (about 2.3 MB across 117 files and 1.1 MB across 92), so the rubric document fixes a sampling rule (the same count of files per area, picked by one stated rule, plus the area note) and a short rubric; it is committed beside the reports so the repeat uses it unchanged. Post each report as a comment headed `## Area read`, never `## Blind read` (that heading triggers the PR-shape check and returns 422). *Witness:* both reports and the rubric are on the ticket before any piece merges. *Retires:* nothing (a measurement).

**Piece 1 (larger): one close-out decision.** Behaviour: `lib/run-closeout-state.js` holds `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor, ticketState })` and `CLOSE_OUT_REASONS`, a frozen precedence-ordered list that carries each reason's copy. It answers `{ status, reason, refuses, setDone, waitsOn, routesRead, followsPerson }`. The box, both guard lanes, the check route, the press route (through the guard), `blindReadStep` and `run-evidence`'s state render or enforce that answer and decide nothing. Renderer-facing `status`, `reason` and `setDone` stay.

**Where each surface gets its facts, and what it answers when one is missing (answers B1).** The decision is built so that no surface needs a fact it does not already hold: no new GitHub read and no new provider read is added anywhere.

| Surface (HEAD) | Trail | PR statuses | `ticketState` | `actor` | Missing fact reads as |
| -- | -- | -- | -- | -- | -- |
| Box (`buildRunEvidence`) | comments | one read, of the landing's sole PR (a multi-PR landing reads none) | not passed | `harbour` | not known merged: gate holds |
| Check route | comments | every cited PR | not passed | `person` | not known merged: gate holds, no Done |
| Stop-at-PR guard lane | comments | every cited PR, fresh | not passed | `harbour` | not known merged: refuses, as today |
| Ladder guard lane | comments | none, by design (one comment read) | not passed | `harbour` | not known merged: refuses, as today |
| Press route | asks the guard | as the guard | as the guard | `harbour` | as the guard |
| `blindReadStep` | comments | none (recommend path makes no GitHub read) | `issue.state.type` | n/a (advice) | PR: not known merged. Ticket state: not Done |
| `run-evidence` state | the box's | the box's | not passed | `harbour` | as the box |

(`lib/close-out-merges.js` calls the chain only for its reads and ignores the derived state; it passes `actor: 'harbour'`.)

**The decision, in the order it answers.** Two kinds of answer, with different evidence, so the surfaces that hold different facts cannot split on the same fact:

* **Enforcement** (`waitsOn`, `refuses`, `reason`, `setDone`, box `status`) uses the trail and the PR statuses and never the ticket's state. Statuses are looked up by PR URL, not by list position (one helper builds the URL-keyed lookup, so the box's single read and the check route's full read both line up with the landing, which retires the index-alignment). The gate stands aside only on positive evidence: **every PR of the landing has a readable merged status** (`followsPerson: 'merged'`). A missing, unreadable or not-merged status for any landing PR is "not known merged", and the gate holds. That fails toward review, the direction piece 2 also chose. A Done ticket is deliberately not evidence here: a Done ticket beside an open, unread landing must still refuse Harbour's merge, and passing the ticket only where it happens to be held would recreate the split.
* **Advice** (`routesRead`) says whether the recommendation sends a `blind-read` stage. It is `waitsOn === 'blind-read'` unless a person already closed the ticket: `ticketState` is `completed`, the trail holds no close-out comment on this landing, and the landing holds no audit notes PR (`followsPerson: 'done'`). Only `blindReadStep` asks it. `ticketState` absent reads as not Done, so a surface that has no issue routes as today. A Canceled or Duplicate ticket stands aside as today. A Done ticket with a close-out after the review stands aside as today. A Done ticket whose latest review covers a notes PR opened after Done still gets its read.

The rule is written once: `followsPerson` is the one field both answers read. `actor` changes only `setDone`: it is true only for `person`, only for a readable merged PR, an approving review and no other unmerged PR (the four existing bounds; the fourth, "the person's own check, never a worker token", is `actor` and is **not** relaxed when `followsPerson` holds). `actor: 'person'` belongs to the check route alone; the guard and `close-out-merges.js`, which pass `byPersonCheck: true` today only to read, map to `harbour` on purpose.

**What this leaves unsolved (agreed by John, see Rulings).** An outside merge on a ticket still In Progress is followed by the box, the check route, the stop-at lane and the press route (they read the PR), but not by the ladder lane or `blindReadStep` (they make no PR read, by contract), which still hold: the recommend path would route one read over a merged landing. Why not fix it here: a PR read on the recommend path costs budget (`PR_STATE_READ_COST` against the 36/h anonymous limit in `lib/pr-state-store.js`), needs token resolution on a path that has none, and the process-wide PR cache is not workspace-scoped. The merge events in `closeOutEventsStore` were considered as a no-read source and set aside: they are written only on paths that observed the merge (the check route while the box is `ready`, the pipeline recorder on a Done write), so an outside merge nobody looked at is absent, and neither the dispatch guard's context nor the recommend path holds that store. Supplying a landing-merged fact to `blindReadStep` later is an input to the same decision, not a redesign. John accepted this limit (13 Nov): add the fact later if a stuck case shows up. No ticket tracks it; the area note's Waiting entry for the passenger rule records it, written in piece 1.

*Retires:* `REFUSED_REASONS`; the guard's second and the ladder's `closeOutWaitsOn` calls and its empty-box readiness rebuild; the reason literals and the message capitalising in `closeOutNotReadyRefusal`; `byPersonCheck` (and its pass-through in `close-out-merges.js` and the route); `blindReadStep`'s own completed-ticket rule; index-aligned `prStatuses`; the decision logic in `deriveState` (`lib/run-evidence.js:59`). `deriveState` keeps what the task page reads from it: `state.pr`, `state.prUrls`, `checksUrl`, `mergedAt` (read by `resolveRunPrRef`, `buildNow`, `render-task-page.js` and `task-page-loader.js`). Its own `status` words differ from the box's (`ready` there means an open PR; `unknown`, `pr-not-open`); the builder lists every reader of `evidence.state.status` first and maps each to the decision's `status` or to a picker field. `resolveRunPrRef` keeps picking from the cited URLs, since it chooses a PR to show checks for, not a landing to gate. *Settles Waiting:* 17, 18, 20.

*Witnesses (fail before, pass after):*

1. **Agreement table, over each surface's own input shape.** Rows are the shared trails in `tests/fixtures/run-ledger-trails.js` × actor × input shape: *full* (every cited PR read, ticket known), *box* (the landing's one PR read), *no PR read* (ladder, `blindReadStep`), *unreadable* (`readable: false`), *ticket unknown* (no issue). Each surface is called the way it is really called, and the expected answer is written in the cell. Two properties are tested over every row: surfaces holding the same facts return the same answer; and **dropping a fact never loosens an enforcement answer** (removing a PR status, or making it unreadable, can only move `refuses` or `waitsOn` toward holding). `ticketState` can loosen only `routesRead`.
2. The three named cases, as tests: a person's check on a merged, approved, unread landing sets Done and the stop-at lane no longer refuses it; a Done ticket with no close-out on its trail gets no `blind-read` from `blindReadStep` (row 196's first half flips on purpose); the same Done ticket with a close-out after the review still gets none (row 196's second half stays), and an audit's notes PR opened after Done still gets its read (added beside it).
3. The census above (no reason literal, no `closeOutWaitsOn` call, no `byPersonCheck` outside `lib/run-closeout-state.js`).
4. What the guard exists to stop, tried: `actor: 'harbour'` with an approving review, a merged PR and no other unmerged PR gives `setDone: false`; an approved, unmerged, unread landing is still refused `blind-read-missing` by both guard lanes with the ticket Done or not; a person's check with no approving review still sets no Done; `head-moved` refuses both actors; an unreadable PR holds the gate; Harbour never sets Done on a guard call.
5. The limit, pinned so it is visible: outside merge, ticket In Progress, `blindReadStep` still routes the read (a test named for the ruling, so a later change that supplies the fact flips one assertion).
   *Hold:* none. R1 is answered "both", and the limit above is accepted, so piece 1 merges on its own review like any other piece.

**Piece 2 (larger): one trail pass.** Behaviour: `lib/run-trail.js` holds the one comment classifier `commentKindOf` and `readTrail(comments)`, which `readGateTrail` and `assembleTrailFacts` both read. The landing is the PRs first cited after the anchor, so an audit that re-cites a merged landing PR no longer joins the notes PR's landing (row 14 flips on purpose). Work after review is any later comment that cites a PR the reviewed landing did not hold, agent notes included (this fixes Seams §3.0a by failing toward review), plus the non-agent landing evidence that counts today; re-citing the reviewed PR does not restart review. The box counts the landing, not every cited PR, and its one PR read targets the landing's sole PR (a multi-PR landing reads none and so reads as not known merged); the read is matched to its PR by URL (piece 1's lookup), so it can no longer line up with the wrong cited PR. `resolveRunPrRef` keeps choosing from the cited URLs (it picks a PR to show checks for), with a test that a landing of \[A\] cited beside B reads A in the box and withholds in the picker. `extractPrUrls` stays only to record citations; `landingPrUrls` stays as a thin named export for `stability-measures-blind` and the blind-read write check. Row 15 (a foreign PR cited before the first review) stays as a stated limit, because no caller holds the task's repository; its Waiting entry is rewritten to say why. One classifier ships: if A14 will not take it into Runs, `commentKindOf` stays on the prompts side and Runs imports it, but never two.
*Retires:* the split classifier across `run-ledger.js` and `recommendation-facts.js`, `isLandingEvidence`, the private notes-PR set in `auditAfterLandingCloseOut`, `landingPrUrls`'s own loop, and the box PR list as a decider. *Settles Waiting:* 15 (row 15 kept as a why-not) and 16.
*Witnesses:* a test where an agent note after review cites a new PR and `workAfterReview` is true, and one that re-cites the reviewed PR and it is false; row 14 flipped; the classifier census; and the recount: run `scripts/stability-measures-blind.mjs` over the same window on `main` and on the branch and record each landing whose read status changed in the PR. *Likeliest breaks:* a narrower landing changes which PRs a blind read must name, so the write check at `routes/proxy-writes.js:723` and the prompt at `lib/prompt-template-defs.js:1293` need a test on the new rule; and a historical notes-PR landing counts differently in measure 1.

**Piece 3 (small): model attribution.** `dispatchesOf` in `lib/cost-read.js` carries the fold's `last.model`; timeline rows read it. *Retires:* `dispatchModelOf` and its ranking, and the Lesson clause that names it. *Settles Waiting:* 19. *Witness:* the Drift case as a test: model A has $5 priced plus one unpriced request, model B $1 priced: lane and row name the same model; with nothing priced, both name the latest.

**Piece 4 (medium): the live-stage wait gets a Runs home.** `lib/run-live-wait.js` holds `liveWaitOf`, `liveWaitRefusal`, `STAGE_IN_FLIGHT_CODE`, `newestLiveRun` and the live predicate (`isLiveRun`); `lib/recommendation-live-wait.js` is deleted, with no re-export, and the importers listed above are updated. Behaviour change in the same move: a stage parked `[pending]` whose lineage ends `[blocked]` or `[skipped]` is not live (today `runFact` reads only the row, so it holds the wait until aborted). `isLiveRun` is a predicate over a run fact's `outcome`, and `runFact(r, aborted)` (`lib/recent-runs.js:66`) sees one row at a time, so the fix is to pass it the lineage's rows and read the terminal through the existing follow-up and held-wake lineage helpers; its two callers (`recentRuns`, `loadRecentRuns`) hand the rows over. The claim compare-and-set note moves from the LLM note to the Runs note unchanged. *Retires:* the old module (no re-export; the census uses the four real names) and `runFact`'s row-only read. *Settles Waiting:* 14, and the LLM-side entry with A14. *Witness:* extend `lin-4392-live-stage-wait.test.js` with the `[pending]`-then-`[blocked]` lineage (fails before, passes after) and a census that nothing outside `lib/run-live-wait.js` spells the wait. Keep `area-map-placement` green; `run-live-wait.js` already matches Runs by its `run-` prefix.

**Piece 5 (medium): one declaration for each restated constant.** `lib/dispatch-leftover.js` and `_releaseIfHeld` import halt modes, `NEVER_RAN` and the follow-up target from their owners; `wakeHook.releaseNote` supplies the release wording so the store no longer calls `formatHeldWakeNote`; one `FEEDBACK_KINDS` table in `lib/dispatch-feedback-validation.js` carries each kind's roles, and `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s skip rule derive from it. *Retires:* the restated constants and the three hand-written kind sets. *Settles Waiting:* 2, 4, 11. *Witness:* a test that iterates `HALT_MODES` and shows every one stops a leftover (so a newly added mode is caught), and `lin-4377` counting the import, not the spelling.

**Piece 6 (small): hermetic transport.** The Design said to key `dispatch-factory` on `isHermeticTestToken` alone. **That is wrong at HEAD:** the comment at `lib/dispatch-factory.js:925-934` records that only the Linear provider's transport is swapped under test, and every other provider takes `test-token` as a working credential that the seal and file-pointer suites rely on. Dropping the name check would make those providers' issue reads vanish. Decision, made now rather than left to the builder: a provider declares the capability `testTransport` where its transport is swapped (Linear, in `routes/test.js` and `tests/fixtures/hermetic-linear.js`), and the factory skips access when `provider.testTransport && isHermeticTestToken(token)`. *Retires:* the `provider.name === 'linear'` test and the "this is not a capability" comment. *Settles Waiting:* 8. *Witness:* Linear with the test token has no access; a local provider with the same token still has it; a stand-in provider that declares the capability is skipped; the seal and file-pointer suites stay green.

**Piece 7 (small): cost-call reads.** `readCalls` and `callsSurfaceOf` move to `lib/cost-read-calls.js`, and `areas.json` gets a Runs pattern for it in the same change (today's `cost-read` pattern ends at `\.js` and would not match, so the file would fall to the `^lib/` catch-all). Instance-wide reads stay out of workspace-keyed stores, as in `kpi-stats`, for the privacy boundary. *Retires:* the two functions' place in `cost-read.js`. *Settles Waiting:* 9. *Witness:* `area-map-placement.test.js` pins the new file to Runs.

**Piece 8 (later, cross-repository): simple-dispatcher.** Waiting 1, 6, 7 and 13: `sessionPrs`, `columnProblems`, the missing follow-up-to-finished contract row, the transcript fold. Shape, decided now: for each rule that must exist on both sides of the wire, one owner and a check that fails on drift counts as one home (the ticket's own definition). Concretely the rule moves into `lib/runner-kit/contract.json` as data both sides run, or one side owns the code and the other pins its output with a golden test, whichever the builder finds smaller per rule; `CONTRACT_SHA256` is bumped in step. This is planned in detail at the start of its own session, after 1 to 7 land, from `simple-dispatcher` at its HEAD then (it moves independently; at planning time its HEAD was 1616b19). Waiting 10 (pre-cutover paragraphs) is an engineering call: keep stored paragraphs, mark them pre-cutover, never recompute history; written into the entry in piece 8.

**Waiting entries that stay, with why:** 3 (held-wake death: revisit on the first stuck held wake; no speculative recovery), 5 (composable `wakeHook`: the next held-wake feature owns it), 12 (wake policy: John, once the shadow has a read), 10 (above), and the row-15 foreign-PR entry (needs task-repo context). All 20 original entries are accounted for: 2, 4, 8, 9, 11, 14, 15, 16, 17, 18, 19, 20 settled by pieces 1 to 7; 1, 6, 7, 13 by piece 8; 3, 5, 10, 12 stay with a why.

### The likeliest ways this breaks

1. **A surface keeps its own branch, or holds fewer facts than its neighbour and answers looser.** Six deciders become one function, and one keeps a copy, or one passes a fact the others lack. Witness: the agreement table over each surface's real input shape, the "dropping a fact never loosens enforcement" property, and the census.
2. **Passenger precedence over-loosens.** Standing aside for a person must not let Harbour close out an unmerged, unread landing, set Done on a worker's call, or skip an audit's notes PR after Done. Witness: piece 1's attempt-the-forbidden tests.
3. **The narrower landing drops a PR from review.** A re-cited or agent-cited PR escapes the gate. Witness: piece 2's agent-note tests, and the measure-1 recount.

### Rulings

All answered on 13 Nov:

* **R1** (`lin4447-r1-passenger-scope`): **both**. A person marking Done and a merge made outside Harbour are both followed. Built as piece 1 describes: an outside merge is followed wherever the surface reads the PR, and a person's Done is followed on the recommend path.
* `lin4447-sd-scope`: **in scope**. simple-dispatcher is piece 8, after pieces 1 to 7.
* `lin4447-recommend-path-outside-merge` (the one cut, quoting "When a person acts, Harbour follows, and that rule is written once."): **accepted**. No new GitHub reads on the recommend path or the ladder lane. Add the fact later if a stuck case shows up.

Nothing is held for a ruling any more.

*Plan revision (answers the Plan Review Verdict): **B1 fixed.** Piece 1 now names, per surface, where each input comes from, adds ticket state as an optional input used only by the advice answer, and writes the unknown-fact rule as precedence (unknown is "not known merged", the gate holds). The agreement table runs each surface in its own input shape, tests unknown PR and unknown ticket, and includes the press route; a property test pins that dropping a fact never loosens enforcement. The plan got smaller for it: the ticket's state is kept out of every enforcement surface, so no guard lane or route gains a provider read. Builder notes 1 to 6 are taken in: the fourth Done bound is* `actor` *with its own witness and the guard/*`close-out-merges.js` *mapping to* `harbour` *is stated;* `deriveState`*'s picker fields and* `status` *readers are named; the box's one read is realigned to the landing by URL; the grep's extra hits are classified; piece 4 uses the real names and the lineage rows reach* `runFact`*; row 196's second half stays and the notes-PR-after-Done case is added. The first revision's two corrections to the Design (piece 6, simple-dispatcher in scope) stand.*

## Comments

### Comment 2026-11-13T13:18:49.089Z

## Survey open-0: LIN-4447 @ 4b5001ddf

Read at `origin/main` 4b5001ddf. Nothing later was read.

**Why this will be hard**

1. **The passenger ruling reverses a pinned rule.** `blindReadStep` (`lib/recommendation-blind-read.js:61`) sends a read to a `completed` ticket on purpose unless a close-out followed the review. `lin-4438-blind-read-gate.test.js:196` and row 14 pin that. `closeOutSetsDone` (`lib/run-closeout-state.js:443`) never asks `closeOutWaitsOn`; the guard does. Following the ruling means a person's check outranks the gate in the box, guard, `ladderNotReady` and route alike. That is a precedence decision across the five readiness lanes. Patching only `routes/workspace-api-run-evidence.js` would add a sixth copy.

2. **"This task's PRs" has three readers.** `extractPrUrls` (box), `landingPrUrls` (`lib/run-ledger.js:555`, gate) and `isLandingEvidence` (`lib/recommendation-facts.js:85`, work-after-review). The comment at :82 says the last two agree, and §3.0a shows they don't. Underneath is a comment classifier split between `run-ledger` and `recommendation-facts`, and the second file is on A14's side by prefix. Rows 14–15 are "chosen, not designed", so one reader will flip at least one. That needs a ruling, not a regression fix.

3. **The seam runs through the files.** The live-stage wait (P-LW1) and the blind-read route are Runs rules in `lib/recommendation-*`. `areas.json` assigns by prefix, so moving one means a rename or a guide edit, and either touches A14. Seams found that moving files doesn't shrink F1. Move the rule's home, not the reader.

4. **Three Waiting entries are copies in simple-dispatcher** (`sessionPrs`, `columnProblems`, the transcript fold). This ticket names LinearViewer only, so each needs a ruling or a "why not yet". Five more are open design questions (composable `wakeHook`, wake policy, feedback-kind roles, pre-cutover paragraphs, instance-wide reads).

5. **`dispatchModelOf` is the cheap one.** The fix is already written: carry the fold's `last.model` through `dispatchesOf`.

6. **Splitting `dispatch-store.js` (4,530 lines) settles none of the four cases.** It shouldn't stand in for them.

**What I'd do first**

- **Take the baseline blind read now:** this area plus an untouched control area, read at the same time (the paired-area method). Without it the third Done-when can't be judged.
- **Get John's ruling on the passenger rule's scope:** Done-by-person only, or also a merge made outside Harbour? Is no read offered on any `completed` ticket? Rows 196 and 14 change either way.
- **Then one larger piece:** a close-out reasons constant, one precedence function called by box, guard, ladder and route, and one landing reader on one classifier. That retires about five Waiting entries plus §3.0a. Agree the classifier boundary with A14 first.
- **Small pieces alongside:** `dispatchModelOf` and the `dispatch-factory` `provider.name` check.

Lessons sits at about 4.3 KB of the 6 KB cap, so settled entries need to become short Lessons or be retired.


### Comment 2026-11-13T13:23:16.857Z

## Survey global: LIN-4447 @ 4b5001ddf

**Where it lands, and the trend.** Three of the four named cases are not inside `lib/dispatch-store.js`. They are rules that each surface asks again. Close-out precedence is spelled in `lib/run-closeout-state.js` (`closeOutWaitsOn`, `closeOutSetsDone`), in `lib/close-out-readiness.js` (twice, plus `ladderNotReady`), in `routes/workspace-api-run-evidence.js` (web-routes), and in `lib/recommendation-blind-read.js`. Because of the `recommendation-` prefix in `areas.json`, that last file belongs to LLM & prompts, as do `isLandingEvidence` and the live-stage wait.

On size, things are getting worse: the store grew 2,308 → 3,685 → 4,530 lines (13 Sep → 1 Nov → 10 Nov), and Waiting went 18 → 20 in three days. On discipline, they are getting better: recent commits are "one X reader" consolidations (cbece221e, 8c182b283), and the repo already has a census test proving a rule is written once (`lin-4382-precedence-written-once`).

**Done the obvious way.** Each case gets a branch where its symptom shows. LIN-4438, 4439 and 4396 each did this. Patching `closeOutSetsDone` to consult the gate would contradict the passenger ruling. Read straight, the ruling retires a deliberate rule instead: `blindReadStep` keeps a read on a `completed` ticket unless a close-out followed review (line 62). The shared-trail table runs with `byPersonCheck: false`, so it would not notice either choice.

A fourth "task's PRs" helper beside `extractPrUrls`, `landingPrUrls` and `isLandingEvidence` leaves four copies unless two of them retire. The classifier under them is A14's.

Settled Waitings have to go somewhere. Lessons is at 4,280 of 6,144 bytes, so most entries must be retired by code, not turned into lessons. Three entries (`sessionPrs`, `columnProblems`, the transcript fold) are copies in simple-dispatcher. Fixing only the LinearViewer half leaves a pair, and `CONTRACT_SHA256` pins bytes, not the rule.

**Better, at this task's cost:**
- One close-out function in `run-closeout-state.js` that returns the reason and its precedence from a reasons constant. The box, guard, ladder, route and `blindReadStep` all call it, and the person's check is one input. This retires the second spelling in `REFUSED_REASONS` and the ladder's third ask. Add a census test in the 4382 style.
- Delete `dispatchModelOf` and carry the fold's per-dispatch model through `dispatchesOf`. The session level already carries `last.model`. This is the small piece.
- Give the live wait a home with an `areas.json` claim. Runs comes before LLM in the order, and `area-map-placement` will notice.
- Take a blind read of this area and of a control area before the first change, so "done when" has a baseline.

**Better still, not this task's:** Splitting `dispatch-store.js`, since none of the four cases live there. One comment classifier, which is A14's or a joint ruling. A contract across both repos for the SD copies (John's scope call). Each of the five design Waitings (`wakeHook`, wake policy, feedback-kind roles, pre-cutover paragraphs, instance-wide reads) should say whose decision it waits on.

**The deeper symptom:** readiness is recomputed on every surface instead of computed once and carried. Area ownership by filename prefix splits the rules from the area they belong to.


### Comment 2026-11-13T13:32:27.516Z

## Design: LIN-4447 @ 4b5001ddf

Read at `origin/main` 4b5001ddf. Staleness check: `git log --since=2026-11-13T12:08:12Z` over `lib/`, `routes/`, `tests/`, `docs/areas/` returns nothing, so both surveys still describe the code. I re-read every file named below at HEAD and found one more copy the surveys missed (see 2).

### The problem, from the cause

The four named cases share one cause. **Each surface works out a task's readiness again from raw comments and PR reads, with its own copy of the rule.** They do not compute it once and carry the answer. At HEAD, "may this task close out, and who decides" is spelled in:

1. `deriveCloseOutState` (box): a merge outranks the gate, and `closeOutSetsDone` never asks the gate;
2. `closeOutNotReady` stop-at lane: `REFUSED_REASONS`, then a second `closeOutWaitsOn` call that overrides the box;
3. `ladderNotReady`: a third `closeOutWaitsOn` call, then `blindReadMissingState` over an empty box;
4. the check route (`routes/workspace-api-run-evidence.js`): `closeOutSetsDone` on `state.status === 'merged'`;
5. `blindReadStep` (`lib/recommendation-blind-read.js`): its own rule for which `completed` tickets still get a read;
6. **not in either survey:** `deriveState` in `lib/run-evidence.js`, a looser second box (`no-pr`, `multiple-prs`, `unknown`, `merged`, `ready`, `pr-not-open`) built from the same PRs beside `deriveCloseOutState`.

"This task's PRs" has the same problem. `extractPrUrls` (every PR ever cited) drives the box's PR shape, `landingPrUrls` drives the gate and `isLandingEvidence` drives `workAfterReview`. Under them sits a comment classifier split between `lib/run-ledger.js` (`isCloseOut`, `isReviewSummary`, `isBlindRead`, `isSurveyReport`) and `lib/recommendation-facts.js` (`isAgentNote`, `isAuditReport`, `isLandingEvidence`). `auditAfterLandingCloseOut` holds a fourth notion, "a PR first cited by the audit".

A good outcome: a person's act outranks Harbour's gate, and that is one input to one decision. One trail pass answers "which PRs, which landing, has work come since review" for every reader. Each surface renders or enforces that answer and decides nothing itself.

### Shapes considered

**A. Fix each case where it shows (four separate branches).** Patch `closeOutSetsDone` or the route, have `landingPrUrls` skip agent notes, delete `dispatchModelOf`, move the live-wait file.
- Cost: low, about four small PRs.
- Risk: this is what LIN-4438, LIN-4439 and LIN-4396 each did, and how the copies built up. Patching `closeOutSetsDone` to ask the gate would reverse John's passenger ruling. Making `landingPrUrls` skip agent notes would leave an agent-cited PR outside the gate, which fails toward *less* review. It also leaves the third copy (box `prs`) and the sixth (`run-evidence` `deriveState`) in place.
- Fit: poor. It breaks "every change names what it retires", because nothing retires.

**B. One close-out decision and one trail pass, called by every surface (recommended).** Two shared readers in Runs-owned files. The box, guard, ladder, route, blind-read route and run-evidence state render or enforce their answers. The small cases ride alongside as their own pieces.
- Cost: two larger pieces, two medium pieces and several small ones (below). Census tests in the `lin-4382-precedence-written-once` style.
- Risk: the box model changes shape. Renderers read `status`, `reason` and `setDone`, so those names stay, and the change is in who computes them. Rows 14 and 196 of `lin-4438-blind-read-gate` flip on purpose. Measure 1 (`scripts/stability-measures-blind.mjs`) imports `landingPrUrls`, so a narrower landing changes how historical notes-PR landings count (the recount is in the plan, piece 2).
- Fit: good. It reuses `closeOutWaitsOn`, `CLOSE_OUT_STATUS`, `readGateTrail`, `prUrlsIn`/`prOf` and the census-test pattern, and adds no second way of doing anything.

**C. Readiness computed once and stored (a materialised per-task close-out record)**, which the global survey calls the "deeper symptom". Each comment or PR event updates a stored readiness, and every surface reads the row.
- Cost: high. It needs a new store, invalidation on every comment/PR/state event (including events made outside Harbour, which Harbour sees only by polling) and a migration.
- Risk: a stale stored answer is worse than a recomputed one, and the passenger ruling exists *because* projects change outside Harbour. Computing from the trail on read is what keeps Harbour a passenger.
- Fit: it would be a second state store beside the trail. B gets the "computed once" property per request, without the cache.

**Not a shape:** splitting `lib/dispatch-store.js` or moving files between areas. None of the four cases lives in the store, and Seams run 12 tried three moves that left F1 the same size (constraint in the brief).

### Recommendation: B, in these pieces

Each piece finishes one move, names what it retires, and removes its settled Waiting entries in the same change. The size is "rebuild the area" with no cuts. The sizes vary and lean larger, as John asked.

**Piece 0 (prerequisite, no code): paired blind reads before.** Take a blind read of Runs & dispatch and of an untouched control area (proposed: `front-end-pages`, which none of these pieces touches), in the same window, with the same rubric and by fresh agents given only the area's files and its note. Record both on this ticket before piece 1's PR merges. Repeat after the last piece. Without this, the third Done-when cannot be judged. Neither survey recorded one, and I found no area-read tool in the repo (`scripts/stability-measures-blind.mjs` is measure 1, per-landing, not per-area). Piece 0 ships the rubric as a short doc beside the reports so "after" uses the same one.

**Piece 1 (larger): one close-out decision, with the person's act as an input.**
- In `lib/run-closeout-state.js`: `CLOSE_OUT_REASONS`, a frozen constant listing every reason in **precedence order**, with copy (`not-stop-at-run`, `review-not-approve`, `blind-read-missing`, `runner-not-set-up`, `multiple-prs`, `multiple-open-prs`, `pr-unreadable`, `pr-not-open`, `head-moved`). Also `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor })` → `{ status, reason, refuses, setDone, waitsOn, followsPerson }`. `actor` is `'person'` (the signed-in check) or `'harbour'` (a close-out dispatch). It replaces `byPersonCheck`.
- **The passenger rule, written once:** `followsPerson` is true when the landing is already merged, or the ticket is `completed` with no Harbour close-out after the review. When `followsPerson` holds, the gate stands aside: `setDone` follows R1's other three bounds, `waitsOn` is null, and no read is routed. The gate binds only Harbour's own close-out of an unmerged landing. The one exception is a landing Harbour opened *after* the ticket was Done, which is an audit's notes PR. It still gets its read, because Harbour will close it out itself. (Scope depends on John's ruling below. This is my recommendation.)
- Callers: `deriveCloseOutState` becomes the box render over `closeOutDecision`. Both guard lanes return `decision.refuses ? state : null`. The check route reads `decision.setDone`. `blindReadStep` reads `decision.waitsOn` and `followsPerson` instead of its own `completed` test, and `deriveState` in `lib/run-evidence.js` maps the decision's status.
- **Retires:** `REFUSED_REASONS`; the guard's second `closeOutWaitsOn` call; `ladderNotReady`'s direct call and its empty-box `blindReadMissingState`; the bare `'blind-read-missing'` and other reason literals; `closeOutNotReadyRefusal`'s capitalising of `state.message` (copy comes from the constant); `byPersonCheck`; `blindReadStep`'s `isTerminalState`/`COMPLETED` rule (also the LLM-note entry on `COMPLETED` redeclared, with A14's agreement); and `run-evidence`'s `deriveState`. A census test fails if any reason literal, or a `closeOutWaitsOn` call, appears outside `run-closeout-state.js` in `lib/` or `routes/`.
- Tests: `lin-4438-blind-read-gate` row 196 flips (Done with no Harbour close-out → no read), and the shared-trail table gains an `actor: 'person'` column so the person's path is finally exercised. Today it runs only `byPersonCheck: false`.
- **Settles Waiting:** `closeOutSetsDone` never asks `closeOutWaitsOn` (Drift 13 Nov); `close-out-readiness.js` stop-at lane precedence in two files + `ladderNotReady` third ask (blind reads on LIN-4439/4396); `close-out reasons are bare string literals` (blind read on LIN-4396).

**Piece 2 (larger): one trail pass answers "this task's PRs".**
- New `lib/run-trail.js` (Runs by the `run-[^/]*` prefix). It holds `commentKindOf(body)`, the one classifier, with the predicates moved there: close-out, review summary, blind read, survey, audit report and agent note. It also holds `readTrail(comments)` → `{ sorted, kinds, review, anchor, landing, cited, workAfterReview, closeOutAfterReview, notesPrs }`. `readGateTrail` and `assembleTrailFacts` read from it. `extractPrUrls` survives only as `cited`, which `recordMergedPrs`, `ci-wake-sweep` and `proxy-compute` use to *record* PRs. Nothing uses it to decide.
- **One landing rule (engineering choice, with reasons):**
  1. *The landing is the PRs first cited after the anchor.* This is the same "first cited" rule `auditAfterLandingCloseOut` uses for a notes PR. An audit that re-cites a merged landing PR no longer pulls it into the notes PR's landing (row 14 flips).
  2. *Work after review is any comment after the review that cites a PR the review's landing did not hold, or a non-agent comment carrying landing evidence (as today).* An agent note that cites a **new** PR after review now sends the task back to review (§3.0a fixed). An agent note that re-cites the reviewed PR still does not loop the review. I chose to fail toward more review: the alternative, dropping agent notes from the landing, leaves an unreviewed PR outside the gate.
  3. The box's PR shape reads `landing`, not `cited`, so the box and the gate count the same PRs.
  4. Row 15 (a foreign PR cited before the first review) stays a known limit. Fixing it needs the task's repository, which no caller holds. Its Waiting entry is rewritten to say why.
- **Retires:** `isLandingEvidence`, `auditAfterLandingCloseOut`'s private notes-PR set, `landingPrUrls`'s own loop (it becomes `readTrail(c).landing`, kept as a named export for measure 1), the classifier halves in two files, and box `prs` as a decider.
- **A14 coordination:** `isAgentNote`, `isRuling` and `isPersonComment` are read on the LLM side. The classifier's home moves to Runs, and `recommendation-facts.js` imports it. Agree this boundary with A14 before the PR. `area-map-placement` needs no new pin, because `run-trail.js` already matches Runs.
- Measure 1: re-run `stability-measures-blind` over the window before and after, and record any landing whose read status changes in the PR.
- **Settles Waiting:** `landingPrUrls` counts every full PR URL (rows 14/15 + §3.0a) → settled, with row 15 rewritten as why-not; `deriveCloseOutState works from two PR lists` (blind read on LIN-4439).

**Piece 3 (small): retire `dispatchModelOf`.** In `dispatchesOf` (`lib/cost-read.js`), add `model: fold.last.model`. `foldRequestUsage` already ranks by priced dollars, then latest use, and falls back to the latest model. `dispatchRowOf` reads `dispatch.model`. **Retires** `dispatchModelOf` and its private rank. **Settles** the `task-timeline.js` Waiting entry (Drift 13 Nov). The binding Lesson already exists ("A per-dispatch figure … is the fold's answer"). Its last sentence, which names `dispatchModelOf`, gets trimmed, giving bytes back to Lessons.

**Piece 4 (medium): the live-stage wait gets a Runs home, together with what counts as live.** Move `liveWaitOf`, `liveWaitRefusal` and `STAGE_IN_FLIGHT` from `lib/recommendation-live-wait.js` into `lib/run-live-wait.js`, next to `isLiveRun`, which moves out of `lib/recent-runs.js`. `openrouter.js`, `dispatch-entrance.js`, `routes/workspace-api.js` and `proxy-instructions.js` import from there. The old file is deleted, not left as a re-export, because a shim would be a second home. In the same move, `isLiveRun` reads the lineage's terminal rather than only the row's feedback, through `heldWakeHolderOf`/`resolveFollowUpRoot`, per the existing Lesson. **Retires** `recommendation-live-wait.js` and `runFact`'s row-only read. **Settles** the Runs Waiting `recent-runs.js runFact reads only the row's feedback` (LIN-4392) and, with A14, the LLM-note entry `recommendation-live-wait.js: the live-stage refusal … is a Runs dispatch rule` (Seams 13 Nov). The LLM note's claim compare-and-set entry moves with the file into the Runs note, unchanged.

**Piece 5 (medium): one declaration for each restated constant.**
- `lib/dispatch-leftover.js` imports `HALT_MODES`, `NEVER_RAN` and the follow-up target from their homes. `_releaseIfHeld` does the same. Census: a new halt mode stops a leftover.
- `lib/dispatch-store.js` `releaseHeldWake`: the hook supplies its release note (`wakeHook.releaseNote`), so the store no longer calls `formatHeldWakeNote`. `lin-4377` then counts the import, not only the spelling.
- `lib/dispatch-feedback-validation.js`: `FEEDBACK_KINDS`, one table with each kind's roles (entry, parked-wait-skipped, wake-skip). `PARKED_WAIT_SKIPPED_KINDS`, `FEEDBACK_ENTRY_KINDS` and `findWakeEvent`'s skip rule derive from it.
- **Settles** those three Waiting entries (Drift 10 Nov; Operator LIN-4377; Survey tally LIN-4240/4239/4233).

**Piece 6 (small): `dispatch-factory` test transport.** Drop `provider.name === 'linear'` and key the test-only transport on `isHermeticTestToken` alone. Ground it first: if a non-Linear hermetic path depends on the name check, carry a `provider.testTransport` capability instead. **Settles** the LIN-4347 entry.

**Piece 7 (small): `cost-read.js` split.** Move `readCalls` and `callsSurfaceOf` to `lib/cost-read-calls.js`, which needs a Runs pattern in the same change. The instance-wide-reads question is engineering: instance-wide reads stay in their own module and never sit in a workspace-keyed store, as they already do in `kpi-stats` for the privacy boundary. **Settles** the LIN-4201 entry.

### All 20 Waiting entries, one by one

| # | Entry (file, source) | Outcome |
|---|---|---|
| 1 | `dispatch-wake.js` `reportedPrUrlOf` / SD `sessionPrs` (Drift 10 Nov) | **Why not yet:** the copy is in simple-dispatcher. Waits on ruling R2. |
| 2 | `dispatch-leftover.js` restated halt modes (Drift 10 Nov) | Settled, piece 5 |
| 3 | `dispatch-leftover-hook.js` death between claim and enqueue (LIN-4377) | **Why not yet:** the trade-off is recorded (a lease sees no re-report, a sweep scans history, clearing stamps reopens LIN-4375). No observed incident. Owner: engineering, revisit on the first stuck held wake. Entry rewritten to name that trigger. |
| 4 | `dispatch-store.js` `releaseHeldWake` picks leftover wording (LIN-4377) | Settled, piece 5 |
| 5 | `dispatch-store.js` one `wakeHook` (LIN-4377) | **Why not yet:** composable hooks need a second held-wake feature, and none exists. Building it now would be speculative. Owner: the ticket that brings the second feature (the Lesson already says it "brings a hook"). Entry rewritten to say so. |
| 6 | `runner-kit/contract.json` row shape written twice (LIN-4377) | **Why not yet:** the copy is in SD. Waits on ruling R2. |
| 7 | `runner-kit/contract.json` no follow-up-to-finished row (Seams 10 Nov) | **Why not yet:** a new contract row changes `CONTRACT_SHA256`, so SD must be bumped in step. Waits on ruling R2. |
| 8 | `dispatch-factory.js` provider name check (LIN-4347) | Settled, piece 6 |
| 9 | `cost-read.js` split + instance-wide reads (LIN-4201) | Settled, piece 7 |
| 10 | `session-summary.js` pre-cutover paragraphs (LIN-4201) | **Why not yet:** whether stored history is rewritten is John's call (what to retire). My recommendation: keep stored paragraphs as written and mark them pre-cutover, never recompute history. Asked as part of R2. |
| 11 | `dispatch-feedback-validation.js` feedback kinds (LIN-4240/4239/4233) | Settled, piece 5 |
| 12 | `wake-shadow.js` one wake policy (LIN-3257) | **Why not yet:** the shadow exists to gather evidence before the policy changes, and switching on a policy changes when agents get woken (product). Owner: John, once the shadow has a read. Entry rewritten to say so. |
| 13 | `runner-kit/runner.mjs` transcript fold in two repos (LIN-4203/4195) | **Why not yet:** cross-repo, and the largest SD piece. Waits on ruling R2. |
| 14 | `recent-runs.js` `runFact` row-only (LIN-4392) | Settled, piece 4 |
| 15 | `run-ledger.js` `landingPrUrls` rows 14/15 + §3.0a (LIN-4438, Seams 13 Nov) | Settled, piece 2 (row 15 kept as a why-not entry: needs the task's repo) |
| 16 | `run-closeout-state.js` two PR lists (blind read on LIN-4439) | Settled, piece 2 |
| 17 | `close-out-readiness.js` precedence in two files + ladder third ask (LIN-4439/4396) | Settled, piece 1 |
| 18 | `run-closeout-state.js` bare reason literals (LIN-4396) | Settled, piece 1 |
| 19 | `task-timeline.js` `dispatchModelOf` (Drift 13 Nov) | Settled, piece 3 |
| 20 | `run-closeout-state.js` `closeOutSetsDone` / passenger (Drift 13 Nov) | Settled, piece 1, scope per R1 |

Result: 12 settled, 8 that say why not and whose decision they wait on. Lessons stays under the cap. Pieces 3 and 1 trim the stale clauses, and only one new Lesson is added (the passenger precedence, about 300 bytes). The 4,259 bytes at HEAD stay around 4.3 KB.

### Area notes that bound this design

- `runs-and-dispatch.md` Lesson "Close-out readiness has five lanes… a readiness rule goes in `closeOutWaitsOn` … shared-trail table" (LIN-4438). Piece 1 keeps this and extends it: the decision, not only the wait, has the one home, and there are six lanes counting `run-evidence`'s `deriveState`.
- `runs-and-dispatch.md` Lesson "A test that dispatches a close-out passes a `closeOut` seam" (LIN-4438). Piece 1's new person-path tests use it.
- `runs-and-dispatch.md` Lesson "A per-dispatch figure … is the fold's answer" (Drift 13 Nov). This is piece 3's rule.
- `runs-and-dispatch.md` Lesson "A full PR URL's repository and number come from `prOf` beside `prUrlsIn`" (LIN-4439). Piece 2 reads PRs only through these.
- `runs-and-dispatch.md` Lesson "Any session can park `[pending]` … read the lineage" (LIN-4373). This is piece 4's live test.
- `llm-and-prompts.md` Waiting `recommendation-live-wait.js` is a Runs rule (Seams 13 Nov) and `prompts/blind-read-words.js` kind literals / `COMPLETED` redeclared (Drift 13 Nov). Pieces 4 and 1 touch these with A14.
- `llm-and-prompts.md` Waiting `openrouter.js` code routes listed by hand in about nine places (Drift 13 Nov). This is context only and stays A14's. Piece 4 does not add a tenth copy.
- `README.md`: "Waiting entries are context, not scope, unless the size of the move takes them on". Here the size does, which is why all 20 are addressed.

### What would change my mind

- If John rules that the passenger rule covers **only** a person marking Done, and not a merge made outside Harbour, piece 1 keeps the guard's "merged but no read → refuse Harbour's close-out" path as a named precedence row. The single-decision shape stands either way. Only one row of the table moves.
- If A14 will not take the classifier into a Runs file, piece 2 leaves `commentKindOf` in `recommendation-facts.js` and Runs imports it. That is a worse fit for ownership but still one home. I would not ship two classifiers.
- If piece 0's control read moves as much as ours, B has not shown it reads better. In that case I would stop after piece 2 and re-survey before 4–7.
- If grounding piece 1 shows the renderers depend on the box's internal branches, beyond `status`, `reason` and `setDone`, I would split piece 1 in two: the decision plus the guard and route first, then the box.

### Rulings for John

Cuts: **none.** Every clause of `## As asked` is delivered. The eight why-not entries are what As asked allows ("or each says why it can't be yet"). Two rulings are John's (product scope and authority), and each comes with a recommendation:

- **R1. Passenger scope.** Does "Harbour is a passenger" cover (a) a person marking the ticket Done **and** (b) a merge made outside Harbour, so that in both cases no blind read is routed and Harbour's gate stands aside for that landing? **Recommendation: yes, both.** Your words were "unlikely to be exclusively changed via Harbour", and an outside merge is the commonest such change. Harbour's gate would then bind only Harbour's own close-out, plus an audit notes PR opened after Done. Piece 1 waits on this. Pieces 0, 2, 3 and 4 do not.
- **R2. May this task change simple-dispatcher?** Waiting 1, 6, 7 and 13 are copies there (`sessionPrs`, `columnProblems`, the contract row, the transcript fold), and 10 asks about stored history. **Recommendation: not in this task.** Keep LinearViewer's side single, and open one follow-up ticket for a cross-repo contract in which `contract.json` carries the row-shape and PR-pick rules as data that both sides interpret (`CONTRACT_SHA256` then pins the rule, not only its bytes). Until then the five entries stay, each saying it waits on that ticket. For entry 10: keep stored paragraphs and mark them pre-cutover.


### Comment 2026-11-13T13:37:13.041Z

## Unblock: LIN-4447 @ 4b5001ddf

**Status: not blocked.** One piece waits on John and two wait on a reply from LIN-4448. The other five can start now. `origin/main` is still 4b5001ddf, and no commits have landed since the ticket was filed, so the design still matches the code.

**What I checked.** Nothing blocks this ticket in Linear. There are no `blocks`/`blocked-by` relations, only two open rulings on it, and LIN-4448 hasn't replied about the seam.

**Root cause of the stall.** The whole ticket was parked behind R1, but R1 holds up only piece 1. Here is what each piece waits on at HEAD:

| Piece | Waits on |
|---|---|
| 0 baseline reads | nothing |
| 1 close-out decision | R1 (John) |
| 2 one trail pass | LIN-4448 agreeing the classifier's home. One classifier ships either way (the fallback is Runs importing it) |
| 3 model attribution | nothing |
| 4 live-stage wait | LIN-4448 agreeing the move |
| 5, 6, 7 | nothing |

**What I cleared**
- **R1** (`lin4447-r1-passenger-scope`): I recorded a suggested answer, **both**. John's standing words settle it: "if I choose to do something, Harbour is a passenger … unlikely to be exclusively changed via Harbour". A merge outside Harbour is a person choosing to act. Only John can press it. Piece 1 can be built now on that answer, but its PR shouldn't merge until he answers. If he answers done-only, only one precedence row changes ("merged but unread → refuse Harbour's close-out").
- **LIN-4448 (A14):** I posted the three seam moves (classifier home, live-wait move, `blindReadStep` reading the decision), each with its fallback, and asked for agreement on this ticket. I recorded `related` LIN-4448. A sibling's reply isn't a human hand-back.

**A correction to the design.** The design's R2 ("not in this task, open a follow-up ticket") contradicts the ruling already open, `lin4447-sd-scope`. That ruling says that if it goes unanswered, simple-dispatcher stays in scope, and a standing suggestion proposes answering in-scope. Moving Waiting 1, 6, 7 and 13 to another ticket while the design says "Cuts: none" is itself a cut of "the copies are gone". I'm not raising it again, because `lin4447-sd-scope` already covers it. Until John says otherwise, the simple-dispatcher halves stay in scope as later pieces, after 1–7. For each rule that has to exist on both sides of the wire, one owner plus a check that fails on drift counts as one home. Waiting **10** (pre-cutover paragraphs) is not a ruling: keeping stored history as written retires nothing, so it's an engineering call. Settle it by writing that answer into the entry: stored paragraphs are kept and marked pre-cutover, and history is never recomputed.

**Notes for piece 0.**
- The proxy holds any comment headed `## Blind read` to the PR blind-read shape: it needs a `Verdict:` line and the landing's PR URLs, or it returns 422. Head the area reads `## Area read`.
- The area is about 2.3 MB across 117 files, and the control `front-end-pages` is about 1.1 MB across 92. The rubric therefore needs a fixed sampling rule, written down with it and reused for the after-read.

**Options**
1. **Start the five open pieces now** (0, then 3/5/6/7). Piece 2 starts on LIN-4448's reply, and piece 1 is built but held unmerged until R1 is answered. *Recommended.* It costs nothing extra, because the pieces are independent.
2. Wait for both rulings and LIN-4448. Cost: the whole area sits idle for decisions that touch one piece. The §3.0a gap (blind reads offered over PRs no review covered) stays live, and the 20 Waiting entries keep growing.
3. Build piece 1 first on the suggested answer. Merging it before John answers would get ahead of his call, so this isn't recommended.

**Cost of doing nothing:** no area work lands, LIN-4448 stalls on the same seam, and the readability baseline (piece 0) still isn't taken, which holds up every later merge.

**Next action:** dispatch the build for piece 0 (paired area reads plus the rubric doc), then piece 3, then pieces 5–7. There's no new `DECISION:` and no BLOCKED.


### Comment 2026-11-13T13:46:36.011Z

### Plan Review Verdict

**Verdict:** Request Changes. Piece 1's one decision needs inputs (the ticket's state, whether the landing is merged) that two to four of its six surfaces don't hold today, and the plan doesn't say where each surface gets them or what the decision answers when one is unknown.

Blocking findings: 1

**How the plan meets what was asked.** All three Done-when clauses are delivered with no narrowing: "the cases above are settled" by pieces 1 to 4; "the area's Waiting entries are settled or say why not" by the 20-entry map (12 settled by pieces 1 to 7, 4 by piece 8, 4 with a reason and an owner); "reads better … by more than an untouched area" by piece 0 and its repeat. The R1 merge hold on piece 1 holds work back, it drops nothing. Piece 8 keeps simple-dispatcher in scope, which matches the open `lin4447-sd-scope` ruling.

**What I checked.** I read at `origin/main` 4b5001ddf. Nothing has landed since the ticket was filed. I read `lib/run-closeout-state.js`, `lib/close-out-readiness.js`, `lib/recommendation-blind-read.js`, `lib/run-evidence.js`, `routes/workspace-api-run-evidence.js`, `lib/close-out-merges.js`, `lib/task-timeline.js` / `lib/cost-read.js`, `lib/recent-runs.js`, `lib/recommendation-live-wait.js`, `lib/dispatch-factory.js:925-934`, `docs/areas/areas.json`, and rows 174/183/192-198 of `lin-4438-blind-read-gate.test.js`. I also ran the plan's reconciliation grep. The cause the plan names is the real one: every surface re-derives readiness from raw comments. Pieces 3, 6 and 7 hold as written:
- `dispatchesOf` runs `foldRequestUsage(owned)` per dispatch but drops its `last`.
- The `provider.name === 'linear'` comment says what the plan says it does.
- `cost-read)\.js$` doesn't match `cost-read-calls.js`.

LIN-4448 hasn't replied to the seam request yet. The plan already handles that.

---

#### Blocking

**B1. `closeOutDecision`'s inputs aren't available on every surface that has to call it, and the plan doesn't say what happens when one is missing.**

`followsPerson` has two conditions: (a) the landing is already merged, and (b) the ticket is Done with no Harbour close-out after review. The signature is `closeOutDecision({ trail, prStatuses, stopAt, runnerReady, actor })`. Here is what each surface holds at HEAD:

| Surface | Ticket state (needed for b) | PR statuses (needed for a) |
|---|---|---|
| `blindReadStep` (`lib/recommendation-blind-read.js:57`) | yes (`issue.state.type`) | **no**: it's on the recommendation path and makes no GitHub read |
| ladder guard lane (`ladderNotReady`, `close-out-readiness.js:128`) | **no** | **no**: by design, "one comment read and no PR read" |
| stop-at-PR guard lane (`closeOutNotReady`) | **no** | yes |
| check route (`workspace-api-run-evidence.js:260`) | **no** | yes |
| box (`buildRunEvidence`, `run-evidence.js:178`) | `issue` is optional | one PR only (P2's cost bound); multi-PR is left unread |
| `run-evidence` state | same as the box | same as the box |

Ticket state isn't in the signature at all, so condition (b) can't be computed from the declared inputs.

Here is how the surfaces would split, built as written, under R1 = "both": a person merges outside Harbour and the ticket stays In Progress.
- The stop-at-PR guard and the route read the PR, see it merged, and stand aside.
- The ladder guard reads no PR, so it still refuses Harbour's close-out with `blind-read-missing`.
- `blindReadStep` reads no PR, so it still routes a read.

That is the Drift case this task exists to remove, rebuilt inside the new shape. Each surface would call the same function but pass it different facts. The agreement table would show this, but only after the build, and the fixes available then each change what the plan decides:
- add GitHub reads to the recommendation path and the ladder lane (cost, the PR-read budget in `lib/pr-state-store.js`, token resolution on the recommend path);
- add a provider issue read to the guard lanes and the route;
- or define an "unknown" answer, which picks which way a safety gate fails.

These are decisions, not details for the builder to settle.

**What to change in the plan (small):**
1. Add the ticket's state to the inputs (e.g. `ticketState`). For each of the six surfaces, name where it comes from. The guard lanes and the route need one provider issue read, or the issue passed in by the caller.
2. For the merged condition, name its source on each surface, and write the decision's answer when the source isn't there (`prStatuses` absent or unreadable) as a precedence row. My recommendation: the merged condition comes from a PR read where the surface already makes one. Absent or unreadable means "not known merged", so the gate holds. That fails toward review, the same direction piece 2 chose. If the plan wants the no-PR-read surfaces to see outside merges too, it can read the merge events `recordMergedPrs` already writes to `closeOutEventsStore`, not add GitHub reads. Either way, say which.
3. Add a column to the agreement table for "PR statuses unknown" (and "ticket state unknown", if any surface can lack it), so every surface's own input shape is tested, not only the full-information one.

If R1 comes back "Done only", condition (a) goes away and step 2 shrinks to nothing. Step 1 is still needed.

---

#### Notes for the builder (not blocking)

1. **Keep the fourth Done bound explicit.** The Constraints list three bounds that passenger precedence must not loosen. `closeOutSetsDone`'s fourth bound (`run-closeout-state.js:453`, "the person's own check, never a worker token") becomes `actor`. The Design's wording "setDone follows R1's other three bounds" can be read as dropping it when `followsPerson` holds. Add a witness: `actor: 'harbour'` + merged + approved + no other unmerged PR gives `setDone: false`. Also note that today the guard (`close-out-readiness.js:158`) and `close-out-merges.js:151` both pass `byPersonCheck: true`, so those callers must map to `actor: 'harbour'` on purpose, not by copying the old flag.
2. **Retiring `deriveState` (`run-evidence.js:59`) has to keep the PR-picker fields.** `state.pr` and `state.prUrls` are read by `resolveRunPrRef` (`lib/pr-state-store.js:108`), `buildNow`, `render-task-page.js:451/569` and `task-page-loader.js:841`. Its `status` vocabulary also differs from the box's: `ready` means an open PR, not ready for close-out, and `unknown`/`pr-not-open` vs `closed`. Retire the status decision and keep the picked-PR fields. Check every reader of `evidence.state.status` before mapping it.
3. **Piece 2 and the box's one PR read.** `buildRunEvidence` passes `prStatuses: prStatus ? [prStatus] : …`, index-aligned with the cited URLs. Once the box reads `landing`, re-align that read (and `resolveRunPrRef`'s one-URL rule, if it should follow the landing) so the status lines up with the right PR.
4. **Reconciliation grep: hits the plan doesn't list.** Classify each one: `lib/as-asked.js:46/222/245` (comments naming `assembleTrailFacts`), `lib/prompt-contract.js:14` (a doc table naming `extractPrUrls`), `scripts/eval/lin-3372-selector-context/harness.mjs:141` (an `assembleTrailFacts` consumer), `scripts/eval/fixtures/recommend/next-stage-choice.json` (9 hits) and `scripts/prompt-template-change-log.md`. The close-out press route (`workspace-api-run-evidence.js:350`) is a seventh caller of the guard, so include it in the agreement table.
5. **Piece 4 names.** `recommendation-live-wait.js` exports `STAGE_IN_FLIGHT_CODE` (not `STAGE_IN_FLIGHT`) and `newestLiveRun` as well as `liveWaitOf`/`liveWaitRefusal`. Move all four, and key the census on the real names. `runFact(r, aborted)` (`recent-runs.js:66`) sees one row at a time, so reading the lineage's terminal needs the lineage rows passed to it. The plan already leaves that for the builder to confirm.
6. **Piece 1 row 196.** The test at `lin-4438-blind-read-gate.test.js:192-198` asserts both halves: Done with no close-out → `blind-read`, and Done with a close-out → `null`. Only the first flips. Keep the second, and add the audit-notes-PR-after-Done case beside it.

**Next step:** back to `plan` to settle B1. Everything else stands. Pieces 0, 3, 5, 6 and 7 don't depend on B1, and once B1 is answered in the plan they can go ahead.


### Comment 2026-11-13T13:53:21.272Z

### Plan revision: B1 settled

Revised the Implementation Plan in the description (same HEAD `4b5001ddf`, nothing landed since filing).

**B1, fixed.** Enforcement answers (`waitsOn`, `refuses`, `setDone`, box status) use only the trail and PR statuses, keyed by URL. The gate stands aside only when every landing PR has a readable merged status; a missing, unreadable or unmerged one means "not known merged" and the gate holds. Ticket state is an optional input used only by the advice answer (`routesRead`), which only `blindReadStep` asks, and it already holds the issue. So no guard lane, route or box gains a provider read, and nothing gains a GitHub read. The per-surface table, the unknown-fact precedence, the press route as a seventh caller, and an agreement table that runs each surface in its own input shape are all in piece 1. Reviewer's recommendation taken (unknown means hold); the merge-events alternative was set aside because those events exist only for merges Harbour observed.

**Builder notes 1 to 6** are folded in (fourth Done bound as `actor` with a witness; `deriveState` keeps `pr`/`prUrls`; box read realigned to the landing; grep hits classified; piece 4 real names; row 196 second half kept).

**One cut raised:** the recommend path and ladder lane do not follow an outside merge on a ticket still In Progress (no PR read there). Ruling below, holds only piece 1's merge.

plan-review due: yes

### Comment 2026-11-13T13:57:37.874Z

### Plan Review Verdict

**Verdict:** Approve. B1 is answered and the answer holds: enforcement now reads only facts each surface already has (the trail plus URL-keyed PR statuses), unknown means "not known merged, the gate holds", and ticket state feeds only the advice that `blindReadStep` gives, using the issue it already holds. The notes below are for the builder. The first one corrects the wording of the ruling put to John.

**How the plan meets what was asked:**
- "the cases above are settled": pieces 1 to 4.
- "the area's Waiting entries are settled or say why not": all 20 are mapped. Twelve are settled by pieces 1 to 7, four by piece 8, and four stay with a reason and an owner.
- "reads better … by more than an untouched area": piece 0 and its repeat.

There is one narrowing, and it is **not yet agreed**. "When a person acts, Harbour follows" is not followed for an outside merge while the ticket is still In Progress, on the two surfaces that make no PR read. The plan raises this as a ruling and holds piece 1's merge on it, which is the right handling. Only John's answer accepts the narrowing. simple-dispatcher stays in scope as piece 8, matching `lin4447-sd-scope`.

**What I checked.** I read `origin/main` 4b5001ddf. Nothing has landed since the ticket was filed. Files read: `lib/close-out-readiness.js`, `lib/run-closeout-state.js`, `lib/run-evidence.js` (`deriveState`, `buildRunEvidence`, `readRunEvidence`), `lib/recommendation-blind-read.js`, `routes/workspace-api-run-evidence.js` (check route and press route), `lib/close-out-merges.js:120-185`, `lib/run-ledger.js` (`landingPrUrls`, `readGateTrail`), `lib/recent-runs.js:55-110` and `lib/dispatch-factory.js:925-934`.

The plan's per-surface table is accurate at HEAD:
- The check route and the stop-at lane read every cited PR through `readCloseOutChain`. The stop-at lane uses a fresh Map.
- The ladder reads one comment set and no PR.
- The box reads a PR only when exactly one is cited.
- `blindReadStep` holds `issue.state.type` and makes no GitHub read.
- `close-out-merges.js` passes `byPersonCheck: true` only to reuse the read chain.

The named Drift case is settled, built as written. A person's check on a merged, approved, unread landing sets Done. The stop-at lane stands aside because every landing PR reads merged. `blindReadStep` routes no read because the ticket is completed with no close-out on the landing. The guard keeps refusing Harbour's own close-out of an unmerged landing even when the ticket is Done, because enforcement ignores ticket state. That keeps the safeguard. Pieces 3, 6 and 7 hold as last time. Piece 6's capability approach matches the comment at `dispatch-factory.js:925-934`.

---

#### Notes for the builder (none blocking)

1. **Correct the ruling text about the ladder before John answers.** The ruling and the R1 paragraph say "the recommend path and the ladder lane follow a person's Done but not an outside merge". Built as written, the ladder gets no `ticketState` (see the table) and enforcement never reads ticket state. So the ladder follows **neither** a Done nor an outside merge. It keeps refusing Harbour's own close-out until a read is on record, which is the same enforcement rule every surface follows. Only the recommend path follows a person's Done. The behaviour is right and the plan already argues for it ("a Done ticket beside an open, unread landing must still refuse Harbour's merge"). Only the sentence put to John is wrong. Rewrite it as: "the recommend path follows a person's Done; neither the recommend path nor the ladder follows an outside merge on a ticket still In Progress; the ladder, like every guard, never reads ticket state." Then John accepts what will actually be built. This also settles the brief's open question "Ladder Done behaviour is contradictory": the table is right and the prose is wrong.

2. **Narrow the property "dropping a fact never loosens enforcement" so it stays true under today's fail-open guard.** At HEAD, a readable open PR whose head moved is refused (`head-moved`). The same PR unreadable is admitted, because `pr-unreadable` is not in `REFUSED_REASONS` and the guard "never throws: every unreadable read admits". The constraints keep both protections. Written over every enforcement answer, the property fails on that row, and the only ways to make it pass are to change the fail-open policy or drop the property. State it as the passenger guarantee it is meant to be: removing a PR status, or making it unreadable, never moves `followsPerson` from null to `'merged'`, and never turns `waitsOn: 'blind-read'` into null. `head-moved` stays a refusal that needs a readable PR, and an unreadable PR keeps admitting once a read is on record, as today.

3. **Say which set "no other unmerged PR" is checked over.** Today `closeOutSetsDone` checks it over every cited PR (`readCloseOutChain` → `extractPrUrls`). An abandoned earlier-round PR that is closed but not merged therefore blocks the person's Done. With statuses keyed by URL and the box counting the landing after piece 2, it would be easy to check over the landing only. That relaxes one of the bounds on the Done write. Either keep it over every PR the check route read, or make the landing-only rule a named change with its own witness: a landing [B] merged, an earlier cited A closed, and the Done result written in the test.

4. **`readGateTrail` does not return `closeOutAfterReview` or `workAfterReview` today.** It returns `{ ledger, landingPrs }` (`lib/run-ledger.js:724-728`). Those two fields come from `assembleTrailFacts`. Because piece 1 lands after piece 2, `readTrail` can supply them. Keep enforcement on review, landing and statuses only, so the guard lanes do not begin refusing on `workAfterReview`, which they do not read today. The advice answer can read it as `blindReadStep` does now.

5. **Piece 4: hand `runFact` the lineage before it is filtered.** `loadRecentRuns` / `stageRuns` drop wake, abort, custom and autopilot rows and window history at `HISTORY_ROWS` before `runFact` sees anything. A `[pending]` stage's terminal `[blocked]` or `[skipped]` can sit on a follow-up or held-wake row that has already been dropped. Resolve the terminal from the unfiltered rows, using the existing `resolveFollowUpRoot`/`heldWakeHolderOf` helpers in `lib/dispatch-store.js` and `lib/dispatch-leftover-hook.js`. Add a witness where the terminal sits on such a row, not only on the stage row.

6. **Smaller items:**
   - In witness 4, "an unreadable PR holds the gate" means the blind-read gate still applies. It does not mean that unreadable refuses on its own. Assert it that way, in line with note 2.
   - The press route's `CLOSE_OUT_ALREADY_MERGED` check (`closeOutEventsStore.hasMergedEvent`) runs before the guard. Keep it ahead of the decision.

**Next step:** move to `implementation` in the plan's landing order: 0, then 3/5/6/7, then 2 and 4 after asking LIN-4448 again, then piece 1, built but held unmerged until R1 and the narrowing ruling are answered (with note 1's corrected wording), then 8, then repeat 0.


### Comment 2026-11-13T14:02:31.309Z

## Breakdown: LIN-4447 @ 4b5001ddf

I split the approved plan (Plan Review Verdict **Approve**, comment 12619798, rev 2) into 10 subtasks, one per piece. The piece-0 repeat is its own subtask. Each subtask carries its own slice of the plan: files, approach, witnesses, a session-fit line, the plan-review line and the grounding SHA.

**Staleness check:** I fetched `origin/main` and it is still 4b5001ddf. `git log 4b5001ddf..origin/main` is empty, and nothing under `lib`, `routes`, `tests`, `scripts` or `docs/areas` has changed since the ticket was filed. Spot checks still hold: `dispatch-factory.js:948` still keys on `provider.name === 'linear'`, `dispatchModelOf` is at `task-timeline.js:54`, and `dispatch-store.js` is 4,530 lines. So the plan didn't need re-planning.

| Order | Subtask | Piece | Blocked by | Session fit (from the plan) |
|---|---|---|---|---|
| 1 | LIN-4453 | 0: paired area reads, before | — | one session. A measurement plus a committed rubric; gates every merge. |
| 2 | LIN-4454 | 3: model attribution | 4453 | one session (small). May share a session with 6 and 7, but each gets its own PR. |
| 2 | LIN-4455 | 5: constants and `FEEDBACK_KINDS` | 4453 | one session (medium) |
| 2 | LIN-4456 | 6: test transport capability | 4453 | one session (small) |
| 2 | LIN-4457 | 7: `lib/cost-read-calls.js` | 4453 | one session (small) |
| 3 | LIN-4458 | 2: one trail pass and classifier | 4454–4457 | one session (larger). Ask LIN-4448 first. |
| 3 | LIN-4459 | 4: `lib/run-live-wait.js` and lineage terminal | 4454–4457 | one session (medium). Ask LIN-4448 first. |
| 4 | LIN-4460 | 1: one close-out decision | 4458, 4459 | one session (larger). **PR held unmerged for John.** |
| 5 | LIN-4461 | 8: simple-dispatcher contract | 4460 | Left to a fresh `plan` pass at its start, because the plan deferred its detail to simple-dispatcher's HEAD at that time. |
| 6 | LIN-4462 | 0 repeated: area reads, after | 4461 | one session (measurement) |

**Relation choices, with reasons:**
- The graph follows the plan's landing order, 0 → 3/5/6/7 → 2/4 → 1 → 8 → 0, literally.
- 2 and 4 wait on all of 3/5/6/7. The plan orders them that way, and the work overlaps: 4's lineage helpers live in `dispatch-store.js`, which 5 edits.
- 1 waits on both 2 and 4. It consumes `readTrail`, and `blindReadStep` imports the live-wait module that 4 moves.
- 8 waits on 1, which covers 1–7 transitively.

**Waiting accounting is unchanged from the plan:**
- 2, 4, 11 → LIN-4455
- 8 → LIN-4456
- 9 → LIN-4457
- 19 → LIN-4454
- 14 → LIN-4459
- 15 (stays as a why-not) and 16 → LIN-4458
- 17, 18, 20 → LIN-4460
- 1, 6, 7, 13 and 10 → LIN-4461
- 3, 5 and 12 stay, each with its why.

**Rulings: no new ones.** The three this plan rests on are already open, and nothing here cuts further:
- `lin4447-r1-passenger-scope`: holds only LIN-4460's merge.
- `lin4447-recommend-path-outside-merge`: the one cut. It quotes "When a person acts, Harbour follows, and that rule is written once." and also holds only LIN-4460's merge. **Its posted wording is inaccurate** (reviewer note 1): built as planned, the ladder follows neither a person's Done nor an outside merge. The accurate statement: "the recommend path follows a person's Done; neither the recommend path nor the ladder follows an outside merge on a ticket still In Progress; the ladder, like every guard, never reads ticket state." I've put that correction into LIN-4460's description, so it's settled before John answers.
- `lin4447-sd-scope`: unanswered means in scope, which is LIN-4461.

**Next:** dispatch LIN-4453 (piece 0). No implementation PR merges until its two `## Area read` reports and the rubric are on this ticket.


### Comment 2026-11-13T14:19:13.877Z

## Piece 0 kit (LIN-4453): course corrections @ 4b5001ddf

The kit is committed on `feat/lin-4453-area-read-baseline` (commit `4a21feb1d`, not pushed). No readers have run. Files: `docs/plans/survey/area-read.md@cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` and `docs/plans/survey/area-read-reader-prompt.md@ef1c2ca9173831f53ca32b60da1d805d27bf2159`.

Where the plan or the ticket was off, or needed a choice:

1. **Count basis.** Under the code scope (`.js`, `.mjs`, `.cjs`, no tests), first match gives Runs 115 files, 2,261,263 bytes. The ticket's 116 adds `lib/runner-kit/contract.json`, which is JSON. Front-end-pages is 92 files, 1,125,225 bytes, as the plan says.
2. **Sample.** A stable SHA-256 hash of the path, N = 14 per area. Of the counts tried (13 to 16), 14 gives the closest byte totals: 199,552 bytes for Runs and 206,530 for the control.
3. **Overlap with planned work is 1 of 13.** The Runs sample holds `lib/cost-read.js` and none of the other twelve planned files. Chance predicts about 1.6. The plan forbids a planned-files stratum for Runs, so the rule stays. Consequence: piece 0 measures the area at large. A Runs read that does not move cannot show the planned work is missing. The kit states this as a limit.
4. **Location.** `docs/plans/survey/`, the survey precedent the ticket names, rather than `docs/area-reads/`. The reader prompt sits beside the kit.

**For John (a ruling, not an engineering call):** is the Done-when question, "reads better than the untouched control", acceptable as measured on the area at large, with the limit stated? Recommendation: yes. The other option is a separate, unpaired read of the planned files, reported under a different name.


### Comment 2026-11-13T14:22:34.517Z

## Piece 0: overlap with planned work settled as an engineering call (LIN-4453)

The sample overlap limit in the kit (1 of 13 planned Runs files is sampled: `lib/cost-read.js`) is settled as an engineering call, not a ruling for John. The approved plan forbids a planned-files stratum for Runs, because the control has no plan. The literal ask is "reads better … than an untouched area read at the same times", measured on the area at large, so the sampling rule stays unchanged.

The limit stays stated in the kit (`docs/plans/survey/area-read.md@cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26`, Known limits 1), and the after-read reports it. An unpaired read of the planned files is not part of piece 0.


### Comment 2026-11-13T14:24:09.107Z

## Area read: Runs & dispatch @ 4b5001ddf

**Role:** Runs & dispatch (the area the work changes). Piece 0 baseline, LIN-4453 beat 2. Read in one window with the frozen kit; the kit was not changed.

**Recorded fields**
- Base commit: `4b5001ddfa185eed683ccb8b9805d493c8c380da` (`origin/main`, short `4b5001ddf`)
- `docs/areas/areas.json` blob: `d13fca20e50c37e859e82fbc820177acefd4e48d`
- Kit `docs/plans/survey/area-read.md` blob: `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` (committed `4a21feb1d`)
- Reader prompt `docs/plans/survey/area-read-reader-prompt.md` blob: `ef1c2ca9173831f53ca32b60da1d805d27bf2159`
- N = 14 per area, by the stable SHA-256 path-hash rule in the kit. The snippet reproduces this list at the base commit.
- Date: 2026-11-13
- Note: `docs/areas/runs-and-dispatch.md`, blob `38107133294770e483990523910916b8ce1c24ee`, 11,540 bytes.

**Sample (exact file list, at the base commit)**

| Bytes | Path |
| --: | -- |
| 21,859 | `lib/observation-sessions-materializer.js` |
| 3,060 | `lib/consumer-heartbeat-store.js` |
| 20,397 | `lib/observation-sessions-store.js` |
| 1,681 | `routes/runner-kit.js` |
| 1,550 | `lib/request-usage-vocabulary.js` |
| 15,711 | `lib/transcript-spend.js` |
| 7,990 | `lib/wake-shadow.js` |
| 10,879 | `lib/agent-status-store.js` |
| 30,554 | `lib/digest-feedback.js` |
| 8,605 | `lib/session-summary.js` |
| 5,048 | `lib/queue-config.js` |
| 14,165 | `lib/request-usage-store.js` |
| 45,915 | `lib/cost-read.js` |
| 12,138 | `lib/wall-clock-summary.js` |

Sample total: 14 files, 199,552 bytes.

**Reader passes** (two independent fresh agents; each output below is verbatim)

Pass A (agent `ab63d09601c3cc56f`):

```
Code
- K1: 4. File names and headers match their behaviour (`lib/request-usage-store.js`, `lib/wake-shadow.js`, `lib/cost-read.js`), and the headers name the module that decides each rule, though many homes the note cites are not in the bundle.
- K2: 3. Some rules have a clear home (`lib/cost-read.js` says it restates nothing and names the composed modules), but the CI/verify signature is redeclared in `lib/transcript-spend.js` and `lib/wall-clock-summary.js`, and the decision-stamp kinds are inlined again in `lib/wall-clock-summary.js`.
- K3: 3. Most functions read cleanly in place, but `lineageUsageOf` and `combineFolds` depend on fold result shapes from `lib/row-usage.js` and `lib/request-usage-fold.js`, which are not in the bundle.
- K4: 3. Names are mostly precise, but one concept goes by several names (`anchor`, `rootItemId`, `lineage`, `sessionGroupId`), and "session" means an autopilot run in `lib/session-summary.js` but a lineage in `lib/cost-read.js`.
- Code mean: 3.3

Note
- M1: 4. Most lessons say what to do and why (archive through `_archiveItem`, claim before compare-and-set, compare repositories case-blind), though a few are descriptions of a defect rather than a rule to follow.
- M2: 3. Most waiting entries name the file and the open question, but several give no reason for deferral (`lib/dispatch-factory.js` test seam, `lib/session-summary.js` open question), and some are long enough to hide the actual item.
- Note mean: 3.5

Where I could not tell: Many files the note cites are not in the bundle, including `lib/dispatch-store.js` (wake and archive paths), `lib/dispatch-wake.js`, `lib/dispatch-fields.js`, `lib/run-closeout-state.js`, `lib/close-out-readiness.js`, `lib/row-usage.js` and `lib/request-usage-fold.js`, so I could not check the wake, close-out or PR-selection rules themselves. The bundle also holds files that look outside this area (`lib/queue-config.js`, `lib/consumer-heartbeat-store.js`, the observation-sessions files), so I could not confirm membership. I could not check the tests the note names or the history behind the LIN references.
```

Pass B (agent `a1ef9b9220c6c912b`):

```
Code
- K1: 4. File names and module headers name their jobs (lib/cost-read.js, lib/wake-shadow.js), though close-out readiness is spread across several files the note names rather than one obvious home.
- K2: 2. Rules are restated across files: the note records a close-out precedence split between box and guard, and lib/wall-clock-summary.js inlines decision-stamp kinds that lib/digest-feedback.js already owns.
- K3: 3. Most functions read on their own, but the cost and digest paths (`sessionOf` in lib/cost-read.js, `applyHarvestedAbortToDigest` in lib/digest-feedback.js) depend on fold shapes and rules defined in other modules.
- K4: 3. Names are mostly precise (`isFreshDigest`, `oneRecordPerRequest`), but one concept goes by several names (anchor, rootItemId, lineage anchor, sessionGroupId) and comments run as ticket changelogs, as in lib/observation-sessions-store.js.
- Code mean: 3.0

Note
- M1: 3. Most lessons give a clear action and a reason, but several are findings or open defects rather than rules, and some give a ticket number where the reason belongs (for example the guard-order lesson on the wake pair).
- M2: 3. Each entry names its file and what is waiting, but few say why it is not scheduled, and some are open questions with no stated cost of waiting (for example the stored run paragraphs entry).
- Note mean: 3.0

Where I could not tell: the files the note names but that are not in the bundle, including lib/dispatch-store.js, lib/close-out-readiness.js, lib/run-closeout-state.js, lib/dispatch-wake.js and lib/task-timeline.js, so I could not check the stated precedence, the `dispatchModelOf` rule or the census pins. Also the review documents, the README.md format rules, and whether the ticketed items are still open.
```

**Combined baseline (no after-read yet; no Runs-minus-control difference computed here)**
- Code means: pass A 3.3, pass B 3.0; combined 3.15.
- Note means: pass A 3.5, pass B 3.0; combined 3.25.
- Noise guard (code means differ by 1.0 or more): |A − B| = 0.3, so the guard did not fire.
- Code movement and note movement are reported separately; this baseline has neither.

**Limits carried from the kit:** the sample holds 1 of the 13 planned Runs files (`lib/cost-read.js`); the read measures the area at large. Readers had the note and the 14 files only, supplied as one bundle file with the note first and each file headed by its path. Readers had general tool access, so their use of tools was not restricted by configuration; see the beat report for what was checked.


### Comment 2026-11-13T14:24:09.472Z

## Area read: Front end: server-rendered pages @ 4b5001ddf

**Role:** control (untouched by the work). Piece 0 baseline, LIN-4453 beat 2. Read in one window with the frozen kit; the kit was not changed.

**Recorded fields**
- Base commit: `4b5001ddfa185eed683ccb8b9805d493c8c380da` (`origin/main`, short `4b5001ddf`)
- `docs/areas/areas.json` blob: `d13fca20e50c37e859e82fbc820177acefd4e48d`
- Kit `docs/plans/survey/area-read.md` blob: `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` (committed `4a21feb1d`)
- Reader prompt `docs/plans/survey/area-read-reader-prompt.md` blob: `ef1c2ca9173831f53ca32b60da1d805d27bf2159`
- N = 14 per area, by the stable SHA-256 path-hash rule in the kit. The snippet reproduces this list at the base commit.
- Date: 2026-11-13
- Note: `docs/areas/front-end-pages.md`, blob `971d4bf6c505cfcde1885f3c0dd0c57a1b841d59`, 6,404 bytes.

**Sample (exact file list, at the base commit)**

| Bytes | Path |
| --: | -- |
| 30,098 | `lib/components/navbar.js` |
| 8,124 | `lib/render-swipe.js` |
| 2,949 | `lib/render-audit.js` |
| 29,757 | `lib/render-session.js` |
| 1,864 | `lib/settings-copy-first-card.js` |
| 8,628 | `lib/render-ship-journey.js` |
| 61,250 | `lib/render-task-page.js` |
| 18,375 | `lib/ship-journey.js` |
| 13,127 | `lib/render-collective.js` |
| 2,204 | `lib/components/settings-group.js` |
| 4,120 | `lib/render-passage-planner.js` |
| 12,982 | `lib/render-settings-you.js` |
| 6,881 | `lib/render-proxy.js` |
| 6,171 | `lib/render-custom-prompts.js` |

Sample total: 14 files, 206,530 bytes.

**Reader passes** (two independent fresh agents; each output below is verbatim)

Pass A (agent `a581ef74887791352`):

```
Code
- K1: 4. Page renderers are named for their page (`render-task-page.js`, `render-session.js`, `render-settings-you.js`) and file headers cross-reference the splits, though the Lessons point at modules outside this set (`task-timeline.js`, `render-settings.js`).
- K2: 3. The viewer gate and close-out wording each have one home, but the page-id list is restated in `lib/components/navbar.js`, and the decided-state-to-pill mapping is held twice in `lib/render-task-page.js` (`TASK_PAGE_PILL_FOR_STATE` and `PILL_FOR_TASK_STATE`).
- K3: 3. Most functions read cleanly in isolation, but the task-page renderers depend on model fields and state values (`waitingFor`, `unsettled`, close-out statuses) whose meaning is defined in loader and evidence modules not in the set (`lib/render-task-page.js`).
- K4: 3. Names and comments explain why at length, but the same concept shifts: session, run, loop, step and stage are used interchangeably across `lib/render-session.js` and `lib/render-task-page.js`, and comments are heavy with ticket references.
- Code mean: 3.3

Note
- M1: 4. Each lesson states the action (name every per-row control; route new page figures through `withoutSpend` and the guest test; give a new desktop section its own `grid-area`) and the consequence it prevents.
- M2: 2. Each entry names its file and what is waiting, but only three of the thirteen say why it is unscheduled (the session link and swipe viewport entries, and the styleguide entry noting that open tickets do not cover it), so the rest must be inferred.
- Note mean: 3.0

Where I could not tell: The note cites many files outside this set, including `lib/render-settings.js`, `lib/task-timeline.js`, `lib/render-task-timeline.js`, `lib/mask-secrets-in-html.js`, `lib/providers/jira/adf.js`, `lib/render-library.js`, `lib/render-styleguide.js`, `lib/render-runner-setup.js` and `public/task-page.css`, so I could not check the lessons' claims or the waiting entries against code. The three review documents it cites were not provided, and the README.md the note refers to for format rules is absent. Whether any waiting entry has since been ticketed or scheduled elsewhere is also unknown.
```

Pass B (agent `a29ecc88e5768defa`):

```
Code
- K1: 4. File names and header comments say what each renderer owns (for example `render-task-page.js`, `render-session.js`, `navbar.js`), so a behaviour is usually easy to locate. Cite lib/render-task-page.js, lib/components/navbar.js.
- K2: 3. Some rules have a single home, such as the owner/guest split in `renderOwnerControls` and the question gate in `renderTaskQuestion`, but the pill mapping is held twice in `render-task-page.js` (`TASK_PAGE_PILL_FOR_STATE` and `PILL_FOR_TASK_STATE`), and the note reports the tick rule restated in the timeline renderer. Cite lib/render-task-page.js, lib/render-task-timeline.js.
- K3: 4. Most functions, such as `renderStage`, `renderLineageGroup` and `renderSteps`, read on their own with a JSDoc or header comment, though several depend on state vocabularies defined in other files. Cite lib/render-session.js, lib/render-task-page.js.
- K4: 3. Comments explain the why well, but the same concept is called run, session, loop, attempt, step and stage across renderers, and many comments lean on LIN ticket numbers a reader outside the tracker cannot resolve. Cite lib/render-session.js, lib/render-task-page.js.
- Code mean: 3.5

Note
- M1: 4. Each lesson names the action and its reason (label each per-row control, route any new task-page figure through `withoutSpend`, give a new grid section its own `grid-area`), though the first two carry review dates and counts that dilute the instruction.
- M2: 2. Each waiting entry names its file and the problem, but most give no reason it is unscheduled (no ticket, deferred, out of scope), so a reader cannot tell whether it was left on purpose.
- Note mean: 3.0

Where I could not tell: lib/render-settings.js, lib/task-timeline.js, lib/task-page-loader.js, lib/question-card.js, and public/task-page.css were not in the inputs, so the note's claims about them and the `withoutSpend` strip could not be checked. The cited review documents and the named tests were also absent, so I could not tell whether any waiting entry has since been ticketed or why it was left unscheduled.
```

**Combined baseline (no after-read yet; no Runs-minus-control difference computed here)**
- Code means: pass A 3.3, pass B 3.5; combined 3.40.
- Note means: pass A 3.0, pass B 3.0; combined 3.00.
- Noise guard (code means differ by 1.0 or more): |A − B| = 0.2, so the guard did not fire.
- Code movement and note movement are reported separately; this baseline has neither.

**Limits carried from the kit:** the sample holds 1 of the 13 planned Runs files (`lib/cost-read.js`); the read measures the area at large. Readers had the note and the 14 files only, supplied as one bundle file with the note first and each file headed by its path. Readers had general tool access, so their use of tools was not restricted by configuration; see the beat report for what was checked.


### Comment 2026-11-13T15:09:59.247Z

## LIN-4457 (piece 7): expanded move and placement, recorded before implementation

**Move (expanded from two functions to three).** `appCallsOf` moves with `readCalls` and `callsSurfaceOf` into `lib/cost-read-calls.js`. `appCallsOf` is built on `readCalls`; moving only the two named functions would leave `cost-read.js` importing the calls figure back, splitting it across two files. The sizing amendment on LIN-4457 accepts this.

**Placement: Runs & dispatch, as the ticket asks, recorded as deliberate.** The registry gets an exact pattern `cost-read(?:-calls)?\.js$` (no `cost-read[^/]*`). Every consumer of the calls figure sits outside Runs (LLM & prompts, web routes, the proxy). The survey's Runs-vs-LLM question is open, and this move does not settle it. If John rules for LLM & prompts, that is a one-line registry change plus the note entry. Not blocking.

**Waiting 9 settled.** The calls readers are pure over one workspace's documents; callers key them with `listInHorizon(urlKey)`. The instance-wide boundary is the `urlKey` / `instanceWide` guard in `lineageRecords` and `readCost` (LIN-4226), which this change leaves as it is. The guard is written down in the area note.

**`EMPTY_APP_CALLS` is derived, not restated.** `readCost` uses `appCallsOf([])` from the new file. The value is the same literal shape, and `llm-call-log.test.js` still pins it. No re-export shim is left in `cost-read.js`.

**Retires:** the calls figure's place in `lib/cost-read.js`, its direct call-log import, and the restated empty-app-calls literal.

PR to follow on `feat/lin-4457-cost-read-calls-file`.


### Comment 2026-11-13T15:11:41.037Z

## Plan change: LIN-4456 (piece 6) declares `testTransport` on the provider, not at the installers

**Changed from the plan:** the plan says a provider declares `testTransport` where its transport is swapped (`routes/test.js` and `tests/fixtures/hermetic-linear.js`). The build declares it once, as a fixed property of `LinearProvider`, and the factory skips access on `provider.testTransport && isHermeticTestToken(token)`.

**Why:** both installers only call `setLinearFetchImpl` (`lib/linear-fetch.js`), a shared module-level hook. About 40 test files and 5 direct callers use it, including `tests/unit/dispatch-issue-access.test.js`. A flag set at install time would turn the "Linear with test-token makes no transport call" witness red, and any test with no installer would send `test-token` to the network again (the LIN-1880 leak). The decision is settled by the engineering call in comment 44b575a3.

**Also:** the factory's name check and its "this is not a capability" comment are retired by piece 6. The stale Linear-only prose in `lib/should-mock-ai.js` and `docs/architecture/source-map.md` changes in the same PR. Grounding stays at `origin/main` cfd152fa4 (docs-only since 4b5001ddf).

### Comment 2026-11-13T15:14:37.688Z

## Plan change: piece 5 (LIN-4455), re-read at cfd152fa4

The approved plan for piece 5 doesn't match the code in three places. I'm changing course on each, as the surveys on LIN-4455 suggested, and I re-checked all three myself:

1. **The `FEEDBACK_KINDS` table goes in a leaf module that imports nothing (`lib/dispatch-feedback-kinds.js`), not in `lib/dispatch-feedback-validation.js`.** Validation imports the store, and through `dispatch-validation.js` it reaches `session-telemetry.js` and `dispatch-terminal.js`. Both of those would then import the table back, so load order would decide whether they hit a TDZ error. Validation and the store import from the leaf, and the store keeps re-exporting `FEEDBACK_ENTRY_KINDS`.
2. **`findWakeEvent` gets no derived skip rule, because it has none today.** It returns the last marker of any kind (`lib/dispatch-terminal.js`). The table records its role as a column ("may carry a wake", true for every kind), and a test pins that. Adding a filter would change wake minting and every reader of stored rows.
3. **The release wording can't come only from `wakeHook.releaseNote`.** Cancel, expiry and the stopped-run cleanup all release through `_archiveItem` → `_releaseIfHeld`, which has no request and no hook. The wording is late-bound into the store, the way `setWakeCredentialProvisionerFactory` is, and an unbound store gets a stated default. The wakeHook/setter split that remains is Waiting 5, and the PR will name it.

**Scope found beyond the plan (still piece 5's "one owner for each kind set"):** the three decision-lifecycle stamp kinds are written out in four places, not one: `lib/session-telemetry.js`, `lib/wall-clock-summary.js`, `lib/run-view.js` (`DECISION_STAMP_KINDS`) and `lib/digest-feedback.js` (`isDecisionLifecycleStampEntry`). `NEVER_RAN` is spelled in five places (`lib/dispatch-leftover.js`, `lib/dispatch-store.js` twice, `lib/observer-sweep.js`, `lib/task-page-loader.js`), and its one home will be `lib/dispatch-fields.js`.

Characterization tests that pin today's behaviour landed first, on branch `feat/lin-4455-feedback-kinds-constants` (6b0f86eec).


### Comment 2026-11-13T15:33:37.554Z

Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up

— Ruling recorded via Harbour

### Comment 2026-11-13T15:33:38.870Z

Both: a person's Done and an outside merge

— Ruling recorded via Harbour

### Comment 2026-11-13T15:33:41.552Z

Yes, change both repos so the copies are gone

— Ruling recorded via Harbour

### Comment 2026-11-13T15:34:58.141Z

### Rulings recorded in the plan

John answered all three rulings on 13 Nov, and the Implementation Plan now records them:
- **R1** (`lin4447-r1-passenger-scope`): **both**. Piece 1 is built as planned.
- **`lin4447-sd-scope`**: **in scope**. simple-dispatcher is piece 8.
- **`lin4447-recommend-path-outside-merge`**: **accepted**. No new GitHub reads on the recommend path or the ladder lane. Add the fact later if a stuck case shows up. The cut is agreed.

Nothing in the plan waits on a ruling any more. I removed the R1 merge hold on piece 1. Landing order is unchanged: 0, then 3/5/6/7, then 2/4, then 1, then 8, then 0 again. Pieces 2 and 4 still open with one more ask to LIN-4448.

### Comment 2026-11-13T15:39:53.858Z

## Reply from LIN-4448 (LLM & prompts): agree to all three seam moves

Checked against main 2bf788b6d.

1. **One comment classifier in lib/run-trail.js: agree.** No fallback needed.
2. **Live-stage wait to lib/run-live-wait.js, old file deleted, no shim: agree.** Our CODE_ROUTES list (LIN-4448 piece 1) imports liveWaitOf from wherever it lives when it lands. Whichever of us lands second changes only the import path. The claim compare-and-set Waiting entry moves to your note unchanged.
3. **blindReadStep reads closeOutDecision().waitsOn/followsPerson: agree.** The file stays ours. LIN-4448 piece 2 leaves its COMPLETED redeclaration alone, so that retires with your piece 1.

Code-route ownership stays here: CODE_ROUTES is the one list and Runs adds no copy. The only edit LIN-4448 makes in a Runs file is the STAGE_LABELS literal in lib/run-view.js (piece 3, derived from the stage-kind record); rebase on that if your pieces touch it.

### Comment 2026-11-13T15:42:41.079Z

## Piece 5 (LIN-4455): PR open, one more change to the plan

PR: https://github.com/JKershaw/LinearViewer/pull/2427

This adds to comment 055a6035, which covered the leaf `FEEDBACK_KINDS` module, giving `findWakeEvent` a column rather than a filter, and binding the release wording late.

**`NEVER_RAN` lives in `lib/dispatch-terminal.js`.** The plan said to import it "from its owner", but no owner existed, and the survey suggested `lib/dispatch-fields.js`. `dispatch-terminal` already holds both statuses in `TERMINAL_HISTORY_STATUSES`, every consumer already imports it, and it imports only leaf modules. `dispatch-fields` imports `dispatch-wake`, which imports `dispatch-terminal`, so homing it there would have left the terminal set as a copy or created an import cycle.

**How the release wording is bound.** `createLeftoverStep` binds its own wording into the store when it is built (once, in server.js). The `_applyWakeHook` re-release uses `wakeHook.releaseNote`. An unbound store uses a default line that names no feature. The PR names Waiting 5 (one composable held-wake policy) as the follow-up this piece leaves.


### Comment 2026-11-13T15:55:15.496Z

## Correction from LIN-4448 (LLM & prompts): the full list of Runs files our pieces edit

This corrects our reply of 15:39 (comment 08c9c898). That reply said the only Runs file LIN-4448 edits is the `STAGE_LABELS` literal in `lib/run-view.js`. That was wrong. By first match in `docs/areas/areas.json`, these files are `runs-and-dispatch` too. Checked at main `5dcf5bcda`.

| LIN-4448 subtask | Runs files it edits | Collides with |
|---|---|---|
| LIN-4465 (piece 1, `CODE_ROUTES`) | comments in `lib/recent-runs.js` and `lib/dispatch-entrance.js` | **LIN-4459** (`recent-runs.js`) |
| LIN-4466 (piece 2, blind-read identifiers) | `lib/completion-signals.js`, `lib/run-closeout-state.js`, `lib/pipeline-churn.js`, `lib/run-view.js`; also `lib/wall-clock-summary.js` and `lib/run-ledger.js`, where the scan hits | **LIN-4460** (`run-closeout-state.js`); **PR #2427 / LIN-4455** (`run-view.js`, `wall-clock-summary.js`) |
| LIN-4467 (piece 3, stage-kind records) | the `STAGE_LABELS` literal in `lib/run-view.js`; **`COMPLETION_SIGNALS` becomes a view of our record** | PR #2427 (`run-view.js`). This also **changes Runs' read sample for LIN-4462**: every consumer of `COMPLETION_SIGNALS` is a prompt, so the content belongs with us, but your after-read should know. |
| LIN-4468 (piece 4, proxy write guard) | `lib/dispatch-entrance.js`, `lib/follow-up-dispatch.js`, `routes/dispatch.js`, `lib/wake-credential.js` (each mint path passes its stage's `writes`) | PR #2427 (`routes/dispatch.js`) |

Every rebase is mechanical: whichever lands second rebases. We don't touch the runner or `lib/dispatch-store.js`, and Runs' run-behaviour tables (`SPINE`, `BUCKET_OF_KIND`, `FIRST_PASS_KINDS`, `OFF_SPINE_KINDS`) stay yours, with their tests. Also, `lib/stage-writes.js` (where piece 4 puts the one allowance table) is registered to `other-features`, not to either of our areas.

The three seam moves are agreed as before. Nothing here changes them.


### Comment 2026-11-13T16:42:08.173Z

## LIN-4459 (piece 4): departure from the approved plan, and a finding

PR: https://github.com/JKershaw/LinearViewer/pull/2432 (branch `feat/lin-4459-run-live-wait`, commit e9a3cb324, on `origin/main` 0092d8d9e).

**Departure.** Piece 4 says to resolve a parked stage's terminal with `resolveFollowUpRoot` and `heldWakeHolderOf`. It does not, and reads the store's shared lineage instead: `listHistory({ withLineage: true })` gives each row the wire outcome from `deriveLineageFields`, through one batched lineage read over the page's anchors. Reasons (the survey comments on LIN-4459 set these out): both helpers are async per-row store walks that go **up** from a follow-up, while a parked stage needs its **descendants**; `recentRuns` and `stageRuns` are pure and synchronous; and a second walk would be a second definition of "what ended". Validated before adopting it: with real store writes, a ci-wake `custom` follow-up and a held-wake `leftover` holder both carry the stage's `rootItemId` and entry tags, so the lineage read covers both cases.

**Scope kept to the plan.** Only a stage parked `[pending]` on its own row is judged by its lineage. A stage that is not parked, whose follow-up posts `[blocked]`, stays live, as before. A parked stage whose lineage ends `done`, `failed` or `aborted` is also not live; those already reached the closed stamp, so that is a no-op in practice.

**Consequences surfaced in the PR, not in scope to change:** selector lines and look-first's "newest run waiting on a person" off-switch now see the lineage's end; a parked blind read whose lineage ends counts as an ended read; a stage ended by its lineage is dated by its park, because the wire row does not carry the lineage's end time.

**Finding, left for a person.** Stages not parked and blocked by a follow-up (not `[pending]`) still read running and hold the wait. That is a separate rule; flagging it for a decision, not changing it here.

**Retires:** `lib/recommendation-live-wait.js` (no shim); `runFact`'s row-only read of a parked stage. **Settles** the runs-and-dispatch Waiting entry on `runFact`, and the two live-wait entries in the LLM & prompts note. The claim compare-and-set note moved to the Runs note.


### Comment 2026-11-13T16:42:22.854Z

## LIN-4458 (piece 2): classifier home, and how "first cited after the anchor" is read

**Classifier home: Runs, by A14's recorded agreement, not by the fallback.** LIN-4448 agreed in comment 08c9c898: `commentKindOf` goes in `lib/run-trail.js`, with no fallback needed. I renewed the ask on LIN-4448 (comment 1a2e7cba), adding the census boundary Survey asked about. The census counts kind predicates, not verdict-value parsers, and the audit and agent-note openings become rows in the Runs table. I'm not waiting on a reply.

**Two readings the plan left open. These are my engineering calls, and the characterization tests encode them:**

1. **Landing.** The anchor stays as it is today: the latest close-out before the latest review. "First cited after the anchor" means first-appearance order after the anchor. It does **not** mean "never cited before anywhere". Under that literal reading, row 13's re-cited PR1 drops out, the landing comes back `[]`, and `closeOutWaitsOn` opens the gate on a re-reviewed PR.
   - Row 14 flips because each kind carries the landing in its own way. An audit report carries only the PRs it cites for the first time on the trail (its notes PRs). That is the same set `auditAfterLandingCloseOut` computes privately today, so it becomes one rule instead of two.
   - Blind reads, Survey reports and area reads carry no landing.
2. **Work after review.** A later comment counts when its kind counts as work and it cites a PR the reviewed landing did not hold (agent notes included). The non-agent landing evidence that counts today keeps counting.
   - Kinds excluded as a written list: review, close-out (it has its own `closeOutAfterReview`), blind read, Survey report and area read.
   - That exclusion list is what keeps row 3 (a blind read of an older PR) routing `blind-read`.



# Area notes (as committed on main before 2026-11-13T17:04:57Z)

# Runs & dispatch

Area notes for `runs-and-dispatch` in the registry. Format and rules: README.md.

## Lessons

- A run-row field that is always present with a default is one entry in `RUN_FIELDS`
  (`lib/dispatch-fields.js`). A sparse field stays a conditional spread in `addItem` and
  `_archiveItem`, so other rows keep their key sets byte-identical. Six fields were once
  dropped on one hop of four.
- Every exit from the queue except a take archives through `_archiveItem` (`lib/dispatch-store.js`);
  a new exit must archive through it too.
- The wake path is `_planWake` (decide) then `_deliverWake` (deliver) in `lib/dispatch-store.js`,
  shared by `addFeedback` and the held-wake release (LIN-4373). Its guards (LIN-1059, 1165, 1357,
  2297, 4080, 4166) run in an order that matters: change the pair whole, keep the wake suites
  passing, and update the two census pins (`lin-3134-declared-mint-census`,
  `lin-4080-addItem-census`) if the write moves.
- "This run's PR" is the session's own report: `prUrlOfFeedback` (`lib/dispatch-wake.js`) takes a
  PR on a report line before the `[done]` `url`, which older runners filled by mention count
  (LIN-4375).
- Two `[done]` posts can reach a decide-then-enqueue at once, so "no row yet" is no guard: claim
  first, compare-and-set on the row (`claimHeldWake`). LIN-4373 relied on the read and queued two
  leftover rows (LIN-4375).
- A claim whose holder skips is released on every path out (`releaseHeldWakeClaim`). A stamp left
  by a skip held the re-report forever (LIN-4375 review).
- Any session can park `[pending]` on CI and finish on a ci-wake `custom` row (`lib/ci-wake-sweep.js`).
  A rule keyed on the producing kind misses that ending: read the lineage (`heldWakeHolderOf`,
  `resolveFollowUpRoot`). LIN-4373 covered eligibility, not the held wake's terminals. Over a
  ticket's runs, read it batched: `listHistory`'s `withLineage`, never a walk per row (`runFact`,
  `lib/recent-runs.js`, LIN-4459: the walks go up, a parked stage's ending is below it).
- Row-only kinds stay out of `DISPATCH_KINDS` (`lib/prompt-templates.js`) and sit in `ROW_ONLY_KINDS`
  (`lib/dispatch-fields.js`); kind-keyed maps are tested against both. A new bucket can pull a kind
  into the round-trip walk, which `OFF_SPINE_KINDS` stops (LIN-4376).
- The store knows no leftovers (LIN-4383). It holds a parent wake by `heldWakeFor` (LIN-4373),
  released by the holder's terminal or `_archiveItem` under the build's guard key, so it wakes once.
  Leftover wording lives in `lib/dispatch-leftover-hook.js`, bound into the store late
  (`setHeldWakeReleaseNote`) because most releases have no request; a new held-wake feature brings a
  hook (`lin-4377-store-knows-no-leftover` counts the word and forbids the `formatHeldWakeNote` import).
- A feedback-entry kind is one row in `FEEDBACK_KINDS` (`lib/dispatch-feedback-kinds.js`) that declares
  every role; readers filter the table, and its row order is the runner prompt's bytes. A shared
  constant is imported from its owner (`HALT_MODES`, `followUpTarget`, `NEVER_RAN` in
  `lib/dispatch-terminal.js`). The decision-stamp set had four copies in `lib/`; the LIN-4455
  censuses (`lin-4455-feedback-kinds-table`, `lin-4455-constants-owners`) fail on a new one.
- Price a pulled extra like any piece: a cost read that rode along with LIN-4201 landed alone as
  LIN-4226.
- A task timeline lane is running from the page's open session ids (`isOpenState`), never the
  cost row; a lineage's own `incomplete`, not the shared `lineagesTruncated`, decides "not
  complete" (LIN-4405, `lib/task-timeline.js`).
- A test that dispatches a close-out passes a `closeOut` seam (`resolveProvider`): the readiness
  guard reads comments for every close-out since LIN-4438, and without the seam it reaches the real
  provider and fails open, a pass the hermetic watcher catches only in CI.
- Close-out readiness has five lanes: the route (`codeRouteOf`), the stop-at state, the task page's
  box (`buildRunEvidence`) and both guard lanes (`closeOutNotReady`). A readiness rule goes in
  `closeOutWaitsOn` (`lib/run-closeout-state.js`) and gets a row in the shared-trail table
  (`lin-4438-blind-read-gate`); gating one lane let the page offer a press the guard refused (LIN-4438).
- A reader that classifies by kind routes `custom` before `bucketOf`: `BUCKET_OF_KIND` maps
  `custom` to orchestration, and `bucketOf` falls back to orchestration silently, so check membership
  (`lib/wall-clock-summary.js`). `dispatchesOf` turns a missing kind into `custom` (`lib/cost-read.js`):
  confirm a custom kind from its own row before trusting it (LIN-4426).
- A full PR URL's repository and number come from `prOf` beside `prUrlsIn` (`lib/run-ledger.js`),
  for the task page and measure 1 alike; compare repositories case-blind, as GitHub does (LIN-4439).
- A per-dispatch figure (its model, cost or completeness) is the fold's answer, carried through
  `lib/cost-read.js`; a reader never re-ranks `byModel` itself. (Drift & Coherence Review, 13 Nov.; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
- The Harbour calls read is `lib/cost-read-calls.js` (LIN-4457): `readCalls`, `appCallsOf` and
  `callsSurfaceOf` are pure over docs their caller keys to one workspace (`listInHorizon(urlKey)`). The
  instance-wide boundary is the `urlKey` / `instanceWide` guard on `lineageRecords` and `readCost`
  (LIN-4226), not these readers. A new calls shape goes beside them, and `appCallsOf([])` is the one empty shape.

## Waiting

- `lib/dispatch-wake.js`: `reportedPrUrlOf` and SD's `sessionPrs` pick a PR by one order, linked
  only by a comment; changing one moves a PR link. (Drift & Coherence Review, 10 Nov;
  `docs/reviews/drift-coherence-review-2026-11-10.md`.)
- `lib/dispatch-leftover-hook.js`: a death between `claimHeldWake` and the enqueue, or a failed
  release write, leaves the wake held. No sweep: a lease sees no re-report, a sweep scans
  history, and clearing stamps reopens LIN-4375's double queue. (LIN-4377.)
- `lib/dispatch-store.js`: `addFeedback` takes one `wakeHook`; a second held-wake feature
  first needs composable hooks. (Operator, LIN-4377.)
- `lib/runner-kit/contract.json`: the row-shape rule is written twice (`checkRowShape`;
  SD's `columnProblems`); `CONTRACT_SHA256` pins the bytes, not the rule. (Operator, LIN-4377.)
- `lib/runner-kit/contract.json`: no row pins a follow-up to a finished, unhalted session
  (rows cover pause and stop), though the leftover step resumes its build that way
  (`lib/dispatch-leftover.js`). (Seams & Tangles, 10 Nov.;
  `docs/reviews/seams-tangles-review-2026-11-10-run11.md`.)
- `lib/session-summary.js`: do stored run paragraphs keep pre-cutover figures? (Survey
  tally: LIN-4201.)
- `lib/wake-shadow.js`: one wake policy, from the LIN-3257 classifier this shadow records.
  (Survey tally: LIN-3257.)
- `lib/runner-kit/runner.mjs`: the per-message transcript fold is here and in SD; one shared
  fold would turn a transcript into requests. (Survey tally: LIN-4203, LIN-4195.)
- `lib/run-live-wait.js`: a read, not a claim: two different-kind calls racing on
  one ticket both pass; claim compare-and-set, like `claimHeldWake` (LIN-4392). (Moved from the LLM & prompts note by LIN-4459.)
- `lib/run-ledger.js`: `landingPrUrls` counts every full PR URL after its anchor, so it disagrees with
  the other landing readers in two cases the shared-trail table pins as chosen, not designed
  (`tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15): an audit report that re-cites a
  merged landing PR puts it in the notes PR's landing (`auditAfterLandingCloseOut` in
  `lib/recommendation-facts.js` treats only the new PR as the notes PR), and a foreign PR cited
  before the first review joins a first landing. Each costs a read that must name an extra PR. One
  comment classifier and one landing reader would make both follow from one rule. A third case is not pinned: an agent's own note (first line
  `autopilot`, `plan posted`, `plan revised`, or `revision N`) that cites a new PR after review joins
  `landingPrUrls` but not `isLandingEvidence` (`lib/recommendation-facts.js`), so `blindReadStep`
  offers a blind read naming a PR the approved review never covered, where a plain note sends it
  back to review (reproduced at
  e2d4659c4; Seams & Tangles, 13 Nov.; `docs/reviews/seams-tangles-review-2026-11-13-run12.md`, §3.0a).
  (LIN-4438; Survey global on LIN-4438.)
- `lib/run-ledger.js`: `landingPrUrls` skips only blind reads and survey reports, so a comment headed
  `## Area read` that names a full PR URL would join the ticket's landing. Only the prose rule in
  `docs/plans/survey/area-read.md` (cite `path@sha`, never a PR URL) keeps the LIN-4447 area reads
  out today. An area-read kind in the one comment classifier (LIN-4458, piece 2) would make that rule code. (Leftover
  of LIN-4453; Survey global on LIN-4453.)
- `lib/run-closeout-state.js`: `deriveCloseOutState` works from two PR lists: `prs` (`extractPrUrls`,
  every PR ever cited) drives the PR-shape reasons (multiple-prs, partial, merged) and `landingPrs`
  (`landingPrUrls`) drives the blind-read gate, so the box can count PRs the gate ignores and the
  other way round (pinned in `tests/unit/lin-4438-blind-read-gate.test.js` rows 14 and 15). Which
  reader answers "this task's PRs" spans the box, the guard and the route. (Blind read on LIN-4439.)
- `lib/close-out-readiness.js`: in the stop-at lane `deriveCloseOutState` lets merged and partial
  outrank the gate, then `closeOutNotReady` asks `closeOutWaitsOn` again to override it, so the box
  state is not the guard's whole answer and the precedence lives in two files. Carrying the gate's
  answer in the state changes the box model the renderers read. (Blind read on LIN-4439.) `ladderNotReady`
  asks the gate a third time, so the box and the guard order the same reasons two ways and the next
  close-out reason must be placed in both; one order is a decision about what the box shows versus
  what the guard refuses. (Blind read on LIN-4396.)
- `lib/run-closeout-state.js`: the close-out reasons are bare string literals: `'blind-read-missing'`
  is spelled here and again in `REFUSED_REASONS` (`lib/close-out-readiness.js`, beside `'head-moved'`),
  and `closeOutNotReadyRefusal` builds its error by capitalising `state.message`. A reasons constant
  (like `CLOSE_OUT_STATUS`) covering every reason, used by the box, the guard and the render, would
  give them one vocabulary. (Blind read on LIN-4396.)
- `lib/run-closeout-state.js`: `closeOutSetsDone` never asks `closeOutWaitsOn`, so the owner's check
  (`routes/workspace-api-run-evidence.js`) sets a stop-at-PR task Done when its landing PR is merged
  and approved with no blind read, while the close-out guard (`lib/close-out-readiness.js`) refuses
  the same trail as `blind-read-missing`, and `blindReadStep` (`lib/recommendation-blind-read.js`)
  then routes a read to the Done ticket (it stands aside on a completed ticket only after a
  close-out). The entries above name the box/guard precedence split; this is its Done path. Whether
  a person's own check may pass the gate is a decision; the shared-trail test runs with
  `byPersonCheck: false`, so it never reaches this path. (Drift & Coherence Review, 13 Nov., second read; `docs/reviews/drift-coherence-review-2026-11-13.md`.)
- `lib/cost-read-calls.js`: `readCalls` states the figure rule (`totalUsd` only when everything is priced and
  complete; `pricedUsd` never counts a partial) in its own words, and the lineage figure in `lib/cost-read.js`
  states it again, so a change to the rule is made twice. One shared helper would make it one, but it reaches the
  lineage path and its goldens: larger than a fix. (LIN-4457 leftovers; Survey global on LIN-4457.)
- `lib/dispatch-feedback-kinds.js`: the table's `mayCarryWake` column is `true` on every row (unknown kinds
  pass too), so `findWakeEvent` (`lib/dispatch-terminal.js`) never skips a kind, while `lastWakeEntry`
  (`lib/run-view.js`) skips the decision-stamp kinds as "never a wake marker". Two wake scans disagree about
  stamps, and the column only records `findWakeEvent`'s behaviour. Removing the column or making it true to
  both readers means deciding whether `findWakeEvent` should skip stamps, which changes wake minting and
  every reader of stored rows. (LIN-4455 blind read.)
- `lib/dispatch-factory.js`: `refusesHermeticToken` skips access for a provider that declares `testTransport`
  (`LinearProvider`, `lib/providers/linear/index.js`), but nothing links that declaration to the transport
  swaps it describes (`routes/test.js` `installTestTokenLinearTransport`, `tests/fixtures/hermetic-linear.js`),
  so a new installer or a change to Linear's can drift from it silently. Closing it means deciding where test
  transports register (for example installers that declare which provider they cover, plus a census test),
  across providers, web routes and fixtures: larger than a fix. (LIN-4456 blind read, 13 Nov.)


# Facts computed from the task records at this moment

(open items with who must act, judgements and decisions with whether they still rest on the current version, areas and their open counts, and an index of other open records)

## 3. Addressed to it
check-156 check [open] v1 by review to close-out in task-113
  what: Before merge: LIN-4448 has not answered the renewed ask (question-148, comment 0510ffe0, posted after the build), and that ask does not mention the `runner-kickoff.js` import change or the LLM-note entry it retires. Post that addition on LIN-4448; then either a LIN-4448 reply confirms, or record that 08c9c898 ("agree… no shim… whichever of us lands second changes only the import path", decision-119) already covers the move and that the runner-kickoff change touches only an import path, prompt bytes unchanged (`runner-kickoff.test.js`).
  why-person: Needs LIN-4448's reply, or a recorded judgement that the standing agreement covers it; CI cannot give either.
  how: Comment on LIN-4448; read its reply or record the fallback on LIN-4459.
  about → question-148, decision-119, change-143
check-157 check [open] v1 by review to close-out in task-113
  what: Before merge: CI ran on base 0092d8d9e. If LIN-4458 (piece 2) or LIN-4465 (edits comments in `lib/recent-runs.js`, per decision-119) lands first, PR #2432 must rebase. Require CI green on the exact commit merged, with lin-4392's LIN-4459 describe block green. A local merge with origin/main 2aab32bf0 passed 333/333.
  why-person: Depends on merge order, which is only known at merge time.
  how: Read the CI run on the merge commit's head SHA.
  about → change-143, finding-153
check-158 check [open] v1 by review to close-out in task-113
  what: Cost of the behaviour change: every recommendation read (`codeRouteOf`, hit by autopilot and recommend-and-dispatch) now pays one batched `_lineageOf` read plus the stale-row self-heal writes of `recomputeLineageRows`. Same reads/writes the proxy list and Dispatch history already do, but CI does not measure latency or write volume. Monitor: the `console.error` "Lineage recompute lost its compare-and-set …" in `lib/dispatch-lineage-status.js`, with recommendation latency on the proxy route. Rollback: revert the PR #2432 merge commit (no schema change; heal writes are the derivation the list already persists).
  why-person: Only production traffic shows contention.
  how: Watch production logs and proxy-route latency after deploy; revert the merge commit if contention appears.
  about → change-143, decision-145
check-159 check [open] v1 by review to close-out in task-113
  what: After deploy: the witnesses build rows through the real store but set `rootItemId` by hand; production inheritance was confirmed by reading `lib/dispatch-factory.js:724` only. Find one ticket with a stage parked `[pending]` whose ci-wake `custom` or held-wake follow-up has since posted `[blocked]`/`[skipped]`; `GET /api/proxy/recommendation/<id>` must no longer answer "wait" naming that stage. If none exists yet, record "not yet observed", not discharged.
  why-person: Needs live production data, which no test here reads.
  how: GET /api/proxy/recommendation/<id> on a matching ticket after deploy.
  about → change-143, decision-144, decision-145
finding-161 finding [open] v1 by review to close-out in task-113
  says: Fix before merge, PR #2432 body `## Retires`: add a bullet: "The store's `FEEDBACK_ENTRY_KINDS` re-export (`lib/dispatch-store.js`). `lib/prompts/runner-kickoff.js` and the tests import it from the leaf `lib/dispatch-feedback-kinds.js`; the `tests/unit/lin-4455-feedback-kinds-table.test.js` assertion now pins that the store does not re-export it. This settles the LLM & prompts Waiting entry from LIN-4455's blind read."
  about → change-143, decision-160, finding-81
finding-164 finding [open] v1 by blind-read to close-out in task-113
  says: Fix-sized, PR #2432 at 7424cfb8f: `tests/unit/session-run-transcript-entries.test.js` header comment now reads "(lib/dispatch-feedback-kinds.js; then —", which is garbled, and the same sentence still cites "lib/dispatch-store.js:95" for why `decision-answer` is excluded, though that explanation now lives in `lib/dispatch-feedback-kinds.js`. Fix: reword the parenthesis and point the citation at `lib/dispatch-feedback-kinds.js`, with no line number.
  about → change-143
finding-165 finding [open] v1 by blind-read to close-out in task-113
  says: Fix-sized, PR #2432 at 7424cfb8f: `runFact` (`lib/recent-runs.js`) translates the wire word `blocked` into `WAITING_ON_A_PERSON` in two places, the own-row branch and the new parked-lineage branch (`r.outcome === 'blocked' ? WAITING_ON_A_PERSON : r.outcome`). Fix: one small local mapping both branches use.
  about → change-143

## 4. What stands about this task
verdict-102 verdict [stands] v1 by plan-review in task-82
  of: plan-review
  outcome: approve
  reasoning: Approve (comment 12619798, plan rev 2). B1 is answered and holds; all three Done-when clauses are met by the pieces, with the 20 Waiting entries mapped. Piece 4: builder note 5, hand runFact the lineage before it is filtered.
  on → plan-91@2
decision-115 decision [stands] v1 by breakdown in task-113
  answer: Session fit: fits one session (medium). Plan-review due: no, covered by LIN-4447's approving plan-review (comment 12619798, rev 2).
  why: The approved plan sizes piece 4 medium; the parent's plan review approved it.
  on → verdict-102@1
decision-116 decision [stands] v1 by breakdown in task-113
  answer: LIN-4459 is blocked by LIN-4454, LIN-4455, LIN-4456 and LIN-4457, in order step 3 beside LIN-4458. Ask LIN-4448 first.
  why: 2 and 4 wait on all of 3/5/6/7. The plan orders them that way, and the work overlaps: 4's lineage helpers live in `dispatch-store.js`, which 5 edits.
  on → verdict-102@1
  about → task-108, task-109, task-110, task-111
decision-117 decision [stands] v1 by breakdown in task-113
  answer: LIN-4459 blocks LIN-4460 (piece 1).
  why: 1 waits on both 2 and 4. It consumes `readTrail`, and `blindReadStep` imports the live-wait module that 4 moves.
  on → verdict-102@1
decision-119 decision [stands] v2 by breakdown in task-82
  answer: agree
  why: ## Reply from LIN-4448 (LLM & prompts): agree to all three seam moves

Checked against main 2bf788b6d.

1. **One comment classifier in lib/run-trail.js: agree.** No fallback needed.
2. **Live-stage wait to lib/run-live-wait.js, old file deleted, no shim: agree.** Our CODE_ROUTES list (LIN-4448 piece 1) imports liveWaitOf from wherever it lives when it lands. Whichever of us lands second changes only the import path. The claim compare-and-set Waiting entry moves to your note unchanged.
3. **blindReadStep reads closeOutDecision().waitsOn/followsPerson: agree.** The file stays ours. LIN-4448 piece 2 leaves its COMPLETED redeclaration alone, so that retires with your piece 1.

Code-route ownership stays here: CODE_ROUTES is the one list and Runs adds no copy. The only edit LIN-4448 makes in a Runs file is the STAGE_LABELS literal in lib/run-view.js (piece 3, derived from the stage-kind record); rebase on that if your pieces touch it.

## Correction from LIN-4448 (LLM & prompts): the full list of Runs files our pieces edit

This corrects our reply of 15:39 (comment 08c9c898). That reply said the only Runs file LIN-4448 edits is the `STAGE_LABELS` literal in `lib/run-view.js`. That was wrong. By first match in `docs/areas/areas.json`, these files are `runs-and-dispatch` too. Checked at main `5dcf5bcda`.

| LIN-4448 subtask | Runs files it edits | Collides with |
|---|---|---|
| LIN-4465 (piece 1, `CODE_ROUTES`) | comments in `lib/recent-runs.js` and `lib/dispatch-entrance.js` | **LIN-4459** (`recent-runs.js`) |
| LIN-4466 (piece 2, blind-read identifiers) | `lib/completion-signals.js`, `lib/run-closeout-state.js`, `lib/pipeline-churn.js`, `lib/run-view.js`; also `lib/wall-clock-summary.js` and `lib/run-ledger.js`, where the scan hits | **LIN-4460** (`run-closeout-state.js`); **PR #2427 / LIN-4455** (`run-view.js`, `wall-clock-summary.js`) |
| LIN-4467 (piece 3, stage-kind records) | the `STAGE_LABELS` literal in `lib/run-view.js`; **`COMPLETION_SIGNALS` becomes a view of our record** | PR #2427 (`run-view.js`). This also **changes Runs' read sample for LIN-4462**: every consumer of `COMPLETION_SIGNALS` is a prompt, so the content belongs with us, but your after-read should know. |
| LIN-4468 (piece 4, proxy write guard) | `lib/dispatch-entrance.js`, `lib/follow-up-dispatch.js`, `routes/dispatch.js`, `lib/wake-credential.js` (each mint path passes its stage's `writes`) | PR #2427 (`routes/dispatch.js`) |

Every rebase is mechanical: whichever lands second rebases. We don't touch the runner or `lib/dispatch-store.js`, and Runs' run-behaviour tables (`SPINE`, `BUCKET_OF_KIND`, `FIRST_PASS_KINDS`, `OFF_SPINE_KINDS`) stay yours, with their tests. Also, `lib/stage-writes.js` (where piece 4 puts the one allowance table) is registered to `other-features`, not to either of our areas.

The three seam moves are agreed as before. Nothing here changes them.

  answers → question-86
  about → plan-89, plan-91, plan-88
decision-120 decision [stands] v1 by John via harbour-ruling in task-82
  answer: Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up
  why: Ruling lin4447-recommend-path-outside-merge, recorded via Harbour (comment 90c9f8a4).
  scope: task-82
  answers → question-97
decision-121 decision [stands] v1 by John via harbour-ruling in task-82
  answer: Both: a person's Done and an outside merge
  why: Ruling lin4447-r1-passenger-scope, recorded via Harbour (comment cf8f5ed6).
  scope: task-82
  answers → question-85
decision-122 decision [stands] v1 by John via harbour-ruling in task-82
  answer: Yes, change both repos so the copies are gone
  why: Ruling lin4447-sd-scope, recorded via Harbour (comment 830a4864).
  scope: task-82
  answers → question-84
decision-124 decision [stands] v1 by survey-task in task-113
  answer: Grounding commit is now origin/main 0092d8d9e, 20 commits and 118 files after 4b5001ddf; the approved slice still stands as the target, but positional references to the area notes no longer hold.
  why: Survey staleness check at 16:25: origin/main 0092d8d9e, not 4b5001ddf as decision-114 says. "Waiting 14" by position is now a close-out entry; Lessons in docs/areas/runs-and-dispatch.md is 5,195 bytes (budget 6,144).
  on → verdict-102@1
decision-125 decision [stands] v1 by survey-task in task-113
  answer: The Waiting entry LIN-4459 settles is the `runFact` row-only-read entry (finding-28), now at `docs/areas/runs-and-dispatch.md:89`; find it by its text, not as "Waiting 14".
  why: At 0092d8d9e the 14th Waiting entry by position is a close-out entry, not the runFact one the plan meant.
  about → finding-28
  on → verdict-102@1
decision-135 decision [stands] v1 by survey-place in task-113
  answer: The place is unchanged since grounding: none of the 20 commits to 0092d8d9e touch `lib/recent-runs.js` or `lib/recommendation-live-wait.js`. The move itself is clean (the old module is 80 lines with a good docblock; its only import is `isLiveRun` from `lib/recent-runs.js`, a 141-line pure module). The risk sits in the behaviour change, not the move.
  why: Survey global at 0092d8d9e (comment 1999d0b1); only the area notes moved, which decision-125 already covers.
  on → decision-124@1
  about → task-113
decision-141 decision [stands] v1 by scoping in task-113
  answer: Size: just the task. Cuts: none. Decided by the standing policy.
  why: Moves the live-stage wait to its runs home and has a stage read its outcome from its whole lineage, so a parked stage whose follow-up blocked or skipped stops holding the ticket; no survey finding binds a larger move.
  scope: task-113
  on → plan-91@2, decision-124@1, decision-135@1
  about → task-113
decision-144 decision [stands] v1 by implementation in task-113
  answer: Yes: the lineage read by rootItemId covers held-wake holders
  why: Witnessed with real store writes: a ci-wake `custom` follow-up and a held-wake `leftover` holder both carry the parked stage's `rootItemId` and entry tags, so no `heldWakeHolderOf` call is needed beside the lineage read.
  answers → question-128
  about → plan-91
decision-145 decision [stands] v1 by implementation in task-113
  answer: Departure from plan-91 piece 4: a parked stage's terminal is read from the store's shared lineage, `listHistory({ withLineage: true })` giving each row the wire outcome from `deriveLineageFields` through one batched lineage read over the page's anchors, not from `resolveFollowUpRoot`/`heldWakeHolderOf`. Scope kept to the plan: only a stage parked `[pending]` on its own row is judged by its lineage (blocked, skipped or a terminal word ends it); a parked stage whose lineage ends done/failed/aborted is also not live, a no-op in practice since those already reach the closed stamp.
  why: Both helpers are async per-row store walks that go up from a follow-up, while a parked stage needs its descendants; `recentRuns`/`stageRuns` are pure and synchronous; a second walk would be a second definition of what ended. Validated with real store writes first (decision-144). Recorded on LIN-4447 (comment d3553049); PR #2432.
  on → plan-91@2, decision-144@1
  about → finding-126, finding-127, finding-136, finding-137, task-113, task-82
decision-160 decision [stands] v1 by review in task-113
  answer: Inside the bounded class: keep the FEEDBACK_ENTRY_KINDS re-export removal, and the PR body names it as retired.
  why: The parent asks that each rule have one home and the copies go; the re-export is the same idiom this ticket bans for its own module ("no re-export or shim"). The Waiting entry it retires (finding-81) was written by LIN-4455's own blind read, asking for this drop on condition the runner prompt bytes and kind order do not change; runner-kickoff.test.js and the lin-4455 table test pass. No importer of the store re-export remains in this repo or in simple-dispatcher. The flipped lin-4455 assertion pinned the then-current compatibility state, not a requirement.
  answers → question-151
  on → change-143@2
  about → finding-81, finding-150
verdict-162 verdict [stands] v1 by review in task-113
  of: review
  outcome: approve-with-notes
  reasoning: Approve, conditional on close-out discharging the ledger (LIN-4459 comment db296654). Done-when met sentence by sentence at head 7424cfb8f: five names in lib/run-live-wait.js with no cycle; old module deleted, no shim, importers and three test importers moved; runFact (lib/recent-runs.js:76-79) takes the lineage word only for a parked row with no terminal of its own; lineage helpers replaced by the recorded departure, which I agree with; compare-and-set note moved unchanged; Waiting entries gone; census and area-map-placement green; Lessons 5,389 B. Ask-LIN-4448-again met only in part. Regression check: LIN-4370's WAITING_ON_A_PERSON and LIN-3364's closed-stamp time intact. Class: all wait readers go through loadRecentRuns; liveOnAnchor (lib/live-anchor.js) reads a different shape, outside, no ticket. Fix: finding-161. Ledger: check-156, check-157, check-158, check-159.
  on → change-143@2, decision-145@1, decision-160@1
  about → task-113
verdict-168 verdict [stands] v1 by blind-read in task-113
  of: blind-read
  outcome: better
  reasoning: Better (LIN-4459 comment 16376a3c), read PR #2432 at 7424cfb8f against 0092d8d9e. Two things get one home: `FEEDBACK_ENTRY_KINDS` comes only from `lib/dispatch-feedback-kinds.js` (the `lib/dispatch-store.js` re-export is gone, every importer moved), and the live-wait predicate is in `lib/run-live-wait.js`, with no import cycle and a census test. A parked stage whose lineage has ended no longer holds its ticket, proved by real-store tests in `tests/unit/lin-4392-live-stage-wait.test.js`. Worse side: the run-outcome words are split between `lib/run-live-wait.js` (QUEUED/RUNNING) and `lib/recent-runs.js` (waiting on a person, closed, aborted), finding-166. Fix-sized: finding-164, finding-165. Larger: finding-166, finding-167. Outside the area: none.
  on → change-143@2
  about → task-113, area-1

## 5. Its areas
area-1 Runs & dispatch: 21 open addressed to it
area-38 LLM & prompts: 23 open addressed to it

## 6. Open runs sharing its paths
(none)

## 7. Index of what else is known
lesson-8 lesson → -: Any session can park `[pending]` on CI and finish on a ci-wake `custom` row (`lib/ci-wake-sweep.js`). A rule keyed on the producing kind misses that ending: read the lineage. For one follow-up, walk up (`heldWakeHolderOf`, `resolveFollowUpRoot`); over a ticket's runs, read it batched (`listHistory({ withLineage: true })`, as `loadRecentRuns` does), never with a walk per row. LIN-4373 covered eligibility, not the held wake's terminals.
lesson-11 lesson → -: A feedback-entry kind is one row in `FEEDBACK_KINDS` (`lib/dispatch-feedback-kinds.js`) that declares every role; readers filter the table, and its row order is the runner prompt's bytes. A shared constant is imported from its owner (`HALT_MODES`, `followUpTarget`, `NEVER_RAN` in `lib/dispatch-terminal.js`). The decision-stamp set had four copies in `lib/`; the LIN-4455 censuses (`lin-4455-feedback-kinds-table`, `lin-4455-constants-owners`) fail on a new one.
change-143 change → -: PR #2432 (branch feat/lin-4459-run-live-wait)
question-148 question → task-83: LIN-4459 (piece 4) is built in PR #2432: on your side `lib/openrouter.js`, `lib/proxy-instructions.js`, `lib/recommendation-blind-read.js`, `lib/recommendation-facts.js` and `lib/recommendation-look-first.js` change only import or comment text; the code-route list in `openrouter.js` is untouched; in `docs/areas/llm-and-prompts.md` the two live-wait entries leave and the claim compare-and-set note moves to the Runs note unchanged. Do you still agree before the PR merges? (Renewed ask, LIN-4448 comment 0510ffe0; posted with the PR, not before building.)

