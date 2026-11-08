## Size of the move

**Size:** consolidate the decision this task touches
**Decided by:** the standing policy

**What this delivers, and what done means.** Opening Brief or Recap shows the content without a click, in the tree view and in Swipe (both use the same two sections, so changing one changes both, and that is intended). The full set of done conditions:

- A section with no brief or recap yet starts generating as soon as it opens. The user sees "generating" and then the content.
- An out-of-date section shows its previous text, marked out of date, while it regenerates. That way it is populated the moment it opens, not after a model round-trip.
- A section that is already current shows as it does today and spends nothing.
- One open costs at most one generation. Re-expanding in the same page does not trigger another. Two mounts of the same task at once, in two tabs or in In Progress plus the tree, cost one model call, not two.
- If generation can't run (AI not configured, AI turned off for the workspace, quota used up), the section falls back to today's friendly manual state with its button. It never shows an error.
- The rule for when opening a human-facing AI section may spend a model call is written down next to the existing cost contracts, and the agent-facing page docs no longer call these sections click-to-generate. One end-to-end check shows that opening a missing section reaches current content with the local AI mock.

**Why this size.** The ticket treats Brief and Recap like Context. They aren't the same: Context auto-fills because it is deterministic and free, while Brief and Recap each cost a paid model call that can also draw on the shared free-tier quota. So the ask is really a cost-stance change dressed as a UI tweak. Right now nothing anywhere says when a human-facing section may spend. Observation's "only on an explicit button" contract covers only that page, and the agent-facing proxy regenerates on a miss. Done the obvious way, the new policy (when to generate, who may, what happens on failure) would be typed twice into two near-identical sections, and duplicate opens would each pay. Settling that one decision once is what makes the ask safe to ship. The standing policy (err larger) applies because the look shows it pays.

**Sizes weighed**
- Just the task: both sections generate on open. This is the cheapest route to the ask, but it changes the cost stance silently, in two copies, turns unconfigured and quota-exhausted states into errors, and pays twice for duplicate opens.
- A small tidy: the task plus guardrails (fall back to the manual state, respect AI-off, once per open). Safe, but the rule still lives in two places and concurrent opens still cost two calls.
- **Consolidate the decision this task touches (chosen):** one written rule for when opening a section may spend, applied once for both Brief and Recap. On the server, concurrent requests for the same task's brief or recap collapse into a single model call. This removes the drift and the duplicate spend the ask would otherwise create.
- Rebuild the area: one generate-or-serve path for all the human and agent brief/recap handlers, with the two sections merged into one. It would pay off eventually, but it reaches into the agent-facing proxy contract, which this ask doesn't touch, and the look doesn't show it pays here.
- Wrong work: no. The ask is coherent and worth doing. It only becomes wrong work if it ships as a pure UI tweak that changes spending without anyone noticing.

**The extra, done first.** Make "when may opening Brief or Recap spend a model call" a single written rule, and make both sections take that behaviour from one shared place instead of two parallel copies. Collapse concurrent generation requests for the same task on the human-facing endpoints. *It may stop*: if folding the two sections into one shared behaviour turns up visible differences that need a design call, stop at one shared policy that both sections follow, and say why. The in-flight collapse stops at the human-facing endpoints, because merging the agent-facing proxy's copies is not this task's.

**Cuts to the ask** (pending a ruling, not agreed). Against *"can we make Brief and Recap populated on section open too"*:
- Recommended: users on the shared free tier (no OpenRouter key of their own and no paid server key) keep the manual button and are not auto-populated. Auto-generating for them would spend the 20-a-day per-workspace quota they share with prompt generation just by opening sections.
- By design: where generation can't run (AI not configured, AI recommendations turned off for the workspace, quota exhausted), the section stays in the manual state rather than populated.

**Open questions**
- The cuts ruling above: who gets auto-population.
- Deeper want, outside this ask: the user wants the content waiting when the section opens. Generating in the background when a task changes or is dispatched would remove the wait completely, but it is a bigger cost stance. That belongs in its own ticket if wanted.

**Who decided:** the standing policy (err larger, set 2026-11-07) chose the size. The cuts are pending a human ruling.
