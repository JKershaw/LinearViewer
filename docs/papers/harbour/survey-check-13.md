---
title: Does the prompt-kinds paper hold up?
kind: paper
version: 1
date: 2026-10-01
authors: [Claude (LIN-3220)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 4fb3eee7, kind custom, LIN-3220); the dispatch item carries no effort field. One bounded session with no research, plan, review or close-out legs, by the brief's design. In-session subagents: three frontier-tier readers, one reading the selection code at the paper's shas, one re-running the matching and hand-reading every verdict in the 32 tickets, and one re-running and taking apart the step 2 comparison. This session re-ran the census, wrote scripts/survey-check-13.mjs, re-derived every figure that changed, and wrote this check and the paper's version 2. It did not write the paper, which came from dispatch c63f11f3."
grounded_at: 2b454442 (LinearViewer, the paper's own sha; of the cited files only routes/proxy-dispatch.js has changed by d72b9036, origin/main when this was written); d3f9bc0d (simple-dispatcher); the paper's git-ignored snapshots (data/survey-kinds, copied unmodified) and a fresh re-run of every snapshot script against the transcripts and runner logs on this machine, 1 October 2026
cites:
  - "docs/papers/harbour/prompt-kinds.md@d72b9036 (version 1, LIN-3207) and its scripts survey-kinds-transcripts, -analyse, -verdicts, -fidelity and -figures, each re-run"
  - "lib/prompts/meta-prompt-template.js@2b454442:128-240 (the tree; mentions as backticked spans), :134, :139-150, :166, :175, :196, :202, :213, :234, :299-311 (quality rules: eleven kinds and defer), :315, :358 (hints and action list)"
  - "lib/prompt-template-defs.js@2b454442:253 (plan reads a prior Plan Review Verdict), :912 (plan-review writes it), :1025 (review's Regression Check)"
  - "lib/prompt-formatters.js@2b454442:485 (the CI-substitute paragraph), :516 (implementation's 'No regressions' criterion), :918 (Principle 0, in the shared If Blocked section)"
  - "lib/prompt-templates.js@2b454442:170, :431-440, :457-466; lib/openrouter.js@2b454442:1716-1722, :1792-1797, :1845; routes/proxy-dispatch.js@2b454442:1203; routes/proxy-compute.js@2b454442:278, :316, :439-466"
  - "lib/prompts/autopilot-kickoff.js@2b454442:210-211, :466-478; docs/autopilot-operating-manual.md@2b454442:177-178; lib/render.js@2b454442:100; public/prompt-section.js@2b454442:169-176"
  - "simple-dispatcher dispatcher.js@d3f9bc0d:41, :1202, :1251; hook.js@d3f9bc0d:426-430"
  - "docs/papers/harbour/steady-base-menu.md@2b454442:144-208 (M3, M5, M12, M19, M20, M24, M25, M28, M29, M30, M33); docs/papers/harbour/steady-base.md@2b454442:20, :98-99"
  - "docs/papers/harbour/review-loops.md@2b454442:13-17, :25-30; docs/papers/harbour/why-legs-repeat.md@2b454442:26-32"
  - "LIN-3200 comments (1 October 2026); comments on the 32 tickets of finding C, from the paper's cached reads"
  - "scripts/survey-check-13.mjs (this check)"
---

# Does the prompt-kinds paper hold up?

The census and the mechanism, yes. The richer-kinds reading, no. Two of the three step 2 drops, no.
The census scripts re-run and `census.json` and the chart come out byte for byte. The core loop holds
95–96% of the work whether the unit is dispatches, legs or fresh sessions. The decision tree is a
lifecycle, as the paper says.

What fails is in what the numbers are taken to mean:
- **Finding C's "no sign of earning their keep" overreaches.** Most of the 3× cost gap goes with
  stepper supervision and size. The three richer tickets that were neither epics nor stepper-run
  cost about the same as their matches, at 0.9–1.0×. The verdict regex misreads in both groups. The
  sample cannot say whether the richer kinds help. It does not show that they don't.
- **Finding D's "regression check" is a real check only in review.** There the template's own step
  (`git log` over the changed files) survives in about 1% of written reviews, not 27%. Close-out
  has no regression check; the word sits in a CI-substitute paragraph.
- **Principle 0 is an escalation rule.** It lives in the shared "If Blocked" section, and its
  substance survives in about a third of written plans (32%) and over two-fifths of
  implementations (44%).
- **The drop the paper missed is a routed marker.** The plan-review template's instruction to head
  its verdict `### Plan Review Verdict` survives in 70% of written plan-reviews. The plan template's
  instruction to read that verdict before re-planning survives in 36% of written plans.

The recommendation to leave the choice of kind alone stands, on a weaker ground: the off-loop kinds
are 1.4% of tokens and the evidence goes neither way. The fixture eval still comes before any edit
to the meta-prompt, but it should test different targets. Version 2 of the paper carries every
correction.

## Findings

### 1. The census reproduces; a third of it counts messages, not legs

The transcripts, runner-log, token and analyse scripts were re-run on 1 October. `census.json` is
byte for byte the paper's own, and `kinds-by-route.svg` re-renders unchanged (`git status` clean).
Every count in finding A reproduces:
- the 17-kind table and its token shares (3,426M weighted units; the off-loop kinds 1.4%);
- the engine's 849 of 894 and its 45 others;
- the 95 overrides;
- the coverage, 2,016 of 2,325 fresh sessions and 1,715 of 6,391 warm.

**No item is counted twice; the beat route counts legs twice.** Items are keyed by id. 23 ids were
printed by two enqueue calls; 6 of those carry two routes, and the first in file order is kept,
which moves no route's count by more than a few units. But a **beat** is a written follow-up into a held
session. Of the 500 template-kind beats a session fetched, 498 went into a session whose header was
already that kind. Beats are 923 of the 2,727, so a third of the census is messages into legs
already counted in another route.

| | dispatches (paper) | legs (all routes but beat) | fresh sessions by header |
|---|---|---|---|
| template kinds | 2,727 | 1,804 | 1,656 |
| core six | 2,631 (96.5%) | 1,725 (95.6%) | 1,569 (94.7%) |
| implementation / research / plan | 757 / 307 / 497 | 401 / 147 / 297 | 285 / 110 / 276 |
| design / bug | 18 / 5 | 8 / 2 | 8 / 3 |

The headline holds in every unit. Three statements change:
- **"Supervisors … 97–98%."** The 98% is the beats, which inherit the held session's kind. The
  supervisors' own choice of kind is the written route, 97% (428 of 440).
- **"The 18 design dispatches came from supervisors (15) and the engine (3)."** These are 8 design
  legs, 5 started by supervisors and 3 by the engine, plus 10 beats into them.
- **"Five ran two to five times each."** By legs, look-into ran 3, scoping 3, spike 2,
  retrospective-audit 2 and bug 2.

Two small figures are whole-snapshot, not September's:
- unparsed enqueue calls: 182 of 2,949 (6.2%), not 193;
- bare previews: 23, not 24.

### 2. The mechanism holds; two statements are wrong and several are loose

Every cited file was read at 2b454442. Only `routes/proxy-dispatch.js` has changed since; its :1203
is :1219 at d72b9036.

**What holds:**
- "When it is a close call, prefer research" (meta :166).
- The vague-ticket fallback to look-into or triage (:175, again at :234).
- The design hatch's four guards, guard (c) "a decided shape is a `plan`, never a `design`" (:196).
  The hatch landed in 63df9ab6 on 2 July, with all four guards.
- "resolve DOWN to `plan`/`research`" (:202).
- `blocked` on a second plan send-back (:213).
- The autopilot reads kinds, not scope: "Watch the kind sequence over a task"; "is a task
  **converging**"; "the kind widening run after run is **sprawling** (worth a flag)"; "Rare,
  demonstrable misses only" (`autopilot-kickoff.js:466-478`).
- The stepper's "Stay within **ONE kind**" (:210-211).
- The manual's "The engine's bias runs *down* the lifecycle" (:177-178).
- A menu of 16 templates plus `defer`, with retro excluded (`prompt-templates.js:431-440, :457-466`).
- 17 templates, with bug at `prompt-template-defs.js:119`.
- The engine's kind is its own action, from one completion at temperature 0 (`openrouter.js:1716-1722, :1845`).
- `NO_BOOTSTRAP_KINDS` is simple-dispatcher's only rule on the dispatch kind (`dispatcher.js:41`,
  used at :1202; :1251 is a display label).

