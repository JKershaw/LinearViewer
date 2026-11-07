I've scoped LIN-4085. Two parts of the ask can only be delivered partly with today's code, and I need your ruling on them before anyone builds it.

**What the ticket will deliver:**
- A "Get started" box on the public homepage (`/`), just under the sign-in buttons. It holds a two-paragraph prompt with a Copy button that the visitor pastes into their own coding agent.
- A new public page for agents, `/getting-started`, with a plain-text version at `/getting-started.md`. It walks the agent through setting up the user and their project. The agent can either interview the user or look through the repos first. The guide covers choosing a backend (including the free Local workspace, which needs no account), the clicks only a person can do, what to set in Settings, running the first task, and optionally becoming the runner.
- Tests that keep the guide true to the app: every page and backend it names must actually exist.
- A fix to `/llms.txt` so it describes Harbour as it is now and points to the guide.

**What the code showed:**
- harbour.cat has no "getting started" section today. The only one appears on a self-hosted copy that has no sign-in set up. So this adds a new section rather than changing one.
- `/getting-started` doesn't exist yet.
- The ticket treats a symptom of something deeper. The 2026-10-23 onboarding review found zero first runs in 30 days, the best way in not advertised anywhere, and `/llms.txt` (the file agents are told to read) offering no way in. So fixing `llms.txt` is part of this ticket.
- None of the relevant files changed after the ticket was filed.

**The ruling I need.** Two clauses from the ask can only be met in part:
1. *"without the user needing to follow those steps"*. The user won't read the guide; the agent will. But the user still has to do some steps in the browser: sign in, approve the login, connect a backend and an OpenRouter key, switch features on, and create the runner credential. There's no way for an agent to do these today.
2. *"review the repositories and the settings"*. The agent can look through repos directly. Of Harbour's settings, it can only read the backlog and model routing itself; for the rest it has to ask the user.

My recommendation is to accept both as partial, and to file a follow-up ticket for a way agents can change the settings that are safe to hand them. Sign-in and login approval would stay with the person either way.

Not blocking: whether signed-in Home should show the same prompt (I suggest a follow-up ticket), and the final prompt wording (there's a draft in the description; the builder quotes the final text in the PR for you to approve).

The ticket description, comment and tracker changes are written to the files below. The ticket moves to In Progress. The code clone was only read and is unchanged.
- `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r03/output/description.md`
- `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r03/output/comment.md`
- `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r03/output/tracker-actions.md`

DECISION: {"decision_id":"lin4085-partial-delivery-ruling","question":"Two clauses can only be met in part today: the user still does a few browser steps (sign-in, approving the login, connecting a backend and OpenRouter key, switching features on, creating the runner credential), and the agent can only read the backlog and model routing itself, not the other Harbour settings. How should LIN-4085 handle this?","options":[{"id":"accept-partial-followup","label":"Accept both as partial; the guide gives exact clicks for the human-only steps; file a follow-up ticket for an agent settings API"},{"id":"accept-partial-no-followup","label":"Accept both as partial; no follow-up ticket"},{"id":"expand-scope","label":"Expand LIN-4085 to also build an owner-only agent API for changing settings"}],"recommended":"accept-partial-followup"}
BLOCKED: need a ruling on two clauses of the ask that can only be met in part (user still does some browser steps; agent can't read most Harbour settings)
