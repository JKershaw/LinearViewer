# What this stage really wrote

State: LIN-4469 set Done at 23:59:22.829 (completedAt). PR #2447 merged as `ca77a891e`.

## Comment on LIN-4469 at 23:59:23 (id eb4829c5)

## Close-out — LIN-4469

**Merged:** https://github.com/JKershaw/LinearViewer/pull/2447, squash commit `ca77a891e8e32f8132b9d3d0da0c860bfd0b213b`, pinned with `--match-head-commit 3504108297a13149fa8d6b8c5edfe98ad9333b5c`. The deploy landed (harbour.cat's footer commit went from `b937237a4` to `ca77a891e`), and `Tests` on main for the merge commit is green (run 43530212559).

**Authority:** the re-review (042f607d, head `05b592742`) is Approve, conditional on this close-out discharging its ledger, and the `## Blind read` (d96c0849) names #2447 and came after it. Review's account of how the change meets the ask stands; I did not repeat it.

### Changes I made after the approval
Nobody re-reviewed these. Each answers a review or blind-read line.

- `534524f92`
  - **Review fix 1:** removed Seams & Tangles' hand-typed "(no path is written here)" from the first runReview bullet in `lib/periodicals.js` (main's words again). Both `seams-tangles` hashes re-pinned in `tests/unit/lin-4313-periodical-prompt-bytes.test.js`. The change-log row and the PR body's Measured and DECISION sections now say −2242, nothing rises, and `lin-4469-witness` was withdrawn as moot.
  - **Review fix 2:** deleted the stray `(396821 -> 396571), the rest was unused headroom.` fragment in `tests/unit/prompt-size-budget.test.js`.
  - **Blind read, fix-sized:**
    - `tests/unit/lin-4469-prompt-folds.test.js` now asserts zero occurrences of each retired phrase, and the test name drops "at most one".
    - `committedSearch` takes an optional `more` tail inside its parenthesis, and Stability passes its look-beside tail through it. The `.slice(0, -1)` is gone and Stability's hash is unchanged.
    - The lin-4313 header now says only the second Seams & Tangles bullet and Stability use the helper.
    - `docs/architecture/source-map.md` says `leftover-words.js` exports `NOTES_PR` and `areaLookup` and imports `lib/prompts/area-registry-path.js`.
- `cc7792e58`
  - **Blind read, fix-sized:** the six reading-pass records in `lib/prompts/stage-kinds.js` (look-into, context, retro, survey-task, survey-place, blind-read) declare their intent line. The loop that rewrote the exported records after declaration is gone. The 72 renders are byte-identical, and `tests/unit/lin-4253-stage-traits.test.js` still ties the line to `writes`.
  - Waiting entries for the larger finds (below).
- `350410829`: that commit's first CI run failed `tests/unit/area-notes.test.js`, because two Waiting entries sat under an area their first path does not map to. I re-filed each under its own area. The full local unit suite then passed (25938 / 0), and so did CI on this head.

### Ledger
- **Inside, the witness sentence** (`seams-tangles` +24):
  - Fix 1 above, shown by a base-vs-head render over 72 renders (every stage kind fresh and fix with its `writes` preamble, 16 Periodicals plain and autopilot), run at `b937237a4` and at the head. The total is **−2242**, and both `seams-tangles` renders are **−2**.
  - **Nothing rises:** 58 fall and 14 are equal, the four `work` kinds plus Stability, Recent Headwinds and Integration Surface Maturity, which carry no folded text.
  - The ceiling is unchanged: `FROZEN_TOTAL_BYTES` 396064 is below the 396575 condition (a77d9b51), and `periodicals.js` is not in a budgeted ceiling.
- **Inside, the mandate shrink depends on the live guard:** the deploy has landed, but the live 403 checks have **not been run**.
  - **What:** a look-into token's comment POST and a triage token's description PATCH should each return 403. The tokens must be minted from dispatches whose stage row exists.
  - **Why not:** it means enqueueing real look-into and triage dispatches (agent runs that cost money). My token carries no `dispatch` grant, and the proxy offers no other way to mint a stage-stamped token. A fabricated or stage-less token would mint unrestricted and prove nothing.
  - **Who:** the operator. A 2xx on either means a guarded clause is gone from the prompt with no backstop.
  - **Rollback:** revert `ca77a891e` (no data shape changes). CI does cover `lib/stage-writes.js` and the proxy routes in isolation.
- **Outside:**
  - Survey completion criteria (`stage-kinds.js`): left as review marked them, since they are criteria, not instructions.
  - Simple-dispatcher's retirement-line copies: left to their owner, still named in the Waiting entry at `docs/areas/llm-and-prompts.md`.

### Blind read, the larger finds
Each now has one home, a Waiting entry in `docs/areas/`, so none was filed as a ticket. Every one is larger than a fix (a test-suite or visible-label decision, or a file in another area), and none breaks behaviour, blocks work or touches safety.
- The witness's per-table hashes: `docs/areas/llm-and-prompts.md`.
- `run-view.js`'s `STEP_KIND_WORDS` copy and the two display words for one kind: `docs/areas/runs-and-dispatch.md`.
- `completion-signals.js`'s six unused exports: `docs/areas/runs-and-dispatch.md`.

I filed no tickets. The existing LIN-4350 got its findings earlier (25b09538) and is untouched.

### Final CI
- The head `3504108297a13149fa8d6b8c5edfe98ad9333b5c` is green: Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan and `CI success` (run 43529474068).
- CI exists on this repo, so the substitute was not needed.

### Related tickets and description
LIN-4470 (piece 6) stays Todo, because it is its own piece. LIN-4350 stays open: it spans two repos and this piece only reported findings to it. No other ticket is settled by this work. The description is pruned to a stub; the pre-prune text is in the task snapshots.

## Description change (seen in the 17 Nov read; the 23:59:31 snapshot still has the old text)

The `## Current` section was replaced by:

## Implemented

Landed as [https://github.com/JKershaw/LinearViewer/pull/2447](<https://github.com/JKershaw/LinearViewer/pull/2447>) (squash commit `ca77a891e8e32f8132b9d3d0da0c860bfd0b213b`), deployed. The plan was implemented as approved on LIN-4448, with these deviations, each recorded on that ticket or in the close-out comment: `committedSearch` lives in `lib/periodicals.js` rather than `leftover-words.js`; the fold also covers triage, survey-task, survey-place and blind-read, under John's fold ruling (`lin-4469-cuts`); and look-into's "post nothing to Linear unless the person asks" exception is retired, not reworded, under John's ruling bdcd3128. The full history is in the task snapshots and the comment trail; the close-out comment lists the post-deploy checks not run.
