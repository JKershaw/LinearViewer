# UI sweep 4 (7 Nov 2026)

A walk through every page of Harbour after round 3 (LIN-4040) and its follow-ups landed. It checks what the earlier rounds asked for against what shipped, then looks at the whole app again with fresh eyes.

This is feedback, not a build plan. It describes what is wrong now and how each page should feel. How to get there is the builder's call.

**Navigation has its own review.** The header, the footer, the page frame (one left edge, headings, tab titles) and the way back from a drilled-in page are covered by the navigation work, which John is choosing from a prototype. This document covers what sits inside each page.

## How this was checked

`main` at `aec9e16`, run locally with a copy of this workspace's real tasks from 29 Oct (3,704 tasks in 11 projects, with real parents) and the two rulings production had open then (LIN-4011, LIN-4012). Every page was captured at 1280px and 390px, in light and dark:
- for the runner owner (33 pages);
- for a new user without a runner (13 pages);
- signed out (9 pages).

In the [shots/](shots/), magenta numbered markers point at the item with that number below. The description on the task page is cut short in this local copy; that part is not a finding.

## The feel we are after

Harbour should feel like a harbourmaster's desk on a calm morning. One look tells you three things: what is waiting for your word, what is moving, and what comes next. Everything else is a drawer you open when you mean to. Nothing on the desk repeats itself, and nothing shouts unless it needs you.

The words are the ones a person would say out loud: "9 days ago", not "208h 15m"; "nothing is running", said once. Facts that are machine facts (IDs, counts, money) wear the mono face, and nothing else does. Colour is spent only when something wants attention, so when it appears it means something.

Every page should feel like the same building. The same card asks a question wherever a question is asked. The same button means the same thing on every page. The quieter tool pages (Dispatch, Proxy, Prompts, KPIs) are rooms people visit less often, but they belong to the same house and should look like it, not like the workshop round the back.

## What has landed

Most of what round 3 asked for is now true, and Home is a different place from the one we looked at on 30 Oct.
- **Home has its three sections.** Questions come first and are answered in place. Up next is short, and the backlog has its own page.
- **The three buttons are there,** with "Next step" filled and an honest line saying Harbour picks the step when you press it.
- **The task page puts the question first,** and its stages show only what ran.
- **The counts agree:** the header badge, the count line and the rows all say 2 waiting.
- **No more estimates in the rows.** "Research next" has gone from every row.
- **Dark mode holds up** on every page checked, with no unreadable pairs.

The scorecard against rounds 1 and 3 is at the end.

---

## Home: the desk

[1](shots/1-home.png), [2](shots/2-home-opened.png)

Home is close now. What is left is mostly repetition. The desk still says some things two or three times, and the extra copies crowd out what matters.

**1. "Waiting on you" is said three times before the first question.** Once in the header badge, once as a red line under the heading, and once as the section title, all before the first question. Say it once on the page. The section heading with its count is enough; the badge belongs to the frame.

**2. The question does not lead with its recommended answer.** Every option is the same white pill, so the person has to read both and decide alone, even when Harbour knows which it would choose. The free-text box takes as much room as the options. "Answer" is small green text, and "this wasn't worth asking" is an underlined link beside it. Wanted: the recommended answer as the one filled button, the others plain beside it, and "your own answer" a quiet way in that opens a box only when chosen. A question should feel like a colleague leaning over with a suggestion, not a form.

**3. Up next repeats what every row shares.** All five rows say "Quality, Periodicals & Measurement · No priority · added 29 Oct 2026". That is about half the ink in the section, saying nothing that tells one row from another. Show only what differs. Drop "No priority" as a value. Show a date only when it is recent enough to matter.

**4. "Running" lists something that is not running.** The only row under Running and recently moved is a tracker parent marked In Progress, with "No Project" on the right and no Harbour run under it. To a person, "running" means Harbour is doing something now. Tracker state alone either belongs elsewhere or needs to say what it is.

**5. In the opened task, only one of the three buttons looks like a button.** "Next step" is a filled teal button, while "Run to PR" and "Run to Done" read as plain text beside it. The ladder of trust only works if the next rung is visibly there to step on. The heading "Next step" also repeats the button under it, and "✦ write prompt" crowds the line that explains the button. The opened box still has no state line (round 3, item 15): it opens on "LIN-3535 · Quality, Periodicals & Measurement" rather than on what is happening to the task.

## The task page: the dossier

[3](shots/3-task-page.png)

