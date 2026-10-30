# UI feedback, round 3 (30 Oct 2026)

Feedback on Home and the run control after LIN-4024 ("Home works with a real backlog"). It covers the process, as the person using Harbour meets it, and the UI: less cluttered, more intuitive. It was agreed with John on 30 Oct, and is meant to be picked up after the current code-improvement rounds.

This is feedback, not a build plan. Each item says what is wrong now and what is wanted. How to build it is the builder's call, except where John has ruled on the behaviour (marked **John**).

## What changed since round 2

LIN-4024 fixed most of what round 2 found:
- Home is about 4,100px tall with the real backlog, down from about 44,000.
- Each project shows three tasks, then "show more".
- The count line, the header badge and the rows agree on "2 waiting on you".
- A ruling can be answered on Home.
- Rows use one format, "Another step" uses stage words, and Change is a side drawer.

What is left is mostly about two things: what Home is for, and what the big button does.

## How this was checked

- **Local:** `main` at `c343ba3`, run locally with a copy of this workspace's real tasks (3,704 tasks in 11 projects, with real parents), plus the two rulings production had open on 29 Oct (LIN-4011 and LIN-4012), at 1280px and 390px. `main` has moved since, but only Live Console and dispatch titles changed (LIN-4034, LIN-4035); Home's code is the same.
- **Production:** John's phone screenshot, 30 Oct.

In the [shots/](shots/), magenta numbered markers point at the item with that number below. The production images have no markers; their captions say where to look.

## The principles behind this round

- **Home has three jobs:** answer what is waiting on you, see what moved, and start the next thing.
- **Trust is learned** (`docs/ladder.md`). On a new project a person runs one step at a time. As Harbour proves itself, they run a task to a PR, and later let the autopilot take it to Done. **John:** "Start simple, small, and then grow confidence to PR, and once that's running smooth, a user is likely to trust autopilot due to a proven track record."
- **Simple and honest.** Whether a run steps into a subtask, and which step comes next, is decided at run time by the recommend call (an LLM). Home can't know that when it draws the page, and must not build a second system to guess it. Show what is known, and say plainly what will be decided when you run.

---

## Process: how it works

### Running a task

**1. Three buttons, by how far to go.** **John**
- *Now:* one main action. A task with subtasks offers only "Run to PR" (the autopilot, stopping when a PR is open). A task without subtasks offers one named step ("Run Research"). As far as the code shows, Home never offers a run all the way to Done. [1](shots/1-home-parent.png) marker 1.
- *Wanted:* three buttons, "Next step", "Run to PR" and "Run to Done", ordered left to right by trust, so a new project starts on single steps and moves right as confidence grows. **John:** the filled one is the one this person last used on this workspace, and "Next step" on a workspace that has never run anything. Nothing to configure.

**2. "Next step" never names a step in advance.** **John**
- *Now:* on a task without subtasks, the button names a step from an estimate ("Run Research"). On a parent, the heading says "Run to PR" and the line under it says "the next step for this task": two answers to one question. [1](shots/1-home-parent.png) marker 2. After a plan review the next step could be Plan again (changes asked for) or Build, and the estimate can't tell which.
- *Wanted:* pressing "Next step" asks the existing recommend call what the step is (and which subtask, if it steps into one), then shows the answer with a confirm: the step, why, Run, or Another step.

**3. "Run to PR" and "Run to Done" say what Harbour picked.**
- *Now:* nothing says whether "Run to PR" on a parent will work on the parent or on one of its subtasks, or where it will stop. [1](shots/1-home-parent.png) marker 3.
- *Wanted:* before a run, one line: Harbour picks where to start, this task or one of its subtasks. Once that is known (the autopilot decides after it starts): what it picked, and where it will stop ("Running to PR · started with Research on LIN-4011"). Until then, say it is deciding.

**4. While anything under a task is running or waiting on you, offer no run that would collide with it.**
- *Now:* in production, LIN-4033's box says "● idle · No session running." while its row and its subtask say "Close-out running · 5m 57s", and it offers "Run to PR". [4](shots/4-production-4033.png), the LIN-4033 box. Locally, LIN-4008 offers "Run to PR" while both its subtasks wait on rulings. [1](shots/1-home-parent.png) marker 3.
- *Wanted:* while something runs, the box shows what is running, in which mode and where it will stop, with Watch and Stop. While a subtask waits on you, the box leads with that question (item 11), not a run.

**5. No runner yet: one button, "Write the prompt".** Copy-first is the first rung of the ladder.
- *Now:* this is close. "✦ Write the prompt" is the one teal button. But the line above it names a step in advance ("Scoping · the first step for a task in Backlog"), from the same estimate as item 2.
- *Wanted:* the prompt, once written, says which step it is for. Nothing is named before.

**6. Later, optional: the track record that earns the next button.** For example, under "Run to PR": "7 of your last 8 runs to PR merged as they were". The ladder says confidence comes from seeing Harbour be right, and Harbour has the evidence.

### Facts, not estimates

**7. The stage strip shows what actually ran.**
- *Now:* every opened task shows six chips, most of them "usual": an estimate that often differs from the sessions that really run. On a parent after a breakdown it shows "Build next", but the parent's work is its subtasks and it will never be built itself. [1](shots/1-home-parent.png) marker 7, [4](shots/4-production-4033.png).
- *Wanted:* the strip shows done, failed, running and waiting. What comes next is decided when you run (item 2).

