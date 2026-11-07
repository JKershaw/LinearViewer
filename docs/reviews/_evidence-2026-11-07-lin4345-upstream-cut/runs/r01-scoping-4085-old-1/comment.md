Scoped. The description now has the full scope. In short:

- **What gets built:** a new homepage section directly under the hero with a copy-paste prompt for the visitor's own agent, and a new public guide written for agents, at `/getting-started` (HTML) and `/getting-started.md` (raw Markdown), both from one source file. `/llms.txt`, the sitemap and the public-page scan will point to the guide, and a drift test keeps what the guide says about routes and requirements true.
- **Re-grounded at `e1f75fe7`:** the homepage has no "getting started" section today (the ticket assumed one), and `/getting-started` returns 404. Nothing relevant has changed since the ticket was filed.
- **The deeper problem:** the 2026-10-23 onboarding review found the way into Harbour isn't written down anywhere. "Try it yourself" has no control, `/llms.txt` names no way in, and `/kpis` showed 0 first Go presses in 30 days. This ticket makes the guide the one place that describes how to start. The other blockers (LIN-2387, LIN-3108, LIN-3065, LIN-2149) stay with their own tickets.
- **Answers to the triage questions:**
  - Prompt text: a draft is in the description; final wording gets reviewed in the PR.
  - Static or context-aware: static. The URL is built from the deployment's own address, so a self-hosted copy links to its own guide, with `harbour.cat` as the fallback.
  - Does `/getting-started` exist: no, it's built here.
  - Homepage work beyond copy: one section with a Copy button.

Nothing blocks the build. Three non-blocking defaults are listed under Open Questions: the section sits under the hero, the guide recommends copy-first before the runner, and measurement is a possible follow-up.
