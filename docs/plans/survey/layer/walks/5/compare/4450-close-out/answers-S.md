# Answers (Reader S, store): LIN-4450 close-out, as of 2026-11-13T15:21:56Z

1. **Addressed to close-out:** four open findings.
   - finding-97 (review): the one condition of verdict-96. In `tests/unit/jira-as-asked-region.test.js`, oversized-body test (~line 262), capture console.log and assert exactly one line `[as-asked] seal skipped: provider jira cannot hold the block (test)`.
   - finding-105 (blind-read): `routes/workspace-api-audit.js:35-36` still inlines the test-token check. Use `isHermeticTestToken(...) || (NODE_ENV==='test' && provider==='local')`.
   - finding-106 (blind-read): drop the `isTestToken` alias in `routes/workspace-api-steps.js`. Its callers import `isHermeticTestToken` directly.
   - finding-107 (blind-read): delete the comment-header test at line 291 of `jira-as-asked-region.test.js`.

   *Read:* brief part 3; `show --task task-60`; `find --to close-out`.

2. **Still open:**
   - The four findings above (97, 105, 106, 107) belong to close-out.
   - change-84, PR #2421, is open and unmerged. Merging it is close-out's job.
   - check-98, check-99 and check-100 (live Jira checks) were written by review and belong to task-62 (LIN-4452).
   - finding-101 (createIssue goes through holdAsAsked, trim the retire list, unblocked on merge) belongs to task-61 (LIN-4451).
   - Off the task but still open: finding-79, finding-80 and finding-91 belong to area-1. check-69 was handed on to John and folded into check-99. finding-70, finding-73, finding-88 and finding-89 are handed on, not open.

   *Read:* `show --task task-60`; `get run-102`; `get finding-91`.

3. **Empty-fence decision:** decision-81 (scoping, stands, answers question-68). The codec was fixed first, so an empty fenced code block no longer files a description that D1 refuses on every later below-the-line write. The input was not excluded. The decision still holds. verdict-96 (stands) says "D1 unchanged" is met in substance: no rich-content rule changed, only the empty-codeBlock shape rule, which was declared under Size of the move. D1 still refuses an empty-text, marked, blank-line or edge-newline codeBlock.

   *Read:* brief part 4; `show` (question-68 answered).

4. **Approval on the current head:** yes, as of now. verdict-96 (review, approve-with-notes, stands) is on change-84@2. Its head is `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6` (f9fa4a80c), and change-84 has no later version. verdict-104 (blind-read, "better") is also on change-84@2. The approval is conditional on close-out making finding-97's test fix. Any close-out commit will move the head past f9fa4a80c.

   *Read:* `get change-84` (versions), `get verdict-96`.

5. **Ledger counts:** 3 post-deploy checks (check-98, check-99, check-100, all to task-62/LIN-4452). 0 of them are merge conditions: verdict-96 calls them "post-deploy steps, not merge conditions". The only merge condition is the finding-97 test fix.

   *Read:* `get verdict-96`, `get check-98/99/100`, `get run-102`.

6. **workspace-api-audit.js:** partly can't tell. The store has no record of review saying `:35` is a different predicate. verdict-96 only says the consolidation is "behaviour-identical at every call site". The store does hold finding-105: open, addressed to close-out by blind-read, and calling it a missed sibling. Its proposed fix moves only the token half onto `isHermeticTestToken` and keeps the file's own local-provider arm ("keeps its own predicate, as its comment asks").

   Close-out should not silently ignore it, because an open finding is addressed to it. Whether to apply the fix or decline it depends on whether the elided `…` in the inline token check matches `isHermeticTestToken` exactly. The store doesn't show that, so I can't confirm it is safe to change or that review's claim is right.

   *Read:* `find --text audit`, `find --text predicate`, `get finding-105`, `get verdict-96`, `get finding-22`.
