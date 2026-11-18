# What this stage really wrote

Description: unchanged (snapshots 23:05:33 and 23:17:28 match). Two implementation sessions wrote in this window: this dispatch (c66a3141, 23:05:16.936) and the first implementation's resume on John's answer (custom ac074b22, dispatched 23:03:14.946, a follow-up of b86c4a78), which ran alongside it until 23:16:13 and wrote commit `04bb47598`. Each comment is marked with its writer, inferred from what it says: ec59bd26 disowns commit `05b592742`, which the other three report as this pass's work.

## Comment on LIN-4469 at 23:11:39 (id bbc2b1c7) (this dispatch)

### Leftovers
Retires: `lib/prompt-template-defs.js`: (retrospective-audit Reporting) and `lib/periodicals.js` (`areaNotesRoutes`) each state the docs-only notes-PR rule in their own words; both now render `NOTES_PR` (`lib/prompts/leftover-words.js`). The entry is removed from `docs/areas/llm-and-prompts.md` on PR #2447.

Edges left, read against the diff:
- Fix-sized, fixed on the PR branch: the retirement line's restatement in `docs/areas/README.md` and `docs/architecture/dispatch-and-proxy.md` (now `RETIRES_LABEL` / `RETIRES_NONE`); triage's guarded clauses; the committed-tool spelling in the RETIRED test list.
- Outside this area, a note entry: simple-dispatcher's README and its `docs/areas/README.md` still restate the retirement-line forms and the "follow-up is filed" exit. Its owner's; named in the llm-and-prompts entry, not edited.
- Not a ticket: no find breaks behaviour, blocks work or touches safety.

## Comment on LIN-4448 (the parent) at 23:11:46 (id 8933968d) (this dispatch; it says the ruling `lin-4469-witness` gates merge)

## LIN-4469 (piece 5): course changes and one deviation, PR #2447

Head `05b592742`. Scope and measurement as recorded on the PR.

- **Deviation from the plan:** `committedSearch` lives in `lib/periodicals.js`, not in the shared leaf `lib/prompts/leftover-words.js`. Every call site is a Periodical bullet, so the helper stays beside them. Stability's wording is the one spelling.
- **Scope taken on:** triage's guard-refused clauses, and the same clause in survey-task, survey-place and the blind read's read-only line (`04bb47598`, on John's ruling). Triage keeps its scope rule and "findings stay observations".
- **Re-pin:** `FROZEN_TOTAL_BYTES` 396064 (396884 on main), exactly the ceilings' sum. Real-context renders with proxy preambles fall 827520 → 825330 bytes (−2190). Exceptions: the four `work` kinds (blocked, breakdown, close-out, retrospective-audit) are byte-identical, and `seams-tangles` rises +24 from the committed-tool wording. Both are on John's replacement witness ruling `lin-4469-witness`, which gates merge.
- **Not verified:** the post-deploy 403 checks (a look-into token's comment POST, a triage token's description PATCH). Not claimed. Rollback is reverting PR #2447's merge commit.

## Comment on LIN-4469 at 23:15:58 (id a8749d0b) (this dispatch)

## LIN-4469 (piece 5): PR and status

PR: https://github.com/JKershaw/LinearViewer/pull/2447 (branch `feat/lin-4469-prompt-folds`), head `05b592742`.

**CI on the head:** green. Unit tests, Unit tests (proxy, clock +400d), E2E shards 1–4, Secret scan and `ci-success` all pass (run 43525065043).

**Done in this pass:** triage's guard-refused clauses folded; the retirement-line forms in `docs/areas/README.md` and `docs/architecture/dispatch-and-proxy.md` now point to `leftover-words.js`; the old committed change-coupling spelling is on the retired list (mutation-checked); re-pin to `FROZEN_TOTAL_BYTES` 396064 (equal to the ceilings' sum); witness regenerated.

**Measured:** real-context renders with proxy preambles, PR base to head: 827520 → 825330 bytes (−2190). Exceptions: the four `work` kinds are byte-identical, and `seams-tangles` is +24.

**Open before merge:** John's ruling `lin-4469-witness` on the four `work` kinds and the +24 (see the PR's DECISION section).

**Not verified:** the post-deploy 403 checks (look-into comment POST, triage description PATCH). Rollback is reverting the PR's merge commit.

## Comment on LIN-4469 at 23:16:04 (id ec59bd26) (the resumed first implementation, custom ac074b22)

## Follow-up on PR #2447 (John's ruling on the second DECISION)

- Commit 04bb47598: survey-task, survey-place and the blind read's read-only line drop the tracker clause the guard refuses ("tickets or Linear state" / "tickets or tracker state"). "code, branches or pull requests" stays in words. The blind read's piloted fixture takes the same one-line change; the pilot itself was not re-run.
- Ceilings: survey-task −23, survey-place −23, blind-read −24, prompt-template-defs.js source −70. `FROZEN_TOTAL_BYTES` 396559 → 396419.
- Another commit is on the branch, 05b592742 (KulchoAI): triage drops the description-rewrite and subtask clauses, the docs point to the retirement-line words, and the test's RETIRED list gains the committed change-coupling spelling. I did not author it; CI covers it.
- CI on 05b592742: `CI success` green, with unit tests, unit tests (proxy, clock +400d), 4 E2E shards and secret scan all passing.
- Still open for John: the first DECISION (accept the net fall for the eight kinds with no folded text: blocked, breakdown, close-out, look-into, triage, context, retro, retrospective-audit). They remain byte-identical.

## Not in the material

The corrected LIN-4350 comment (cited by review as `25b09538`); its text is not in the material.
