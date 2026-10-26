# Shared findings: what repeats on every page

These gaps are not about one page. Each shows up on Home, Models and Settings, and most on the pages that had no prototype too. Each is set once in the shared styles, so one decision moves every page. See [README.md](README.md) for how to read the screenshots.

## X1. Two primary colours (Medium)

**Design.** One primary colour: the teal brand (`--brand`). It marks the one thing to do on a surface: Run Review, Write the prompt, Save. Links are teal text. Nothing else is filled.

**Live.**
- Home's Run button is filled **blue**: `.opened-task-go` uses `--blue` (`public/run-control.css:137-148`). Two lines further down the same opened task, the Change panel's "Use for this run" is filled **teal**. One task has two primary colours.
- Project headers on Home are blue (`[data-testid="project-header"]`, `rgb(37, 99, 235)`).
- The "8 queued" badge in the header is a blue fill.
- Settings › Sources has blue "add" and "API token" chips.
- `--blue` is `#2563eb` in light and `#6ea8fe` in dark (`public/style.css:29` and `:227`). It is commented "Links and project headers", and 19 stylesheets use it.

**Why it matters.** The primary colour is how a person finds the one thing to do. With blue and teal both filled, and blue also on headings and badges, nothing stands out. Blue is also not in the palette the redesign set out.

**Images.** [home-1](shots/home-1-opened-task.png) marker 6, [home-4](shots/home-4-change.png) (teal "Use for this run" below the blue Run), [home-7](shots/home-7-phone.png) marker 6, [home-10](shots/home-10-dark.png) (dark), [home-2](shots/home-2-rows.png) marker 6.

**Recommendation.** One primary token for filled actions, used everywhere. White text on the teal fill is a known contrast failure (3.74:1, LIN-739 and LIN-849). Settle that in the same change rather than keeping blue to avoid it.

## X2. State colour is lost (Large)

**Design.** A row's state says how urgent it is through colour as well as words:
- red, semibold, for "needs you";
- amber for running and queued;
- teal for ready and "next";
- muted for backlog and done.

The page summary under the title repeats it: "3 in progress · **1 needs you** · 2 running", with "needs you" in red.

**Live.** Every row state is the same grey: `.row-state` is `color: var(--fg-dim)` whatever the state (`public/style.css:1109-1116`). "subtask needs you", "Review failed" and "Build running" all render `rgb(102, 102, 102)` at weight 400. The page summary is the same grey.

**Why it matters.** Home's first job is to show what needs you (principle 2, rank by what matters). With one grey, a person has to read every row to find it. This was the main point of the Home design.

**Images.** [home-2](shots/home-2-rows.png) markers 2 and 3, [home-7](shots/home-7-phone.png) (phone).

## X3. The page title is centred and light (Medium)

**Design.** The page title is left-aligned and semibold (24px on Home, 22px on Settings, 28px on Models), with a one-line summary under it ("3 in progress · 1 needs you · 2 running"; for Models, a lede that says how the page is ranked).

**Live.**
- Home: "Local Workspace" is centred at 32px weight 400. The summary moved under the In Progress heading.
- Settings: "Settings" and "Configure AI, features, and connections" are centred above both columns.
- Live Console: also centred.

**Why it matters.** A centred title floats over left-aligned content, so the eye starts in the middle and then jumps left. It takes about 120px before any content. On Settings it heads both columns, so the sidebar looks like it belongs to the heading rather than the page.

**Images.** [home-2](shots/home-2-rows.png) marker 1, [settings-1](shots/settings-1-sources.png) marker 1, [settings-4](shots/settings-4-phone.png), [other-4](shots/other-4-live-console.png).

## X4. The phone header loses the logo (Small)

**Design.** At 390px the wordmark and search sit on the first line, and the workspace sits on its own line under them.

**Live.** At 390px there is no wordmark. The first line is "workspace: Local W…", cut off, beside search and the two header badges.

**Why it matters.** On a phone the wordmark is the only way home and the only sign of where you are.

**Images.** [home-7](shots/home-7-phone.png), [home-9](shots/home-9-new-user-phone.png), [settings-4](shots/settings-4-phone.png) marker 2.

## X5. Exact times get a line of their own (Small)

**Design.** A state sentence says the time in relative words ("Build finished 2 hours ago"). The exact time stays quiet.

**Live.** Under the state sentence, the exact time has its own line in mono: "25 Oct, 07:19 PM UTC". This is on Home and on the task page.

**Why it matters.** It follows John's ruling on LIN-3975 (an exact time is in the reader's local time, with the zone named, and reachable on a phone). The gap is weight, not content: the line gives the timestamp the same weight as the state, and reads like a log line.

**Images.** [home-1](shots/home-1-opened-task.png) marker 2, [other-1](shots/other-1-task-page.png).

**Recommendation.** Keep the ruling, and lower the weight: muted, after the sentence or behind a tap.

## X6. Mono where words belong (Small)

**Design.** The house rule (CLAUDE.md): mono for machine facts (IDs, counts, paths, a figure on its own), sans for words.

**Live.** Sentences and labels in mono:
- the Settings switch states ("● on", "○ off");
- the Models figures line ("$247.79 · typical $0.94 a run");
- "Tracker: In Progress" and "Harbour:" on the task page;
- Observation's lede;
- Live Console's section labels and most of its rows.

**Images.** [settings-3](shots/settings-3-features.png), [models-3](shots/models-3-change-desktop.png), [other-1](shots/other-1-task-page.png), [other-3](shots/other-3-observation.png), [other-4](shots/other-4-live-console.png).
