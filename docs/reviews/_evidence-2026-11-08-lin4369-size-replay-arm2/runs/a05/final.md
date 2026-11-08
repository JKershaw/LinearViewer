I sized LIN-4252 as **just the task**, decided by the standing policy (err larger).

- **Checked against the code:** The Surveys' claims hold at HEAD 29f14bf6, and none of the files involved have changed since. The prompt section replaces a slot's whole markup in five places. The equality check that decides whether a typed question's card is kept compares the cards' markup, and lin-4242's fake returns an empty string for that markup. lin-4242's selector matcher throws on anything more than a single compound selector. lin-4010's querySelector always returns null.
- **What binds is part of the ask:** The fake also has to replace a node's whole markup, handle the selectors the prompt section really uses, and give markup back faithfully as text. Without these the second suite can't run on it, and the fake would report a card as kept even when it was dropped. They belong to the ask's own goal of a fake that can repaint a page, so they are not extras. No binding finding opens a larger size, so the policy leaves this as just the task.
- **The deeper problem, not binding here:** The prompt section repaints by swapping markup strings, and it carries guards that exist only for the fakes. Moving the other client suites onto the fake, then removing those guards, could be its own ticket. The ask rules it out here.
- **Cuts:** none.
- **Open risk:** The second suite will run repaint paths for the first time. If one fails for a real reason, the fix is in production code, which the ask excludes. That would need a ruling at that point.

Files written:
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a05/output/description.md (the Size of the move section, under 200 words)
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a05/output/comment.md
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a05/output/tracker-actions.md (status set to In Progress)

The clone is unchanged.

DONE: LIN-4252 sized as just the task by the standing policy; no cuts; the Survey findings that bind are part of the ask's own repaint goal.