The question is first now, which was the main ask. What remains is tone: the page has quiet, well-made parts with loose odds and ends scattered between them.

**6. Times are in hours.** "started 208h 27m ago" should read "9 days ago". The same goes everywhere a duration is shown to a person.

**7. A progress bar with nothing to measure.** The Research stage carries an amber bar about 60% full. A bar promises that someone measured how far along the work is. Nobody did, and the run is waiting on an answer, not 60% done. Show the state in words, as the line under it already does.

**8. The description shouts as loud as the page.** The task's own headings ("Why", "What a user sees now") are set at 20px, the same size as the page title, so the description reads as part of the page's structure rather than as the content of the task. It should read like a quoted document: smaller headings, a reading width, and a fold for long ones.

**9. Loose actions float between sections.** "Another step ▾", "Write a brief · Write a recap", "Share this task  Create share link" and "Runs on Claude Code's own model · your runner  Change" each sit alone on a line, in different styles. Gather them into one place that reads as "things you can do with this task", below the question and the run.

## Questions, wherever they are asked

[1](shots/1-home.png), [3](shots/3-task-page.png), [4](shots/4-observation.png)

**10. The same question is drawn three ways.** Home and the task page share one card. Observation draws the same ruling again with stacked full-width options, a mono "Answer in your own words…" box, "Answer & resume", and green, grey and yellow chips for Answer, Dismiss and Shelve. A person who answers on one page and later sees a question on another should recognise it at once. One card everywhere, with the recommended answer leading (item 2).

## Watching: Live Console and Observation

[4](shots/4-observation.png), [5](shots/5-live-console.png)

**11. When nothing runs, Live Console is four empty instruments.** It says "all quiet — nothing in flight right now" in a banner, then shows an empty strip with 3m/15m/1h/6h, an empty timeline with fit/1h/24h and a legend explaining bar colours, then "all quiet — agents will appear here the moment they pick up work". The quiet state is the common one. It should feel like a calm sea: say once that nothing is running, show when the last run finished and how it went, and keep the instruments for when there is something to watch.

**12. Observation overlaps Home and Live.** Its Runs tab is the run history, its Rulings tab is a third copy of Home's questions, and Scan-due is a machine word. With questions answered on Home and live work on Live Console, Observation's own job is unclear to a person arriving at it. This is also an open question in the navigation work (keep Runs and Live as two places, or make them one).

## Triage views: Swipe and Swim

[6](shots/6-swipe.png)

**13. Swim lists every task.** With the real backlog the page is 61,707px tall on desktop and 205,215px on a phone. Each lane should show a handful, with a count and a way to see more, the way the Backlog page does.

**14. Swipe tells the runner owner to set up a runner.** The card says "Harbour can also run steps for you, on your own machine. Set up a runner ›" to a person whose runner is ready. The counter "1 / 1852" appears twice, once in the panel and once on the card, and the card sits in a grey box inside a grey panel. Swipe should feel like a stack of cards on a clean table: one card, one counter, and the actions for this person.

## Settings: the cupboard

[7](shots/7-models.png)

The structure of Settings is right and it reads well on a phone. Models is the one area still carrying too much.

**15. Models still holds six tools on one page** (round 1, M2): spend by agent session, agent groups, Harbour calls, Harbour groups, routing presets and dispatch presets. Two of them carry their own save forms, in two button styles (a full-width "Save routing preset" and a small lowercase "save preset"). The routing preset form asks "Why?" before anything has changed (round 1, M6). The page should open on the one thing people come for, which model each job runs on and what it costs, with presets one step away.

**16. The sidebar and the index disagree.** The Settings index summarises Models as "GPT-5.4 Mini". On the Models page, the same sidebar row says "No priced runs". Each row's summary should say the same thing wherever it appears.

## Tools: Dispatch, Proxy, Prompts, KPIs, Run on my machine

[8](shots/8-dispatch.png), [9](shots/9-runner.png), [10](shots/10-effort.png)

These pages are visited less often, and it shows. They still wear the old app's clothes while Home and Settings have moved on.

**17. Dispatch reads as a developer form.** It has tree scaffolding (├ └) running down a form, lowercase labels with colons ("prompt:", "model/harness:", "preset:"), a mono placeholder and a browser-default blue "create a preset →". It also has a section called "No job (Dispatch suggestion)" whose first line explains that it is not a job. Proxy shares the look. These pages should use the same form language as Settings: sentence-case labels, house links, and one primary action.

