**Scoping: size of the move**

I wrote `## Size of the move` into the description. **Size:** consolidate the decision this task touches, decided by the standing policy (err larger).

**Re-grounding:** HEAD `973a8ec` is from the day the ticket was filed. No commits touch the brief/recap/context modules, the lazy-section and Swipe mount paths, the brief/recap routes, the proxy, the free-tier store or the renderer since then. The triage comment and both Surveys are accurate against the code, with one correction to Survey global: the "LLM generation only on an explicit button" contract (LIN-595) is written for the Observation page only. There is **no** written rule for the tree/Swipe Brief and Recap sections, and that gap is what this task has to close.

**Done means:** opening Brief or Recap (tree and Swipe) shows content without a click. Missing content generates on open. Out-of-date content shows the previous text, marked out of date, while it regenerates. Current content spends nothing. One open costs at most one call, and concurrent opens of the same task cost one call. Wherever generation can't run, the section falls back to today's manual state, never an error. The spend rule is written down.

**Needs a ruling before build:** who gets auto-population. My recommendation: users with their own OpenRouter key or a paid server key get it, on both missing and stale. Free-tier users keep the button so that opening sections doesn't spend the 20-a-day workspace quota they share with prompt generation. Excluding free-tier users is a cut to "make Brief and Recap populated on section open", so it needs your sign-off.
