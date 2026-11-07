I've scoped LIN-4085 and written the new description section, a summary comment and one tracker action (status Backlog → In Progress) to the output files. Nothing in `code/` was changed.

**What the code shows (checked at `e1f75fe7`):**
- **No existing section.** The live signed-out homepage (`lib/render-landing.js`) has no "getting started" section. The only one appears on localhost when no auth is configured. This feature adds a new section rather than changing one.
- **Not the page the feedback came from.** Signed-in users are redirected away from `/`, so the workspace page the feedback was filed from was not the target.
- **The guide URL is free.** No route uses `/getting-started` yet.
- **An agent can't sign the person in.** Every way in is a browser step: OAuth, an emailed link, or the local-workspace form. So the guide has to be a handoff: the person signs in and creates a workspace token at `/workspace/:urlKey/proxy`, then the agent does the rest through the proxy API.
- **No staleness.** The ticket names no files, and none of the related paths changed after it was filed.

**Is it a symptom of something deeper?** Partly. The 2026-10-23 onboarding review found:
- a working way in that the product doesn't point anyone to;
- `/llms.txt` naming no way in;
- 0 first Go presses in 30 days.

Most of the value is in the guide being accurate, not in the homepage box, so the guide is scoped as the main deliverable.

**In scope:**
- A "Get started with your agent" section under the hero, with a copyable prompt (draft text is in the description). The prompt links to the serving instance's own `/getting-started`, so a self-hosted copy doesn't point at production.
- A public `/getting-started` guide for agents, served as HTML and `.md` from one source. The sign-in options and free-tier wording follow what the deployment actually has switched on.
- Entries for the guide in `llms.txt`, the sitemap and the public-page secret scan.
- Tests, including one that checks every path the guide names is a real route.
- One real run by an agent, recorded in the PR, as evidence that CI can't give.

**Out of scope:** a new way for an agent to sign the person in, a personalised prompt, new settings APIs, onboarding on the signed-in workspace Home, and the stale self-host prompt on the preview pages.

**Questions for you (none block):**
- **Placement:** I've put the section under the hero with the sign-in buttons kept primary. The alternative is to make the prompt the headline path inside the hero.
- **Hosted first:** the guide steers to the hosted site and only links the README for self-hosting. Please confirm that's the intent.
- **Follow-ups:** say if you want tickets filed for the agent sign-in handoff and for replacing the stale self-host prompt.

Files are in `/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-8ea683d1-4c97-4ead-b1aa-948e93e652a3/8ea683d1-4c97-4ead-b1aa-948e93e652a3/scratchpad/runs/r05/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md`
- `final.md`

DONE: LIN-4085 scoped: a copyable agent prompt on the signed-out homepage plus a tested, deployment-aware public /getting-started guide for agents; three product questions left open, none blocking.
