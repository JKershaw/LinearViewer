# Integration & Surface Maturity Review — 2026-11-10

*Advisory, review-only. Periodical: **Integration & Surface Maturity** (LIN-1336). This is the periodical's **fifth**
run (LIN-4407), a trend delta against
[`docs/reviews/integration-surface-maturity-review-2026-10-21.md`](./integration-surface-maturity-review-2026-10-21.md)
(run 4, LIN-3765/3766, PR #2036, squash `38760071`, scored at LinearViewer `c5694b68` / simple-dispatcher `bb1da78`).
Earlier runs: baseline [`…-2026-07-17.md`](./integration-surface-maturity-review-2026-07-17.md), run 2
[`…-2026-08-29.md`](./integration-surface-maturity-review-2026-08-29.md), run 3
[`…-2026-09-26.md`](./integration-surface-maturity-review-2026-09-26.md). It mints no follow-up tasks or sub-issues
and writes no area-note entries (advisory templates render without `notes`, `lib/periodicals.js:114-115`). It hands a
maintainer a maturity read framed as a **trend**, and leaves every decision to them.*

*Method this run: **scripted reconciliation first, prose second.** Every table below marked "generated" is rendered
from one machine-readable file, `trend-ledger.json`, by a script whose full text is in `rerun-outputs.md`; a re-run
produces no diff. Evidence folder: [`docs/reviews/_evidence-2026-11-10-ism/`](./_evidence-2026-11-10-ism/) —
`trend-ledger.json`, `run4-ledger.json` (run 4 parsed: 52 rows, R1–R17), `sweep-dispositions.csv` (189 rows),
`citation-repoints.csv` (291 rows), `done-writers.md`, `r12-members.md`, `r16-members.md`, `rerun-outputs.md`.*

---

## Re-grounding (fetch, HEAD pins, drift)

`git fetch` was run in both repos at 2026-11-10T11:15Z. Scoring pins: **LinearViewer `9cf51ef72`**
(`9cf51ef7210f836c350d9d1d34e088a1bd850bcb`, `origin/main`) and **simple-dispatcher `5d8489e`**
(`5d8489e7fd8434f0e69af7df11a3746790abbe64`, `origin/main`). Commands and verbatim output: `rerun-outputs.md` Q1–Q3.

**First finding — drift from the mint text.** The task was minted at LinearViewer `f5b1f5efa`. Since then
`origin/main` moved by six commits, all LIN-4404 (whole-life task cost read, `fa4bb76fb` … `9cf51ef72`), touching
`lib/cost-read.js`, `lib/dispatch-store.js`, `lib/pipeline-loops.js`, `lib/proxy-instructions.js`, `lib/read-horizon.js`,
`docs/areas/areas.json` and docs. That lands inside `flow-cost-telemetry` and is read at the pin. simple-dispatcher did not
move. Every mint number was re-measured; where it differs, the measured one is used:

| Item | Mint said | Measured at the pin |
| -- | -- | -- |
| LV window `c5694b68..` | 450 commits | **456** (417 non-merge); 258 touch `lib`/`routes`/`server.js` |
| LV window from `38760071` | 448, 255 touching code | **454**, 258 touching code |
| LV added under `lib`, `routes`, `public` | 98 + 8 | **107**: `lib/` 62, `lib/components/` 14, `lib/prompts/` 4, `lib/sample-data/` 1, `routes/` 18, `public/` 8 (one is `public/logo/og-image.png`). No renames (`-M` finds none) |
| LV deleted | 5 | **10**: the mint's five, plus `public/{chart.umd.min,marked.min,purify.min}.js` (moved behind `lib/vendor-assets.js`, LIN-3787) and `public/next-run.{js,css}` |
| `routes/workspace-api-*.js` | "nine siblings" | 9 siblings exist; **7 were added in the window** (`-roadmap` and `-prompts` predate it). `routes/workspace-api.js` 3,782 → 916 lines; the ten files total 5,213 |
| SD window `bb1da78..` | 67 commits, 255 files, +47,108/−3,427 | reproduces exactly; 208 of the 255 files are under `test/` (123 added), 47 are not |
| Areas feeding Waiting entries | (research: Seams & Tangles and Drift & Coherence) | **three** periodicals: Seams & Tangles (4 entries), Drift & Coherence (3) and **Design & Interface 2026-11-08 (8)**; plus 16 builder "Survey tally" entries |
| `request-usage-flush.js:10-16` producer contract | cites `routes/dispatch.js:1668` | the route is now at `routes/dispatch.js:1671` (a three-line consumer-comment drift, not a behaviour change) |

**Research and survey errata** (each "research said X; the primary source shows Y"):

| # | Said | Primary source shows |
| -- | -- | -- |
| E1 | Only Seams & Tangles and Drift & Coherence feed area-note Waiting entries | Design & Interface 2026-11-08 also does (8 entries in `docs/areas/front-end-pages.md` and siblings) |
| E2 | The template renders without minting wording (survey "global", citing `:340-362`) | The hand-off bullets are clean, but the shared bullets at `lib/periodicals.js:303` and `:382` render minting wording in all three advisory prompts (rendered and scanned, `rerun-outputs.md` Q6); the research comment was right |
| E3 | 63 of 91 strictly-cited run-4 files changed | 91 distinct files reproduce; **69** changed by `git diff --quiet c5694b68 origin/main` per file (Q12). The difference is a counting rule (research likely excluded simple-dispatcher and docs files); not load-bearing |
| E4 | 12 `workspace-api.js` anchors | 12 strict anchors reproduce; with paragraph-local bare cites the distinct line set is **20** (Q12) |
| E5 | R12 needs a new count | **19 → 5** under run 4's rule verbatim; 13 of the 15 retirements are one commit (`343d34ec0`, LIN-3827) minted by the **Comprehension-Debt Review**, not Documentation (`r12-members.md`) |

---

## Scope & sweep accounting (all five passes)

**Window.** LinearViewer `c5694b68..9cf51ef72`: 456 commits. simple-dispatcher `bb1da78..5d8489e`: 67 commits, 255
files. Both are stated because run 3 mis-stated the consumer window.

**Pass 1 — added files, both repos (`sweep-dispositions.csv`).** **107 LinearViewer files = 23 under 3 new ids + 79
folds into 19 carried ids + 5 exclusions.** Importers were resolved by full path (every relative specifier resolved
against its importer; a `public/` asset counts the `lib`/`routes`/`server.js` files that reference it by URL), after a
first basename-matching pass missed same-directory imports and was discarded (Q4). New ids: `mod-model-routing` 17,
`flow-area-notes-leftover` 4, `flow-as-asked-seal` 2. Folds: `mod-render-layer` 31 (Settings, Home, dashboard split,
`run-controls`, `vendor-assets`, landing), `flow-cost-telemetry` 12 (per-request usage, cost read/format, catalog rate),
`mod-task-page` 6, `flow-operator-decisions` 5, `mod-prompt-template-system` 4 (`size-of-move`, `stage-writes`,
`recommendation-look-first`, `autopilot-precedence`), `flow-dispatch-lifecycle` 3, `mod-kpi-audit` 3,
`flow-run-evidence-closeout` 2, `mod-library` 2, `mod-task-edit` 2, and one each into `api-openrouter`,
`flow-dispatch-halt`, `flow-account-connection-workspace-credential`, `flow-bootstrap-token-exchange`,
`mod-roadmap-trajectory`, `flow-workspace-lifecycle`, `mod-provider-abstraction`, `mod-effort-readout`,
`mod-task-create`. Exclusions: `lib/pipeline-churn.js` (scripts-only analysis by design), `lib/sample-data/fixture-parent.js`
(sample data), `lib/key-state.js` and `lib/key-state-holders.js` (the per-key test-state registry; no production
behaviour), `routes/workspace-api-steps.js` (pure shared helpers of the workspace-API routers). Zero production
importers: `lib/pipeline-churn.js` only; every `public/` addition is referenced by a renderer.
**simple-dispatcher:** all six new root modules are wired — `env-flag.js` (4 importers), `instance-guard.js`
(`dispatcher.js`), `state-dir.js` (8), `request-usage.js` (2), `request-usage-flush.js` (4: `dispatcher.js`, `hook.js`,
`opencode-runner.js`, `reapers.js`), `opencode-request-records.js` (`opencode-runner.js`). None is dead.

**Pass 2 — deleted files (10).** No run-4 line citation points into any of them, and no run-4 id depended on one. The
next-run lane (`lib/next-run.js`, `lib/render-next-run.js`, `routes/next-run.js`, `public/next-run.{js,css}`) is
**retired evidence, not a retired surface**. `lib/task-cost.js` and `lib/plan-fee-config.js` were named in
`flow-cost-telemetry`'s *definition* ("task-cost/model-pricing/weekly-budget/plan-fee lane"); that cell is re-pointed to
the per-request usage ledger that replaced them (LIN-4195). The three vendored minified libraries **moved**: they are
exact-pinned dependencies served at the same URLs by `lib/vendor-assets.js` (LIN-3787, `server.js` mount).

**Pass 3 — modified-not-added seams (top 25 non-test existing files by commit count).** None of their carried ids is
filed "unchanged" without a cited reason; each row is in `sweep-dispositions.csv`. The large ones: `server.js` (56
commits, every new mount, R11), `public/llms.txt` (49), `lib/proxy-instructions.js` (36, `api-workspace-proxy`),
`lib/dispatch-store.js` (30 commits, +1,906 lines; `mod-dispatch-queue`, where three 10-23 sibling Highs landed and were fixed),
`public/prompt-section.js` (30, +1,578; `mod-task-page`, Code Quality F-prompt-section HIGH), `lib/render.js` (29),
`routes/proxy-compute.js` (25), `lib/task-page-loader.js` (24), `lib/prompt-template-defs.js` (24),
`lib/dispatch-entrance.js` (24), **`routes/workspace-api.js` (22 commits: split, so every run-4 cite into it is
re-pointed, see *Citation re-points*)**, `routes/proxy.js` (21), `lib/periodicals.js` (14; R18), `lib/db-indexes.js`
(14). The workspace-API split is filed as a **move with no logic change** for R7: writers #2, #3 and c2 read the same
at their new homes (`done-writers.md`).

**Pass 4 — cross-repo FLOWs, consumer side included.** The whole consumer change set is inventoried: all 47 non-test
files have a disposition in `sweep-dispositions.csv` (consumer evidence for a named FLOW, or consumer-internal and
unscored). The 67 commits name 55 LIN ids in their subjects (76 counting bodies). Consumer evidence per Harbour-scored FLOW that crosses:

| FLOW | Consumer evidence this window | Delta it supports |
| -- | -- | -- |
| `flow-cost-telemetry` | `request-usage.js`, `request-usage-flush.js` (producer contract `:10-16`), `opencode-request-records.js`; `opencode-runner.js:91-93`, `relayRequestRecords` `:590`; `hook.js:19-20` (Stop flush); `dispatcher.js:15`, `reapers.js:32` (detached flush); `config.js:1345` relay default **on** (LIN-4127) | the "behind an unwired seam" description (SD `765289d`, LIN-4202's own subject) is retired: LIN-4199 wired the poster; definition re-pointed, CFG 3→4 |
| `api-runner-kit` | `test/runner-contract.test.js:48,50` (re-pinned to LV `3d2046ac`, LIN-4378/4385); `transcript.js` one `DONE:` rule; `harbour-token-mcp-server.js` broker 429 policy pinned against the contract | R14 improved |
| `flow-dispatch-lifecycle` | `hook.js` one Stop relay table (LIN-4218), `reapers.js` re-ask before the failsafe (LIN-3905), status posted last (LIN-4239), `queue.js` malformed poll body (LIN-3047) | consumer hardening; Harbour core gap (R2) unchanged |
| `flow-followup-resume` | `followup.js`, `docs/session-lifecycle.md`: a follow-up never resumes a CANCELLED session (LIN-4079) unless a person forces it (LIN-4082); an abort beats a late inject (LIN-3437) | unchanged (consumer owns liveness) |
| `flow-consumer-liveness` | `instance-guard.js` + `watch-restart.sh` (one dispatcher per host, LIN-796); `heartbeat.js` (LIN-4030) | unchanged (R15, R17 Harbour-side) |
| `flow-bootstrap-token-exchange` | `harbour-token-mcp-server.js`: the broker passes on a 429 and backs off (LIN-4378) | unchanged (LIN-1410 open) |
| `flow-run-evidence-closeout` | `links.js`: the `[done]` url is the session's own PR, not the most-mentioned one (LIN-4375) | a consumer defect fix that feeds Harbour's close-out evidence; no score change |
| `flow-autopilot-wake` | LIN-3759 (relay a parked child's PENDING-EXTERNAL to its parent), LIN-4027 (leaf `[pending]` wake) | unchanged |
| `mod-model-routing` (new) | `harnesses.js`, `executors.js`: resumes keep the session's model/effort (LIN-3830); opencode resolves effort to null and says so (LIN-3857); blank Harbour rows fall through to `workspaces.json` | held at 3 (two sources of model choice) |
| `flow-area-notes-leftover` (new) | `docs/areas/` registry, README, four notes and a guard test (LIN-4372); README points at Harbour's `LEFTOVER_RULE` (LIN-4385) | new cross-repo FLOW |

Consumer-only changes with no Harbour crossing (unscored by the decision below): the heavy-tier test harness
(LIN-4219–4224, 123 test files), `resource-metrics.js` bounded sink (LIN-1819), `terminal-driver.js` launch diagnosis
(LIN-1453), re-clone on resume (LIN-4171, `executors.js` + two `experiments/` witnesses), `state-dir.js` (LIN-4077),
`DISABLE_AUTOUPDATER` (LIN-2469).

**Pass 5 — area registry cross-check (new this run).** LinearViewer has 13 areas, simple-dispatcher 6. Every
LinearViewer area that holds production code maps to at least one surface id (generated table under the Trend
Ledger). `task-model` (2 files) maps only to `mod-roadmap-trajectory`; `wiring` (`server.js`) to `mod-scheduler` and
`mod-response-hardening` as homes, though it mounts everything. **The catch-all is where new work lands:** the
`^lib/` fall-through (`other-features`) holds 18 production files and **all 18 were added in this window**
(`as-asked-seal`, `cost-format`, `dashboard-refresh`, `home-{pipeline,row-states,rows,view}`, `key-state{,-holders}`,
`live-anchor`, `ruling-{settled,standing}`, `stage-writes`, `subtree-index`, `task-facts-holder`, `task-state`,
`usage-snapshot-intake`, `waiting-section`), although `docs/areas/README.md` says a file falling through gets a home in
the same change (R19). Each of the 18 has a surface disposition, so the coverage gap is in the registry, not the ledger.
simple-dispatcher's six areas are consumer internals; they map through consumer evidence (Pass 4), and its docs/root
files match no area.

**Unbounded classes, recorded as such.** Provider-side Done automations; live periodical `stopAt` values; production
`request-usage` rows (no production read was made); whether stored dispatch rows carry `periodicalId` when read back.
No decision depends on any of them.

---

## Consumer-repository decision (re-taken at HEAD)

**Decision: unchanged — simple-dispatcher stays out of the scored ledger and fully inside discovery.** The ledger's
unit is the Harbour-served surface; consumer internals are scored only where they change Harbour-served behaviour.
LIN-1933 (target-repo selection) is still **Todo** and `template.scope` still has no runtime reader. What changed is
the inventory: run 4's second-read found the consumer change set un-inventoried; this run dispositions every one of the
47 non-test consumer files and cites consumer evidence for each crossing FLOW (Pass 4). The part of the consumer that
ships from Harbour stays scored as `api-runner-kit`. Re-take trigger: LIN-1933 landing or `template.scope` gaining a
reader.

---

## Headline read

**R7 is in its fifth cycle, and the workspace-API split did not touch it.** The census is the same shape as run 4:
three update-path Done writers, one gated, plus two ungated create routes (`done-writers.md`). The split moved writer
#2 to `routes/workspace-api-issue-write.js:820`→`:865` and writer #3 to `routes/workspace-api-run-evidence.js:260`→
`settleDone` `:224`→`defaultMarkDone` `:47`/`:60`, with no logic change. `checkPeriodicalReportGate` still has one
caller (`routes/proxy-writes.js:468`). LIN-2576 is `Todo` with no window commit. The sharper framing this run: the
gate now protects the **intended** close-out lane — LIN-4390 has close-out set Done, and if close-out writes through the
agent PATCH the gate fires — but not the product's own edit page or close-out check. And the same shape recurs for two
other rules (R20): As-asked immutability is checked only on the proxy write, and the close-out readiness re-check only on
the session lane.

**The trend in one paragraph.** **Improved:** R12 (stale-contract text, 19 → 5, mostly one Comprehension-Debt ticket),
R14 (both repos now pin one contract hash in CI), R1 (the Stage-2 end is defined: hand-off, then close-out), R6 (every
registered sibling has now run), R16 (12 of 34 done/High ids hit, down from 14 of 35). **New:** the per-request usage
ledger replaced the deleted cost lane end to end across both repos — the window's largest cross-repo FLOW change, filed
as `flow-cost-telemetry`'s new definition, not a new id; model routing (`mod-model-routing`), area notes and the leftover
step (`flow-area-notes-leftover`) and the As-asked seal (`flow-as-asked-seal`). **Unchanged:** R7 (fifth cycle), R3 (fifth
run), R2, R9 (read side), R13, R15, R17, R8, R11. **Worsened:** none by score. Four rows lose High confidence to open
High sibling findings (`api-dispatch`, `api-linear-graphql`, `mod-provider-abstraction`, `flow-agent-grants`). The three
Highs filed against the dispatch store on 2026-10-23 were all fixed within a day (LIN-3805, LIN-3811, LIN-3812).

**What the four lanes the task asked about add.** *Area notes / leftover:* a real cross-repo FLOW (leftover step holds a
build's parent wake until the builder answers; one `LEFTOVER_RULE` both repos point at), but the registry's own rule is
not enforced — 18 new files sit in the catch-all (R19) — and only three corrective siblings have fed it so far, so the
notes are not yet broad sibling evidence. *Per-request usage:* wired end to end and on by default; production rows are
unobserved, and the only sibling read (Cost Tracking 2026-11-02) predates the rebuild, so CHP holds at 3. *Model
routing:* a well-built table with a witness test, held at 3 because the design parent (LIN-3820) is open and a blank row
still defers to the consumer's `workspaces.json`. *Rebuilt periodical lane:* corrective siblings now feed notes and mint
nothing, runs hand off and close-out merges — but the three advisory templates (this one included) still describe
minting (R18), and the census meant to stop that misses both phrases.

**The META read.** The series reports well and changes little at the top: R7 has been #1 for five runs and R3 has not
moved since the baseline. The advisory lane mints nothing and writes no notes, so its top finding has no route to owned
work except a person reading this (R21). That is the decision this report most wants a human to make.

---

## Findings (priority-ranked)

Advisory — **no task is minted for any of these.** R1–R17 keep their ids (R4, R5, R10 stay closed); new findings start
at **R18**. Every carried verdict was re-derived at the pin (code read at `origin/main`, tracker states read through the
workspace API at 2026-11-10T11:17Z, sibling reports read from the files); `/periodicals` was not used for freshness.
The list below is generated from `trend-ledger.json`, in derived priority order (highest impact, then lowest effort,
ties by run-4 rank).

<!-- gen:rec-detail -->
- **R7** (priority 1; `flow-periodicals-two-stage`; configuration/enforcement; impact H · effort L; open, carried — unchanged, 5th cycle; owner: this review → LIN-2576 (Todo)). **Finding:** 3 update-path Done writers, 1 gated: agent PATCH gated (`routes/proxy-writes.js:54,459,468,523`); session PATCH ungated (`routes/workspace-api-issue-write.js:820`→`:861`→`:865`, which also records a person close-out merge, `:880-882`); close-out check ungated (`routes/workspace-api-run-evidence.js:260`→`:300-301` `settleDone` `:224/230`→`defaultMarkDone` `:47`/`:60`). Creates c1 `routes/proxy-writes.js:433`→`:446`, c2 `routes/workspace-api-issue-write.js:794`→`:801` accept `stateId` ungated. LIN-4390 says the gate "fires on close-out's write" (`lib/periodicals.js:277-278`): true only when close-out writes through the agent PATCH. **Action:** Run `checkPeriodicalReportGate` in the session PATCH and in `defaultMarkDone` (both hold description and comments), or move it to one provider-write seam (R20). Close-out of this task: the gated agent PATCH only.
- **R21** (priority 2; `META`; methodology / portfolio loop; impact H · effort L; open, **new**; owner: the human (a lane decision); this review). **Finding:** The series ranks R7 #1 for a fifth run and R3 has not moved since the baseline; the advisory lane mints nothing and writes no notes (`lib/periodicals.js:114-115`), so a top finding has no route to owned work except a human reading the report. LIN-2576 has had zero commits across four ISM cycles. By contrast, the three High findings the corrective siblings filed against the dispatch store on 2026-10-23 were fixed within days (LIN-3805, LIN-3811, LIN-3812): the corrective lane converts findings to work and the advisory lane does not. **Action:** Decide a route out of the advisory lane for a finding that tops N runs (e.g. the review may name it for Up next, or close-out files it), or accept that R7 stays a standing note.
- **R1** (priority 3; `flow-periodicals-two-stage`; core/happy-path, configuration; impact H · effort M; open, carried — improved; owner: this review; LIN-3649 (Backlog)). **Finding:** The Stage-2 end is now defined: the run hands off and close-out merges and sets Done (LIN-4390, Done); landed work makes a lane read due (LIN-4381, Done, overlaps but does not supersede LIN-1629 Todo, which also asks for ledger/coverage deltas); mint by registry id (LIN-4313/4317). Still open: the readiness re-check on the proxy, recommend and kickoff lanes (LIN-3649 Backlog). **Action:** LIN-3649; keep LIN-1629 open for its ledger half.
- **R13** (priority 4; `flow-account-connection-workspace-credential`; core/happy-path, auth & credentials; impact H · effort —; open, carried — unchanged; owner: Security Review; LIN-2150 (Todo)). **Finding:** `OwnerCredentialStore` still imported and built (`server.js:67,801`) beside the Connection seam; LIN-2150 Todo; `lib/connection-secondary-remint.js` (LIN-3774/3790) closed a silent 1 h secondary-binding expiry in the same lane. Security 2026-10-23 is the owning edition. **Action:** Pointer only: Security Review and LIN-2150.
- **R3** (priority 5; `portfolio/META`; error handling, resilience, rate limits, idempotency, observability; impact H · effort —; open, carried — unchanged (5th run); owner: Reliability LIN-1040 / Observability LIN-1041 (both Backlog, unregistered)). **Finding:** Neither is among the 16 registry entries. The clearest reliability finding this window (API Quality 2026-10-23 H1, store faults answered as final 4xx) was found and fixed (LIN-3805) under API Quality's contract-edge remit; resilience, idempotency and observability have no such proxy owner. **Action:** Pointer only.
- **R9** (priority 6; `flow-periodicals-two-stage`; configuration/data integrity; impact M · effort L; open, carried — unchanged (write side improved); owner: this review → LIN-2846 (Backlog)). **Finding:** `formatDispatchWatch` (`routes/proxy-dispatch.js:57`) still does not carry `periodicalId`; the registry-id mint now stamps it on write (`routes/proxy-dispatch.js:301,311`, LIN-4313). **Action:** LIN-2846.
- **R16** (priority 7; `META`; methodology; impact M · effort L; open, carried — improved (14 → 12 ids; 40% → 35%); owner: this review). **Finding:** 12 of 34 ids rated CHP 4 or High were hit by a real finding in the window. 6 only by defects or sibling Highs since fixed (mod-effort-readout, api-runner-kit, mod-task-create, mod-prompt-template-system, flow-run-evidence-closeout, and mod-dispatch-queue, where three 10-23 sibling Highs were fixed within days by LIN-3805/3811/3812); 6 by findings still open (api-dispatch and flow-agent-grants: Test Coverage C1, LIN-690 Done with no test found; api-linear-graphql and mod-provider-abstraction: LIN-446; api-mongodb-storage: LIN-3394; flow-bootstrap-token-exchange: LIN-1410). **Action:** This run applies run 4's action (confidence cut on open-High hits; fixed ones recorded as caveats). Next: let an open sibling High move a score cell, not only confidence, and check a Done ticket against its acceptance before counting a finding fixed.
- **R15** (priority 8; `flow-consumer-liveness`; observability; impact M · effort L; open, carried — unchanged; owner: Observability — LIN-1041 (not built)). **Finding:** `authStoppedWorkspaces` appears only in `lib/consumer-heartbeat.js:34,87`: validated and stored, shown nowhere. **Action:** Pointer only.
- **R18** (priority 9; `META / mod-periodicals`; documentation (template), testing; impact M · effort L; open, **new**; owner: this review → LIN-4389 (Todo)). **Finding:** All three advisory templates render minting wording at two shared sites: `lib/periodicals.js:303` ("whatever follow-up work this review mints") and `:382` ("(and any follow-up tasks)"); the census `tests/unit/periodicals.test.js:371-372` lists five other phrases and misses both. `:843` still says "fourteenth sibling" against 16 entries. The method this series relies on (five-pass sweep, area cross-check, scripted ledger, tiered second-read) lives only in ticket text. **Action:** LIN-4389, plus the two phrases in the census; fold the ticket-only method steps into `generateIntegrationSurfaceMaturityPrompt`.
- **R14** (priority 10; `api-runner-kit`; testing (contract), configuration; impact M · effort L-M; open, carried — improved (partly resolved); owner: this review (boundary)). **Finding:** Both suites now pin the same sha256 and both run in CI (`tests/unit/runner-kit-contract.test.js:48,330`; SD `test/runner-contract.test.js:50`, `LV_COMMIT` `3d2046ac`); copies byte-identical. Residual: an LV edit re-pinned on LV alone passes until SD's next re-copy (SD `:42-44` says so). **Action:** A check that fetches the other side's pinned file, or accept the residual as declared.
- **R2** (priority 11; `flow-dispatch-lifecycle`; core/happy-path; impact M · effort M; open, carried — unchanged; owner: this review → LIN-2120 (Backlog)). **Finding:** `listHistory({silentSince})` still has no production caller (`lib/dispatch-store.js:2109,2127`; only `lib/db-indexes.js:195-201` mentions it); alarms remain alarm-only. A consumer that dies on an open ticket still leaves its item taken forever. **Action:** LIN-2120.
- **R20** (priority 12; `flow-as-asked-seal / flow-periodicals-two-stage`; configuration/enforcement (structural); impact M · effort M; open, **new**; owner: this review (pointer for the human)). **Finding:** Three write rules are enforced per lane, not at the provider write seam: the Done gate (proxy only, R7), As-asked immutability (`checkAsAsked`, proxy only, `routes/proxy-writes.js:317-337`; the session PATCH replaces the body at `routes/workspace-api-issue-write.js:860`), and the close-out readiness re-check (session lane only; LIN-3649). Whether person lanes are exempt from As-asked by design is unconfirmed. **Action:** Decide per rule whether person lanes are exempt; where not, enforce at one provider-write seam so a new lane cannot skip it.
- **R8** (priority 13; `portfolio/META`; cross-surface (landed-but-unconsumed); impact M · effort —; open, carried — unchanged (mixed); owner: this review). **Finding:** `lib/observer-efficacy-signal.js` 0 production importers; `lib/workspace-registry.js` still write-only (one export, 10 writers). No new instance among the 107 added files: the two 0-importer adds are scripts-only by design (`lib/pipeline-churn.js`) or a deliberate counter (`lib/usage-snapshot-intake.js`, LIN-4203 D8). **Action:** Pointer only.
- **R6** (priority 14; `portfolio/META`; sibling review cadence; impact M · effort —; open, carried — improved; owner: scheduling call). **Finding:** Every registered sibling has now run at least once (first Performance/Scale and Data & Fetch editions 2026-10-23). Oldest at the listing: Documentation and Recent Headwinds (2026-10-21). **Action:** Scheduling call.
- **R12** (priority 15; `portfolio/META`; documentation; impact L-M · effort L; open, carried — improved (19 → 5); owner: Documentation Review (newest 2026-10-21); acted on by Comprehension-Debt). **Finding:** Run 4's C9 rule re-run verbatim: 15 of 19 definite members retired, 4 persist (`lib/connection-store.js:5`, `server.js:805`, `server.js:4372`, `lib/workspace.js:96`), 1 new (`lib/request-usage-store.js:5`). Arm A 60 → 57 lines; Arm B literal 10 → 12. 13 of the retirements are one commit, `343d34ec0` (LIN-3827), minted by the Comprehension-Debt Review (LIN-3825, 2026-10-23), not Documentation (newest 2026-10-21): an owner-map delta. **Action:** Documentation Review for the 5 left; note Comprehension-Debt now acts on this class.
- **R11** (priority 16; `mod-scheduler`; configuration; impact L · effort L; open, carried — unchanged; owner: this review). **Finding:** Hourly cleanup still a bare `setInterval` (`server.js:4696`). The new catalog warm (`server.js:1034`, LIN-3882) is a per-process cache touch every instance must run, so it is not counted. **Action:** Lease the hourly cleanup or record why every instance should run it.
- **R17** (priority 17; `flow-consumer-liveness`; core/happy-path (retention), documentation; impact L · effort L; open, carried — unchanged; owner: this review (pointer)). **Finding:** `lib/liveness-alarm-store.js:276` still claims the periodic cleanup calls `cleanup()` (`:285`); `lib/hourly-cleanup.js` does not. **Action:** Pointer only.
- **R19** (priority 18; `flow-area-notes-leftover`; documentation/configuration (area registry); impact L · effort L; open, **new**; owner: area registry owner (`docs/areas/README.md`, LIN-4371)). **Finding:** 18 `lib/` files fall through to the `^lib/` catch-all (Other features), all added in this window, although `docs/areas/README.md` says a falling-through file gets a home in the same change; `lib/as-asked-seal.js` is homeless by a deliberate pin (`tests/unit/area-map-placement.test.js`). Nothing fails when a new file lands in the catch-all. **Action:** A guard that fails on a new catch-all file, or accept the catch-all as a holding area.
- **R10** (priority 19; `flow-dispatch-halt`; documentation; impact — · effort L; **resolved in code**, carried (LIN-3074 still Backlog); owner: Documentation Review). **Finding:** Run 3's query: 0 stale production hits. **Action:** Close LIN-3074.
- **R5** (priority 20; `flow-free-tier-rate-limit`; testing; impact — · effort —; **resolved**, carried (residual precompute: LIN-3422); owner: —). **Finding:** No regression; residual precompute spend open (LIN-3422 Backlog). **Action:** —
- **R4** (priority 21; `feedback/image handling`; security; impact — · effort —; **closed/resolved**, carried; owner: —). **Finding:** Serve-side sniff and `nosniff` re-pointed to `routes/workspace-api-issue-read.js:240,246`; no regression. **Action:** —
<!-- /gen:rec-detail -->

Pointers to existing tickets that are not new rows (owned elsewhere): LIN-690 (dispatch-token auth boundary; reads
Done, no asserting test found), LIN-446 (tracker reads, Data & Fetch H3, Performance H1), LIN-3394,
LIN-1410 (Security Highs), LIN-3741, LIN-3546, LIN-2398, LIN-3544 (Code Quality structural Highs), LIN-3422 (spend
outside every cap), LIN-3074 (stale after R10), LIN-4217 (index retirement), LIN-4389 (template minting wording),
LIN-1629 (change-gated due-ness; LIN-4381 overlaps but does not supersede it).

---

## Surface registration — new ids, folds, retirements

<!-- gen:shape -->
**54 scored ids (22 MOD / 10 API / 22 FLOW) + 1 META = 55 rows**; run 4's 52 rows are a strict subset; none retired; 3 new.
<!-- /gen:shape -->

**New ids (3, 23 files).** Each passes the test the plan set: no carried id models it, and folding it would hide half
its evidence.

| id | Type | Files | Why a new id rather than a fold |
| -- | -- | -- | -- |
| `mod-model-routing` | MOD | 17 | one per-workspace table for every LLM job (harness, model, effort), with its own store, history, presets, proxy and Settings routes; folding into `api-openrouter` would hide the agent-session half |
| `flow-area-notes-leftover` | FLOW | 4 (+ both repos' `docs/areas/`) | a concept crossing the dispatch store, the wake hook, the prompt templates and two repos' docs, owned by none of them |
| `flow-as-asked-seal` | FLOW | 2 (`as-asked` has 25 importers) | the description's lifecycle across three create lanes, the first-dispatch seal and the proxy write guard; no module owns all of them |

**New-FLOW test, recorded for the candidates that failed it.** The Home lane (`home-*`, `waiting-section`,
`task-facts-holder`, `subtree-index`) crosses more than three modules but is owned by `lib/home-pipeline.js` ("the one
Home-view pipeline"), so it folds into `mod-render-layer`. `key-state*` is owned by `lib/key-state.js` and is test-state
infrastructure, so it is excluded. The dashboard and workspace-API splits are moves out of one file and keep the ids
their behaviour already had.

**Folds:** listed in Pass 1 (79 files into 19 carried ids). **Per-request usage folds into `flow-cost-telemetry`** and
rewrites its definition; a second cost id would be a second representation of one concept. `size-of-move` and
`stage-writes` fold into `mod-prompt-template-system`.

**Retired ids: none.** **Retired evidence:** the next-run lane (five files); run-4 R12 members 15 of 19; the cell text
"task-cost/model-pricing/weekly-budget/plan-fee lane"; the "behind an unwired seam" description of OpenCode posting.

**A coverage note, not a new id:** the session-auth workspace API (ten files, 5,213 lines) has never had an id of its
own; its routes are scored through the ids whose behaviour they serve (`mod-task-edit` for issue read/write,
`flow-run-evidence-closeout`, `flow-operator-decisions` for scan, `mod-kpi-audit` for audit, `mod-task-create` for
feedback). That is how runs 1–4 treated it; the split makes the mapping explicit.

---

## Scorecard over the twelve dimensions

**Methodology change (recorded against META).** Run 4 scored only core/happy path (CHP) and configuration (CFG) per
surface and aggregated the other ten at portfolio level. This run scores **all twelve per surface**. The ten new
per-surface cells are a **first per-surface reading**, not an improvement or regression against anything: each starts
from a stated profile by surface class (renderer, pure compute, store, external client, exposed API, FLOW, FLOW with
credentials; the profiles are in `trend-ledger.json`) and is overridden only where evidence moves it, with the evidence
in the cited-cells table under the Trend Ledger. No profile cell is 0, 1 or 4, so every extreme is cited. Their
confidence is that of the owning sibling (below), and Low where the owner does not exist. Portfolio Completeness stays
CHP-based so it compares with run 4; the per-dimension means below are the baseline the next run diffs.

*Generated.*

<!-- gen:dim-means -->
| Dimension | Scored ids | N/A | Mean (0-4) | Mean as % | Owner |
|---|---|---|---|---|---|
| CHP | 54 | 0 | 3.53 | 88.3% | this review (first-party) |
| ERR | 54 | 0 | 2.56 | 63.9% | Reliability — LIN-1040 (not built) |
| RES | 35 | 19 | 2.17 | 54.3% | Reliability — LIN-1040 (not built) |
| RL | 17 | 37 | 2.59 | 64.7% | Reliability — LIN-1040 (not built) |
| AUTH | 19 | 35 | 2.95 | 73.7% | Security Review |
| IDEM | 36 | 18 | 2.42 | 60.4% | Reliability — LIN-1040 (not built) |
| VAL | 54 | 0 | 3.00 | 75.0% | API Quality Review |
| OBS | 54 | 0 | 2.04 | 50.9% | Observability — LIN-1041 (not built) |
| SEC | 54 | 0 | 3.00 | 75.0% | Security Review |
| TEST | 54 | 0 | 2.94 | 73.6% | Test Coverage Gap Review |
| DOC | 54 | 0 | 2.91 | 72.7% | Documentation Review |
| CFG | 22 | 32 | 3.59 | 89.8% | this review + siblings |
<!-- /gen:dim-means -->

| # | Dimension | Owning review | Freshness at 2026-11-10T11:19Z | Confidence of the per-surface cells | Delta vs run 4 (portfolio) |
| -- | -- | -- | -- | -- | -- |
| 1 | Core/happy path | **this review (first-party)** | — | Medium/High | `flow-email-identity` +1 (cited); 3 new ids at 3; see Completeness |
| 2 | Error handling | **Reliability — LIN-1040 (not built)**; API Quality at the contract edge | API Quality 2026-10-23 (18 days) | Low/Medium | first reading; API Quality H1 (store faults as final 4xx) landed on `mod-dispatch-queue` and `api-dispatch` and was fixed in the window (LIN-3805), so both read 3 |
| 3 | Resilience | **Reliability — LIN-1040 (not built)** | none | Low | first reading; unowned |
| 4 | Rate limits & pagination | **Reliability — LIN-1040 (not built)**; Data & Fetch for read-side pagination | Data & Fetch 2026-10-23 (first edition) | Low/Medium | first reading; Data & Fetch H1/H2 were fixed in the window (LIN-3811, LIN-3812), so `mod-dispatch-queue` reads 2; LIN-2120 (no general pagination, Backlog) puts `flow-dispatch-lifecycle` at 1 |
| 5 | Auth & credentials | **Security Review** | Security 2026-10-23 (18 days) | Medium | first reading; LIN-1410 (`flow-bootstrap-token-exchange` 2), R13 |
| 6 | Idempotency & consistency | **Reliability — LIN-1040 (not built)** | none | Low | first reading; `mod-scheduler` 4 (CAS lease), LIN-3394 (`api-mongodb-storage` 2) |
| 7 | Input & schema validation | **API Quality Review** | 2026-10-23 (18 days) | Low/Medium | first reading |
| 8 | Observability | **Observability — LIN-1041 (not built)** | none | Low | first reading; lowest mean of the twelve (R3, R15) |
| 9 | Security | **Security Review** | 2026-10-23 | Medium | first reading; `mod-response-hardening` 4 (CSP); R4 stays closed |
| 10 | Testing | **Test Coverage Gap Review** | 2026-10-23 (18 days) | Medium | first reading; TCG C1 (`api-dispatch`, `flow-agent-grants` 2); R14 improved |
| 11 | Documentation | **Documentation Review** | 2026-10-21 (20 days; a run was dispatched 2026-11-10 and had not landed at the listing) | Medium | first reading; R12 improved 19 → 5; R18 template drift |
| 12 | Configuration | **this review + siblings** | — | Medium | `flow-cost-telemetry` CFG 3→4 (cited); no N/A flipped |

---

## Sibling-owned dimension coverage

Re-listed from `git ls-tree origin/main docs/reviews/` at 2026-11-10T11:19Z (Q7). Newest edition per registered sibling:
Documentation **2026-10-21**, Test Coverage Gap 2026-10-23, Security 2026-10-23, API Quality 2026-10-23, Code Quality
2026-11-04, Drift & Coherence 2026-11-10, Comprehension-Debt 2026-11-05, Stability 2026-11-08, Dependency &
Supply-Chain 2026-10-23, Recent Headwinds **2026-10-21**, Design & Interface 2026-11-08, Performance/Scale 2026-10-23
(first), Data & Fetch Architecture 2026-10-23 (first), Onboarding & Cold-Start 2026-10-23, Seams & Tangles
2026-11-10-run11. Non-registry evidence used: Cost Tracking 2026-11-02 (LIN-4126). Since LIN-4380 the corrective
siblings also write area-note entries; at the listing only Seams & Tangles, Drift & Coherence and Design & Interface
had, so the notes add little sibling evidence yet.

| Dimension | Owning review | Status | Confidence | What's known this run |
| -- | -- | -- | -- | -- |
| Auth & credentials | **Security Review** | 2026-10-23, current | Medium | #2 LIN-3394 and #3 LIN-1410 open High; LIN-3617/3618/3619 (tokens outliving logout) Done; credential dual representation (R13) |
| Security | **Security Review** | 2026-10-23, current | Medium | no Critical; R4 stays closed; LIN-3795 prefixes minted tokens so scans can mask them |
| Input & schema validation | **API Quality Review** | 2026-10-23, current-ish | Low/Medium | H1 was an error-classification finding at the contract edge, fixed by LIN-3805 the same day |
| Testing | **Test Coverage Gap Review** | 2026-10-23, current-ish | Medium | C1 dispatch-token auth boundary: LIN-690 reads Done, but no asserting test was found (open by evidence); R1 e2e stray queue item fixed by LIN-3798 |
| Documentation | **Documentation Review** | 2026-10-21, stalest | Medium | R12's class was acted on by **Comprehension-Debt** (LIN-3827), not this owner — an owner-map delta |
| Error handling | **Reliability — LIN-1040 (not built)** | no report | Low | API Quality H1 was the clearest instance, found and fixed (LIN-3805) under API Quality's contract-edge remit; inside the boundary, unowned |
| Resilience | **Reliability — LIN-1040 (not built)** | no report | Low | unowned; consumer-side 429 back-off (LIN-4378) is incidental |
| Rate limits & pagination | **Reliability — LIN-1040 (not built)** | no report | Low/Medium | **Data & Fetch Architecture now evidences read-side pagination** (H1, H2) and **Performance/Scale** evidences payload size (H2) — a META delta: run 4 had neither |
| Idempotency & consistency | **Reliability — LIN-1040 (not built)** | no report | Low | unowned |
| Observability | **Observability — LIN-1041 (not built)** | no report | Low | unowned; R15, R17; `lib/usage-snapshot-intake.js` turns "no producer posts snapshots" into a query (a small positive) |

**Newer siblings checked for ownership (META delta).** Performance/Scale and Data & Fetch Architecture have now run and
hold evidence on rate limits & pagination (read side) and on payload cost; neither owns error handling, resilience,
idempotency or observability. Seams & Tangles owns none of the twelve (structure only). Comprehension-Debt does not own
documentation but acted on R12's class. Reliability (LIN-1040) and Observability (LIN-1041) remain the natural home for
four unowned dimensions; this report mints nothing into that territory.

---

## Self-Audit — META surface

*Surface: META (`meta-integration-surface-maturity-review`) · core/happy-path **3** (unchanged) · configuration N/A ·
testing 2 · documentation 2 · confidence Medium (unchanged).*

- **How many surfaces are stuck at Low confidence, and why?** Five rows carry a Low component: `mod-roadmap-trajectory`
  and `mod-observation-materializer` (Medium/Low, unchanged: not read in depth), `mod-task-create` and `mod-secret-scan`
  (Low/Medium, unchanged), and **`mod-render-layer` (Medium → Medium/Low this run)**: it took the largest fold (31 files)
  and they were dispositioned by header and importers, not read. Portfolio-wide, four dimensions sit at Low because
  their owner does not exist (resilience, idempotency, observability, and error handling inside the boundary) — R3.
- **Did a real finding land on a surface this review rated done?** **Yes: 12 of 34** (35%; run 4: 14 of 35, 40%) —
  six only by defects or sibling Highs since fixed, six by findings still open (`r16-members.md`). The seed LIN-3642
  was counted in run 4. This run applies run 4's R16 action: an open-High hit on a High-leading row cuts it to Medium
  (four rows), and fixed ones are recorded as coverage caveats. What the model still cannot do: a fixed defect on a
  CHP-4 surface changes nothing, a sibling High moves confidence, never a score, and a ticket marked Done is not proof
  of its fix — LIN-690 reads Done with no asserting test found, which this run caught only by reading the tests.
- **Is any dimension consistently N/A or consistently 0?** Configuration is N/A on 32 of 54 scored ids (run 4: 30 of
  51; the new FLOWs add two, each justified). Under the first full reading, resilience, rate limits, auth and
  idempotency are N/A on 18–37 ids, nearly all pure renderers and compute modules, where the dimension genuinely does not
  apply. No dimension is 0 anywhere. **Observability is the lowest mean (2.04)** and has no owner: that is the
  measurement, not dead weight.
- **Are past top recommendations acted on?** Against R1–R17: **R7 — no, fifth cycle** (LIN-2576 Todo, zero window
  commits). **R12 — yes, by another sibling** (LIN-3827). **R14 — yes, mostly** (LIN-4384/4385/4378). **R1 — yes,
  incrementally** (LIN-4390, LIN-4381, LIN-4313). **R6 — yes.** **R16 — yes, by this run's method.** **R2, R3, R9, R13,
  R15, R17, R8, R11 — no.** R4, R5, R10 stay closed. Of 14 open carried: 5 improved, 9 unchanged, 0 worsened. **R7 and R3
  together are the pattern: the two longest-standing findings are the two that need a decision rather than a fix** (R21).
- **Did the five-pass sweep catch what run 4 missed?** Yes for both named gaps: the consumer change set is inventoried
  file by file (47 rows) with consumer evidence for every crossing FLOW, and `public/` is in the added-file pass (8
  files, all referenced). The deleted-file pass found five more deletions than the mint. The area pass found the
  catch-all pattern (R19). Scripted reconciliation found two errors of this run's own making before prose: a basename
  importer matcher that missed same-directory imports (discarded, Q4) and a citation rule that resolved a sibling
  report's `:99` to a code file (marked a rule false positive).
- **Does this template still describe behaviour that changed?** **Yes (R18).** The rendered ISM prompt says "whatever
  follow-up work this review mints" and "(and any follow-up tasks)" although the engine says no periodical mints
  (`lib/periodicals.js:117-118`); it says "fourteenth sibling" against 16; and the method this run used lives only in
  the ticket text. LIN-4389 is Todo.
- **What this review's own method still gets wrong.** Citation re-points are content matches: 180 rows moved with
  identical text, which proves the line exists, not that the claim around it still holds. Claims were re-verified by
  hand for the load-bearing families (R7, R13, R14, R2, R9, R12, R15, R17, R11, R4, R5, R10); the rest are re-pointed by
  content only. The ten first-reading dimensions are profile-defaulted; the next run should move cells only on cited
  evidence.

**Score holds at 3:** the method is better instrumented (balanced sweeps, a diffable ledger) but the review's own
template drifts, and its top finding has no route to action.

---

## Completeness % (secondary, noisy — read with care)

*Generated.*

<!-- gen:completeness -->
Portfolio CHP completeness over **54** scored ids: **88.3%** (190.75 of 216). The 51 carried ids alone: **89.1%** (181.75 of 204; run 4 over the same ids: 88.6%, 180.75 of 204). The 3 new ids enter at 9 of 12 (**75.0%**).
<!-- /gen:completeness -->

**Do not read this as decline.** The named movements:

* `flow-email-identity` **CHP 3→4** (LIN-3771/3789 layered send defences; cited in its row) — the only carried score that
  moved: +1 point, so the 51 carried ids go from 88.6% to 89.1%.
* **The denominator effect, 51 → 54:** three new surfaces enter at CHP 3, 3, 3 (75%), which lowers the portfolio figure
  by about 0.8 points by being added. Net 88.6% → 88.3%.
* No carried CHP fell. META is outside the average.

The per-surface Trend Ledger is the primary signal; this number is not.

---

## Plain-language read for the maintainer

The short version: the gate that stops a review being marked Done without its evidence still guards one of the three
ways an issue can reach Done. That is the fifth review in a row to say so. Splitting the big workspace-API file moved
the two unguarded doors into new files without changing them. This time the report also asks a different question: not
"please fix R7" again, but whether a finding that tops five reviews in a row should have some route to becoming owned
work, because this advisory review can't create one.

The good news is real. A sibling review (Comprehension-Debt) cleaned up most of the comments that said live code was
"not wired": 19 down to 5. The runner contract between Harbour and the dispatcher is now pinned by the same hash on both
sides, in CI. Every registered review has now run at least once. The first performance and data-fetch reviews found
real High problems in the dispatch history store, and those, with API Quality's, were fixed within a day of being filed.
That is the strongest sign this window that a review which files work gets it done, and it's the contrast behind R21.

The window's biggest change across both repos is cost tracking. The old per-task cost code is gone. The dispatcher now
posts one usage record per model request, on by default, and Harbour sums them. It is wired end to end in the code. I
haven't seen production rows, so I haven't scored it higher yet. Model routing, area notes with the leftover step, and
the As-asked seal are the other new surfaces. Each works, and each has one open edge: two sources of model choice, a
registry rule nothing enforces, and an immutability check only one lane runs.

**If you act on one thing:** decide R21, whether a five-time top finding gets a route out of the advisory lane, and
with it R7 (LIN-2576). **If you act on two:** LIN-4389 plus the two missing census phrases (R18), so this template stops
describing work it no longer does.

**No follow-up tasks have been created and no area notes written.** This is advisory; the decisions are the maintainer's.

---

## Citation re-points (every run-4 citation into a changed or deleted file)

Rule (Q12): run 4's strict form `path:line[,line][-line]` on the run-4 report, plus paragraph-local bare `` `:NNN` ``
resolved to the nearest preceding path in the same table row or blank-line block. **264 citation groups, 291 line rows**
(one per cited first line). Each cited line's text at `c5694b68` was searched for at the pin; for
`routes/workspace-api.js` the search spans all ten workspace-API files. Result (`citation-repoints.csv`):
**PASS 86** (file unchanged or same line) · **MOVED 180** (identical text found elsewhere; 31 of them the nearest of
several identical lines) · **MOVED-BY-HAND 13** · **RETIRED 6** · **REVERSED 4** · **SAME-LINE-BY-HAND 1** · **rule false
positive 1** · **unresolved 0**. The four reversals: the runner contract test now pins a hash (R14, two rows), SD's
`LV_COMMIT` re-pinned `1d4aec6a` → `3d2046ac`, `BUILDER_VERSION` 18 → 20. The six retirements are R12 members and the
fixed `lib/guest-task-path.js` comment. Every workspace-API anchor re-points by content: `:3410/:3440/:3451/:3455` →
`routes/workspace-api-issue-write.js:820/850/861/865`; `:3343/:3384/:3391` → `:749/794/801`; `:3521/:3655/:3721/:3759`
→ `routes/workspace-api-run-evidence.js:174/260/326/364`; `:3619` → `:224`; `:815` → `:60`; `:3744` → `:349`;
`:2938/:2944` → `routes/workspace-api-issue-read.js:240/246`; `:1738` → `routes/workspace-api-issue-write.js:513`;
`:3159` → `routes/workspace-api.js:857`; `:41` → `:47`; `:3259` → `routes/workspace-api-feedback.js:518`.

---

## Ranked recommendations (machine-readable state)

Uncapped; the full objects (finding, action, impact, effort, status, owner) are in `trend-ledger.json` →
`recommendations` and in *Findings* above. *Generated.*

<!-- gen:headline -->
Headline list (top 10 by derived priority: highest impact, then lowest effort, ties by run-4 rank): R7, R21, R1, R13, R3, R9, R16, R15, R18, R14.
<!-- /gen:headline -->

<!-- gen:recs -->
| priority | id | surface | dimension | impact | effort | status | owner |
|---|---|---|---|---|---|---|---|
| 1 | R7 | `flow-periodicals-two-stage` | configuration/enforcement | H | L | open, carried — unchanged, 5th cycle | this review → LIN-2576 (Todo) |
| 2 | R21 | `META` | methodology / portfolio loop | H | L | open, **new** | the human (a lane decision); this review |
| 3 | R1 | `flow-periodicals-two-stage` | core/happy-path, configuration | H | M | open, carried — improved | this review; LIN-3649 (Backlog) |
| 4 | R13 | `flow-account-connection-workspace-credential` | core/happy-path, auth & credentials | H | — | open, carried — unchanged | Security Review; LIN-2150 (Todo) |
| 5 | R3 | `portfolio/META` | error handling, resilience, rate limits, idempotency, observability | H | — | open, carried — unchanged (5th run) | Reliability LIN-1040 / Observability LIN-1041 (both Backlog, unregistered) |
| 6 | R9 | `flow-periodicals-two-stage` | configuration/data integrity | M | L | open, carried — unchanged (write side improved) | this review → LIN-2846 (Backlog) |
| 7 | R16 | `META` | methodology | M | L | open, carried — improved (14 → 12 ids; 40% → 35%) | this review |
| 8 | R15 | `flow-consumer-liveness` | observability | M | L | open, carried — unchanged | Observability — LIN-1041 (not built) |
| 9 | R18 | `META / mod-periodicals` | documentation (template), testing | M | L | open, **new** | this review → LIN-4389 (Todo) |
| 10 | R14 | `api-runner-kit` | testing (contract), configuration | M | L-M | open, carried — improved (partly resolved) | this review (boundary) |
| 11 | R2 | `flow-dispatch-lifecycle` | core/happy-path | M | M | open, carried — unchanged | this review → LIN-2120 (Backlog) |
| 12 | R20 | `flow-as-asked-seal / flow-periodicals-two-stage` | configuration/enforcement (structural) | M | M | open, **new** | this review (pointer for the human) |
| 13 | R8 | `portfolio/META` | cross-surface (landed-but-unconsumed) | M | — | open, carried — unchanged (mixed) | this review |
| 14 | R6 | `portfolio/META` | sibling review cadence | M | — | open, carried — improved | scheduling call |
| 15 | R12 | `portfolio/META` | documentation | L-M | L | open, carried — improved (19 → 5) | Documentation Review (newest 2026-10-21); acted on by Comprehension-Debt |
| 16 | R11 | `mod-scheduler` | configuration | L | L | open, carried — unchanged | this review |
| 17 | R17 | `flow-consumer-liveness` | core/happy-path (retention), documentation | L | L | open, carried — unchanged | this review (pointer) |
| 18 | R19 | `flow-area-notes-leftover` | documentation/configuration (area registry) | L | L | open, **new** | area registry owner (`docs/areas/README.md`, LIN-4371) |
| 19 | R10 | `flow-dispatch-halt` | documentation | — | L | **resolved in code**, carried (LIN-3074 still Backlog) | Documentation Review |
| 20 | R5 | `flow-free-tier-rate-limit` | testing | — | — | **resolved**, carried (residual precompute: LIN-3422) | — |
| 21 | R4 | `feedback/image handling` | security | — | — | **closed/resolved**, carried | — |
<!-- /gen:recs -->

No follow-up task or sub-issue is created from any row.

---

## Trend Ledger

Stable ids carried **verbatim**; none retired. Scores 0–4 in the order
CHP·ERR·RES·RL·AUTH·IDEM·VAL·OBS·SEC·TEST·DOC·CFG; `N` = N/A with a justification below. "CHP Δ" and "CFG Δ" are against
run 4 (the only per-surface baselines it has); the other ten cells are a first per-surface reading. "Sev" is the
highest open recommendation on the id. "Complete" is CHP/4. Every changed score or confidence carries its citation in its
row, and every 0, 1 or 4 cell is cited in the table after the ledger. *All tables in this section are generated.*

### MOD surfaces

<!-- gen:ledger-mod -->
*22 MOD ids (21 carried, 1 new). Scores in the order CHP·ERR·RES·RL·AUTH·IDEM·VAL·OBS·SEC·TEST·DOC·CFG; N = N/A (justified below).*

| id | scores | CHP Δ | CFG Δ | Sev | Complete | Confidence (run 4 → now) | Area(s) | Delta vs run 4 (citation) |
|---|---|---|---|---|---|---|---|---|
| `mod-provider-abstraction` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | High → Medium | providers | **confidence High→Medium**, score unchanged — Data & Fetch 2026-10-23 H3 `tracker-reads-no-read-through` (HIGH, LIN-446) sits on the provider read path, an open High finding on a CHP-4 surface (R16); `lib/workspace-issues-memo.js` (30 s issue-set memo) folds |
| `mod-periodicals` | `3·3·N·N·N·N·3·2·3·3·2·3` | = | = | M | 75% | High | llm-and-prompts | unchanged scores — registry still 16 (`lib/periodicals.js:1015-1135`); corrective templates now feed area notes and mint nothing (LIN-4380, header `:110-118`); advisory templates still render minting wording (R18); 14 window commits, not filed unchanged blindly |
| `mod-prompt-template-system` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | Medium | llm-and-prompts, other-features | unchanged — `8cca0193b` (LIN-3906) fixed two stage-selector misroutes (shipped defect, fixed: coverage caveat, R16); `lib/size-of-move.js`, `lib/stage-writes.js`, `lib/recommendation-look-first.js`, `lib/prompts/autopilot-precedence.js` fold; `lib/prompt-template-defs.js` #10 by churn (24 commits) |
| `mod-roadmap-trajectory` | `3·3·N·N·N·N·3·2·3·3·3·3` | = | = | — | 75% | Medium/Low | llm-and-prompts, task-model | unchanged — `lib/task-order.js` (task-model area) folds; no cited gain |
| `mod-render-layer` | `4/2-3·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 81% | Medium → Medium/Low | front-end-pages, front-end-browser, web-routes, other-features | unchanged score; **confidence Medium→Medium/Low** — the largest fold this run (31 files: Settings one-page-per-area LIN-3846, Home pipeline LIN-4118, dashboard split LIN-3742 Done, `run-controls` LIN-3849, `vendor-assets` LIN-3787) was dispositioned by header and importers, not read in depth; `lib/render.js` #6 and `public/app.js` #18 by churn; Home lane fails the new-FLOW test (owned by `lib/home-pipeline.js`) |
| `mod-dispatch-queue` | `4·3·2·2·N·3·3·2·3·3·3·4` | = | = | M | 100% | High | runs-and-dispatch | unchanged — three High sibling findings landed here and **all three were fixed in the window** (coverage caveats, R16): API Quality 2026-10-23 H1 (a store fault answered 404/401/empty 200) by `ec9eed17e` (LIN-3805: a retryable 503, `DispatchStoreFault`, `lib/dispatch-store.js:49,72-73`); Data & Fetch 2026-10-23 H1 (30-day window unindexed) by `f4289aa64` (LIN-3811: deferred window indexes built off the boot path, `lib/db-indexes.js:12-26`); Data & Fetch H2 / Performance H2 (full rows by default) by `fcab9f712` (LIN-3812: lean/digest default read). `lib/dispatch-store.js` #4 by churn (+1,906 lines; Code Quality 11-04 F-dispatch-store HIGH structural, LIN-2398) |
| `mod-observation-materializer` | `3·2·2·2·N·3·3·2·3·3·3·N` | = | = | — | 75% | Medium/Low | runs-and-dispatch | unchanged — not read in depth this run either (Code Quality 11-04 F-observation MED-HIGH, LIN-4013, structural) |
| `mod-kpi-audit` | `4/3·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 88% | Medium | reports-and-operator-tools, web-routes | unchanged — `lib/workspace-kpis-cache.js`, `routes/dashboard-kpis.js`, `routes/workspace-api-audit.js` fold (split/extract, no behaviour declared) |
| `mod-live-console` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | Medium | runs-and-dispatch | unchanged — LIN-3977 (`273385fcf`) left experimental and relabelled lanes (presentation, no defect) |
| `mod-scheduler` | `4·2·2·N·N·4·3·2·3·3·3·N` | = | = | L | 100% | High | platform-and-plumbing, wiring | unchanged — still 7 jobs (`server.js:901/968/998/1041/1071/1103/1159`); `pricing-conformance-sweep` repurposed by LIN-4358 (reports unmodelled catalog price gates; roster `docs/architecture/source-map.md:243`); hourly cleanup still bare (`server.js:4696`, R11); the new catalog warm interval (`server.js:1034`) is a per-process cache touch, not a job (R11) |
| `mod-observer-lane` | `3·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 75% | Medium | runs-and-dispatch | unchanged — `lib/observer-efficacy-signal.js` still 0 production importers (only a docblock mention, `lib/observer-shadow-log.js:128,138`; R8) |
| `mod-ship-journey` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | Medium | front-end-pages | unchanged |
| `mod-passage-planner` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | Medium | front-end-pages, llm-and-prompts | unchanged |
| `mod-task-edit` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | H | 100% | Medium | front-end-pages, web-routes | unchanged score — the session issue routes now live in `routes/workspace-api-issue-write.js` (LIN-3876) and fold here; that file holds R7 writer #2 (`:820`→`:865`) and create c2 (`:794`→`:801`) |
| `mod-task-create` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | Low/Medium | front-end-pages, web-routes | unchanged — `d0b6aa007` (LIN-3907): the feedback route's 413 arm was unreachable over HTTP (shipped defect, fixed: coverage caveat, attributed through this run's fold of `routes/workspace-api-feedback.js`) |
| `mod-effort-readout` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | Medium | runs-and-dispatch, web-routes | unchanged — two shipped defects fixed (coverage caveats, R16): `eb97e9968` (LIN-3857, effort dropped when the harness in force is opencode) and `c3031ccc5` (LIN-1653, `bug` bucketed as orchestration overhead); run-4 R12 member `lib/effort-readout.js:597` retired (string now `:621`, accurate); `routes/dashboard-effort.js` folds |
| `mod-secret-scan` | `3·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 75% | Low/Medium | platform-and-plumbing | unchanged — LIN-3795 prefixes minted Harbour tokens so the scan can mask them bare (`lib/harbour-token-format.js`) |
| `mod-task-page` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | High | front-end-pages, runs-and-dispatch, front-end-browser, web-routes, other-features | unchanged — 6 files fold (`lib/task-state.js`, `subtree-index`, `task-facts-holder`, `dashboard-session-state`); `public/prompt-section.js` #5 by churn, Code Quality 2026-11-04 F-prompt-section HIGH (structural, LIN-3546); `lib/task-page-loader.js` #9 |
| `mod-dispatch-entrance` | `3·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 75% | Medium | runs-and-dispatch | unchanged — #11 by churn (24 commits); `lib/dispatch-factory.js` (13 commits) placed here; `lib/recommendation-look-first.js` imported at the seam |
| `mod-library` | `4·3·N·N·N·N·3·2·3·3·3·N` | = | = | — | 100% | High | llm-and-prompts, web-routes | unchanged — `routes/getting-started.js` and `lib/prompts/agent-onboarding.js` fold (LIN-4085) |
| `mod-response-hardening` | `4·3·N·N·N·N·3·2·4·3·3·3` | = | = | — | 100% | High | front-end-pages, auth-accounts-and-workspaces, wiring | unchanged |
| `mod-model-routing` | `3·3·N·2·N·3·3·3·3·3·3·3` | new | new | — | 75% | Medium | llm-and-prompts, agent-api, web-routes, front-end-pages, front-end-browser | new — 17 files (LIN-3852/3853/3962, steps of LIN-3820 Todo): registry `lib/llm-jobs.js`, pure table `lib/model-routing.js` with a witness test proving it answers as the old resolvers did (`:20-22`), store, proxy routes with write scope (`routes/proxy-model-routing.js:40`), change log and undo (`:102`, `:213`); held at 3: the parent design LIN-3820 is still Todo and a blank row deliberately falls through to simple-dispatcher's `workspaces.json` (`lib/model-routing.js:14-15`), so model choice still has two sources; consumer evidence `harnesses.js` (LIN-3830 resumes keep model/effort). CFG 3: per-workspace defaults, no env flag |
<!-- /gen:ledger-mod -->

### API surfaces

<!-- gen:ledger-api -->
*10 API ids (10 carried, 0 new). Scores in the order CHP·ERR·RES·RL·AUTH·IDEM·VAL·OBS·SEC·TEST·DOC·CFG; N = N/A (justified below).*

| id | scores | CHP Δ | CFG Δ | Sev | Complete | Confidence (run 4 → now) | Area(s) | Delta vs run 4 (citation) |
|---|---|---|---|---|---|---|---|---|
| `api-linear-graphql` | `4·3·3·3·3·3·3·2·3·3·3·3` | = | = | — | 100% | High → Medium | providers | **confidence High→Medium**, score unchanged — Performance 2026-10-23 H1 `stack-provider-fetch-linear-in-issues` (HIGH, 8.33 s median on 3,755 issues) is an open High finding on this surface (R16) |
| `api-github-app` | `3·3·3·3·3·3·3·2·3·3·3·4` | = | = | — | 75% | Medium/High | auth-accounts-and-workspaces, providers | unchanged — `lib/connection-secondary-remint.js` (LIN-3774/3790) renews a secondary installation binding that used to expire silently after ~1h (credential lane, folded there) |
| `api-openrouter` | `4·3·3·3·3·3·3·2·3·3·3·4` | = | = | — | 100% | High | llm-and-prompts | unchanged — LIN-4358 (Done): names, prices, tools and token budgets now come from the catalog (`lib/call-budget.js` folds; `lib/catalog-rate.js` replaces the hand rate card, filed under `flow-cost-telemetry`) |
| `api-mongodb-storage` | `4·2·2·2·N·2·3·2·3·3·3·4` | = | = | — | 100% | Medium | platform-and-plumbing | unchanged — LIN-3394 (no unique `urlKey` index) still open High (Security 2026-10-23 #2); Data & Fetch 2026-10-23 H1/H2 landed here too and were fixed in the window (LIN-3811 deferred window indexes, LIN-3812 lean default read); `lib/db-indexes.js` 14 window commits |
| `api-yap-chat-client` | `3·3·3·3·3·3·3·2·3·3·3·4` | = | = | — | 75% | Medium/High | llm-and-prompts | unchanged — 0 window commits |
| `api-egress-proxy-fetch` | `3·3·3·3·3·3·3·2·3·3·3·4` | = | = | — | 75% | Medium/High | platform-and-plumbing | unchanged — 0 window commits |
| `api-workspace-proxy` | `4·3·2·3·3·2·3·2·3·3·3·4` | = | = | — | 100% | High | agent-api | unchanged — `lib/proxy-instructions.js` #3, `routes/proxy-compute.js` #8, `routes/proxy.js` #13 by churn, none behaviour-declared as a defect fix; `routes/proxy-model-routing.js` filed under `mod-model-routing`; mint by registry id (LIN-4313/4317) |
| `api-dispatch` | `4·3·2·3·3·2·3·2·3·2·3·4` | = | = | — | 100% | High → Medium | runs-and-dispatch | **confidence High→Medium**, score unchanged — API Quality 2026-10-23 H1 was fixed in the window (LIN-3805, `ec9eed17e`); Test Coverage 2026-10-23 C1 is open by evidence: LIN-690 reads Done (2026-10-30) but a bounded search finds no test asserting the dispatch-token store's cross-workspace revoke or `tokenHash` exclusion (`tests/unit/dispatch-tokens.test.js` changed only by LIN-3795; the wrong-workspace revoke test is the proxy store's, `tests/unit/proxy-tokens.test.js:674`) (R16); new route `POST /api/dispatch/usage/:itemId` (`routes/dispatch.js:1671`) |
| `api-jira-rest` | `4·3·3·3·3·3·3·2·3·3·3·4` | = | = | — | 100% | High | providers | unchanged |
| `api-runner-kit` | `3·3·2·3·3·2·3·2·3·3·3·3` | = | = | M | 75% | High | runs-and-dispatch | score unchanged, **R14 improved**: both repos now pin the same contract sha256 in CI-run suites (`tests/unit/runner-kit-contract.test.js:48,330`; SD `test/runner-contract.test.js:50`, LIN-4384/4385/4378); the copies are byte-identical (`cmp`); residual one-directional re-pin (SD `:42-44`). `0e6cd32e1` (LIN-3857) fixed a dropped subagent model/effort (coverage caveat, R16); `runCommand` cyc 136 (Code Quality 11-04, LIN-3741) |
<!-- /gen:ledger-api -->

### FLOW surfaces

<!-- gen:ledger-flow -->
*22 FLOW ids (20 carried, 2 new). Scores in the order CHP·ERR·RES·RL·AUTH·IDEM·VAL·OBS·SEC·TEST·DOC·CFG; N = N/A (justified below).*

| id | scores | CHP Δ | CFG Δ | Sev | Complete | Confidence (run 4 → now) | Area(s) | Delta vs run 4 (citation) |
|---|---|---|---|---|---|---|---|---|
| `flow-dispatch-lifecycle` | `3·2·2·1·N·2·3·2·3·3·3·N` | = | = | M | 75% | High | runs-and-dispatch | unchanged — R2 core gap open (`listHistory({silentSince})` has no production caller, `lib/dispatch-store.js:2109,2127`; LIN-2120 Backlog); consumer side changed (SD LIN-3905 re-ask before the failsafe, LIN-4218 one Stop relay table, LIN-4239 status posted last, LIN-3047 malformed poll body), none a Harbour crossing that changes the score |
| `flow-followup-resume` | `4·2·2·N·N·2·3·2·3·3·3·N` | = | = | — | 100% | High | runs-and-dispatch | unchanged — consumer evidence: SD LIN-4079 (a follow-up never resumes a CANCELLED session) and LIN-4082 (a person's force follow-up may), `followup.js`, `docs/session-lifecycle.md`; LIN-3437 (an abort wins over a late inject) |
| `flow-autopilot-wake` | `4·2·2·N·N·2·3·2·3·3·3·3` | = | = | — | 100% | Medium | runs-and-dispatch | unchanged — the leftover step holds a build's parent wake until its `leftover` row ends (`lib/dispatch-leftover.js:4-10`, filed under `flow-area-notes-leftover`); consumer LIN-3759/4027 (relay PENDING-EXTERNAL to a parked parent; leaf `[pending]` wake) |
| `flow-oauth` | `3·2·2·N·3·2·3·2·3·3·3·4` | = | = | — | 75% | Medium | auth-accounts-and-workspaces | unchanged — the brief's seed LIN-3642 was fixed before run 4's pin (`bc875ddc`) and was counted there; no new defect found this window |
| `flow-bootstrap-token-exchange` | `4·2·2·N·2·2·3·2·2·3·3·N` | = | = | — | 100% | Medium | agent-api, runs-and-dispatch | unchanged — LIN-1410 still open High (Security 2026-10-23 #3, `lib/proxy-preamble.js:335-336`); tokens now carry a kind prefix (`lib/harbour-token-format.js`, LIN-3795); consumer broker passes on a 429 and backs off (SD `harbour-token-mcp-server.js`, LIN-4378) |
| `flow-recap-brief-cache` | `4·2·2·N·N·2·3·2·3·3·3·3` | = | = | — | 100% | High | llm-and-prompts | unchanged |
| `flow-free-tier-rate-limit` | `3·2·2·3·3·2·3·2·3·3·3·4` | = | = | — | 75% | Medium | platform-and-plumbing | unchanged — residual precompute spend still open (`lib/run-paragraph-hook.js:35` `resolvePrecomputeCredential` resolves a server key; LIN-3422 Backlog); `lib/free-tier-store.js` single key builder holds |
| `flow-periodicals-two-stage` | `3·2·2·N·N·2·3·2·3·3·2·3` | = | = | H | 75% | High | llm-and-prompts, agent-api, runs-and-dispatch | unchanged scores — R7 unchanged at a fifth cycle (3 update-path Done writers, 1 gated; 2 ungated creates); R1 improved (LIN-4390 hand-off contract, LIN-4381 landed due-state, LIN-4313 mint by id); R9 read side unchanged; template drift R18 |
| `flow-account-connection-workspace-credential` | `3·2·2·N·3·2·3·2·3·3·2·N` | = | = | H | 75% | Medium | auth-accounts-and-workspaces | unchanged — R13: `OwnerCredentialStore` still imported and instantiated (`server.js:67,801`), LIN-2150 Todo; `lib/connection-secondary-remint.js` (LIN-3774/3790) folds; two run-4 R12 members persist here (`lib/connection-store.js:5`, `server.js:805`) |
| `flow-cost-telemetry` | `3·2·2·N·3·3·3·3·3·3·2·4` | = | 3→4 | L | 75% | Medium | runs-and-dispatch, other-features, front-end-browser, llm-and-prompts | **definition re-pointed, CFG 3→4**, CHP held at 3 — the run-4 lane (`lib/task-cost.js`, `lib/plan-fee-config.js`) is deleted; LIN-4195 rebuilt it end to end and the "behind an unwired seam" claim (SD `765289d`) is retired: SD `opencode-runner.js:91-93`, `relayRequestRecords` `:590`; `hook.js:19-20`; `config.js:1345` default on → `POST /api/dispatch/usage/:itemId` (`routes/dispatch.js:1671`) and `/api/proxy/runner/usage/:id` → `lib/request-usage-intake.js` → store → loader (7 importers) → fold → `lib/cost-read.js` (12 importers). CHP held: the only sibling (cost-tracking 2026-11-02) predates the rebuild and production rows are unobserved; LIN-4263 fixed a dropped per-dispatch detail; LIN-4217 index retirement Backlog |
| `flow-operator-decisions` | `4·2·2·N·N·2·3·2·3·3·3·N` | = | = | — | 100% | Medium | runs-and-dispatch, other-features, web-routes | unchanged — 5 files fold (`ruling-settled`, `ruling-standing`, `live-anchor`, `routes/dashboard-rulings.js`, `routes/workspace-api-scan.js`) |
| `flow-account-merge` | `4·2·2·N·3·2·3·2·3·3·3·N` | = | = | — | 100% | High | auth-accounts-and-workspaces | unchanged |
| `flow-flight-companion-turn` | `4·2·2·N·N·2·3·2·3·3·3·N` | = | = | — | 100% | Medium | llm-and-prompts | unchanged |
| `flow-dispatch-halt` | `3·2·2·N·N·2·3·2·3·3·3·N` | = | = | — | 75% | Medium | runs-and-dispatch, front-end-pages | unchanged — R10 still resolved in code (run 3's query: 0 stale production hits; `public/dispatch.js:772` accurate); LIN-3074 still Backlog; `lib/components/halt-controls.js` folds |
| `flow-run-evidence-closeout` | `3·2·2·N·N·3·3·2·3·3·3·N` | = | = | H | 75% | High | runs-and-dispatch, web-routes | unchanged — routes moved to `routes/workspace-api-run-evidence.js` (R7 writer #3 `:260`→`:224`→`:47`/`:60`); `lib/close-out-merges.js` (LIN-3756/3863) records merged events for proxy and person Done writes; `f6e6a0233` (LIN-3903) fixed a post-deploy check that held the close (coverage caveat, R16); consumer LIN-4375 (the `[done]` url is the session's own PR) |
| `flow-email-identity` | `4·2·2·3·3·2·3·2·3·3·3·4` | 3→4 | = | — | 100% | Medium | auth-accounts-and-workspaces | **CHP 3→4** — run 4 held it at 3 for the in-memory per-IP limiter and the live spam bot; LIN-3771 (`c6c5585a8`, Done) and LIN-3789 added a per-address 24 h cap, a site-wide hourly alarm, a honeypot and a minimum form time (`lib/email-auth.js:41-58`, `routes/email-auth.js:97,141`). Per-IP stays per-process (`routes/email-auth.js:88-92`) |
| `flow-workspace-lifecycle` | `3·2·2·N·3·2·3·2·3·3·3·N` | = | = | — | 75% | Medium | auth-accounts-and-workspaces | unchanged — registry still write-only (`lib/workspace-registry.js` exports only `recordWorkspace`, now 10 importing writers; R8); `lib/workspace-change-log.js` folds (LIN-3846) |
| `flow-consumer-liveness` | `3·2·2·N·N·2·3·2·3·2·2·N` | = | = | M | 75% | Medium | runs-and-dispatch | unchanged — `authStoppedWorkspaces` still only validated and stored (`lib/consumer-heartbeat.js:34,87`, R15); alarm store `cleanup()` still uncalled (R17); consumer: one dispatcher per host (SD `instance-guard.js`, LIN-796) |
| `flow-agent-grants` | `4·2·2·N·3·2·3·2·3·2·3·N` | = | = | — | 100% | Medium/High → Medium | agent-api | **confidence Medium/High→Medium**, score unchanged — Test Coverage 2026-10-23 C1 (High): the dispatch-token store's cross-workspace revoke and `tokenHash` exclusion are unasserted; LIN-690 reads Done (2026-10-30) with no such test found (R16) |
| `flow-task-share` | `3·2·2·2·3·2·3·2·3·3·3·N` | = | = | — | 75% | Medium/High | auth-accounts-and-workspaces, web-routes | unchanged — LIN-3795 masks a minted token planted bare in a rendered `/t/` page; the run-4 stale comment `lib/guest-task-path.js:41-43` is fixed (now `:45`) |
| `flow-area-notes-leftover` | `3·2·2·N·N·3·3·2·3·3·3·N` | new | new | L | 75% | Medium | runs-and-dispatch, llm-and-prompts | new — cross-repo (LIN-4347/4371/4372/4374/4376/4380): `server.js:1126-1133` builds the leftover step → `lib/dispatch-leftover.js` decides queue/hold/not-eligible (`:12-17`) with an idempotent wake release; `LEFTOVER_RULE` (`lib/prompts/leftover-words.js`) is what SD's notes README points to (LIN-4385); registries `docs/areas/areas.json` in both repos with guard tests. Held at 3: 18 added `lib/` files fell through the catch-all despite the README's same-change rule (R19), and only 3 corrective siblings (Seams & Tangles, Drift & Coherence, Design & Interface) have fed entries since LIN-4380 |
| `flow-as-asked-seal` | `3·3·2·N·N·3·3·2·3·3·3·N` | new | new | M | 75% | Medium | llm-and-prompts, other-features, agent-api | new — `lib/as-asked.js` (25 importers) owns the shape; `lib/as-asked-seal.js` seals on the three create lanes and the first-dispatch seal (`lib/dispatch-factory.js`); the immutability check runs only on the proxy write (`routes/proxy-writes.js:317-337`). The session PATCH replaces the whole body with no check (`routes/workspace-api-issue-write.js:860`); whether person lanes are exempt by design is unconfirmed, so this is held at 3 as an open question, not a defect (R20) |
<!-- /gen:ledger-flow -->

### META surface

<!-- gen:ledger-meta -->
*1 META ids (1 carried, 0 new). Scores in the order CHP·ERR·RES·RL·AUTH·IDEM·VAL·OBS·SEC·TEST·DOC·CFG; N = N/A (justified below).*

| id | scores | CHP Δ | CFG Δ | Sev | Complete | Confidence (run 4 → now) | Area(s) | Delta vs run 4 (citation) |
|---|---|---|---|---|---|---|---|---|
| `meta-integration-surface-maturity-review` | `3·N·N·N·N·N·N·N·N·2·2·N` | = | = | M | 75% | Medium | llm-and-prompts | unchanged at 3 — gains: scripted, balanced reconciliation (189 sweep rows, 291 citation rows), first full twelve-dimension reading, a JSON ledger. Losses: its own template still describes minting (R18), its top recommendation is at a fifth cycle with no route to owned work (R21), and 12 of 34 done/High ids were hit (R16). See Self-Audit |
<!-- /gen:ledger-meta -->

### Cited cells (every 0, 1 or 4, and every changed CHP/CFG)

Unchanged CHP/CFG 4s carry run 4's citation; where a fresh one exists it is listed too.

<!-- gen:cites -->
| id | dimension | score | evidence |
|---|---|---|---|
| `mod-provider-abstraction` | CHP | 4 | `lib/providers/interface.js`, `lib/providers/index.js` registry (run-4 evidence, unchanged seam) |
| `mod-periodicals` | DOC | 2 | `lib/periodicals.js:843` "not a fourteenth sibling" against 16 registry entries; `:303`, `:382` render minting wording in every advisory prompt (R18) |
| `mod-prompt-template-system` | CHP | 4 | `lib/stage-router.js` + `generatePrompt()` one-path invariant (CLAUDE.md Invariants); routing snapshots regenerated in `8cca0193b` |
| `mod-render-layer` | CHP | 4/2-3 | split score carried (run-2 convention): first-class pages 4, experimental tier 2-3 |
| `mod-dispatch-queue` | CHP | 4 | run-4 evidence carried (`takeItem({targets})`, loop guards); no core defect this window |
| `mod-dispatch-queue` | CFG | 4 | run-4 CFG 4 carried (TTL/queue config, `lib/queue-config.js`) |
| `mod-kpi-audit` | CHP | 4/3 | run-4 evidence carried (`lib/kpi-stats.js` privacy boundary, CLAUDE.md Key Behaviors) |
| `mod-live-console` | CHP | 4 | `lib/live-console.js`; LIN-3977 promoted it out of the experimental tier |
| `mod-scheduler` | CHP | 4 | `lib/scheduler.js` CAS lease; roster census test `tests/unit/claude-md-scheduler-jobs-census.test.js` |
| `mod-scheduler` | IDEM | 4 | non-upsert CAS lease per job (`docs/architecture/source-map.md:243`): a second instance cannot double-fire a tick |
| `mod-ship-journey` | CHP | 4 | run-4 evidence carried |
| `mod-passage-planner` | CHP | 4 | run-4 evidence carried |
| `mod-task-edit` | CHP | 4 | session PATCH `routes/workspace-api-issue-write.js:820`; R4 serve-side guards `routes/workspace-api-issue-read.js:240,246` |
| `mod-task-create` | CHP | 4 | `lib/render-task-create.js`; feedback create `routes/workspace-api-feedback.js:518` |
| `mod-effort-readout` | CHP | 4 | `lib/effort-readout.js:621` (the empty-column string now states the reason accurately) |
| `mod-task-page` | CHP | 4 | `routes/task-page.js` → loader → `lib/render-task-page.js` (run-4 chain, 13 window commits on the route) |
| `mod-library` | CHP | 4 | mounted routes `routes/library.js`; onboarding guide served at `/getting-started` (`lib/prompts/agent-onboarding.js:1-8`) |
| `mod-response-hardening` | CHP | 4 | run-4 chain carried |
| `mod-response-hardening` | SEC | 4 | `APP_CSP` script-src is self + hashes, no `unsafe-inline` (`lib/security-headers.js:63-65`) |
| `api-linear-graphql` | CHP | 4 | run-4 evidence carried (`lib/providers/linear/index.js`) |
| `api-github-app` | CFG | 4 | run-4 CFG 4 carried |
| `api-openrouter` | CHP | 4 | `lib/openrouter.js` one endpoint; `lib/call-budget.js:1-6` |
| `api-openrouter` | CFG | 4 | catalog-driven model facts (LIN-4358), keys from env |
| `api-mongodb-storage` | CHP | 4 | run-4 evidence carried |
| `api-mongodb-storage` | CFG | 4 | run-4 CFG 4 carried |
| `api-yap-chat-client` | CFG | 4 | run-4 CFG 4 carried |
| `api-egress-proxy-fetch` | CFG | 4 | run-4 CFG 4 carried |
| `api-workspace-proxy` | CHP | 4 | run-4 evidence carried |
| `api-workspace-proxy` | CFG | 4 | run-4 CFG 4 carried |
| `api-dispatch` | CHP | 4 | run-4 evidence carried; usage intake `routes/dispatch.js:1671` |
| `api-dispatch` | CFG | 4 | run-4 CFG 4 carried |
| `api-jira-rest` | CHP | 4 | run-4 evidence carried |
| `api-jira-rest` | CFG | 4 | run-4 CFG 4 carried |
| `flow-dispatch-lifecycle` | RL | 1 | LIN-2120 (Backlog) "Dispatch listing is structurally blind past its newest-N window — general pagination needed" |
| `flow-followup-resume` | CHP | 4 | run-4 evidence carried (`lib/follow-up-dispatch.js`); consumer `followup.js` (LIN-4079/4082) |
| `flow-autopilot-wake` | CHP | 4 | run-4 evidence carried |
| `flow-oauth` | CFG | 4 | run-4 CFG 4 carried |
| `flow-bootstrap-token-exchange` | CHP | 4 | run-4 evidence carried |
| `flow-bootstrap-token-exchange` | AUTH | 2 | Security 2026-10-23 #3 (High, open): bootstrap token inline in prompt text for non-claude-code harnesses, LIN-1410 |
| `flow-bootstrap-token-exchange` | SEC | 2 | same finding (LIN-1410) |
| `flow-recap-brief-cache` | CHP | 4 | run-4 evidence carried |
| `flow-free-tier-rate-limit` | CFG | 4 | run-4 CFG 4 carried (`lib/plan-allowance.js`) |
| `flow-periodicals-two-stage` | DOC | 2 | advisory prompts still say the run mints follow-ups (`lib/periodicals.js:303`, `:382`) while the header says none does (`:117-118`); LIN-4389 Todo |
| `flow-account-connection-workspace-credential` | DOC | 2 | `lib/connection-store.js:5` and `server.js:805` still say no read path is wired while `lib/connection-credential.js` calls `readConnection*` (R12) |
| `flow-cost-telemetry` | DOC | 2 | `lib/request-usage-store.js:5-6` "Nothing reads this collection yet except `listForAnchors`… a later piece" — the loader now has 7 importers (R12 new member) |
| `flow-cost-telemetry` | CFG | 4 | `SD config.js:1341-1345` one parser, default on (LIN-4127/4182: a stray empty value cannot blind cost); rates read from the catalog (`lib/catalog-rate.js:1-6`, LIN-4358) |
| `flow-operator-decisions` | CHP | 4 | run-4 evidence carried |
| `flow-account-merge` | CHP | 4 | run-4 evidence carried (`routes/account-merge.js`) |
| `flow-flight-companion-turn` | CHP | 4 | run-4 evidence carried |
| `flow-email-identity` | CHP | 4 | `lib/email-auth.js:44-58` layered send defences (LIN-3771/3789); refusals logged without the address (`routes/email-auth.js:97`) |
| `flow-email-identity` | CFG | 4 | run-4 CFG 4 carried (`lib/email-availability.js`) |
| `flow-consumer-liveness` | TEST | 2 | no e2e or contract test for heartbeat → alarm (run-4 finding, unchanged) |
| `flow-consumer-liveness` | DOC | 2 | `lib/liveness-alarm-store.js:276` says the periodic cleanup calls `cleanup()`; nothing does (R17) |
| `flow-agent-grants` | CHP | 4 | run-4 chain carried |
| `flow-agent-grants` | TEST | 2 | Test Coverage 2026-10-23 C1: `lib/dispatch-tokens.js:240-243` (revoke keyed only by `urlKey`) and `:205-220` (`listTokens` must not return `tokenHash`) are unasserted; LIN-690 reads Done but no such test was found |
| `meta-integration-surface-maturity-review` | TEST | 2 | `tests/unit/periodicals.test.js:371-372` census regexes miss both advisory minting phrases |
| `meta-integration-surface-maturity-review` | DOC | 2 | method steps (five-pass sweep, area cross-check, scripted ledger) live only in ticket text, not in `generateIntegrationSurfaceMaturityPrompt` (`lib/periodicals.js:835`) |
<!-- /gen:cites -->

### N/A justifications

<!-- gen:na-flips -->
**N/A flips vs run 4: none.** CFG is N/A for 32 of 54 scored ids (run 4: 30 of 51; the three new ids add 2).
<!-- /gen:na-flips -->

<!-- gen:na -->
| id | N/A dimensions | justification |
|---|---|---|
| `mod-provider-abstraction` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-provider-abstraction` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-provider-abstraction` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-provider-abstraction` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-provider-abstraction` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-periodicals` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-periodicals` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-periodicals` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-periodicals` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-prompt-template-system` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-prompt-template-system` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-prompt-template-system` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-prompt-template-system` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-prompt-template-system` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-roadmap-trajectory` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-roadmap-trajectory` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-roadmap-trajectory` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-roadmap-trajectory` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-render-layer` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-render-layer` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-render-layer` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-render-layer` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-render-layer` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-dispatch-queue` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-observation-materializer` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-observation-materializer` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-kpi-audit` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-kpi-audit` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-kpi-audit` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-kpi-audit` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-kpi-audit` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-live-console` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-live-console` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-live-console` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-live-console` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-live-console` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-scheduler` | RL | schedules in-process jobs; no list or rate-limited call of its own |
| `mod-scheduler` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-scheduler` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-observer-lane` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-observer-lane` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-observer-lane` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-observer-lane` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-observer-lane` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-ship-journey` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-ship-journey` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-ship-journey` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-ship-journey` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-ship-journey` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-passage-planner` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-passage-planner` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-passage-planner` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-passage-planner` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-passage-planner` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-task-edit` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-task-edit` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-task-edit` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-task-edit` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-task-edit` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-task-create` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-task-create` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-task-create` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-task-create` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-task-create` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-effort-readout` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-effort-readout` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-effort-readout` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-effort-readout` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-effort-readout` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-secret-scan` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-secret-scan` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-secret-scan` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-secret-scan` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-secret-scan` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-task-page` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-task-page` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-task-page` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-task-page` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-task-page` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-dispatch-entrance` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-dispatch-entrance` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-dispatch-entrance` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-dispatch-entrance` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-dispatch-entrance` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-library` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-library` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-library` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-library` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-library` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `mod-response-hardening` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-response-hardening` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `mod-response-hardening` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `mod-response-hardening` | IDEM | pure and writes nothing, so a retry has no effect to double |
| `mod-model-routing` | RES | no outbound I/O of its own: a pure function of what its caller hands it |
| `mod-model-routing` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `api-mongodb-storage` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-dispatch-lifecycle` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-dispatch-lifecycle` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-followup-resume` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-followup-resume` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-followup-resume` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-autopilot-wake` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-autopilot-wake` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-oauth` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-bootstrap-token-exchange` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-bootstrap-token-exchange` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-recap-brief-cache` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-recap-brief-cache` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-periodicals-two-stage` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-periodicals-two-stage` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-account-connection-workspace-credential` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-account-connection-workspace-credential` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-cost-telemetry` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-operator-decisions` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-operator-decisions` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-operator-decisions` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-account-merge` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-account-merge` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-flight-companion-turn` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-flight-companion-turn` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-flight-companion-turn` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-dispatch-halt` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-dispatch-halt` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-dispatch-halt` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-run-evidence-closeout` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-run-evidence-closeout` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-run-evidence-closeout` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-workspace-lifecycle` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-workspace-lifecycle` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-consumer-liveness` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-consumer-liveness` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-consumer-liveness` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-agent-grants` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-agent-grants` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-task-share` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
| `flow-area-notes-leftover` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-area-notes-leftover` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-area-notes-leftover` | CFG | no environment variable or flag; behaviour is fixed in code |
| `flow-as-asked-seal` | RL | returns no paged list and calls no rate-limited dependency of its own |
| `flow-as-asked-seal` | AUTH | holds and checks no credential; the route or lane that calls it does |
| `flow-as-asked-seal` | CFG | no environment variable or flag; behaviour is fixed in code |
| `meta-integration-surface-maturity-review` | ERR, RES, RL, AUTH, IDEM, VAL, OBS, SEC | a review methodology has no runtime surface for this dimension |
| `meta-integration-surface-maturity-review` | CFG | carried N/A* from run 4 (re-verified in place: no environment or flag surface) |
<!-- /gen:na -->

### Area cross-check (pass 5)

<!-- gen:areas -->
| area | ids mapped |
|---|---|
| `agent-api` | 6: `mod-model-routing`, `api-workspace-proxy`, `flow-bootstrap-token-exchange`, `flow-periodicals-two-stage`, `flow-agent-grants`, `flow-as-asked-seal` |
| `auth-accounts-and-workspaces` | 8: `mod-response-hardening`, `api-github-app`, `flow-oauth`, `flow-account-connection-workspace-credential`, `flow-account-merge`, `flow-email-identity`, `flow-workspace-lifecycle`, `flow-task-share` |
| `front-end-browser` | 4: `mod-render-layer`, `mod-task-page`, `mod-model-routing`, `flow-cost-telemetry` |
| `front-end-pages` | 9: `mod-render-layer`, `mod-ship-journey`, `mod-passage-planner`, `mod-task-edit`, `mod-task-create`, `mod-task-page`, `mod-response-hardening`, `mod-model-routing`, `flow-dispatch-halt` |
| `llm-and-prompts` | 15: `mod-periodicals`, `mod-prompt-template-system`, `mod-roadmap-trajectory`, `mod-passage-planner`, `mod-library`, `mod-model-routing`, `api-openrouter`, `api-yap-chat-client`, `flow-recap-brief-cache`, `flow-periodicals-two-stage`, `flow-cost-telemetry`, `flow-flight-companion-turn`, `flow-area-notes-leftover`, `flow-as-asked-seal`, `meta-integration-surface-maturity-review` |
| `other-features` | 6: `mod-prompt-template-system`, `mod-render-layer`, `mod-task-page`, `flow-cost-telemetry`, `flow-operator-decisions`, `flow-as-asked-seal` |
| `platform-and-plumbing` | 5: `mod-scheduler`, `mod-secret-scan`, `api-mongodb-storage`, `api-egress-proxy-fetch`, `flow-free-tier-rate-limit` |
| `providers` | 4: `mod-provider-abstraction`, `api-linear-graphql`, `api-github-app`, `api-jira-rest` |
| `reports-and-operator-tools` | 1: `mod-kpi-audit` |
| `runs-and-dispatch` | 20: `mod-dispatch-queue`, `mod-observation-materializer`, `mod-live-console`, `mod-observer-lane`, `mod-effort-readout`, `mod-task-page`, `mod-dispatch-entrance`, `api-dispatch`, `api-runner-kit`, `flow-dispatch-lifecycle`, `flow-followup-resume`, `flow-autopilot-wake`, `flow-bootstrap-token-exchange`, `flow-periodicals-two-stage`, `flow-cost-telemetry`, `flow-operator-decisions`, `flow-dispatch-halt`, `flow-run-evidence-closeout`, `flow-consumer-liveness`, `flow-area-notes-leftover` |
| `task-model` | 1: `mod-roadmap-trajectory` |
| `web-routes` | 11: `mod-render-layer`, `mod-kpi-audit`, `mod-task-edit`, `mod-task-create`, `mod-effort-readout`, `mod-task-page`, `mod-library`, `mod-model-routing`, `flow-operator-decisions`, `flow-run-evidence-closeout`, `flow-task-share` |
| `wiring` | 2: `mod-scheduler`, `mod-response-hardening` |
<!-- /gen:areas -->

---

## Adversarial Second-Read

*(Filled in after the second read; see below.)*
