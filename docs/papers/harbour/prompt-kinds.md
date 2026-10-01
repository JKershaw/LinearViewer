---
title: Why does Harbour use only about six of its seventeen prompt kinds, and would the others earn their keep?
kind: paper
version: 2
date: 2026-10-01
authors: [Claude (version 1, LIN-3207), Claude (version 2 corrections, LIN-3220), for John Kershaw]
model: "frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch c63f11f3, kind custom, LIN-3207); the dispatch item carries no effort field. One bounded session with no research, plan, review or close-out legs, by the brief's design. One in-session subagent of the same tier mapped the selection code read-only; every citation it gave that the findings lean on was re-read at the sha below. Version 2: dispatch 4fb3eee7 (kind custom, LIN-3220), frontier tier, with three same-tier readers."
revision: "Version 2 corrects statements per docs/papers/harbour/survey-check-13.md (LIN-3220). (1) A third of the census is beats, follow-ups into legs already counted; by legs the core share is 95.6% and the supervisors' own choice 97%, not 97–98%; design is 8 legs, not 18 dispatches. (2) Quality rules cover 11 kinds, not 12; spike and context are on the model's menu with their hints, though the tree routes to neither. (3) Finding C: hand-read verdicts give 1.75 against 0.83 plan-review Request Changes and 0 against 0.25 code-review; most of the cost gap goes with stepper supervision and size, so the sample cannot say whether richer kinds help, not that they show no sign of it. (4) Finding D: the review's Regression Check step survives in about 1% of written reviews; close-out has no regression check; Principle 0 is an escalation rule whose substance survives in 32–44%; the Plan Review Verdict instructions drop (36% of plans, 70% of plan-reviews). (5) The coverage bound is 18–20%, not 13%; three option sizes are marked as judgements; the meta-prompt's 5.7× is from May."
grounded_at: 2b454442 (LinearViewer, origin/main); d3f9bc0d (simple-dispatcher, origin/main); the local Claude transcripts and simple-dispatcher's run logs on this machine, read on 1 October 2026. Version 2 read the same snapshots and re-ran them on 1 October.
cites:
  - "lib/prompts/meta-prompt-template.js@2b454442:128-240 (the tree), :134, :139-150, :166, :175, :196, :202, :204, :213, :234, :299-311 (the per-kind quality rules), :315, :358 (the hints and action list)"
  - "lib/openrouter.js@2b454442:26, :1716-1722, :1792-1797, :1845 (one call, cheap tier by default, at temperature 0 writes the action and the prompt; grounding appended after)"
  - "lib/prompt-templates.js@2b454442:170, :431-466 (the menu: every template with an aiHint, minus retro, plus defer)"
  - "lib/prompt-template-defs.js@2b454442:72-1355 (17 templates; bug keyed as [WORK_ISSUE_LABELS.BUG] at :119; :253, :912 the Plan Review Verdict; :1025 the review's Regression Check)"
  - "lib/prompt-formatters.js@2b454442:485 (the CI-substitute paragraph), :516 (implementation's success criteria), :918 (the If Blocked section and Principle 0)"
  - "lib/prompts/autopilot-kickoff.js@2b454442:210-211, :461, :466-478 (stepper stays within one kind; converging vs sprawling; the verb override)"
  - "docs/autopilot-operating-manual.md@2b454442:149-178 (the wrong-verb override; the bias runs down the lifecycle)"
  - "lib/render.js@2b454442:100 (the UI's four default kinds); public/prompt-section.js@2b454442:169-176 (next step); routes/proxy-dispatch.js@2b454442:1203 (kind from the engine's action); routes/proxy-compute.js@2b454442:278, :316, :439-466"
  - "simple-dispatcher dispatcher.js@d3f9bc0d:41 (the runner's only kind-specific rule: NO_BOOTSTRAP_KINDS); hook.js@d3f9bc0d:426-430 (what BLOCKED means)"
  - "docs/steady-base.md@2b454442; docs/papers/harbour/steady-base-menu.md@2b454442:144-208 (M-numbers)"
  - "docs/papers/harbour/review-loops.md@2b454442:13-17, :25-30; docs/papers/harbour/why-legs-repeat.md@2b454442:26-32; docs/papers/harbour/steady-base.md@2b454442:98-99 (the meta-prompt's 5.7× growth, May to September)"
  - "LIN-3200 comments (1 October 2026: plan passes 1-3, Request Changes)"
  - "docs/papers/harbour/survey-check-13.md (the check; its per-ticket table for finding C)"
