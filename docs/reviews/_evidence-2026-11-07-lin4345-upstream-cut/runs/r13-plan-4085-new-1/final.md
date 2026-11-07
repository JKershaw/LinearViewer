I wrote the plan for LIN-4085 into `output/description.md` as the `## Implementation Plan` section, plus a comment and tracker actions. I made no code changes, and `code/` is clean.

**What the plan decides:**
- **The guide** is `docs/agent-onboarding.md`. It is served by a new `lib/prompts/agent-onboarding.js` (following the runner-prompt pattern) at `/getting-started.md` (markdown) and `/getting-started` (HTML).
- **Filled from source:** the guide's sign-in buttons, free-tier line, Local button label and origin come from the same sources the homepage uses. A small helper replaces the copies of the sign-in checks in `server.js`.
- **The routes** live in their own `routes/getting-started.js` so they can be tested. They are added to the public-path list (`isAuthExemptPath`) as two exact paths, and `/getting-started` goes in the sitemap and the scheduled public-page scan.
- **The homepage block** sits directly under the sign-in buttons. The copy script is a separate file, because the site's security policy blocks inline scripts. The block is left out when the page has no origin, which happens on the page shown after logout.
- **Pointers:** `/llms.txt`, the homepage's comment for AI agents and one README bullet now name `/getting-started.md`.
- **Tests:** each promised behaviour has a test that fails before the change and passes after. These cover width at 320px in both themes, lookalike paths that must not get the public-path treatment, the guide matching the homepage buttons, links that resolve, the missing-origin case, no secrets in either page, and three new size limits in `prompt-size-budget`.
- **Size and review:** it fits one session, and plan review is due because it widens the public-path list.

**Three things in the scope turned out to be wrong:**
- `/api/proxy/instructions` needs the token from the Agent Prompt; it is not public. The guide says so.
- The homepage does load `/common.js` and `/app.js`. What it has none of is inline script.
- The page shown after logout has no origin, so the block has to be left out there.

**One ruling is open:** the human still has to do OAuth sign-in, the OpenRouter key, the runner key and Harbour's Settings page. That cuts "without the user needing to follow those steps" from the request. I recommend accepting it. The build is the same either way: rejecting it means a separate ticket for agent-callable versions, so the plan doesn't wait on the answer.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r13/output/`:
- description.md
- comment.md
- tracker-actions.md
- final.md

DONE: Plan for LIN-4085 written (guide served at /getting-started(.md), homepage agent-prompt block, llms.txt and other pointers, tests for each behaviour); fits one session, plan review due, one cut raised for a ruling (recommend accept)
