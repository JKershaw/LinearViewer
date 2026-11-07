**Scoping (stage: scope).** **Your ruling is needed** on two partial deliveries before this is built. The full scope is in the description.

**What it delivers:** a "Get started" box under the sign-in buttons on the public homepage (`/`). It holds a two-paragraph prompt with a Copy button, for the visitor to paste into their coding agent. The prompt links to a new public page for agents, `/getting-started` (with `/getting-started.md` for the raw text). That page walks the agent through setting up the user and their project. `/llms.txt` also gets fixed so it points there.

**What the code changed about the ticket's premise:**
- harbour.cat has **no** getting-started section today. The only "┌─ Getting started" box in `lib/render-landing.js` appears on an unconfigured localhost. So this adds a section rather than changing one.
- `/getting-started` does not exist yet.
- **This is a symptom of something deeper.** The 2026-10-23 onboarding review recorded 0 first Go presses in 30 days (R3-17). It also found that the best cold path is unadvertised and that `/llms.txt` "names no way in" (R3-6). The real gap is that agents have no way in, so the `llms.txt` fix is part of this ticket.

**Ruling needed: two partial deliveries.** Neither is agreed until you answer.
1. *"without the user needing to follow those steps"*: the user doesn't read the guide; the agent does. But the person must still click through sign-in and OAuth consent, connect backends and OpenRouter, set feature flags and mint the runner credential. There is no agent API for these.
2. *"review the repositories **and the settings**"*: the agent reviews repos directly. It can read Harbour settings itself only where a Workspace API token reaches (the backlog and model routing). The rest it reviews by asking the person.

**Recommendation:** accept both as partial, and file a follow-up for an owner-scoped agent Settings API. Sign-in and consent always stay with the person.

**Also open, not blocking:**
- whether signed-in Home gets the same prompt (recommended as a follow-up);
- the final prompt wording (a draft is in the description; it will be approved in the PR).
