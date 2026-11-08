LIN-4252 is scoped as **just the task**, decided by the standing policy (err larger). I checked the policy and nothing nearby binds on this task.

**Why:** The ask is already a tidy. Both Surveys found the same gaps, and I confirmed them in the code at HEAD 29f14bf6. Nothing has changed since the ticket was written.

- **How the page repaints:** prompt-section replaces each slot by setting outerHTML, at five places.
- **How it keeps a card:** it compares the old and new card markup as strings, at line 993.
- **What lin-4010 checks:** about 30 regexes over the container's innerHTML.
- **What lin-4242's fake can't do:** its innerHTML getter returns an empty string, and its selector matcher throws on the selector forms prompt-section uses.

These findings bind on the ask. Without them the fake can't do what the ticket's own goal says, which is to witness a repaint. They complete the fake the ask describes, so they are not an extra piece of work and the size stays at the task.

**Not taken:**
- Moving the other 17 client suites onto the fake.
- Removing the guards in prompt-section that exist only for fakes.
- Splitting prompt-section.

None of these bind on this task. They are noted as possible tickets of their own.

**Cuts to the ask:** none, so no ruling is needed.

**Open questions:**
- Once querySelector returns real nodes, lin-4010 will run repaint paths it has never run. If they fail for real reasons, the fix touches production code, which the ask rules out. The builder should stop and ask then.
- The Surveys missed a fourth kind of fake: tests/fixtures/observation-dom-shim.js, already shared by three suites. The new file's header should say which fake is the one to use. This is in the comment.

I didn't run the suites, because the clone has no node_modules. The clone is unchanged.

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a10/output/:
- description.md
- comment.md
- tracker-actions.md (status set to In Progress)

DONE: LIN-4252 sized as just the task by the standing policy. The binding findings (markup round-trip, replace-by-markup, selector forms) sit inside the ask's goal, there are no cuts, and the open questions are recorded.
