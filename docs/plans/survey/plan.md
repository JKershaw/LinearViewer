# Plan: where the loop leaks, and why

*Drafted 15 Nov for John to correct, then agree or not. Nothing has started. It plans the understanding half of step 1. Marks are as on `situation.md`; lines with no mark are proposals. `words §n` is a section of `my-words.md`.*

## The step

- **John's outline begins:** "We find where then loop is leaking, understand deeply why, and what it needs, then build that specific solution in a simple form." (log:4151) [checked]. This plan covers the finding and the understanding. Building comes after, under a plan of its own.
- **It starts with where information lives.** John confirmed the leak: "when we apply the closing pieces, the notes squirted out as a necessity" (words §7) [checked]. He then gave three things at three sizes:
  - "one proposal": a correct home for the notes
  - "a bigger question": "look at all the information, and check it's in the best place"
  - "one smell": "a task feels like it's carrying a lot", which "might be getting ahead of ourselves"
  The trace below takes the bigger question, and the other two sit inside it.
- **His three things for this step** (words §8) [checked]: look before naming; understand before designing, with no assumed implementation; it has to hold for any project.

## How

1. **Trace a few finished tasks on Harbour.**
   - Take four tasks that ran the loop with its closing pieces, so finished since about 12 Nov (`beyond-the-code.md:85`) [reported]. Choose them to differ: an ordinary task, a tidy, a piece of a lane, and a Periodical.
   - For each task, write a plain account of everything written or read, from the ask to after close-out: what it says, where it is, who wrote it, who read it later, and what they did with it. Nothing else is asked.
   - The readers are not given the essays, so nothing is named in advance.
   - Sources: the ticket and its thread, the pull request and the files it touched, Harbour's run records, and the prompts the sessions were given, where these can be reached.
2. **Who reads.** I trace the first task myself, so the way of tracing is tried on real material. Fresh readers trace the other three.
3. **The why.** Wherever information leaks, in whatever form that takes, follow it back to what made it: the prompt line, the code or the decision, and when it came in. The tools are classical ones: the git history, and asking "why" until the answer stops changing.
4. **The picture.** One page, saying:
   - where information lives in the loop and how it moves
   - where it leaks, and why
   - what is still done by hand, or by the driving session
   - what the loop seems to need

   Any kinds of information are named here, from what was found. Then the picture and the essays' candidate answers (`situation.md` §6) are read against each other, both ways. Two cautions about the essays [checked wording]:
   - they come from one codebase, and their kinds are their own guess (`nothing-fights-its-shape.md:127`)
   - the area notes were their last answer, and the area notes are what leaked (`:68`)
5. **The outside test.**
   - Before anyone looks at the outside project, I write a few plain sentences on what the picture expects to find there.
   - A reader who hasn't seen the picture traces one or two of the project's tasks in the same way, and each expectation is marked as held or not.
   - If the project's finished tasks predate the closing pieces, John can choose one fresh small task instead.
6. **John corrects the picture.**

## Pet projects

- **This step uses one:** "a slightly unconventional project which currently uses Harbour", John's choice for this step (words §8) [checked]. Its traces stay out of this repository unless he says otherwise.
- **His other placements stay open, and stay his:**
  - trying projects once the engine doesn't leak (log:4151)
  - the meantime (words §7), including his idea of playing a new user through onboarding while Harbour runs "on a low burn rate" (log:4137) [checked]

## Cost

- **Money, all of it John's.**
  - About six readings, done by sub-agents of this session.
  - At Opus 5.5 list prices, $4 per million tokens in and $20 out [checked], that is about $3 to $10 a reading [guess], and under $100 in all [guess].
  - A fresh task on the outside project, if one is needed, adds one Harbour run. The last median was about $17 (log:3564) [reported].
  - I report what each reading used.
- **John's time.**
  - Saving a token for Harbour's workspace through the session's secure form. It never goes into chat or a file.
  - The project link, and access to its tasks.
  - Any stop-and-ask question along the way.
  - About half an hour reading the picture [guess].
- **How long it takes.** One sitting for the Harbour traces and the picture, and part of another for the outside test [guess]. It can start as soon as John agrees the plan; whether that's this sitting or the next is his call.

## When it stops

- **After four Harbour traces, I look.** If the fourth still shows places the first three didn't, up to two more. Then I stop regardless, and say what is still open.
- **The step ends** when the outside test is marked and John has corrected the picture. What it delivers is the picture, not a design.
- **If most expectations don't hold,** the picture describes Harbour, not the loop, and John chooses what follows.
- **I stop early and ask** if something alarming turns up (I read the code myself before relaying it), if spend passes $100, or if access fails.

## Not in this plan

- Building anything, or changing Harbour, its prompts or its notes.
- Defining a leak in advance, or counting leaks (log:4155).
- The notes spike. It was agreed on 14 Nov (log:3973-3977) [checked]; in this sitting it is held until the picture says what it should test (words §8) [checked].
- Rewriting the record (log:4227). The traces live in one dated working folder. Once John agrees the picture, the folder is removed from the branch; git keeps it, and the picture cites the commit.
