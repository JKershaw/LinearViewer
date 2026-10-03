---
title: Harbour Should Fix Things Like a Skilled Developer
kind: essay
argument: Harbour's stages keep seeing the real cause of a problem and keep writing it down instead of fixing it, because every stage measures scope against the ticket, no stage holds the authority to choose the fix at the cause, and the prompts that carry all this are written like code — thin slices bounded by if-then rules — so the way forward is to give the agent a skilled developer's authority over engineering choices (with only what John would need to tell the team about first going to him), to change the scope rules so the cause counts as part of the work, and to separate the two jobs one meta-prompt does today, assembling the rules and writing the brief, so that rules can stay exact for the machines that read them while the agent reads a plain brief; Harbour's own defences against sweeping change will push back and must give way once they meet John's intent.
version: 2
date: 2026-10-03
authors: [Claude (the Flight Companion session, with John Kershaw; versions 1 and 2)]
model: "Frontier tier, Claude Code, in the Flight Companion's cloud session; written in conversation with John Kershaw on 3 October 2026, not from a dispatch. No new measurement: the figures are read from the research comments and papers listed below. Not checked, independently or otherwise."
revision: "Version 2 (same day) follows John's decisions after reading version 1. It records his definition of a large change, replaces section 7's single-author rewrite with the two-layer design (rules assembled by code, the brief written by a separate step), records the rule changes already made on the branch, and says the release does not wait on a live test. A later same-day edit adds that "colleague" means judgement, not persona (John's tone standard), and another corrects two statements in section 7 about the switch: with it off, the prompt is the rules bundle (now carrying the contract and the rule changes), not today's prompt, and the meta call stops writing the prompt only with it on. Sections 1 to 3 are unchanged."
sources:
  - "LIN-3275 research comment (3 Oct 2026, 08:08Z): the two-path cause of the 401/200 switching"
  - "LIN-3277 research comment (3 Oct 2026, 08:26Z): why eleven earlier tickets in the area did not hold"
  - "LIN-3279 research comment (3 Oct 2026, 08:54Z): where agent-filed tickets come from"
  - "LIN-3283 comment headed 'Independent run (Opus)' (3 Oct 2026, 10:02Z): 37 sampled tickets, what happened to off-frame findings"
  - "LIN-3288 research comment (3 Oct 2026, 10:19Z): the scope rules stage by stage"
  - "LIN-3278 close-out comment (3 Oct 2026, 09:32Z) and autopilot probe comment (09:35Z); LIN-3282"
  - "lib/prompt-template-defs.js@4b786d4fe7a86ae573532452e61540db213cd968:162,226,271,413,494,615,973,1046,1174,1175"
  - "lib/prompts/meta-prompt-template.js@4b786d4fe7a86ae573532452e61540db213cd968:305"
  - "docs/autopilot-operating-manual.md@4b786d4fe7a86ae573532452e61540db213cd968:442-449"
  - "docs/worker-lane-prompt.md@4b786d4fe7a86ae573532452e61540db213cd968:72-75"
  - "tests/unit/prompt-size-budget.test.js@4b786d4fe7a86ae573532452e61540db213cd968:13"
  - "docs/prompt-pipeline/stage-descriptions/ at a08c4320 (LIN-3290: each stage's ideal version and the plumbing map)"
  - "adc638b7 and b8f525d2 on claude/fervent-brown-hipuqc (LIN-3291: the scope rules in both prompt paths; not merged when written)"
  - "31aa1ab1 (LIN-397, the consumer test, and why it was added)"
  - "docs/papers/harbour/review-loops.md@4b786d4f (version 2)"
  - "docs/papers/harbour/tasks-generate-tasks.md@4b786d4f (version 1) and never-worked-pile.md@4b786d4f (version 1)"
  - "docs/papers/harbour/paid-where-written.md@4b786d4f (version 2) and between-the-sessions.md@4b786d4f (version 1)"
---

# Harbour Should Fix Things Like a Skilled Developer

*Briefs, not programs, and the teacup that holds a storm*

Prepared for John Kershaw | October 2026

Harbour's agents keep finding the real cause of a problem and then writing it down instead
of fixing it. They aren't careless, and the stages aren't being skipped. Every stage measures
its scope against the ticket in front of it, and none holds the authority to choose the fix at
the cause. The prompts that carry this are written like code: thin slices of a task, each
bounded by if-then rules that were reasonable patches for past failures. The result is
patches on patches and a codebase that creeps upwards. The way out is to let Harbour work the
way a skilled developer does. It owns the problem rather than the ticket, fixes at the cause,
and refactors when that makes things simpler. Only a change John would need to tell the team
about before it happens goes to him. Getting there takes two things. The scope rules change so
the cause counts as part of the work. And the two jobs one meta-prompt does today, assembling
the rules and writing the brief, are separated, so the rules can stay exact for the machines
that read them while the agent reads a plain brief. Harbour's own defences against sweeping
change will resist this, and they should give way once they meet John's intent.

