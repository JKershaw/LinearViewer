TITLE: Rebuild the Jira ADF↔Markdown codec (lib/providers/jira/adf.js) in a clean room: a sealed sub-agent writes it from the spec and tests, then a replay against today's code decides what ships

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Rebuild `lib/providers/jira/adf.js` in a clean room. A sub-agent writes it inside a sealed folder holding only the spec and the tests; it never sees today's code. Then compare the result with today's code over a replay of about 10,000 inputs:

* keep the fixes;
* fix the regressions;
* raise anything unclear.

Merge as normal. Success is John's: "what we end up with matches the utility of what came before, but the code is _cleaner_ (cognitively simpler, less room for bugs, easy to maintain)."

**Why.** This is John's second rebuild experiment. In the first (LIN-3556), the clean-room version came out cleaner than the informed one, but it ran outside Harbour. John, 15 Oct: "I wonder if the next experiment can use a clean room but run through Harbour. Which is possible precisely because we can instruct an agent to itself user sub agent in its own clean environment … We could even run the task on this code again and see if we get closer to the clean room experimental results". On behaviour changes: "sure, we can fix bugs."

**Decision.**

* **Inputs.** Run `git fetch origin claude/jolly-knuth-dgn3m1`. On that branch:
  * `experiments/rebuild-exp2/room-2a/` is the sealed folder's contents;
  * `experiments/rebuild-exp2/BRIEF-2a.md` is the sub-agent's brief;
  * `experiments/rebuild-exp2/tools/audit-subagent.mjs` is the audit;
  * `experiments/rebuild-exp1/kit/` is the replay, with its corpus in `experiments/rebuild-exp2/corpus-gz/` (unzip it into the kit's `corpus/`).

  Extract them with `git archive` into temporary folders **outside** the repository checkout. None of it is committed to `main`.
* **Keep a copy of today's code** first: `git show origin/main:lib/providers/jira/adf.js` into a temporary file. The replay compares against it.
* **The clean room.**
  * Launch one sub-agent with the Opus model. Give it the brief verbatim, with `<ROOM>` replaced by the sealed folder's absolute path.
  * Don't give it code, hints about today's implementation, or anything else. If it asks a question, tell it to use its own judgement and note the point in its report.
  * When it finishes, run `node audit-subagent.mjs <its transcript> <room>`. The transcript is the newest `agent-*.jsonl` under `~/.claude/projects/<this checkout's folder slug>/<this session's id>/subagents/`.
  * If the audit reports any violation, stop and raise a `DECISION:`.
* **The raw output is its own commit.** Copy the sub-agent's `adf.js` (and any tests it added at the end of the codec test file) into the repository unchanged, and commit it alone as "raw clean-room output". Every later change is a separate commit. Name the raw commit's SHA in the PR.
* **The replay decides what ships.** Run the kit's `diff.mjs <today's copy> lib/providers/jira/adf.js --out <file>`. Put every difference group in one class:
  * **(a) A fix:** today's output contradicts its own recorded decisions (the code comments) or ADF/CommonMark, and the new one is right. Keep it.
  * **(b) A regression:** the new output is wrong where today's was right. Fix it in the new code's own style; don't paste today's code back.
  * **(c) Harmless:** both are acceptable, or the input is malformed in a way Jira's API never sends.
  * **(d) Unclear:** raise a `DECISION:` and stop.

  Use a sub-agent for this reading if it's large.
* **Tests.**
  * Don't edit or delete any existing test.
  * You may add tests to `tests/unit/jira-provider-adf-codec.test.js` that pin an output the replay showed was wrong, either a fix or a fixed regression.
  * The full unit suite, e2e and CI must be green.
* **Change only `adf.js`** and, if needed, that test file. If a fix changes a cause the 422 message in `lib/providers/jira/index.js` names, update the message to match.
* **No new mechanism in the repository.** The room, audit and replay stay outside it.

**Done when.**

* The rebuilt `adf.js` is merged as normal, with no second copy.
* The PR says:
  * the audit result: tool calls and violations;
  * the raw-output commit SHA;
  * the replay's totals and the count of groups and cells in each class;
  * each fix kept;
  * each regression fixed.

**Out of scope.**

* Other modules.
* Renaming or adding exports.
* Rewriting the tests.

**References.**

* LIN-3556 (experiment 1) and its results, in `experiments/rebuild-exp1/results.md` on the branch above.
* `experiments/rebuild-exp1/kit/README.md` for how the replay works.
* The parent, LIN-3549.
