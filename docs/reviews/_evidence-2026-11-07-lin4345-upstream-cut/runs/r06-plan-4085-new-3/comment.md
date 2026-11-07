**Plan written:** `## Implementation Plan` is in the description. It can be built in a single pass, and plan-review is due.

**The shape:**
- A public guide at `/getting-started` and `/getting-started.md`, built from `docs/agent-onboarding.md` the way the runner prompt is built. The origin, the enabled sign-in doors and the free tier are filled from code.
- A "getting started / Or hand this to your coding agent" block directly under the hero sign-in buttons, with a copy button.
- An entry for the guide at the top of `/llms.txt`.

**What I found at HEAD `e1f75fe7` that the scope had wrong or left open:**
- **The landing already loads JS** (`/common.js` and `/app.js`), so the scope's "the landing ships no JS" is wrong. The real limit is that the app's CSP runs only hashed inline scripts. So the copy button is a new external `public/landing.js`.
- **`/api/proxy/instructions` needs a token.** The guide sends the agent there only once it holds one.
- **There is no dispatch switch to turn on any more.** LIN-3849 removed it, so the guide won't mention one.
- **New public page paths go in the single exemption list,** `isAuthExemptPath`, so PAT mode doesn't sign in someone who's only reading. The look-alike paths are tested and stay outside that list.
- **One door list.** A new `lib/sign-in-doors.js` holds the list of sign-in doors. The hero buttons and the guide both read it, so they can't disagree.
- **The ask said "settings"** ("review the repositories and the settings"). I added a "configure for their situation" section to the guide: once connected, the agent reviews the workspace, its north star and its model routing, and names any Settings-page changes for the human.

**Ruling: one inherited cut to the As asked block.** It doesn't block the build.

The ask ends: *"…a full guide on how to properly configure Harper for whatever your situation is without the user needing to follow those steps as the use uses the agent having naturally would."* The scope's Out of Scope leaves out new agent-callable endpoints for the steps only a human can do today. So the user still does three things by hand:
- the OAuth consent;
- entering an OpenRouter key, when the free tier isn't enough;
- pressing the runner mint.

OAuth consent can't be handed to an agent under any design. The other two are the real cut.

**My recommendation: accept the cut here.** Giving an agent the power to set the OpenRouter key or mint the owner's runner credential is a security design change that deserves its own ticket. If you'd rather not cut it, I'll file that follow-up, blocked-by this ticket. This build doesn't change either way.

**Prominence** (ruling `lin4085-prominence`): the plan goes ahead with the hero position, which the earlier unblock comment recommended.