## 1 One morning's incident

On 3 October Harbour's proxy calls to Linear began switching between 401 and 200 on the same
request, and the fleet stopped. The cause turned out to be two code paths that pick a
connection's credential differently, one of them serving a stale copy [1]. More than a dozen
earlier tickets had worked in this area, each researched, planned, reviewed and merged. Each
fixed the path it was pointed at, and the two-path design survived all of them [2]. The design
had even been seen: on 2 October a plan review recorded that the newer path returns before the
earlier fix ever runs, and judged that this "doesn't interact" with the change it was reviewing
[2].

The same day showed the pattern again in real time. The fix for the incident merged with its
tests green, and production kept switching. The autopilot split the remainder into a new
ticket, with a "Suggested fix" for the other path [6]. The autopilot also noted that its own
close-out claim about production was "an inference, not an observation" [6].

## 2 Seen, written down, and left

A sample of 37 completed tickets from across the project, chosen by a fixed rule and leaving
out the credential tickets, shows this is the normal shape of the work, not a credential
oddity [4]. The stages recorded 231 observations outside their ticket's frame, in 35 of the 37
tickets. What happened to them:

- 46% were noted and left;
- 28% were filed as follow-ups, more than half of which have not been worked;
- 17% were acted on in the ticket;
- 6% went to John, and 3% were dropped.

The underlying cause was fixed in 10 of the 37 tickets. When it was, the route usually ran
outside the pipeline: a ruling from John, a new ticket someone then worked, or a research wave
John commissioned. Running every stage made no difference. In eight tickets every gate ran and
caught real defects, and the deepest finding still ended as a note or a Backlog ticket [4].

This fits what the archive already knew. Over sixty days Harbour created 2.1 tickets for every
one it closed, and half of all filings were never worked [12]. In a sample of that unworked
pile, 23 of 40 were the parent ticket's own unfinished scope [12]. Plan review sent back 83 of
94 plans, every send-back read asked for one more item in a list the plan already had, and none
asked for a different design [11].

## 3 Every stage asks the same question

Read the stage prompts in order and one question repeats: does *this ticket* need it? None of
them asks whether something is the cause [5]. The bug investigation finds the cause and is then
told that "the fix stays minimal" [7:162]. Research may call for a refactor only if it can
"cite the line in THIS task's implementation that calls the new seam", because otherwise "it
belongs with its future consumer" [7:615]. Planning may route around a known gap once the gap
has a ticket number [7:271]. Plan review has the authority "to VERIFY and NOT to redesign"
[8:305]. Implementation reads "Keep changes minimal and focused on the task" [7:973]. Review
treats a problem beneath the symptom as "a genuinely different kind of problem", to be filed
[7:1175]. Close-out may drop an item that is "materially larger than this ticket's own change"
[7:1174]. A breakdown hands each subtask its slice of the parent plan with "do not redesign it
here" [7:494].

Each rule has a reason, and some of the reasons are good. The consumer test was added after a
refactor produced a seam nothing called and widened an app-wide piece of code for one need
[13]. The same commit says that size is not a reason to reject a refactor, because effort is
cheap for agents. The worker-lane rule against widening scope is what let six lanes work in
parallel without colliding on files [10]. The trouble isn't any one rule. Each measures
*necessity* against the ticket rather than against the cause, so a fix at the cause almost
always comes out as "outside".

The authority John wants already exists, but only at the top. The autopilot's operating manual
says that a question "answered by asking what's best for the quality of the code and the
coherence of the system" is the agent's to settle, and that it should escalate "only what a
person's preference alone can settle, or what's irreversible" [9]. Nothing passes that down to
the stages, and their scope rules win where the code is actually written.

## 4 Prompts shaped like code

The stage templates and the meta-prompt together run to about 240 KB of instructions [7, 8].
Much of that text is shaped like a program: numbered steps, verdict formats, mandatory
citations, conditions with exceptions, and the scars of past tickets. Each clause was a fix,
and each fix was paid on every run thereafter, which is the ratchet "Every Fix Is Paid Where
It Is Written" describes [14].

