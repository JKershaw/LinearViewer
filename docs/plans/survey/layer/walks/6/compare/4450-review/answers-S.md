# Answers (Reader S, store): LIN-4450 (task-60), review stage, as of 2026-11-13T15:12:24Z

Read: `brief.txt`, `questions.md`, `model/BUILD-NOTES.md`. Queried `store.json` with `layer.mjs` (`show --task task-60`, `get`, `find --to review`, `find --in task-60 --state open`, `find --kind verdict`, `find --text`), all `--by review`.

1. **What is addressed to this stage?** Nothing is addressed to `review` by name: brief part 3 says "(none)" and `find --to review` returns `[]`. The work waiting for review is change-84, PR #2421 at head `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6`. It is open and linked `on` plan-54@2 and decision-81@1. run-83's summary says "Merge is for review and the orchestrator."
   *Source:* brief §3; `find --to review`; `get change-84`; run-83 account.

2. **What is still open on the task, and whose is each item?** Six records are open in task-60 (from `find --in task-60 --state open`):
   - check-69, John's: the live Jira probe of whether the digest survives an editor save below the line.
   - change-84, no owner set: PR #2421, open, not merged.
   - finding-79, area-1's: once the seal flips, D1 refuses live Jira-native tickets that hold a mention, emoji or panel.
   - finding-80, area-1's: comment weight in `index.js`, its own task.
   - finding-88, task-61's (LIN-4451): drop the proxy-integration line from plan-55's retire list. LIN-4451 is blocked until change-84 merges.
   - finding-89, task-62's (LIN-4452): the live check must be able to fail on digest drift.

   Everything else in the task is ended: question-67 and question-68 are answered, and findings 70, 71 and 73–78 are done, declined or handed on.
   *Source:* `find --in task-60 --state open`; `show --task task-60`.

3. **Is the 32,768-character size limit still the rule?** No. decision-86 (implementation, stands) replaced it. The limit is now 32,768 **UTF-8 bytes of the serialized property**, JSON escaping included, checked in one shared size function that both the seal check and the 422 use. decision-86 is `on` decision-63@1, which carried the "32,768-character" wording. The PR body says the same.
   *Source:* decision-86; decision-63; finding-71's end reason; run-83 (departure 2).

4. **Does an approval or verdict cover the PR's current head?** No. The PR's current head is `f9fa4a80ca19503bebbf5abd81dc83d3e86296b6` (change-84 v2, revised by leftover at 14:14). The only verdicts in the store are verdict-57, 58 and 59, plan-review approvals of plan-54@2, plan-55@2 and plan-56@2. They approve the plan, not the code. No review verdict exists on change-84. The leftover account says CI is green on f9fa4a80, but a CI result is not a review approval. Implementation's summary cited an earlier commit (`a98d042c6`), and the leftovers commit moved the head past it.
   *Source:* `find --kind verdict`; `get change-84`; run-83 and run-90 accounts.
   *Caution:* run-90's account in brief §8 also contains a squash-merge commit dated 15:32, after this moment, with "close-out fixes from review". That is later than the moment, so I did not count it as a verdict.

5. **How many departures did the builder record on LIN-4445?** Five. The departure comment on LIN-4445 at 14:08:01 lists five numbered items:
   1. End line chosen by digest.
   2. Size limit in bytes.
   3. The round trip throws on a block Jira cannot hold.
   4. Empty fence fixed in the codec.
   5. Every `getIssue` asks for the property.

   Caveat: only items 1–3 are true departures from the plan, and the store's decisions 85, 86 and 87 call them "departure 1/2/3 on LIN-4445". Item 4 was decided by scoping (decision-81), and item 5 is review note 2.
   *Source:* run-83 account; decisions 85, 86 and 87.

6. **Do Harbour-written bodies never trip D1?** No, not in general. Survey global (run-72) probed only the witness shapes. question-68 and finding-78 show the empty fenced code block (an opening ``` with the closing ``` on the next line): `markdownToAdf` emits an empty codeBlock, D1 refuses it, and it is not a fixed point. finding-78 itself says the claim "holds for those shapes only, not in general". decision-81 had the codec fixed first. change-84 renders an empty fence as the bare fence and the write gate accepts it, but as of this moment that fix sits in the open PR and is not merged. Separately, D1 still refuses live Jira-native tickets that hold a mention, emoji or panel (finding-79). Those are not Harbour-written bodies, but the first-dispatch seal will write back to them.
   *Source:* question-68; finding-78; decision-81; run-72; run-83; finding-79.
