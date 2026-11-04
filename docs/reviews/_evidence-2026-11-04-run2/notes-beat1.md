# LIN-4232 beat 1: grounding and re-measure (notes, uncommitted)

Measured 2026-11-04 ~18:30Z. Review-only: nothing outside this folder was changed. These are measurements, not findings.

## 1. HEADs and window

| repo | `origin/main` now | mint probe | moved? |
|---|---|---|---|
| LinearViewer | `d7ceb373444f9efbc027656132352d247535aa5e` | `d7ceb373…` | **no** (local `main` = `origin/main` after `git fetch`) |
| simple-dispatcher | `d8d186c07113d6e61e3489e38f1210d0b0624cad` | `d8d186c…` | **no** |

**LinearViewer `5334c81a7207b9f2cc85ca429a2c6b18e1635c0e..d7ceb373`: 8 commits** (`git rev-list --count`).
- Docs-only (0 non-`docs/` files): `e439f637` Seams run 5, `1403d52d` Code Quality, `57b22b92` Stability, `f5bc752c` 11-04 Drift.
- Code: `230cc2c2` LIN-4200 (5 files, all non-docs), `eb44eff9` LIN-4212 (13 non-docs of 15), `2ee4e600` LIN-4201 (105 non-docs of 106), `d7ceb373` LIN-4203 (11 non-docs of 15).
- Production (`lib routes public server.js`): **33 files, +1,049 / −288**. Added `request-usage-fold`, `request-usage-loader`, `request-usage-vocabulary`, `usage-snapshot-intake`, `workspace-kpis-cache` (all `lib/`); deleted `lib/founder-lookup.js`. All match the description.
- Runner kit: `lib/runner-kit/runner.mjs` +15/−59, `docs/runner-prompt.md` +6/−7, `contract.json` 0. `scripts/code-shape/areas.json` +2/−2.
- The description's per-file sizes are total changed lines, not insertions: `request-usage-intake.js` is +10/−3 ("+13"), `session-telemetry.js` +6/−9 ("+15/−"), `routes/dispatch.js` +4/−4 ("+8/−"), `runner.mjs` +15/−59 ("+74/−"). This changes no conclusion.

**SD `502901c3e9a36b90eeafd95f23b59f35ef80c195..d8d186c`: 8 commits**: `52d2c3d` 4220, `54febbf` 4223, `90bbf82` 4221, `3330526` 4222, `86bde97` 4224, `7d515d3` 4219, `44ab30e` 4203, `d8d186c` 4187. In all: 92 files, +5,993 / −1,442. Outside `test/`: **12 files, +177 / −332**. The production JS among them is 7 files (`config.js`, `hook.js`, `opencode-runner.js`, `transcript.js`, `request-usage-flush.js`, `request-usage.js`, `opencode-request-records.js`), plus `package.json` and 4 docs. Only `44ab30e` (LIN-4203) touches production JS. `86bde97` and `d8d186c` touch docs and package.json; the other five are test-only.

## 2. Baseline read

- `drift-coherence-review-2026-11-04.md` read in full: 812 lines, 16 sections.
- **Compact trend ledger: 121 data rows confirmed.** Each has 16 columns: `finding | severity | 06-25 | 07-12 | 08-29 | 2026-09-26 | 2026-10-11 | 10-11 post-batch | 10-12 post-batch-3 | 10-18 | 10-19 | 10-23 | 11-03 (this run) | delta vs 10-23 | 11-04 (this run) | delta vs 11-03`. Rows 115-121 are the 11-04 additions. To add this edition, rename `11-04 (this run)` to `11-04`, then append `11-04b (this run)` and `delta vs 11-04`, giving 18 columns.
- **Evidence convention.** The 11-04 Drift edition committed **no** evidence folder. Its census guides and the walker sat in `<scratch>`, and it says `_evidence-2026-11-04/` belongs to Seams run 5 (LIN-4208). The 11-03 Drift edition also kept its tools in scratch. So `_evidence-2026-11-04-run2/` is new for Drift. It does not collide with `_evidence-2026-11-04/`, which is untouched. Seams' layout is the closest model: guide byte-copies named `areas-<sha8>.json`, outputs named `<tool>-code-<sha>-guide-<sha>.json`, plus a README.
- 11-03 edition skimmed (headline, 3490 rule, method).
- **Sibling hand-offs to Drift** (11-04 reports):
  - Seams run 5: the browser mirror `public/cost-format.js` and its parity pin are Drift's. Comment hygiene on the deleted `task-cost` (N8: `areas.json:24` still lists `task-cost|`; comments at `model-routing-spend.js:5`, `wall-clock-summary.js:97`, `runner-kit/runner.mjs:768`) is Drift's. The production→test-fixture half (`server.js:140` importing `routes/test.js`) is Drift's. Auth→LLM 4 edges are cross-linked. The kit's HTTP post to the intake is Drift's wire contract.
  - Stability: `lib/poll-halt.js` has had 0 touches since 10-08. The halt duplication half stays with Drift. The `prompt-section.js` client-copies-server-rules concern is Drift's.
  - Code Quality: F-hidden-dup is cross-linked to `mock-ai-builder-copies`.

