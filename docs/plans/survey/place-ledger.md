# The place ledger: does a finished task leave the codebase better?

John's tipping point (4 Nov): when a task, on average, leaves the codebase even a little better once it's finished, we're in a strong place. Bigger improvements not tied to a ticket can stay with the Periodicals and the tally of broad options (`broad-options.md`). This ledger keeps the running answer, one row per merged ticket.

**How a row is read.**
- **Map:** `experiments/place-change/place-change.mjs <repo> <merge>^ <merge> scripts/code-shape/areas.json`, covering new files with no home, two-way pairs grown or shrunk, and new or closed pairs. It's LinearViewer only for now, since simple-dispatcher has no area guide.
- **Copies:** what the next Drift & Coherence reading attributes to the ticket (new rows, improved rows), plus files and functions deleted.
- **Carried:** whether the ticket carried any tally row or routed Periodicals finding.
- **Balance:** `+` better, `0` neutral, `−` worse. It's a judgement from the three columns above, written with its reason. **Guide edits are counted separately**: a home on the map is credited only if the area is real.

## Baseline: the window `015aa4c6..5334c81a` (3–4 Nov), measured before the loop's place view existed

| Ticket | Map | Copies (Drift 11-04) | Carried | Balance |
|---|---|---|---|---|
| LIN-4168 one test reset | +5 cross-area; 2 new files with no home | `key-state-residue` (informational) | n/a | **−** a holder registry with no home on the map |
| LIN-4166 quiet follow-ups | no change | none | n/a | 0 |
| LIN-4173 one exported 7-day window | no change | removed a Harbour copy of the window; `reap-window-constant-cross-repo` still open | n/a | **+** (small) |
| LIN-4177 one cost read | +7; 2 with no home (the hub); two pairs grew, two shrank | `cost-fold-partition-restated` (new); USD 12 → 5 | n/a | **−/+** six engines gone, but a hub with no home |
| LIN-4178 KPIs on the read | +11; 1 with no home; Pages↔Other and Other↔Runs grew | `lineage-identity-read-twins` (new, `founder-lookup.js`) | n/a | **−** a new twin, invited by the ticket's own wording |
| LIN-4179 Harbour calls on the read | +7; Pages↔Other and LLM↔Other grew; Other↔Runs shrank | USD to one home plus a pinned twin (improved) | n/a | **0** |
| LIN-4198 request-usage intake/store | +5; files have a home; three Runs knots +1 | `usage-record-vocabulary-two-readers` (new) | n/a | **−** (small); new capability, expected to grow |
| LIN-4202 runner-kit records | no change | `usage-relay-flag-partial` (new, SD side) | n/a | **−** (small) |
| UI operator's four (LIN-4106, 4107, 4110, 4040) | no change | `task-page-state-outside-owner`: borderline | n/a | 0 |

**The baseline ratio, by row:** 1 better (LIN-4173), 3 neutral (LIN-4166, LIN-4179, and one row for the UI operator's four), 4 worse (LIN-4168, LIN-4178, LIN-4198, LIN-4202), 1 mixed (LIN-4177). On average, a task in this window left the place a little worse, including the careful, surveyed consolidations.

## Forward rows (the loop with the place view)

| Ticket | Map | Copies | Carried | Balance |
|---|---|---|---|---|
| LIN-4212 (records read by posting row; **no Survey**: filed and started mid-lineage) | no change (1262 → 1262; no new files, no pair moved) | prod +167 / −26; Drift not yet re-read | nothing routed | **0** |
| LIN-4201 (records-first read) | Same guide on both sides (the merge's): +8 cross-area imports, no new pair; Other↔Runs shrank; **LLM↔Runs (the High F1 knot) +2 edges**. Every new file has a home. **The guide edit gave `cost-read`, `row-usage` and `lineage-membership` a home in Runs**, beside their store: a real home, counted separately. `cost-format` is still in the catch-all | **`founder-lookup.js` deleted (the twin is gone)**; one loader, the only new importer of the store; one vocabulary module; one fold. Prod +804 / −202 | carried 3 of the 4 routed findings for certain (twin, vocabulary, home); the restated partition and "loading part of the read" are to confirm with the builder | **+ (mixed)** copies down and homes given; the hub's reach moved into the existing F1 knot rather than removed; net +602 lines |
| LIN-4203 (stop snapshots) | Harbour: +2 cross-area imports; **one new file without a home** (`lib/usage-snapshot-intake.js`, the intake counter, in the catch-all); Other↔Runs +1 | **simple-dispatcher shrank about 930 lines net** (non-test +42 / −315, tests +119 / −778); `postUsageSnapshot`, `walkUsage`, `postUsageFeedback`, `fetchSessionRollup` and `usageDelta` all gone; **the flag gates every record flush** (Drift #9 carried) | the routed relay-flag finding | **+** the first ticket in the ledger to make the codebase smaller; one small homeless file |
| LIN-4218 (one Stop sequence) | *not started; after LIN-4203* | | the tally's "one Stop tail" row (three namings), priced | |
| LIN-4220 (harness 1/5: `childEnv(mode)`) | simple-dispatcher, no map. **One owner for nested envs**: the five hand-built sites moved onto `test/child-env.js`; `delete env.NODE_TEST_CONTEXT` and hand-built `NODE_OPTIONS` gone elsewhere | `child-env-census` guards it; tests +1,351 / −65 (characterization, drift and census tests) | the tally's shared-harness row | **+** a decision spread over five places now has one owner and a guard |
| LIN-4223 (harness 4/5: one group stop) | `stopGroup`/`groupAlive` out of `run-mutations.js` into `test/system/harness/stop-group.js`, with a sync variant for `reap.js`; Harbour's stop uses it | `harness-kill-census` added, but **two unit tests' own `process.kill(-…)` are allowlisted, not removed** (the scope said gone); tests +1,002 / −42 | same | **+** one owner and a guard; partial against the scope (the two copies are frozen, not deleted) |
| LIN-4221 (harness 2/5: exit codes and pre-flight) | one `exit-codes.js` imported by both runners, `harbour.js` and `isolate-run.js`; `preflight.js` with a gap report | tests +1,147 / −66, including a characterization of the mutation runner's exit codes | same | **+** "couldn't run" now has its own code and one owner |
| LIN-4222 (harness 3/5: ports) | **0 literal ports left** in `test/system/*.test.js` (35 files touched); `ports.js` owns them, OS-assigned, with an empty fixed-port registry | tests +427 / −69 | same; took the broad option (OS-assigned) | **+** a prerequisite removed rather than checked |
| LIN-4224 (harness 5/5: scripted baseline) | `npm run test:baseline` (a `git worktree` of `main`, JSON, `--against`) replaces the by-hand table; the docs say which skip rule applies to which tier | tests +1,464 / −11; docs +135 / −17 | same | **+** a by-hand procedure done three times (once wrong) is now one command |
| LIN-4219 (heavy-test harness, parent) | Done (`7d515d3`: the group-stop witnesses now run in `npm test`) | | | **+** (its five pieces above) | | the tally's shared-harness row (four namings), priced; scope: the union of both step-backs, in 5 pieces | |
| LIN-4187 (+ LIN-4188 folded in) | simple-dispatcher: **27 of 27 system scenarios carry a Harbour-contract note**, enforced by `system-contract-census`; the assertion re-stated as Harbour's current contract | tests +286 / −57; non-test ±6 | ruled drift; the larger scope landed, LIN-4188 included | **+** the next drift reads "Harbour changed X"; two reds closed in one ticket |
