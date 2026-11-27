# Harbour tickets, drafts for filing (27 Nov)

From the agreed plan and John's 27 Nov calls (`log.md`). Outcomes and why; the build chooses the how. Background files are on LinearViewer branch `claude/cool-rubin-6acj5j` under `docs/plans/survey/`.

States:
- **Todo:** H1, H2, H3, H4 and H8, the work queue in plan order.
- **Backlog:** H5, H6 and H7, queued for later.
- H3, H4 and H6 edit existing tickets; the rest are new.

---

## H1. Close-out hands back without blocking, and a re-review checks only what it asked for

*New. Todo. No parent.*

**Why.** When review approves with conditions, close-out fixes them, and a re-review must see the fix. That's the slice 3 rule (LIN-4521, agreed by John), and it stays. Two things went wrong last week, on LIN-4549, 4553, 4557, 4567, 4568 and LIN-4342's closing PR:

1. **Close-out and review blocked each other.** Close-out parked while it waited for the re-review. A parked run counts as still running, so Harbour refused to start that very review (STAGE_IN_FLIGHT). The rule that holds a ticket on a parked run came from LIN-4392 (10 Nov) and was meant for runs parked on CI, not for a stage waiting on another stage. The one exception, a close-out parked on the blind read (#2492), stopped firing once LIN-4544 kept a blind read on record. The autopilot worked round it 12 times by forcing reviews and 14 times by resuming close-out by hand. Once it needed a note.
2. **Re-reviews kept widening.** Instead of checking the fix, a re-review reviewed the whole change again and found new small things, so each round moved the code and started another. John's ruling (decision-5dbdf161) never reached other tasks, because it sits in LIN-4546's task. LIN-4342 added a new condition twice after it.

**Outcome.**
- A parked run no longer holds its ticket against other stages. The blind read's special case goes with it.
- A close-out that hands work back to review ends instead of parking. Once review approves again, the next close-out picks up from the records.
- A re-review checks only the commits close-out listed, against the conditions it set. John's words: "A re-review checks only the fixes for the conditions it set. Anything new and small goes to project." It is still the one review stage; there is no new kind of review.

**Not in scope** (John, 27 Nov):
- resuming the parked session (resumes are where follow-ups get lost; LIN-4572);
- anything for questions that events overtake: left as is for now.

**Witness.**
- A test, failing before and passing after: a ticket whose close-out has handed back recommends review, not a live wait. After an approving verdict, it recommends close-out.
- At runtime: the next conditional approval goes review, close-out, re-review, merge, with no forced review, no hand-written resume, and no new condition from the re-review.

**Readings** (reported only): forced reviews and hand-written resumes per task, against 12 and 14 across six tasks last week.

**Note.** Prompt size is frozen (`tests/unit/prompt-size-budget.test.js`). The re-review change rewords an existing line, and its reason is recorded beside the ceiling if the bytes rise.

**Background.** `spikes/2b-parked-guard.md`, `spikes/4-slice-6.md` §2, `spikes/2-cleanup.md` §3; the call 2 and call 4 entries in `log.md`.

---

## H2. Slice 5: lessons as records

*New. Todo. Parent LIN-4490.*

**Why.** Agents' lessons (traps, where things live, why things are as they are) are kept in notes files in the repo.
- The notes are back up to 54 KB, and 7 of the 13 files sit at their size cap, so lessons get squeezed and pruned. Three lesson records already exist and are in no note, each written while its note was full.
- Lessons are used: 24 of 80 plans mention one.
- The brief doesn't fetch them. A live brief said "0 lessons hold" while 3 did.

Slices 1 to 4 moved every other hand-off into records. This slice moves lessons and retires the notes. The design is `integration/design.md`, the slice 5 row, revised on 27 Nov.

**Outcome.**
- Every brief says how many lessons hold for the project and how to search them, and the count is right.
- The step that writes lessons today writes lesson records instead of notes.
- Every lesson in the notes is imported once, unsorted. John: moving first and cleaning up later mirrors how lessons will live anyway, recorded and eventually retired.
- simple-dispatcher's notes come too: its lessons as lesson records, its Waiting entries as project findings.
- The notes files, their size cap and its test, the pointer that tells prompts to read the notes, and the audit's notes-PR path all go.
- No cap on lessons. The count is reported, never gated. John: if they grow faster than we clear them, "either we're correctly documenting the friction in the system... or something's afoot, and we're in a good place to observe and understand what."

**Not in scope:**
- where a person sees lessons (a design spike of its own after this slice; H5);
- the code registry the notes sat beside, which the blind read and other tools still use.

**Witness.**
- The "0 lessons hold" brief as a failing-then-passing test.
- A lesson written in one task is counted, and found by search, in a later task's brief.

**Readings** (reported only): notes bytes before (54 KB) and after; the share of plans mentioning a lesson, before (24 of 80) and after; the lesson count.

**Background.** `spikes/3-slice-5.md`; the call 6 entry in `log.md`.

---

## H3. LIN-3976 (run page): an update block added at the top

*Existing ticket. Description kept; this block goes first. Set to Todo.*

> **Update, 27 Nov (John). Read this first; it narrows the ticket.**
> - **This ticket is now first in LIN-4008's UI order,** before the walk (LIN-4343).
> - **Scope: outcomes 1, 2, 4, 6, 7, 8 and 10,** what the page shows. Outcomes 3 (steering), 5 (staying current) and 9 (member view) move to a later ticket, along with the Done-when tests for Stop, answers delivered without reload, and the member page. John's answers in the comments still hold: the task is the run's home, and the URL stays.
> - **Sisters, not twins** (John). The run page and the task page share pieces where they genuinely overlap: the stage track, evidence and close-out. Each keeps its own job. The run page is one run's work; the task page is the whole ticket.
> - **What a 26 Nov look at the page found** (`spikes/5-ui.md`):
>   - the key/value table comes first;
>   - the evidence rows are bare text, partly because their styles live in a stylesheet the run page doesn't load;
>   - one build shows as three steps;
>   - code words like "wake" and "Next: review" appear.
> - Brief and recap are gone (LIN-4537), and the question card is the shared records card (LIN-4546).

---

## H4. LIN-4343 (UI walk): an update block added at the top

*Existing ticket. Description kept; this block goes first. Stays Backlog until H3 lands, then Todo.*

> **Update, 27 Nov (John). Read this first; it narrows the ticket.**
> - **This lands after the run page (LIN-3976).**
> - **Walk only the pages still off.** A 26 Nov look (`spikes/5-ui.md`) found Home and the task page in line after LIN-4546 and LIN-4342. Start with Dispatch and KPIs: raw kinds, unstyled browser links, an ISO timestamp. Then check Settings, Live, Swipe, Swim and Prompts, which weren't looked at closely.
> - The run page and the stylesheet stay out (LIN-3976, LIN-4017). The side rail's own fix is H8.
> - `docs/reviews/ui-sweep-4-2026-11-07/` isn't on main (PR #2344 never landed). Use the other sources and your own walk.

---

## H5. Where a person sees lessons: a design spike

*New. Backlog. Parent LIN-4490. After H2.*

**Why.** Once slice 5 lands, lessons are records: written by agents, counted in briefs, and superseded or disproved over time. John wants a home where he can see them. It's a new concept for Harbour, so it needs thought rather than a list tacked onto a page (John, 27 Nov).

**The question.** What should a person see about the project's lessons, where, and how do they act on them (supersede, disprove, notice ones that pile up or go stale)? Design from the real lesson records slice 5 leaves.

**Done when** a short design is written and agreed with John. No build in this ticket.

---

## H6. LIN-4017, rewritten: a textbook CSS structure, starting from a component garden

*Existing ticket. Title and description replaced. Stays Backlog.*

**Title:** UI finish 9: a textbook CSS structure, starting from a component garden

> Repository: JKershaw/LinearViewer. Part of the UI finish (LIN-4008).
>
> **Why.** Harbour's CSS is about 19,000 lines across 37 sheets (26 Nov). The goal isn't a single stylesheet. John: "it's a sensible css structure and components - aiming for a textbook quality setup, rather than the slightly messy setup we have now."
>
> **The route** (John, 27 Nov):
> 1. **A component garden first:** one place that shows every component Harbour uses, so overlaps, near-overlaps and UI sprawl become obvious.
> 2. **Then tackle it iteratively** from what the garden shows, not as one big PR.
> 3. **Once the structure is sensible,** the Theseus method (`docs/theseus-method-long.md`) may suit a rebuild.
>
> **Done when** the garden exists and shows every component in light and dark, and the next iterations are written up from what it shows. Later work gets its own tickets.
>
> Lands after LIN-3976 and LIN-4343.

---

## H7. The seven Security Review findings, as real work

*New: one parent (Backlog) and seven children (Backlog).*

**Parent title:** Security Review (10 Nov): seven findings, as real work through the loop

**Parent description:** The 10 Nov Security Review (`docs/reviews/security-review-2026-11-10.md`) left seven findings. They were imported as task records under task-309c83df on 20 Nov and haven't been worked. John (27 Nov): good candidates for "real work passing through the system" rather than urgent fixes, since he's currently the only user. Run them one at a time after the current plan. Each child ends its task record when done.

**Children** (title, then the finding's own text as the description, plus "Ends task-xxxx"):
1. **The Collective preview no longer hands out the Yap password** (task-37347dd4)
2. **Model routing can't be changed workspace-wide by any member's key** (task-53e1786b)
3. **Email sign-in budgets can't be multiplied by inbox aliases, and a provider refusal isn't hidden** (task-6e82c9d1)
4. **Production safety controls don't fail open when NODE_ENV is unset** (task-8237e103)
5. **The secret scan catches the remaining shapes, and new credentials mint scannable** (task-84a6e5e2)
6. **Masking works on Jira-escaped text** (task-9a4f20af)
7. **The public task timeline hides model names, run ids and other tasks' identifiers** (task-b5166546)

---

## H8. The rail always shows Harbour's tools

*New. Todo. Parent LIN-4008.*

**Why.** Since the side rail (LIN-4562), Dispatch, Runs, Connect an agent, KPIs and Prompts appear only when the viewer is the owner *and* Harbour sees a live runner key (`lib/places.js`, `runControls`). After John rotated his keys on 27 Nov, none was seen as live, so all of them vanished. That left Settings, scrolled down, as the only way to Connect an agent, so he couldn't easily make a token, and he couldn't find Dispatch at all. `lib/run-controls.js` itself says key tools "are always on". John: "We should always show these, even if when a user clicks they then see nothing running. Making them disappear is weird."

**Outcome.** The rail always shows the tools. A page with nothing to show says so, and where it helps, says how to set up a runner.

**Witness.** A test with no live runner key, failing before and passing after, showing the tools in the rail.