## 3. Census: one guide, both commits

Tool: `scripts/code-shape/census-review.mjs`, scope `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'`. Guides are byte copies made with `git show "${sha}:scripts/code-shape/areas.json"`.

| guide | sha256 (11-04 convention: 8-char prefix) | git blob |
|---|---|---|
| HEAD `d7ceb373` (**the fixed guide for this run**) | **`e3194f52`**a76ed595a93ce3aa11b259dfce84114230f99596784243a7d994159f | `642e9405` |
| old `5334c81a` (11-04's HEAD guide; byte-identical to `_evidence-2026-11-04/areas-5334c81a.json`) | `502d3ff0`ea0579ea5139ee82d483fa1da3bb97eee4dfc264d17fb8a2c9d0e195 | `816b2e66` |

The guide diff (LIN-4201) is two lines. "Runs & dispatch" gains `cost-read|row-usage|lineage-membership`, and "Reports & operator tools" gains `workspace-kpis-cache`.

| key | code window | guide | groups / mustRule / table / gone / unranked |
|---|---|---|---|
| R1 | `5334c81a` vs `015aa4c6` (11-04's window) | old `502d3ff0` | **565 / 106 / 309 / 3 / 0**, reproduces 11-04 W1 exactly |
| R2 | `5334c81a` vs `015aa4c6` | HEAD `e3194f52` | 565 / 106 / **308** / 3 / 0 |
| **W1** | **`d7ceb373` vs `5334c81a`** | **HEAD `e3194f52`** | **566 / 106 / 307 / 1 / 0** |
| W2 | `d7ceb373` vs `5334c81a` | old `502d3ff0` | 566 / 106 / 309 / 1 / 0 (what the old guide would give) |

**Guide effect** (W1 vs W2 over the same code). 0 groups appear or vanish. 6 groups lose an area:
- `completeness == 'no-usage'` drops out of the table (2→1 area).
- `kind == 'usage'` drops out of the table (2→1 area).
- `completeness == 'complete'` loses an area but stays in the table.
- Three mustRule groups lose an area and stay mustRule: `harness == 'opencode'` (4→3), `kind == 'wake'` (3→2, still top-25), `status == 'taken'` (2→1, still top-25).

So the guide accounts for **−2 table and 0 mustRule**. On the 11-04 window it gives −1 table (R1 vs R2: `no-usage` drops out).

**Code effect** (W1 statuses, one guide). 559 unchanged, 2 new, 4 grown, 1 shrunk, 1 gone.
- **Among the 106 mustRule groups: 0 moved status. The set is identical to 11-04's 106** (joined on detector + decision + files). 74 have identical `file:line` site lists; 32 kept their files and shifted lines only, mostly `server.js`, `routes/proxy-compute.js` and `dispatch-store.js`; 0 changed file set.
- Table groups: one grown, `completeness == 'complete'` (now `cost-read.js`, `request-usage-fold.js`, `row-usage.js`; 3 files / 6 sites).
- Gone (1): `G0153`, the token-field set `{cacheCreation1hInputTokens, cacheCreationInputTokens, cacheReadInputTokens, inputTokens, outputTokens}` over `request-usage-store.js`, `row-usage.js`, `runner.mjs`, `session-telemetry.js`. It is replaced by new `G0339` (not table) over `request-usage-vocabulary.js` + `runner.mjs` only. That looks like a consolidation of the Harbour token-field list into the new vocabulary module, which beat 2 must confirm on the sites. The kit copy remains.
- Shrunk: the `[usage]` marker contract, now only `effort-readout.js` and `liveness-detectors.js`, 1 area. It left the table.
- Other changes, all outside rule and table: new `kind == 'usage'` (`dispatch-store.js`, `row-usage.js`); `no-usage`, `unreadable` and `present` grew in `cost-read.js` / `row-usage.js`.

**Against 11-04's 565 / 106 / 309 / 3:** now 566 / 106 / 307 / 1. Table −2 comes from the guide (the old guide would give 309). Table +1 / −1 comes from code (`complete` in; token set and `[usage]` out). Like-for-like under the one HEAD guide, it moves 565/106/308/3 → 566/106/307/1. Note that group ids renumber between runs: 11-04's G0136 (`state == 'failed'`) is not this run's G0136, so join by decision.

## 4. Import graph

Walker K was never committed (it lived in scratch in 11-03 and 11-04). I rebuilt it to the documented spec:
- static `import` / `export … from`, with dynamic `import()` counted separately;
- scope `server.js`, `lib/**`, `routes/**` (`.js/.mjs/.cjs`), read from git blobs and parsed with the repo's acorn;
- Tarjan SCCs.

**It reproduces both earlier editions exactly** (`015aa4c6`: 486 / 1,993 / 2 dyn / 6+6 / 0 / 53; `5334c81a`: 493 / 2,026 / 2 / 6+6 / 0 / 53). A copy is in `import-walker.mjs`.

| sha | nodes | static edges | dynamic | SCCs | upward lib→routes/server (static/dynamic) | route→route |
|---|---|---|---|---|---|---|
| `5334c81a` (11-04) | 493 | 2,026 | 2 | 6 + 6 | 0 / 0 | 53 |
| **`d7ceb373`** | **497** | **2,042** | 2 (same two) | **6 + 6, same members** | **0 / 0** | **53** |

Edge diff: 4 removed, all through `founder-lookup.js` plus `terminal-marked-task-cost→row-usage`. 20 added, all new request-usage / kpis-cache wiring. Of note:
- `row-usage`, `session-telemetry` and `request-usage-store` now import `request-usage-vocabulary`.
- `workspace-kpi-stats` now imports `dispatch-store` directly, where it used to go through `founder-lookup`.
- `request-usage-loader` imports `lineage-membership`.

None of these closes a cycle. Full list: `import-graph-diff.txt`.

## 5. `res.status(`

| sha | `routes/` lines | `routes/` + `server.js` lines (11-04's scope) | `res.status(<var>).json` |
|---|---|---|---|
| `015aa4c6` | 246 | 271 | 10 |
| `5334c81a` | 250 | **275** | 12 |
| `d7ceb373` | 250 | **275** | 12 |

Unchanged, and per-file counts are identical. The 11-04 figure of 275 is routes/ + server.js. routes/ alone is 250.

## 6. Ticket state, by diff (fetched ~18:35Z; the 11-04 run ended ~08:49Z)

| ticket | now | 11-04 edition said | delta |
|---|---|---|---|
| LIN-4210 | Backlog, parent 3449, 0 comments | minted, Backlog | none |
| LIN-4156 / 4157 / 4158 | Backlog, parent 3449, 0 comments each | same | none |
| LIN-3822 / 3835 / 3836 / 1496 / 3736 | Backlog, parent 3449; comments 3/1/1/6/3, last 11-03 07:30 | same | none |
| LIN-3624 | Backlog, parent 3449, 6 comments, last 11-04 08:41 | "five comments", then commented | +1 = the 11-04 run's own comment; nothing since |
| LIN-3823 / 3636 / 3649 / 3843 / 3979 / 4151 | Backlog, **no parent**; comments 2/7/3/1/2/2, last 11-03 07:30 | six unparented | none; still unparented |
| LIN-3449 | Todo, **43 children**, 22 comments, last 11-04 08:41 | 41 children, 21 comments | +LIN-4210 (11-04 mint), **+LIN-4214** (see below); +1 comment = the 11-04 log entry |
| LIN-4195 | In Progress, parent LIN-3936, 9 children, 16 comments | In Progress | 8 comments since; final piece-6 report at 17:07 says the flag "now gates every record flush at one chokepoint", citing `usage-relay-flag-partial`. **The description still reads "L1 (relay flag off) is closed"** (unedited) |
| LIN-4200 | Done 08:46 | state not stated; named as "the measurement gate" | Done |
| LIN-4212 | Done 11:14 | (not listed) | Done |
| LIN-4201 | Done 16:38 | Todo | Done |
| LIN-4203 | Done 17:45 | Todo | Done; review (17:13) confirms all five seams reach `flushRequestUsage` |

**Not in the description's list: LIN-4214.**
- Facts: Backlog, parent LIN-3449, `kind:follow-up`, 0 comments, created 2026-11-04 08:48Z by the LIN-4209 retrospective audit. Title: "Simple-dispatcher: SD_WORKER_USAGE_RELAY=0 does not stop request-record posts from the fail, cancel, stall and reap seams".
- It is the ticket for `usage-relay-flag-partial`. The 11-04 report's "not minted" line was overtaken 7 minutes after merge.
- Its code question appears addressed by SD `44ab30e`. Its "unvalidated idea" (gate inside `flushRequestUsage`) is exactly what landed. Neither the LIN-4203 nor the LIN-4195 close-out names LIN-4214, and it is still open.
- Its acceptance asks for one flag-off test per seam. What landed is a flag-off test at the chokepoint (reap seam + Stop), not one per seam (beat 2 to confirm).
- So the Backlog Drift-family count is **17**, not the description's 16.

## 7. Stale-ground check (`git diff --numstat` + `git log` over each window)

- LinearViewer, 0 lines and 0 commits: `dispatch-factory.js`, `follow-up-dispatch.js`, `errors.js`, `workspace.js`, `poll-halt.js`, `workspace-halt.js`, `home-view.js`, `task-order.js`, `providers/state-map.js`, `runner-kit/contract.json`. Also clean: `render.js`, `render-settings-workspace.js`, `settings-areas.js`, `workspace-change-log.js`, `public/session.js`, `render-task-page.js`, `public/task-page.js`, `unanswered-decisions.js`, `routes/proxy-runner.js`, `dispatch-validation.js`, `consumer-heartbeat.js`, `dispatch-wake.js`, `vendor-assets.js`, `dashboard-session-state.js`, `lineage-membership.js`, `dispatch-lineage-status.js`.
- LinearViewer, touched (cited-row files): `dispatch-store.js` +75/−4 (the `lineage-identity-read-twins` site), `row-usage.js` +34/−7 (`cost-fold-partition-restated`), `key-state-holders.js` +10/−1 (`key-state-residue`), `routes/test.js` +5/−1.
- SD, 0 lines and 0 commits: `harnesses.js`, `dispatcher.js`, `reapers.js`, `subscription.js`, `halt.js`, `followup.js`, `host-heartbeat.js`, `queue.js`, `auth-stop.js`, `test/fixtures/runner-contract.json`.
- All "no diff" claims in the description hold.

## Surprises

1. **LIN-4214** exists and is missing from both the 11-04 report and this task's description (section 6).
2. **The relay flag is gated at one chokepoint now** (`request-usage-flush.js:114`, `if (!WORKER_USAGE_RELAY) return NOTHING;`). All five seams reach it through `flushRequestUsageDetached` → `flushRequestUsageSafely` → `flushRequestUsage`, and `dispatcher.js` and `reapers.js` did not need to change. This is a strong candidate for "resolved", but it is not a finding until beat 2 reads it in full. LIN-4195's description line is still unedited.
3. **The census shows the window as almost inert for Drift:** 0 mustRule status moves. The only movement is the usage vocabulary: the token-field set re-keyed onto `request-usage-vocabulary.js` and the `[usage]` marker shrank.
4. **No committed walker or Drift evidence** existed for 11-03 or 11-04. The graph numbers are reproducible only by the re-implementation here, which matches them exactly.