**Wrong: quality rules exist for 11 kinds, not 12.** There are twelve bullets at meta :299-311, but
one is "**Defer replies**", and `defer` is the menu's meta action. The kinds without a rule are
design, scoping, spike, look-into, context and retro.

**Wrong: spike and context are not unmentioned where the model looks.** The tree's prose never
names them. But the model's prompt carries every hint and the action list (meta :315, :358).
Spike's hint says when to choose it over research. The tree routes to neither kind; that is the
accurate claim.

**Loose:**
- **The mention counts** (review 28, plan 27 …) reproduce only as backticked code spans over meta
  :128-240. Plain-word counts are several times higher, in the same order.
- **Step 0 is not "the one hard constraint".** Code decides when it is injected (:139), but what it
  says is prose. Its cannot-close branch routes on to `blocked`, `bug`, `plan` or `implementation`
  (:149). No code rejects another action.
- **The priority line (:134)** ranks blocked and bug second and third, and `breakdown` sits on the
  main route (:204, :216-217). The paper's list of how off-loop kinds enter leaves it out.
- **Citations:**
  - The grounding is appended at `openrouter.js:1792-1797`.
  - "✦ next step" is `public/prompt-section.js:169-176`; `render.js:100` holds the four default kinds.
  - The handwritten body also runs on the proxy template fetch and the `?kind=` preview
    (`proxy-compute.js:278, :316, :439-466`).
  - "One cheap-tier call" is the default; a workspace can override the model per operation.

