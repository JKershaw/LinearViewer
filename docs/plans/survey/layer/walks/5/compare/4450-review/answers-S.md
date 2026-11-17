# Answers (Reader S, store): LIN-4450 / task-60, review stage, as of 2026-11-13T15:12:24Z

1. **Addressed to this stage:** No record is addressed to review (brief part 3 "addressed to you: none"; `find --to review` returns `[]`). The work in front of review is the open change: PR #2421 (change-84), head f9fa4a80c, which implementation left for review ("Merge left to review and orchestrator", run-83).
   *Read:* brief.txt part 3; `find --to review`; `get change-84`; `get run-83`.

2. **Still open on the task, and whose:**
   - change-84 (PR #2421): open, awaiting review/merge.
   - check-69: to John. A live probe on a real Jira site: does the rendered digest survive ordinary saves?
   - finding-89: to task-62. The same live-check risk; no credential for John's Jira in this build.
   - finding-88: to task-61. Drop the proxy-integration.md line from plan-55 item 10; LIN-4451 is blocked until change-84 merges.
   - finding-79 and finding-80: to area-1, beyond this task (D1 on live Jira-native tickets; index.js comment weight).
   - Also open in area-1, about change-84: finding-91 (bulk reads don't ask for `harbour.asAsked`), a Waiting entry.
   - Everything else in the task is done, declined or handed on: questions 67/68 answered; findings 70/73 handed on; 74 declined; 71/75–78 done.
   *Read:* `show --task task-60`; `find --state open --in task-60`; `get finding-91`; `get run-90`.

3. **32,768 characters still the rule?** No. decision-86 (implementation, stands) replaced it: the rule is now 32,768 **UTF-8 bytes of the serialized property, JSON escaping included**. One shared size function serves both the seal check and the 422. This is Departure 2 on LIN-4445.
   *Read:* brief part 4 (decision-63, decision-86); `show`.

4. **Approval covering the current head?** No. The only verdicts are plan-review approvals of the plans: verdict-57 on plan-54@2, and 58/59 on plans 55/56. No verdict covers change-84. The current head is **f9fa4a80ca19503bebbf5abd81dc83d3e86296b6** (change-84 v2, leftover commit). The store reports CI green on it after one runner-loss rerun. The earlier head was a98d042c6.
   *Read:* `find --kind verdict`; `get change-84`.

5. **Departures recorded on LIN-4445:** **3**. They are decision-85 (end line chosen by digest), decision-86 (limit in UTF-8 bytes) and decision-87 (round trip throws on an unholdable block). These are Departures 1–3, and run-83 lists the same three.
   *Read:* brief part 4; `find --text departure`; `get run-83`.

6. **"Harbour-written bodies never trip D1": does it hold?** No, not in general. An empty fenced code block (``` with ``` on the next line) makes `markdownToAdf` emit an empty codeBlock that D1 refuses (question-68). finding-78 scoped the claim to the tested shapes only. Scoping chose to fix the codec first (decision-81), and run-83 says the empty fence was fixed in the codec in PR #2421. So the claim was false at 4b5001ddf, and it holds after the fix only according to the builder's account. The store records no independent witness. D1 also refuses Jira-native tickets with mentions, emoji or panels (finding-79), but those bodies are not Harbour-written.
   *Read:* `show` (question-68, finding-78, decision-81, finding-79); `get run-83`.
