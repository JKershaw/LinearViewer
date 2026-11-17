# Walk 1 material

Read 17 Nov. Fixed: every step of walk 1 works from these copies.

- `LIN-4450.json`, `LIN-4445.json`: the tickets as Harbour's read-only workspace proxy (harbour.cat) returns them: description, comments with times, children. LIN-4450's description is the post-close-out one; the pre-prune text is in Harbour's snapshot store, which the proxy does not expose.
- `LIN-4450-cost.json`: the task's cost record from the same proxy: seven worker sessions with dispatch times, and Harbour's own model calls. Model names are reduced to their tier (`<model:opus>` etc.) because this session does not push model identifiers.
- `PR-2421.md`: the PR's title, body and one comment, verbatim, and its file list.
- `PR-2421-notes.diff`: what the PR did to the area notes (`docs/areas/providers.md` created, one entry removed from `docs/areas/llm-and-prompts.md`).
