I've written the LIN-4085 plan into `output/description.md`, under `## Implementation Plan`. It fits one session, and plan-review is not due. No code was changed.

**What it decides:**
- **Guide.** The guide lives in `docs/agent-onboarding.md` and is served by a new `lib/prompts/agent-onboarding.js`, the same way the runner prompt is built. Its placeholders are filled from source: the base URL, the sign-in buttons, whether the free tier is on, and the README link.
- **Routes.** A public `routes/getting-started.js` serves `/getting-started.md` as markdown. The HTML page at `/getting-started` shows the same text, escaped, inside a `<pre>`. Both paths go into the auth exemption and the sitemap.
- **Landing block.** A prompt that is the same for every visitor on a deployment sits directly under the hero sign-in buttons. Only the origin changes it. The copy button is a new `public/landing.js`.
- **One source for the sign-in buttons.** The hero, the "try it" block and the guide all read one button list, and one function works out which buttons a deployment shows. So the guide can't name a button the hero hides.
- **Elsewhere.** `/llms.txt` gets a new entry near the top and its landing testid list is updated. Three new size ceilings are recorded. `source-map.md` and `CLAUDE.md` are updated.
- **Checks.** A test covers every combination of enabled sign-in buttons. An e2e test opens every link in the guide and fails on any that 404s. It also checks the page at 320px, the copy button and the no-JS fallback. A fresh-agent walk is recorded on the PR.

**Where the code differs from the ticket's scope (checked at `e1f75fe7`):**
- **The landing page already loads JS, and its CSP blocks inline scripts.** That's why the copy button has to be a separate file.
- **`/api/proxy/instructions` needs a token.** A cold agent gets a 401, so the guide only points there once the Proxy page's Agent Prompt has handed one over.
- **The "local workspace" door is a POST form on `/swipe`.** The person has to press it in their own browser. If the agent made the workspace with curl, the person's browser couldn't open it (LIN-3065).
- **The logout page renders the landing with no origin.** The plan fixes that, and leaves the block out wherever the origin is still missing.
- **A new public path has to be exempt from auto-login.** Otherwise an agent fetching the guide on a self-host signed in with a Linear token would be given a session.
- **`/llms.txt` describes the landing page in a second place** (line 826), and that line needs the new testid too.

Gaps left to their own tickets: LIN-3108 (the Linear button 503s on an unconfigured self-host), LIN-2387 (no link to the local-workspace door from the landing page) and LIN-3065 (re-entry without a cookie).

`output/comment.md` holds the comment I'd post. `output/tracker-actions.md` records no tracker changes, since the ticket is already In Progress.

Files are in /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r11/output:
- description.md
- comment.md
- tracker-actions.md
- final.md

DONE: Implementation plan for LIN-4085 written to the description (fits one session, plan-review due: no), with six corrections to the Scope found in the code at HEAD
