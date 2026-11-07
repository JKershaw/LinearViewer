**Plan written** (pass 1, HEAD `e1f75fe7`). It is in the description under `## Implementation Plan`.

- **Cuts to As asked: none.** Two clauses come close: "without the user needing to follow those steps" and "full guide … whatever your situation". The plan explains why each is delivered in full. The person still makes the consent and secret presses (OAuth, their own key, the runner mint), but only when the agent asks. Self-hosting goes to the README, which is the maintained full guide.
- **Five corrections to the Scope at HEAD:**
  1. The landing does load JS (`/common.js`, `/app.js`). The copy button still gets its own `public/landing.js`, because of the hash-based CSP and app.js's proxy-append copy path.
  2. The runner-prompt pattern puts the design notes *above* the first `---` and the served body below it, not the other way round.
  3. `/getting-started` must join `isAuthExemptPath` (LIN-3346). Without that, PAT auto-login would sign in anyone who opens the guide on a self-host.
  4. `/api/proxy/instructions` needs a token.
  5. The local door is a POST that the person, not the agent, has to press.
- **Main decisions:**
  - A source-filled guide at `docs/agent-onboarding.md`, built by `lib/prompts/agent-onboarding.js`. Doors, local-door label, free tier, Settings areas and the README URL all come from code.
  - `/getting-started` gives the person every door, under the exact labels the guide quotes. A test ties the two together.
  - The landing block appears only when the origin is known.
  - The guide's origin uses the Library's `safeHost` rule, and the guide is not publicly cached.
  - Three new prompt-size ceilings, each with its LIN-4085 reason.
- Session fit: one session. plan-review due: yes. The change adds a public route serving text agents act on, widens an auth-middleware exemption, and raises the frozen prompt budget.
