I've scoped LIN-4085. The new description, a comment and one status change are written to files; I left the code clone unchanged.

**What the code shows (at commit `e1f75fe7`):**
- The homepage has no "getting started" section, although the ticket assumes one. The closest thing is "Try it yourself", which has sign-in buttons but no command or install step.
- `/getting-started` doesn't exist and returns 404.
- Nothing relevant has changed since the ticket was filed.

**Scope I settled on:**
- **Homepage section:** a new section directly under the sign-in buttons, with a copy-paste prompt for the visitor's own agent. Every visitor sees the same text. The link is built from the site's own address, so a self-hosted copy points to its own guide; if the address can't be read it falls back to `harbour.cat`.
- **The guide:** a new public page written for agents, at `/getting-started` (HTML) and `/getting-started.md` (plain Markdown), both from one source file. It says which steps only the human can do (signing in, approving access) and helps the agent choose between copy-first prompts and running Harbour's work in the user's own Claude Code session.
- **Agent file and indexes:** `/llms.txt` will point to the guide and lose its outdated "tree viewer" description. The sitemap and the public-page secret scan will include the guide.
- **Tests:** they include one that fails if the guide names a route that no longer exists.

**The deeper problem:** the 2026-10-23 onboarding review found the way into Harbour isn't written down anywhere, and the public stats page showed no first runs in 30 days. The guide becomes the one place that describes how to start. The other blockers the review found stay with their own tickets: LIN-2387, LIN-3108, LIN-3065, LIN-2149 and LIN-3789.

Three product questions are open but don't block the build:
- whether the section sits under the sign-in buttons or inside "Try it yourself";
- whether the guide recommends copy-first prompts before the Claude Code runner;
- whether to count prompt copies and guide reads as a follow-up.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r01/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (Backlog to In Progress)

DONE: Scoped LIN-4085: a copy-paste agent prompt directly under the homepage sign-in buttons, plus a new public guide at /getting-started (HTML and .md) that /llms.txt and the sitemap point to; three non-blocking product questions left open.
