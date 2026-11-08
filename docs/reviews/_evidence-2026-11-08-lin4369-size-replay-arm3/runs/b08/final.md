I sized LIN-4252 as **just the task**, decided by the standing policy, with no cuts.

**Why.** Every finding that binds is already covered by the ask's own words. I checked the repaint code and both suites at HEAD. The repo is still at the Survey commit, 29f14bf6, so nothing is stale.
- **Whole-slot replacement and wider selectors.** The page repaints by replacing whole slots, and it uses selectors the current fake can't match. Both fall under the ask's "what a repaint needs".
- **Markup read back as text.** Without this, the card-keeping check passes no matter what, and the ask's "can't silently pass" requires it.
- **A home other tests can find.** This is in Done when.

**What doesn't bind.** It stays in the Surveys:
- moving the other 17 copies of the fake onto the new one;
- removing the code in prompt-section that exists only for the fakes (the deeper symptom);
- splitting prompt-section.

**Risk for the build stage.** With a real `querySelector`, the lin-4010 suite runs repaint paths it has never run. If one fails because of a real bug, it needs a ruling, because the ask says no production code changes. It shouldn't be patched inside the fake. I couldn't run the suites because this clone has no `node_modules`.

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b08/output/:
- description.md
- comment.md
- tracker-actions.md (status set to In Progress)

DONE: LIN-4252 sized as just the task (standing policy, no cuts); the size record and scope comment are written
