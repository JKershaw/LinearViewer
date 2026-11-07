The scope is written in the description. In short:

- **What it delivers.** A copyable "hand this to your coding agent" prompt goes in the landing's "try it yourself" section. It points at a new public guide written for agents: `/getting-started.md` for agents, with an HTML version at `/getting-started`, both served from one markdown source. `/llms.txt` gets a pointer to the guide too.
- **What the code showed.**
  - `/getting-started` doesn't exist today; it returns a bare 404.
  - The landing has no install-command area. "Try it yourself" is the closest equivalent.
  - The `/workspace/linearviewer/` URL on the ticket is just where the feedback widget was opened.
- **A deeper cause.** This ticket treats a symptom of a gap the 2026-10-23 Onboarding & Cold-Start Review already recorded: the best cold path isn't advertised anywhere (R3-6), and `/llms.txt` gives agents "no way in" (R3-8, LIN-3058). The guide is where that way in gets written down.
- **The main limit.** An agent can't sign in, connect a tracker, add an OpenRouter key or mint tokens. All of those need the user's browser session. So the guide makes the agent the user's guide and checker, with the user doing the browser steps. Letting agents change settings through the API would be a separate credential-boundary decision, and it is left out of scope.
- **Engineering choices I made, with reasons:**
  - The prompt's URL comes from the request's origin, so self-hosts point at themselves.
  - The prompt text is defined once.
  - A test checks that every path the guide names is a route that is actually mounted, so the guide can't go stale.
- **Two product questions, neither blocking:**
  - Where the block sits: I recommend starting inside "try it yourself" and promoting it to the hero only if the `/kpis` funnel shows it working.
  - Who signs off the wording: I've assumed the implementer drafts it and John reviews it on the PR.
