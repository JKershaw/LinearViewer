The LIN-998 plan is written to `output/description.md` as a `## Implementation Plan` block. It changes nothing in the ask: Brief and Recap will fill themselves in when opened, like Context does now, on both the tree view and the swipe view.

**The change:** when Brief or Recap is opened and nothing up to date is saved, the section generates straight away instead of showing a "generate" button. An up-to-date saved result is just shown and costs nothing. One small edit each in `public/brief.js` and `public/recap.js` covers both views, because both open through those same two modules.

**Decisions I took:**
- **Out-of-date results also regenerate on open.** The research comment suggested auto-generating only when nothing exists. I went against it because the server sends back no content for an out-of-date result. Leaving that case manual would still open to a "Refresh to update" button whenever the task changes, which is exactly what was reported.
- **Free-tier workspaces are not held back.** Opening a section is something the user does deliberately for one task, and sections never open by themselves. The agent API already regenerates on read under the same rules. If the shared 20-a-day free allowance runs out, the reason shows in the section.
- **Errors show in the section with a retry button.** That covers AI not configured and the free limit reached. A "generate" button in those cases would only fail the same way.

**Main risk for the builder:** if the generate-on-open path wires the refresh button a second time, one click sends two requests and charges the free tier twice. The plan names this, and one of its tests catches it.

**Tests:** the plan specifies five, covering:
- both views, both sections;
- the out-of-date case;
- no request when the saved result is current, and exactly one per refresh click;
- an error with no automatic retry.

Two existing swipe tests that assume "open, then click" get rewritten.

I marked it as fitting one session with plan review due (yes), because it removes the click-before-spend step on two sections that call the AI model. Plan review is where the free-tier decision can be overturned. Nothing is cut from the request. The status was already In Progress, so there are no tracker changes. The code clone is unmodified.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r08/output`:
- description.md
- comment.md
- tracker-actions.md
- final.md

DONE: Plan written for LIN-998: Brief and Recap generate on open when nothing current is saved, on both views; plan review due
