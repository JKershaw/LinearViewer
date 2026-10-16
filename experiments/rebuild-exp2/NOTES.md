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

- **Models.** Experiment 1's arm B ran on this session's default sub-agent model, the frontier tier. 2a asks for a frontier-tier sub-agent. Harbour's stage models vary: in LIN-3556, plan, implementation and close-out ran on the mid tier, review on the frontier tier.
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

## 16 Oct, morning: the XS runs and the prompt arm

**Correction to the overnight entry:** the order was the other way round. The permission prompt came first (about 21:14Z), and the machine was restarted later (boot 05:49:27Z). The restart only cost the watcher.

**The runs, all here and never merged:**
- **r1 and r2:** two more clean rooms on room-2a. The inputs are identical to B's and 2a raw's: 133 tests plus the comment spec.
- **tonly:** a clean room with the tests but no spec.
- **prompt:** a design-first informed arm. A sub-agent in a scratch copy at `c2bc9a65` could see today's code, its 200 tests and the provider tests. It was told to write `DESIGN.md` first, design as if the current code didn't exist, then write the module, with no comparison harness.

All three rooms audited clean (9–11 calls, 0 violations) and ran on the frontier tier.

**Results.** The replay and shape columns compare with the original behaviour (`arms/A`), except prompt, which compares with today (`c2bc9a65`). "Real texts" means the private 1,037, counting texts whose display after a Jira round trip (`marked.parse(adfToMarkdown(markdownToAdf(md)))`) differs.

| | code | decisions | worst fn | public cells / groups | real texts displayed differently |
|---|--:|--:|--:|--:|--:|
| original (A) | 302 | 142 | 26 | — | — |
| B | 275 | 127 | 24 | 3,479 / 338 | 1 |
| 2a raw | 282 | 110 | 12 | 3,607 / 140 | 1 |
| r1 | 281 | 127 | 22 | 3,491 / 349 | 1 (invisible) |
| r2 | 260 | 125 | 21 | 8,256 / 185 | **345** |
| tonly | 209 | 88 | 25 | 8,547 / 629 | **317** |
| today (`c2bc9a65`) | 318 | 129 | 12 | — | — |
| **prompt** (vs today) | **199** | **90** | 22 | **7 / 4** | **0** |

**What broke, from masked skeletons and synthetic probes (no content):**
- **r2 parses `*single-star*` emphasis.** Real tickets use it a lot, and the original shows the asterisks literally. That part is a fix: a missing behaviour nobody had pinned. It also produces artefacts (stray `_ _`, and a link inside italics shown as raw `[text](url)`), and loses bold and code in places: −837 `<strong>` and −849 `<code>` across about 110 texts.
- **tonly needs a blank line between blocks.** A heading followed directly by a list collapses into one paragraph: −2,345 `<li>` and −1,004 `<h3>` across about 225 texts.
- **Both passed all 133 tests.** Against today's 200 tests they fail roughly the same set as 2a raw (the newer pins), so not even the 200 tests target these two regressions.

**The prompt arm's 4 groups are all gate differences:**
- it newly refuses a paragraph with an `alignment` mark, and a code block with a `breakout` mark (real Jira marks the round trip would drop);
- it newly permits `> a\n> \n> b` (the known LIN-3558-class inconsistency) and a malformed empty link in a heading.

Its key move: **the gate runs the round trip and compares**, with the four ruled exceptions as named clauses, instead of modelling the writer in tables. tonly found the same idea on its own. The cost is a 22-decision `render` switch.

**Inference:**
1. **Run-to-run variance is large.** On identical inputs, 3 clean-room samples (B, 2a raw, r1) were fine on real text and 1 (r2) was badly off. The replay against the old code ("check sighted"), with a real-text display check, is mandatory, not a safeguard.
2. **The comment spec carries real behaviour.** Without it, block parsing went wrong on real documents.
3. **The tests, even at 200, don't describe realistic documents.** Every regression here is on everyday Markdown: headings followed directly by lists, `*`-emphasis, links inside emphasis. A small set of realistic synthetic documents, pinned by display, is the missing contract piece. As John put it this morning, missing behaviour found this way is a test to add, then try again.
4. **The design-first prompt removed the anchoring,** at least once. Arm A (informed, "rewrite as a whole") kept the old shape. The prompt arm, also informed, designed a different structure and is the smallest and most equivalent result so far. One sample, on the stronger contract, with the old code as a behavioural reference. That's the clean room's simplification without its regression risk, at least this time.
5. **The original codec's own gaps showed up:** `*`-italics are lost. That's a spring-clean candidate (John: missing behaviour is fine to find this way).

