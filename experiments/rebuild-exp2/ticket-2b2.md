TITLE: Rebuild the Jira ADF↔Markdown codec (lib/providers/jira/adf.js) in a clean room again, on its strengthened tests: a sealed sub-agent writes it, then a replay that checks what users see decides what ships

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/providers/jira/adf.js` in a clean room, exactly as LIN-3557 did, but on the stronger contract that LIN-3561 and LIN-3564 have since built. A sub-agent writes the module inside a sealed folder that holds only the spec and the tests; it never sees today's code. Then a replay over 8,916 inputs compares the result with today's code, judging every difference by what Harbour displays and what it stores:

* keep the fixes;
* fix the regressions;
* raise anything unclear.

Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is John's rebuild experiment 2b, part 2. In LIN-3557 (experiment 2a) the clean room produced the flattest code yet. But a regression shipped (links with brackets in the URL) because the tests and the classification checked the Jira round trip, never what Harbour displays. LIN-3561 made the tests check the displayed Markdown (through `marked`), the stored ADF and the gate, and LIN-3564 fixed inline code. This run asks: on a contract that sees what users see, does a clean room still come out cleaner, without regressions? On bugs the rebuild fixes, John: "sure, we can fix bugs." On an earlier edge case (stored empty text nodes, which show nothing), John: "I'm happy to drop edge cases like that for the sake of simplicity."

This is one PR. Don't split it: the regressions are fixed in this PR.

**Decision.**

* **Setup.** Run `git fetch origin main claude/jolly-knuth-dgn3m1`. If `git diff c2bc9a65 origin/main -- lib/providers/jira/adf.js tests/unit/jira-provider-adf-codec.test.js` is not empty, raise a `DECISION:` and stop. Then:
  * **The room.** Set `ROOM=$(mktemp -d)` (a path with no spaces) and extract the room on its own:

    `git archive origin/claude/jolly-knuth-dgn3m1:experiments/rebuild-exp2/room-2b | tar -x -C "$ROOM"`

    Put nothing else in or near it. It holds `SPEC.md`, the 200-test codec file, a stub `index.js`, an empty `adf.js`, a `package.json` (`"type": "module"`), and a copy of `marked` 17.0.1 under `node_modules/`, because the tests import it. Check that `node --test tests/unit/*.test.js` run from `$ROOM` fails at import, with "does not provide an export named", and nowhere else.
  * **The tools,** in a *separate* temporary folder under a different parent from `$ROOM` (for example `mktemp -d -p ~`), not beside it:
    * `experiments/rebuild-exp1/kit/` (the replay). Unzip its corpus: `for f in <branch>/experiments/rebuild-exp2/corpus-gz/*.gz; do gunzip -c "$f" > <tools>/kit/corpus/$(basename "$f" .gz); done`.
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
* **The audit.** The Agent tool's result names the sub-agent's `agentId`. Its transcript is `ls ~/.claude/projects/*/*/subagents/agent-<agentId>.jsonl`. Run `node <tools>/audit-subagent.mjs <that file> "$ROOM"`. Reading `$ROOM/node_modules/marked` is inside the room and allowed.
  * If a flagged call really read, listed or searched outside the room, stop and raise a `DECISION:`.
  * If a flag is a false positive of the audit, record it in the PR and carry on. One is known: a Glob or Grep whose absolute pattern lies inside the room but which has no `path` field. Check the pattern; if it is inside the room, it's a false positive.
* **The raw output is its own commit.**
  * Copy the sub-agent's `adf.js`, plus any tests it added at the end of the codec test file, into the repository unchanged. Commit them alone, as "raw clean-room output", even if some tests fail.
  * Record that commit's SHA and `git hash-object lib/providers/jira/adf.js` in the PR.
  * Run any tests the sub-agent added against `today.js` as well, and record which pass.
  * Every later change is a separate commit. Review and close-out don't restyle the raw code beyond the fixes below.
* **Two replays decide what ships.** Run the kit's `diff.mjs <tools>/today.js lib/providers/jira/adf.js --out <file>` twice: on the raw commit, and on the final code. Classify by *behaviour change*, not group by group; many groups usually trace to one change. Use a sub-agent for the reading if it's large.
  * **Judge each difference the way users meet it.**
    * For a Markdown difference, render both outputs with `marked.parse` (the repository's `marked`, default options, as the codec tests do) and compare what is displayed: text, links and their hrefs, emphasis, code. Do it in one script that loops over the report's groups and renders each group's `best.old` and `best.new`; the smallest example of each group in a change is enough.
    * For an ADF difference, check the new ADF against Atlassian's published node and mark rules (the structure pages), and say what it means: which text carries which marks, links or code. Where you can't verify a rule, say so and classify it (e). Don't predict Jira's rendering.
    * For a gate difference, say which stored documents are newly refused or newly allowed.

    Record the rendered evidence for every behaviour change classed (a), (b) or (c); for (d) and (e), the input and both outputs.
  * **(a) A fix.** Today's output contradicts the recorded decisions in the room's `SPEC.md`, displays wrongly (its rendered HTML shows different text, links, emphasis or code than the ADF or Markdown it came from), or produces invalid ADF, and the new one doesn't. Keep it.
  * **(b) A regression.** The new output displays or stores something wrong where today's was right. This includes new code that throws or hangs where today's didn't, and a gate that newly refuses a stored document today's gate permits without losing content (content is lost if `adfToMarkdown` then `markdownToAdf`, run on today's code, changes the document's text, link hrefs or code). Fix it with the smallest change where the defect is. Don't bring back today's helpers or paste today's code.

    **The one exception:** a regression may be dropped instead of fixed only if all of these hold.
    1. The dropped output loses no visible text, link href or code content: a user sees the same words, links and code, and the stored ADF is valid. Formatting nuance, fidelity on a shape Jira can't produce, or a gate that newly refuses a document whose only problem is invisible nodes such as empty text nodes all qualify. Dropped text, a changed href or reformatted code don't.
    2. No test in the room's test file pins it.
    3. The fix would need a new function, a new branch in an existing function, or a new regular expression.

    List each drop in the PR with an example input, both outputs (rendered through `marked` where they are Markdown), and which conditions hold. Review confirms each. If unsure, raise a `DECISION:`.
  * **(c) Harmless.** Both outputs display and store acceptably.
  * **(d) Malformed input.** The input is not valid ADF by Atlassian's schema, or is non-string Markdown. List it, and leave it as it is unless it's also (b).
  * **(e) Unclear.** Raise a `DECISION:` and stop.
* **Tests.**
  * Don't edit or delete any test that exists today.
  * A test the sub-agent added may be corrected only if it pins a regression; say so in the PR.
  * You may add tests to `tests/unit/jira-provider-adf-codec.test.js` that pin an output the replay showed was wrong, either a fix or a fixed regression: at most one table row per class-(a) change or fixed regression, not one per input. Pin what users see, in the style of LIN-3561's tests.
  * The full unit suite, e2e and CI must be green.
* **Change only `adf.js`** and, if needed, that test file. If a fix changes a cause the 422 message in `lib/providers/jira/index.js` names, update the message to match.
* **No new mechanism in the repository.** The room, audit and replay stay outside it.
* **Close-out.** The evidence is the unit tests and the replay with rendered checks, as in LIN-3561. No live Jira or browser check is needed.

**Done when.** The rebuilt `adf.js` is merged as normal, with no second copy, and the PR records:

* the audit result: tool calls and violations, with any false positives explained;
* the sub-agent's report, its model, and its start and end times;
* the raw commit's SHA and blob hash, and which of the sub-agent's added tests pass on `today.js`;
* both replays' totals, and a table of behaviour changes, each with its class, its group and cell counts, and its rendered evidence;
* each regression fixed, and its commit; each regression dropped, with an example input and both outputs.

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
