# Settings › Models

**What the page is for.** Models answers: which model does each job, what does that cost, and where does the setting come from? It is ranked by spend, so the decisions that cost most come first.

The design is one table per view:
- each row is a job, with its model, effort, a spend bar, the typical cost of a session and the total;
- the long tail is folded behind "show";
- changing a job opens a panel beside the table;
- changes wait in a bar at the foot of the page, and are saved together with a reason.

The Models prototype was the benchmark for the rest of the redesign. See [README.md](README.md) for how to read the screenshots.

The live workspace was given the same example group settings as the prototype, so both sides name real models.

## M1. The table became an accordion (Large)

**Design** ([models-1](shots/models-1-list-desktop.png), markers 3 to 6). Each row carries everything needed to compare jobs:
- the model, with its provider's icon and name ("Sonnet 5.5");
- where the model comes from ("from Steer", or "set here · use Plan's");
- the effort and where it comes from;
- a spend bar scaled to the largest job;
- the typical cost of one session ($1.55) and the total ($676);
- a Change button.

You compare jobs by reading down a column.

**Live** (marker 3). Each row is a fold that shows the job's name and "sonnet · from Steer". Spend, typical cost, the bar and effort appear only inside the fold, one job at a time.

**Why it matters.** The ranking survives only as the order of rows. A person can't see why Autopilot comes first, or compare two jobs' costs, without opening rows one by one. Principle 2, rank by what matters, needs the numbers in view; so does principle 3, summary before detail.

## M2. One page holds six tools (Large)

**Design** ([models-1](shots/models-1-list-desktop.png) marker 2). Views as tabs, one at a time: Agent sessions ($2,709), Harbour calls ($54), Group defaults, Change log, with a "Set individually only" filter. The page is about 1,250px tall at 1280 wide.

**Live** ([models-2](shots/models-2-whole-page.png), markers 2, 8 and 9). Everything is stacked on one page about 4,400px tall:
- 20 agent jobs;
- 7 agent group rows;
- 16 Harbour calls;
- 6 Harbour groups;
- a reason box and Save;
- routing presets, with their own reason box and Save;
- recent model changes;
- dispatch presets, with their own form.

Only "All jobs · Set individually" filters it.

**Why it matters.** The list a person came for is one of six things on the page, and the controls for the others sit below it on every visit. On a phone the page is over 6,000px.

## M3. Models are named by alias (Medium)

**Design.** A model is named as people say it, with its provider's icon: "Sonnet 5.5", "Opus 5.5". The harness is named in words ("Claude Code").

**Live** ([models-1](shots/models-1-list-desktop.png)):
- rows say "sonnet" and "opus";
- group rows say "opus · claude-code · 4 jobs, 0 set here";
- the sidebar's summary for Models says "GPT-5.4 Mini +2";
- the change panel, a click away, says "Claude Sonnet 5.5", so the row and the panel name the same model two ways.

**Why it matters.** Readability over style (principle 1). An alias is a stored value, not a name.

## M4. The long tail is not folded (Medium)

**Design** ([models-1](shots/models-1-list-desktop.png) marker 7). "8 smaller jobs under $25 each · show".

**Live** (marker 7). All 20 agent jobs are listed, including four with "no runs" (Retro, Look into, Context, Periodical). Thirteen of the 16 Harbour calls also say "no runs".

**Why it matters.** Design lesson 3: rank by what matters, and put the long tail behind "show".

## M5. Changing a job is a form, not a choice (Large)

**Design** ([models-3](shots/models-3-change-desktop.png), markers 1 to 6; [models-5](shots/models-5-change-phone.png) on a phone). A panel beside the list (a full-screen sheet on a phone) holds:
- the job's name and group;
- its three numbers: sessions, typical and total;
- "Runs on" as two large choices, each saying how it is paid: "Claude Code · Claude subscription" and "opencode · OpenRouter · API credit". One line says what the difference means.
- "Follow the Make group" as the first choice card, saying what that means today: "Sonnet 5.5 on Claude Code today, and whatever Make moves to".
- "Or choose for this job": three suggested models, each priced per session, with why it is suggested;
- "Find any model", a search;
- effort.

