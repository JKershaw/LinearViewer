## Size of the move

**Size:** consolidate the decision this task touches
**Decided by:** the standing policy

**What it delivers.** Opening the Brief or Recap section shows a brief or recap without a click, in the tree view and in Swipe. Both views use the same sections, so they change together on purpose. When the cached copy is current, it shows straight away as it does today. When none exists, or the task has changed since it was made, generation starts on open and the section fills in when it finishes. Done means:
- opening a never-generated or out-of-date Brief or Recap ends on content with no click;
- a current cached copy is never regenerated just because the section was opened;
- if generation can't run (AI not configured, free-tier quota used up, or AI suggestions turned off), the section falls back to today's calm "generate" state and says why, not an error;
- however many times the same task's section is opened at once (two tabs, the task showing twice in the tree, tree plus Swipe), the model is called once;
- the rule for when a human-facing section may spend a model call is written down in one place;
- a test proves that opening a missing section reaches a filled one.

**Why this size.** The ask treats Brief and Recap like Context, and they aren't the same kind of section. Context is a free, deterministic build. Brief and Recap are paid model calls behind a cache, and today a click is the only thing that spends. Generating on open turns every open into a possible spend, and that changes two things. First, duplicate generation becomes a real cost: nothing stops two calls for the same task running at once, and the same task can be mounted twice on one page. Second, the human-facing sections and the agent-facing proxy would both "generate on miss", but by separate copies of the same logic with separate rules. Under the standing policy (err larger: take the larger move when the look shows it pays), settling that rule once, with concurrent calls merged, pays for itself in this task. The standing policy decided the size. It does not decide the cuts below.

**Sizes weighed**
- *Just the task:* the sections fill on open, but missing AI setup and used-up quota show as errors, every duplicate open pays again, and the change in cost stance goes unrecorded.
- *A small tidy:* adds graceful fallback, writes the rule down and adds a test, but duplicates still each pay, and the human and agent paths keep separate generate-on-miss rules.
- *Consolidate the decision this task touches (chosen):* one serve-or-generate rule for Brief and Recap, shared by the human and agent paths, where concurrent requests for the same task share one model call. The implicit spend is never paid twice, and both surfaces follow one written rule.
- *Rebuild the area:* also merges the two near-identical section clients and pre-generates in the background when a task changes. That removes the wait on open, but at a higher, always-on cost that this task doesn't need.
- *Wrong work:* no. The ask can be met and makes sense.

**The extra, done first.** One serve-or-generate rule for Brief and Recap: serve the cache when it's current, otherwise generate, charge the free tier only after the cache check, and merge concurrent generation for the same task into one call. Both the human-facing and agent-facing paths use it. It may stop at the human-facing path if bringing the agent path onto it would carry over that path's own differences (its snapshot capture, token auth and opt-out flag) in a way that risks agent behaviour. The builder then says why in the PR, and the agent path stays as it is.

**Deeper than the ask.** What the user really wants is the content waiting when they open the section. On-open generation still makes them watch a spinner for each section that isn't current. Generating in the background when a task changes would remove that wait, but it is a different, always-on cost stance. It isn't this task's. Raise it separately if the wait still bothers people.

**Cuts to the ask** (pending a ruling, not agreed). The ask: *"can we make Brief and Recap populated on section open too."* The recommended delivery doesn't populate on open in two cases:
1. **Free-tier users** (no paid or session key) keep the click. Their daily quota is small and shared with prompt generation, so spending it on every open would starve the core feature.
2. **Users who have turned AI suggestions off** keep the click. Auto-spending would override their setting.
Without a ruling, these are cuts that haven't been agreed. If the ruling is "full", the work populates on open for everyone and no cuts remain.

**Open questions**
- The ruling on the two cuts above. Options: full delivery, the recommended paid-key-and-AI-on delivery, or the narrower missing-only, paid-only delivery (which would also cut out-of-date sections).
