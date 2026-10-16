TITLE: Rebuild the Jira ADF↔Markdown codec (lib/providers/jira/adf.js) in a clean room again, on its strengthened tests: a sealed sub-agent writes it, then a replay that checks what users see decides what ships

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/providers/jira/adf.js` in a clean room, exactly as LIN-3557 did, but on the stronger contract that LIN-3561 and LIN-3564 have since built. A sub-agent writes the module inside a sealed folder that holds only the spec and the tests; it never sees today's code. Then a replay over 8,916 inputs compares the result with today's code, judging every difference by what Harbour displays and what it stores:

* keep the fixes;
* fix the regressions;
* raise anything unclear.

Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is John's rebuild experiment 2b, part 2. In LIN-3557 (experiment 2a) the clean room produced the flattest code yet. But a regression shipped (links with brackets in the URL) because the tests and the classification checked the Jira round trip, never what Harbour displays. LIN-3561 made the tests check the displayed Markdown (through `marked`), the stored ADF and the gate, and LIN-3564 fixed inline code. This run asks: on a contract that sees what users see, does a clean room still come out cleaner, without regressions? On behaviour changes, John: "sure, we can fix bugs". On edge cases: "I'm happy to drop edge cases like that for the sake of simplicity."

This is one PR. Don't split it: the regressions are fixed in this PR.

**Decision.**

* **Setup.** Run `git fetch origin claude/jolly-knuth-dgn3m1`. Then:
  * **The room.** Set `ROOM=$(mktemp -d)` (a path with no spaces) and extract the room on its own:

    `git archive origin/claude/jolly-knuth-dgn3m1:experiments/rebuild-exp2/room-2b | tar -x -C "$ROOM"`

    Put nothing else in or near it. It holds `SPEC.md`, the 200-test codec file, a stub `index.js`, an empty `adf.js`, and a copy of `marked` 17.0.1 under `node_modules/`, because the tests import it. Check that `node --test tests/unit/*.test.js` run from `$ROOM` fails only because `adf.js` is empty.
  * **The tools,** in a *separate* temporary folder:
    * `experiments/rebuild-exp1/kit/` (the replay). Unzip its corpus with `gunzip -c` from `experiments/rebuild-exp2/corpus-gz/*.gz` into the kit's `corpus/`.
    * `experiments/rebuild-exp2/tools/audit-subagent.mjs`.
    * `experiments/rebuild-exp2/BRIEF-2b.md`.
    * Today's code, pinned: `git show c2bc9a65:lib/providers/jira/adf.js > <tools>/today.js`.
  * None of this is committed to `main`.
* **The clean room.**
  * Launch one sub-agent with the Agent tool: `subagent_type: general-purpose`, `model: opus`, in the foreground.
  * Its prompt is `BRIEF-2b.md` verbatim, with `<ROOM>` replaced by `$ROOM`. Give it nothing else: no code, and no hints about today's implementation.
  * It will see the repository's `CLAUDE.md`. That's expected; it isn't code.
  * If it stops before writing the module, resume it once with "use your own judgement; note the point in your report".
  * Record its full report, its start and end times, and the model that actually ran (the `message.model` field in its transcript).
* **The audit.** The Agent tool's result names the sub-agent's `agentId`. Its transcript is `ls ~/.claude/projects/*/*/subagents/agent-<agentId>.jsonl`. Run `node audit-subagent.mjs <that file> "$ROOM"`. Reading `$ROOM/node_modules/marked` is inside the room and allowed.
  * If a flagged call really read, listed or searched outside the room, stop and raise a `DECISION:`.
  * If a flag is a false positive of the audit, record it in the PR and carry on.
* **The raw output is its own commit.**
  * Copy the sub-agent's `adf.js`, plus any tests it added at the end of the codec test file, into the repository unchanged. Commit them alone, as "raw clean-room output", even if some tests fail.
  * Record that commit's SHA and `git hash-object lib/providers/jira/adf.js` in the PR.
  * Run any tests the sub-agent added against `today.js` as well, and record which pass.
  * Every later change is a separate commit. Review and close-out don't restyle the raw code beyond the fixes below.
* **Two replays decide what ships.** Run the kit's `diff.mjs <tools>/today.js lib/providers/jira/adf.js --out <file>` twice: on the raw commit, and on the final code. Classify by *behaviour change*, not group by group; many groups usually trace to one change. Use a sub-agent for the reading if it's large.
  * **Judge each difference the way users meet it.**
    * For a Markdown difference, render both outputs with `marked.parse` (the repository's `marked`, default options) and compare what is displayed: text, links and their hrefs, emphasis, code.
    * For an ADF difference, check that the new ADF is valid by Atlassian's schema, and say what Jira would show.
    * For a gate difference, say which stored documents are newly refused or newly allowed.

    Record the rendered evidence for every class-(a) and class-(c) call.
  * **(a) A fix.** Today's output contradicts the recorded decisions in the room's `SPEC.md`, displays wrongly, or produces invalid ADF, and the new one doesn't. Keep it.
  * **(b) A regression.** The new output displays or stores something wrong where today's was right. This includes new code that throws or hangs where today's didn't, and a gate that newly refuses a stored document today's gate permits without losing content. Fix it with the smallest change where the defect is. Don't bring back today's helpers or paste today's code. The exception: a regression on an edge case whose fix would cost simplicity may be dropped instead (John: "I'm happy to drop edge cases like that for the sake of simplicity"). List every dropped case in the PR, with an example input.
  * **(c) Harmless.** Both outputs display and store acceptably.
  * **(d) Malformed input.** The input is not valid ADF by Atlassian's schema, or is non-string Markdown. List it, and leave it as it is unless it's also (b).
  * **(e) Unclear.** Raise a `DECISION:` and stop.
* **Tests.**
  * Don't edit or delete any test that exists today.
  * A test the sub-agent added may be corrected only if it pins a regression; say so in the PR.
  * You may add tests to `tests/unit/jira-provider-adf-codec.test.js` that pin an output the replay showed was wrong, either a fix or a fixed regression. Pin what users see, in the style of LIN-3561's tests.
  * The full unit suite, e2e and CI must be green.
* **Change only `adf.js`** and, if needed, that test file. If a fix changes a cause the 422 message in `lib/providers/jira/index.js` names, update the message to match.
* **No new mechanism in the repository.** The room, audit and replay stay outside it.
* **Close-out.** The evidence is the unit tests and the replay with rendered checks, as in LIN-3561. No live Jira or browser check is needed.

**Done when.** The rebuilt `adf.js` is merged as normal, with no second copy, and the PR records:

* the audit result: tool calls and violations, with any false positives explained;
* the sub-agent's report, its model, and its start and end times;
* the raw commit's SHA and blob hash, and which of the sub-agent's added tests pass on `today.js`;
* both replays' totals, and a table of behaviour changes, each with its class, its group and cell counts, and its rendered evidence;
* each regression fixed, and its commit; each edge case dropped, with an example.

**Out of scope.**

* Other modules.
* Renaming or adding exports.
* Rewriting the existing tests.
* LIN-3558 (an empty fenced code block that doesn't survive the round trip).

**References.**

* LIN-3557 (experiment 2a) and its review, which caught R1 and R2. LIN-3561 and LIN-3564, which built today's tests.
* On the branch above, read only after the sub-agent has finished:
  * `experiments/rebuild-exp2/results-2a.md`;
  * `experiments/rebuild-exp1/armB/classify.md`;
  * `experiments/rebuild-exp1/kit/README.md`, which explains how the replay works.
* The parent, LIN-3549.
