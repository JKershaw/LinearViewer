---
title: Harbour Should Fix Things Like a Skilled Developer
kind: essay
argument: Harbour's stages keep seeing the real cause of a problem and keep writing it down instead of fixing it, because every stage measures scope against the ticket, no stage holds the authority to choose the fix at the cause, and the prompts that carry all this are written like code — thin slices bounded by if-then rules — so the way forward is to give the agent a skilled developer's authority over engineering choices (with only the large or irreversible going to John) and to rewrite the stage prompts together, as one coherent set of briefs, knowing that Harbour's own defences against sweeping change will push back and must give way once they meet John's intent.
version: 1
date: 2026-10-03
authors: [Claude (the Flight Companion session, with John Kershaw)]
model: "Frontier tier, Claude Code, in the Flight Companion's cloud session; written in conversation with John Kershaw on 3 October 2026, not from a dispatch. No new measurement: the figures are read from the research comments and papers listed below. Not checked, independently or otherwise."
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
and refactors when that makes things simpler, and only what is genuinely large or
irreversible goes to John. Getting there means rewriting the stage prompts together, as
chapters of one book, not editing them one line at a time. Harbour's own defences against
sweeping change will resist that, and they should give way once they meet John's intent.

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

## 5 What a skilled developer does

A skilled developer handed a bug owns the problem, not the ticket. They look closely before
changing anything and find the cause. They fix it there, and if a refactor makes the code
simpler, they do the refactor. They leave the code calmer than they found it. They know the
few moments that belong to someone else: a product decision, or a change too large or too hard
to undo to make alone. Everything else they decide, and they say what they decided and why.

For Harbour this means three things:

- **Authority.** Engineering choices, including fixing at the cause and refactoring, belong to
  the agent. Product and intent stay with John. A refactor the agent judges to be large becomes
  a real ruling. LIN-3288 offers a definition of "large" based on what can't be undone rather
  than on size: a change to product behaviour, a published contract, stored data or another
  repo's interface [5]. That definition is John's to settle.
- **Briefs.** Each stage prompt reads as a brief to a skilled colleague: what the work is for,
  what good looks like, and where the real edges are, in plain language. The stages become the
  things a good developer does anyway (look closely, think it through, ask someone to check),
  not gates that defend scope.
- **Coherence.** The prompts are rewritten as one story of a task's life. Most of today's rules
  exist to fence off the gaps between stages, so a coherent set should come out shorter.

Its success shows up in what happens to the code: fewer recurrences, fewer orphaned follow-ups,
and code that settles over time instead of creeping upwards.

## 6 A teacup holds a storm

The prompts were written one at a time, each reasonable where it stands, and their rules have
drifted outward to defend each one against the others. A change that runs through all of them
at once is exactly what Harbour is built to resist, and the resistance comes from several
places.

**The defences against sweeping change.**
- Tests pin the current wording: LIN-3288 counted about 140 assertion lines matching the scope
  rules alone [5].
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
in section 6. That is easy to compensate for. In the worst case the rewrite is done by hand from
a single ticket, which is the right size of process for a change like this.

**The rewrite.** One author holds the whole book. Before changing anything, they read every
stage prompt and the documents around them (the meta-prompt, the operating manual, the
worker-lane brief) from start to finish. The through-line is John's intent: fix at the cause;
scope is the problem, not the ticket; the agent decides engineering; only the large or
irreversible goes to John. Each chapter is then rewritten to carry that line in its own voice.
Where a test pins old wording, the test changes.

**The reading.** John and the Flight Companion read the result as a whole: does it sound like
briefing a skilled colleague, and does the intent come through? They don't check it line by
line against a list.

**The running.** The new prompts run, and drift is watched in what agents actually do and
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
- **Who wrote it.** This essay was written by the same session that filed some of the
  prescriptive tickets it describes, and nobody has checked it.

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

## Next

- **The rewrite itself.** Rewrite the stage prompts and their surrounding documents as one
  coherent set of briefs, by one author, under John's intent in section 5. This could run under
  LIN-3288 or a ticket of its own, by hand if the pipeline resists.
- **John's ruling on "large".** Is LIN-3288's candidate definition right (product behaviour,
  published contract, stored data or another repo's interface, never size)?
- **The forward check, added to `proposals.md`.** After the rewrite, is the deepest off-frame
  finding fixed at the cause more often than 10 of 37?
