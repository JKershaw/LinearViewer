# Answers H (ticket plus facts): LIN-4450, close-out, as of 2026-11-13T15:21:56Z

Read: `ticket-plus-facts.md` (all of it) and `questions.md`. Nothing else.

## 1. What is addressed to this stage to act on?

Four open findings addressed to close-out:
- **finding-97** (from review, the one condition of verdict-96): in `tests/unit/jira-as-asked-region.test.js`, test "an oversized body is not sealed…" (~line 262), capture `console.log` during `sealForFiling` and assert exactly one line equal to `[as-asked] seal skipped: provider jira cannot hold the block (test)`.
- **finding-105** (blind read): `routes/workspace-api-audit.js:35-36` still has the test-token check inline. Proposed fix: `isHermeticTestToken(workspace.accessToken) || (process.env.NODE_ENV === 'test' && workspace.provider === 'local')`.
- **finding-106** (blind read): drop the `isTestToken` alias in `routes/workspace-api-steps.js`. Its callers (`workspace-api-issue-read.js`, `-issue-write.js`, `-prompts.js`) should import `isHermeticTestToken` directly.
- **finding-107** (blind read): delete the comment-header test at line 291 of `jira-as-asked-region.test.js` ("no longer claim that Jira is skipped").

Only finding-97 is a condition of the approval. The other three are fix-sized suggestions that close-out should apply or decline with a reason.

Source: facts §3; review comment "Fix for close-out"; Blind read comment.

## 2. What is still open on the task, and whose is each item?

- The four findings in Q1 belong to **close-out**.
- Three post-deploy live checks belong to **LIN-4452 / task-62**. They need John's Jira credential, which no build session has:
  - check-98: the edit PUT accepts `properties` and the GET returns them;
  - check-99: Jira's editor keeps the region's rendering and digest across an edit below the block;
  - check-100: the first-dispatch seal on a Jira-native ticket, with dispatch continuing either way.
- Merging PR #2421 belongs to **review and the orchestrator** ("Merge is for review and the orchestrator", from the summary comment).
- finding-101 belongs to **LIN-4451 / task-61**. createIssue must write through `holdAsAsked`, the retire list should be trimmed, and LIN-4451 stays blocked until the merge.
- The bulk search path serving converted words is homed as a Waiting entry in `docs/areas/providers.md` (finding-91, in the **Providers** area). It is not this task's.

Source: facts §3 and §7; review "What CI Did Not Prove" and Verdict; summary comment.

## 3. The empty fence and "D1's rich-content guard is unchanged": what was decided, and does it still hold?

**What was decided.** Scoping recorded decision-81 under "Size of the move" ("a small tidy … done first"): fix the codec rather than exclude the input. An empty fenced block now renders as the bare fence, and the D1 write gate accepts an empty fence. Without the fix, a Harbour-written block holding an empty fence would leave a ticket that refuses every later below-the-line write.

**How review judged it.** Review counted the Done-when clause as "met in substance". No rich-content rule changed (mention, emoji, panel and the rest are untouched). Only the codec-shape rule for an empty fence changed, and that change is declared.

**Does it still hold?** Yes. decision-81 is [stands], and verdict-96 rests on decision-81@1. D1 still refuses an empty-text, marked, blank-line or edge-newline codeBlock.

Source: ticket "Size of the move"; facts decision-81 and verdict-96; review "Regression check" and "Done when".

## 4. Does an approval cover the work as it now stands? Name the head.

Yes. Review's verdict-96 is "approve-with-notes" at head **`f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`** (change-84@2). That is the head named in the Leftovers comment, with CI green. Nothing in the records shows a newer version of change-84. The blind read (verdict-104, "better") is also on change-84@2.

The approval is conditional on close-out making the finding-97 test fix. Any close-out commit will move the head past `f9fa4a80c`, so the approval will then rest on an older version.

Source: facts verdict-96 and verdict-104 (`on → change-84@2`); Leftovers and Review comments.

## 5. How many post-deploy checks are in review's ledger, and how many are merge conditions?

**Three** post-deploy checks (check-98, check-99 and check-100, all for task-62 / LIN-4452). **None** is a merge condition: the verdict says "they are not merge conditions". The ledger also names a rollback (revert the squash commit), but that is not a check.

Source: review "What CI Did Not Prove" and Verdict; facts §7.

## 6. `routes/workspace-api-audit.js:35` is "a different predicate, not a sibling". Should close-out leave it alone?

No, not silently. finding-105 is open and addressed to close-out, so close-out must either apply it or decline it with a reason.

Review and the blind read agree on the facts. The line's predicate also matches `provider === 'local'`, so it cannot be swapped wholesale. The blind read's fix keeps that branch: `isHermeticTestToken(token) || (NODE_ENV === 'test' && provider === 'local')`. That is logically identical to `NODE_ENV === 'test' && (token === 'test-token' || provider === 'local')`. Review's "not a sibling" only explains why the sweep didn't touch it. It does not rule the fix out. If close-out applies the fix, it should confirm the behaviour is identical.

Source: review "Scope against the plan"; Blind read "Inside the area, fix-sized"; facts finding-105.

## Where the ticket and the facts disagree

They don't conflict. The facts add record ids and status:
- the four findings are [open] and addressed to close-out;
- every decision and verdict is [stands];
- the verdicts sit on change-84@2.

The facts also state verdict-96's condition more broadly than the comment does: "conditional on close-out making the one named test fix and on LIN-4452 discharging the live-check ledger". The review comment itself says the ledger items are not merge conditions. Both say the live checks are post-deploy, so I trust the comment's plainer reading: the only close-out condition is the test fix.
