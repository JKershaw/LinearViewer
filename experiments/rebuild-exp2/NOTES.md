# Rebuild experiments: lab notebook

A running record kept by the Flight Companion, as John asked on 15 Oct ("Keep your own notes as we go"). Entries are newest last. Facts are separated from inference, and inference is labelled.

## 15 Oct: experiment 1 (`adf.js`) finished

The results are in `../rebuild-exp1/results.md`. In short:

- A (informed, Harbour) is exactly equivalent and modestly cleaner.
- B (clean room, solo) is cleaner by every measure. It fixes many old bugs and has one display regression (links with brackets) that 17,019 tests missed.

**Lesson (inference):** A's timidity came from *seeing the old code*. It built its own oracle and copied the old behaviour. It did not come from Harbour's pipeline, whose review and close-out helped.

## 15 Oct: experiment 2 agreed

John: "I wonder if the next experiment can use a clean room but run through Harbour. Which is possible precisely because we can instruct an agent to itself user sub agent in its own clean environment. And I wonder if we structure the tasks such that the tests are kind of reviewed in advance so that we know that the tests are well balanced and have correct coverage. We could even run the task on this code again and see if we get closer to the clean room experimental results which are currently only here."

Then: "Let's go with both. And sure, we can fix bugs. Folding into 2b is a good idea. Keep your own notes as we go. And good question on subagents Vs some other mechanism. I suspect there's a fairly simple way to do this and get good results."

**Plan:**

- **2a.** A clean room through Harbour, with arm B's exact inputs: the same `SPEC.md`, byte for byte, and the same 133 tests. Then a replay against today's code decides what ships: keep fixes, fix regressions, raise anything unclear.
- **2b.**
  1. A test-review ticket first. It closes the output-changing survivors of the planted faults, puts a display test on each recorded decision, and folds in B's 18 regression groups and the bracket display. It doesn't pin known bugs (bug fixes are allowed).
  2. Then a clean room through Harbour again, on the stronger contract.

**Order:** 2a, then 2b's test review, then 2b's rebuild, one at a time, because they touch the same file.

**Bug policy (John: "sure, we can fix bugs"):** a fix is kept where today's output contradicts its own recorded decisions or ADF/CommonMark, and it is listed in the PR. Regressions are fixed. Anything unclear is raised.

## 15 Oct: the isolation mechanism (the "simple way")

**Facts:**

- Harbour's sessions are Claude Code sessions run by the Simple Dispatcher, and they can use sub-agents. SD's `heartbeat.js` counts Agent-tool calls as "delegating", and `transcript.js` counts sub-agent ("sidechain") spend.
- Claude Code writes each sub-agent's full transcript to `~/.claude/projects/<cwd-slug>/<session-id>/subagents/agent-<id>.jsonl`. This session's are there.

**Mechanism:**

1. The worker extracts a sealed folder outside the repository.
2. It launches one sub-agent with the brief.
3. It runs `tools/audit-subagent.mjs` on that sub-agent's transcript.

**The audit flags:**

- any absolute path outside the room;
- any shell command that doesn't begin by entering the room (relative paths would otherwise resolve against the repository checkout);
- `..`;
- git;
- web use beyond the two documentation hosts;
- Glob or Grep without a path;
- unexpected tools.

**Tested:** arm B's real transcript passes (16 calls, 0 violations). A non-clean transcript (the baseline kit agent) is flagged (240 violations).

**Limits:**

- Isolation is by instruction plus audit, not by sandbox. A sub-agent could still read the old code, but it couldn't do so unseen.
- The worker that sets up the room has seen today's code. It never writes the module, but it does fix the regressions the replay finds. The raw-output commit keeps the pure clean-room result separate, so both can be scored.

## Confounds to keep in mind

