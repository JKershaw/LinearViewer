I've written the plan for LIN-4085 into the description section. It can be built in a single pass, and plan-review is due because it widens the auth-exemption list (which controls session minting) and raises the frozen prompt-size budget. I didn't change the clone.

**What the plan builds:**
- **A public guide** at `/getting-started` and `/getting-started.md`, built from `docs/agent-onboarding.md` the same way the runner prompt is built. The site address, which sign-in options are switched on, and whether the free tier is on are all filled in from code. The HTML version reuses the Library's markdown renderer and page layout.
- **A homepage block** directly under the hero sign-in buttons: "getting started / Or hand this to your coding agent". It holds the prompt as selectable text and a copy button that only appears when JavaScript runs.
- **One shared list of sign-in options** (`lib/sign-in-doors.js`). The hero buttons and the guide both read it, so they can't disagree.
- **Smaller additions:**
  - an entry at the top of `/llms.txt`, plus the new block in its Limitations line;
  - the guide added to the sitemap and to the list of public pages that skip sign-in, with look-alike paths tested and kept out;
  - three new size ceilings with their reasons;
  - updates to the source map.

**Where the ticket's scope was wrong, checked against the code:**
- The homepage already loads JavaScript (`/common.js` and `/app.js`), so the scope's "the landing ships no JS" is wrong. The real limit is that the security policy blocks inline scripts unless they are hashed, so the copy button is a new file, `public/landing.js`.
- `/api/proxy/instructions` needs a token, so the guide only sends the agent there once it has one.
- LIN-3849 removed the switch for turning on dispatch, so the guide doesn't mention it.
- The homepage version shown after someone logs out has no site address to put in the prompt, so the block is left out of that one render.

**One decision for you (it doesn't block the build):** the ask says the user shouldn't have to follow the setup steps themselves, but the scope leaves out new endpoints that would let an agent do the human-only steps. So the user still does the OAuth consent, enters an OpenRouter key when the free tier isn't enough, and presses the runner mint. I recommend accepting this cut and putting agent-run credential endpoints in their own ticket if you want them. The question is in the comment.

**Gaps in the plan's checks:**
- The automated check that the guide's links work can't catch a mistyped address under `/api/proxy/`, because unknown paths there answer "unauthorised" rather than "not found". The guide therefore names only `/api/proxy/instructions` under that prefix.
- Whether a real agent finds its way in from the prompt alone is only shown by a manual run with a fresh Claude Code session, recorded on the PR.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r06/output/`:
- description.md
- comment.md
- tracker-actions.md (status was already In Progress, so no change)
- final.md

DONE: LIN-4085 plan written (guide route, homepage agent-prompt block, shared sign-in list, llms.txt entry, witnesses); plan-review due: yes; one cut raised as a non-blocking ruling
