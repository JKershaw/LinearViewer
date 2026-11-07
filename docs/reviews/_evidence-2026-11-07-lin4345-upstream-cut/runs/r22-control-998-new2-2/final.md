I wrote the plan for LIN-998. It is in `output/description.md` under `## Implementation Plan`, with a summary comment in `output/comment.md`. The ticket was already In Progress, so there are no tracker actions. The repo clone is unchanged.

**The plan:** Brief and Recap will populate on open, on both the dashboard tree card and the swipe accordion.
- **Fresh cache:** shown from cache, with no AI call.
- **Missing or out-of-date cache:** generated automatically behind the existing spinner.
- **Failure:** the existing inline error with a retry button, and no automatic retry.

The change is confined to `init()` and `refresh()` in `public/brief.js` and `public/recap.js`. Both pages mount these same modules, so both change together.

**Where I departed from the research comment:**
- **Out-of-date sections also regenerate.** Research suggested leaving them on the manual button. Today an out-of-date section shows no content, only "Refresh to update", so leaving it manual would cut part of what was asked.
- **Duplicate-request guard added.** The swipe deck rebuilds the card on every swipe (`public/swipe.js:437`, `:459`). Swiping away and back while a brief is generating would otherwise send a second paid AI request, so a second open for the same issue reuses the request already in flight.
- **Free-tier cost settled without asking.** I made this an engineering decision instead of putting it to the person, because:
  - it was asked for;
  - it costs one call per change to the issue, and only when someone opens the section;
  - the agent-facing API already regenerates on missing or out-of-date (`routes/proxy.js:3386`);
  - a used-up free-tier quota shows its reason inline.

**Cuts:** none.

**Session and review:** fits one session; plan-review due: yes, because a manual click in front of a paid AI call becomes automatic.

**Tests the plan asks for** (each fails today and passes after):
- opening with a fresh cache sends no request;
- an error sends exactly one request;
- swiping away and back sends exactly one request;
- opening with no cache, or an out-of-date one, ends on content with no click, on both pages.

The existing swipe and tree-section tests that assume the manual button get rewritten to match.

DONE: Plan written for LIN-998. Brief and Recap generate on open when missing or out of date, show the cache when fresh, and share in-flight requests; fits one session, plan-review due: yes.
