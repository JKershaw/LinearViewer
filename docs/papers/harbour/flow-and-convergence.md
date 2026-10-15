---
title: Flow and convergence
kind: essay
argument: Anthropic's published engineering practice and Harbour's record value the same things and share most of the same practices, Anthropic's in print first; where they differ is what each measures and so keeps lean — Anthropic its harness and the flow, correctness and safety of changes through it, Harbour the shape those changes leave in the code — and the part each leaves unmeasured, Anthropic's code volume and Harbour's own process, is the part that grows; for one engineer on a fixed budget, the code's shape has to be measured rather than judged.
version: 1
date: 2026-10-15
authors: [Claude, for John Kershaw]
model: "Frontier tier, claude-code, effort not recorded by the harness; the interactive cloud session that wrote theseus.md and drawing-the-ship.md, with no dispatch lineage. The 25 posts on anthropic.com/engineering were downloaded on 15 October 2026 and read by three in-session subagents against one list of themes; every quotation here was checked verbatim against the downloaded text. Harbour's dates are commit dates, each checked with git log. Not independently checked."
sources:
  - "Anthropic, Building effective agents, 2024-12-19. https://www.anthropic.com/engineering/building-effective-agents"
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
  - "Harbour commits named in the table, each checked with git log on 15 October 2026 (LinearViewer; simple-dispatcher for 3cb9a47 and e75478e)"
  - "docs/north-star.md@38fc3b5c:11 (operator minutes and sessions are the scarce resources)"
  - "docs/papers/harbour/steady-base.md@38fc3b5c:15 and growth-atlas.md@38fc3b5c:22 (the process grows)"
  - "docs/reviews/capacity-test-run-review-2026-08-14.md@38fc3b5c:6 (the £180-a-month subscription)"
  - "docs/escalation-philosophy.md@38fc3b5c:8 (built on EEMUA 191)"
  - "docs/papers/harbour/persistent-mind-ephemeral-hands.md@38fc3b5c:15 (cites the auto mode post)"
  - "docs/papers/harbour/theseus.md@06e90ff5 and docs/reviews/seams-tangles-review-2026-10-13.md@38fc3b5c:35 (tangles, and the coherence loop's 255 to 310)"
  - "docs/papers/harbour/the-second-copy.md@06e90ff5; docs/papers/harbour/what-doubled-the-dispatches.md@38fc3b5c (opening answer)"
  - "scripts/code-shape/seams.mjs@38fc3b5c (the 179-line measuring script)"
---

# Flow and convergence

*What a lab's published practice and a one-person fleet each measure, and so keep lean.*

Anthropic's engineering blog and Harbour's own record value the same things. Their practices
are mostly the same too, and where both have one, Anthropic published it first. They differ in
what each one *measures*:

- Anthropic measures the flow of changes, whether each change is correct, and how far a mistake
  can spread. It keeps its harness lean by pruning it.
- Harbour measures the shape the changes leave in the code: decisions held in several places,
  knots between areas, what has been deleted.

Each keeps lean the part it measures. The part each leaves unmeasured grows: the volume of
Anthropic's code, and Harbour's own process. A lab can afford to keep the code's shape in the
judgement of its engineers. One engineer steering a fleet on a fixed budget cannot, and has to
measure it instead. That is the argument. The rest of this essay sets out the evidence for it,
and the evidence against it.

**On who wrote this.** This essay is by Claude, a model made by Anthropic. It reads Anthropic's
published practice against a codebase that Claude sessions built almost entirely. The reader
should weigh that, and every claim below is set out so that it can be checked without trusting
the author.

## 1 The same practices, months apart

The table puts each practice that appears in both records beside its earliest dated appearance in
each. On Anthropic's side that is a post's publication date. On Harbour's it is a commit date.

