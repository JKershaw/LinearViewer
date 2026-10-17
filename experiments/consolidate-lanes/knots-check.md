# Knots check: K1, K2, K3 on an exported copy of origin/main

## Base

- `origin/main` = `47d87055` (LIN-3604, #1913, already merged), fetched with `git fetch -q origin main`.
- It is four commits past the analysis tree `d349e78c`: LIN-3600 #1910, LIN-3602 #1911, LIN-3601 #1912 and LIN-3604 #1913.
- **Copy:** `git archive origin/main | tar -x -C copy/`, then `git init` and a commit on branch `base`. `node_modules` is symlinked from `/home/user/LinearViewer`.
- Each ticket's change was committed on its own branch from `base`: `k1`, `k2`, `k3`, plus the variants `k3r` and `k2c`. A `combined` branch merges k1, k2 and k3.
- `seams.mjs` was run on each commit with the unchanged `scripts/code-shape/areas.json`. Comparisons were made with `tools/seams-compare.mjs`.
- `/home/user/LinearViewer` was not modified.

**Baseline at origin/main:**
- 432 files, 4 unresolved, 0 unmapped.
- 62 link rows, 887 cross-area imports.
- **18 knots**, one group of 9 areas.

That is 2 fewer than `knots.md` counted at `d349e78c`, because LIN-3600 untied two. The three target knots have the same counts as in `knots.md`:
- Agent ↔ pages is still 2 / 1.
- Auth ↔ Providers is still 9 / 1.
- Other ↔ Runs is still 1 / 2. One of its Runs → Other edges now comes from `lib/dispatch-entrance.js:52` instead of `routes/dispatch.js`, moved there by LIN-3604.

The Agent → Providers link, which K1 grows, has gone from 18 (`knots.md`) to 17.

## Results

| Branch | Knots | Knot changes | Link changes | Other changes |
|---|--:|---|---|---|
| `k1` | 18 → **17** | GONE Agent ↔ pages 2/1; Agent ↔ Providers 17/6 → 19/6 | Agent→pages 2→0; Agent→Providers 17→19 | rows 62→61; cross 887→887; entry `tree.js` loses Agent (15→13), `state-map.js` gains Agent (6→8) |
| `k2` | 18 → **17** | GONE Auth ↔ Providers 9/1 | Providers→Auth 1→0; Auth→Providers 9→10 | rows 62→61; cross 887→887; Providers internal 38→39; entry `token-refresh.js` loses Providers (2→1), `interface.js` 1→2 importers |
| `k2c` (class only) | 18 → 18 | Auth ↔ Providers 9/1 → **10/1** (not untied) | Auth→Providers 9→10 | shows the timeout has to move too |
| `k3` (preferred, no re-export) | 18 → **17** | GONE Other ↔ Runs 1/2 | Other→Runs 1→0; Runs→Other 2→3; Agent→Other 2→3 | rows 62→61; cross 887→888; entry `periodicals.js` 6→8 importers, gate loses Other (2→1) |
| `k3r` (re-export) | 18 → **17** | GONE Other ↔ Runs 1/2 | Other→Runs 1→0; Runs→Other 2→3 | rows 62→61; cross 887→887; `periodicals.js` 6→7 importers |
| `combined` (k1+k2+k3) | 18 → **15** | the three GONE, plus Agent ↔ Providers 17/6 → 19/6 | union of the k1, k2 and k3 links | each ticket's deltas unchanged |

- No branch created a new knot pair or changed the knot groups.
- Raw output:
  - `seams-base.json`;
  - `seams-{k1,k2,k2c,k3,k3r,combined}.json`;
  - `seams-diff-*.txt`.
- `seams.mjs` took about 0.8 s per run.

## Conflicts

| | K1 files | K2 files | K3 files |
|---|---|---|---|
| Files | `lib/providers/state-map.js`, `lib/tree.js`, `lib/graph-features.js`, `routes/proxy.js`, `routes/proxy-compute.js` | `lib/providers/interface.js`, `lib/token-refresh.js`, `lib/providers/jira/oauth.js` | `lib/periodicals.js`, `lib/periodical-report-gate.js`, `routes/proxy-writes.js`, 5 test files |

- **Among the three:** no file is shared, and `git merge` of k1, k2 and k3 is clean. Any merge order gives the same deltas.
- **With LIN-3604** (`routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js`, `lib/dispatch-entrance.js`):
  - **no overlap**;
  - LIN-3604 is already merged at `47d87055`;
  - K3 touches neither `lib/dispatch-entrance.js:52` nor `lib/dispatch-validation.js:17`, the two importers of `lib/periodicals.js`;
  - each ticket tells the worker to keep out of those four files.

## Unit tests

Runs used the copy, with a socket guard that refuses every non-loopback connect (`tools/block-net.mjs`). Nothing was refused in any run.

| Set | Result | Time |
|---|---|--:|
| K1 named (9 files) | 265 / 265 | 1.2 s |
| K1 broad (139 files: every unit file importing a K1 file) | 3,054 / 3,054 | 33 s |
| K2 named (15 files) | 459 / 459 | 3.0 s |
| K2 broad (88 files) | 2,380 / 2,380 | 23 s |
| K3 named (6 files) | 549 / 549 | 1.6 s |
| K3 broad (214 files) | 4,332 / 4,332 | 94 s |
| Full `tests/unit/*.test.js` on `combined` | 17,424 / 17,424 | 215 s |
| `eval-dense.test.mjs` + `seams.test.mjs` on `combined` | 12 / 12 | 1.9 s |

This was a socket guard, not `npm run test:hermetic`; CI runs that.

## Replays (old function vs new, old from an export of `base`, new from an export of the branch)

| Ticket | Script / output | Cases | Diffs | Controls |
|---|---|--:|--:|---|
| K1 `isBlocked` | `tools/replay-k1.mjs` / `replay-k1.txt` | 8,200 | 0 | old vs old 0; mutant (terminal check dropped) 453; tree.js, recommendation-facts and state-map export the same function object |
| K2 refresh contract | `tools/replay-k2.mjs` / `replay-k2.txt` | 101 | 0 | the class is one object across `token-refresh.js` and `interface.js`; timeout 10000, tombstone 30300 / 35300 unchanged; Jira errors classify identically |
| K3 marker trio | `tools/replay-k3.mjs` / `replay-k3.txt` | 9,828 | 0 | slug mutant caught on 1,909 / 2,029 titles; gate, resolve, `getPeriodicals` and `buildPeriodicalNodes` identical; `periodicals.js` has no imports left |

**Moved text:**
- K1's function lines and K3's code lines are byte-identical to the old blocks (`k1-moved-old.txt`, `k3-moved-old.txt` against the new files).
- The only differing lines are the doc-comment edits each ticket names.
- K2's class and constant are byte-identical.

## Source-text pins

Searched `tests/`, `scripts/` and `docs/architecture/` at `47d87055` for any test that reads a moved file's source and pins the moved code's location. **There are none for any of the three.**

| Ticket | Nearest source-text test | Effect | How the ticket treats it |
|---|---|---|---|
| K1 | `tests/unit/lin-2525-assignee-filter-wiring.test.js:46-48` pins `server.js` importing `expandToTreeContext` and `nodeKey` from `lib/tree.js` | different symbols | unaffected |
| K2 | `tests/unit/lin-3124-pr3-checkpoint-c3.test.js:110-118` pins `LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS`'s definition in `lib/token-refresh.js` | that constant does not move | left as it is |
| K3 | `tests/unit/periodical-report-gate.test.js:34` asserts the marker's text shape | behaviour, not location | unaffected |

Everything else imports the functions by module. On K1 and K2 the re-export keeps those imports working. On K3's preferred route the five test imports are repointed. Each ticket still says: if a location pin turns up, convert it to behaviour, with the replacement shown failing first.

## Decisions on the two judgement calls

- **K2: kept, and widened to the timeout.** This decision has been withdrawn: the fresh-reader check found that Auth also throws the class, so I now recommend dropping K2. See the disposition section at the end.
  - `jira/oauth.js:38` imports `TokenRefreshError` **and** `TOKEN_REFRESH_TIMEOUT_MS`. Moving the class alone leaves the knot (`k2c`: 10 / 1).
  - Both refreshers sit behind one seam (`server.js:1075-1078`) and throw the class. The auth policy that acts on the codes stays in `token-refresh.js`. The precedent is `AuthExchangeError` in `interface.js`.
  - The timeout is the per-attempt budget both use, and `workspace-token-cache.js` derives its tombstone window from it.
  - Rejected: a separate Jira literal, because it would let the two budgets drift.
- **K3: kept.**
  - `periodicals.js` writes the marker and maps it back (LIN-2575). The slug's value matters only to that join; the gate checks presence only.
  - The gate keeps the Done-evidence rule and stays in Runs.
  - No cycle results: `periodicals.js` ends with no imports.
  - The counter-reading, that the gate owns the marker because LIN-694 made it for the gate, is stated in the ticket. It was rejected because the gate's real decision is the evidence bar.

## Files in this folder

- **Tickets and predictions:** `ticket-K1.md`, `ticket-K2.md`, `ticket-K3.md`, `prediction-K1.md`, `prediction-K2.md`, `prediction-K3.md`.
- **Copy and exports:** `copy/` (the git copy with all branches), `tree-base/`, `tree-k1/`, `tree-k2/`, `tree-k3/` (exports for the replays).
- **Tools:** `tools/` (`seams-compare.mjs`, `block-net.mjs`, `replay-k{1,2,3}.mjs`).
- **Test logs:** `k{1,2,3}-tests.out`, `combined-unit.out`.

## Fresh-reader findings (`fresh-reader.md`): disposition

Each finding was checked against `origin/main` (`47d87055`, unchanged) before it was applied.

- **M-shared (K1, K3): applied.**
  - Each Goal line now reads "Knots go down by one (18 → 17 at `47d87055`)".
  - The baseline sentence now tells the worker to take "before" from their own `origin/main` run, and names the only totals that shift when a sibling merges first.
  - K3's wording is adapted, because K3 itself is the ticket that moves cross-area imports.
- **K1-1 to K1-7: all applied.**
  - K1-1 and K1-2 were re-applied on the copy as branch `k1b`. Its seams output is identical to `k1`, the named tests pass 265 / 265, and the diff is now 6 files, +39 / −35.
  - K1-4 was extended. The local provider counts outgoing `'blocked-by'` relations (`local/index.js:266-268`), which `isBlocked` does not read. The ticket names this divergence as out of scope; the move doesn't change it.
- **K3-1 to K3-5 and the optional presence note: all applied.**
  - K3-5's two extra test files were already in the 214-file run.
- **K2-1 to K2-8: not applied. I recommend dropping K2, and I did not add the rebuttal.** The ownership case doesn't hold at `origin/main`:
  - **Auth makes and throws the class.** It defines the class's consequences (`isDefinitiveRevocation` and `isTransientRefreshFailure`, LIN-1545). It throws it from its own rotation paths, with `EXPIRED` at `connection-credential.js:397` and `workspace-token-refresh.js:406`, and with `UNKNOWN`, used only there, at `:438` and `:566`. Linear's refresher, which throws it at `token-refresh.js:86-197`, is also filed under Auth.
  - **Providers throws it from one file only:** `jira/oauth.js`.
  - **The interface precedent doesn't fit.** The provider interface's own refresh method, `refreshCredential` (`interface.js:444-453`), does **not** throw `TokenRefreshError`. GitHub's re-mint throws a plain `Error` (`server.js:1889-1901`). So the class is not "the contract every provider refresher speaks", and the proposed rebuttal ("the class still has to be shared by every provider refresher") would rest on a false premise. By contrast, `AuthExchangeError` is thrown only by providers (`github/app-auth.js:577`, `linear/index.js:2296`).
  - **So the owner is Auth.** Under the rule, the area that would change if the taxonomy changed is Auth. `jira/oauth.js:38` then points from a user to the owner and is the right direction. The knot holds two real owners, and moving the class would bend code to untie it. The K2 files are left as they were for the record.
