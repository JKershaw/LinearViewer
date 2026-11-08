I've sized LIN-1512 as **just the task**. That comes from the standing policy: no Survey finding is needed for the move to work, so the policy has nothing to make larger. No cuts.

- **Staleness check:** nothing touching the files involved has changed since the ticket was filed. The notes from triage and from both Surveys still match the code.
- **Why not panel-only:** triage recommended moving only the panel. That would leave the "search" toggle above the nav, and the toggle is the part the reporter sees, so it would be a cut. The size covers moving both the toggle and the panel to just below the page title.
- **Work that comes with the move:**
  - remove the nav's search code;
  - keep search off the landing page;
  - rewrite the existing tests that assert search sits in the nav;
  - re-measure the mobile header height;
  - update the agent guide (`llms.txt`) and the code comments.
- **Toggle or always-visible input:** both deliver the ask. I recommend keeping the toggle and just moving it. An always-visible input would change the layout for every visitor and nobody asked for it.
- **Trade-off:** search will scroll out of view on long pages instead of staying in the sticky header. That follows from what was asked.
- **Deeper issue:** the ticket is partly a symptom. The shared nav carries controls for this one page only, including the team selector. Nothing there is needed for this move, so it stays in the Surveys as separate work.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b01/output/`:
- `description.md`: the four-line size section
- `comment.md`: the reasoning
- `tracker-actions.md`: status set to In Progress

The code clone is unchanged.

DONE: LIN-1512 sized as just the task (move both search toggle and panel below the page title), no cuts, decided by the standing policy
