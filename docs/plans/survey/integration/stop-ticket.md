**Title:** Stopping a run stops all of it, including work it has already queued

**Repository:** JKershaw/LinearViewer (Harbour), with simple-dispatcher if the runner needs a change.

**What this is for.** On 21 Nov John called a full stop while slice 3 (LIN-4513) was running. Two things showed that stopping isn't complete:
- **Stopping one run left its queued work free to start.** Slice 3's autopilot was stopped with a cascade abort, and every live session in it ended. But an implementation run it had already queued for LIN-4518 stayed queued, ready to launch as soon as the workspace was free, with no run left to guide it. A stopped run should stay stopped, all of it, until someone restarts it.
- **The workspace "pause" only holds new work.** Follow-ups and wakes into a session that is already running still go through, so a wake ran four minutes after the pause was set. That is how pause is meant to work, and "stop" (which also ends running sessions) exists. But nothing on the page or in the API says which one is the emergency stop, and the driving session reached for pause.

**What we want.**
- When a run is stopped, cascade included, nothing of it starts until it is restarted: not its live sessions, its wakes, or the work it has queued. Stopping holds that work; it doesn't delete it.
- Restarting the run (a fresh kickoff on the same task) picks up from where it stood, without being blocked by work the stopped run had queued.
- Wherever pause and stop are offered (the Dispatch page, the API docs), it is plain which one is the emergency stop and what each leaves running.

**Done when**
- a test stops a run that has a queued, unstarted item, and that item doesn't start while the run is stopped;
- a test restarts the task after a stop and the restart isn't refused because of the stopped run's queued item;
- the Dispatch page and the API docs say in one line each what pause and stop do.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
