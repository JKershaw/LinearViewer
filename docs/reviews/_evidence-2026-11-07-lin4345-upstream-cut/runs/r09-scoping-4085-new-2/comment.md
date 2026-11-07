**Scoping done. One ruling is needed before the build starts.**

The scope is in the description under **Scope (scoping stage, 2026-11-07)**. In short:

- **Homepage:** a new "get started" section on the public `/`, placed just before "try it yourself". It holds a two-paragraph prompt with a Copy button that works on a phone.
- **The guide:** a new public guide at `/getting-started`, plus `/getting-started.md` for agents. It is rendered per deployment, so on harbour.cat it is exactly `harbour.cat/getting-started`, and it lists only the sign-in options that deployment has switched on.
- **Wiring and tests:** the guide is added to the no-sign-in list, the sitemap, `llms.txt` and the public-pages secret scan. A test fails if the guide names a route or settings page that does not exist.

**What the code showed:**

- The homepage has no "getting started" section today. The only box with that heading is a localhost-only `.env` banner. So this ticket adds a new section rather than editing one.
- `/getting-started` does not exist yet.
- Every onboarding step is done by the user in a browser: signing in, minting the runner credential, minting a Workspace API key, and most settings. Once it has a key, an agent can read and change issues and model routing, but nothing else in Settings.

**Ruling needed. Two parts of the ask can't be delivered as written:**

1. *"...without the user needing to follow those steps..."*: the agent guides each step, but the user still clicks through sign-in, credential minting and most settings in the browser.
2. *"...review The repositories and the settings"*: the agent can review the repositories. It can read settings only after the user gives it a Workspace API key, and only the parts the API exposes.

Options: **accept** these limits, so the guide hands the browser steps to the user with exact instructions (recommended, with agent-editable settings as a separate ticket), or **widen** this ticket to add Workspace API endpoints for sources, dispatch defaults and presets, and features. I recommend accepting: letting keys change settings is a security change (grants, audit log, undo) that deserves its own design.

Two smaller questions are in the description: where the section sits on the page, and whether the signed-in Home also shows the prompt. Both have a recommendation and can be settled at review.