---

# Why does Harbour use only about six of its seventeen prompt kinds, and would the others earn their keep?

**Because the engine's decision tree is written as a lifecycle, and nothing outside it pushes back.**
In September, 96% of the 2,727 dispatches that carried a template kind used one of six kinds: plan,
plan-review, implementation, review, close-out and research. A third of those are follow-ups into a
leg already running; counted by legs the share is the same, 95.6% of 1,804. The recommender, a single
cheap-tier call at temperature 0, chose the core loop in 95% of its 894 picks. Supervisors choosing
the kind of their own prompts did so in 97%. The meta-prompt's ladder runs through the core kinds,
and the core templates write the markers the tree routes on. The off-loop kinds get one guarded hatch
(design), a guard clause (scoping), or no branch at all (spike, context). The autopilot reads a
widening mix of kinds as "sprawling". Two kinds were never dispatched (context, retro) and five ran
two or three legs each.

Whether the narrow use costs anything, this census cannot say. Eight tickets that had a design,
scoping or spike pass before plan drew more plan send-backs than 24 matched tickets and cost about
three times as much at the median. Most of that gap goes with stepper supervision and size: the three
richer tickets that were neither epics nor stepper-run cost about the same as their matches. The
off-loop kinds are 1.4% of tokens, so the meta-prompt's choice of kind is not worth changing now.
What deserves a measurement first is how it rewrites the prompt. The written prompt's own text is
25–68% of the template's. It nearly always drops the review's regression step, and often the
instruction to write or read the plan-review verdict the tree routes on.

## Findings

