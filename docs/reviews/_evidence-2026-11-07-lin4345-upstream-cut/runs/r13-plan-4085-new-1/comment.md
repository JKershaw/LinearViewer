**Plan written** (`## Implementation Plan` in the description, at HEAD `e1f75fe7`). It fits one session. Plan review is due because it widens the auth-exemption predicate (`isAuthExemptPath`) with two exact paths and adds an unauthenticated route.

**What it builds:**
- `docs/agent-onboarding.md`, served by a new `lib/prompts/agent-onboarding.js` (the runner-prompt pattern) at `/getting-started.md` (markdown) and `/getting-started` (HTML, with the existing *Create a local workspace* button);
- the agent-prompt block under the hero CTAs, with a copy script in its own file because the app CSP blocks inline scripts;
- pointers in `/llms.txt`, the landing's agent HTML comment, README "For AI Agents", the sitemap and the public-page scan list.

The guide's sign-in doors, the free-tier line and the Local button label are filled from the same sources the hero uses. A small helper ends the inline door-flag copies in `server.js`.

**Corrections to the scope, checked at HEAD:**
- `/api/proxy/instructions` is token-gated (`routes/proxy.js:1341`), not public, so the guide says it needs the token from the Agent Prompt.
- The landing does load `/common.js` and `/app.js`. What it lacks is inline script, which the CSP forbids.
- The logout render has no origin, so the block is left out there rather than printing a relative URL.

**Ruling needed: one cut to the As asked block (inherited from the scope).**
> "…without the user needing to follow those steps"

The human still does OAuth sign-in, connects the OpenRouter key, mints the owner runner key and changes Harbour Settings. These need the human's consent or browser session, and adding agent-callable endpoints for them is out of scope. The guide puts those clicks in order and names the exact buttons.
**Recommendation: accept.** If you reject it, the answer is a separate ticket (with a security review) for agent-callable versions. This build doesn't change either way, so the plan doesn't wait on the answer.
