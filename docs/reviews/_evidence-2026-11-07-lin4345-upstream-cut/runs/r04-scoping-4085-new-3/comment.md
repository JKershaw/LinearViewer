Scoping done. The full scope is now in the description.

**What the code shows.** The homepage has no "getting started" section like an npm-install block. The only block with that name is the `.env` notice for self-hosters, shown on localhost. `/getting-started` does not exist either. So this ticket adds two things: a new landing section holding a copyable agent prompt, and a new public guide served at `/getting-started.md` (for agents) and `/getting-started` (HTML). The guide is the core of the ticket. Harbour has no single written onboarding path today: the steps are spread across the Try section, Settings, the runner page, the Proxy page, the README and an out-of-date `llms.txt`. The homepage prompt is just the way in. The guide's deployment facts (which sign-ins are offered, whether the free tier is on, the origin) come from code, and a test checks every path it names.

**Settled from triage:**
- **Prompt text:** the prompt is the same for every visitor, since they are signed out. All tailoring to their situation happens in the guide.
- **Link:** built from the request origin, so it is harbour.cat on harbour.cat and the instance's own guide on a self-hosted deployment.
- **Copy:** works at phone width.
- **Prompt wording:** a draft is in the description. The final text gets reviewed in the PR.

**One ruling needed: a cut to the ask.** Two quoted parts are delivered only partly:
> "without the user needing to follow those steps as the use uses the agent having naturally would"
> "review The repositories and the settings"

Some steps can only happen in a browser session and need an owner: signing in, connecting OpenRouter or the free tier, installing the GitHub App, and minting a runner key or proxy token. The agent can tell the person exactly what to click, but cannot do these for them. No API exposes workspace settings, so the agent learns those by asking.

**Recommendation:** agree the cut, and file a follow-up to explore an agent-started approval flow, something like a device-code login. That changes the credential model and needs its own design.

Until this is answered, the cut is not agreed.
