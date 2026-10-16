---
title: Flow and convergence
kind: essay
argument: Anthropic's published engineering practice and Harbour's record value the same things and share most of the same practices, usually Anthropic's in print first; what keeps any part of a fleet lean is not caring about it, nor even counting it, but holding it to a limit — Anthropic holds its harness to one and counts its code volume as success, Harbour holds its prompts to byte limits and counts its process weight as a cost, and in both records the part that is counted but not limited grows; for one engineer on a fixed budget the code's shape has to be counted and held to a limit, because the judgement a lab uses instead is what one engineer lacks.
version: 2
date: 2026-10-15
authors: [Claude, for John Kershaw]
model: "Frontier tier, claude-code, effort not recorded by the harness; the interactive cloud session that wrote theseus.md and drawing-the-ship.md, with no dispatch lineage. The 25 entries on anthropic.com/engineering's index (one redirects to a Claude Code docs page) were downloaded on 15 October 2026 and read by three in-session subagents against one list of themes; every quotation here was checked verbatim against the downloaded text. Harbour's dates are commit dates, each checked with git log. Version 2 makes the corrections of an in-session fact-check of version 1, among them the central symmetry (version 1 said the growing parts were unmeasured; both are measured, and the difference is a limit). Not independently checked."
sources:
  - "Anthropic, Building effective agents, 2024-12-19. https://www.anthropic.com/engineering/building-effective-agents"
  - "Anthropic, How we built our multi-agent research system, 2025-06-13. https://www.anthropic.com/engineering/multi-agent-research-system"
  - "Anthropic, A postmortem of three recent issues, 2025-09-17. https://www.anthropic.com/engineering/a-postmortem-of-three-recent-issues"
  - "Anthropic, Effective context engineering for AI agents, 2025-09-29. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents"
  - "Anthropic, Making Claude Code more secure and autonomous with sandboxing, 2025-10-20. https://www.anthropic.com/engineering/claude-code-sandboxing"
  - "Anthropic, Effective harnesses for long-running agents, 2025-11-26. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents"
  - "Anthropic, Demystifying evals for AI agents, 2026-01-09. https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents"
  - "Anthropic, Building a C compiler with a team of parallel Claudes, 2026-02-05. https://www.anthropic.com/engineering/building-c-compiler"
  - "Anthropic, Harness design for long-running application development, 2026-03-24. https://www.anthropic.com/engineering/harness-design-long-running-apps"
  - "Anthropic, How we built Claude Code auto mode, 2026-03-25. https://www.anthropic.com/engineering/claude-code-auto-mode"
  - "Anthropic, Scaling Managed Agents: Decoupling the brain from the hands, 2026-04-08. https://www.anthropic.com/engineering/managed-agents"
  - "Anthropic, An update on recent Claude Code quality reports, 2026-04-23. https://www.anthropic.com/engineering/april-23-postmortem"
  - "Anthropic, How we contain Claude across products, 2026-05-25. https://www.anthropic.com/engineering/how-we-contain-claude"
  - "Anthropic, Redesigning source control at Anthropic, 2026-10-13. https://www.anthropic.com/engineering/redesigning-source-control"
  - "Claude Code Docs, Best practices for Claude Code (undated; redirected from anthropic.com/engineering/claude-code-best-practices). https://code.claude.com/docs/en/best-practices"
  - "Harbour commits named in the table, each checked with git log on 15 October 2026 (LinearViewer; simple-dispatcher for 88ba61c and e75478e)"
  - "docs/north-star.md@38fc3b5c:7-11; CLAUDE.md@38fc3b5c:103,110; c0ad85bd (LIN-2896); 1e53c0ac (LIN-3203)"
  - "docs/papers/harbour/steady-base.md@38fc3b5c:15-16 and docs/papers/harbour/growth-atlas.md@38fc3b5c:22 (process weight)"
  - "docs/papers/harbour/reliability-baseline.md@38fc3b5c:16; lib/kpi-stats.js, lib/follow-on-ratio.js, scripts/survey-scorecard.mjs and lib/model-pricing.js, all @38fc3b5c (Harbour's measures)"
  - "docs/reviews/capacity-test-run-review-2026-08-14.md@38fc3b5c:6 (the £180-a-month account)"
  - "docs/escalation-philosophy.md@38fc3b5c:8 (built on EEMUA 191)"
  - "docs/papers/harbour/persistent-mind-ephemeral-hands.md@38fc3b5c:15 (cites the auto mode post)"
  - "docs/papers/harbour/theseus.md@06e90ff5:62-133 and scripts/code-shape/seams.mjs@38fc3b5c (tangles; the 179-line script)"
  - "docs/papers/harbour/the-second-copy.md@06e90ff5; docs/papers/harbour/what-doubled-the-dispatches.md@38fc3b5c (opening answer)"
  - "docs/papers/harbour/coherence-as-it-grows.md@06e90ff5 (opening answer: one decision from one file to eighteen)"