- **Models.** Experiment 1's arm B ran on this session's default sub-agent model, Opus 5.5. 2a asks for an Opus sub-agent. Harbour's stage models vary: in LIN-3556, plan, implementation and close-out ran on Sonnet 5.5, review on Opus 5.5.
- **One run per arm.** 2a's raw output is effectively a second sample of the clean room, so it gives a first look at run-to-run variance.
- **The base moved.** `main` now holds arm A's `adf.js`, which is behaviourally identical to the original on all 59,718 replayed calls (`../rebuild-exp1/results.md`). So "today's code" and "the original" agree for replay purposes.

## 15 Oct: the fresh-reader check of the 2a ticket, and the changes made

**The blocker:** the audit falsely flagged well-behaved calls, and the ticket said any violation means stop. Fixed in the tool:

- it scans string values unescaped, not `JSON.stringify` output;
- it accepts a quoted `cd` and one with a trailing slash;
- it allows ToolSearch and the Task tools;
- it doesn't scan text the call *writes*.

Re-tested on 15 synthetic calls (good and bad) and on arm B's real transcript, which still shows 0 violations.

**Other changes to the ticket:**

- **Finding the transcript:** by the Agent tool's `agentId`, not "the newest file".
- **The room:** extracted alone. The tools live elsewhere, and experiment 1's solutions are kept away from it.
- **Today's code:** pinned to `269a6189`.
- **Classes made checkable.**
  - "Malformed" means invalid ADF by Atlassian's schema, or non-string Markdown.
  - New throws and hangs count as regressions, and so does a new gate refusal of a non-lossy document.
  - Classification is by behaviour change.
- **Two replays:** the raw output and the final code.
- **Records:** the raw blob hash; the sub-agent's model, times and report; its added tests run on `today.js` (the brief's "They will later be run against the original module" was restored).
- **The empty-text-node question settled up front, as the Flight Companion's call under John's "sure, we can fix bugs"** (to be confirmed with John): the writer may stop emitting empty text nodes, which ADF forbids, but the gate keeps permitting stored documents that contain them, wherever today's gate does. The reasoning: a new refusal is a loss of utility.

**Corrections for comparability:**

- The packed public corpus is 8,916 inputs, or 53,496 calls. The 1,037 private real texts are replayed here, after the run.
- Arm B's public-only baseline is 3,477 cells in 338 groups. The 3,479 / 340 quoted before included 2 private cells.
- The sub-agent sees the repository's `CLAUDE.md`. Arm B, a sub-agent of this session, also had project instructions in context. Minor.

## 15 Oct, 16:52Z: 2a launched

- **Ticket:** LIN-3557, under LIN-3549 (High; Quality, Periodicals & Measurement). Autopilot `d1c1166c`.
- **Inputs:** the room, brief, audit and prediction as committed at `e1530200` (prediction `f19efc24`).

## 15 Oct, 16:57Z: John relaxes the empty-text-node rule

John: "I'm happy to drop edge cases like that for the sake of simplicity."

LIN-3557's description was edited in place: whether the gate keeps permitting stored empty text nodes no longer matters, and an edge case like that that would cost simplicity is dropped and listed in the PR.

**Timing:** the edit landed about 30 seconds after the implementation worker started (16:56:32). It may not see the change, but review and close-out will. The running worker was not interrupted. Steering rule: new instructions go to fresh sessions.

**For the notebook (inference):** this sharpens the success definition. Simplicity beats edge-case fidelity when the two conflict. That's worth carrying into 2b's test review: pin what matters to users, not every edge.

## 15 Oct, ~18:10Z: 2a done and scored

Full results are in `results-2a.md`.

**Facts:**

- The clean room went through Harbour cleanly: audit 10/0, and review re-ran it independently.
- It merged as `e7f7bd57`, about 53 minutes after kickoff.
- On structure it's the flattest version: 110 decision points, worst function 12.
- The pipeline caught 3 regressions: 1 in implementation, 2 in review. R1 shows up on real data.
- The pipeline missed the bracket-link display regression, which also appeared in arm B. **It's live on `main`.**
- Close-out is blocked on a post-deploy Jira check that review asked for. Both copies of the ruling are pre-filled "accept without" for John.

**Inference:**

