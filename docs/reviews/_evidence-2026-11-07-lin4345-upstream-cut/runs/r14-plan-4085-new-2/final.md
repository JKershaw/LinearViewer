I wrote the LIN-4085 plan to the ticket description. It is one session's work and goes to plan review first, because it widens which paths skip sign-in and adds to the frozen prompt-size total. Nothing in `code/` was changed.

**What the plan builds**
- **The guide:** `docs/agent-onboarding.md`, served by `lib/prompts/agent-onboarding.js` in the same way as the runner prompt. The base URL, the sign-in options this deployment has turned on, and the free-tier setting are all filled in from the code.
- **Two public pages:** `/getting-started.md` (plain markdown, for agents) and `/getting-started` (HTML, using the Library's safe markdown renderer). Neither needs sign-in, and both are in `sitemap.xml`.
- **The homepage block:** sits directly under the sign-in buttons, with a copy button run by a new script file. The block is left out whenever the page has no origin to put in the prompt.
- **Pointers for agents:** `/llms.txt` and the homepage's comment for agents both name `/getting-started.md`.
- **One list of sign-in options:** the guide and the homepage buttons read the same list, so they can't drift.
- **Tests:** new size ceilings, plus a test that requests every URL the guide names and fails on a 404.

**Where the existing scope is wrong about the code**
- The homepage does load JavaScript. The real limit is the security policy, which blocks inline scripts, so the copy button needs its own script file.
- In the runner prompt the served text comes after the design notes, not before them as the scope says.
- `/api/proxy/instructions` needs a token, so the guide sends agents there only after sign-in.
- A local workspace only exists in the browser that created it, so the human has to press `+ local workspace` on `/swipe`. The agent can't create one and hand it over.
- After a logout, the homepage is drawn without the site address. The plan passes it in there.

**Decision needed:** the scope drops part of what was asked in two places, and the plan adds no more. Both need someone to accept them before they count as agreed. I recommend accepting both and have raised them as one question in the comment:
1. The human still signs in, connects an OpenRouter key when the free tier is off, and creates the runner key on the runner page. Letting an agent do these would be a security change for a separate ticket.
2. People running their own copy of Harbour get a pointer to the README, not a full walkthrough.

I also noticed that the summary line at the top of `/llms.txt` still describes Harbour as a "collapsible tree" viewer. The scope keeps it out of this ticket, so it needs its own follow-up.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r14/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md`
- `final.md`

DONE: LIN-4085 plan written (guide plus two public pages, homepage prompt block, llms.txt pointer, tests); fits one session; plan review due; the two scope cuts are raised as one question in the comment
