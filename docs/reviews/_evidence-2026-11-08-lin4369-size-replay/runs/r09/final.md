I've scoped LIN-998 and written the size record, but it can't go to build until someone rules on what to leave out of the ask.

**What the ticket should deliver.** Opening Brief or Recap fills the section without a click, in both the project tree and Swipe, because they share one implementation:
- If the saved brief or recap is missing or out of date, opening the section generates a new one.
- If the saved one is current, it shows straight away, with no model call and no quota charge.
- If generation can't run (AI not set up, free quota used up), the section shows today's manual state and the reason, not an error.
- Asking for the same task twice at once (two tabs, or an agent reading it at the same moment) costs one model call, not two.
- The fact that opening a section can now spend is written down, and a test checks that opening a missing section ends up filled.

**Why the ticket is really a cost decision.** Context fills on open because it is free and gives the same result every time. Brief and Recap are paid model calls, and the generate button is what makes spending deliberate. Today two reads decide differently when to spend:
- **The human-facing read** never generates.
- **The agent-facing read** generates when the saved copy is missing or stale, and only charges after checking the cache.

I checked the ticket's claims against the code: nothing it relies on has changed since it was filed, so the Surveys' findings still hold.

**Size: consolidate the decision this task touches.** The standing "err larger" policy decides this. Done the obvious way, the browser would get a third copy of the rule, and nothing could stop duplicate paid calls, because that has to happen where generation runs.
- **Extra piece, done first:** one shared serve-or-generate rule for brief and recap. It charges free quota only once generation is certain and shares one generation between overlapping requests. Both reads use it, and agents see no change.
- **When it may stop:** if the agent-facing read can't take the rule without changing what agents see. Then only the human-facing read uses it, and the agent side becomes a follow-up.
- **Not in this ticket:** merging the two near-identical Brief and Recap front-ends.
- **The deeper want:** content already generated in the background before anyone opens it. That is a later step.

**Cuts that need a ruling.** Both cut "can we make Brief and Recap populated on section open too":
- **Free-tier users keep the button (recommended).** Their pool is 20 calls a day per workspace and 50 an hour across all workspaces, and prompt generation draws on the same pool.
- **Workspaces with AI turned off keep the button (in every option).** Brief and Recap currently show there regardless of the AI setting.

Files are in /Users/autopilot/development/simple-dispatcher-workspaces/2e356360-bd5f-4ab6-aa6b-8c241216f56e/scratch-replay/runs/r09/output/:
- description.md
- comment.md
- tracker-actions.md (status set to In Progress)

The repo was not modified.

DECISION: {"decision_id":"lin998-autogen-cuts","question":"LIN-998: who gets Brief/Recap generated automatically when they open the section? In every option, workspaces with AI turned off keep the button.","options":[{"id":"paid_only","label":"Missing and stale, only with a session or paid key; free-tier users keep the button"},{"id":"everyone","label":"Missing and stale for everyone, free tier included (the full ask)"},{"id":"missing_only","label":"Missing only, any key; out-of-date sections keep the refresh button"},{"id":"decline","label":"Keep the manual button; don't auto-generate"}],"recommended":"paid_only"}
BLOCKED: need a ruling on the cuts (free-tier users and AI-off workspaces keep the button) before LIN-998 can be built