- The pipeline corrects; it doesn't damage.
- The weak link is classifying differences without seeing the output as users see it.
- The contract (spec and tests) has no notion of display. The same gap appeared in two independent clean rooms.

**For 2b's test review:**

- pin Harbour's displayed output (through `marked`) for every decision, links with brackets first;
- carry John's "drop edge cases for simplicity";
- give the classification step a render check.

## 15 Oct, ~18:30Z: 2b part 1 (test review) prepared

**John:**

- answered both LIN-3557 rulings (LIN-3557 is Done);
- agreed to fold the live bracket regression into this ticket ("I agree with your recommendation. Let's proceed.").

LIN-3558 stays in Backlog, out of 2b's scope, keeping the ticket bounded.

**The gap list is computed, not judged** (`2b/gap-list.md`). Planting faults on every line of today's code (`e7f7bd57`), with today's 138 tests:

- 490 mutants, score 83.1%;
- 83 survive;
- the survivor probe finds that **46 change some output** on the corpus. Those 46 are the test review's to-do list.

**Display check:** Harbour's browser renders issue Markdown with `marked` (`public/common.js`; `marked` ^17.0.1 is a dependency). So tests can assert what users actually see.

**Ticket design:**

- Pin user-visible outputs only: displayed Markdown via `marked`, written ADF, and the gate's boolean.
- Every gap row is covered, or marked "equivalent" or "edge case dropped".
- Fix brackets with the smallest change. Prefer table-driven tests, and no mechanism.

The prediction is in `2b/prediction-2b1.md`.

**The fresh reader's 10 findings on the 2b-1 draft, applied:**

- The "fix where display is wrong" clause is bounded: fix brackets only, and list anything else shared with `269a6189` as a follow-up.
- The gap list is now reproducible: ids, line:col, before → after, full examples in `gap-list.json`, and `plant.mjs`. All 46 rows checked to plant.
- The misleading `HREF` comment that both clean rooms followed must be rewritten, or the next rebuild will regress again.
- The bracket bug's write half is named. Verified: today stores `…Foo_\(bar)`, while `269a6189` stored `…Foo_(bar)`.
- Source 3 (every decision) was dropped as unbounded.
- One label replaces two: "not pinned: reason", plus "deferred: LIN-3558".
- The evidence is a unit test through `marked.parse`; no live check is needed.
- The test count was dropped. The kit reports 145, `node --test` counts differently from the earlier "138".

## 15 Oct: 2b part 1 launched

LIN-3561 (High, under LIN-3549). Autopilot `8b80c7b8`. Ticket and gap list as committed at `c9855073`.

## 15 Oct: how much the clean room matters, and what comes next (discussion with John)

**Evidence so far** (n is small: one module, two clean-room runs, one informed run):

- The simplification came from the clean room.
- Informed rebuilding anchors on the old code. Arm A was told to rewrite as a whole, kept the old shape anyway, and built an oracle despite being told not to.
- The clean room's regressions mark holes in the contract.

**The working pattern:** "build blind, check sighted".

**John's question:** would a better prompt work, or is it the nature of the LLM? **My view (inference):** a prompt can reduce the pull but not remove it. Content in context shapes what comes out, and "same behaviour" plus a visible original rewards copying. Testable cheaply.

**John's idea:** Harbour could dispatch to a "projected" repo with specific files only. **My view:** a good, general fit for Harbour's lane, because it's task context control. It isolates by construction, enforces seams (only neighbours' public interfaces are visible), and is cheaper.

**Agreed (John):** "Agreed, let's keep going with these experiments. We won't add supporting features until we know more. And I think we have a reasonable ladder of options for future experiments."

**The ladder of options:**

- **Next rung:** run the clean room alongside an "informed, design-first prompt" arm, with the same kit. Does prompting match the clean room's structure?
- **If the clean room keeps winning:** projected repos as a Harbour feature. Not before.
- **Later rungs:**
  - a page renderer (`lib/render-roadmap.js`);
  - a whole provider (Jira, which re-rebuilds `adf.js` as part of it);
  - GitHub Projects;
  - a proxy sub-router.

  The UI is "tidy until swappable".

