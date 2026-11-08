I scoped LIN-1512 (move the projects page's search below the title) and sized it as **just the task**, decided by the standing policy.

- **Staleness check:** nothing has changed since the ticket was filed. `git log --since=2026-07-21T08:21:53Z` over the navbar, the render code, the page JS and CSS, `llms.txt`, and the search and header-nav e2e tests returns no commits. The code at HEAD matches what triage and both Surveys describe: the toggle and panel only appear on the projects page, and `renderPage` is the only place that renders it.
- **Scope:** the "search" in the ask is the toggle's label, so the toggle and the panel both move under the page title. I went against triage's panel-only recommendation, because that would leave "search" above the nav, which is a cut to the ask.
- **Covered by the task, not extras:**
  - remove the nav's search branches so there is only one copy;
  - keep search off landing previews;
  - rewrite the LIN-1149 placement tests to the new rule, keeping the no-leak and not-dispatch-gated checks;
  - re-measure how much space the sticky header needs on mobile;
  - update `llms.txt`, the CSS comment and the navbar comments.
- **My choices:** I kept the toggle rather than making the input always visible, because the ask is only about placement. Search no longer staying in view on scroll is what the reporter asked for, so I don't count it as a cut.
- **Something deeper:** partly. The shared nav carries controls for one page (search and the team selector), and there is no shared slot for page controls under the title. Neither is needed for this move to work, so both stay in the Surveys.
- **Outputs:** the size record is in `output/description.md`, the comment in `output/comment.md`, and the In Progress status change in `output/tracker-actions.md`. All are under `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b06/`. The code clone is unchanged.

DONE: Sized LIN-1512 as just the task (toggle and panel move under the title, no cuts), decided by the standing policy
