**Scope — size of the move: just the task** (decided by the standing size policy)

I added the size record to the description, under the As asked block. In short:

- Brief and Recap should fill themselves when a section is opened and has no current output, just as Context does. That covers missing and out-of-date output, in both views, since both views share these sections. Nothing is cut from the ask.
- HEAD (973a8ec) matches both Surveys. None of the referenced files has changed since the ticket was filed. Each section already loads once, on first open. Generation already exists and today runs only from the button.
- Nothing the Surveys found has to change for this to work. The cost, duplicate-call and mirrored-logic findings are real, but they are separate from this change, so the standing policy keeps this at just the task.
- Possible follow-up tickets (not filed): generating briefs and recaps in the background so they are ready before the section opens, which is what the user really wants; one place that decides when briefs and recaps generate, with in-flight dedupe; merging the two mirrored section modules.
- One point the team should know about: once this ships, opening a section spends a model call. For workspaces with no connected key, that call comes out of the free quota that prompt generation also uses.
