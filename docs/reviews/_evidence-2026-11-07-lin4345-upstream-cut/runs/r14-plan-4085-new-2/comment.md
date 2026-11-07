**Plan written.** It is in the description under `## Implementation Plan`. It fits one session, and plan review is due (it widens `isAuthExemptPath` and adds new ceilings to the frozen prompt-size total).

**The shape.** The guide is `docs/agent-onboarding.md`, served at HEAD by `lib/prompts/agent-onboarding.js`, the same pattern as the runner prompt. It is public at `/getting-started.md` (markdown) and `/getting-started` (HTML through the Library's safe renderer). It is exempt from auth and listed in the sitemap. Directly under the hero buttons, a new block holds the agent prompt, with a copy button driven by a new external script. `/llms.txt` and the landing's HTML comment both point at the guide. The guide's sign-in doors come from the same data as the hero buttons, so the two cannot drift. An e2e test requests every URL the guide names and fails on a 404, which guards against the guide inventing paths.

**Where the scope's re-grounding is wrong at HEAD.** The plan follows the code on each:
- The landing does load JS (`/common.js`, `/app.js`, `lib/render-landing.js:483`). The constraint is the CSP, which allows no inline script (`lib/security-headers.js`), so the copy script is a new file under `public/`.
- In `runner-prompt.md` the served body comes *after* the first `---`, not before it.
- `/api/proxy/instructions` needs a proxy token, so the guide treats it as a step after sign-in, not a cold link.
- A local workspace lives only in the browser that created it (LIN-3065). Path (a) is therefore "the human opens `/swipe` and presses `+ local workspace`", not something the agent creates for them.
- The logout render passes no origin. The plan passes `requestOriginOrNull(res.req)` there, and leaves the block out whenever the origin is null.

**Ruling needed: cuts to the As asked block.** Both come from the Scope; the plan adds none. Until someone answers, these cuts don't count as agreed.
1. *"without the user needing to follow those steps"*: the human still does the OAuth sign-in, connects an OpenRouter key when the free tier is off, and presses mint on the runner page. The guide puts these in order but doesn't remove them. Removing them would take agent-held OAuth or credential-minting endpoints, which is a security change for its own ticket. **Recommend: accept.**
2. *"configure Harbour for whatever your situation is"*: self-hosters get a README pointer, not a walkthrough. **Recommend: accept.** Hosted Harbour is where cold visitors arrive, and the README already covers self-hosting.

Noticed but out of this ticket's scope: the summary line at the top of `/llms.txt` still describes Harbour as a "collapsible tree" viewer (cold-start review D1). The new getting-started section goes directly under it.
