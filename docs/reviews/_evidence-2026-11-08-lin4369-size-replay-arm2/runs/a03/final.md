LIN-998 is scoped as **just the task**, decided by the standing policy. Nothing was cut from the ask, so no ruling is needed.

- **Size and why:** Brief and Recap should fill on open the way Context does, in the tree view and in Swipe, since both views share these sections. Nothing in the code or the Surveys has to change first for this to work. Each section already loads only once per open, and the call that generates the content already exists. The err-larger policy only weighs larger sizes when a finding makes them necessary, and none does, so it doesn't change the size.
- **Part of the task, not extras:**
  - When the server refuses (no AI set up, or the free quota used up), the section shows today's generate button, not an error.
  - A section that is already generating doesn't start a second paid call.
  - An out-of-date section can only show content by regenerating, or by having the server send back the last saved version. Today the server sends no content for an out-of-date section. Which of the two is the builder's call.
- **Cuts: none.** Both Surveys suggested generating only when nothing exists yet, or only for users with a paid key. Either would cut the ask, so I didn't adopt them and listed the cost concerns as open questions instead.
- **Open questions:**
  - Opening a section now costs money, including from the shared free quota, and every out-of-date section regenerates when opened.
  - Should the AI-recommendations switch also stop the auto-generation?
  - The deeper want is content that is ready before the section opens. Generating in the background when a task changes would give that, as a possible ticket of its own.
- **Staleness check:** none of the files the ticket refers to have changed since it was created.

Files written:
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a03/output/description.md (the size section, 196 words)
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a03/output/comment.md (the reasoning, with code references)
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/e1edc5d5-ae4a-4be9-a75a-15a0f33a8af0/scratchpad/arm2/runs/a03/output/tracker-actions.md (status Todo to In Progress)

The code clone was left unchanged.

DONE: LIN-998 sized as just the task (standing policy), with no cuts; cost and quota concerns recorded as open questions