| Practice | Anthropic, first published | Harbour, first committed |
|---|---|---|
| A separate judge for the maker's work | Building effective agents, 19 Dec 2024 (evaluator and optimizer); a skeptical standalone evaluator, 24 Mar 2026 | Claude Code Review in CI, `acf18d6c`, 18 Jan 2026; "the un-authorable judge", `3e077d83`, 12 Jun 2026; close-out split from review, `ba6ec27e`, 29 Jun 2026 |
| Prompt context as a budget | Effective context engineering, 29 Sep 2025 | Scale the prompt to the task, `2d2f7f23`, 7 Jun 2026; CLAUDE.md capped, `c0ad85bd`, 18 Sep 2026; prompt bytes frozen, `1e53c0ac`, 2 Oct 2026 |
| Rate-limiting the human: approval fatigue | Sandboxing, 20 Oct 2025; auto mode, 25 Mar 2026 | Escalation philosophy on EEMUA 191, `36fec556`, 18 Jul 2026; false-escalation KPI, `93ed7ccd`, 23 Aug 2026 |
| Credentials out of reach of the agent's code | Sandboxing, 20 Oct 2025 | Read/readWrite proxy tokens, `33c94da6`, 6 Mar 2026; server-resolved grants, `15e73ffe`, 28 Sep 2026 |
| Artefacts that carry work across sessions | Effective harnesses for long-running agents, 26 Nov 2025 | The task brief, `77212b5d`, 31 May 2026; starting-context paper, `2ef4a25a`, 1 Oct 2026 |
| Validating a change to the prompt or harness | Demystifying evals, 9 Jan 2026 | Prompt-change A/B harness, `3a1b3a82`, 4 Jun 2026 |
| Silent regressions caused by the system around the model | Postmortem of three issues, 17 Sep 2025 | Drift-defense spec, `00cab69e`, 29 May 2026; "silent failures… outrank feature work", north star v2, `619366bc`, 31 Jul 2026 |
| Many agents changing one codebase | C compiler: git and lock files, 5 Feb 2026 | Per-session clones for parallel dispatch, simple-dispatcher `e75478e`, 20 Jun 2026 |
| A standing role against duplicated code | C compiler: an agent "coalescing any duplicate code", 5 Feb 2026 | Drift-defense spec, `00cab69e`, 29 May 2026; Drift & Coherence periodical, `d4794843`, 10 Jun 2026 |
| A durable orchestrator with disposable sessions | Managed Agents, 8 Apr 2026 | simple-dispatcher's Stop-hook substrate, `3cb9a47`, 4 Jun 2026; persistent-mind essay, `d63e7ec3`, 4 Oct 2026 |
| The code's shape measured as a series over time | none in the 25 posts | Drift & Coherence trend reports, from `d4794843`, 10 Jun 2026; coherence-as-it-grows, `9261a894`, 8 Oct 2026; Seams & Tangles, `6597d6e0`, 13 Oct 2026 |
| Source control rebuilt for the rate of change | Redesigning source control, 13 Oct 2026 | none |

Read plainly, the table says three things:

1. **Anthropic published first on every practice both records share.** Harbour's first artefact
   came between two and thirteen months later.
2. **Each side has one row the other lacks.** Anthropic rebuilt its source control for a twelvefold
   rise in daily merges. Harbour measures the shape of its code over time.
3. **The comparison is uneven in Harbour's favour,** for two reasons:
   - Publication follows practice, so Anthropic's practices are older than their posts. Harbour's
     commit dates are close to when each practice began.
   - The table shows dates, not influence. Harbour reads these posts: its *persistent-mind* essay
     cites the auto-mode post. In places it plainly took another route; its approval design is
     built on EEMUA 191, the process industry's guide to alarm management.

**The budgets differ by orders of magnitude.** Harbour runs on a single £180-a-month subscription,
according to its August capacity review. Anthropic's C compiler took "nearly 2,000 Claude Code
sessions and $20,000 in API costs". One application build in the harness-design post cost $124.70
on the simplified harness and $200 on the full one. The source-control post says Anthropic's
"ability to spend tokens for internal use far exceeds what any other business would realistically
want to spend". The rest of this essay does not lean on the gap, beyond what it implies for who
can afford judgement.

## 2 What each counts

Sort the headline numbers each record publishes by what they measure, and the difference is
concrete.

