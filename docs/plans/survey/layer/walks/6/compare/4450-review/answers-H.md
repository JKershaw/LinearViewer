# Answers: Reader H (ticket plus facts), LIN-4450 review stage

Read: `ticket-plus-facts.md` only (the ticket, the parent LIN-4445, then the computed facts).

## 1. What is addressed to this stage to act on?

No record is addressed to the review stage itself. The facts say "3. Addressed to it: (none)". The work to review is still clear from the ticket. It is PR #2421 (branch `feat/lin-4450-jira-as-asked-seal`), now at head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`, with CI green on that head. The summary comment says "Merge is for review and the orchestrator."

Read: the facts, section 3; the LIN-4450 comments "summary" (14:13) and "Leftovers" (15:11).
Disagreement: the facts list nothing, but the ticket hands the PR on for review. I trust both. The facts mean no record names this stage, and the ticket says what the stage reviews.

## 2. What is still open on the task, and whose is each item?

- Reviewing and merging PR #2421: review and the orchestrator (summary comment).
- The live check on John's Jira: does the rendered digest survive an ordinary editor save below the block? This is LIN-4452 (session 3) and needs John's credential. finding-89 points it at task-62 (LIN-4452), and the check has to be able to fail.
- check-69, addressed to John: the 15-minute live probe that Survey open-0 asked for before any code was written. It was never run (the builder had no credential), so it is still open with John and LIN-4452 now covers it.
- LIN-4451 (session 2) is blocked until this PR merges. finding-88 tells it to drop the proxy-integration.md "Jira files unsealed" line from its retire list.
- Area items for Providers, not this task's to close: finding-79 (first-dispatch seal on live tickets: D1 refusals and normalised words), finding-80 (comment weight in `index.js`), and the bulk-read note in `docs/areas/providers.md`.

Read: the facts, section 7 (check-69, finding-79/80/88/89); the summary and Leftovers comments; the "Session 1 … where the code moved the plan" comment on LIN-4445.

## 3. Plan review set the property size limit at 32,768 characters. Is that still the rule?

No. Decision-86, which stands, enforces it as 32,768 UTF-8 bytes of the serialized property, JSON escaping included. One shared size function serves both the seal check and the 422. This is departure 2 on LIN-4445: Atlassian's pages disagree on bytes versus characters, so the stricter reading was taken.

Read: the facts, decision-86; LIN-4445's departures comment, item 2.

## 4. Does any approval or verdict cover the work as it now stands (the PR's current head)? Name the head.

No. The only verdict is plan-review's Approve (verdict-57), which covers the plan (plan-54@2) and not the code. Nothing has reviewed or approved PR #2421 at its current head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`. The summary comment named an earlier commit, `a98d042c6`, and the Leftovers commit moved the head after that. Green CI on `f9fa4a80…` is a check, not an approval.

Read: the facts, section 4 (verdict-57 "on → plan-54@2"); the summary and Leftovers comments.

## 5. How many departures from the approved plan did the builder record on LIN-4445?

Five. That is how many numbered items the builder's LIN-4445 comment lists under "with these departures":
1. the end line is chosen by digest
2. the size limit is in bytes
3. the round trip throws
4. the empty-fence codec fix
5. every `getIssue` asks for the property

One caveat: the facts record only items 1–3 as "Departure 1/2/3 on LIN-4445" (decisions 85–87). Item 5 is really plan-review note 2, which the breakdown had already folded into this piece. Item 4 was taken into scope by scoping (decision-81). So by the facts' count, three departures go beyond what was approved. I trust the comment for what was recorded, which is 5.

Read: LIN-4445 comment 14:08 ("Session 1 (LIN-4450): where the code moved the plan"); the facts, decisions 81 and 85–87.

## 6. Plan review and Survey global say Harbour-written bodies never trip D1. Does that hold?

It did not hold at `4b5001ddf`. Survey open-0 on LIN-4450 found that an empty fence (a line of ``` followed by another ``` on the next line) makes `markdownToAdf` emit an empty `codeBlock`. D1 refuses that block, and the fixed point fails on it too. Every later below-the-line write would then 422. The builder fixed the codec in this PR: an empty fence now renders as the bare fence and the gate accepts it (departure 4, decision-81). The claim should hold on the PR head, but only the builder's unit tests show that, and nothing independent has confirmed it. Bodies that humans edit in Jira can still trip D1 with mentions, emoji or panels (finding-79), but those are not Harbour-written.

Read: the LIN-4450 Survey open-0 comment, point 2; the Plan Review Verdict ("The D1 premise holds"); Survey global; the LIN-4445 departures comment, item 4; the facts, decision-81 and finding-79.
