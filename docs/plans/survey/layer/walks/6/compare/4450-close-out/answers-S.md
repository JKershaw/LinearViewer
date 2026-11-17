# Answers (Reader S, store), LIN-4450 close-out, as of 2026-11-13T15:21:56Z

CLI: `walks/6/model/layer.mjs`, `--by close-out --store 4450-close-out/store.json`.

1. **Addressed to close-out:** four open findings.
   - finding-97 (review). This is verdict-96's one condition: in `tests/unit/jira-as-asked-region.test.js`, the "oversized body is not sealed…" test (~l.262) must capture console.log during `sealForFiling` and assert exactly one line `[as-asked] seal skipped: provider jira cannot hold the block (test)`.
   - finding-105 (blind-read). Move `routes/workspace-api-audit.js` l.35-36 onto `isHermeticTestToken(...) || (NODE_ENV==='test' && provider==='local')`.
   - finding-106 (blind-read). Drop the `isTestToken` alias in `workspace-api-steps.js`; its callers import the helper directly.
   - finding-107 (blind-read). Delete the header-phrase test at l.291 of `jira-as-asked-region.test.js`.
   - *Read:* brief part 3; `show --task task-60`.

2. **Still open on the task:**
   - finding-97 and finding-105/106/107 belong to close-out.
   - check-98, check-99 and check-100 (the live-Jira checks) are addressed to task-62 (LIN-4452).
   - finding-101 (createIssue goes through holdAsAsked, the retire-list trim, and LIN-4451 being blocked until merge) is addressed to task-61 (LIN-4451).
   - finding-79 (live D1 refusals or normalisation after the seal flips) and finding-80 (comment weight in `index.js`) are addressed to area-1, Providers.
   - change-84 (PR #2421) is still open, so it is unmerged. The task itself is open.
   - *Read:* `show --task task-60` (states and `to`), brief parts 3 and 7.

3. **Empty-fence decision:** decision-81 (scoping), state *stands*.
   - It fixes the codec, rather than excluding the input, so an empty fenced code block no longer files a codeBlock that D1 refuses. Otherwise the ticket could never be written below the line again. It answers question-68.
   - Review (verdict-96, run-102) judged "D1's rich-content guard is unchanged" as **met in substance**. No rich-content rule changed (mention, emoji, panel and so on are untouched). Only the empty-codeBlock shape rule changed, because its old reason (the renderer printed a split fence) no longer applies. D1 still refuses an empty-text, marked, blank-line or edge-newline codeBlock.
   - It still holds: it is not stale, and verdict-96 pins decision-81@1.
   - *Read:* brief part 4; `get run-102`.

4. **Approval at the current head:** yes.
   - verdict-96 (review, approve-with-notes, stands) sits on change-84@2. That version is the current one: head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6` (v1 was a98d042c6). There is no stale flag.
   - It is conditional on close-out's finding-97 test fix. Once close-out pushes, the head moves past what review saw.
   - verdict-104 (blind-read, "better") is on the same change-84@2.
   - *Read:* `get change-84` (versions), `show --task task-60`.

5. **Ledger count: three post-deploy checks, none of them merge conditions.**
   - The three checks are check-98 (the property is accepted and returned), check-99 (the editor keeps the rendering and digest) and check-100 (first dispatch continues).
   - All three are addressed to task-62 (LIN-4452).
   - verdict-96 says: "post-deploy steps, not merge conditions."
   - The only merge-side condition is close-out's test fix.
   - *Read:* brief parts 4 and 7; run-102 "What CI Did Not Prove" and "Verdict".

6. **Leave `workspace-api-audit.js` alone? Not necessarily.**
   - Review's point (run-102) was only that the inline check also matches `provider==='local'`, so the sweep was right not to fold it in as an identical sibling.
   - finding-105 (blind-read, open, addressed to close-out) keeps that local branch. Its fix swaps only the token half onto `isHermeticTestToken` and leaves the predicate's own `provider==='local'` arm in place.
   - Review states the token half is behaviour-identical (`NODE_ENV==='test' && token==='test-token'`), so the two readings don't conflict. It is a fix-sized tidy close-out may make.
   - It is not one of verdict-96's merge conditions; only finding-97 is.
   - **Can't tell from the store:** whether the elided "…" in the audit line holds anything besides the local arm.
   - *Read:* brief part 3 (finding-105); `get run-102` (Scope); `find --text audit`.
