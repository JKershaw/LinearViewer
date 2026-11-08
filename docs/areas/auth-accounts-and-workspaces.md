# Auth, accounts & workspaces

Area notes for `auth-accounts-and-workspaces` in the registry. Format and rules: README.md.

## Lessons

- To retire a logged workspace setting, take it out of `SETTINGS` in
  `lib/workspace-change-log.js` and keep its words in `summarizeWorkspaceEntry`. Its old rows
  then still read, are not undoable, and `undo` refuses them before `readCurrent` or `apply`
  runs. Removing only the Settings undo sink is not enough: the route falls back to writing a
  workspace feature flag. Leave the stored preference unread; don't migrate it (LIN-4393).
