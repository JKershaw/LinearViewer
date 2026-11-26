# Spike 5: the held UI tickets (26 Nov)

Read-only, main `5c33e4415`. Screenshots of a local copy of main, seeded via
`/test/set-local-session` (3 tasks, 1 long question, 12 notes, one finished run):
18 pages at 1280 and 390, light and dark, plus `report.json`, under `shots/` =
`/tmp/claude-0/-home-user/66dffdea-297e-53eb-9d13-7edcee5c850f/scratchpad/spike5/shots/`.
I looked closely at six. "Shown" = seen, cited; "unknown" = not checked.

## What landed

- LIN-4546 (7 PRs, `bdef0a0b2`..`8f27cb5db`). One question card everywhere, and a
  quiet Home with notes. CSS: +376/-173 lines over 7 sheets, mostly `style.css`.
  Shown: `shots/home-1280-light.png` and `shots/task-1280-light.png` look clean.
- LIN-4342 (8 PRs, `8b6e4e442`..`5c33e4415`). The rail and frame on every page.
  CSS: +827/-1253 over 26 sheets, including the new `frame.css` (481 lines).
  `style.css` went from 5148 to 4427 lines. Shown: git diff --stat.
- No sideways scroll at 390 on any of the 18 pages (shown: `report.json`);
  with a real-sized workspace, unknown.

## LIN-3976: the run page

Asks: a top sentence plus a pill. The question card first. Stages, not steps.
Styled evidence and close-out. Stop and follow-up. Plain words. A member who
reads only. Ten outcomes in all.
Already done: the card is the shared one (LIN-4553). The transcript is LIN-4560.
The frame is LIN-4342. Being live moved to LIN-4508.
Still left (shown: `shots/run-1280-light.png`, `shots/run-390-dark.png`):
- The nine-row key/value table still comes first, with "tier: not reported"
  and "credential: unknown". The heading id still reads "Run ec3abfb4".
- The evidence rows (asked / done / Review's claim / Now) render as bare text.
  Cause: the `.rev-*` rules are scoped to `.task-pr-section` in
  `public/task-page.css:46-53`, and the run page doesn't load that sheet
  (`lib/render-session.js:415`).
- One Build makes three step rows (Kick-off, Build, Check-in). Raw kinds
  "autopilot", "implementation", "wake" show. So does "Next: review", and every
  step ends "not reported". `groupSessions` is still private
  (`lib/task-page-loader.js:392`).
- The back link is "← Runs" (`lib/render-session.js:473`). John ruled on 25 Oct
  that the task is the run's home (comment on LIN-3976).
- `viewerIsOwner: true` is still hard-coded (`routes/dashboard.js:419`).
  `window.confirm` is still there (`public/session.js:41`).
- The judge covers only the run page's not-found body (`tests/judge/pages.mjs:106`).
Dependencies: the decision panel and `close-out.js` exist. No `stage-track`
component file (shown: ls). Whether LIN-3968's track is one piece: unknown.
Size: large (several PRs). The display part alone (outcomes 1, 2, 4, 6, 7, 8)
is medium.
Overlap: none with LIN-4343, which excludes this page. With LIN-4017: it moves
the evidence CSS out of `task-page.css`.

## LIN-4343: walk every page

Asks: walk about 20 pages (Settings and Models included) in both widths and
themes, as three kinds of viewer, and fix them. It folds in about 17 closed
briefs.
Already done: Home, the task page and question surfaces (LIN-4546). The frame,
headings and footer on all pages (LIN-4342).
Still left (shown):
- Dispatch keeps the old look: tree scaffolding around the form, a raw cost list,
  locale times "11/26/2026, 8:33:29 PM", raw kinds as tags, and a purple default
  link in dark (`shots/dispatch-1280-dark.png`).
- KPIs: default blue links, a bare bullet list "Dispatch kinds", an ISO
  "Generated 2026-11-26T20:33:39.246Z", and a huge mono "too few merges"
  (`shots/kpis-1280-light.png`).
- Task page: findings for the owner read "to someone" (`shots/task-1280-light.png`).
  Whether that is a seed artefact: unknown.
- Its first source, `docs/reviews/ui-sweep-4-2026-11-07/README.md`, is not on main
  (shown: ls). PR #2344's state: unknown.
- Settings, Models, Live, Swipe, Swim, Prompts and the public pages were shot but
  not looked at: unknown.
Size: large and open-ended (about 20 pages).
Overlap: LIN-4017 restyles the same sheets right after, so some of this work
gets rewritten.

## LIN-4017: rebuild the stylesheet

Asks: a fresh stylesheet, one PR, with a pixel replay showing no unintended
change.
Already done: LIN-4342 cut about 430 net CSS lines and added the frame sheet.
LIN-4015 had shrunk it before that.
Still left: all of it. CSS is 19,124 lines in 37 sheets (shown: `wc`). Its
premise, "once the CSS is small and coherent", is not met. The 30 Oct hand-off
leaves 340 near-literal spacing sites and 36 duplicate blocks.
Size: very large for one PR. It is invisible to users by design.
Overlap: it rewrites whatever LIN-4343 and LIN-3976 just changed.

## Recommendation

- Next: LIN-3976, trimmed to its display outcomes (1, 2, 4, 6, 7, 8). It is the
  worst page I saw: raw, unstyled, and in code words. It is one page with a
  written test list. Its "Done when" tests already target exactly what the
  screenshot shows. This reverses expect.md's guess (LIN-4343 first).
- Then LIN-4343, trimmed to the pages a walk finds still off. Start with Dispatch
  and KPIs. Drop the folded briefs that LIN-4342 or LIN-4546 met, and say so.
- Split LIN-3976's steering (Stop, follow-up, member view) out, or fold it
  into LIN-4343's "as a member" check.
- LIN-4017: drop it from LIN-4008, or re-file it as a later tidy. It changes
  nothing a person sees, its premise isn't met, and one PR over 19k lines is the
  kind of ticket that loops in review.

## UI retro: why reviews never fixed the UI

What the checks look at, as shown in the code and the verdicts: CI (`test.yml` runs
unit, hermetic and Playwright only), unit suites, and mutation checks. The
LIN-4546 verdict lists five, all on behaviour. The visual judge
(`tests/judge/`) is not in CI. It is a pixel diff meant to prove "no unintended
change", so it protects the current look, ugly included. Style tests guard
measures: the type-size and mono allowlist (`lin-4107`) and CSS line counts.
None asks whether a page looks finished. The one rule that would have caught the
bare evidence rows is "markup classes have rules in a sheet this page loads".
It exists only for the question card (`tests/unit/lin-4549-question-card-sheets.test.js`).
Most tickets stated outcomes in data and behaviour. Reviews checked what the
ticket asked, so a page could change markup without CSS and still pass. Nobody
was asked to look. LIN-4546 and LIN-4342 were the first tickets whose "Done when"
was screenshots at both widths in both themes plus a walk. That, not more
checks, is what changed the result (shown: the LIN-4546 piece 7 plan comment).
Whether a general class-has-a-rule test would pay off: unknown.