## 16 Oct ~07:00Z: John on strictness

John agreed all four rulings as proposed (LIN-3565 ×2 "drop", LIN-3566 "accept-listed" and "keep-fixes"). Then: "Note for as we go; no need to be so strict on edge cases as we experiment. Bugs should be fixed, but we want it to improve, so there's going to be fuzz. It'll be interesting to see the results once the experiments are in."

**For later tickets:**
- regressions that lose real utility are fixed;
- edge-case differences are accepted and listed, not escalated;
- `DECISION:` only for real losses.

**Also noted (LIN-3565, private real-text check on head `2d11c596`):** 280 of 1,037 texts display differently, all in lists, and the change is net a fix (`*` bullets and bullets nested under bullets now render as lists; 2 texts got worse). Nested lists appear in 174 of 1,037 real texts and neither version supports them. That's a spring-clean candidate.

## 16 Oct ~07:20Z: 2b part 2 (LIN-3565) and rung 2 (LIN-3566) done and scored

**LIN-3565, a clean room on the 200-test contract.** Merged as `74e5e2ca` (PR #1895), about an hour after kickoff. Done after John's ruling ("drop" the whitespace-only fence).

| | code | decisions | worst fn | public cells / groups vs today | real texts displayed differently |
|---|--:|--:|--:|--:|--:|
| today (`c2bc9a65`) | 318 | 129 | 12 | — | — |
| 2b-2 raw | 297 | 132 | 24 | — | — |
| 2b-2 final | 297 | 134 | 24 (a 21-line `switch`) | 3,265 / 444 | 280 (lists, net fix) |
| prompt arm (here) | 199 | 90 | 22 | 7 / 4 | 0 |

Against `prediction-2b2.md`:
- room, audit and merge ✓;
- raw passes the 200? The pipeline fixed 2 regressions, so it didn't;
- code lines in range ✓;
- bracket regression didn't recur ✓;
- "cleaner on both lines and decisions" ✗: fewer lines, more decision points.

The pipeline's public replay didn't see the real-text list change. The private check did, and it's a net fix (`*` bullets now list).

**LIN-3566, rung 2, the roadmap renderer, design-first informed, through Harbour.** Merged as `65969467` (PR #1896), about 45 minutes after kickoff.
- **Independent replay** (3,105 + 5,105 inputs, 2 seeds, 100% line coverage of the old renderer): **0 differences**, including identical throws.
- **Shape:** code 375 → 364, decision points 115 → 88, worst function 34 → 22, longest function 148 → 46 lines, functions 24 → 41.
- **Against the prediction:**
  - merged ✓;
  - 0–6 behaviour changes ✓ (0);
  - design departs ✓;
  - no function over 60 lines ✓;
  - 230–330 code lines ✗ (364; the cut was in structure, not size);
  - worst function ≤15 ✗ (22);
  - Done without a ruling ✗ (two rulings, both "record" and quickly answered).

**Inference:**
- Design-first, informed and through Harbour gave perfect equivalence and much flatter structure on a module with a thin contract. That's the safest result of any arm so far.
- The clean room's extra simplification doesn't hold up through the pipeline on this evidence. 2b-2 came out at about the same complexity as today. The prompt arm, outside Harbour, was much smaller.
- On this evidence, the working method for the ladder is: **design-first informed rebuild + an independent replay against the old code, + real-data checks where they exist.**

**Spring-clean gaps (private corpus, counts only):** 483 of 1,037 real texts contain nested lists, and 287 use `*italics*`. Main's codec flattens or loses both on a Jira round trip.

## 16 Oct ~08:50Z: rung 3 (LIN-3569, the Agent API read routes) done and scored

Merged as `06ec62b7` (PR #1897), about an hour after kickoff, with no rulings.

**Independent replay:** 2 seeds × 3,000 requests, 100% line coverage of both versions, 0 socket escapes.
- **No differences on any successful response.**
- About 340 requests per seed differ only in server console-log wording (`Proxy /issues error:` became `Proxy /api/proxy/issues error:`). Agents can't see it.
- **Attachments, provider access rejecting:** the old route sent no handled response (a generic 500 under the server); the new one sends a mapped error. This is the intended class-(a) fix.
- **Attachments, session expired and provider unsupported:** the old route answered 422 (unsupported) where the new one answers 503 (session expired), and it marks the credential suspect. The old route was the only one of 13 that checked capability before workspace availability, so this is consistency, class (a).
- **Attachments, upstream 3xx:** the old route relayed a 302 with no `Location` and an error body; the new one answers 400 "Redirects not allowed". A real fetch with `redirect: 'error'` throws first, so this can't arise in practice.

**Shape:** code 448 → 378, decision points 98 → 72, worst function 31 → 22, longest handler 111 → 61.

**Against the prediction:** merged ✓; no ruling ✓; 330–440 lines ✓; attachments fix ✓; 0–3 changes beyond fix and fuzz ✓; no agent-visible regression ✓; worst function ≤15 ✗ (22).

**Inference:** design-first informed rebuilds with an independent replay now have two clean results at two boundary types (an HTML page and an HTTP router). The method holds at about 400 lines, one file.

**Ladder from here:**
- **Rung 4:** `proxy-writes`, `proxy-rulings` and `proxy-tokens-admin` together. About 1,180 code lines, 3 files, 20 routes, writes-heavy; the first multi-file rebuild.
- **Rung 5:** the dispatch core (`proxy-dispatch`, `proxy-kickoff`, `proxy-compute`; about 2,330 lines, with worst functions of 93, 62 and 30).
- **Then the rest of the Agent API.**

## 16 Oct ~09:45Z: the codec spring clean (LIN-3570) done and scored

Merged as `e90b94c6` (PR #1898). It took about 2 h 13 min, including a plan-review bound, which John reset with "continue". The change is +173 lines in `adf.js`, +456 lines of tests, and the ENG-16 refusal fixture flipped.

**Correction:** the earlier "483 of 1,037 texts (47%) use nested lists" was over-counted; the pattern also matched texts with two separate lists. The right figure is **261 (25%)**. LIN-3570's description was corrected.

**Private real-text check** (display after a Jira round trip, structure only, counts):
- `*italics*` kept: 63 → **258 of 287**.
- Nested lists kept: about 0 → **204 of 261**, with exact nesting in 141.
- Whole-document structure equal to what was typed: 341 → **462 of 1,037**.
- 0 gate refusals and 0 throws, before and after.

**Remaining gaps, from first-differing-tag counts and synthetic probes:**
- marks inside marks: code inside bold, and a link inside italics, about 200 texts;
- `***` and `___` rules, 89;
- setext headings (`Text` then `---`).

Tables already survive. Jira's format can't make code bold, so "code inside, bold around" would be the fix.

## 16 Oct ~11:30Z: pause before rung 5

John: "Let's pause before Rung 5 as I think we'll have a good amount of information to digest, and write up."

Rung 4 (LIN-3573) finishes, since it's already running. Harbour's plan split it into three children: LIN-3574 (the replay harness, done), LIN-3575 (rulings) and LIN-3576 (writes and PR). Then I score it and write up the series. No new rungs.

## 16 Oct ~14:20Z: rung 4 (LIN-3573, write and rulings routes) done and scored

Merged as `350242d5` (PR #1899) at 14:08Z, about 5 h 17 min after kickoff (08:51Z).

**How Harbour ran it:** the plan split the work into three children: LIN-3574 (build and gate the replay harness), LIN-3575 (rulings) and LIN-3576 (writes and the PR). That took two plan-review rounds and one ruling from John (citation-only edits, allowed). There was also a one-hour wait: LIN-3576's first worker found itself "blocked by LIN-3575" and exited at 12:08Z. The pipeline resumed by itself once LIN-3575 closed at 13:28Z.

**Independent replay** (`rung4/replay`, 2 seeds × 3,000 requests per file, 98–100% line coverage of both versions):
- **Rulings:** 0 differences on both seeds.
- **Writes:** about 225 requests per seed differ, all in two behaviour changes. The PR names the same two from its own 20,000-request replay (3 seeds), with warrants:
  - **a1, a fix:** a credential-resolution rejection on a description edit fell through to the generic "Internal server error", unlogged. It's now mapped and logged, as at the other 10 resolution sites.
  - **a2, a fix:** a description write the provider reports as not landed (`null` or `{success:false}`) returned **200** to the agent. It now returns 502 "Description was not updated", per `docs/proxy-integration.md` ("never … a 2xx with a falsy success").
  - An extra undefined argument to `resolveProviderAccess` on issue creation has no effect.

**Shape:**
- `proxy-writes`: code 693 → **421** (−39%), decisions 210 → 150, worst 39 → 26, longest handler 93 → 40 lines.
- `proxy-rulings`: 236 → 198, decisions 57 → 46, worst 21 → **12**.
- Combined: 929 → 619 (−33%).

**Design:** the old writes file restated one skeleton eleven times. The rebuild says each step once: a `SPEC` table of the per-route facts, then `guarded()`, `refuse()`, `guardTarget()`, `editDescription()` and the rest. The one place that didn't follow the skeleton (description edits) is where both bugs lived. No shared helper module was added; the PR found the two files share nothing worth one.

**Source-text pins:** all four convertible assertions were converted, each shown failing with its guard removed. All the non-convertible pins were satisfied as written.

**Against `prediction-writes-rulings.md`:**
- merged ✓;
- no agent-visible regression ✓;
- conversions within the allowed set ✓ (4);
- decisions down 15–30% ✓;
- no helper module, as predicted at 60% ✓;
- combined 760–900 lines ✗ (619; a bigger cut than predicted);
- worst function ≤25 ✗ (26);
- 70–150 minutes ✗ (about 5 h 17 min, because of the split, review rounds and the wait);
- Done without a ruling ✗ (one).

**Inference:** at about 930 lines over two files, design-first plus replay gave the biggest cut yet, with zero regressions. The cost was wall-clock, not quality. Harbour's own decomposition (harness first, then each file) made it safe but slow, and it exposed a gap in the pipeline: a child worker exiting "blocked" left the parent waiting until the blocker closed.

## 16 Oct ~15:00Z: figures added for the write-up (`docs/papers/harbour/rebuild-ladder.md`)

**From this session's private real-text runs (counts only):**
- `*` bullets displayed as one literal paragraph by `c2bc9a65`'s codec in 135 of 1,037 texts; LIN-3565's codec lists 127 of them.
- XS r2's real-text display changes: −837 `<strong>` and −849 `<code>`; `<em>` net +1,610 across 334 texts, mostly the `*italic*` fix, with artefacts.

**Rung 4's source-text tests:** nine distinct test files read `proxy-writes.js` or `proxy-rulings.js` (or every `routes/proxy-*.js`) as text:
- `trashed-signal`;
- `proxy-relations-query`;
- `proxy-endpoint-inventory-witness`;
- `proxy-di-witness`;
- `rulings-resolution-contract-drift`;
- `proxy-rulings-routes` (the LIN-1728 absence scan);
- `proxy-credential-fingerprint-stamping`;
- `lin-3136-enqueue-census`;
- `lin-2533-agent-status-extraction`.

**Fresh-reader checks:** every ticket this session (LIN-3564, 3565, 3566, 3569, 3570, 3573) had one before filing, and each found problems that were applied (LIN-3564's found 10). Real traps included: the attachments "hang" (really a generic 500 under `server.js`); a helper filename (`routes/proxy-*`) that would crash the DI census; module-level dedupe singletons that would corrupt a replay; and quotes stretched past their use.

**Correction to the rung 4 entry:** the writes child's wait (12:08 → 13:28Z) was the rulings child's close-out held on the record-only `lin3575-citation-scope` ruling until John answered. It wasn't the pipeline failing to resume.

## 16 Oct ~15:30Z: the next round, agreed

John: "If we prevent Harbour using breakdown we'll get better results, given the nature of the task. It feels like there's something new here. A Theseus refactor, if you will. An ideal way to rebuild. Potentially, also to build; fold the change required by the task into the design. But... That may be a discussion for later." Then: "There's a fractal element here too, as the abstractions and seams layer. And I agree, let's run this."

**Evidence on breakdown:**
- Rung 2a's ticket said "This is one PR. Don't split it", and Harbour didn't split.
- Rung 4's ticket lacked the line, and Harbour split three ways.

So "no breakdown" is a ticket line, not a Harbour change (inference).

**The next round, from a shape scan of all 392 `lib/` and `routes/` modules:**
1. `lib/dispatch-factory.js` + `lib/dispatch-validation.js`: worst function 181 decision points, the codebase's worst.
2. The renderer cluster as one no-breakdown rung, about 2,300 lines: the Large test.
3. The dispatch entrance (`routes/dispatch.js`, `proxy-dispatch.js`, `proxy-kickoff.js`; worst functions 122, 93, 62).
- Alongside: `lib/pipeline-loops.js` (113, 76).

## 16 Oct ~18:10Z: rung 5d (LIN-3578, `pipeline-loops.js`) done and scored

The round runs at altitude now: sub-agents build the replays, draft the tickets, run the fresh-reader checks and score, and the main session reads ≤15-line summaries. `scratchpad/RUNBOOK.md` and `STATE.md` hold the method and the live state.

**Run.** Kickoff 16:35Z, merged 17:42Z as #1901: 67 minutes, 11 dispatches. One implementation run: the ticket's "This is one PR. Don't split it into child tickets." held. No rulings.

**Replay** (`experiments/rebuild-rung5d/`, 3,795 inputs: 751 captured from tests, 44 targeted, 3,000 generated; 100% line coverage of the old file; seeds 1 and 7):
- 18 inputs differ per seed, none from the captured tests.
- **(a) fixes: 17.** A lean abort now reaches a target that has no digest: `terminalStatus` goes `null → 'aborted'`. To confirm it, the fix was applied alone to the old file; the replay then shows only the wording difference.
- **(b) regressions: 0.**
- **(c) fuzz: 1.** A TypeError's wording on a direct `_buildLoops` call.
- **Info only:** about 650 inputs differ in key order inside lean `telemetry`, as the PR lists.

**Shape:**
- code lines 800 → 634 (−21%);
- decision points 389 → 301 (−23%);
- worst function 113 → 29; second worst 76 → 20;
- functions 50 → 86.

No helper module, and no existing test edited. 4 new pin tests. The redaction census rows are kept.

**Prediction:** 9 of 9 lines hit. The decision-point cut came in near the bottom of the predicted 20–35% range.

**Worth noting:**
- **The fix reaches further than the PR's table says.** For lean callers, an aborted autopilot run with no digest now closes its session window, so later loops on the same issue form their own sessions (in one example, 1 session became 3). Non-lean already did this, so it's a fix. But sessions already stored keep the old grouping until rebuilt, and `BUILDER_VERSION` wasn't bumped.
- **Comments were cut hard:** 967 → 409 lines, and 17 of 51 ticket references are gone. All five the ticket named remain.

**Side events in the round:**
- LIN-3579's first implementation worker reported a `simple-dispatcher` checkout, although nothing carried a repo override. It was aborted and relaunched.
- A fresh-reader check of LIN-3580 found that local e2e loads `.env`. A read-only research dispatch (opencode with a cheap OpenRouter model, under 1¢) found it safe on the operator's machine (`MONGODB_URI` unset), but unguarded. That became LIN-3583.

## 16 Oct ~21:05Z: rung 5b (LIN-3579, the renderer cluster, the Large test) done and scored

Four files rebuilt in one PR (#1903, merged as `1f8010a0`): `render.js`, `render-session.js`, `render-swipe.js` and `render-settings.js`, 2,313 code lines, about 2.5× rung 4.

**Run.** First launch 17:09Z. Merged 20:26Z, Done 20:56Z after two rulings. Harbour didn't split it. What it ran into:
- **A wrong checkout:** the first implementation worker reported a `simple-dispatcher` checkout, with no repo override set. It was aborted and relaunched at 17:53Z.
- **A laptop reboot at ~18:25Z.** The operator's laptop froze under three concurrent runs, Spotlight indexing, and the dispatcher's growing per-cycle cost (fixed in LIN-3585). The stall failsafe resumed the worker, but its three background forks were lost. A forced follow-up at 19:50Z told it to finish one part at a time with a lighter replay.
- **Two rulings at close-out:** a live Periodicals check (skipped: the ticket rules out live checks) and the worker replay's coverage (about 94% strict block, accepted).

**Independent replay** (`experiments/rebuild-rung5b/`, 19,856 inputs, seeds 1 and 7):
- **(a) fixes, about 470 per seed:**
  - the details meta line now escapes identifier, assignee and estimate (an assignee of `<b>` used to become a live element);
  - Periodicals rows are left out of Home's ordering, which restores the top-task mark.
- **(c) fuzz:**
  - the same Periodicals change on Swipe, which no caller produces today (the swipe route never passes `urlKey`);
  - 3,089 Settings pages gain a space between two block-level closing tags. Nothing renders differently.
- **(b) regressions: 0. Page-contract changes: 0** (424 tokens checked).
- The run page is byte-identical (2,913 pages).
- **Real text:** 0 of 1,037 descriptions render differently.

**Shape:**
- code lines 2,313 → 2,057 with the new helper (−11%);
- decision points 917 → 693 (−24%, or −20% without removed default parameters);
- worst functions: `renderDetailsContent` 75 → 33; `renderSessionPage` 75 → 42; `renderPage` stays at 45; the new `renderNodeHtml` is 45.

**PR facts:** one helper, `lib/home-swipe-prompt-opts.js`. 4 new tests (3 fail on the base). No existing test edited, and `llms.txt` unchanged. Source-text pins and the golden pass (540 tests).

**Prediction:** most lines hit. One miss: the two worst functions would both drop below 40 (`renderSessionPage` is 42).

**Verdict.** The method held at 2.5× size in one PR, with no visible regression. The flattening is smaller than on the hot-spot rungs, because the cluster's complexity is spread across many page functions rather than one giant. The Home row and page functions and the run page's main function are still the most complex. Most of the wall-clock went to infrastructure, not the method.
