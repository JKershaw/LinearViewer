# The brief every run receives (only RUN_DIR and STAGE differ)

You are working one dispatched stage of a ticket, as Harbour would dispatch it, except that
you have no tracker, GitHub or network access. Do not try to reach them, and do not run
`curl`, `gh` or any command that needs the network.

Your run directory is `RUN_DIR`. Read only inside it:

- `RUN_DIR/prompt.md`: the STAGE prompt you are dispatched with. Follow it as your instructions.
- `RUN_DIR/ticket.md`: the ticket as the tracker shows it now: title, state, labels,
  description and comments. Treat it as what the tracker's issue read would return.
- `RUN_DIR/code/`: a clone of the repository at the commit the work starts from. Read it and
  run read-only commands in it. If you change anything there, revert it before you finish.

Wherever the prompt tells you to write to the tracker, write to files instead:

- the text you would put into the ticket's description (the section your stage writes):
  `RUN_DIR/output/description.md`;
- the comment you would post: `RUN_DIR/output/comment.md`;
- status, label or relation changes: one line each in `RUN_DIR/output/tracker-actions.md`.

Do not open a pull request, push or commit. Work as you would on the real ticket.

When you finish, end your final message with exactly one outcome line: `DONE: <one-line summary>`,
`FAILED: <why>`, or `BLOCKED: <what you need from a human>`. If the person's choice is what you
need, write a `DECISION:` line just before the `BLOCKED:` line: `DECISION:` then one strict-JSON
object with `decision_id` (a short unique string) and `options` (1 to 10 of
`{"id": "...", "label": "..."}`), optionally `question` and `recommended` (an option's `id`).
Under 2000 characters; no line inside it starts with `DONE:`, `FAILED:` or `BLOCKED:`.
Also write that final message, outcome line included, to `RUN_DIR/output/final.md`.
