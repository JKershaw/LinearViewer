**Plan written** into the description under `## Implementation Plan`. It fits one session, and plan-review is not due.

**The plan:**
- **Guide.** `docs/agent-onboarding.md` is served at HEAD by `lib/prompts/agent-onboarding.js`, following the `runner-kickoff.js` pattern. Every placeholder is filled from source.
- **Routes.** A public router serves `/getting-started.md` and `/getting-started`, with Library-style CSP and safeHost. The paths are added to the auth exemption and the sitemap.
- **Landing block.** A static-per-deployment prompt sits directly under the hero CTAs, with copy handled by a new `public/landing.js`.
- **`/llms.txt`.** The entry goes near the top, and the landing testid list is updated.
- **Size ceilings.** Three new ones, with the reason recorded.
- **Tests.** A combination test keeps the guide's doors identical to the hero's. An e2e link walk fails on any route the guide names that doesn't exist.

The plan takes all three decisions from the unblock comment: hero placement, ask first, and no separate copy sign-off.

**What re-grounding at `e1f75fe7` changed in the Scope:**
- **The landing already loads JS, and the CSP blocks inline scripts.** So the copy button goes in a new static file, not an inline script.
- **`/api/proxy/instructions` needs a token** and returns 401 to a cold agent. The guide names it only for after the Agent Prompt has handed over a token.
- **The Local door is a POST form on `/swipe`.** The guide has the person press it in their own browser. An agent creating the workspace with curl would make one the person's browser can't open (LIN-3065).
- **The logout render passes no origin.** It is fixed at the cause (`res.req`). Wherever the origin is still null, the block is left out.
- **A public path must be in `isAuthExemptPath`.** Otherwise PAT auto-login would mint a session for an agent fetching the guide.
- **`/llms.txt` describes the landing in a second place** (`:826`), and that line is updated too.

Known gaps left to their own tickets: LIN-3108 (Linear CTA 503 on an unconfigured self-host), LIN-2387 (no link to the Local door from the landing page) and LIN-3065 (no-cookie re-entry).