### 3. The richer-kinds comparison: the groups reproduce, the reading does not

The 156 tickets, the 8 richer ones and the 24 matches reproduce exactly. `survey-kinds-verdicts.mjs`
re-runs from the cached comment reads with no proxy call and gives the same matches and counts.
The table's figures are the conventional median, except 27.3M, which is 27.2M.

**The verdict regex misreads both groups, in both directions.** It reads only a comment's first
3,000 characters, so it misses verdicts written at the end of a long review: LIN-2468's two Request
Changes sit at characters 13,984 and 18,132. It also counts plan revisions and autopilot notes that
quote an earlier verdict, which gives LIN-3075 five where it has two. Every verdict-headed comment
in the 32 tickets was read by hand:

| per ticket | paper | read by hand |
|---|---|---|
| plan-review Request Changes, richer / matched | 1.75 / 0.92 | **1.75 / 0.83** |
| code-review Request Changes, richer / matched | 0.00 / 0.38 | **0.00 / 0.25** |

The direction holds. The Limits note that the regex "undercounts Approves … the same way for both
groups" does not.

**Most of the cost gap goes with supervision and size, not the richer pass.**
- **The "four to six research dispatches" are beats.** Each is one written research session plus
  3–5 beats into it, the shape a stepper produces. 8 of the 24 matches have it too.
- **Children.** 4 of the 8 richer tickets have children, against 4 of the 24. A parent carries its
  stepper's sessions: 24.5M of LIN-3059's 33.7M, and 15.6M of LIN-3134's 26.6M.
- **The pairs are not independent.** LIN-3134 and all three of its matches are siblings under one
  autopilot run, and 7 of the 24 are siblings under LIN-679.
- **The measures shrink as the confounds come out:**

