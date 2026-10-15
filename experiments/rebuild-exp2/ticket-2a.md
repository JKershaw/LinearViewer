TITLE: Rebuild the Jira ADF↔Markdown codec (lib/providers/jira/adf.js) in a clean room: a sealed sub-agent writes it from the spec and tests, then a replay against today's code decides what ships

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/providers/jira/adf.js` in a clean room. A sub-agent writes it inside a sealed folder that holds only the spec and the tests; it never sees today's code. Then a replay over 8,916 inputs compares the result with today's code:

* keep the fixes;
* fix the regressions;
* raise anything unclear.

Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is John's second rebuild experiment. In experiment 1, the informed arm ran as LIN-3556. The clean-room arm came out cleaner, but it ran outside Harbour. John, 15 Oct: "I wonder if the next experiment can use a clean room but run through Harbour. Which is possible precisely because we can instruct an agent to itself user sub agent in its own clean environment … We could even run the task on this code again and see if we get closer to the clean room experimental results which are currently only here." On behaviour changes: "sure, we can fix bugs."

This is one PR. Don't split it: the regressions are fixed in this PR.

**Decision.**

* **Setup.** Run `git fetch origin claude/jolly-knuth-dgn3m1`. Then:
  * **The room.** Set `ROOM=$(mktemp -d)` (a path with no spaces) and extract the room on its own:

    `git archive origin/claude/jolly-knuth-dgn3m1:experiments/rebuild-exp2/room-2a | tar -x -C "$ROOM"`

    Put nothing else in or near it.
  * **The tools,** in a *separate* temporary folder:
    * `experiments/rebuild-exp1/kit/` (the replay). Unzip its corpus with `gunzip -c` from `experiments/rebuild-exp2/corpus-gz/*.gz` into the kit's `corpus/`.
    * `experiments/rebuild-exp2/tools/audit-subagent.mjs`.
    * `experiments/rebuild-exp2/BRIEF-2a.md`.
    * Today's code, pinned: `git show 269a6189:lib/providers/jira/adf.js > <tools>/today.js`.
  * None of this is committed to `main`.
* **The clean room.**
  * Launch one sub-agent with the Agent tool: `subagent_type: general-purpose`, `model: opus`, in the foreground.
  * Its prompt is `BRIEF-2a.md` verbatim, with `<ROOM>` replaced by `$ROOM`. Give it nothing else: no code, and no hints about today's implementation.
  * It will see the repository's `CLAUDE.md`. That's expected; it isn't code.
  * If it stops before writing the module, resume it once with "use your own judgement; note the point in your report".
  * Record its full report, its start and end times, and the model that actually ran (the `message.model` field in its transcript).
* **The audit.** The Agent tool's result names the sub-agent's `agentId`. Its transcript is `ls ~/.claude/projects/*/*/subagents/agent-<agentId>.jsonl`. Run `node audit-subagent.mjs <that file> "$ROOM"`.
  * If a flagged call really read, listed or searched outside the room, stop and raise a `DECISION:`.
  * If a flag is a false positive of the audit, record it in the PR and carry on.
* **The raw output is its own commit.**
  * Copy the sub-agent's `adf.js`, plus any tests it added at the end of the codec test file, into the repository unchanged. Commit them alone, as "raw clean-room output", even if some tests fail.
  * Record that commit's SHA and `git hash-object lib/providers/jira/adf.js` in the PR.
  * Run any tests the sub-agent added against `today.js` as well, and record which pass.
  * Every later change is a separate commit. Review and close-out don't restyle the raw code beyond the fixes below.
* **Two replays decide what ships.** Run the kit's `diff.mjs <tools>/today.js lib/providers/jira/adf.js --out <file>` twice: on the raw commit, and on the final code. Sort every difference into one class.
  * **(a) A fix.** Today's output contradicts the recorded decisions in the room's `SPEC.md`, or produces invalid ADF, and the new one doesn't. Keep it ("sure, we can fix bugs").
  * **(b) A regression.** The new output is wrong where today's was right. This includes new code that throws or hangs where today's didn't, and a gate that newly refuses a stored document today's gate permits without losing content. Fix it with the smallest change where the defect is. Don't bring back today's helpers or paste today's code.
  * **(c) Harmless.** Both outputs are acceptable.
  * **(d) Malformed input.** The input is not valid ADF by Atlassian's schema, or is non-string Markdown. List it, and leave it as it is unless it's also (b).
  * **(e) Unclear.** Raise a `DECISION:` and stop.

  **Settled up front:** the writer may stop emitting empty text nodes, which ADF forbids. But the gate must keep permitting stored documents that contain them, wherever today's gate permits them.

  Classify by *behaviour change*, not group by group. Many groups usually trace to one change. Use a sub-agent for this reading if it's large.
* **Tests.**
  * Don't edit or delete any test that exists today.
  * A test the sub-agent added may be corrected only if it pins a regression; say so in the PR.
  * You may add tests to `tests/unit/jira-provider-adf-codec.test.js` that pin an output the replay showed was wrong, either a fix or a fixed regression.
  * The full unit suite, e2e and CI must be green.
* **Change only `adf.js`** and, if needed, that test file. If a fix changes a cause the 422 message in `lib/providers/jira/index.js` names, update the message to match.
* **No new mechanism in the repository.** The room, audit and replay stay outside it.

**Done when.** The rebuilt `adf.js` is merged as normal, with no second copy, and the PR records:

* the audit result: tool calls and violations, with any false positives explained;
* the sub-agent's report, its model, and its start and end times;
* the raw commit's SHA and blob hash, and which of the sub-agent's added tests pass on `today.js`;
* both replays' totals, and a table of behaviour changes, each with its class and its group and cell counts;
* each regression fixed, and its commit.

**Out of scope.**

* Other modules.
* Renaming or adding exports.
* Rewriting the tests.

**References.**

* Experiment 1's results and its classification table: `experiments/rebuild-exp1/results.md` and `experiments/rebuild-exp1/armB/classify.md` on the branch above. Read them only after the sub-agent has finished.
* `experiments/rebuild-exp1/kit/README.md` explains how the replay works.
* The parent, LIN-3549.
