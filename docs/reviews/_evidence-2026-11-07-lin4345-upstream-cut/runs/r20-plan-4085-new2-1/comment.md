**Plan written (in the description, under `## Implementation Plan`). One ruling is needed before it's built: `lin4085-human-steps`.**

**The plan in brief.** A new guide, `docs/agent-onboarding.md`, is served at `/getting-started.md` (markdown) and `/getting-started` (HTML). All its deployment facts are filled in from code: the origin, the sign-in doors (from one door list the hero also reads), whether the free tier is on, and the settings areas. The landing gets a copyable agent prompt directly below the hero sign-in buttons. `/llms.txt` and `/sitemap.xml` point at the guide, and both new paths join `isAuthExemptPath`. Fits one session. Plan-review is due, because the change widens the auth exemption.

**Corrections to the Scope, checked at HEAD `e1f75fe7`:**
- The landing already loads `/common.js` and `/app.js`. The copy button still goes in its own file, because the CSP blocks inline scripts.
- In `runner-prompt.md`, the design notes sit *above* the `---` and the served body is below it.
- `/api/proxy/instructions` returns 401 without a token, so the guide sends the agent there only after it has one.
- The local-workspace door is `POST /workspace/new`, and only the person can press it in their own browser.
- The Scope missed the auth exemption.

**The ruling: one cut to what was asked.**

> "decide whether to have a conversation with the user or review The repositories and the settings … without the user needing to follow those steps"

The agent can interview the person and read their repositories and tracker setup. Two parts of the ask are not delivered in full:
- The agent can't read Harbour's own settings: no agent-API route exposes them.
- The person still makes the clicks that only they can make today. The agent names each one: OAuth consent at sign-in, "+ local workspace", an AI key when the free tier is off, minting the runner key, and any Settings change.

The Scope inherited this cut ("An agent can't complete OAuth itself"), but no one has agreed to it.

- **`accept`**: build as planned. The agent names each click and reviews the repositories and tracker setup, not Harbour's settings.
- **`accept-followup`** (recommended): the same, plus a follow-up ticket for a read-only Harbour settings summary on the agent API, so a later change lets the agent review the settings itself. OAuth consent can't be delegated in any version, and giving a proxy token access to settings or keys deserves its own design.
- **`widen-read`**: add the read-only settings summary to this ticket. This adds a proxy route and its tests, and probably a second session.

**If no one answers:** nothing is built. Under this plan's rules, an unanswered cut is not agreed. The rest of the plan is the same under every option.