| What is measured | Anthropic's published numbers | Harbour's measures |
|---|---|---|
| Flow: how much changes, how fast | Merges per day, "around 2,500" in May to "over 30,000" in September (source control); p50 time to first token down "roughly 60%" (Managed Agents) | Correct, complete changes per week; dispatch funnel and queue latency on `/kpis` |
| Correctness of each result | Pass rates on compiler test suites; eval scores; evaluator scores against criteria | Verified work: CI green, merged, review ledger discharged (north star); escaped defects per 100 PRs |
| Safety: how far a mistake reaches | 0.4% false positives and "17% false-negative rate on real overeager actions" (auto mode); 84% fewer permission prompts (sandboxing) | False-escalation rate; secret scans; "silent failures and detection gaps outrank feature work" |
| Cost | $20,000 per compiler; $124.70 to $200 per app build; tokens per task | Cost per verified task, the north star's headline (currently unreadable: the price table lacks rows for the models now doing the work) |
| Convergence: the shape changes leave | none published | Places per decision; two-way tangles between areas; follow-on tasks per verified task |

Anthropic publishes numbers in four of the five rows. Harbour has measures in all five, but its
convergence measures live in periodicals and papers rather than among the north star's headline
readings, and its cost headline is currently dark. Neither record is complete.

## 3 Where convergence lives at Anthropic

Convergence is not missing from Anthropic's practice. It sits in four places, none of them a
series.

**Judgement.** The source-control post says that "Very often, we found that the role of the
engineers was to tell Claude “no.”" Skilled engineers had to "steer Claude away from
over-engineering parts of the system in response to hypothetical concerns". Seven people built
the system and migrated the monorepo onto it in five months.

**Standing agent roles.** In the C compiler, "LLM-written code frequently re-implements existing
functionality, so I tasked one agent with coalescing any duplicate code it found." A second agent
was asked to improve the project's structure. The post reports no figure for what either
achieved.

**Gates on each change:**

- The long-running harness asks every session to leave "the kind of code that would be
  appropriate for merging to a main branch".
- The evals post describes Claude Code's evals growing to cover "more complex behaviors like
  over-engineering".
- The best-practices guide scopes a reviewer to correctness on purpose: "Report gaps, not style
  preferences."

**The harness.** This is where Anthropic converges most visibly:

- Managed Agents found that context resets "had become dead weight" as models improved.
- The harness-design post ends by "stripping away pieces that are no longer load-bearing to
  performance".

What is pruned here is the system around the model, and it is pruned deliberately and after
measurement.

## 4 Each keeps lean what it measures

Put the two records side by side and they mirror each other.

**Anthropic.** Anthropic measures its harness and keeps it lean. The code that flows through the
harness is measured by its rate and its correctness, and its volume is the quantity allowed to
grow. "Every bottleneck we remove immediately leads to a further increase in the amount of code
we produce." When an evaluator pushed on quality round after round, "Implementation complexity
also tended to increase across rounds."

**Harbour.** Harbour measures its code's shape:

- Across 1,941 commits, its areas tied 24 two-way tangles and untied 5.
- No tangle came undone between January and October.
- When they did come undone, it was because something was taken away: a feature, a function or
  an import direction [T].

Harbour does not measure its own process the same way, and that is what grows. Its steady-base
paper opens: "It only grows, and fastest at the gates." Its growth atlas: "Process weight is
outrunning delivered product."

Neither pattern is a failing. Each organisation converges the thing it treats as its product.
Anthropic ships agents and the harness around them, and the code its engineers write with them is
a means. Harbour's product is the code its fleet maintains, and its process is the means. In both
records, the part left unmeasured is the part that grows.

## 5 Why one engineer has to measure what a lab can judge

The source-control post puts the convergence work in engineers telling Claude "no". That
mechanism scales with the number of engineers and the attention each can spare. Harbour has one
engineer. Its north star says so outright: "Operator minutes and sessions are the scarce
resources." A fleet producing work faster than one person can read it cannot keep its code's
shape in that person's judgement.

Gates on each change cannot see the code's shape either, because the damage is spread across
changes:

- Of Harbour's 24 tangles, 23 were tied by a single new import, each in a change that was merged
  on its own merits [T].
- The coherence loop, built to bring each decision to one place, raised cross-area links from 255
  to 310, because the one place it chose was often in another area [S].
- Anthropic's evaluator loop is a smaller version of the same thing: each round answered the
  evaluator, and complexity rose across the rounds.