---

# Flow and convergence

*What a lab's published practice and a one-person fleet each count, each limit, and each let grow.*

Anthropic's engineering blog and Harbour's own record value the same things. They share most of
the same practices, and where both have one, Anthropic's was usually in print first. Both also
care about the shape of their code. What differs is what each holds to a limit:

- **Anthropic** keeps a piece of its harness only while that piece is load-bearing. It counts the
  volume of code flowing through the harness as success.
- **Harbour** caps the size of its prompts and its CLAUDE.md. It counts the rest of its process
  as a cost, without a cap.

In both records, the part that is counted but not limited is the part that grows. Counting alone
does not keep anything lean; a limit does.

The code's shape is where the two diverge. A lab can keep it in the judgement of its engineers.
One engineer steering a fleet on a fixed budget cannot. That engineer has to count the shape and
hold it to a limit. That is the argument. The rest of this essay sets out the evidence for it,
and the evidence against.

**On who wrote this.** This essay is by Claude, a model made by Anthropic. It reads Anthropic's
published practice against a codebase that Claude sessions built almost entirely. The reader
should weigh that. Every claim below is set out so that it can be checked without trusting the
author, and version 1 was corrected after such a check.

## 1 The same practices, months apart

The table sets each practice found in both records beside its earliest dated appearance in each:
a post's publication date on Anthropic's side, a commit date on Harbour's.

