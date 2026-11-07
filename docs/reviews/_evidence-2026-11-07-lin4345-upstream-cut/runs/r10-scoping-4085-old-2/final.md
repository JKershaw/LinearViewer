I've written the scope for LIN-4085. Nothing in the repo was changed.

**What it delivers**
- **A handoff prompt on the landing page.** A copyable "hand this to your coding agent" block goes in the "try it yourself" section of `/`. That section is the nearest thing the landing has to an install-command area.
- **A new public guide written for agents.** It is one markdown source served at `/getting-started.md` (plain text for agents) and `/getting-started` (HTML for humans).
- **A pointer from `/llms.txt`** to the guide.
- **Tests**, including one that checks every path the guide names is a route that actually exists, so the guide can't quietly go out of date.

**What the code showed**
- `/getting-started` doesn't exist yet; it returns a bare 404.
- The page named on the ticket, `/workspace/linearviewer/`, is just where the feedback widget was opened. The "homepage" in the request is the public landing.
- **The ticket is a symptom of a known gap.** The 2026-10-23 Onboarding & Cold-Start Review found that the best way in for a newcomer isn't advertised anywhere (R3-6), and that `/llms.txt` gives agents no way in (R3-8, LIN-3058). The guide is where that way in gets written down.
- **An agent can't do the setup for the user.** It can't sign in, connect a tracker, add an OpenRouter key or create the access tokens. All of those need the user's own browser. So the guide makes the agent a guide and checker while the user does the browser steps.
- **Out of scope:** letting agents change settings through the API, which is a separate decision about what tokens may do. Also left out: getting back into local workspaces later (LIN-3065), linking GitHub Projects (LIN-2387), and using the prompt on the signed-in Home page.

**Two product questions, neither blocking**
- **Where the block sits.** I recommend starting inside "try it yourself" and moving it up to the top of the page only if the `/kpis` sign-up figures show it working.
- **Who approves the wording.** I've assumed the implementer drafts it and John reviews it on the PR.

**Tracker changes recorded**
- Status set to In Progress.
- LIN-4085 marked as related to LIN-3058.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r10/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md`

DONE: Scoped LIN-4085 as a landing-page prompt to hand to an agent plus a public `/getting-started` guide and a `/llms.txt` pointer, with the agent guiding while the user does the browser-only steps.
