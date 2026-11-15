# Plan: where the loop leaks, and why

*Drafted 15 Nov for John to correct, then agree or not. Nothing in it has started. It plans the understanding half of step 1 only. Lines that state a fact carry the marks used on `situation.md`; everything else is proposed. `words §n` is a section of `my-words.md`.*

## 1. The step

- **Step 1 of John's outline:** "We find where then loop is leaking, understand deeply why, and what it needs, then build that specific solution in a simple form." (log:4151) [checked]. This plan covers finding, understanding, and what the loop needs. Building comes after, under a plan of its own.
- **It starts with where information lives.** The leak John confirmed: "when we apply the closing pieces, the notes squirted out as a necessity" (words §7) [checked]. His three questions:
  - a correct home for the notes
  - whether all the information is in its best place
  - "a task feels like it's carrying a lot", which may be "getting ahead of ourselves"
- **Three limits, all from log:4155** [checked]:
  - look before naming: "If we define it in the wrong way, we're back in groundhog day"
  - understand before designing: "first research and understand what's needed"
  - any project: "We have to keep it universal"

## 2. How it is done

Follow the information through real finished tasks, then test the picture on a project that isn't Harbour.

1. **Choose the tasks first.**
   - Four to six of Harbour's own finished tasks that ran the loop as it is now, closing pieces included. That means since about 12 Nov, when outside finds began going to the notes (`beyond-the-code.md:85`) [reported].
   - Chosen to differ: an ordinary task, a tidy, a piece of a lane, and a Periodical. Periodicals write notes, not tickets (`beyond-the-code.md:112`) [reported].
   - The list is written down before any reading starts.
2. **Trace each task as one table.**
   - The table lists every piece of information written or read, from the ask to after close-out. For each piece it records:
     - what it says, in plain words
     - where it was written
     - who wrote it: a person, a stage, code, or the supervising session
     - who read it later, and whether it changed what they did
     - whether it ended, and how
     - whether it copies something held elsewhere
   - It also records anything done by hand outside Harbour.
   - Sources: the ticket's description and thread; the pull request and the files it touched, notes included; Harbour's run records; and the prompt each session was given, where these can be reached.
3. **Name nothing in advance.**
   - The readers are not given the essays or their table of kinds. Kinds are named afterwards, from what the tables show.
   - The existing list of what the loop writes (`working-2026-11-15/readings/4-local-first.md` §B) is used only at the end, as a check that nothing was missed.
4. **Who reads.**
   - I trace the first task myself, so the table is tried on real material before anyone else uses it.
   - Fresh readers trace the rest, one task each, in parallel.
   - One task is traced by two readers working apart, to see whether they agree.
5. **The picture.**
   - One page, built from the tables, saying:
     - where information lives in the loop and how it moves
     - where it piles up, is retold, or has no end
     - why, and what the loop seems to need
   - Only then is it set against the essays' candidate answers (`situation.md` §6), with the weak points listed in §7 below.
6. **The outside test.**
   - Before anyone looks at the outside project, I write down what the picture predicts there: where the closing pieces go, what a task carries, and what is done by hand. The predictions are committed first.
   - A reader who has not seen the picture traces one or two of that project's finished tasks in the same way.
   - Each prediction is then marked held or broke.
7. **John corrects the picture.**

## 3. Where the pet projects come in

- **In this step: one project, as the outside test.** In this sitting John offered "a slightly unconventional project which currently uses Harbour" (words §8) [checked]. That is his placement "Happy to provide good test projects" (log:4155) [checked].
  - Its own finished tasks are traced, so it needs no new runs unless none of them fits.
  - Its traces stay out of this repository unless John says otherwise.
- **The other two placements are untouched by this plan**, and they stay his to make: after the engine stops leaking (log:4151), and in the meantime (words §7) [checked].

## 4. What it costs

- **Money.**
  - About eight readings: up to six Harbour tasks, one or two outside, and one second reading. They run as sub-agents of this session, so they use this session's Claude usage, not Harbour's weekly budget.
  - At Opus 5.5 list prices, $4 per million tokens in and $20 out [checked], one reading likely costs $3 to $10 [guess]. The whole step should come in under $100 [guess].
  - No Harbour runs, unless the outside project has no finished task to trace.
  - I report the tokens each reading used at the end.
- **John's time.**
  - A token for Harbour's workspace, saved through this session's secure credential form. It never goes into chat or a file.
  - The project link, and access to its tasks.
  - About half an hour to read and correct the picture [guess].
- **My time.** One sitting for the Harbour traces and the picture, and part of another for the outside test [guess].

## 5. When it stops

- **The Harbour traces stop** when two traces in a row add no new place or kind of information. That is saturation, the classical stopping rule for this kind of looking. If the sixth trace still adds something new, I stop there and say so.
- **The step stops** when the outside predictions have been checked and John has corrected the picture. What it delivers is the picture, with each prediction marked held or broke. It is not a design.
- **If most predictions break,** the picture is shaped by Harbour, not by the loop. That is a finding in itself, and John chooses what follows: a second project, or a rethink.
- **I stop early and ask** if a reading turns up something alarming (I read the code myself before relaying it, log:4193 [reported]), if costs pass $100, or if access fails.

## 6. What this plan does not do

- Build anything, or change Harbour, its prompts or its notes.
- Define a leak in advance, or count leaks (log:4155).
- Run the notes spike. It was agreed on 14 Nov (log:3973-3977) [checked], a day before the outline put understanding first (log:4151). It is held until the picture says whether the notes need a home, and so what a spike should test.
- Rewrite the record (log:4227). Working files go in a dated folder like `working-2026-11-15/`, and the picture cites them.

## 7. Where the essays could be wrong

The picture is tested against these, not built on them.

- **The kinds are the essay's own guess** (`nothing-fights-its-shape.md:127`). They come from notes six days old, on one codebase, sorted by readers from the same model family as the author (`:169`) [checked wording].
- **One home per thing is a tree**, and the essay warns against that itself: "any single home hides it from someone, as the nine safety findings showed" (`:119`) [checked wording].
- **The last answer made this leak.** A home for the place became the area notes, and those are what squirted out: "The fix for having nowhere to write made a new problem." (`:68`) [checked]. So a new home should be judged by what it moves, not only by what it fixes [my reading].
- **Growth is not shown to be harm** (`:168`) [checked]. The clearest harm on record is seven safety findings held only in notes (`beyond-the-code.md:42`) [reported].
- **Some understanding fits on no page** (`:123`). Cutting "retelling" could hurt a fresh session, and nobody has measured whether it does [checked wording].
- **"Between the sessions" is older evidence.** It was written on 1 Oct, and its check was written by the same session (`between-the-sessions.md:7`) [checked].
- **On "a task carries a lot":** over 184 tickets, the size of a ticket's record did not predict passing review (`nothing-fights-its-shape.md:108`) [reported]. A cost from carrying a lot may show in money or in what gets lost, rather than in review.