| comparison | richer : matched |
|---|---|
| median weighted tokens, as published | 27.2M : 9.1M, 3.0× |
| mean weighted tokens | 21.8M : 12.5M, 1.7× |
| median, stepper and autopilot sessions removed | 10.5M : 7.1M, 1.5× |
| the three richer tickets that are neither epics nor stepper-run (LIN-1988, 2468, 2517), against their own nine matches | 0.9× |
| the same three, against the 15 matches with no children and fewer than four research dispatches | 1.0× |
| dispatches excluding beats, median | 11.5 : 7 |

**"An upper bound on any harm" is not justified.** Confounding of unknown sign cannot give a bound.
Two exclusions also run the other way: requiring a plan drops LIN-2667 (three design passes, then
implementation with no plan) and LIN-2360 (a spike only). Those are the cases where a richer pass
might have saved the plan legs.

**Zero code-review send-backs is chance, not a weak signal.** Only 6 of the 8 reached code review.
At the corrected 0.25 the expected count is 2, and P(0) ≈ 0.14. The matched send-backs are clustered
in 3 of the 24 tickets.

**The supporting citations are softer than quoted.**
- `review-loops.md:13-17`'s "none asked for a different design" rests on eight verdicts on three
  tickets (:25-30).
- `why-legs-repeat.md`'s 92% is 121 of 131 coded repeats, not all repeated legs.
- LIN-3200's first two plan passes were sent back for facts at HEAD and its third for a logic gap.
  The loop broke on John narrowing the scope ("The pilot's original brief over-asked"), a scoping
  decision. That cuts against the paper's reading as much as for it.

**What the sample supports:** it cannot say whether a design, scoping or spike pass helps. The
richer tickets drew more plan send-backs (1.75 against 0.83) and cost more. The cost premium goes
with size and supervision, not with the richer pass. Code-review send-backs are within chance.

### 4. Step 2: the figures reproduce; two of the three drops are not what they are called

`survey-kinds-fidelity.mjs` on the paper's snapshot writes an identical `fidelity.json`. Every
printed figure reproduces, and LIN-3220's complements (73%, 88%, 87% missing) are the same figures.
The script has no upper date bound, so 22 rows are dated 1 October, and three item ids are counted
twice. September alone, one row per item, is 543 written against 67 template bodies. The length
ratios do not move. Principle 0 in written plans falls from 13% to 6%, because 9 of the 15 plans
that carry it are 1 October plans for LIN-3197–3204.

**The lengths are like for like, and the ratio understates the compression.** Both arms carry the
same code-appended sections, about 2.6k characters in every arm, which pulls the ratio towards 1.
On the model-written body alone, written prompts are **25% (review), 26% (close-out), 41% (plan),
52% (research), 62% (implementation) and 68% (plan-review)** of the template body. The plan-review
and research template arms are one and two prompts.

**"The regression check" is a real check only in review, and there it nearly always drops.**
- **Review.** The template's `### Regression Check` (`prompt-template-defs.js:1025`) says to run
  `git log --oneline` over the modified files and confirm nothing fixed before comes back. 2 of 142
  written reviews (1.4%) carry a `git log` step in the model's own text. 25 (18%) mention
  reintroducing, previously fixed or reverted work. The 27% that contain the word mostly use it
  loosely ("the swallowed-click regression").
- **Implementation.** Its regression content is one checkbox, "No regressions in existing tests"
  (`prompt-formatters.js:516`), plus the word inside the CI-substitute paragraph (:485).
