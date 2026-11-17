# What this stage really wrote

## Comment on LIN-4455 at 16:16:59

## Close-out — LIN-4455

**Merged:** [PR #2427](https://github.com/JKershaw/LinearViewer/pull/2427) as `192e1f81f` (head `f78b61898`, merged pinned with `--match-head-commit`). Deploy landed: the harbour.cat footer shows `192e1f81f`.

**How it meets what was asked:** as the review recorded (comment 70c1e9dc): constants from their owners, release wording out of the store, one `FEEDBACK_KINDS` table, Waiting 2, 4, 11 settled. Plan departures are on LIN-4447 (`055a6035`, `2f488272`).

### Changes I made after the approval
Each is on the PR branch; none changes behaviour.
- `e52a8b273` (merge of `origin/main` `5dcf5bcda` into the branch, clean) plus fixes:
  - Review line "document in the `setHeldWakeReleaseNote` docblock": added a paragraph to `lib/dispatch-store.js` saying stores built outside server.js (account erasure, `scripts/`) use `UNBOUND_HELD_WAKE_RELEASE_NOTE` by design.
  - Blind read, floating comments: folded into the docblocks of the code that uses the set, in `lib/run-view.js` (`lastWakeEntry`), `lib/session-telemetry.js` (`_isNonStateEntry`) and `lib/wall-clock-summary.js` (the `touchedCi` use site).
  - Blind read, `?.`: `lib/dispatch-leftover-hook.js` now calls `dispatchStore.setHeldWakeReleaseNote(releaseNote)` directly, matching its required `@param`. Every test that builds a step still passes, so no stub needed it.
- `f78b61898`: the blind read's larger and outside finds written as Waiting entries (below).
- Nothing in this close-out was a citation made stale outside the ticket's files.

### Ledger
- **Release wording on stores built outside server.js** (inside): the docblock sentence above.
- **Target `0`/`false` now fails closed** (inside): after the deploy, monitor `[leftover] skipped reason=target-not-resumable` for stored non-string targets (the monitor the review named). **Not run:** I have no access to production logs. Operator: search that line over the first day after `192e1f81f`; any hit is a stored row with a non-string target. No rollback was named as needed.
- **Remint refusal in `routes/dispatch.js`** (inside): discharged in the review (same two statuses; census-covered).
- **Exact-commit CI** (inside): `ci-success` green on `f78b61898`, run 43458642312 (8 of 8 checks: Unit tests, Unit tests (proxy, clock +400d), E2E 1–4/4, Secret scan, CI success). Before pushing I ran the full unit suite locally on the merged tree: 25,457 of 25,457 passed. After the push, `origin/main` moved to `e8e92d50a` (LIN-4456); GitHub reported the PR `CLEAN`, so I merged without a second update.
- **Leftovers comment** (inside): posted on LIN-4455 (`e119199c`), `Retires:` naming the settled entries (Waiting 2, 4, 11).

### Blind read
- Floating comments and `?.`: fixed above.
- Larger, `mayCarryWake` vs `lastWakeEntry`: Waiting entry in `docs/areas/runs-and-dispatch.md` (deciding it changes wake minting).
- Larger, two release channels: already the Waiting entry "`addFeedback` takes one `wakeHook`"; no second entry.
- Outside, `lib/prompts/runner-kickoff.js` importing through the store's re-export: it breaks nothing, so a Waiting entry in `docs/areas/llm-and-prompts.md`, not a ticket.
- No follow-up tickets filed; no related tickets to close (LIN-4458 and LIN-4459 are blocked by this and still open for their own pieces). No rulings were open or raised.

### Final state
LIN-4455 Done; PR merged; CI green on the merged head; deployed.

