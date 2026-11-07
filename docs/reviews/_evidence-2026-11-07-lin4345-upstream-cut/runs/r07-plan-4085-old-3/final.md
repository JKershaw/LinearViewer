I've written the plan for LIN-4085 into `output/description.md`, under `## Implementation Plan`, along with the comment and the tracker note. No code changed, and the clone is clean.

**Ticket vs. the code:** nothing has changed since the ticket at HEAD `e1f75fe7`, but the scope gets seven things wrong, and the plan corrects each one:
1. The runner-prompt pattern serves the text below the `---` divider, not above it.
2. The landing already loads JS files. The site's security policy blocks inline scripts, so the copy button goes in a new `public/landing.js`.
3. `/api/proxy/instructions` returns 401 without a token, so the guide sends an agent there only once it has one.
4. The no-sign-in door ("+ local workspace") is a form only the user's own browser can use. If the agent submits it itself, it creates a workspace the user can never open (LIN-3065). The guide has the user press the button.
5. The two new public paths must be added to the one list of pages that skip auto-login and token refresh (LIN-3346). The scope left this out.
6. The landing takes its origin from the raw Host header, and has none on the logout page. The prompt uses the validated origin, which falls back to `harbour.cat`, and the block is left out when there is no origin.
7. The sitemap test counts its entries, so adding `/getting-started` changes that number.

**What the plan decides:**
- **One list of sign-in buttons**, read by the hero, the "try it" section and the guide, so the guide can't name a button the page hides. This is a small refactor folded into the work.
- **The guide:** written in `docs/agent-onboarding.md` and filled in by `lib/prompts/agent-onboarding.js`, in the same style as the runner prompt.
- **The routes:** `routes/getting-started.js` serves `/getting-started.md` for agents and an escaped HTML page at `/getting-started` for people. Both are added to the skip list and the sitemap.
- **The landing block** goes directly under the hero buttons, with a copy button.
- **Elsewhere:** a "Getting started" section at the top of `/llms.txt`, three new size limits with their reasons, and source-map entries.

The plan names three likely ways this breaks, gives ten checks that each fail before the change and pass after, and sets an order for the commits.

The three product questions follow the 2026-11-01 unblock comment's decisions. The work fits in one session. I marked it for plan review because it adds pages to that skip list and serves public instructions that outside agents will act on.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r07/output/`:
- description.md
- comment.md
- tracker-actions.md
- final.md

DONE: Implementation plan for LIN-4085 written to the description with seven scope corrections; plan-review due: yes
