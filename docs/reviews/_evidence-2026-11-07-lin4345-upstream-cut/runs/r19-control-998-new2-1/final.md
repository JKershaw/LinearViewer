I wrote the LIN-998 plan into the description file. The plan has Brief and Recap fill themselves in when the section is opened, the way Context already does. It needs one change in a shared piece of client code and no server change. Nothing ran in this stage, since it makes no code changes. The code clone is unchanged.

**The change**
- In `public/brief.js` and `public/recap.js`, `init()` still makes the cheap status check first.
  - If the cached copy is current, it shows it as today.
  - If there is no copy yet, or the copy is out of date, it calls the existing `refresh()`, which generates one.
  - If the status check itself fails, it shows the error and generates nothing.
- The two old "click to generate" screens (`renderMissing` and `renderStale`) are then unused and get deleted.
- Both pages load these sections through the same `init()`, so one change covers the tree/dashboard view and the swipe view.

**Where the plan differs from the earlier research comment**
1. **Out-of-date copies regenerate too.** The research suggested keeping the button for those. But an out-of-date section shows no text at all, only "Inputs have changed… Refresh to update", so keeping the button would not meet the request. Each regeneration happens at most once per real change to the task. The cache is shared across the workspace, so one person opening it updates it for everyone.
2. **No special treatment for free-tier workspaces.** Keeping the button for them would keep the click the ticket asks to remove. The server's limits stay as they are: a "not configured" error before anything is spent, and a refusal at 20 a day. Either message now shows in the section. The cost is that free-tier uses are spent by opening a section rather than by clicking.
3. **Some existing tests need changing.** Research said none were affected. The refresh tests in `tests/e2e/swipe.spec.js` and the state checks in `tests/e2e/tree-sections.spec.js` would still pass, but they would no longer catch a slide back to the button. The plan tightens them.

**Tests the plan asks for**
- Both sections fill in with no click on both views, when the copy is missing and when it is out of date.
- A current copy is shown without generating anything.
- Collapsing and reopening a section sends no new requests.
- A failed status check generates nothing.
- A "not configured" error shows its reason in the section.
- Clicking refresh after the automatic generation makes exactly one request. This one matters most: leaving a second click handler on the button would double every later refresh.

Nothing in the request is cut. The work fits one session. I marked it for plan review because it removes the click that was the only gate on AI spend in these sections, and it settles the free-tier question that triage flagged.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r19/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (the status is already In Progress, so no change)
- `final.md`

DONE: LIN-998 plan written: Brief and Recap generate on open when missing or out of date, in the shared init() for both views, with no server change; fits one session, plan-review due: yes
