# Home

**What the page is for.** Home answers two questions: what needs me, and what runs next? The design reads top to bottom in that order.

1. **The page head:** the workspace, then one line of counts with "needs you" in red.
2. **The rows:** each one says its state in a colour, and In Progress puts the tasks that need you first.
3. **An opened task**, as one block:
   - a quiet line of facts;
   - the state (a pill and a sentence);
   - the stages, as small chips;
   - anything that needs you, in a red strip;
   - **the next run**, as one box: the step, why it is next, a teal Run at its top right, then what it runs on and where that comes from, then Change;
   - one line about the last session;
   - one row of links.

See [README.md](README.md) for how to read the screenshots. The shared findings ([shared.md](shared.md)) also apply here, above all X1 (two primary colours) and X2 (state colour).

## H1. The next run has no box of its own (Large)

**Design** ([home-1](shots/home-1-opened-task.png), markers 5 to 8). The next run is one box on a slightly darker card, holding:
- "Next step", with the step name as its heading ("Review");
- what the step does, and why it is next ("usually next after Build · typically $1.16");
- the Run button at the top right;
- under a rule, "Runs on" with the model's icon and name, the effort, "your runner", and where that comes from ("from the Judge group in Models"), with Change to the right;
- "Another step" and "See prompt" as outlined buttons at the foot of the box.

**Live** (markers 5 to 8). The same content, as loose lines in the grey task block:
- "**Review** · failed last time, so it runs again" beside an outlined "✦ write prompt";
- "Runs on Claude Opus 5.5 · effort medium · your runner — from the Judge group in Models" in grey, with Change at the end;
- the Run button on its own row;
- "See prompt ✦" and "Another step ▾" as unbordered text buttons.

Nothing marks where the run starts or ends. The step name is body size, set inline with its reason.

**Why it matters.** The run is the one decision on this page. Seen as one box, a person reads "this step, on this model, go" in one look (principle 3, summary before detail; principle 5, decide in context). As loose lines it reads as five facts of equal weight.

## H2. The main action comes last, and in blue (Large)

**Design** ([home-1](shots/home-1-opened-task.png) marker 6, [home-7](shots/home-7-phone.png) marker 6). Run sits level with the step name, at the top right of the run box, so the eye meets the step and its button together. On a phone it is full width, right under the step's reason.

