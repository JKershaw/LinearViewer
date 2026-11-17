# Answers (Reader T): LIN-4450, close-out, as of 2026-11-13T15:21:56Z

Source for everything: `ticket.md` only (LIN-4450 and its comments; parent LIN-4445 and its comments).

1. **Addressed to close-out:** Review's "Fix for close-out": in `tests/unit/jira-as-asked-region.test.js`, test "an oversized body is not sealed…" (~line 262), capture `console.log` around `sealForFiling` and assert exactly one line `[as-asked] seal skipped: provider jira cannot hold the block (test)`. The verdict is "Approve, conditional on close-out discharging the ledger". The Blind read (15:21) also lists three "fix-sized" items: the `workspace-api-audit.js:35-36` inline check, the `isTestToken` alias in `workspace-api-steps.js`, and deleting the header-phrase test at line 291. It addresses them to no stage by name, so I can't tell whether close-out must fix them or only record them.
   *Read:* the Review comment (15:18, "Fix for close-out", "Verdict") and the Blind read comment (15:21).

2. **Still open, and whose:**
   - The oversize log-line test fix: close-out.
   - Three post-deploy live checks (properties accepted on PUT/GET, digest survives an editor save below the block, first dispatch of a Jira-native ticket): LIN-4452, on John's site, after deploy.
   - Merge of PR #2421: review and orchestrator ("Merge is for review and the orchestrator").
   - LIN-4451 (session 2): blocked on this PR merging.
   - Bulk search path serves converted words: a decision. It already has a Waiting entry in `docs/areas/providers.md`, and the Blind read lists it as "larger".
   - The Blind read's three fix-sized items: no owner named.
   *Read:* the summary (14:13), Leftovers (15:11), the Review ledger and verdict, the Blind read.

3. **Empty-fence decision:** the codec now renders an empty fenced block as the bare fence, and the D1 write gate accepts an empty fence. Otherwise a Harbour-written block would refuse every later below-the-line write. Review judged Done-when's "D1's rich-content guard is unchanged" **met in substance**: no rich-content rule changed (mention/emoji/panel/media/table untouched), and only the codec-shape rule for an empty fence moved. D1 still refuses a codeBlock with empty text, with marks, with a blank line, or with an edge newline. The change is declared in "Size of the move" and on LIN-4445 (departure 4). Nothing after the Review reverses it, so **it still holds**.
   *Read:* Survey open-0 item 2, Size of the move, the LIN-4445 "where the code moved the plan" comment, the Review's "Regression check" and "Done when".

4. **Approval vs head:** yes. Review approves at head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`. The Blind read also read `f9fa4a80c`, and nothing records a later push. The approval is **conditional**: close-out makes the named test fix. That fix will move the head past `f9fa4a80c`, so the approval covers the work as it stands now, not the post-fix head.
   *Read:* the Leftovers comment (head, CI green), the Review header and verdict, the Blind read "Read:" line.

5. **Ledger count:** 3 post-deploy checks (the three "Inside" items under "What CI Did Not Prove"; a fourth bullet is the named rollback, not a check). **0** of them are merge conditions ("they are not merge conditions").
   *Read:* the Review, "What CI Did Not Prove" and "Verdict".

6. **`workspace-api-audit.js:35`:** it is not a merge condition, and Review does not require touching it: its predicate also matches `provider==='local'`, so it is not an identical sibling. The Blind read disagrees only about form. It calls the line a missed sibling and proposes a behaviour-preserving rewrite that keeps its own predicate: `isHermeticTestToken(workspace.accessToken) || (process.env.NODE_ENV === 'test' && workspace.provider === 'local')`. So close-out may leave it alone. If close-out touches it at all, it should use only that form, which keeps the local branch, never a straight swap. Whether close-out *should* make that tidy, I can't tell from the ticket.
   *Read:* the Review, "Scope against the plan", and the Blind read, "Inside the area, fix-sized".
