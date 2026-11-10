# Done writers at HEAD (R7 census, LIN-4407)

Pin: LinearViewer `9cf51ef72` (`origin/main` at 2026-11-10T11:15Z). Rule (run 4's C4, unchanged): every
`.updateIssue(` / `.createIssue(` call in `lib/`, `routes/` and `server.js` outside `lib/providers/`, cross-checked
with every `stateId` line in `routes/` and `server.js`. Commands and verbatim output: `rerun-outputs.md` Q5.

## Members (can set or create an issue in a completed state)

| # | Writer | Gate | Evidence at `9cf51ef72` | Run 4 location (re-pointed by content) |
| -- | -- | -- | -- | -- |
| 1 | Agent API `PATCH /api/proxy/issues/:id` | **gated** | import `routes/proxy-writes.js:54`; `refusedByPeriodicalGate` `:459`; `checkPeriodicalReportGate(` `:468`; called when `stateId` is set `:521-523`; write `:536` | `:365`, `:374`, `:416`, `:429` |
| 2 | Session edit `PATCH /workspace/:urlKey/api/issues/:issueId` | **ungated** | route `routes/workspace-api-issue-write.js:820`; `stateRef` read `:835`; `input.stateId` `:861`; `provider.updateIssue` `:865`; a person's Done also records a merged close-out event (`recordPipelineMerge … writer: 'person'`, `:880-882`, LIN-3863) | `routes/workspace-api.js:3410`, `:3451`, `:3455` |
| 3 | Close-out check `POST /workspace/:urlKey/api/run-evidence/:issueIdentifier/check` | **ungated** (own guard `closeOutSetsDone`, not the report gate) | route `routes/workspace-api-run-evidence.js:260` → `closeOutSetsDone(...)` `:300` → `settleDone` `:301` (defined `:224`, writes `:230`) → `defaultMarkDone` `:47` → `provider.updateIssue(… { stateId })` `:60` | `routes/workspace-api.js:3655`, `:3695-3696`, `:3619`, `:802-816` |
| c1 | Agent API create `POST /api/proxy/issues` | ungated | `stateId` read `routes/proxy-writes.js:368`, converted `:433`; `provider.createIssue` `:446` | `:339`, `:352` |
| c2 | Session create `POST /workspace/:urlKey/api/issues` | ungated | `stateId` read `routes/workspace-api-issue-write.js:766`, resolved `:794`; `createIssue` `:801` | `routes/workspace-api.js:3343`, `:3384`, `:3391` |

**3 update-path Done writers, 1 gated; plus 2 ungated create routes.** Identical in shape to run 4. The workspace-API
split (LIN-2246, LIN-3876, LIN-3894) moved writers #2, #3 and c2 into two new files and changed none of their logic.
`checkPeriodicalReportGate` has one importer and one call: `routes/proxy-writes.js:54`, `:468` (definition
`lib/periodical-report-gate.js:115`). LIN-2576 (`Todo`, read 2026-11-10T11:17Z) has no window commit.

## Checked, not members

| Call | Why not |
| -- | -- |
| `routes/proxy-writes.js:605` | writes `description` only |
| `lib/as-asked-seal.js:145` | writes `description` only (the As-asked seal) |
| `routes/workspace-api-feedback.js:518` | `createIssue` with no `stateId` field |
| `lib/local-store.js:352` | a provider implementation (seeding its own store) |
| `routes/test.js:1688`, `:1842` | test-only routes |

**Not boundable from source:** provider-side Done automations (Linear workflow rules, GitHub "Closes #").

## The sharper framing

LIN-4390 says the Done gate "fires on close-out's write" (`lib/periodicals.js:277-278`), and the rendered prompt tells
the run that "close-out's Done transition is refused until this comment exists" (`:382`). That holds when close-out
writes through writer #1. Writers #2 and #3 do not honour it, so the gate protects the intended close-out lane, not
every Done path.
