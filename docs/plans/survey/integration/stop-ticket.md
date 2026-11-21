**Title:** Stopping a run stops all of it, including work it has already queued

**Repository:** JKershaw/LinearViewer (Harbour), with simple-dispatcher if the runner needs a change.

**What this is for.** On 21 Nov John called a full stop while slice 3 (LIN-4513) was running. Two things showed that stopping isn't as complete as it should be:
- **Stopping one run left its queued work behind.** Slice 3's autopilot was stopped with a cascade abort, and every live session in it ended. But an implementation run it had already queued for LIN-4518 stayed queued. It would have launched as soon as the workspace was free, with no run left to guide it, and a fresh kickoff on the task would have been refused while it waited. Only the owner can delete a queued item, on the Dispatch page; the proxy can't.
- **The workspace "pause" only holds new work.** Follow-ups and wakes into a session that is already running still go through, so a wake ran four minutes after the pause was set. That is how pause is meant to work, and "stop" (which also ends running sessions) exists. But nothing on the page or in the API says which to use for an emergency, and the driving session reached for pause.

**What we want.**
- Stopping a run, cascade included, also cancels everything that run has queued and not yet started. Nothing of a stopped run starts later.
- A queued item can be cancelled through the proxy by someone allowed to stop runs, not only on the Dispatch page.
- Wherever pause and stop are offered (the Dispatch page, the API docs), it is plain which one is the emergency stop and what each leaves running.

**Done when**
- a test stops a run that has a queued, unstarted item, and that item ends cancelled and never launches;
- a queued item can be cancelled through the proxy;
- the Dispatch page and the API docs say in one line each what pause and stop do.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
