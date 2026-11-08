I scoped LIN-998 and set the size to **consolidate the decision this task touches**, decided by the standing policy (err larger). Before it can be built, you need to rule on who gets auto-population.

**What done means:** opening Brief or Recap, in both the tree view and Swipe, shows content without a click.
- A section with nothing yet generates when it opens.
- An out-of-date section shows its previous text, marked out of date, while it regenerates.
- A current section costs nothing.
- One open makes at most one model call, and two opens of the same task at once also make one call.
- If generation can't run, the section falls back to today's button instead of an error.
- The rule for when opening a section may spend is written down.

**Why this size:** Context fills itself because it is free. Brief and Recap each cost a paid model call, so the ask is really a change to when opening a section spends money. Nothing in the code says when these sections may spend. The "only on an explicit button" rule (LIN-595) covers just the Observation page, and the agent-facing proxy regenerates on a miss. Done the plain way, the new rule would be copied into two near-identical sections, and duplicate opens would each pay. So the extra piece, done first, is one written rule both sections follow, plus merging simultaneous requests for the same task into one call. Rebuilding the proxy's copies is left out.

**Checked against the code:** the last commit is from the day the ticket was filed and nothing in this area has changed since. The triage comment and both Surveys hold up, apart from that LIN-595 point.

**Cuts to the ask (pending your ruling):**
- **Recommended:** free-tier users keep the manual button, so opening sections doesn't use up the 20-a-day workspace quota they share with prompt generation.
- **Unavoidable:** where AI is off, not configured, or out of quota, the section stays manual.

Files are in `/Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r08/output/`:
- `description.md`
- `comment.md`
- `tracker-actions.md` (status Todo to In Progress)

I left the code clone unchanged.

DECISION: {"decision_id":"lin998-autopop-scope","question":"Who should get Brief/Recap auto-populated on section open? (Options other than 'all' cut the ask 'make Brief and Recap populated on section open'.)","options":[{"id":"paid","label":"Auto-generate on missing and stale for users with their own or a paid server key; free-tier users keep the button; AI-off/unconfigured/quota-out stay manual"},{"id":"all","label":"Full ask: auto-generate on missing and stale for everyone who can generate, including free tier (opens draw on the shared 20/day quota)"},{"id":"missing-paid","label":"Narrower: auto-generate only when missing, paid keys only; stale and free tier keep the button"},{"id":"keep-button","label":"Do not auto-generate; keep the manual button (close as wrong work)"}],"recommended":"paid"}
BLOCKED: Need a ruling on who gets auto-population (cuts free-tier users from the ask under the recommended option) before build.
