I sized LIN-4252 as **just the task**. That comes from the standing policy, there are no cuts, and nobody has commented on the size, so there's no ruling to record.

**Why that size.** The ticket's list of what the fake must model is necessary but not enough. The opened task's code repaints through `outerHTML` in five places. It decides whether to keep a question card by comparing two `innerHTML` strings, and it uses selector forms the lin-4242 fake can't handle. Without those, lin-4010 either can't run on the fake or passes without testing anything. Those additions are part of building the fake that was asked for, not a separate piece to do first, so they don't make the move bigger. Moving the other client suites onto the fake, and then removing prompt-section's fake-only guards, would pay off later. But nothing here depends on it and the ticket rules it out, so it stays in the Surveys. The policy only weighs sizes a binding finding opens; it doesn't create them.

**Checked against the code:**
- **Not stale.** HEAD is the commit the Surveys read (29f14bf6e). None of the referenced paths has changed since 2026-11-06.
- **The Surveys' code claims are accurate.** I count 17 fake-only guards, not 18.
- **The ticket is partly aimed at a symptom.** prompt-section repaints by replacing strings, and the old fakes have pushed guards into production code.

**For whoever builds it:**
- **There's already a shared DOM fake neither Survey counted.** `tests/fixtures/observation-dom-shim.js` is used by three Observation suites. The new fake's header should say it's the one to use for new client tests.
- **lin-4010 will run repaint code it has never run before.** Once the fake returns real nodes, a failure for a real reason is a finding about production code, which this ticket doesn't change. Report it rather than working around it in the fake.
- **Some lin-4010 regexes depend on how the markup was written**, such as a bare `data-question-slot`. Any regex the serializer forces to change should be named.
- **I couldn't run lin-4010.** It fails at import here because the clone has no `node_modules`. lin-4242 passes 13 of 13.

The code clone is unchanged.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-d9c15ccd-54df-486b-80e0-935c0774bacf/d9c15ccd-54df-486b-80e0-935c0774bacf/scratchpad/w/runs/b11/output/`:
- description.md
- comment.md
- tracker-actions.md

DONE: LIN-4252 sized as just the task (standing policy, no cuts); the size record and a comment listing the fake features the code needs beyond the ticket's list are written.
