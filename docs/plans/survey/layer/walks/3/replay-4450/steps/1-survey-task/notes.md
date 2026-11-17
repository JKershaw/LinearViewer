# survey-task, task-60 (LIN-4450): replay notes

**Records written** (13:47:23–13:47:31Z)
- finding-66 → task-60: the end-line rule differs between the node rule and `hasMarkerLine`/`splitAsAsked`. `on plan-54@2`.
- finding-67 → area-1: the `adf.js` header claim about D1 is false (an empty fence gives an empty `codeBlock`). This is a lasting codec fact, so it goes to the area.
- finding-68 → task-60: the fixed-point test needs a deliberate fix or exclusion. `about finding-67`, `on plan-54@2`.
- check-69 → John: a 15-minute live Jira probe before any code. `about plan-56`, `on plan-54@2`.
- finding-70 → task-60: search reads and `getIssue` reads diverge.
- finding-71 → task-60: measure the serialized property against the size limit.
- run-72: my account, `on plan-54@2`, ended `done`.

**Looked up:** `show --task task-60` and `find --to task-60` (empty), to see what was already addressed. `find --to area-1` (empty). `find --text` on end line, codeBlock, fence, live, digest, normalis, D1, empty, search, probe, to avoid duplicates. "normalis" turned up plan-56 item 12, which already plans a live normalisation check, but in session 3 after the build. So I linked check-69 to it rather than restating it. Nothing addressed to me, so nothing to close.

**Refusals:** none.

**What my real output used that neither the brief nor a query gave me:** that `origin/main` = 4b5001ddf and the actual line numbers. The results of running the codec (empty fence, `rt(rt(x))`, `*em*`→`_em_` and the rest). How `hasMarkerLine` and `sealForFiling` work, and the `adf.js` header text. That `fake-client.js` merges `fields`. The fact that LIN-2019 drops empty paragraphs. Atlassian's docs being inconsistent on bytes vs characters. All of it came from the repo and running code.

**What the brief carried that I didn't need:** lessons 5, 6, 16 and 47, and most of task-53's wording (Periodical, last-step filing).

**What I couldn't place:** no record kind holds "grounding commit plus line numbers still hold". I put it in finding-66 and the run account.
