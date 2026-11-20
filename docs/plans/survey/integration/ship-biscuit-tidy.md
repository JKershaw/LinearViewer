**Title:** Ship Biscuit reports the work that got done, not the runs

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Ship Biscuit is an experimental catch-up "newspaper" behind the `shipBiscuit` flag, and only John uses it. It should tell him what work got done since he last looked. Today every source it reads is about runs:
- observation sessions;
- the agent-status log;
- task snapshots;
- the roadmap report;
- the LLM call log.

It never looks at what actually landed (`lib/ship-biscuit.js:37-38`). Its "Before→After" moves come from task snapshots, which are only taken when a run happens to read a task, so what it reports is skewed.

**Why now.** Layer slice 2 (LIN-4499) retires task snapshots. Ship Biscuit is the only caller of `TaskSnapshotStore.listByWorkspace`. Moving it onto the right data first lets slice 2 retire snapshots outright.

**What we want.** Ship Biscuit leads with work that got done in the window: what merged and what was finished. It reads sources that already exist and keep updating as the layer work lands, so it won't need re-plumbing in later slices. Its story may change; it's experimental. Runs can still appear as background, but they aren't the news.

**Done when**
- Ship Biscuit no longer reads task snapshots, and `listByWorkspace` with its tests is gone;
- an edition leads with what landed in its window;
- its tests pin the new shape.

**Checking it:** the regular tests only. Don't run evals, and don't generate editions to try it out: each costs John money. John checks it live himself once it's deployed.

**Not in this ticket:** the snapshot store, its capture code and its two proxy endpoints. Slice 2 retires those.

**Where to read:** a read-only check of the current code (20 Nov) found:
- what it reads: `routes/ship-biscuit.js:152-168`;
- a source that will last: merges are already recorded with their time (`lib/close-out-events-store.js` `listMergedSince`), and layer slice 3 builds its change records on that same recording;
- tracker completions are available through `fetchWorkspaceIssues`, which Ship Journey already uses.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
