## Area read: Runs & dispatch @ 4b5001ddf

**Role:** Runs & dispatch (the area the work changes). Piece 0 baseline, LIN-4453 beat 2. Read in one window with the frozen kit; the kit was not changed.

**Recorded fields**
- Base commit: `4b5001ddfa185eed683ccb8b9805d493c8c380da` (`origin/main`, short `4b5001ddf`)
- `docs/areas/areas.json` blob: `d13fca20e50c37e859e82fbc820177acefd4e48d`
- Kit `docs/plans/survey/area-read.md` blob: `cbec2d848d63e18a0a0bdd6d5ed17307dcde6c26` (committed `4a21feb1d`)
- Reader prompt `docs/plans/survey/area-read-reader-prompt.md` blob: `ef1c2ca9173831f53ca32b60da1d805d27bf2159`
- N = 14 per area, by the stable SHA-256 path-hash rule in the kit. The snippet reproduces this list at the base commit.
- Date: 2026-11-13
- Note: `docs/areas/runs-and-dispatch.md`, blob `38107133294770e483990523910916b8ce1c24ee`, 11,540 bytes.

**Sample (exact file list, at the base commit)**

| Bytes | Path |
| --: | -- |
| 21,859 | `lib/observation-sessions-materializer.js` |
| 3,060 | `lib/consumer-heartbeat-store.js` |
| 20,397 | `lib/observation-sessions-store.js` |
| 1,681 | `routes/runner-kit.js` |
| 1,550 | `lib/request-usage-vocabulary.js` |
| 15,711 | `lib/transcript-spend.js` |
| 7,990 | `lib/wake-shadow.js` |
| 10,879 | `lib/agent-status-store.js` |
| 30,554 | `lib/digest-feedback.js` |
| 8,605 | `lib/session-summary.js` |
| 5,048 | `lib/queue-config.js` |
| 14,165 | `lib/request-usage-store.js` |
| 45,915 | `lib/cost-read.js` |
| 12,138 | `lib/wall-clock-summary.js` |

Sample total: 14 files, 199,552 bytes.

**Reader passes** (two independent fresh agents; each output below is verbatim)

Pass A (agent `ab63d09601c3cc56f`):

```
Code
- K1: 4. File names and headers match their behaviour (`lib/request-usage-store.js`, `lib/wake-shadow.js`, `lib/cost-read.js`), and the headers name the module that decides each rule, though many homes the note cites are not in the bundle.
- K2: 3. Some rules have a clear home (`lib/cost-read.js` says it restates nothing and names the composed modules), but the CI/verify signature is redeclared in `lib/transcript-spend.js` and `lib/wall-clock-summary.js`, and the decision-stamp kinds are inlined again in `lib/wall-clock-summary.js`.
- K3: 3. Most functions read cleanly in place, but `lineageUsageOf` and `combineFolds` depend on fold result shapes from `lib/row-usage.js` and `lib/request-usage-fold.js`, which are not in the bundle.
- K4: 3. Names are mostly precise, but one concept goes by several names (`anchor`, `rootItemId`, `lineage`, `sessionGroupId`), and "session" means an autopilot run in `lib/session-summary.js` but a lineage in `lib/cost-read.js`.
- Code mean: 3.3

Note
- M1: 4. Most lessons say what to do and why (archive through `_archiveItem`, claim before compare-and-set, compare repositories case-blind), though a few are descriptions of a defect rather than a rule to follow.
- M2: 3. Most waiting entries name the file and the open question, but several give no reason for deferral (`lib/dispatch-factory.js` test seam, `lib/session-summary.js` open question), and some are long enough to hide the actual item.
- Note mean: 3.5

Where I could not tell: Many files the note cites are not in the bundle, including `lib/dispatch-store.js` (wake and archive paths), `lib/dispatch-wake.js`, `lib/dispatch-fields.js`, `lib/run-closeout-state.js`, `lib/close-out-readiness.js`, `lib/row-usage.js` and `lib/request-usage-fold.js`, so I could not check the wake, close-out or PR-selection rules themselves. The bundle also holds files that look outside this area (`lib/queue-config.js`, `lib/consumer-heartbeat-store.js`, the observation-sessions files), so I could not confirm membership. I could not check the tests the note names or the history behind the LIN references.
```

Pass B (agent `a1ef9b9220c6c912b`):

```
Code
- K1: 4. File names and module headers name their jobs (lib/cost-read.js, lib/wake-shadow.js), though close-out readiness is spread across several files the note names rather than one obvious home.
- K2: 2. Rules are restated across files: the note records a close-out precedence split between box and guard, and lib/wall-clock-summary.js inlines decision-stamp kinds that lib/digest-feedback.js already owns.
- K3: 3. Most functions read on their own, but the cost and digest paths (`sessionOf` in lib/cost-read.js, `applyHarvestedAbortToDigest` in lib/digest-feedback.js) depend on fold shapes and rules defined in other modules.
- K4: 3. Names are mostly precise (`isFreshDigest`, `oneRecordPerRequest`), but one concept goes by several names (anchor, rootItemId, lineage anchor, sessionGroupId) and comments run as ticket changelogs, as in lib/observation-sessions-store.js.
- Code mean: 3.0

Note
- M1: 3. Most lessons give a clear action and a reason, but several are findings or open defects rather than rules, and some give a ticket number where the reason belongs (for example the guard-order lesson on the wake pair).
- M2: 3. Each entry names its file and what is waiting, but few say why it is not scheduled, and some are open questions with no stated cost of waiting (for example the stored run paragraphs entry).
- Note mean: 3.0

Where I could not tell: the files the note names but that are not in the bundle, including lib/dispatch-store.js, lib/close-out-readiness.js, lib/run-closeout-state.js, lib/dispatch-wake.js and lib/task-timeline.js, so I could not check the stated precedence, the `dispatchModelOf` rule or the census pins. Also the review documents, the README.md format rules, and whether the ticketed items are still open.
```

**Combined baseline (no after-read yet; no Runs-minus-control difference computed here)**
- Code means: pass A 3.3, pass B 3.0; combined 3.15.
- Note means: pass A 3.5, pass B 3.0; combined 3.25.
- Noise guard (code means differ by 1.0 or more): |A − B| = 0.3, so the guard did not fire.
- Code movement and note movement are reported separately; this baseline has neither.

**Limits carried from the kit:** the sample holds 1 of the 13 planned Runs files (`lib/cost-read.js`); the read measures the area at large. Readers had the note and the 14 files only, supplied as one bundle file with the note first and each file headed by its path. Readers had general tool access, so their use of tools was not restricted by configuration; see the beat report for what was checked.
