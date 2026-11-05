# Beat 1 notes: grounding and re-measure (LIN-4250, 2026-11-05)

Working notes, not the report. Where a note and the report differ, the report is the corrected reading.

## HEADs (fetched at beat 1)

- LinearViewer `origin/main` = `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` (LIN-4143, #2285). **Same as the mint-time head.**
- simple-dispatcher `origin/main` = `07c88f7a338b3e19a01070775e1f4d4cfc91f040` (LIN-4233, #328). **Same as the mint-time head.**
- Previous edition measured LinearViewer `d7ceb373444f9efbc027656132352d247535aa5e`, SD `d8d186c07113d6e61e3489e38f1210d0b0624cad`.

## Window (verified; `stale-ground.txt`)

- LinearViewer `d7ceb373..2eb73ae0`: 11 commits. Docs-only: `43dd0d64` (Seams run 6) and `476d9ad4` (11-04 run 2 report). Nine touch production: 44 files, +1,430 / -363. Added `lib/ruling-settled.js`, `lib/waiting-section.js`, `public/home-placement.js`; nothing deleted. Matches the description.
  - Per commit (production): c55f0fb3 17 files +252/-151; 950113b1 1 +5/-1; 279dcb0a 3 +54/-20; 94195271 9 +323/-48; ee8ec42e 9 +348/-62; 172f644a 5 +289/-5; 13fe24a0 4 +111/-50; c70b004c 3 +25/-12; 2eb73ae0 6 +26/-17.
  - The whole-repo diff (193 files, +97,883) is mostly evidence JSON under `docs/reviews/_evidence-2026-11-04-run{2,6}/` plus tests; `scripts/` outside code-shape: 4 measurement scripts, +13/-7.
- `scripts/code-shape/`, `lib/runner-kit/` and `docs/runner-prompt.md`: **0-line diff, no commits in the window. The description's claim is confirmed.**
- SD `d8d186c..07c88f7`: 4 commits (bf499a4 LIN-4218, 796bc9d LIN-4239, 580a5ea LIN-4240, 07c88f7 LIN-4233). Outside `test/`: `hook.js` +259/-260, `opencode-runner.js`, `docs/module-map.md` = 3 files +271/-265 (confirmed). Whole repo 16 files +23,607/-313; 22,619 of that is one golden fixture `test/fixtures/stop-relay-order.golden.json`.

## Census (`scripts/code-shape/census-review.mjs`)

Guide fixed for both runs: `areas-2eb73ae0.json` = HEAD `scripts/code-shape/areas.json`, sha256 `e3194f52a76ed595a93ce3aa11b259dfce84114230f99596784243a7d994159f`, git blob `642e9405`. Byte-identical to 11-04 run 2's `areas-d7ceb373.json` (the guide did not change in the window), so guide effect is zero by construction.

Scope: `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'` (the 11-04 run 2 pattern).

| key | code window | groups / mustRule / table / gone / unranked |
|---|---|---|
| R (reproduction) | `d7ceb373` vs `5334c81a` | 566 / 106 / 307 / 1 / 0, JSON equal to 11-04b W1 apart from the guide path |
| **W (reading)** | **`2eb73ae0` vs `d7ceb373`** | **566 / 105 / 309 / 1 / 0** |

W statuses: 562 unchanged, 1 new, 2 grown, 1 shrunk, 1 gone (`census-compare.txt`).
- `mustRule` 106 -> 105. 105 kept on (detector, decision, files): 55 identical sites, 50 shifted lines only. 0 joined.
- **Left `mustRule`: G0217 `outcome == 'dismissed'`** (11-04b ruling: borderline, "closed answered/dismissed set ... compared by readers in four files with no constant"). Now G0292, shrunk to 3 files / 2 areas and tabled: `routes/dashboard-rulings.js` lost its ternary (d7ceb373 `:318`). This is a re-key, not a resolution: the or-chain group `{'answered','dismissed'}` (11-04b table G0349) **grew** to 4 files, adding `routes/workspace-api-scan.js:389` (LIN-4241's settled check). Same closed set, one more reader file. Re-read in beat 2 against `lib/ruling-settled.js`.
- Gone G0214 / new G0211: the script list in `lib/render.js` + `lib/render-swipe.js` grew from +8 to +9 names (`/home-placement.js`, LIN-4243). Ledger row `vendor-script-list-restated`: one more entry in both copies, same two files.
- Grown G0231: `[usage]` text-contract marker back in the table at 3 files (`lib/session-telemetry.js` joins via LIN-4240's comments, which name the legacy untagged `[usage]` line). Comments, not a new reader; check in beat 2.

## Import graph (rebuilt walker, `import-walker.mjs`, copied unchanged from 11-04b)

| sha | nodes | static edges | dynamic | SCCs | upward static/dynamic | route->route |
|---|---|---|---|---|---|---|
| `d7ceb373` | 497 | 2,042 | 2 | 2 (6, 6) | 0 / 0 | 53 (reproduces 11-04b exactly) |
| **`2eb73ae0`** | **499** | **2,051** | 2 (same) | **2 (6, 6), same members** | **0 / 0** | **53** |

Edges: -1 (`render.js -> question-card.js`), +10: `waiting-section` wiring (render, server.js; it imports question-card, task-page-href, utils/html), `ruling-settled` imported by three routes (dashboard-rulings, workspace-api-issue-write, workspace-api-scan), and `kpi-stats` / `model-routing-history` -> `cost-read` (LIN-4226). No cycle closed.

`res.status(`: 275 (routes + server.js), 250 routes-only, 12 `status(<var>).json` at both SHAs, identical per file. LIN-4241's 409 does not add an inline `res.status`.

## Ledger and tickets

- `ledger-carry-11-04b.tsv`: 124 rows (121 carried + 3 new at 11-04b), stable names, current severity, 11-04b delta. Rows 25 and 30 hand-parsed (escaped pipe in a cell).
- `ticket-states-beat1.txt`: per-ticket state. Moved since 11-04 run 2:
  - **LIN-4234 Done** (2026-11-04 23:13, via `950113b1`) -> `erasure-inventory-lockstep-gap` likely resolved; verify the guard blind spot in beat 2.
  - **LIN-4151 Done** (2026-11-05 03:45, via `13fe24a0`) -> one of the six unparented Drift follow-ups closed.
  - LIN-4195 and LIN-4226 Done; LIN-3948 Canceled; LIN-4194 +1 comment.
  - Unmoved, 0 new comments: LIN-4210, 4156, 4157, 4158, 3822, 3835, 3836, 1496, 3736, 3624, 3823, 3636, 3649, 3843, 3979, 4214, 3449 (Todo, 44 children), 2798, 3484, 4217, 3236.