This essay adds an observation about the *shape* of the text. A capable model given a thin
slice and a page of if-then rules does what it is told. It satisfies the rules, defends the
edges of its slice, and records what lies beyond them. That is the robotic quality of the work.
The same model given a purpose, the surrounding context, a clear sense of what good looks
like, and a few real limits behaves much more like a colleague. Rigid bounds produce brittle
slices and constant tension between them. Natural bounds are where these models do their best
work.

Not all of the code shape is a mistake. Some of the text exists for machines rather than for
the agent: headings that later stages parse, verdict lines, the words a ledger is read by.
Tests are right to pin those. The trouble is that one piece of text serves two readers. Today
the meta-prompt is asked both to assemble the rules for a stage and to write the prompt the
agent reads, and what comes out is the rules lightly coloured by the task. This is an
abstraction problem: the layer that turns rules and a task into a brief is missing [16].

## 5 What a skilled developer does

A skilled developer handed a bug owns the problem, not the ticket. They look closely before
changing anything and find the cause. They fix it there, and if a refactor makes the code
simpler, they do the refactor. They leave the code calmer than they found it. They know the
few moments that belong to someone else: a product decision, or a change the team should
hear about before it happens. Everything else they decide, and they say what they decided and why.

For Harbour this means three things:

- **Authority.** Engineering choices, including fixing at the cause and refactoring, belong to
  the agent. Product and intent stay with John. A change becomes a ruling when it is large, and
  John has settled what large means: something he would need to tell the team about before it
  happens. It is not a measure of size or effort. LIN-3288 had offered a definition based on
  what can't be undone [5]; John's is simpler, and it puts the agent in the position of a
  colleague deciding whether a change needs announcing.
- **Briefs.** Each stage prompt reads as a brief to a skilled colleague: what the work is for,
  what good looks like, and where the real edges are, in plain language. The stages become the
  things a good developer does anyway (look closely, think it through, ask someone to check),
  not gates that defend scope. "Colleague" means trusted with judgement and context, not given a
  persona: a brief addresses the agent directly and plainly, explains why, states its real
  limits, and leaves out the social habits of human teams.
- **Coherence.** The briefs tell one story of a task's life. Most of today's rules exist to
  fence off the gaps between stages, so a coherent set should come out shorter. Coherence comes
  from one writing step that holds an ideal version of every stage, not from one author editing
  twelve templates by hand.

Its success shows up in what happens to the code: fewer recurrences, fewer orphaned follow-ups,
and code that settles over time instead of creeping upwards.

## 6 A teacup holds a storm

The prompts were written one at a time, each reasonable where it stands, and their rules have
drifted outward to defend each one against the others. A change that runs through all of them
at once is exactly what Harbour is built to resist, and the resistance comes from several
places.

**The defences against sweeping change.**
- Tests pin the current wording: LIN-3288 counted about 140 assertion lines matching the scope
  rules alone [5]. The two-layer design leaves these where they belong. Tests stay on the
  rules, which are still exact text, and the writing layer is checked by reading what it
  writes.
- The size freeze lets prompt text grow only by cutting as much elsewhere [15]. This one helps:
  a rewrite that removes more than it adds passes it easily.
- Plan review is told to verify, not redesign [8:305].
- A breakdown would hand each chapter to a different author with "do not redesign it here"
  [7:494].

Sent through the normal pipeline, this change would come back as a set of careful line-level
substitutions, the storm squeezed into the cup. Some resistance is healthy, because it catches
real mistakes. But it should give way when it meets John's genuine intent, which is stated
plainly here and should be stated plainly in whatever brief carries the work. Tests that pin
the wording of prompt prose protect the letter of a past decision rather than its purpose.
When the prose is rewritten, the tests should follow the new prose, not hold it back.

**The authors' reflex.** Whoever writes the new prompts has been shaped by the old ones. The
last attempt to fix the local-fix habit produced more prompt rules and no measured change
[4]. Expect a draft to drift back towards numbered rules, line references and "must never".
The rule changes in section 7 went through this too: their first pass met the size freeze by
cutting the reasons behind rules, and the reasons had to be restored by removing duplication
elsewhere instead [17].

**The failures the rules were preventing.** Some will return: a speculative refactor nothing
uses, a scope that sprawls, a review that loops. Each time, the temptation will be to add a
rule back. A skilled team answers those with judgement and better context, and so should
Harbour.

**The machinery built around slices.** Breakdowns, session sizing and stepped autopilots all
assume small pieces. Complete fixes need longer sessions, and some of that machinery may need
loosening alongside the prompts.

