I've scoped LIN-998, "Auto-populate Brief and Recap on section open". It needs one ruling, on which users get it, before it is built.

**What done means.** Opening a Brief or Recap that has never been generated, or whose task has changed since, shows content with no click, in both the tree view and Swipe.
- A copy that is still current is never regenerated just because the section was opened.
- If generation can't run (AI not set up, free-tier quota used up, or AI suggestions turned off), the section falls back to today's "generate" button and says why. It does not show an error.
- If the same task's section is opened in several places at once, the model is called only once.
- The rule for when an opened section may spend a model call is written down in one place, and a test covers opening a missing section through to filled.

**Size: consolidate the decision this task touches**, set by the standing policy (err larger). Context fills on open because it costs nothing. Brief and Recap are paid model calls, and today the button is the only thing that spends. Filling them on open makes every open a possible spend. Nothing currently stops two calls for the same task running at once, and the same "generate if the cache is missing" logic exists separately for the agent-facing proxy. So the first piece is one shared rule for both paths that merges simultaneous requests into one call. It may stop at the human-facing path if bringing the agent path in would risk changing how agents behave.

**What the user probably wants.** The content already there when they open the section. Generating in the background whenever a task changes would remove the wait, but it is a separate, always-on cost and is left out of this ticket.

**Code check.** None of the files the ticket and Surveys point to has changed since the ticket was filed, so their description of the code is accurate.

The size record is in `output/description.md` and the comment is in `output/comment.md`. The only tracker change is moving the status to In Progress (`output/tracker-actions.md`). The code clone is unchanged.

**Ruling needed.** The recommended version keeps the button in two cases. Each is a cut to "can we make Brief and Recap populated on section open too":
- **Free-tier users:** their 20-a-day quota is shared with prompt generation, so spending it on every open would starve that.
- **Users who turned AI suggestions off:** filling on open would override their setting.

DECISION: {"decision_id":"lin998-autogen-scope","question":"LIN-998: who gets Brief/Recap filled automatically on open? Anything short of everyone is a cut to the ask.","options":[{"id":"full","label":"Everyone, for missing and out-of-date sections, free tier and AI-off users included (no cuts)"},{"id":"paid_ai_on","label":"Missing and out-of-date sections, only with a paid or session key and AI suggestions on; free tier and AI-off keep the button (cuts those two groups)"},{"id":"narrow","label":"Missing sections only, paid or session key only; out-of-date sections keep the button too (cuts out-of-date, free tier and AI-off)"}],"recommended":"paid_ai_on"}
BLOCKED: Need a ruling on whether free-tier users and users with AI suggestions off are cut from filling Brief/Recap on open (recommended: cut both).