- **Close-out.** The word appears only in that CI-substitute paragraph ("an equal count can hide
  one fix landing alongside one regression"). Close-out has no regression check to drop. What drops
  is the CI-substitute section, which matters only when CI is absent.

**Principle 0 is an escalation rule, and its substance survives more often than its name.** It is in
neither template's own text. It arrives in the shared `## If Blocked` section ("Gate on Principle 0
before you park it as `BLOCKED`", `prompt-formatters.js:918`), which governs when a session may
park, not how it plans. Counting a prompt that has the phrase, or names both `BLOCKED` and
`PENDING-EXTERNAL` (the distinction the test draws), it is in **32% of written plans and 44% of
written implementations**, not 6–13% and 7%. The runner's Stop-hook check defines BLOCKED for every
session whatever its prompt says (`hook.js@d3f9bc0d:426-430`).

**"The gates survive" holds for the whole prompt, mostly by construction. One routed marker drops.**
- Re-grounding is entirely code-appended.
- "Git history" survives in the appended section. In the model's own text it is the dropped
  Regression Check, counted as surviving.
- The gates the model writes itself do survive: What CI Did Not Prove in 100% of written reviews,
  the mutation check in 98%.
- The plan-review template tells the reviewer to head its verdict `### Plan Review Verdict`
  (`prompt-template-defs.js:912`), the header the tree and breakdown read (:447). That instruction
  survives in **46 of 66 written plan-reviews (70%)**.
- The plan template tells a re-plan to read that verdict first (:253). That survives in **39 of 107
  written plans (36%)**. Every template carries both.
- "Headings kept 32–72%" is the appended headings and the generic Goal / Context / Workflow skeleton;
  kind-specific headings survive in 5% or fewer. A heading count cannot support "the phrasing
  changes more than the substance".

### 5. Options: the cross-references are right; three sizes have no source

Every M-number lands on its row in `steady-base-menu.md@2b454442`:
- M3 (:144), M5 (:147), M12 (:167);
- M19 and M20 (:187-188);
- M24, M25 (:199-200);
- M28, M29, M30 (:203-205);
- M33 (:208).

Option 5 does overlap M5 inside M3. M33 is written for a tier change; option 3 borrows it for a
prompt change, which fits its shape but should say so.

| option | the paper's size | traces to |
|---|---|---|
| 1 | 0; off-loop kinds 1.4% of tokens | the census, 49M of 3,426M. Holds |
| 2 | −0 to −2% of tokens | nothing: no source gives the share of plan-review send-backs a fact check would pre-empt. A judgement, to be labelled as one |
| 3 | moves 1–5% of picks | nothing: the engine's off-loop picks are 5% today |
| 4 | "four fewer UI choices" | two: `context` leaves the "more" list and `look-into` the four defaults (`render.js:100`) |
| 5 | 1.25–2.8× prompt characters | 1/0.80 and 1/0.36. The low end is one plan-review template. In absolute terms it is 0.5–3k tokens a leg, so "against M12" is weaker than it reads |

The meta-prompt grew 5.7× "from May to September" (`harbour/steady-base.md:98-99`), not "since
June".

### 6. Limits: four of seven say which way they run

| limit | which way? |
|---|---|
| September only | Says what the window can show. Adequate |
| The 13% of fresh sessions missing | Says the census may understate the richer kinds. **The bound mixes units:** it adds 309 sessions to 2,727 dispatches. In fresh sessions the off-loop share would rise from 5.3% to at most 20%; in legs, from 4.4% to at most 18% |
| Recommendations never dispatched | Yes |
| A label is not a template | **No direction given.** It cannot be given from this data either: a supervisor's label can overstate the richer kinds as easily as the core ones |
| No repo split | Says only per-repo counts are lost. Enough |
| Finding C | Says the richer group's cost is overstated, which holds. The verdict-reading note is wrong (§3) |
| Finding D | Says the drops are an upper bound. **Wrong for reviews:** keyword matching misses paraphrase (overstating the Principle 0 drop) and catches loose uses of "regression" (understating the review drop). "Overrides happen on engine misses" gives no direction; on the four plan tickets with both arms, written plans are 64% of the template, not 51% |

Missing: **beats are counted as dispatches** (§1).

### 7. Version 2 of the paper

`prompt-kinds.md` version 2 carries every correction above, with this check's author added. Its
conclusions change in two places:
- **Finding C** now says the sample cannot tell whether richer kinds help, with the corrected
  verdicts and the cost ratios after supervision is removed.
- **Finding D's targets** are now the review's Regression Check and the Plan Review Verdict
  instructions. They are no longer close-out's "regression" or Principle 0.

Option 1 stays recommended, on the ground that the off-loop kinds are 1.4% of tokens and the
evidence goes neither way. The existing line in `proposals.md` is narrowed to the corrected targets.

## Method

```sh
cp -R <the paper's workspace>/data/survey-kinds data/survey-kinds-orig      # its snapshots, unmodified
node scripts/survey-kinds-transcripts.mjs                                     # fresh, 1 October
node scripts/survey-doubling-runner.mjs --out data/survey-kinds/runner.json
node scripts/survey-costmix-tokens.mjs --since 2026-09-01 --until 2026-10-01 --out data/survey-kinds/tokens.json
node scripts/survey-kinds-analyse.mjs                                         # census.json: cmp-identical to the paper's
node scripts/survey-kinds-figures.mjs                                         # the SVG: git status clean
node scripts/survey-kinds-fidelity.mjs --dir <copy of data/survey-kinds-orig> # fidelity.json identical
HARBOUR_LOCAL_BASE=http://127.0.0.1:9 node scripts/survey-kinds-verdicts.mjs --dir <copy> --extra LIN-3200   # cached reads only
node scripts/survey-check-13.mjs --dir data/survey-kinds-orig                 # every figure §1 and §4 add
```

- **Mechanism.** Every cited line was read with `git show 2b454442:<path>`; simple-dispatcher at
  d3f9bc0d. The mention counts were tried as plain words and as backticked spans over several spans
  of the tree; only backticked spans over :128-240 reproduce.
- **Finding C.** Every verdict-headed comment in the 32 tickets' cached reads was read by hand: a
  plan-review or code-review verdict counts once, at its own review; a note quoting one does not.
  The token splits remove sessions whose header is `autopilot` or that the transcripts mark as a
  stepper. The per-ticket rows are below; every ratio in §3 except the supervision split can be
  recomputed from them.
- **Finding D.** The "model's own text" is a prompt up to the first code-appended heading (the
  re-ground, task-complete, subtasks-complete, prior-investigation and proxy sections). Ten written
  plans without the phrase "Principle 0" and ten written reviews without "regression" were read in
  full.
- **Proxy.** This session made five reads: `/me`, the ticket twice, its brief and the dispatch item. The
  verdicts re-ran from the paper's cache with the proxy pointed at a dead port. The one write is
  this ticket's closing comment.

### The 32 tickets of finding C

Dispatches include beats. Request Changes are "script / read by hand". Tokens are weighted, in millions.

| richer | start | impl. | children | dispatches | plan-review RC | code-review RC | tokens | matches |
|---|---|---|---|---|---|---|---|---|
| LIN-2516 (epic) | 09-04 | yes | 11 | 13 | 2 / 2 | 0 / 0 | 27.9 | 2535, 2536, 2537 |
| LIN-2468 | 09-04 | yes | — | 11 | 0 / 2 | 0 / 0 | 12.0 | 2534, 2548, 2561 |
| LIN-2517 | 09-04 | yes | — | 7 | 0 / 0 | 0 / 0 | 7.8 | 2339, 2543, 2510 |
| LIN-1988 | 09-04 | yes | — | 6 | 0 / 0 | 0 / 0 | 6.8 | 1938, 2514, 2511 |
| LIN-2720 | 09-10 | yes | — | 27 | 3 / 2 | 0 / 0 | 28.5 | 2731, 2717, 2444 |
| LIN-2754 (epic) | 09-11 | no | 3 | 30 | 5 / 4 | 0 / 0 | 30.8 | 2759, 2808, 2651 |
| LIN-3059 | 09-27 | no | 4 | 19 | 2 / 2 | 0 / 0 | 33.7 | 3105, 3075, 2919 |
| LIN-3134 | 09-29 | yes | 2 | 23 | 2 / 2 | 0 / 0 | 26.6 | 3133, 3135, 3137 |

| match | dispatches | plan-review RC | code-review RC | tokens | match | dispatches | plan-review RC | code-review RC | tokens |
|---|---|---|---|---|---|---|---|---|---|
| 2535 | 6 | 0 / 0 | 0 / 0 | 3.2 | 2731 | 13 | 0 / 0 | 0 / 0 | 9.6 |
| 2536 | 7 | 2 / 2 | 0 / 0 | 7.7 | 2717 | 25 | 2 / 1 | 1 / 1 | 26.4 |
| 2537 | 5 | 0 / 0 | 0 / 0 | 4.4 | 2444 | 26 | 1 / 1 | 3 / 3 | 36.8 |
| 2534 | 24 | 3 / 2 | 1 / 0 | 21.9 | 2759 (epic) | 21 | 1 / 1 | 1 / 0 | 24.2 |
| 2548 | 5 | 0 / 0 | 0 / 0 | 3.8 | 2808 | 3 | 0 / 0 | 0 / 0 | 2.7 |
| 2561 | 4 | 0 / 0 | 0 / 0 | 3.9 | 2651 (children) | 18 | 2 / 1 | 0 / 0 | 27.8 |
| 2339 | 6 | 0 / 0 | 0 / 0 | 6.8 | 3105 (children) | 17 | 1 / 1 | 2 / 0 | 19.7 |
| 2543 | 8 | 1 / 1 | 0 / 0 | 7.9 | 3075 | 4 | 5 / 2 | 0 / 0 | 4.9 |
| 2510 | 8 | 0 / 2 | 0 / 0 | 10.8 | 2919 (children) | 6 | 1 / 1 | 0 / 0 | 28.5 |
| 1938 | 8 | 2 / 2 | 0 / 0 | 10.0 | 3133 | 13 | 0 / 0 | 0 / 0 | 3.3 |
| 2514 | 10 | 0 / 0 | 0 / 2 | 11.0 | 3135 | 19 | 0 / 1 | 1 / 0 | 9.7 |
| 2511 | 8 | 1 / 2 | 0 / 0 | 8.6 | 3137 | 19 | 0 / 0 | 0 / 0 | 6.1 |

LIN-3105's four code-review Request Changes mirrored from its child LIN-3110 are not counted.

## Limits

- **The hand-read verdicts are one reader's.** A verdict that quotes another was judged by context.
  *Bias:* errors are as likely in either group, and the direction of the difference held under both
  readings.
- **The supervision split relies on session headers.** A stepper session that lacks the marker
  stays in the ticket's own cost. *Bias:* the 1.5× after removing supervision is if anything high.
- **The three-ticket comparison is three tickets.** It shows the premium can vanish, not that it
  does in general. *Bias:* none known in direction; it is simply too small to carry a number.
- **The Principle 0 substance test is a proxy.** Naming both BLOCKED and PENDING-EXTERNAL is
  necessary for the test but not sufficient. *Bias:* it may overstate survival somewhat. The read
  of ten plans found the substance in four, which is in line with it.
- **The subagents shared a tier with the paper's author.** Each reading is of quoted text or a
  re-runnable script. This session re-derived §1 and §4 by script and the §3 ratios from the table
  below, and spot-read the verdict misses (LIN-2468) and the template text behind §4.

## Next

- **The proposals line on the engine's rewrite is narrowed, not added to.** The fixture eval should
  score the review's Regression Check step and the Plan Review Verdict instructions, which drop.
  Close-out's "regression" and Principle 0 are mostly a lost word, not a lost rule.
- **Whether a richer pass helps is still open,** and this census cannot answer it. A prospective
  read would: tickets the engine routes to plan where a design or spike pass is added by lineage
  holdout (M29), scored on plan-review rounds and tokens with stepper sessions held apart. Not
  added to `proposals.md`. The off-loop kinds are 1.4% of tokens, so it ranks below the eval.