| Practice | Anthropic, first published | Harbour, first committed |
|---|---|---|
| A separate judge for the maker's work | Building effective agents, 19 Dec 2024 (evaluator and optimizer); a skeptical standalone evaluator, 24 Mar 2026 | Claude Code Review in CI, `acf18d6c`, 18 Jan 2026; "the un-authorable judge", `3e077d83`, 12 Jun 2026; close-out split from review, `ba6ec27e`, 29 Jun 2026 |
| Validating a change to the prompt or harness | Multi-agent research system, 13 Jun 2025; Demystifying evals, 9 Jan 2026 | Prompt-change A/B harness, `3a1b3a82`, 4 Jun 2026 |
| Silent regressions caused by the system around the model | Postmortem of three issues, 17 Sep 2025 | Drift-defense spec, `00cab69e`, 29 May 2026; "Silent failures and detection gaps outrank feature work", north star v2, `619366bc`, 31 Jul 2026 |
| Prompt context as a budget | Effective context engineering, 29 Sep 2025 | Scale the prompt to the task, `2d2f7f23`, 7 Jun 2026; CLAUDE.md capped, `c0ad85bd`, 18 Sep 2026; prompt bytes frozen, `1e53c0ac`, 2 Oct 2026 |
| Too many approvals for one person to read | Sandboxing ("approval fatigue"), 20 Oct 2025; auto mode, 25 Mar 2026 | Escalation design on EEMUA 191, `36fec556`, 18 Jul 2026; false-escalation KPI, `93ed7ccd`, 23 Aug 2026 |
| Credentials out of reach of the agent's code | Sandboxing, 20 Oct 2025 | Read/readWrite proxy tokens, `33c94da6`, 6 Mar 2026; server-resolved grants, `15e73ffe`, 28 Sep 2026 |
| Artefacts that carry work across sessions | Effective harnesses for long-running agents, 26 Nov 2025 | The task brief, `77212b5d`, 31 May 2026; starting-context paper, `2ef4a25a`, 1 Oct 2026 |
| A standing role against duplicated code | C compiler: an agent "coalescing any duplicate code", 5 Feb 2026 | Drift & Coherence periodical, `d4794843`, 10 Jun 2026 |
| A durable orchestrator driving disposable sessions | Managed Agents, 8 Apr 2026 (the research system of 13 Jun 2025 already saved a lead agent's plan to external memory and resumed after errors) | Dispatch queue, `b1681f5d`, 20 Jan 2026; simple-dispatcher's first commit, Stop-hook dispatch of Claude Code sessions, `88ba61c`, 26 Feb 2026 |
| Many agents changing one codebase | C compiler: git and lock files, 5 Feb 2026 | 114 pull requests merged from Claude Code session branches before 5 Feb 2026, driven by hand; per-session clones for parallel dispatch, simple-dispatcher `e75478e`, 20 Jun 2026 |
| The code's shape measured as a series over time | none in the 25 entries | Agent-written trend reviews from `d4794843`, 10 Jun 2026; counted mechanically in coherence-as-it-grows, `9261a894`, 8 Oct 2026, and Seams & Tangles, `6597d6e0`, 13 Oct 2026 |
| Source control rebuilt for the rate of change | Redesigning source control, 13 Oct 2026 | none |

Read plainly, the table says four things:

1. **On the first eight rows, Anthropic published first.** Harbour's first commit came four to
   thirteen months later.
2. **Two rows are contested.**
   - A durable orchestrator driving disposable sessions appears in Harbour's commits before the
     Managed Agents post, but after the research post had described a lead agent with external
     memory.
   - Harbour merged work from many Claude Code sessions in January, before the C-compiler post,
     but drove them by hand. Its coordinated parallel dispatch came in June.
3. **Each side has a row the other lacks.** Anthropic rebuilt its source control. Harbour counts the
   shape of its code over time, though only mechanically since October.
4. **The comparison favours Harbour,** for two reasons:
   - Publication follows practice, so Anthropic's practices are older than their posts, while
     Harbour's commit dates sit close to when each practice began.
   - The table shows dates, not influence. Harbour reads these posts: its *persistent-mind* essay
     cites the auto-mode post. In places it plainly took another route; its escalation design is
     built on EEMUA 191, the process industry's guide to alarm management.

**The budgets differ by orders of magnitude.**

- Harbour's August capacity review records its fleet running on a single £180-a-month
  subscription account.
- Anthropic's C compiler took "nearly 2,000 Claude Code sessions and $20,000 in API costs".
- In the harness-design post, one app cost $200 on the full harness. A different app cost $124.70
  on the simplified one.
- The source-control post says Anthropic's "ability to spend tokens for internal use far exceeds
  what any other business would realistically want to spend".

The essay does not lean on the gap, beyond what it implies for who can afford judgement.

## 2 What each counts

Sorting the numbers each record publishes by what they measure makes the difference concrete.

| What is counted | Anthropic's published numbers | Harbour's measures |
|---|---|---|
| Flow: how much changes, how fast | Merges per day, from "around 2,500" in May to "over 30,000" in September (source control) | Correct, complete changes per week (`scripts/survey-scorecard.mjs`); the dispatch funnel and queue latency on `/kpis` (`lib/kpi-stats.js`) |
| Correctness of each result | Pass rates on compiler test suites; eval scores; evaluator scores against criteria | Verified work: CI green, merged, review ledger discharged (north star); escaped defects per 100 PRs (reliability baseline) |
| Safety: how far a mistake reaches | 0.4% false positives and "17% false-negative rate on real overeager actions" (auto mode); 84% fewer permission prompts (sandboxing) | False-escalation rate; secret scans; "Silent failures and detection gaps outrank feature work" (north star) |
| Cost | $20,000 for the compiler; $124.70 and $200 for two app builds; tokens per task | Cost per verified task, the north star's headline. It is currently unreadable: `lib/model-pricing.js` has no rows for the models now doing the work |
| Process weight: the machinery around the work | No published count; harness pieces kept only while load-bearing | Series on process weight (steady-base, growth atlas); follow-on tasks per verified task, which the north star counts as a "tracked tax" (`lib/follow-on-ratio.js`); caps on CLAUDE.md and prompt bytes |
| Convergence: the shape changes leave | none published | Places per decision; two-way tangles between areas |

Anthropic publishes numbers in four of the six rows. Harbour has measures in all six, but its
convergence measures are new and live in periodicals and papers, not among the north star's
headline readings, and its cost headline is dark. Neither record is complete.

## 3 Where convergence lives at Anthropic

Convergence is not missing from Anthropic's practice. It sits in four places, none of them a
series.

**Judgement.** The source-control post says that "Very often, we found that the role of the
engineers was to tell Claude “no.”" Skilled engineers had to "steer Claude away from
over-engineering parts of the system in response to hypothetical concerns". A team of seven
people built the system and migrated the monorepo onto it in five months.

**Standing agent roles.** In the C compiler, "LLM-written code frequently re-implements existing
functionality, so I tasked one agent with coalescing any duplicate code it found." A second agent
was asked to improve the project's structure. The post gives no figure for what either achieved.

**Gates on each change.**

- The long-running harness asks every session to leave "the kind of code that would be
  appropriate for merging to a main branch": orderly, documented, ready for the next session.
- The evals post describes Claude Code's evals growing to cover "more complex behaviors like
  over-engineering".
- The best-practices guide deliberately scopes a reviewer to correctness: "Report gaps, not style
  preferences."

**The harness.** Managed Agents found that context resets "had become dead weight" as models
improved, and removed them. The harness-design post closes on the same test applied in both
directions: "stripping away pieces that are no longer load-bearing to performance, and adding new
pieces to achieve greater capability". A piece of harness stays only while it earns its place.

## 4 What is held to a limit stays lean

Put the two records side by side, and the same pattern shows in each.

**Anthropic** holds its harness to a limit: a piece stays only while it is load-bearing. The code
that flows through the harness is counted too, but as the thing to increase: "every bottleneck we
remove immediately leads to a further increase in the amount of code we produce". Merges per day
rose more than tenfold between May and September. Nothing in the published record limits the
code's volume or shape.

**Harbour** holds two parts of its process to a limit, both enforced by tests:

- **CLAUDE.md** was cut from 153,845 bytes to 9,148 in September and is capped at 12,000
  (`c0ad85bd`).
- **Prompt bytes** were frozen in October; a new lesson lands as code, or replaces bytes elsewhere
  (`1e53c0ac`).

The rest of its process is counted without a cap, and it grows. The steady-base paper opens: "It
only grows, and fastest at the gates. Since the fleet started in June, every measure of process
weight we could put a series on has risen". The growth atlas: "Process weight is outrunning
delivered product."

**Harbour's code shape** has been counted since October and has no limit yet. Across 1,941
commits its areas tied 24 two-way tangles and untied 5. None came undone between 20 January and 6
October, and when they did, it was because something was taken away [T].

Neither pattern is a failing in itself; Anthropic counts its code volume as value, and says so.
The lesson both records teach is narrower and more useful: watching a quantity does not stop it
growing. Harbour's Drift & Coherence periodical has reviewed the code for decisions held in
several places since June. Over the same months, one small decision, a tolerant timestamp parse,
spread from one file to eighteen [C]. Harbour's process-weight series rose through every week they
cover. What shrank or held were the two parts with a limit attached.

## 5 Why one engineer has to count and limit what a lab can judge

The source-control post puts the convergence work in engineers telling Claude "no". That
mechanism scales with the number of engineers and the attention each can spare. Harbour has one
engineer, and its north star says so: "Operator minutes and sessions are the scarce resources."
A fleet producing work faster than one person can read cannot keep its code's shape in that
person's judgement.

Gates on each change do not see the code's shape either, because the damage is spread across
changes:

- Of Harbour's 24 tangles, 23 were tied by a single new import, each in a change merged on its
  own merits [T].
- One was tied by LIN-3455, a coherence-loop batch whose purpose was to bring decisions to one
  place. The one place it chose sat in another area, and the pair it re-tied had been untied five
  days before [T].
- In a frontend design loop in the harness-design post, "Implementation complexity also tended to
  increase across rounds", as the generator reached for more ambitious solutions in response to
  the evaluator's feedback. Each round answered its judge, and the total moved anyway.

Scion lets agents fix merge conflicts, which "Claude can typically fix … faster than humans can
even identify them". But a decision copied into a second file does not conflict with the first,
so a merge queue never sees it. That is this essay's inference, not the post's claim. *The Second
Copy* sets out what such copies cost later, when the decision changes.

**A count is the cheap substitute for the judgement Harbour cannot afford.** The script behind its
tangle history, `scripts/code-shape/seams.mjs`, is 179 lines. Replaying it over every commit on
`main` produced the history above, though classifying each event still took a reader [T].

**A count alone is not enough; section 4 says so.** It needs a limit attached. One example would
be a rule that a change which ties a new tangle goes back for rework, enforced by a test like the
caps that already hold CLAUDE.md and the prompts. What a count cannot do is choose the fix. That
still takes a person.

## 6 What cuts the other way

**Deletion can break things.** Anthropic's September 2025 postmortem traces one of three issues to
removing an old workaround: "The December workaround had been inadvertently masking this
problem." Harbour's record says tangles come undone only when something is taken away, but taking
away is not free. A convergence loop needs the same evidence before it deletes as a feature needs
before it ships. Harbour's plan for its first rebuild, the Providers block, runs only against a
written conformance suite [T].

**Changes pass every gate and still do harm, in both records.**

- **Anthropic.** In the April postmortem, one change "made it past multiple human and automated code
  reviews, as well as unit tests, end-to-end tests, automated verification, and dogfooding." It was
  found through users' reports and more than a week of investigation. The same post reverses a
  default that had traded quality for speed: "This was the wrong tradeoff."
- **Harbour.** Dispatches per correct change rose from 7.6 to 20.0 across 12 July. Most of the rise
  was follow-ups created by two changes to its own harness (LIN-1219, LIN-1357). The rise was found
  afterwards, by papers reading the logs.

Neither was caught by the gate on its change. Neither was caught by a standing series either:
both were found after the fact. That supports measuring outside the gate, but not the stronger
claim that a series would have caught them.

**Flow matters, and convergence costs flow.** Harbour counts correct changes per week too, and its
coherence loop spent budget that features did not get. A more-than-tenfold rise in merges is a
real capability, not a vanity number.

**Rebuilding can stand in for converging.** With tokens to spare, a lab can rewrite rather than tidy.
Seven people built a version control system and migrated a monorepo onto it in five months.
Harbour's own direction is the same move at a smaller scale: rebuild one block at a time against a
written spec. Counting the code's shape does not argue against rebuilding. It is how a team on a
budget chooses what to rebuild next.

## 7 What each could take from the other

**From Anthropic, for Harbour:**

- **A judge tuned to be skeptical, apart from the maker.** "agents reliably skew positive when
  grading their own work", and "tuning a standalone evaluator to be skeptical turns out to be far
  more tractable than making a generator critical of its own work." Harbour's review legs are
  already separate sessions. The post's point is that tuning the judge is the tractable part.
- **Each judge's error rate stated plainly.** Auto mode calls its 17% false-negative rate "the
  honest number". Harbour counts false escalations and escaped defects. A miss rate for each of its
  judges (review, close-out, the stage selector) would sit beside them.
- **A load-bearing test for the whole process,** not only the two parts with caps: remove what no
  longer earns its place, and add what does.
- **Soak periods and gradual rollouts for changes to the prompt,** the April postmortem's remedy,
  beside Harbour's A/B validation.

**From Harbour, for anyone scaling flow:**

- **A weekly count of the code's shape beside merges per day:** places per decision, tangles
  between areas, net deletion. It is cheap to compute and replays the whole history.
- **A limit on that count, enforced like a size cap,** so that a change which worsens the shape goes
  back.
- **Counting the code a convergence step deletes, not only what it consolidates.**

The evals post already names the risk: "One-sided evals create one-sided optimization." A record
that counts flow, correctness and safety but not shape is one-sided in that sense. So is a record
that counts its process weight and limits only two parts of it.

## 8 What this does not show

- **Published is not practised.** Anthropic may count and limit its code's shape internally and
  not have written about it. The claim here covers the published record only: 25 index entries,
  read on 15 October 2026.
- **Dates are not influence,** and they favour Harbour (section 1). Two rows are contested.
- **Harbour's shape counts are recent.** Before October, the shape evidence was reviews written by
  agents, with counts made as each review went. The mechanical series dates from October, so the
  contrast between counting and judging rests partly on an instrument a week old.
- **The limit argument is an inference from a few cases.** Two parts of Harbour's process held
  under caps for a month or less, and quantities that were watched without a limit grew. Whether a
  cap on the code's shape would hold, and at what cost to flow, is untested.
- **The reading was done by subagents.** Three in-session readers summarised the posts against one
  list of themes. Every quotation used was machine-checked against the downloaded text, but the
  choice of what to quote was theirs and mine.
- **The author is a party to both sides,** as said at the start.

## Annotated reading list

Each source is listed with what it supports here, and what it does not. The Anthropic posts are
read as published accounts of practice, not as a full description of it.

- **Building effective agents** (19 Dec 2024). Supports the evaluator-and-optimizer pattern, an early
  published separate judge. It covers agent patterns in general, not coding fleets.
- **How we built our multi-agent research system** (13 Jun 2025). Supports evals used to validate
  prompt changes, and a lead agent that saves its plan to external memory and resumes after errors.
  It is about research, and says most coding tasks are less parallel.
- **A postmortem of three recent issues** (17 Sep 2025). Supports a removed workaround exposing a
  masked bug. It concerns serving infrastructure, not an application codebase.
- **Effective context engineering for AI agents** (29 Sep 2025). Supports context as a budget. No
  content on codebase health.
- **Making Claude Code more secure and autonomous with sandboxing** (20 Oct 2025). Supports "approval
  fatigue", 84% fewer prompts, and credentials outside the sandbox.
- **Effective harnesses for long-running agents** (26 Nov 2025). Supports artefacts that hand work
  across sessions, and orderly, merge-ready code at each handover. It is about each handover, not
  the codebase's shape over time.
- **Demystifying evals for AI agents** (9 Jan 2026). Supports over-engineering evals, code-quality
  rubrics, and "one-sided evals". Its grading is per output, not a trend.
- **Building a C compiler with a team of parallel Claudes** (5 Feb 2026). Supports the
  deduplication and structure agents, $20,000 over nearly 2,000 sessions, and coordination through
  git and lock files. No figures for what the deduplication agent achieved.
- **Harness design for long-running application development** (24 Mar 2026). Supports the skeptical
  standalone evaluator, the two apps' costs, complexity rising across rounds of a frontend design
  loop, and the load-bearing test for the harness. Code quality is one of its criteria, but no
  result is reported.
- **How we built Claude Code auto mode** (25 Mar 2026). Supports the 0.4% false-positive and 17%
  false-negative rates. Leaves in-project code edits out of scope.
- **Scaling Managed Agents** (8 Apr 2026). Supports the durable session apart from disposable
  sandboxes, and resets as "dead weight". Its latency figures measure the product, not the flow of
  changes.
- **An update on recent Claude Code quality reports** (23 Apr 2026). Supports a change that passed
  every gate, found through users' reports and investigation, and a reversed trade of quality for
  speed.
- **How we contain Claude across products** (25 May 2026). Background on approvals and containment.
  No figure here rests on it.
- **Redesigning source control at Anthropic** (13 Oct 2026). Supports merges rising from about 2,500
  to over 30,000 a day, seven people and five months, engineers telling Claude "no", every removed
  bottleneck increasing the code produced, and the token-spend line. It counts no code shape over
  time.
- **Best practices for Claude Code** (Claude Code Docs, undated). Supports review scoped to
  correctness. As a living page, it may change after 15 October 2026.
- **[T]** `docs/papers/harbour/theseus.md@06e90ff5:62-133` and its data. Supports:
  - 24 tangles tied and 5 untied;
  - 23 of the 24 from a single import;
  - none untied between 20 January and 6 October;
  - untying only by taking something away;
  - LIN-3455's re-tie;
  - the Providers rebuild against a conformance suite.

  `scripts/code-shape/seams.mjs@38fc3b5c` is the 179-line script it replays.
- **[C]** `docs/papers/harbour/coherence-as-it-grows.md@06e90ff5`, its opening answer. Supports a
  tolerant timestamp parse spreading from one file to eighteen while duplicated text fell. The
  periodical's start date is `d4794843`.
- **Harbour's limits.** `CLAUDE.md@38fc3b5c:103,110`, `c0ad85bd` and `1e53c0ac`. Support the two caps
  enforced by tests, and the cut from 153,845 to 9,148 bytes.
- **Harbour's measures.**
  - `docs/north-star.md@38fc3b5c:7-11`: verified work, cost per verified task, follow-on tasks as a
    "tracked tax", and silent failures.
  - `docs/papers/harbour/reliability-baseline.md@38fc3b5c:16`: escaped defects per 100 PRs.
  - `lib/kpi-stats.js`, `lib/follow-on-ratio.js`, `scripts/survey-scorecard.mjs` and
    `lib/model-pricing.js`, all `@38fc3b5c`: each supports the measure named beside it in section 2.
- **Harbour's own words.**
  - `docs/papers/harbour/steady-base.md@38fc3b5c:15-16` and
    `docs/papers/harbour/growth-atlas.md@38fc3b5c:22`: the process grows.
  - `docs/reviews/capacity-test-run-review-2026-08-14.md@38fc3b5c:6`: the £180 account.
  - `docs/escalation-philosophy.md@38fc3b5c:8`: EEMUA 191.
  - `docs/papers/harbour/persistent-mind-ephemeral-hands.md@38fc3b5c:15`: cites the auto mode post.
  - `docs/papers/harbour/what-doubled-the-dispatches.md@38fc3b5c`, its opening answer: 7.6 to 20.0.
  - `docs/papers/harbour/the-second-copy.md@06e90ff5`: what copies cost later.

  Each supports the line quoted from it. None is independently checked.
- **The table's Harbour commits** are listed in it by short hash. Each was checked with `git log` for
  date and subject on 15 October 2026. The simple-dispatcher commits are on that repository's `main`.

## Next

- **Hold the process to a limit the way the prompts are held.** Harbour counts its process weight
  and it still grows. Give the rest of the process a load-bearing test and a cap, and report whether
  the series turns down and verified work per week holds. That is a line in `proposals.md`.
- **Put the code's shape beside flow, with a limit.** Add a weekly series of places per decision and
  two-way tangles to `/kpis`, beside the flow measures already there. Then test a rule that a change
  which ties a new tangle goes back for rework.
