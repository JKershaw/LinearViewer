I've scoped LIN-4085. The new scope section is in `output/description.md`, the comment in `output/comment.md`, and the move to In Progress in `output/tracker-actions.md`. It can't go to build until you rule on two cuts to what was asked.

**What it will deliver:**
- **Homepage:** a "get started" section on the public homepage (`/`), placed just before "try it yourself". It holds a two-paragraph prompt the visitor copies to their agent, with a Copy button that works on a phone.
- **Guide:** a new public guide at `/getting-started`, plus a plain-text version at `/getting-started.md` for agents to read. The agent uses it to work out the user's setup and pick the right sign-in option. It then walks the user through the copy-a-prompt path, an optional runner, an optional Workspace API key, and a review of their settings.
- **Per deployment:** the prompt's link and the guide's sign-in options come from the site serving them. On harbour.cat the link is exactly `harbour.cat/getting-started`, and a self-hosted copy points at itself.
- **Public and findable:** both guide addresses open without signing in and are added to the sitemap, `llms.txt` and the public-pages secret scan.
- **Kept honest:** a test fails if the guide names a route or settings page that doesn't exist.

**What the code shows, against the ticket:**
- The homepage has no "getting started" section today. The only box with that heading is a localhost-only `.env` banner, so this is a new section.
- `/getting-started` doesn't exist yet.
- Onboarding steps are browser-only. Signing in, minting the runner key, minting a Workspace API key and most settings have to be done by the person. Once it has a key, an agent can change issues and model routing, nothing else in Settings.
- None of the code the ticket relies on has changed since it was filed.

**Decision for you:** two parts of the ask can't be delivered as written.
1. *"without the user needing to follow those steps"*: the person still clicks through sign-in, key minting and most settings, with the agent telling them exactly what to do.
2. *"review ... the settings"*: the agent can only read settings after the person gives it a Workspace API key, and only what that API exposes.

I recommend accepting both, with the guide handing those steps to the person, and filing agent-editable settings as a separate ticket if you want it. Letting keys change settings is a security change that deserves its own design. Where the section sits and whether the signed-in Home also shows the prompt are smaller questions, left for review.

DECISION: {"decision_id": "lin-4085-agent-onboarding-cuts", "question": "LIN-4085: an agent can't sign in, mint keys or change most Settings, so the person still does those steps in the browser, and the agent can only read settings after it is given a Workspace API key. Accept these limits, or widen this ticket to add agent-editable settings?", "options": [{"id": "accept-with-followup", "label": "Accept: the guide hands browser steps to the person with exact instructions; file agent-editable settings as a separate ticket"}, {"id": "accept-no-followup", "label": "Accept, with no follow-up ticket"}, {"id": "widen", "label": "Widen this ticket: add Workspace API endpoints for sources, dispatch defaults and presets, and features"}], "recommended": "accept-with-followup"}
BLOCKED: need a ruling on two cuts to the ask (the person still does the browser steps; the agent can only read settings once it has an API key) before this goes to build
