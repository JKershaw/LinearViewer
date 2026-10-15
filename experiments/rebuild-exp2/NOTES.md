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