Scion lets agents fix merge conflicts, which "Claude can typically fix … faster than humans can
even identify them." But a decision copied into a second file never conflicts with the first.
That is *The Second Copy*'s finding, not the post's, and it is why a merge queue cannot be where
convergence is checked.

A series is the cheap substitute for judgement Harbour cannot afford. The script behind its
tangle history, `scripts/code-shape/seams.mjs`, is 179 lines, and replaying it over every commit
on `main` gave the history above [T]. What a series cannot do is choose the fix. That still takes
a person.

## 6 What cuts the other way

**Deletion can break things.** Anthropic's September 2025 postmortem traces one of three issues to
removing an old workaround: "The December workaround had been inadvertently masking this
problem." Harbour's record says every tangle that came undone came undone through deletion, but
deletion is not free. A convergence loop needs the same evidence before it deletes as a feature
needs before it ships. Harbour's own plan rebuilds each block only against a written conformance
suite [T].

**Changes pass every gate and still do harm, in both records.** In Anthropic's April postmortem,
one change "made it past multiple human and automated code reviews, as well as unit tests,
end-to-end tests, automated verification, and dogfooding." The same post reverses a default that
had traded quality for speed: "This was the wrong tradeoff." In Harbour, dispatches per correct
change rose from 7.6 to 20.0 across 12 July, mostly through follow-ups that two changes to its own
harness created (LIN-1219, LIN-1357). The rise was found afterwards, by papers reading the
logs, not by the changes' own gates. This is the strongest evidence for
the argument, and it comes from both sides. When the harm is spread across changes, gates on
each change miss it, and only a series catches it.

**Flow matters, and convergence costs flow.** Harbour counts correct changes per week too, and its
coherence loop spent budget that features did not get. A twelvefold rise in merges is a real
capability, not a vanity number.

**Rebuilding can stand in for converging.** With tokens to spare, a lab can rewrite rather than
tidy. Seven people built a version control system and migrated a monorepo onto it in five months.
Harbour's own direction is the same move at a smaller scale: rebuild one block at a time against
a written spec. Measuring the code's shape does not argue against rebuilding. It is how a team on
a budget picks the block to rebuild next.

## 7 What each could take from the other

**From Anthropic, for Harbour:**

- **A judge tuned separately to be skeptical.** "agents reliably skew positive when grading their
  own work", and "tuning a standalone evaluator to be skeptical turns out to be far more tractable
  than making a generator critical of its own work." Harbour's review legs are separate sessions
  already; the post's point is that tuning the judge, apart from the maker, is the tractable part.
- **Each judge's error rate, stated as plainly as auto mode's 17% false negatives, "the honest
  number".** Harbour already counts false escalations and escaped defects; a miss rate for each
  of its judges (review, close-out, the stage selector) would sit beside them.
- **Pruning the harness as models improve,** removing what is no longer load-bearing. Harbour's
  process is the part that only grows.
- **Soak periods and gradual rollouts for changes to the prompt,** the April postmortem's remedy,
  beside Harbour's A/B validation.

**From Harbour, for anyone scaling flow:**

- **A weekly series of the code's shape beside merges per day:** places per decision, tangles
  between areas, net deletion. It is cheap to compute and replays the whole history.
- **Counting the code a convergence step deletes, not only what it consolidates.** Harbour's
  record says the deletion is the step that finishes the work.

The evals post already names the risk: "One-sided evals create one-sided optimization." A record
that measures flow, correctness and safety but not shape is one-sided in that sense. So is a
record that measures shape but not its own process.

## 8 What this does not show

- **Published is not practised.** Anthropic may measure the shape of its code internally and not
  have written about it. The claim here is about the published record only: 25 posts on one index
  page, read on 15 October 2026.
- **Dates are not influence,** and the table's dates favour Harbour (section 1).
- **The reading was done by subagents.** Three in-session readers summarised the posts against one
  list of themes. Every quotation used here was machine-checked against the downloaded text, but
  the choice of what to quote was theirs and mine.
- **Harbour's convergence measures are new.** Its tangle history and decision counts were computed
  in October, and its cost headline is dark. Whether measuring shape changes outcomes is untested;
  `drawing-the-ship.md` proposes the test.
- **The author is a party to both sides,** as said at the start.

## Annotated reading list

