The plan for LIN-4085 is written, but it can't go to the builder until you rule on one cut to what was asked. No code was changed.

**The plan in brief:**
- **New guide:** `docs/agent-onboarding.md`, built by a new `lib/prompts/agent-onboarding.js` and served at `/getting-started.md` (markdown) and `/getting-started` (HTML). Every deployment fact in it is filled in from code: the origin, the sign-in doors, whether the free tier is on, and the settings areas.
- **Sign-in doors:** they come from one door list that the hero buttons also read, so the guide can't offer a door the homepage hides.
- **Homepage:** a copyable agent prompt goes directly below the hero sign-in buttons. The copy button lives in its own small script file, because the page's security policy blocks inline scripts.
- **Discovery:** `/llms.txt` and `/sitemap.xml` point at the guide.
- **Auth exemption:** both new paths join `isAuthExemptPath`, so a signed-out agent fetching the guide never gets a session. The ticket's scope missed this.
- **Tests:** placeholder and link checks, a check that no secret appears, size ceilings for the new prompt text, and phone-width, dark-mode and copy-button tests in the browser suite.
- **Size and review:** it fits one session. Plan review is due, because the change widens an auth guard.

**Corrections to the ticket's scope, checked against the code:**
- The homepage already loads JavaScript (`/common.js` and `/app.js`).
- In the runner-prompt pattern it copies, the design notes sit above the `---` and the served text below it, not the other way round.
- `/api/proxy/instructions` returns 401 without a token, so the guide only sends the agent there once it has one.
- Only the person can create a local workspace (the "+ local workspace" button), in their own browser.

**The cut that needs your ruling:**
- **Settings:** the agent can't read Harbour's own settings, because no agent-API route exposes them.
- **Human clicks:** the person still makes a few clicks the agent names: OAuth consent at sign-in, creating a local workspace, an AI key when the free tier is off, minting the runner key, and any Settings change.

I recommend accepting it and filing a follow-up for a read-only settings summary on the agent API. The rest of the plan is the same whichever option you pick.

Output files:
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r20/output/description.md
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r20/output/comment.md
- /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-c3af4bd4-ec60-4732-ac0c-c8637b85f104/c3af4bd4-ec60-4732-ac0c-c8637b85f104/scratchpad/runs/r20/output/tracker-actions.md

DECISION: {"decision_id": "lin4085-human-steps", "question": "The ask says the agent reviews 'the repositories and the settings' and the user needn't 'follow those steps'. The agent can't read Harbour's settings today, and the person still makes the clicks the agent names (OAuth consent, + local workspace, AI key without free tier, runner key, Settings changes). Accept this cut?", "options": [{"id": "accept", "label": "Accept: build as planned, the agent names each click and reviews the repos and tracker, not Harbour settings"}, {"id": "accept-followup", "label": "Accept, and file a follow-up for a read-only Harbour settings summary on the agent API"}, {"id": "widen-read", "label": "Widen: add a read-only settings summary to the agent API in this ticket (more work, likely two sessions)"}], "recommended": "accept-followup"}
BLOCKED: need a ruling on lin4085-human-steps (accept the human-click/settings-read cut to the As asked block) before the plan is built
