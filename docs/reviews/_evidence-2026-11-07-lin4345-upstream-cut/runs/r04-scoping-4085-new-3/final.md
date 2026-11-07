I've scoped LIN-4085. It's blocked on one ruling: whether you agree a partial cut to the ask.

**What the code shows** (checked at HEAD `e1f75fe7`; no landing-related files have changed since the ticket was filed):
- **No "getting started" section:** the homepage (`lib/render-landing.js`) has no section like an npm-install block. The only block with that name is the `.env` notice for self-hosters, shown on localhost.
- **No guide page:** nothing serves `/getting-started`.
- **Out-of-date `llms.txt`:** its first line still calls Harbour a tree viewer.
- **The pattern already exists:** prompts you copy to your agent are already used on the runner page and the Home copy-first flow.
- **Some steps need the person:** signing in, connecting OpenRouter, changing workspace settings, and minting a runner key or proxy token only work in a browser session, and only for an owner. With a token the agent can read and write the backlog and model routing, but no API exposes workspace settings.

**This is a symptom of something deeper.** Harbour has no single written onboarding path, for agents or for people. So the core of the work is a public guide at `/getting-started.md` (for agents) and `/getting-started` (HTML). The homepage prompt is just the way in.

**In scope:**
- **The guide:** one markdown source. Facts that vary by deployment (which sign-ins are offered, whether the free tier is on, the origin) are filled in from code. A test fails if the guide names a path no route serves.
- **The homepage section:** a new section after "the loop" holding the prompt and a Copy button that works at phone width. The prompt is the same for every visitor, and its link is built from the request origin, so self-hosted instances point at their own guide.
- **`llms.txt`:** fix the out-of-date line and point it at the guide.
- **Plumbing and tests:** add the page to the sitemap and the public-page secret scan, plus unit and Playwright tests.

**The cut needing a ruling:** "without the user needing to follow those steps as the use uses the agent having naturally would" and "review The repositories and the settings". The person still has to click the sign-in and credential steps themselves; the agent tells them exactly what to click. The agent learns workspace settings by asking, because it can't read them. I recommend agreeing the cut and filing a follow-up for an approval flow the agent starts and the person approves once in the browser, like a device-code login. That would change the credential model, so it needs its own design.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r04/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (status Backlog -> In Progress)
- `final.md`

`code/` is unchanged.

DECISION: {"decision_id":"lin-4085-agent-onboarding-cut","question":"LIN-4085 cut: the person still clicks the browser-only consent and credential steps (sign in, connect OpenRouter or the free tier, install the GitHub App, mint a runner key or proxy token) while the agent tells them exactly what to do, and the agent learns workspace settings by asking. Agree?","options":[{"id":"agree-followup","label":"Agree the cut and file a follow-up for an approval flow the agent starts and the person approves once (device-code style)"},{"id":"agree","label":"Agree the cut, no follow-up"},{"id":"expand","label":"Don't cut: widen this ticket so an agent can get credentials and read settings itself (changes the security model)"}],"recommended":"agree-followup"}
BLOCKED: Need a ruling on the one cut to the ask (the person still does the browser-only consent and credential steps; the agent can't read workspace settings) before the scope is final.
