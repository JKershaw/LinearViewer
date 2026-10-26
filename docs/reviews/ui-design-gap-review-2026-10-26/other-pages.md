# Pages with no prototype

These pages were redesigned from written briefs only; no prototype was made for them. So they are checked against the shared findings ([shared.md](shared.md)) and the design lessons, not against a picture. Each image shows the live page only.

## Task page (LIN-3975, part 1 of 3)

[other-1](shots/other-1-task-page.png), [other-2](shots/other-2-task-page-phone.png). A running task.

- **The state is set in mono:** "Tracker: In Progress" and "Harbour: ● running", then the sentence, then the exact time in mono (X5, X6).
- **The run control is loose lines, as on Home** ([home.md H1](home.md#h1-the-next-run-has-no-box-of-its-own-large)). "Runs on … Change", then "Next: Review, once Build finishes" with a small quiet Stop, then "Another step ▾".
- **A third look for stages.** Stages are cards with progress bars. Home draws the same stages as equal-width cells, and the Home prototype as small chips ([home.md H4](home.md#h4-the-stage-strip-reads-as-form-fields-medium)). One idea is drawn three ways.
- Parts 2 and 3 of LIN-3975 had not landed.

## Observation (LIN-3983, part 1 of 2)

[other-3](shots/other-3-observation.png).

- **The lede is in mono** (X6).
- **"send", "dismiss" and "shelve" are small coloured tags, not buttons.** They are the actions that answer a waiting run, which is the most important thing on the page.
- **Uppercase labels** ("WAITING ON YOU · 2", "FILTER", "ACTIVE · 4 RUNNING"), as on Settings (S4).
- The same question appears twice under "Waiting on you". That comes from seeding the test workspace twice, not from the page.

## Live Console (LIN-3977; LIN-4002 in flight)

[other-4](shots/other-4-live-console.png).

- **A centred title** (X3), and **mono for most rows and labels** (X6).
- **The timeline can't be read at 1280.** Its bars carry labels cut to "L…" and "LIN-3…", and their colours are the only cue.
- **The page reads as a wall of equal rows.** There is no summary of what matters before the activity list. The status line at the top ("1 working · 1 waiting on you · 2 failed, nothing since") is the start of one; LIN-4002 rewords it.

## Landing (LIN-3980, LIN-3995)

[other-5](shots/other-5-landing.png).

- The closest of these to a designed page. It has one primary colour (teal), plain section ledes, and the loop explained in four cards.
- The "Getting started" box with `.env` instructions only appears on a server with no sign-in configured, as on this test server. A configured server doesn't show it.
