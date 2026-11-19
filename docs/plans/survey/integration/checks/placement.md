# Where each census row goes (design draft 3)

*Read by `completeness.mjs`.*
- **Slice numbers:** 1 is store, runs and hand-offs; 2 the plan; 3 verdicts and changes; 4 rulings and the ticket section; 5 lessons; 6 wakes.
- **Retire:** deleted in that slice.
- **Change:** kept, but pointed at records in that slice.
- **Keep:** unchanged, with the reason.

**C1 (hand-offs)**
- **Retire in slice 1:**
  - 01–11: Waiting. 05 keeps its Lessons cap until slice 5. 07's pointer lines lose their Waiting half here and their Lessons half in slice 5, and the 386-byte pin (C5-A17) changes in both. 09 and 10 are rewritten to write findings.
  - 15–22: the `Retires:` conveyor.
  - 26: the ledger item parse. Its verdict half goes in slice 3.
  - 34: the blind-read classes.
- **Change in slice 1:**
  - 12–14: the leftover stage ends one finding.
  - 23–25: the prompts write findings, with `how` for a verification.
  - 28–32: counts and pages read records.
  - 37: an ask is a finding to the parent.
  - 38: look before adding.
- **Slice 3:** 27, 33, 35, 36.
- **Slice 4:** 39–41.
- **Keep:**
  - 42–47: run proposals, a chat turn's Apply or Decline, which is workflow.
  - 48: the up-chain wake, which is engine.

**C2 (rulings)**
- **Slice 4, all rows,** except these:
  - 01–07 are kept as transport; Harbour turns their feedback into records.
  - 13: kept, the route refuses an ended question.
  - 19: kept, rekeyed to record ids.
  - 21: changed, wiring.
  - 27: kept, ends records.
  - 44: already gone.
  - 45–50: tests, replaced.

**C3 (verdicts and runs)**
- **Retire in slice 3:**
  - 01–08 and 59.
  - 17: the shape half; the landing-set rule stays in the route.
  - 18: the reasoning comes through brief part 4.
  - 41: the words; `BLIND_READ_KIND` stays.
- **Change in slice 3:**
  - 09, 10, 12–16, 19, 22, 24, 39, 40, 42 and 43 read records.
  - 27–37: the prompts write verdict records.
  - 57: change heads are also refreshed at verdict writes.
  - 60 and 61: tests.
- **Slice 1:** 11 (counts), 55 (the session page shows the run's account).
- **Slice 4:** 20 (the ruling label) and 25.
- **Keep:**
  - 21: routes.
  - 23 and 38: Periodicals, which are outside the layer.
  - 26: the provider.
  - 44–54 and 56: engine and cost. 44–46 gain `runRecordId` and the run-record write in slice 1.
  - 58: transport for the account.

**C4 (the plan and the brief)**
- **Retire in slice 2:** 01–19, 41 and 42, and 49. 07, the file-pointer pilot, goes with the plan paths it read.
- **Change in slice 2:**
  - 21–23: the selector's plan facts come from records.
  - 32: surveys quote `asked`.
- **Slice 4:**
  - 20: stops feeding the brief; kept for scan and task chat.
  - 35–40, 45 and 46: the ticket section, cache and model retire, and recap becomes `show`.
  - 44: chat tools read the records brief.
- **Slice 1:** 31 and 34, wording that names the run and the records.
- **Keep:**
  - 24–30: `generatePrompt` and its callers.
  - 33: custom prompts.
  - 43: pointers to the same door.
  - 47: scan and chat.
  - 48: the budget.
  - 50: tests, replaced in each slice.

**C5 (lessons, areas, wakes, the proxy, stores)**
- **Slice 1:** A05 (the Waiting parse), A07, A09, A10, A12 and A21 (counts). The Waiting halves of A08, A11 and A15; A08's settling of one entry becomes the leftover step working one `project` record.
- **Slice 5:** A01, A03, A06, A13, A14 and A16–A18. The Lessons halves of A08, A11 and A15. A04's prompt readers.
- **Keep:**
  - A02, A19 and A20: `areas.json` stays as the code-shape kit's and the tests' map of Harbour's own source. It is not imported; the layer has no areas. A04 keeps spelling its path for those readers.
  - B01–B09, B13 and B15: engine.
  - B14: kept; slice 6 replaces its use for hand-offs.
  - C01–C13: the proxy. C01, C06 and C10 gain the record routes; C07's mint follows the id allocated early.
  - D01–D05: the pattern the store uses.
- **Slice 4:** B10–B12. B10, the browser resume, is kept and carries out `on-answer`.