![September's dispatches of each template kind, by who chose the kind](figures/prompt-kinds/kinds-by-route.svg)

**A. Six kinds carry 96% of the work; two are dead and five are effectively dead.**
Counts cover 1–30 September and the dispatches a local session enqueued or fetched. Kickoffs, wakes and
untemplated prompts are left out.

| kind | engine | override | written | beat | untraced | total | legs | share of weighted tokens |
|---|---|---|---|---|---|---|---|---|
| implementation | 138 | 33 | 143 | 356 | 87 | 757 | 401 | 22.0% |
| plan | 107 | 11 | 102 | 200 | 77 | 497 | 297 | 6.5% |
| review | 242 | 27 | 49 | 85 | 88 | 491 | 406 | 10.4% |
| close-out | 184 | 13 | 34 | 38 | 56 | 325 | 287 | 5.5% |
| research | 53 | 5 | 58 | 160 | 31 | 307 | 147 | 5.5% |
| plan-review | 125 | 3 | 42 | 67 | 17 | 254 | 187 | 6.5% |
| breakdown | 17 | 1 | 6 | 4 | 0 | 28 | 24 | 0.5% |
| triage | 3 | 0 | 0 | 0 | 15 | 18 | 18 | 0.1% |
| design | 3 | 0 | 5 | 10 | 0 | 18 | 8 | 0.2% |
| blocked | 16 | 0 | 0 | 0 | 1 | 17 | 17 | 0.3% |
| bug | 1 | 0 | 1 | 3 | 0 | 5 | 2 | 0.2% |
| look-into | 0 | 0 | 0 | 0 | 3 | 3 | 3 | — |
| scoping | 3 | 0 | 0 | 0 | 0 | 3 | 3 | <0.1% |
| spike | 0 | 2 | 0 | 0 | 0 | 2 | 2 | 0.1% |
| retrospective-audit | 2 | 0 | 0 | 0 | 0 | 2 | 2 | <0.1% |
| context | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| retro | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |

The routes are:
- **engine**: `recommend-and-dispatch` without a kind.
- **override**: the same call with `kind`, so the server writes the template.
- **written**: a supervisor's own `POST /dispatch`, with the kind as its label.
- **beat**: a written follow-up into a held session. Of the 500 beats a session fetched, 498 went into
  a session already of that kind, so a beat continues a leg counted in another route. **Legs** is the
  total without beats.
- **untraced**: fetched by a session, but no transcript shows the enqueue. This covers the UI,
  server-minted triage and periodicals, the passage Runner's worker lanes, and enqueues whose output
  could not be parsed.

The token column is the share of September's 3.4 billion weighted tokens, by the kind in each session's
header. The rest of the 100% sits in supervisor, stepper, Runner, custom and wake sessions.

- **The engine's own picks** were 849 of 894 in the core six (95%). Its 45 others were:
  - breakdown 17;
  - blocked 16, which is the loop-bound escalation (meta :213);
  - triage, scoping and design, 3 each;
  - retrospective-audit 2;
  - bug 1.

  It picked look-into, spike and context zero times.
- **The verb override, the manual's sanctioned way to reach for a richer kind, was used 95 times.**
  It pinned spike twice and design never. The 8 design legs were started by supervisors labelling
  their own prompts (5) and the engine (3); 10 more design dispatches were beats into those sessions.
- **Recommended against dispatched:** every engine pick above was dispatched, because the fused verb
  recommends and dispatches in one call. Only 23 bare `GET /recommend` previews appear in September's
  transcripts, almost all of them steppers reading a core-loop body. Recommendations shown in the UI
  and never dispatched leave no local trace (Limits).
- **Repos:** every kind is chosen in LinearViewer. simple-dispatcher only runs the item; its one
  kind-specific rule is which kinds skip the bootstrap summary (`dispatcher.js:41`), which changes cost,
  not choice. All counts above come from LinearViewer scripts reading local transcripts. simple-dispatcher's
  run logs provide the coverage check.

**B. The bias is the meta-prompt's tree, carried forward by the core templates' own markers, and
nothing outside it pushes the other way.**
The selection points, and what steers each:

| Where a kind is chosen | What it sees | What steers it | Effect |
|---|---|---|---|
| Recommender (`openrouter.js:1845`, meta-prompt) | The ticket, its comments, its children's states; a menu of 16 template names plus `defer`, in file order, each with its hint (`prompt-templates.js:457-466`; meta :315, :358) | A prose ladder. Its main route (research, the design hatch, no plan → plan, the plan-review gate, session fit, breakdown) runs through the core kinds (meta :151-218). Off-loop kinds enter only as fallbacks for a vague ticket (look-into, triage, :175, :234), a priority or label (blocked, bug, :134), a guarded hatch (design, :196) or an escalation (blocked, :213). "When it is a close call, prefer research" (:166). "Resolve DOWN to plan/research" (:202). | **Produces the bias.** |
| Step 0, injected when code finds a finished node (meta :139-150) | `isTerminal`, `hasOpenChildren` | Prose pointing to review, close-out or retrospective-audit, with a cannot-close branch back to blocked, bug, plan or implementation (:149) | Narrows finished nodes; no code rejects another action. |
| Core-template artifacts | Session fit, Plan Review Verdict, What CI Did Not Prove | The tree routes on markers that only core templates write | **Keeps the loop closed.** A design or spike writes prose nothing routes on, and the tree sends a decided shape on to `plan` (:196, guard c). |
| Autopilot (`autopilot-kickoff.js:461-478`) | The kind sequence of its children | Calls the engine each step. "research→plan→impl→review→close-out" is "converging"; "the kind widening run after run" is "sprawling (worth a flag)". Override "rare, demonstrable misses only". | Reinforces the bias; adds no stepping of its own. |
| Stepper (`autopilot-kickoff.js:210-211`) | The engine's body | "Stay within ONE kind" | Inherits the engine's kind. |
| Passage Runner and worker lanes (`worker-lane-prompt.md:24`) | The passage plan | Child autopilots go back through the engine; a lane is always `implementation` | Inherits the bias, and records a lane's whole cycle as implementation. |
| UI (`render.js:100`, `prompt-section.js:169-176`) | Any issue | "✦ next step" goes to the engine; four default kinds (look-into, research, plan, implementation); 13 more under "more" | Mostly reaches the engine. |

How much attention each kind gets is lopsided:
- **Backticked mentions in the tree** (meta :128-240): review 28, plan 27, close-out and implementation
  17 each, research 11, design 5, scoping 1, spike and context 0. Plain-word counts are several times
  higher, in the same order. Spike and context still reach the model through the menu's hints.
- **Quality rules** (meta :299-311) exist for 11 kinds, plus `defer`. There are none for design,
  scoping, spike, look-into, context or retro.
- **The design hatch** (meta :196, LIN-878) has been in place since 2 July with four guards against
  over-firing. It fired 3 times in 894 September picks.

The manual names the result ("the engine's bias runs *down* the lifecycle toward the core loop",
`autopilot-operating-manual.md:177`) and leaves the reach upward to supervisors. In September they made
that reach twice.

**C. Whether the richer kinds earn their keep, this sample cannot say.**

The groups:
- **Richer:** of the 156 tickets whose first visible dispatch was in September and that reached `plan`,
  8 had design, scoping or spike before their first plan: LIN-1988, 2468, 2516, 2517, 2720, 2754, 3059,
  3134. Look-into never preceded a plan.
- **Matched:** each was paired with the three straight-to-plan tickets nearest in start date that
  matched it on whether a research leg preceded the plan and whether the ticket reached
  implementation, 24 tickets in all.

Verdicts were read by hand from each ticket's comments (`survey-check-13.md` lists all 32).

| per ticket | richer (8) | matched (24) |
|---|---|---|
| plan-review Request Changes, mean | 1.75 | 0.83 |
| code-review Request Changes, mean | 0.00 | 0.25 |
| plan-review dispatches, median | 3 | 1 |
| dispatches excluding wakes and beats, median | 11.5 | 7 |
| weighted tokens, median | 27.2M | 9.1M |
| weighted tokens, mean | 21.8M | 12.5M |

Most of the cost gap goes with supervision and size, not with the richer pass:
- Four of the eight have children, against four of the 24, and a parent carries its stepper's
  sessions. These are 24.5M of LIN-3059's 33.7M and 15.6M of LIN-3134's 26.6M.
- With stepper and autopilot sessions removed, the medians are 10.5M against 7.1M, about 1.5×.
- The three richer tickets that were neither epics nor stepper-run (LIN-1988, 2468, 2517) cost 0.9× their own
  nine matches and 1.0× the matches without children.
- The pairs are not independent: LIN-3134 and all three of its matches are siblings under one
  autopilot run.

Selection runs both ways:
- Contested, larger tickets attract a design pass, which overstates the richer group's costs.
- Requiring a plan drops tickets where a richer pass replaced it. LIN-2667 ran three design passes
  and went straight to implementation. LIN-2360 ran only a spike.

The plan send-backs lean against the richer group, and nothing here says why. Zero code-review
send-backs against 0.25 is about two expected events at n = 8. It is within chance (P ≈ 0.14), since
only six of the eight reached code review.

Two prior readings bear on it, more softly than they are often quoted:
- `review-loops.md` (lines 13–17) found that plan-review's send-backs asked for one more member of a
  list the plan had already built, and none asked for a different design. That rests on eight
  verdicts on three tickets (lines 25–30).
- `why-legs-repeat.md` puts 121 of 131 coded repeats down to send-back loops (lines 26–32).

LIN-3200, the live example, cuts both ways. Its first two plan passes were sent back for facts at
HEAD: a seam the workspace's dispatches don't pass through, and a query that returns nothing. Its
third was sent back for a logic gap. The loop ended when John narrowed the scope ("The pilot's
original brief over-asked"), which is a scoping decision. Research's hint names the first case ("an
unvalidated assumption to de-risk before planning"), and spike's ("feasibility check") would have
fitted it too. The ticket went straight to `plan`: no research, spike or scoping precedes it in the
transcripts. One ticket cannot say how common that is.

**D. Step 2 cuts the prompt to a half or less and keeps the code-appended gates, but nearly always
drops the review's regression step and often the plan-review verdict instructions.**

**There is no separate step 2 that merges task facts into the handwritten template.** One call writes
the action and the whole body (`openrouter.js:1716-1722`). Code then appends the grounding sections
(`:1792-1797`). The handwritten `generate()` body runs for an override, a UI pick, triage, the audit
page and the proxy's template fetch and preview.

The comparison:
- **The pairs:** September's engine-written prompts and the override prompts of the same kind, one row
  per item fetched in a transcript. That is 543 written and 67 template bodies over six kinds.
- **Written prompts are shorter than the templates.** Both arms carry the same appended sections
  (about 2.6k characters), so the model's own text is compared as well:

  | kind | written, whole prompt as share of template | model-written text as share of template text |
  |---|---|---|
  | review | 36% | 25% |
  | close-out | 38% | 26% |
  | plan | 51% | 41% |
  | research | 63% | 52% |
  | implementation | 74% | 62% |
  | plan-review | 80% | 68% |

  The research and plan-review template arms are two prompts and one.

- **The appended gates survive by construction:** the ledger, re-grounding at HEAD and the proxy note
  are in every written prompt because code appends them. The gates the model writes itself mostly
  survive too: What CI Did Not Prove in 100% of written reviews, the mutation check in 98%.
- **What drops:**
  - **The review's Regression Check** (`prompt-template-defs.js:1025`) runs `git log --oneline` over
    the modified files and confirms nothing fixed before comes back. 2 of 142 written reviews carry
    that step. 18% mention reintroduced or reverted work in some form. Implementation's
    regression content is one success criterion (`prompt-formatters.js:516`). Close-out has no
    regression check; the word appears only in its CI-substitute paragraph (:485).
  - **The plan-review verdict instructions.** The plan-review template tells the reviewer to head its
    verdict `### Plan Review Verdict`, the header the tree and breakdown read (`prompt-template-defs.js:912`).
    Written plan-reviews carry it in 70%. The plan template tells a re-plan to read that verdict first
    (:253). Written plans carry it in 36%.
  - **Principle 0** sits in the shared `## If Blocked` section (`prompt-formatters.js:918`). It
    governs when a session may park, not how it plans. The phrase survives in 6% of written plans and
    7% of implementations. Its substance, naming both BLOCKED and PENDING-EXTERNAL, survives in 32%
    and 44%. The runner's Stop-hook check defines BLOCKED for every session anyway (`hook.js:426-430`).
  - Kind-specific template headings survive in 5% or fewer of written prompts. What survives is the
    appended headings and a generic Goal / Context / Workflow skeleton.

So the engine is a compressor that keeps what code appends and most of what reviews must write.
Whether the regression step and the verdict instructions matter is a question for a fixture eval,
not for this census.

**E. Four kinds are manual or event-driven by design, and that is fine. Two never fire and three
barely do.**
- **By design:**
  - `retro` is excluded from the engine because a Done task would trigger it too eagerly
    (`prompt-templates.js:431-440`). It ran 0 times.
  - `triage` is minted by the feedback widget: 15 of its 18 dispatches are untraced, and 13 are named as
    server-minted.
  - `blocked` is the engine's escalation after a second plan send-back: 16 of 17 dispatches.
  - `retrospective-audit` is Step 0's third branch for merged work: 2.

  Each fires where it should.
- **Dead or nearly dead:**
  - `context` ("joining mid-way, returning after gap") ran 0 times. A fleet that always starts sessions
    fresh with a brief has no use for it, and it reads as a tool for a person.
  - `look-into` is one of the UI's four default kinds and ran 3 times, none chosen by the engine.
    Research and triage cover its hint.
  - `spike` ran 2 times, both overrides.
  - `scoping` ran 3 legs and `bug` 2.

## Method

The population is every dispatch item that a main Claude transcript under `~/.claude/projects`
enqueued or fetched, dated 1–30 September 2026, plus each session's header kind (`# LIN-n · kind`).
- **Coverage:** simple-dispatcher's run logs show 2,325 fresh sessions launched in September, and the
  transcripts hold 2,016 of them (87%). Warm follow-ups are mostly wakes delivered inside a held Stop
  hook without a fetch, and the transcripts hold 1,715 of 6,391.
- **Routes:** a route is read from the Bash call that enqueued the item: the endpoint, whether the body
  carried `followUpTo`, and the `"override": true` the server returns on a pinned verb. Responses printed
  as JSON, as a Python dict or as `key = value` lines are all parsed. 182 of September's 2,949 enqueue
  calls (6%) printed nothing parseable and are left out, so their items count as untraced if a session
  fetched them. An id printed by two calls keeps its first route; 6 of the 23 such ids carry two.
- **Legs:** every route but beat. Fresh sessions by header are the third unit.
- **Tokens:** weighted tokens are `survey-costmix-tokens.mjs`'s units (frontier-input equivalents, tier
  weights as `cost-mix.md`), by session-header kind.
- **Finding C** matches as stated there. Its verdicts were read by hand from every verdict-headed comment
  in the 32 tickets. A review's own verdict counts once; a revision or autopilot note quoting one does
  not. The supervision split removes sessions headed `autopilot` or marked as a stepper.
- **Finding D** compares the six kinds that have both arms in the sample, September only, one row per
  item. The model's own text is a prompt up to its first code-appended heading.

The scripts, all under `scripts/` in LinearViewer:
- `survey-kinds-transcripts.mjs`: enqueues, previews and fetches.
- `survey-doubling-runner.mjs --out data/survey-kinds/runner.json`: runner coverage.
- `survey-costmix-tokens.mjs --since 2026-09-01 --until 2026-10-01 --out data/survey-kinds/tokens.json`:
  tokens.
- `survey-kinds-analyse.mjs`: census, coverage and ticket rows.
- `survey-kinds-verdicts.mjs --extra LIN-3200`: matching and the regex verdicts (superseded by the hand
  reading for the table).
- `survey-kinds-fidelity.mjs`: finding D, whole prompts.
- `survey-check-13.mjs`: legs, the coverage bound, and finding D on September only with the model's own
  text.
- `survey-kinds-figures.mjs`: the chart.

Run `survey-kinds-analyse.mjs` once before the verdicts script and again after it. Snapshots go to the
git-ignored `data/survey-kinds/`. The selection-code map was read at the shas in the header.

## Limits

- **September only, not six to eight weeks.** Transcripts and the dispatch history are kept for 30 days,
  and the runner logs name no kind. The census cannot show a trend.
  - *Bias:* the design hatch and the override were both in place all month, so September is a fair
    reading of today's mechanism, not of July's.
- **The 13% of fresh sessions the transcripts miss** may be on the other harness or have been enqueued
  from the UI. A person picking from the UI could reach for richer kinds more than the engine does, so
  the census may understate them.
  - *Bound:* if every one of the 309 missing sessions were an off-loop kind, the off-loop share would
    rise from 5.3% of fresh sessions to at most 20%, or from 4.4% of legs to at most 18%.
- **Recommendations that were never dispatched are invisible.** These are UI suggestions declined by a
  person. They sit in the server's call log, which the proxy does not expose.
  - *Bias:* if people decline the engine's richer picks, the engine recommends richer kinds more often
    than it dispatches them. Nothing here can say how often.
- **A label is not a template.** 440 of the 1,804 legs were supervisor-written prompts carrying a kind
  label, so their kind says what the supervisor meant, not which template text ran.
  - *Bias:* unknown in direction. A supervisor's label can overstate a richer kind as easily as a core
    one, and the census cannot tell which.
- **No repo split.** The dispatch list carries no repo, so dispatches on simple-dispatcher tickets are
  counted inside LinearViewer's queue. Because no kind is chosen in simple-dispatcher, only the
  per-repo counts are lost, not the mechanism.
- **Finding C is n = 8 against 24, matched on two flags and start date, not on size.** Estimates are
  empty on all 32.
  - *Bias:* both ways. Size and supervision overstate the richer group's costs. Requiring a plan drops
    tickets a richer pass may have spared one, which understates its benefit.
  - *Verdict reading:* by one reader, by hand. Errors are as likely in either group.
- **Finding D's template arm is small and selected.** It has plan-review 1, research 2, close-out 4, and
  overrides happen on engine misses.
  - *Bias:* on the four plan tickets with both arms, written plans are 64% of the template, not 51%, so
    the pooled ratio overstates the compression for plan.
  - *Matching:* keyword matching errs both ways. It misses paraphrase, which overstates the Principle 0
    drop. It catches loose uses of a word, which is why the review's regression step is counted by its
    `git log` instruction and not by the word.

## Options

Each option needs a size, a risk and a reading. John's rule is that simple tasks get simple
processes, so an option that adds legs has to remove more than it adds.

1. **Leave the choice of kind as it is.** Recommended.
   - *Effect:* 0. The off-loop kinds are 1.4% of weighted tokens. C cannot say that more of them would
     cut send-backs or cost, in either direction.
   - *Risk:* none.
   - *Measure:* none needed.
2. **A cheap "is a shape or a load-bearing fact contested?" check before `plan`**, as a typed yes/no
   (cf. `jev-decision-model.md`'s gate shape) rather than more prose.
   - *Effect:* a judgement, not a measurement: perhaps −0 to −2% of tokens. Its ceiling is the
     plan-review send-backs a fact check would pre-empt, which no paper has sized. Every ticket pays
     one cheap call, and a yes adds one leg.
   - *Risk:* low to correctness, medium to cost if it over-fires the way the design hatch's four
     guards were written to prevent.
   - *Measure:* plan-review Request Changes per planned ticket, and legs per correct change, held out
     by lineage (M29).
3. **Reword the hints and give the five off-loop kinds tree branches and quality rules.**
   - *Effect:* unknown. A guess of 1–5% of picks moving off the core loop, where the engine's off-loop
     picks are 5% today, with no evidence that this removes legs.
   - *Risk:* low to correctness. It adds prompt prose, against M25's freeze.
   - *Measure:* a per-step fixture eval, three runs per arm, on M33's pattern (written for tier
     changes), before any live change.
   - Not recommended now.
4. **Retire `context`, and fold `look-into` into research or triage**; keep `spike`, `scoping` and
   `design` for overrides.
   - *Effect:* a menu two kinds shorter, one fewer default UI choice; tokens negligible.
   - *Risk:* low. Touches pins (M19, M20).
   - *Measure:* dispatches of the retired kinds stay at 0, and nothing turns up in UI feedback.
   - Housekeeping in the spirit of M30.
5. **Pick the core-loop steps in code.** The tree's core branches are fully decided by observable state:
   plan present, verdict recorded, ledger present, PR green. Keep the model for the forks.
   - *Overlaps:* M5 (rule-class calls in code) and M3.
   - *Effect:* determinism, and the full template body every time, which closes D's drops. It also costs
     1.25–2.8× the prompt characters per leg, the low end resting on one plan-review template. That is
     about 0.5–3k tokens a leg, small beside a leg's carried context but against M12.
   - *Risk:* medium. It changes every worker prompt at once.
   - *Measure:* review faults per change and tokens per correct change, in shadow first (M28).
   - Measure D's drops before choosing between this and leaving step 2 alone.

**Is the meta-prompt worth improving now?** Not its choice of kind. Its prompt writing is worth a
measurement first: a fixture eval of written against template bodies on the review's regression step
and the plan-review verdict instructions, before anyone edits it. The meta-prompt grew 5.7× from May to
September (`harbour/steady-base.md`), so more prose is the wrong first move.

## Next

- Does the engine's compression of the template change what review catches? It nearly always drops the
  review's `git log` regression step, and it drops the Plan Review Verdict instructions from 30% of
  plan-reviews and 64% of plans. A fixture eval of written against template bodies on the same tickets
  answers it. (In `proposals.md`, narrowed by survey-check-13.)
- How often do people decline the engine's UI recommendation, and for which kinds? The server's call
  log has it, once it is kept (M24).
