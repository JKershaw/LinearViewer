## Survey open-0: LIN-4178 @ 10b2c82fb

Piece 1 (LIN-4177) has landed: `cost-read.js`, `cost-format.js`, the corpus and the goldens are all here. I had only the code, not LIN-4176.

**Why it's hard: the replay feeds row shapes that production never produces.**

- **S11/S12.** The harness's `fakeCollection` (`harness.js:209`) has no `aggregate`, so `loadDispatchHistory` falls through to `find`. The goldens are therefore built from raw rows that carry full `feedback`.
  - Production rows come from the aggregated projection (`kpi-stats.js:449-460`). They have `usageEntry`, `terminalEntry` and `ticketMarkerEntries`, and no `feedback`.
  - `lineageRecords` folds `readRowUsage(member.feedback)`, so every production lineage reads `no-usage`. The replay passes while the live page shows nothing priced.
  - Setting `feedback: [usageEntry]` makes it worse. `terminalFeedbackOf`, `usageOf`, `evidenceCountOf` and `ticketMarkerEntriesOf` (`dispatch-lineage.js:32-70`) all branch on `Array.isArray(doc.feedback)`. Terminal markers would vanish, so no lineage would be `done`.
  - The adapter should build separate rows just for `fetchedRows`.
- **S13.** `sessionLoops` (`harness.js:244`) makes up `status` and `lineageId`. Real loop records (`pipeline-loops.js:409`) have no `status`, `rootItemId` or `id`. They have only `loopId`, `historyStatus` (null on live rows) and `lineageId`.
  - `groupLineageMembership` needs `status === 'taken'` and an anchor. Real loops would give no members, so every step would read "not reported".
  - The mapping has to decide what status a running live loop gets.

**First move:** make the replay use production shapes before wiring anything.

1. Give the fake an `aggregate` that applies the real projection, and run S11/S12 through it.
2. Feed S13 from real `pipeline-loops` output.
3. Confirm the goldens hold at HEAD, and add the note-2 assertion in the same step.

**Other friction:**

- **The founder lookup on `/kpis`.** `lineageIdentityRows` is a store method, but `/kpis` reads raw collections across all workspaces. The adapter must group anchors by `urlKey` and query both history and queue. The index `{urlKey, rootItemId}` exists (`db-indexes.js:240`). The `followUpTo` restriction holds, because `rootItemId` is inherited only through `followUpTo` (`dispatch-store.js:34`).
- **Timing.** The repo has the `mongodb` driver only: no in-memory server and no seed script. A sandboxed session may have no `mongod`, which could block "Done when".
- **The issue move does more than move credits.** S11's `issues` map (T), the component union, `anchoredIdentifiers` and the attributable share all key on `lineage.issueIdentifier`. Moving a straddler from LIN-99 to LIN-42 can:
  - merge components, dropping a priced one if LIN-42 has an unpriced lineage;
  - remove LIN-99 from T;
  - turn LIN-99 into a lane-landed UNKNOWN ticket.

  Note 1 also moves `pricedLineageShare`. The change list should name these, or W9 will flag them.
- **Window and day.** A record has no `start`. S11's window and S12's day must come from `record.members[0]`, the earliest fetched member. Using the true members (the founder) pushes the straddler out of the window, which changes the population.
- **The S12 null day reaches the browser.** `public/workspace-kpis.js:127-130` adds up and charts `perDay` as numbers. `render-workspace-kpis.js:46` also has its own local `formatUsd`, which hides piece 1's.

Not a symptom ticket; the risk is tests that miss production.
