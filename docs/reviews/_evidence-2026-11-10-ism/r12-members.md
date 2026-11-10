# R12 members at HEAD (run 4's C9 rule, re-run verbatim)

Pin: LinearViewer `9cf51ef72`. Rule: run 4's `rerun-outputs.md` Q24 (Arm A query) and Q25 (Arm B patterns), unchanged.
Commands and verbatim output: this folder's `rerun-outputs.md` Q8-Q10. **No rule change**, so the two counts compare.

| Count | Run 4 (`c5694b68`) | Run 5 (`9cf51ef72`) |
| -- | -- | -- |
| Arm A lines | 60 | 57 |
| Arm B literal, case-sensitive / `-i` | 7 / 10 | 8 / 12 |
| Arm B wider A / B (`-i`) | 50 / 55 | 73 / 80 |
| **Definite members** | **19** | **5** |

## Run 4's 19 definite members, checked by content at HEAD

The cited line's exact text at `c5694b68` was searched for in the same file at HEAD; every miss was then read
by hand for a reworded survivor (none found).

| # | Run-4 cite | HEAD | Verdict |
| -- | -- | -- | -- |
| 1 | `lib/account-store.js:43` | gone | retired |
| 2 | `lib/account-workspace-store.js:28` | gone | retired |
| 3 | `lib/connection-store.js:5` | `:5` | **persists** (`readConnection*` is called by `lib/connection-credential.js`, 19 call lines) |
| 4 | `lib/connection-store.js:60`, `:71` | gone | retired |
| 5 | `lib/credential-invariant-sweep.js:20` | gone | retired |
| 6 | `lib/dispatch-store.js:583` | gone | retired |
| 7 | `lib/held-connection-entry.js:2` | rewritten | retired |
| 8 | `lib/kpi-daily-rollup.js:11` | gone | retired |
| 9 | `lib/periodicals.js:92` | gone | retired |
| 10 | `lib/prompts/collective-participant.js:126` | gone | retired |
| 11 | `lib/proxy-preamble.js:444` | gone | retired |
| 12 | `lib/proxy-preamble.js:692` | gone | retired |
| 13 | `routes/collective.js:116` | gone | retired |
| 14 | `server.js:696` | gone | retired |
| 15 | `server.js:705` | `server.js:805` | **persists** |
| 16 | `server.js:4290` | `server.js:4372` | **persists** (LIN-541 and LIN-544 Done) |
| 17 | `lib/effort-readout.js:597` | replaced, `:621` accurate | retired |
| 18 | `lib/workspace.js:96` | `:96` | **persists** (LIN-2018 Done) |
| 19 | `lib/agent-turn.js:585` | gone | retired |

15 retired, 4 persist.

## New lines in Arm A / Arm B literal, read one by one

13 Arm A lines are new since run 4 (excluding `routes/test.js`); 2 Arm B literal lines are new.

| Line | Verdict |
| -- | -- |
| `lib/request-usage-store.js:5-6` "Nothing reads this collection yet except `listForAnchors`, and that has a single caller in a later piece" | **new definite member**: the later piece landed; `lib/request-usage-loader.js` has 7 production importers |
| `lib/render-landing.js:58` "typed as a fallback until LIN-3952 owns one display name" | borderline: LIN-3952 is Done, but whether it delivered that display name was not established |
| `lib/request-usage-store.js:25`, `lib/request-usage-intake.js:167` "Nothing reads by it" (the `rootItemId` stamp) | accurate (reads run on `{urlKey, itemId}`, LIN-4212) |
| `lib/workspace-preferences.js:38` (`sizePolicy` "nothing reads it") | accurate (retired setting, LIN-4393) |
| `lib/observer-pass.js:19` (old `authority` field) | accurate |
| `lib/db-indexes.js:687` "kept until LIN-4217 retires it" | accurate (LIN-4217 Backlog) |
| `lib/pricing-conformance-sweep.js:9` "Until LIN-4358…" | history, accurate |
| `lib/call-budget.js:6`, `lib/dispatch-entrance.js:2000`, `lib/home-view.js:420`, `lib/openrouter.js:1379`, `lib/read-horizon.js:97`, `lib/request-usage-loader.js:13`, `lib/workspace-change-log.js:28`, `server.js:366` | "no caller can/keeps…" design statements, not stale claims |

**Definite: 4 persisting + 1 new = 5. Borderline: 1.** Net 19 → 5, **improved**. Provenance by `git log -S` on the retired text: 13 of the 15 went in one commit,
`343d34ec0` (LIN-3827, "retire stale landing-status comments", #2146), a ticket minted by the **Comprehension-Debt
Review** run 4 (LIN-3825, `docs/reviews/comprehension-debt-review-2026-10-23.md`); `lib/effort-readout.js:597` went in
`8938a7ae0` (LIN-2683) and `lib/agent-turn.js:585` in `a896f183b` (LIN-3779). So the class R12 names Documentation Review as owner of was acted on by a different sibling;
Documentation's newest edition is still 2026-10-21. That is an owner-map delta (META), recorded under R12.

**Out-of-bound sighting, inverse direction (R17, unchanged):** `lib/liveness-alarm-store.js:276` says the server's periodic
cleanup uses `cleanup()` (`:285`); `lib/hourly-cleanup.js` does not mention the alarm store.