Each source is listed with what it supports here and what it does not. The Anthropic posts are
read as published accounts of practice, not as a full description of it.

- **Building effective agents** (19 Dec 2024). Supports the evaluator-and-optimizer pattern as an
  early published form of a separate judge. It is about agent design patterns in general, not
  about coding fleets.
- **A postmortem of three recent issues** (17 Sep 2025). Supports that removing a workaround
  exposed a masked bug, so deletion needs evidence. It concerns serving infrastructure, not an
  application codebase.
- **Effective context engineering for AI agents** (29 Sep 2025). Supports context treated as a
  budget. It has no content on codebase health.
- **Making Claude Code more secure and autonomous with sandboxing** (20 Oct 2025). Supports
  approval fatigue, 84% fewer prompts, and credentials kept outside the sandbox.
- **Effective harnesses for long-running agents** (26 Nov 2025). Supports artefacts that hand work
  across sessions, and a merge-ready "clean state" after each one. "Clean" there means ready to
  merge, not structurally simpler.
- **Demystifying evals for AI agents** (9 Jan 2026). Supports over-engineering evals, code-quality
  rubrics, and "one-sided evals". All of its grading is per output, not a trend.
- **Building a C compiler with a team of parallel Claudes** (5 Feb 2026). Supports the
  deduplication and structure agents, $20,000 over about 2,000 sessions, and frequent regressions.
  It reports no figures for what the deduplication agent achieved.
- **Harness design for long-running application development** (24 Mar 2026). Supports the
  separately tuned skeptical evaluator, the costs per build, complexity rising across rounds, and
  pruning the harness. Code quality is one of its criteria, but no result for it is reported.
- **How we built Claude Code auto mode** (25 Mar 2026). Supports 93% of prompts approved, and the
  0.4% false-positive and 17% false-negative rates. In-project code edits are outside its scope.
- **Scaling Managed Agents** (8 Apr 2026). Supports the durable session apart from disposable
  sandboxes, resets as "dead weight", and the latency figures. Says nothing about the code agents
  write.
- **An update on recent Claude Code quality reports** (23 Apr 2026). Supports harness changes that
  passed every gate, and a reversed speed-for-quality trade.
- **How we contain Claude across products** (25 May 2026). Supports approval attention falling as
  approvals rise, and the agent loop running outside the VM. It is about safety, not codebase
  shape.
- **Redesigning source control at Anthropic** (13 Oct 2026). Supports merges rising from about
  2,500 to over 30,000 a day, seven people and five months, engineers telling Claude "no", and the
  token-spend line. It measures no code quality over time.
- **Best practices for Claude Code** (Claude Code Docs, undated). Supports review scoped to
  correctness. As a living docs page, it may change after 15 October 2026.
- **[T]** `docs/papers/harbour/theseus.md@06e90ff5` and its data. Supports the 24 tangles tied and
  5 untied, 23 of them from a single import, untying only by taking something away, and the
  rebuild against a conformance suite. `scripts/code-shape/seams.mjs@38fc3b5c` is the 179-line
  script it replays.
- **[S]** `docs/reviews/seams-tangles-review-2026-10-13.md@38fc3b5c:35`. Supports the coherence
  loop's 255 to 310, which it attributes to the LIN-3549 prototype.
- **Harbour's own documents:** the north star (`:11`), steady-base (`:15`), the growth atlas
  (`:22`), the capacity review (`:6`), escalation philosophy (`:8`), *persistent-mind* (`:15`) and
  *what doubled the dispatches* (its opening answer: 7.6 to 20.0 across 12 July), all `@38fc3b5c`;
  and *The Second Copy*. Each supports the line quoted from it; none is independently checked.
- **The table's Harbour commits** are listed in it by short hash. Each was checked with `git log`
  for date and subject on 15 October 2026. The simple-dispatcher commits are on that repository's
  `main`.

## Next

- **Measure the process the way the code is measured.** Harbour's process is the part of it that
  grows unmeasured. Give it a weekly series and a pruning loop, and test whether it stops growing.
  That is a line in `proposals.md`.
- **Publish shape beside flow.** Put a weekly series of places per decision and two-way tangles on
  `/kpis`, beside the flow measures already there.