## 15 Oct, ~21:10Z: 2b part 1 done and scored

LIN-3561 merged as `bf6f7507` (PR #1893) at 20:46Z, about 40 minutes after kickoff; Done at 20:55Z, with no rulings.

**Facts:**

- **The fix:** one code line (`HREF` escapes and unescapes both brackets), plus the two corrected comments.
- **Tests:** +78 lines, all in the codec test file: three table-driven groups (display through `marked`, per-node display, stored ADF) and 11 rows added to the existing gate tables. No existing test edited.
- **The 46 gap rows:** 35 covered, 9 "not pinned" (4 malformed ADF, 2 inputs with no realistic source, 3 behaviours shared with `269a6189`), 2 deferred to LIN-3558.
- **Independent check (here):** re-planted all 46 rows into `e7f7bd57`'s code with only the `HREF` line fixed, and ran the new test file on each. The result matches the PR's table exactly: 35 fail (2 of them by hanging), 11 pass.
- **Planted-fault sweep on `bf6f7507`, new tests:** 490 mutants, 430 killed, 12 timeouts, 48 survive. Score 90.2% (was 83.1%).
- **Survivor probe:** of the 48 survivors, **11 change some output** on the corpus (was 46), and they are exactly the 11 rows the PR labelled. The other 37 change nothing observable.
- **Follow-ups the PR lists (not fixed):** F1 to F8. It recommends one ticket for F1 (inline code with a backslash or backtick displays wrong) and F2 (a hand-typed link with balanced brackets is stored cut short).
- **Real-data counts (here, private corpus, counts only):**
  - F1: after a Jira round trip, inline code shows extra backslashes in **137 of 1,037** real texts (13%). These are Linear texts, used as a stand-in for Jira content.
  - F2: 0 of 1,037 real texts contain a link with balanced brackets in its URL.

**Against `2b/prediction-2b1.md`:** merged without John ✓; about 40 minutes and one review round ✓; a one-line bracket fix ✓; 35 rows covered (predicted 25–40) ✓; 78 test lines, table-driven (40–150) ✓; no other behaviour fixed (0–3) ✓; score 90.2% (90–95%) ✓, at the bottom of the range; no scope creep and no near-duplicate pile ✓.

**One wrinkle, which matters for part 2:** the corrected escaping comment now calls F1 "a known, accepted display cost". Nobody accepted it; the PR itself recommends fixing it. Room-2b's `SPEC.md` is generated from these comments, so as written the next clean room would be told to keep F1. That's the second time a comment has steered a clean room (the `HREF` comment was the first).

**Inference:**

- A test review bounded by a computed gap list works well and stays small: 78 lines closed 35 of 46 gaps, with no sprawl.
- In this method, comments are part of the contract. A wrong comment is a wrong spec.
- F1 is the realistic display bug left in this module; F2 isn't, on this data.

## 15–16 Oct overnight: the inline-code fix (LIN-3564), then a stall

- **Before part 2:** a fix ticket for F1, so the clean room's spec doesn't call the bug "accepted". The fresh-reader check found 10 issues, all applied, including a padding bug for all-space text, a gate regression for adjacent code runs, and the missing no-closer rule.
- **LIN-3564** was filed and launched at 21:13Z and merged as `c2bc9a65` (PR #1894) at about 21:25Z. Close-out then blocked on a post-deploy Jira-check ruling, as in LIN-3557.
- **Private-sample replay here:** inline code showing extra backslashes after a Jira round trip fell from 137 of 1,037 real texts to 8. 0 throws; the codec file passes 200/200. The ruling is pre-filled "accept" for John.
- **Stall:** the session's worker restarted at about 21:15Z. The LIN-3564 watcher died with it, and my next step waited on a permission prompt until morning. The XS rooms (two repeat clean rooms, and one with tests only) were built in the scratchpad but not run. Nothing else was launched.
- **Lesson (process):** an overnight run needs a self-check that survives a worker restart, such as a scheduled check-in, not only an in-session background watcher.