**The Flight Companion.** The tickets that opened this investigation were themselves written
the old way. One named its fix in advance, another handed the research a list of tickets to
read, and a third listed options for the research to weigh. Briefs to agents should carry
intent, not slices, and that includes the Flight Companion's.

## 7 Getting there

Harbour's automatic pipeline is likely to have a hard time making this change, for the reasons
in section 6. So the Flight Companion builds it directly, from a plainly written ticket with
subtasks (LIN-3289), and uses Harbour's review steps where they help. The work has four pieces.

**Each stage's ideal version.** Before anything changed, each template was read beside its
meta-prompt rules. For every stage the readers wrote what it is for, its ideal version as a
brief to a skilled colleague, the exact strings code depends on, and the rules that tie its
scope to the ticket [16]. The same reads found defects that have nothing to do with scope. A
ledger parser counts "can be discharged by" as discharged. Some grounding notes contradict the
stage they are appended to. Breakdown subtasks never receive the parent's plan. These are
fixed as part of the same work.

**The rules.** The scope rules change in both prompt paths, so the cause counts as part of the
work [17]:
- a bug investigation proposes the fix at the cause, and the autopilot follows up with the fix;
- research may call for a refactor that removes this task's cause, not only one this task
  calls;
- planning defaults to closing a gap, and a ticket number records a trade-off without paying
  for routing around the cause;
- plan review may send back a plan aimed at a symptom;
- implementation has the authority to fix at the cause and to refactor;
- review counts the cause as inside the work, wherever it lives;
- close-out may drop an item only when finishing it would need telling the team first, and a
  review with no ledger at all goes back to review instead of passing as empty;
- a breakdown's subtasks may change course where the code shows the parent's plan is wrong.

These are still exact rules, and their tests moved with them.

