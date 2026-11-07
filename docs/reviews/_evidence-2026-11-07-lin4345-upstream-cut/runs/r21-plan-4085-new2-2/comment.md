**The plan is written** under `## Implementation Plan`. One ruling is open: it cuts part of the ask.

**What the plan decides**
- **Guide:** one guide (`docs/agent-onboarding.md`), served two ways:
  - `/getting-started.md` for the agent;
  - `/getting-started` for the human. This page also holds every click only a human can make: the sign-in buttons and the "Create a local workspace" form.
- **Landing:** the prompt block goes directly under the hero sign-in buttons. Its copy button is an external script, because the landing CSP blocks inline JS.
- **Pointers:** `/llms.txt`, the landing's HTML comment and README "For AI Agents" each point at the guide.
- **Self-hosting:** the guide gets a path the agent can carry out itself (clone, `.env`, `npm start`, local door, README for OAuth). This closes the scope's "pointer only" cut instead of keeping it.

**Three of the scope's facts were wrong at HEAD, and the plan follows the code:**
- The landing does load JS (`render-landing.js:483`).
- `/api/proxy/instructions` needs a token.
- The local-workspace door is a browser form POST, so it's a human click, not something the agent can do.

**The ruling: `lin4085-cut-human-clicks`.** The ask says the user shouldn't have to follow the setup steps. With this plan, the agent sequences everything, but the human still makes a few clicks:
- sign in, or create the local workspace;
- generate & copy the Proxy token;
- add an OpenRouter key, only when there's no free tier;
- copy the runner prompt, only if they want runs on their machine.

OAuth consent can't be delegated, and the other three are owner-only credential mints. Making them agent-callable is a security change that needs its own design.

- **Recommendation:** accept.
- **If unanswered:** the cut is not agreed and implementation waits.
- **If accepted:** build starts from the plan as written.

plan-review due: yes. The plan widens the auth-exemption predicate and raises the frozen prompt-size total.