**18. On Run on my machine, the main button looks disabled.** "create runner prompt" is pale green text on a pale green fill, so it reads as switched off. "Settings › Agent access" below it is browser-default blue. The three-step instructions above are clear and good.

**19. The measurement pages talk to their builders.** Effort Self-Assessment says "not instrumented", "TTL-scoped" and "not reported". Escalation KPIs leads with "0.1 / day". The workspace KPIs page is 84% mono. Operator Dashboard is one "Run Audit" button on an otherwise empty page. Each should open with a sentence a person can act on ("No runs reported their effort in the last 30 days"), with the figures in mono and the words in sans.

## Public pages

**20. Getting started and Templates speak to someone else without saying so.** Getting started is written to a coding agent ("A person has asked you to set up Harbour…"), which is its job, but the page doesn't say at the top who it is for, so a person landing there is confused. Templates opens with "19 templates · 103,874 total chars", a builder's statistic. Their headers are part of the navigation work.

## Everywhere

[11](shots/11-home-phone.png)

**21. The phone still drops to 10.4px** on nearly every signed-in page (round 3, item 21). Home, Backlog, the task page, Settings, Observation and Live Console all have text at 10.4px at 390px. The phone should use the same sizes as the desktop.

**22. Too many sizes, and mono beyond facts.** Desktop pages use between 5 and 10 font sizes (round 3 asked for about four). Mono covers 85% of the text on Swim, 84% on KPIs and 45% on Live Console. Mono is for IDs and figures (round 3, item 23).

**23. Browser-default blue links remain** on Run on my machine and Dispatch (round 1, X1).

---

## Scorecard: earlier rounds against what shipped

"Not checked" means this sweep could not see it locally, usually because it needs a run in flight.

**Round 3 (30 Oct)**

| # | Item | Now |
| -- | -- | -- |
| 1 | Three buttons by how far to go | Landed. The two right-hand ones don't look like buttons (item 5) |
| 2 | Next step never names a step in advance | Landed |
| 3 | Run to PR and Run to Done say what Harbour picked | Not checked (needs a run) |
| 4 | No colliding run while something runs or waits | Not checked (needs a run) |
| 5 | No runner: one button, "Write the prompt" | Landed |
| 6 | Track record under the next button (optional) | Not yet |
| 7 | The stage strip shows what actually ran | Landed, with an empty progress bar (item 7) |
| 8 | Rows say only facts | Landed |
| 9 | One word for a failure; every count agrees | Landed for "waiting"; failure not checked |
| 10 | Waiting on you first, answered in place | Landed. The recommended answer doesn't lead (item 2) |
| 11 | A parent shows all its children's questions | Not checked |
| 13 | Three sections on Home | Landed. "Running" includes tracker-only rows (item 4) |
| 14 | The backlog on its own page | Landed |
| 15 | One state line | Landed on the task page; missing in Home's opened box (item 5) |
| 16 | Plain words | Partly ("208h 27m", item 6) |
| 17 | Sessions list agrees with the box | Not checked |
| 18 | Ruling options are real buttons | Partly: buttons in sans, no main one (item 2) |
| 19 | The Change drawer gets room | Not checked |
| 20 | Task page: ruling first, only what ran | Landed |
| 21 | Phone keeps normal type sizes | Not reached (item 21) |
| 22 | About four sizes | Not reached (item 22) |
| 23 | Mono only for facts | Partly (item 22) |
| 24 | One control line per project section | Landed, on the Backlog page |
| 25 | Trim the view bar | Part of the navigation work |

**Round 1 (26 Oct), the biggest gaps**

| Gap | Now |
| -- | -- |
| Home: the next run has no box of its own (H1) | Landed |
| Models: the summary is hidden in an accordion (M1) | Landed: rows show model, jobs and spend |
| Every row state is the same grey (X2) | Landed for "needs you" and running |
| Home: the main action comes last, in blue (H2, X1) | Landed on Home. Blue remains on tool pages (item 23) |
| Models: one page holds six tools (M2) | Not yet (item 15) |
| Changing a run is a form, not a choice (H8, M5) | Not checked |
| A running task repeats itself and hides Stop (H6) | Not checked (needs a run) |
| A new user sees things that don't apply (H10) | Partly: Proxy and KPIs are in the bar for a new user (navigation work) |

## Not covered

- Anything that needs a run in flight: watching, stopping, colliding runs, the Change drawer during a run.
- The size of Home's HTML (round 3 noted 5.1 MB of hidden rows). That is for the code rounds.
- The experimental views behind feature flags (Ship, Collective, task chat and others).
