# C9 members: stale-contract text (R12), bound and member table (LIN-3766, scoring step)

Pin: LinearViewer `c5694b68`. Bound, Arm A query and Arm B pattern: `rerun-outputs.md` Q24, Q25. Member existence and provenance: Q26, Q27 (each cite viewed by content at the pin; `git blame` against run 3's pin `b5c528c4`). A member is stale only if production code (not tests, not JSDoc `import()` types) contradicts the text.

Arm B: the literal `(once|until|pending|awaiting) LIN-N` pattern is 7 hits (case-sensitive) or 10 (`-i`), wider forms 50 and 55 (Q25); the plan's "73 lines over 61 tickets" does not reproduce. Members were read, not counted. Arm B includes runtime strings (`lib/effort-readout.js:597` is one); Arm A excludes them.

## Definite (19)

| # | Cite | Claim in the text | Contradicting production code | Written | vs run 3 pin |
| -- | -- | -- | -- | -- | -- |
| 1 | `lib/account-store.js:43` | store "wired to NO route" | injected into routes: `routes/email-auth.js:147-246`, `routes/account-merge.js:111` | 2026-07-14 | predates |
| 2 | `lib/account-workspace-store.js:28` | "wired to NO route until LIN-1329" | `recordWorkspace` / write-only registry callers `routes/auth.js:305,439`, `routes/workspace.js:98`, `routes/held-connection.js:384` | 2026-07-14 | predates (run 3 named it) |
| 3 | `lib/connection-store.js:5` | "NO read path is wired to it yet (LIN-3124" | `readConnection*` called at `lib/connection-credential.js:147,368,677` | 2026-09-27 | newer |
| 4 | `lib/connection-store.js:60`, `:71` | "LIN-3124 not yet landed" / "after LIN-3124 lands deletion" | LIN-3124 is Done; deletion lane in `lib/connection-lifecycle.js` | 2026-09-27 | newer |
| 5 | `lib/credential-invariant-sweep.js:20` | workspace-store "wired to no route" | workspace-store is injected into route files; see #1-2 | 2026-08-23 | predates |
| 6 | `lib/dispatch-store.js:583` | "Inert: no production caller yet" (`getGrantDeclaration`) | called at `routes/dispatch.js:1240` | 2026-09-29 | newer |
| 7 | `lib/held-connection-entry.js:2` | "dark: no consumer" | 4 importers incl. `routes/held-connection.js` | 2026-10-01 | newer |
| 8 | `lib/kpi-daily-rollup.js:11` | "Nothing reads the collection yet" | `lib/kpi-stats.js:649-651`, `lib/workspace-kpi-stats.js:159-161` | 2026-10-20 | newer |
| 9 | `lib/periodicals.js:92` | "Autopilot is not yet wired to dispatch periodicals" | `lib/prompts/autopilot-kickoff.js:720-732` | 2026-06-11 | predates |
| 10 | `lib/prompts/collective-participant.js:126` | "no production caller passes a custom" value | client characters reach the prompt via `routes/collective.js:196,315` | 2026-07-05 | predates (new to the list) |
| 11 | `lib/proxy-preamble.js:444` | "no production caller passes declaredGrants" | `lib/dispatch-entrance.js:739,776` pass `['dispatch']` | 2026-09-29 | newer |
| 12 | `lib/proxy-preamble.js:692` | "Inert: no production caller yet" (`provisionResumeCredential`) | `lib/dispatch-entrance.js:953`, `lib/follow-up-dispatch.js:247`, `lib/chat-tools.js:1882` | 2026-09-29 | newer |
| 13 | `routes/collective.js:116` | "Not yet consumed by the renderer" | `lib/render-collective.js:133` renders it | 2026-07-06 | predates |
| 14 | `server.js:696` | owner-credentials store has "No read path" | `ownerCredentialStore.get` at `server.js:1265,2095,2782` | 2026-07-21 | predates |
| 15 | `server.js:705` | Connection "no read path wired yet" | `connectionStore.readConnection*` at `lib/connection-credential.js:147,368,677` | 2026-09-27 | newer |
| 16 | `server.js:4290` | "blocked on LIN-541/544 and only scaffolded" | LIN-541 and LIN-544 are both Done (tracker read 2026-10-23T09:37Z); the add-source linking is no longer scaffold-only | 2026-06-25 | predates |
| 17 | `lib/effort-readout.js:597` | runner "does not yet report a realised effort" (runtime string) | carried from run 3 | 2026-09-05 | predates (run 3 named it) |
| 18 | `lib/workspace.js:96` | "once LIN-2018 remaps Jira team ids" | carried from run 3 | 2026-08-10 | predates (run 3 named it) |
| 19 | `lib/agent-turn.js:585` | "boot once LIN-2622" | carried from run 3 | 2026-09-05 | predates (run 3 named it) |

Tracker states quoted here (LIN-3124, 1329, 2018, 2622, 541, 544, 2567 Done; LIN-820 Todo) were read through the workspace API at 2026-10-23T09:37Z.

Provenance tally (Q27): 11 predate run 3's pin (of which run 3 named 4: #2, #17, #18, #19), 8 are newer (#3, #4, #6, #7, #8, #11, #12, #15). Run 3's fifth instance, `lib/pipeline-loops.js` (LIN-2187), is retired (rebuilt in `4ee0a2c7`, LIN-3578). **Net: 5 → 19.** Of the jump, 7 are latent members run 3 never recorded (predate its pin, not among its five: #1, #5, #9, #10, #13, #14, #16) and 8 are new text. R12 verdict: **worsened** (new instances outnumber retirements 8 to 1).

## Borderline (3, not counted)

| Cite | Reason held out |
| -- | -- |
| `lib/account-workspace-store.js:139` | phrased as history ("LIN-1892 adds no production caller"); `getWorkspaceOwnerAccountId` is now called at `lib/workspace-owner.js:77`, `server.js:722`, but the sentence describes what one ticket added |
| `lib/observer-sweep.js:645` | says workspace-store is "constructed but wired to no" route, the same claim as definite #5, but the line is inside a comment explaining a deliberate absence in the sweep's own deps (the sweep does not use the store), so the sentence is accurate about the sweep and only the parenthetical is stale. Held out on that reason (plan-review N4); a stricter reader would count it |
| `lib/superseded-selection.js:16` | "temporary seam to be deleted once the LIN-3124 single-source cutover lands": forward-looking and arguably still pending |

## Out-of-bound sighting (inverse direction, no count)

`lib/liveness-alarm-store.js:276` says `cleanup()` is "used by the server's periodic cleanup" but nothing calls it: `lib/hourly-cleanup.js` lists nine other stores and not this one (checked by `git grep -n "cleanup" c5694b68 -- lib/liveness-alarm-store.js lib/hourly-cleanup.js`). This is dead code claimed live, so it is a code-side gap, not stale prose. Owner: none identified; recorded in the report's findings (R17).
