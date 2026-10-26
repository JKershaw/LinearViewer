# UI design gap review (26 Oct 2026)

The designer's review of the built pages against the prototypes they came from. It covers Home (LIN-3833), Settings › Models (LIN-3820) and Settings (LIN-3846), with shorter notes on four pages that had no prototype. It says where each built page falls short of the design, and why that matters to the person using it.

This is feedback, not a build plan. How to close each gap is out of scope. Some findings end with a **Recommendation**, which is advice, not a requirement.

Grounded on `main` at `d3f6785` (26 Oct), after the UI rounds LIN-3962, 3968, 3977, 3980, 3987, 3991, 3992 and 3995, and part 1 of LIN-3975 and LIN-3983. LIN-4002 (Live Console round 2) and later parts of LIN-3975 and LIN-3983 had not landed.

## The documents

- [shared.md](shared.md): findings that repeat on every page. Start here.
- [home.md](home.md): Home, the opened task, the run control and the new-user view.
- [models.md](models.md): Settings › Models.
- [settings.md](settings.md): the rest of Settings.
- [other-pages.md](other-pages.md): task page, Observation, Live Console and Landing. These had no prototype; they are checked against the shared findings only.

## How to read the screenshots

Every image in [shots/](shots/) puts the prototype on the left and the live page on the right, at the same width.

- **PROTOTYPE shows the intent. It is not a pixel target.** Its data is example data, and some of what it shows does not exist in Harbour. Each page's doc lists those things under "In the picture but not in scope". Take the point of the picture (what leads, what is grouped, what is quiet), not its spacing or its numbers.
- **LIVE is `main` at `d3f6785`**, run locally on a seeded test workspace:
  - 30 days of priced runs shaped like October;
  - a task whose Review failed;
  - a Build that has been running for hours;
  - a run waiting on a person;
  - group defaults set to match the prototype's example (Judge and Plan on Opus; Make, Steer and Sort on Sonnet; Plan and Bug set individually).
- **Magenta numbered markers** match the numbered points in each finding. A marker on one side only means the other side has nothing there.
- The two sides hold different data (other tasks, times and states). The findings are about layout, hierarchy, controls and wording, not about the data.

## The size of the gap

| Page | Gap | In one line |
| -- | -- | -- |
| Home | **Large** | The opened task kept the old page's layout. The next run has no box of its own, the main action comes last and in blue, and every row state is the same grey. |
| Settings › Models | **Large** | The ranked table became an accordion. Spend, typical cost and effort are hidden until a row is opened, models are named by alias, and six tools share one 4,400px page. |
| Settings | **Small** | The structure is right. The finish is off: a centred heading over both columns, switches that look like labels, uppercase labels, blue chips, summaries that say little. |
| Shared, every page | **Large** for state colour, **Medium** for the rest | Every row state is one grey, there are two primary colours, the page title is centred and light, and the phone header loses the logo. |

## The biggest gaps, across all pages

Ranked by how much each costs the person using the page.

1. **Home: the next run is not one thing.** The step, why it is next, what it runs on and the button to run it are loose lines in a grey box. In the design they are one box with the button at its top right. [home.md H1](home.md#h1-the-next-run-has-no-box-of-its-own-large)
2. **Models: the summary is hidden.** Each row shows only "sonnet · from Steer". The numbers the page is ranked by, and the effort, only appear after opening a row. [models.md M1](models.md#m1-the-table-became-an-accordion-large)
3. **Every row state is the same grey.** "needs you", "Review failed" and "Build running" read alike, so nothing on Home tells you where to look. [shared.md X2](shared.md#x2-state-colour-is-lost-large)
4. **Home: the main action comes last, in a second primary colour.** [home.md H2](home.md#h2-the-main-action-comes-last-and-in-blue-large), [shared.md X1](shared.md#x1-two-primary-colours-medium)
5. **Models: one page holds six tools.** [models.md M2](models.md#m2-one-page-holds-six-tools-large)
6. **Changing how a run is set up is a form, not a choice,** on both Home and Models. [home.md H8](home.md#h8-change-is-a-form-not-a-choice-large), [models.md M5](models.md#m5-changing-a-job-is-a-form-not-a-choice-large)
7. **Home: a running task says it is running four times, and Stop is hard to find.** [home.md H6](home.md#h6-a-running-task-repeats-itself-and-hides-stop-medium)
8. **A new user sees things that do not apply to them** ("idle", "No sessions yet", the full view bar). [home.md H10](home.md#h10-the-new-user-sees-what-does-not-apply-medium)

## How the gap arose (for the retro)

These are the reviewer's own observations, including about the reviewer's own part.

1. **The page briefs were written from code surveys and screenshots of the old pages, not from the prototypes.** They listed defects, and the builders fixed the list. The old layout survived because no brief described the new one.
2. **Builders never saw the prototypes.** That was deliberate (design lesson 13, "Builders get principles, not prototypes", after John's note "May be over specific."). Principles carry wording and rules well, but they cannot carry layout: what is grouped, what leads, what is quiet.
3. **Reviews compared each build with its ticket and the page before it, never with the prototype.** The reviewer (the author of this document) marked outcomes "reached" on pages that still looked nothing like the design. Live Console round 1 is the clearest case.
4. **The fresh-reader check on each ticket pushed toward testable string checks** ("contains 'Claude Code' once", "no 'UTC'"). Tickets grew precise about words and silent about layout, which nobody can assert in a test.
5. **Polish rounds landed on the wrong layout.** Each round (LIN-3968 and 3991 on Home, 3987 and 3992 on the decision panel) made the old layout tidier, and that made it harder to see it was the wrong layout.
6. **Pace.** Seven page briefs and six follow-ups were filed in one night, and John saw none of them before they were filed.

## Not covered

- Swipe, swim, KPIs, Dispatch, the run page and the email pages were not reviewed.
- Keyboard and screen-reader behaviour, and contrast figures, were not checked. The periodic design and interface review covers them (`docs/reviews/design-interface-review-2026-10-21.md`).
- Live Console round 2 (LIN-4002) and the later parts of LIN-3975 and LIN-3983 were still in flight.

## Reproducing the captures

The pages were rendered with Playwright at 1280×900 and 390×844, light and dark. The prototype pages come from the design artifacts for LIN-3833, LIN-3846 and LIN-3820; their HTML is not in this repository. The live side is `NODE_ENV=test` with a local data directory seeded through the real routes (`/test/set-local-session`, the dispatch API and the Models save form).
