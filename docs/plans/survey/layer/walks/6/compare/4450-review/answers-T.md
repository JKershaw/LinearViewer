# Answers (Reader T): LIN-4450, review stage, as of 2026-11-13T15:12:24Z

Read: `ticket.md` (LIN-4450 description and comments; LIN-4445 description and comments) and `questions.md`. Nothing else.

1. **What is addressed to this stage?** Review PR #2421 (branch `feat/lin-4450-jira-as-asked-seal`) at its current head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`, against LIN-4450's ask (session 1, items 1–6 plus review notes 2, 3, 6) and the departures recorded on LIN-4445. The summary says "Merge is for review and the orchestrator."
   *Source:* LIN-4450 comments "LIN-4450: summary" (14:13) and "Leftovers" (15:11); LIN-4450 description.

2. **What is still open, and whose?**
   - Review and merge of PR #2421: this review stage, then the orchestrator.
   - Live check on John's Jira (does the rendered digest survive an editor save below the block; byte equality with lossy constructs): LIN-4452 (session 3), needs John's credential.
   - LIN-4451 (session 2, createIssue): blocked on this PR merging.
   - Bulk reads (`fetchProjects`, `fetchIssueContext` children) serve converted words, not exact words: noted in `docs/areas/providers.md`, no owner beyond that note.
   - Can't tell from the ticket whether Survey global's extra items (`dispatch-factory.js:1008`, `docs/proxy-integration.md:2070`, source-map, the `reason: 'provider'` branch witness) were done; the proxy-integration line is in LIN-4451's retire list.
   *Source:* LIN-4450 summary and Leftovers comments; LIN-4445 Breakdown table and "Session 1 … where the code moved the plan" comment; LIN-4450 Survey global.

3. **Is 32,768 characters still the rule?** No. The builder enforces 32,768 on UTF-8 **bytes** of the serialized property (JSON escaping included), the stricter reading, citing Atlassian's entity-properties page.
   *Source:* LIN-4445 comment 14:08, departure 2.

4. **Does an approval cover the current head?** No review verdict covers head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`. The only approval is the Plan Review Verdict (rev 1, comment 61e84035), and it covers the plan, not the code. The PR summary named commit `a98d042c6`; the head has since moved (leftover tidies plus the `should-mock-ai.js` retire). CI is green on `f9fa4a80…` (one job rerun after a runner loss), but CI is not a verdict.
   *Source:* LIN-4445 Plan Review Verdict and Breakdown; LIN-4450 summary and Leftovers comments.

5. **How many departures did the builder record on LIN-4445?** Five, numbered 1–5. Item 5 (every `getIssue` asks for the property) follows review note 2, so strictly four depart from the approved plan as amended by review.
   *Source:* LIN-4445 comment 14:08.

6. **Do Harbour-written bodies never trip D1?** Not at the grounding commit. LIN-4450's Survey open-0 found an empty fence ("```" then "```") makes `markdownToAdf` emit an empty `codeBlock`. D1 refuses it, and the fixed point fails. Neither Plan Review's 13 samples nor Survey global's probes included it. The builder fixed it in the codec (the empty fence renders as a bare fence, and the gate accepts it), so it should hold on the PR head. That rests on the builder's word and its regression test. Nothing I read independently confirms it.
   *Source:* LIN-4450 Survey open-0 point 2; LIN-4450 Survey global; LIN-4445 Plan Review Verdict; LIN-4445 comment 14:08, departure 4; LIN-4450 summary ("Also fixed").
