I wrote the plan for LIN-4085, but building is waiting on one ruling: the plan doesn't fully deliver one part of the ask.

**The ruling (`lin4085-cut-human-clicks`).** The ask says the user shouldn't have to follow the setup steps. With this plan the agent sequences everything, but the human still makes a few clicks:
- sign in, or create a local workspace;
- press generate & copy on the Proxy page to give the agent its token;
- add an OpenRouter key, only when the server has no free tier;
- copy the runner prompt, only if they want work run on their machine.

The agent can't make these itself. OAuth sign-in needs the person's own browser, and the other three are owner-only credential mints by design. Letting an agent do them is a security change that needs its own design. I recommend accepting the cut.

**What the plan decides**
- **Guide:** one guide (`docs/agent-onboarding.md`), served as `/getting-started.md` for the agent and `/getting-started` for the person. The HTML page also holds every click only the person can make: the sign-in buttons and the "Create a local workspace" form.
- **Homepage:** the prompt block goes directly under the sign-in buttons. Its copy button is a separate script file, because the site's security policy blocks inline scripts.
- **Pointers:** `/llms.txt`, the homepage's HTML comment and the README's "For AI Agents" section each point at the guide.
- **Self-hosting:** the guide gets a path the agent can carry out itself, which closes the scope's "pointer only" gap rather than keeping it.

**Three scope facts were wrong at HEAD `e1f75fe7`**
- The homepage does load JavaScript (`lib/render-landing.js:483`).
- `/api/proxy/instructions` needs a token, so it can't be the agent's first read.
- The local-workspace door is a browser form, so the person has to press it; an agent calling it would create a workspace the person never sees.

The plan fits one session. It is due a plan review because it widens the list of paths that skip sign-in handling and raises the frozen prompt-size total. I left the repo clone unchanged.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r21/output/`:
- `description.md` (the plan)
- `comment.md`
- `tracker-actions.md`

DECISION: {"decision_id":"lin4085-cut-human-clicks","question":"LIN-4085 asks that the user not follow the setup steps. With this plan the agent sequences everything, but the person still makes a few clicks: sign in (or create a local workspace), generate & copy the Proxy token, add an OpenRouter key only when there's no free tier, and copy the runner prompt only if they want work run on their machine. Accept that cut?","options":[{"id":"accept","label":"Accept: the person makes only those clicks, guided by the agent; build the plan as written"},{"id":"accept_followup","label":"Accept here, and file a follow-up ticket to let an agent mint the workspace token or set the OpenRouter key itself"},{"id":"no_cut","label":"Don't cut: extend LIN-4085 to agent-callable credential steps (a security change; needs its own design)"}],"recommended":"accept"}
BLOCKED: LIN-4085's plan is written. Building waits on ruling lin4085-cut-human-clicks: does the person accept making the sign-in, token and key clicks themselves, guided by the agent?
