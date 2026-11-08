## Size of the move

**Size:** consolidate the decision this task touches
**Decided by:** the standing policy

**What it delivers.** Opening Brief or Recap fills the section without a click, the way Context does. If a task has no saved brief or recap, or the saved one is out of date, opening the section starts generation and shows the result. A current one shows straight away and costs nothing. This applies in both places these sections appear, the project tree and Swipe. They share one implementation, and splitting them would create a UI divergence nobody asked for. The manual refresh stays. Where generation can't run (AI not set up, free quota used up), the section lands on today's manual state with the reason, not on an error.

**Done means:**
- Opening a missing or out-of-date section shows generating, then the content, with no click, in both views. This is subject to the ruling on the cuts below.
- Opening a current section shows the content at once, with no model call and no quota charge.
- Collapsing and re-opening the section on the same page doesn't generate again.
- When the same task's brief or recap is asked for twice at once (two tabs, two places on the page, or an agent reading it at the same moment), there is one model call, not two.
- When AI isn't set up or the quota is used up, the section shows today's manual state and says why.
- The cost stance change (opening a section can now spend) is written down where the team's cost rules live and in the user-facing description of these sections. A test pins that opening a missing section ends populated.

**Why this size.** The ticket reads as a UI tweak, but this is a cost change. Context fills on open because it is deterministic and free. Brief and Recap are paid model calls, and the generate button is what makes spending deliberate. So the real decision this task changes is when reading a brief or recap spends a model call. Today that decision is made two different ways:
- The human-facing read never generates.
- The agent-facing read generates when the saved copy is missing or stale. It only charges after the cache check, has timeouts, and falls back cleanly.

The generation itself exists four times. Done the obvious way, the ask adds a third copy of the rule, in the browser. It also can't stop duplicate paid calls, because duplicates can only be stopped where generation happens. After this task, humans and agents want the same rule. The standing policy (err larger when the look shows it pays, set 2026-11-07) therefore points at one rule in one place, which the ask then uses. That is what pays here: one place decides spend, duplicate calls are stopped at the cause, and the human-vs-agent split can't drift. The ticket also aims at a symptom: what the user really wants is the content already there when they look. See "wrong work" below.

**Sizes weighed:**
- **Just the task:** generate on open. Delivers the ask, but the friendly placeholder becomes an error when AI isn't set up or the quota is out. Concurrent opens pay twice, and the cost stance flips with nothing written down.
- **A small tidy:** the task plus graceful fallback and a written cost rule. Honest, but it leaves a third copy of the generate-on-read rule and nothing stops duplicate calls.
- **Consolidate the decision (chosen):** one serve-or-generate rule for brief and recap, shared by human and agent reads, with protection against duplicate calls. The ask becomes the human read opting into that rule.
- **Rebuild the area:** also merge the two near-identical section front-ends and every brief and recap handler into one. Tidier, but the front-end duplication doesn't bind on this task, so it's a follow-up.
- **Wrong work:** no. Generating in the background when a task changes or is dispatched would remove the wait entirely, but it spends on tasks nobody opens. It's a later step, not a reason to skip this one.

**The extra, done first:** one shared rule covering the following. Serve the saved brief or recap when it is current. Otherwise generate, unless the caller opts out. Charge free quota only once generation is certain. Let concurrent requests for the same task share one generation. Both the agent-facing and human-facing reads adopt it, and agents see no change in behaviour. **It may stop** if the agent-facing read can't adopt the rule without changing what agents see, for example because its snapshot capture, timeouts, auth or response shape don't fold in cleanly. In that case the shared rule serves the human-facing reads only, the builder says why on the ticket, and the agent side is filed as a follow-up.

**Cuts to the ask** (pending a ruling, not agreed). Both cut the same clause: "can we make Brief and Recap populated on section open too".
- **Recommended cut:** users on the shared free tier don't get it and keep the button. The free pool is shared with prompt generation: 20 calls a day per workspace and 50 an hour across all workspaces. Generating whenever someone opens a section would drain prompt generation for everyone.
- **Cut in every option:** workspaces with AI turned off keep the button. Today these sections render whatever the AI setting is, and generating on open there would spend where the workspace said no.

Without the free-tier cut, everyone gets the ask in full except AI-off workspaces, and the free tier's own limits cap the spend.

**Open questions:** whether free-tier users get auto-generation (the ruling above). No others.

**Who decided:** the size, by the standing policy. The cuts wait on a ruling.