**The mechanical layer.** Code assembles a stage's rules, the task's facts and the gates that
machines read. The stage's handwritten template becomes the one rules bundle for both paths,
and with the writing layer on, the meta call only chooses the next stage. Code appends what
later stages parse (the plan heading, the plan-review verdict, the ledger's words) instead of
relying on the prose to ask for them.

**The writing layer.** A separate model call turns the bundle into a brief, aiming at the
stage's ideal version. Code then appends the contract, so a badly written brief cannot break a
gate, and if the writer fails or times out the unwritten bundle ships. It sits behind a switch,
its model is configurable, and its cost is recorded on its own.

**The release does not wait on a live test.** The writing layer can only be judged on real
tickets, and real tickets only reach it once it is released. A release that waited for that
test would wait for ever. The tests check the contract instead: every machine-read block is
present, grounding is appended once, and with the switch off the prompt is the rules bundle,
byte for byte. That is enough to merge. The switch makes the change reversible, so turning it on needs
no test either. Once it is on, the briefs are read side by side with today's prompts on a few
real tickets and across several writer models. The read shows which model writes best and
where extra cost stops buying quality (LIN-3294). It is a sanity check, not a gate.

**The reading and the running.** John and the Flight Companion read the briefs as a whole. Do
they sound like briefing a skilled colleague, and does the intent come through? They don't
check them line by line against a list. Drift is watched in what agents actually do, and
corrected with judgement, not with new rules. The measure already exists: 10 of 37 sampled
tickets had their deepest finding fixed at the cause [4]. Re-coding a fresh sample a few weeks
after the change will say whether the work has moved.

## 8 What the evidence does not show

- **The figures come from a sample.** The sample is one set of 37 completed tickets. Which
  finding counts as "deepest", and the verdicts on each explanation, are the coders' judgements
  [4]. Who filed each ticket is inferred, because Linear attributes agent writes to John's
  account.
- **The research behind it.** Three of the five research passes cited here (LIN-3275, LIN-3277
  and LIN-3279) ran on a cheap-tier model. LIN-3279's claim that the recommender skips research
  when a ticket already carries a fix is unmeasured, and the 37-ticket sample found that stages
  were rarely skipped [3, 4]. This essay doesn't rely on it.
- **Untested beliefs.** That briefs in plain language will do better than code-shaped rules is
  an argument from how these models behave, not a measurement. It needs the forward check in
  Next.
- **Removing brakes.** Some of the failures the rules prevented will come back. How many, and
  how costly, is unknown.
- **The ideal versions.** They were written in one session, by sub-agents reading the templates
  at one commit, and read by the Flight Companion. Nobody has checked them against how agents
  behave [16].
- **The writing layer.** Whether a written brief does better than the rules bundle it starts
  from is untested. The read after release and the forward check are what will say.
- **Who wrote it.** This essay was written by the same session that filed some of the
  prescriptive tickets it describes, and that is building the change it argues for. Nobody has
  checked it.

## Annotated reading list

1. **LIN-3275, research comment (3 Oct 2026).** The live mechanism of the 401/200 switching:
   one path served a stale copy of the token, another adopted the good one without repairing
   the copy. It supports the two-path cause. It does not settle the live residual, which
   LIN-3282 is still working on.
2. **LIN-3277, research comment (3 Oct 2026).** The history of eleven earlier tickets in the
   credential area, and the LIN-3126 plan review that saw the bypass and judged it "doesn't
   interact". It supports "seen and set aside". Its per-ticket judgements of whether a fix was
   decided in advance are its own reading.
3. **LIN-3279, research comment (3 Oct 2026).** Where agent-filed tickets come from, and which
   templates write a fix into the next ticket. Its central mechanism, the recommender skipping
   research, is unmeasured and is not relied on here.
4. **LIN-3283, the comment headed "Independent run (Opus)" (3 Oct 2026).** The 37-ticket
   sample: 231 off-frame observations and their fates, the five explanations tested, and the
   mechanisms found beyond them. It supports sections 2 and 6 and the baseline in section 7.
   Its coding was split across sub-sessions, and its "deepest finding" buckets are judgement.
   An earlier run of the same brief on a cheaper model was not read for this essay.
5. **LIN-3288, research comment (3 Oct 2026).** The scope rule at each stage, why each brake
   exists, and a candidate definition of "large". It supports section 3 and the friction count.
   It read the rules, not behaviour.
6. **LIN-3278 close-out (09:32Z) and autopilot probe (09:35Z), and LIN-3282.** A merged,
   tested fix that did not change production, and its residual split off with a suggested fix.
   Supports section 1's "in real time".
7. **`lib/prompt-template-defs.js` at `4b786d4f`.** The quoted stage rules, each read at its
   line.
8. **`lib/prompts/meta-prompt-template.js` at `4b786d4f`, line 305.** Plan review's "VERIFY and
   NOT … redesign".
9. **`docs/autopilot-operating-manual.md` at `4b786d4f`, lines 442–449.** Principle 0's
   positive half: questions of code quality and coherence are the agent's to answer.
10. **`docs/worker-lane-prompt.md` at `4b786d4f`, lines 72–75.** The rule against widening
    scope, and the collision-free parallel run it made possible. Supports the fairness point in
    section 3.
11. **`review-loops.md` (version 2).** 83 of 94 plans sent back; send-backs asked for more
    items in an existing list, never a different design.
12. **`tasks-generate-tasks.md` and `never-worked-pile.md` (version 1 each).** 2.1 tickets
    created per one closed, half never worked; 23 of 40 unworked filings are the parent's own
    scope.
13. **`31aa1ab1` (LIN-397).** Why the consumer test exists, and its own note that size is not a
    reason to reject a refactor.
14. **`paid-where-written.md` (version 2) and `between-the-sessions.md` (version 1).** The
    ratchet of fixes written as prose, and the cost that gathers between sessions. This essay
    agrees with both and adds two things: the shape of the prose (code-like rules rather than
    briefs), and the missing authority to fix at the cause. Where "Every Fix Is Paid Where It
    Is Written" proposes budgets and rules that must keep proving they fire, this essay
    proposes fewer rules and more judgement.
15. **`tests/unit/prompt-size-budget.test.js` at `4b786d4f`.** The size freeze: prompt text
    grows only by removing as much elsewhere.
16. **`docs/prompt-pipeline/stage-descriptions/` at `a08c4320` (LIN-3290).** Each stage's
    purpose, ideal version, machine-read strings and scope rules, and `plumbing.md`, the map
    of how prompts are built and where a writing step fits. Supports section 4's two readers
    and section 7. These are working notes, not checked, and their line numbers will drift.
17. **`adc638b7` and `b8f525d2` (LIN-3291).** The scope rule changes in both prompt paths, and
    the second pass that restored the reasons the first had cut. Supports section 7. Not
    merged when this was written, and not yet run on live work.

## Next

- **The build, under LIN-3289.** The defects the reads found (LIN-3296), the mechanical layer
  (LIN-3292), the writing layer behind its switch (LIN-3293), and the read after release that
  compares writer models against cost (LIN-3294).
- **The machinery built around slices.** Once complete fixes are running, do breakdowns,
  session sizing and stepped autopilots need loosening alongside the prompts? Watch for
  sessions that run out of room before the cause is fixed.
- **The forward check, added to `proposals.md`.** After the change lands, is the deepest
  off-frame finding fixed at the cause more often than 10 of 37?