**Live.** Run comes after the state, the stages, "Last", the step and "Runs on", left-aligned on its own row, and filled blue (see [shared.md X1](shared.md#x1-two-primary-colours-medium)). On a phone it sits about 300px below the top of the task block.

**Why it matters.** The main action should be the easiest thing to find, not the last thing you reach.

## H3. The state takes three lines and a label (Medium)

**Design** ([home-1](shots/home-1-opened-task.png) markers 1 and 2). A quiet line of facts in small type (mono ID, project, "updated 2h ago"). Then the pill and the sentence on one line: "● ready  Build finished 2 hours ago and opened a PR. Its checks passed."

**Live** (markers 1 and 2). The facts line, then "Harbour: ● failed" on its own line, then the sentence, then the exact time in mono on a line of its own ([shared.md X5](shared.md#x5-exact-times-get-a-line-of-their-own-small)).

**Why it matters.** "Harbour:" reads as a label for the pill, when it means "Harbour says". Three lines carry what the design says in one.

## H4. The stage strip reads as form fields (Medium)

**Design** ([home-1](shots/home-1-opened-task.png) marker 3). Small rounded chips sized to their words:
- ✓ for a done stage;
- a dashed teal edge for "next";
- a filled amber chip for running.

Five stages fit in a short row, and the row reads as progress from left to right.

**Live** (marker 3). Equal cells stretched across the full width. With two stages each cell is half the page wide, and the failed cell has a teal outline inside a red one. The cells look like input fields. The task page draws the same stages a third way, as cards with progress bars ([other-pages.md](other-pages.md)).

**Why it matters.** A person should see at a glance how far the task has got. Wide boxes read as things to fill in.

## H5. "Last" sits between the state and the next run, and repeats the state (Medium)

**Design** ([home-1](shots/home-1-opened-task.png) marker 9). One line of facts after the run box: "Last session: **Build** · opened a PR, checks passed · 2h ago · 41 min · $0.88 · Sonnet 5.5 · all 3".

**Live** (marker 9). "Last: Review failed · 13h ago · [All 1]" sits between the stages and the next step, with an outlined "All 1" button. The sentence two lines up already says Review failed.

**Why it matters.** History is detail. Placed above the next run, it pushes the decision down and says the state a second time.

## H6. A running task repeats itself and hides Stop (Medium)

**Design** ([home-3](shots/home-3-running.png)):
- the state once: "● running  Plan has been running for 6 minutes on your runner.";
- one running box with an amber edge, headed "Running now / **Plan** / Started 6 minutes ago";
- Watch and a red-outlined Stop at the box's top right;
- what it runs on, then "Next: Plan review, once Plan finishes".

**Live:**
- running is said four times: the pill, "Build running for 10 hours.", the strip's "Build running 619m", and "Last: Build running · 10h ago";
- Watch is a small teal link, "watch on the task page ›";
- Stop is a small quiet text button at the end of "Next: Review, once Build finishes".

**Why it matters.** While a step runs, the two things a person may want are to watch it or stop it. Both should be in plain sight, and Stop should look like what it does.

## H7. Folds and links take four rows and drop the counts (Medium)

**Design** ([home-1](shots/home-1-opened-task.png) marker 10). One row of links: "Task page › · Sessions (3) ▾ · Description ▾ · Comments (1) ▾ · Chat · Open in Local ↗". The counts tell you whether opening a fold is worth it.

**Live** (marker 10). A row of three small links (Task page, Chat, Open in Local), then three fold rows stacked under it ("Sessions ▶", "Description ▶", "Comments ▶"), each with a left rule and no count.

**Why it matters.** It adds about 100px and four more things to scan, below the action, on every opened task.

## H8. Change is a form, not a choice (Large)

**Design** ([home-4](shots/home-4-change.png), [home-8](shots/home-8-change-phone.png)). Change opens a side drawer (a full-screen sheet on a phone) titled "How this run is set up":
- the step's numbers: sessions, typical cost and the window;
- under "Model", the default as a choice card: "**Default for Review** · Opus 5.5 · medium · Claude Code · From the Judge group in Models";
- other ready-made choices, then "Choose for this run";
- "Where it runs" as choice cards (your runner, Claude Code on the web, Harbour OS).

**Live** (markers 1 to 4). The panel opens inline, inside the opened task:
- "This run only · default: Claude Opus 5.5";
- a line of accounting ("260 of 284 runs priced, 9 unpriced, 15 with no usage reported");
- "$305.51 · typical $1.18 a run" in mono;
- drop-downs set to "From Models", each with a "Right now: …" line under it;
- a text field for the model;
- four model buttons, each with a per-1M-token rate and a description line;
- where it runs, as three small toggle buttons;
- a checkbox, a summary line, then "Use for this run", Reset and Close.

**Why it matters.** The design frames the decision as picking one of a few named options, with the default first and said in words. The live panel frames it as filling in a form. Every option is there, but the person has to assemble the choice. The panel also pushes the rest of Home down rather than sitting beside it. Per-token rates can't be compared with the per-run typical cost shown above them (see [models.md M5](models.md#m5-changing-a-job-is-a-form-not-a-choice-large)).

## H9. Another step lists step ids, not steps (Medium)

**Design** ([home-5](shots/home-5-another-step.png) marker 1). "Most used": the five steps people run most. Each has its name, what it does, the model it runs on and its typical cost, with "next" marked on the suggested one. Then "Show 12 more steps", and "2 steps that do not fit a started task are left out."

**Live** (marker 1). A row of small outlined chips named by step id: "look into · research · plan · implement · Show 12 more", then "1 step left out: it does not fit this task's state."

**Why it matters.** Picking another step is a decision about what to do and what it will cost. Bare ids give neither. "implement" is also a different word from the strip's "Build".

## H10. The new user sees what does not apply (Medium)

**Design** ([home-6](shots/home-6-new-user.png), [home-9](shots/home-9-new-user-phone.png)). For someone with no runner, who copies prompts:
- the view bar is cut to tasks, swipe and settings (marker 1);
- a one-time teal card says how Harbour works, with "Got it" beside it (marker 2);
- an opened task says "● in progress  No prompt copied from here yet." (marker 3);
- the next step box offers a teal "✦ Write the prompt" (marker 4);
- a quiet line at the foot of the box says Harbour can also run steps (marker 5).

**Live:**
- all eleven views are in the bar (marker 1);
- the card is grey with a small "Got it" under the text (marker 2);
- the task says "Harbour: ● idle" and "No sessions yet." (marker 3), about runs this person cannot have;
- "Generate the next prompt for this task" with a small outlined "✦ Write the prompt" (marker 4);
- the runner line comes last, after the folds, with "Set up a runner" in blue (marker 5).

**Why it matters.** Design lesson 6: show only what applies. A new user should see one thing to do (write the prompt), not a state about sessions and runs they have never had.

## H11. Rows: the project in brackets, and a black arrow on every row (Medium)

**Design** ([home-2](shots/home-2-rows.png) markers 3 and 4). The project sits in small muted type right after the title. The state sits on the right in its colour. The whole row is the button, with no arrow.

**Live** (markers 3 to 5). The project is in brackets at the far right ("(Harbour)"), run into the state ("Research next (Harbour)"). Every row ends in a black ▶. Project headers are blue with blue triangles.

**Why it matters.** Brackets beside the state make two facts read as one. A column of black arrows down the right edge (eleven in this workspace) is the strongest mark on the page, and it says nothing.

## H12. Phone: nesting eats the width (Medium)

**Design** ([home-7](shots/home-7-phone.png)). The opened task spans the screen, and the run box's buttons run full width.

**Live.** The row's indent, the task block's margin and its padding leave about 300px for the content. "✦ write prompt", Change and Run each sit on their own line at their natural width.

## H13. Dark

[home-10](shots/home-10-dark.png). The same findings hold in dark. The blue Run becomes a light blue.

## In the picture but not in scope

- **The ready-made run choices in Change** ("Careful", "Quick and cheap", "Free lane"). They don't exist. Models has routing presets, which save a whole table; that is a different thing.
- **"✦ ask Harbour"** in the step's reason line. Its live counterpart is "✦ write prompt". Keep whatever the live feature is.
- **The "next run" view in the prototype's view bar.**
- **Example data:** the tasks, sessions, models, costs, counts and times.