**8. Rows say only facts.**
- *Now:* "Research next", in teal, on nearly every task that has never run. It's the rule's default, not a decision, so the colour that should say "this one" says nothing. [1](shots/1-home-parent.png) marker 8.
- *Wanted:* a row says needs you, failed, running, PR open or done, or nothing.

**9. One word for a failure, and every count agrees.**
- *Now (production):* LIN-4008's row and both its subtasks say "Research failed". The count line says "1 failed". Inside the box, the same failure is "A subtask needs you: LIN-4011". [3](shots/3-production-4008.png).
- *Wanted:* one word, failed or needs you, not both. The count line, the header badge, the rows and the opened box agree. A parent row says what its children are doing ("1 of 3 running", "a subtask failed").

### What needs you

**10. "Waiting on you" comes first on Home, and is answered in place.**
- *Now:* the header badge and the count line say "2 waiting on you" [1](shots/1-home-parent.png) marker 10. To answer, you open the parent, then a subtask, then find the card [2](shots/2-home-subtask.png) marker 10. Under the card sits a run box with nothing to run (marker 10, second).
- *Wanted:* at the top of Home, one card per open question wherever it sits in the tree. Each ruling's recommended answer is the main button, with the other options and "your own answer" beside it.

**11. A parent shows all its children's questions.**
- *Now:* "A subtask needs you: LIN-4012 … Open" names one of the two. [1](shots/1-home-parent.png) marker 11.
- *Wanted:* both questions, or one line that leads to both.

**12. Fewer questions.** This is process feedback for the autopilot, not the UI. "Research was cancelled externally, re-dispatch?" should either not be asked, or fall back to the recommended answer after a while. Fewer, better questions help more than any layout.

### What Home is

**13. Three sections: Waiting on you, Running and recently moved, Up next.**
- *Now:* In Progress, then a folded "Recent activity" [1](shots/1-home-parent.png) marker 13. When opened, Recent activity repeats rows from In Progress [4](shots/4-production-4033.png), the foot of the image.
- *Wanted:* "Running and recently moved" replaces Recent activity: what is running now, and runs that finished, failed or opened a PR since you last looked. "Up next" is a short list of tasks ready to start, each with the three buttons when opened.

**14. The full backlog moves to its own page,** reached from one link on Home. Home becomes a desk, not an index of every project.

---

## UI: how it looks

### The opened task

**15. One state line.**
- *Now:* the task page shows two statuses, "Tracker: In Progress" and "Harbour: ● waiting". [6](shots/6-task-page.png) marker 15. LIN-4008's opened box on Home has no state line at all [1](shots/1-home-parent.png).
- *Wanted:* a pill and one sentence, on every opened task and the task page.

**16. Plain words, not machine words.**
- *Now:* "Last: Check-in queued · 18h ago · All 3" [2](shots/2-home-subtask.png) marker 16, and in production "Last: Check-in closed · 10m ago · All 13".
- *Wanted:* something like "Last run: Close-out finished 10 minutes ago · all 13 runs".

**17. The Sessions list agrees with the box.**
- *Now:* the raw tags and decision JSON are gone. But the list says "Research · running" while the box says waiting for an answer. It also lists two internal records, "Prompt · queued" and "autopilot · queued", as sessions. [2](shots/2-home-subtask.png) marker 17.
- *Wanted:* runs, in words, in the same states the box uses.

**18. The ruling's options are real buttons.**
- *Now:* radio rows in mono, an answer box in mono, and a small "Answer". [2](shots/2-home-subtask.png) and [6](shots/6-task-page.png) marker 18.
- *Wanted:* buttons in the house sans, with the recommended answer as the main one (item 10).

**19. The Change drawer gets room.**
- *Now:* the default is a small card of small type. "Runs on" is three small toggles, then a checkbox and a summary line. "Settings › Models" is a default blue underlined link. [5](shots/5-change-drawer.png) marker 19.
- *Wanted:* a heading, the default as a readable choice, its numbers, and house links.

**20. The task page puts the ruling first and lists only what ran.**
- *Now:* "Runs on … Change" and "Another step" come before the ruling card. Under it, five stages read "usually next". [6](shots/6-task-page.png) marker 20.
- *Wanted:* the question first. The stages show what ran, as in item 7.

### Everywhere

**21. The phone keeps normal type sizes.**
- *Now:* Home drops to 10.4–13px at 390px. [7](shots/7-home-phone.png) marker 21.
- *Wanted:* the same sizes as the rest of the app.

**22. A small type scale.**
- *Now:* Home with one task opened uses 6 font sizes and 17 text styles. The task page uses 11 font sizes.
- *Wanted:* about four sizes.

**23. Mono only for facts**, meaning IDs and figures. Not the ruling's options (item 18), "3 sessions" or the session names.

**24. Project sections, while they stay on Home: one control line.**
- *Now:* every project ends in four lines: "show 20 more up next", "+ Add task", "show 131 in Backlog", "306 done". [1](shots/1-home-parent.png) and [7](shots/7-home-phone.png) marker 24.
- *Wanted:* one quiet line, with Add task somewhere else.

**25. The view bar shows nine views to everyone.** Trim it to what people use. [7](shots/7-home-phone.png) marker 25. John to say which.

---

## Still open, for John

1. **Which views stay in the bar** (item 25). Until John says, keep today's bar.

## Not ours: for the code rounds

Home still sends about 3,700 hidden rows (5.1 MB of HTML) with the real backlog. Only about 35 are visible.