**Live** (markers 1 to 5). The row opens in place:
- the job's description;
- "Last 30 days · 265 of 290 runs priced, 11 unpriced, 14 with no usage reported";
- "$247.79 · typical $0.94 a run" in mono, a bar, and "14% of all priced spend in 30 days";
- a Harness drop-down ("Follow Make (Claude Code)");
- a Model text field with the placeholder "Follow Make (Claude Sonnet 5.5)";
- four model buttons, each priced per 1M tokens, with a description line under each;
- a note on rates, an Effort drop-down, and "also ran on Claude Sonnet 5.5".

**Why it matters.**
- **The choice is assembled, not picked.** Following the group, the main choice, is the empty state of a drop-down and a placeholder in a text field. In the design it is an option you can see and select.
- **The units don't match.** The job's cost is per run ($0.94), and the suggestions are per 1M tokens ($2.00 in / $10.00 out). A person can't tell what a switch would cost. The design priced suggestions per session.
- **The accounting leads.** The first line of numbers is how many runs were priced. In the design that is a footnote at most.

**Recommendation.** Price suggestions in the job's unit (per session) wherever run history allows, and say so where it doesn't.

## M6. Save asks why before anything has changed (Medium)

**Design.** Changes are staged. Once something changes, a bar appears at the foot of the screen: what will change, "Why? Goes in the change log", Save and Discard. With nothing pending, there is no bar.

**Live** ([models-2](shots/models-2-whole-page.png) marker 8). Under the tables there is always a "Why are these changes being made?" box, "No changes yet." and a full-width Save button. Routing presets carry a second reason box and Save.

**Why it matters.** Design lesson 8: stage, explain, undo. A form that asks why before anything changed is noise on every visit.

## M7. The change summary reads like a diff (Medium)

**Design** ([settings-5](shots/settings-5-change-log.png), left). One line per change, in words: "Steer group (agent sessions): Opus 5.5 → Sonnet 5.5 · 23 Oct 18:40 · John · 'step 1 of cheaper-capacity'", with Undo.

**Live** ([models-2](shots/models-2-whole-page.png), "Recent model changes"). "a member · 6m ago", then the reason, then "plan model → sonnet; bug model → opus; judge harness → claude-code; judge model → opus; judge effort → medium; …" as one run-on line of stored fields. The Settings change log shows the same change as "Model routing: 17 changes", by "You". So the two places name the person differently, and neither says what changed in words.

## M8. The page leads with an accounting note (Small)

**Design** ([models-1](shots/models-1-list-desktop.png) marker 1). "Settings / Models", a title, and a lede that states the rule ("A job uses its group's model and effort unless you set its own. Biggest spend first.").

**Live.** The centred Settings heading ([shared.md X3](shared.md#x3-the-page-title-is-centred-and-light-medium)), then "Models · Which model each job runs on", the filter links, then "Spend is what the window priced. A run with no price, or with no usage reported, is shown as such, never as $0." before the first row. The rule that matters most, that a job follows its group, is not said until a row is opened.

## M9. Phone: rows carry no numbers (Medium)

**Design** ([models-4](shots/models-4-phone.png)). Each job is a compact entry: name, what it does, the model with its icon and the total on one line, then the source and the effort.

**Live.** Tall grey cards with two lines: "Autopilot" and "sonnet · from Steer". An opened job is a long form ([models-5](shots/models-5-change-phone.png)).

## M10. Dark

[models-6](shots/models-6-dark.png). The findings hold in dark.

## In the picture but not in scope

- **Terminal-Bench scores** on the suggestions. Harbour shows no benchmark data today.
- **The "not tried yet" and "used in Harbour" tags.** "Used in Harbour" could come from run history, as "also ran on" does today; "not tried yet" is the same fact negated.
- **The model catalogue**, prices and notes (Fable 5.1, DeepSeek V4.1 Flash and the rest), and the 8 to 23 October window. Live uses the last 30 days.
- **Example data:** the settings, session counts and totals.
