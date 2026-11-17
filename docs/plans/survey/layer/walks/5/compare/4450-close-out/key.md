# Key: LIN-4450, close-out stage, as of 2026-11-13T15:21:56Z

At this moment LIN-4450 is In Progress. Its description is `## As asked` plus "Size of the move". It has six comments:
- Survey open-0 (13:47)
- Survey global (13:51)
- the summary (14:13)
- Leftovers (15:11)
- Review (15:18:12)
- Blind read (15:21:22)

PR #2421 is open at head `f9fa4a80c` and not merged. It was merged later, at 15:32:12.

## 1. What is addressed to this stage to act on?

**Answer:**
- **Review's "Fix for close-out":** in `tests/unit/jira-as-asked-region.test.js`, in the oversize test, capture `console.log` and assert exactly one line, `[as-asked] seal skipped: provider jira cannot hold the block (test)`.
- **Review's verdict:** it is conditional on close-out "discharging the ledger", meaning the three post-deploy checks in "What CI Did Not Prove". Merging also unblocks LIN-4451.
- **Blind read's three fix-sized items:**
  - `routes/workspace-api-audit.js:35–36` should use `isHermeticTestToken`;
  - the `isTestToken` alias should be dropped from `routes/workspace-api-steps.js`;
  - the comment-phrase test at line 291 should be deleted.

**Shown in:** LIN-4450 Review comment (15:18:12, "Fix for close-out", "What CI Did Not Prove", "Verdict"); Blind read comment (15:21:22, "Inside the area, fix-sized").

## 2. What is still open on the task, and whose is each item?

**Answer:**
- Close-out owns:
  - review's named test fix;
  - the three blind-read fix-sized items;
  - the merge and the deploy.
- LIN-4452 owns the three ledger checks. They need a real Jira site and a credential, and they are not merge conditions:
  - live property PUT/GET;
  - the digest surviving a Jira editor save below the block;
  - the first dispatch of a never-dispatched Jira-native ticket.
- LIN-4451 is blocked until this PR merges. `createIssue` calling `holdAsAsked` is also LIN-4451's.
- Bulk reads serve converted words (blind read's "larger" item). It is a decision, and its home is the Waiting entry in `docs/areas/providers.md`.

**Shown in:** Review comment ("Fix for close-out", "What CI Did Not Prove", "Isolated, or one of a class?", "Verdict"); Blind read comment ("Inside the area, larger", "Outside the area: None"); Leftovers comment (last bullet).

## 3. Done-when requires "D1's rich-content guard is unchanged", yet the PR changes how D1 treats an empty fence. What was decided, and does it still hold?

**Answer:** Review judged this "met in substance". No rich-content rule changed. The one change is the codec-shape rule for an empty fence, and it is declared in "Size of the move" and on LIN-4445. It still holds: nothing after the review disputes it, and the blind read does not raise it.

**Shown in:** Review comment, "Done when" ("met in substance") and "Verdict" ("One departure is declared"); LIN-4450 "Size of the move"; LIN-4445 departure comment (14:08:01), item 4.

## 4. Does an approval cover the work as it now stands (the PR's current head)? Name the head.

**Answer:** Yes. Review approved at head `f9fa4a80c`, and that is still the head. The approval is "Approve — conditional on close-out discharging the ledger". CI is green on `f9fa4a80c` (ci-success, unit, proxy clock +400d, E2E 1–4/4, secret scan), and the blind read also read `f9fa4a80c`. Any commit close-out adds comes after the approval and is not re-reviewed.

**Shown in:** Review comment (first paragraph, "CI", "Verdict"); Blind read comment ("Read: … at `f9fa4a80c`"); Leftovers comment (15:11:36, head `f9fa4a80c`).

## 5. How many post-deploy checks does review's ledger list, and how many of them are merge conditions?

**Answer:** 3 checks, and none of them is a merge condition. The checks are:
1. property PUT/GET;
2. the digest surviving an editor save below the block;
3. the first dispatch of a Jira-native ticket.

The Rollback entry is listed separately and is not a check.

**Shown in:** Review comment, "What CI Did Not Prove" (three "Inside" items plus "Rollback (named)"), and "Verdict" ("they are not merge conditions").

## 6. Review said `routes/workspace-api-audit.js:35` is a different predicate and not a sibling of the test-token sweep. Should close-out leave it alone?

**Answer:** No. The blind read says the sweep missed it. Its test-token half should call `isHermeticTestToken`, while it keeps its own `provider==='local'` alternative. Both readings agree that the predicate stays distinct. Only the duplicated test-token expression moves onto the helper. The Leftovers commit had also said audit.js "keeps its own predicate on purpose".

**Shown in:** Review comment, "Scope against the plan" (`workspace-api-audit.js:35` "is not a sibling"); Blind read comment, "Inside the area, fix-sized", first bullet (the fix is `isHermeticTestToken(workspace.accessToken) || (process.env.NODE_ENV === 'test' && workspace.provider === 'local')`).
