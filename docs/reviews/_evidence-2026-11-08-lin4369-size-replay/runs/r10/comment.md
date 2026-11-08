**Scoping: size and done for LIN-998**

I've written the size record into the description under `## Size of the move`. In short:

- **Size: consolidate the decision this task touches**, set by the standing policy (err larger). Context fills on open because it's free. Brief and Recap are paid model calls, and today a click is the only thing that spends. Generating on open turns every open into a possible spend. So first, Brief and Recap get one serve-or-generate rule, shared by the human-facing and agent-facing (proxy) paths, where concurrent requests for the same task share one model call. Then both sections fill on open, in the tree view and in Swipe.
- **Done:** a missing or out-of-date Brief or Recap fills on open with no click. A current copy is never regenerated. If AI isn't set up, the quota is used up or AI is off, the section falls back to today's "generate" state instead of an error. Concurrent opens cost one call. The rule is written down in one place, and a test covers open → filled.
- **Re-grounding:** nothing the ticket or the Surveys reference has changed since the ticket was filed. The triage comment's and Surveys' reading of the code holds at HEAD.
- **Deeper ask:** the user wants the content already there. Background generation when a task changes would remove the spinner, but it's a different, always-on cost, so it isn't this task.

**Ruling needed on cuts.** The recommended delivery keeps the click in two cases: **free-tier users**, whose small daily quota is shared with prompt generation, and **users who've turned AI suggestions off**. Both cut *"can we make Brief and Recap populated on section open too."* Choose: full delivery for everyone (no cuts), the recommended paid-key-and-AI-on delivery, or the narrower missing-only, paid-only delivery (which also cuts out-of-date sections).
