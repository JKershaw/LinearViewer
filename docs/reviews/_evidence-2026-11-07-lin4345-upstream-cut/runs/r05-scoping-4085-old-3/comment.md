Scoping done. The scope is now in the description. Short version:

- **Where it goes:** the signed-out landing at `/` (harbour.cat). There's no "getting started" section there today: the only one is the localhost-only setup notice. Signed-in users never see `/`, so the page the feedback was filed from wasn't the target.
- **What ships:**
  - a "Get started with your agent" section under the hero, with a copyable prompt that names this instance's `/getting-started` URL;
  - a public `/getting-started` guide written for agents, as HTML and `.md` from one source, with the sign-in options and free-tier wording matched to the deployment;
  - `llms.txt` and sitemap entries for the guide;
  - drift tests, including one that every path the guide names is a real route.
- **Hard limit found in code:** an agent can't sign the person in. Every way in is a browser step (OAuth, magic link, or the local-workspace form). So the guide is a handoff: the person signs in and mints a workspace token, and the agent does the rest over the proxy API.
- **Deeper point:** the 10-23 onboarding review found a working path in that the product doesn't advertise, `llms.txt` naming no way in, and 0 first Go presses in 30 days. Most of the value is in the guide being accurate, not in the homepage box, so the guide is scoped as the main deliverable.
- **Out:** a new agent-auth handoff (device-code style), a personalised prompt, new settings APIs, workspace Home onboarding, and the stale self-host prompt on the previews (possible follow-up).

Three product questions are left in the description: prominence, hosted-first, and which follow-ups to file. None of them blocks; the defaults stand unless overruled.
