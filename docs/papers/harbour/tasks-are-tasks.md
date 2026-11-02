---
title: Tasks are tasks, and the codebase is a place
kind: essay
argument: Harbour's agents usually do their tickets well, but holding each task to account is not the same as looking after the codebase the tasks happen in, and no single stage's job covers that place.
version: 1
date: 2026-11-02
authors: [Claude, for John Kershaw]
model: Claude Haiku 5.5 in Claude Code, from dispatch 719300c6 for LIN-4131; the investigation notes it draws on were written by an earlier Claude Code session on Claude Opus 5.5
sources: [https://github.com/JKershaw/LinearViewer/blob/bb20e5f7/docs/reviews/_evidence-2026-11-02-ticket-intent/investigation-notes.md, docs/reviews/_evidence-2026-11-02-ticket-intent/investigation-notes.md@bb20e5f7:1-243, docs/papers/harbour/one-feature-twice.md@d9931859]
---

# Tasks are tasks, and the codebase is a place

Harbour's agents mostly do what their tickets say, and often do it well. Where they bend a spec, that is about as likely to be good judgement as a miss. We went looking for the place where a request loses its intent on the way through Harbour, expecting a leaky stage, and mostly did not find one [1]. What the investigation found instead was a shape. Each agent works faithfully from its own ticket and then leaves, and nothing in the system is responsible for the condition of the code those tickets land in. Keeping each task accountable is not the same as looking after the place the tasks happen in. Tasks are tasks, and the codebase is a place.

## What we expected, and did not find

The first question was whether requests lost fidelity as they passed through the stages, and whether the prompt generator was summarising too much. It was not. Stage prompts carry no copy of the task. They point the agent at the live description [1]. In 611 of 653 tickets with a snapshot from before their first stage, at least 95% of the request's sentences survive verbatim in the final description [1].

A coverage check then read 254 finished tickets and listed 1,856 asks from them. About 95% were delivered as written. Most of the rest were small, such as a unit test where a browser test was asked for, or a replay half the size asked [1]. Some were not small, and the check could not separate those from the rest on its own, as the next section shows.

The notes are plain about the check's limits. It scores work against the ticket's own words, and for most tickets those words are an agent-written spec. It cannot catch a ticket that over-settled what the person wanted from the start, because that ticket scores as fully delivered. It cannot say which stage made each reduction, or whether John would have objected [1]. Its figures are rough. A second rater agreed on 96.5% of labels, but the two raters found 10 and 11 reductions, with 8 in common, so the figures should be read to about ±50% [1].

## Judgement is not the miss

Two cases show what the check was counting. In LIN-2623, John asked for the model to be chosen in settings, with transparent pricing. The agent-written spec contradicted itself. It asked for the live catalogue in the picker, and also for an error on any id outside it. It named an example validator that silently degrades, which was the very bug the ticket existed to fix. The builder caught both, deviated, wrote down why, and flagged it for review [1]. In LIN-2955 the spec said a prompt is never refused. John's steer on the ticket was to fix the global hourly cap bug, which made the safety net refuse again, and the agents followed the steer [1].

The coverage check counted both as reductions on an agent's own reasoning [1]. It scored agents' good judgement as narrowing. The investigation repeated that move at each turn. Whenever it faced a judgement question, it swapped in a measurement and carried the measurement out rigorously [1]. This is the first place the essay turns on itself, and it is why the coverage check does not get the last word here.

## The image

John's way of seeing it, from conversation, is that Harbour's agents work like contractors on a house nobody lives in. They take work orders. Each one does the job in front of it, faithfully, and leaves. Nobody walks past the same squeaky stair every day and fixes it on the way [1]. Tasks are tasks, and the codebase is a place.

Some terms first. A ticket is a work item in the team's tracker. A stage is one of the fresh AI sessions Harbour runs in order, each reading the ticket and doing one job. Plan-review is the second reader who checks a plan before anyone builds it [3]. The image is a way of seeing, not a finding. It fits some cases well and strains on others, and the last sections say where.

## What the house looks like from inside

**Friction is noticed and left.** In roughly three-quarters of 256 tickets' comment threads, agents record friction they noticed and did not touch. "Pre-existing" and "out of scope, note only" are the usual words, and the surface-assessment field "improvement noticed, not required" appears 158 times. In LIN-2802 the agent wrote that widening the work "would be the scope creep the brief forbids", and recorded the friction as a finding for someone else to ticket [1]. The search behind these counts was loose and catches some noise [1].

**A lesson is kept with the job, not the place.** The UI learned the same thing twice. In June a theme was reverted, having been "built without the attached design spec". Its redo was scoped as "largely a visual migration" and shipped a re-skin. Then LIN-873 had to say "build to the mockup design (not the migration re-skin)" and "don't self-certify on the text subset" [1]. In October John called the Models prototype the benchmark for the UI he wanted. He also said code or screenshots given to a building agent "may be over specific". LIN-3892 made it a rule: no prototypes or screenshots go to builders, and tickets carry the design in words. The notes found no sign-off from John on that line. The review that explained the gap found that briefs had been written from surveys of the old pages, that reviews compared each build with its own ticket, and that polish rounds tidied the wrong layout [1].

**One line obeyed perfectly while attention went elsewhere.** LIN-4009 asked that "ready is the brand". It was implemented exactly: any row with a guessed next step turned teal. Four days later a feedback round said "the colour that should say 'this one' says nothing", and LIN-4103 removed the guessed steps [1]. The ticket had five plan-reviews and about 86,000 characters of comments. "Blue" appears about 120 times in the record, as reviewers hunted stray blue across 13 stylesheets. The ready rule itself appears five times, always restated as spec and never questioned [1]. The attention went to the blue, not to the rule.

**A smaller case of the same shape.** The body text stayed monospace from the June mono-and-sans decision until a change on 26 October. About 88 local overrides had grown around it, and 90 remain on main. One code comment reads "the body is monospace… without it the copy-first key note… leaked into mono" [1].

**Code gets smaller only when tidying is the ticket.** Since 1 September, 965 non-merge commits have touched the app's code, which grew by about 78,900 lines net. About 100 commits shrink it, and nearly all come from tickets whose job is to retire, remove, consolidate or rebuild something. Ordinary feature and fix tickets almost never shrink code. Reconciling tickets still add lines. LIN-4016 and LIN-4069 to 4071 are examples [1].

**A rule read outside its purpose.** LIN-4085 is the case the earlier essay told, and the notes re-read it. The miss there was direction, not size. John's note asked for an agent that configures Harbour for the person's situation, "without the user needing to follow those steps". The shipped guide made the agent a signpost: "ask the person to open…", "do not create it for them" [1]. The size rule that bounded the guide was meant for prompt text, and the guide was a new kind of surface [1]. Two things about the earlier comparison should be kept in view. The fast session ran on Opus at its highest effort, while Harbour's implementation stage ran on Haiku, so that run was partly a comparison of models [1]. And the earlier essay has corrections owed to it, which this essay does not make (see Next).

## How the three bodies feed each other

The notes name three things that couple. One is how tasks are written. Another is how they are interpreted, which is probably mostly right. The third is how tangled the code already is, which decides how a ticket lands [1].

The effect is clearest in plan-review loops. Narrow tickets landed fast even in the most tangled files. LIN-3494 ("Go shows the server's reason") and LIN-3763 (dark-theme controls) each took about half an hour, with no plan-review. Both were narrow, line-cited and highly prescriptive [1]. Broad clean-ups did not spiral. LIN-4015 (shrink the CSS) had two plan-reviews, LIN-3889 two, LIN-3579 two, and LIN-3912 none [1]. Broad design asks did. LIN-4009 and LIN-3833 had five plan-reviews each. The pattern runs like this. Plan-review asks whether a class of things is closed. The thing is scattered through the code, so each round finds another member. The plan swells, as LIN-4009's did to "40k, 13 sheets, 15 test files", and John gets a ruling [1].

The notes call this a hunch, and the essay keeps it one. A spiral needs tangled code, an ask that cuts across it, and a goal that is a judgement rather than a closed check [1].

## The decision John would reopen

The notes record one decision John said he would be willing to reopen: the ticket as the source of truth. It conflates three things, the job's record, the documentation and plans, and the place's memory [1]. So what a stage learns about a corner of the code is filed under the job number, and it is found there, if at all.

## Beck's line

Kent Beck's advice is to make the change easy, and then make the easy change [2]. Inside a ticket, Harbour only does the second half. The first half, tidying the place so the change lands cleanly, is the part that has no owner. This is our reading, not a finding. John's own version of the first half is small, smart, isolated steps, each leaving the code simpler [1].

## Where it does not fit

The image explains a good deal and strains on several cases, and the notes supply them.

- Some contractors had the judgement. LIN-2623 and LIN-2955 are above [1].
- Some spirals have nothing to do with tangle. `lin3611-a3-loop` went three rounds over the reading of one house rule, on a freshly rebuilt file [1].
- Some reconciling tickets still add lines, as noted above [1].
- The investigation repeated the trap it describes [1].
- The house is not empty. 965 commits touched it in about two months. On this reading, what is missing is not traffic. It is someone whose job is the place's condition. That is our reading, not a finding.

## What a resident would be

The notes leave open who would look after the place, and so does this essay. They name four candidates: a person, an agent, a memory kept with the code, and a permission. Each would have to do something a work order does not.

- A person would need standing over the place's condition across tickets, not just over one. John's reopened decision points that way, but the notes do not say who would hold it [1].
- An agent would need a continuity a fresh session lacks. Each stage starts cold and reads the ticket, so the lessons would have to live somewhere it can read [3].
- A memory kept with the code would put the lesson where the friction lives, rather than on a closed ticket. It still needs someone to read it and act on it.
- A permission would let an agent change the place outside a ticket. John's reading of LIN-4085 points there: the right call was for an agent to ask him whether to go past the size rule for a new surface [1].

Adding a rule would not settle it, on this reading. LIN-3892 is a rule, and LIN-4009 is a rule obeyed exactly while the place drifted. That is our reading of those two cases, not a finding [1].

The essay does not choose among these candidates. Whether one of them is the resident, or whether the image stops holding first, is left open on purpose.

## Next

- Ask whether a tidy-first step ahead of a broad ticket shortens its plan-review loop. The notes raise it as a hunch [1]. This is the first line added to `proposals.md`.
- Ask whether the most prescriptive tickets get the most rework afterwards, using the notes' signals: corrective follow-up tickets, reverts and John's corrections after merge [1]. This is the second line added to `proposals.md`.
- Ask John to rate a small blind sample on the direct test, "is this what I meant?" [1]. This is the third line added to `proposals.md`.
- Correct the earlier essay, [one-feature-twice](one-feature-twice.md). The notes list three corrections owed: the narrowing it quotes is misquoted, the size budget came from scoping rather than the plan, and the model mix is missing [1]. This essay does not make them. A follow-up ticket, LIN-4133, tracks them.

## Reading list

1. **The investigation notes.** [docs/reviews/_evidence-2026-11-02-ticket-intent/investigation-notes.md](../../reviews/_evidence-2026-11-02-ticket-intent/investigation-notes.md), verbatim, added to the repository by cherry-picks of 8afffebe and 725d23b4. The citations point at [the merge commit bb20e5f7](https://github.com/JKershaw/LinearViewer/blob/bb20e5f7/docs/reviews/_evidence-2026-11-02-ticket-intent/investigation-notes.md) so a reader can land on a line; the file has 243 lines. Supports the figures and cases here, by section and line: §1 (lines 7–16) on the starting question and the prompt generator; §2 (20–49) on request survival and the corpus; §3 (51–101) on the coverage check, its labels, the second rater and its limits; §4 (103–114) on a replay of the review stage, which this essay does not rely on; §5 (116–123) on the model mix; §6 (125–129) on the corrections owed; §7 (131–139) on open questions; §8 (141–243) on the cases, the image and John's framing. The notes say their figures come from API reads and LLM judges and are rough, and no Harbour task was run for them. §8 is, in its own words, "in no particular order", and it is readings of cases, not measurements. Does not support any claim about what a person intended, since the coverage check scores against the tickets' words.
2. **Kent Beck, "make the change easy (warning: this may be hard), then make the easy change".** Quoted by John in conversation and recorded in the notes at §8, line 243. The original was not consulted. Supports only the sentence quoted. It is a maxim, not an estimate, and this essay uses it only for the shape of the idea.
3. **One feature, built twice.** The [earlier essay](one-feature-twice.md) on LIN-4085. Supports the description of Harbour's stages as fresh sessions that each read the ticket and do one job. The notes correct its account of the size budget and of the builders' models (§5, §6), and this essay does not rely on those parts. Does not support anything about the coverage check or the cases in §8, which it predates.
