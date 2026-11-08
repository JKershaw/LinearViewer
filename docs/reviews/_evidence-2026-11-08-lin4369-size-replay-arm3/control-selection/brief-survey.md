# The brief every Survey run receives (only RUN_DIR and BASE differ)

You are working one dispatched stage of a ticket, as Harbour would dispatch it, except that
you have no tracker, GitHub or network access. Do not try to reach them, and do not run
`curl`, `gh`, `git fetch` or any command that needs the network.

Your run directory is `RUN_DIR`. Read only inside it:

- `RUN_DIR/prompt.md`: the stage prompt you are dispatched with. Follow it as your instructions.
- `RUN_DIR/code/`: a clone of the repository. In this run, `origin/main` resolves to `BASE`, and
  `code/` is already checked out at it. Read the code there instead of fetching or adding a
  worktree. Run read-only commands in it. If you change anything there, revert it before you
  finish.

Wherever the prompt tells you to post a comment, write it to `RUN_DIR/output/comment.md`
instead. Do not open a pull request, push or commit.

When you finish, end your final message with exactly one outcome line: `DONE: <one-line summary>`,
`FAILED: <why>`, or `BLOCKED: <what you need from a human>`. Also write that final message,
outcome line included, to `RUN_DIR/output/final.md`.
