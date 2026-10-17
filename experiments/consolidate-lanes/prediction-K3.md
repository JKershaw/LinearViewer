# Prediction for K3: untie Other features ↔ Runs & dispatch by moving the periodical gate marker to lib/periodicals.js

This prediction was written before the ticket was dispatched. Tree: `47d87055` (origin/main). Guide: `scripts/code-shape/areas.json` at `47d87055`, used unchanged for every run.

## The change being predicted

- `MARKER_ATTR`, `MARKER_RE`, `slugifyPeriodicalTitle`, `buildPeriodicalGateMarker` and `extractPeriodicalGateId`, with their doc comments (`lib/periodical-report-gate.js:37-84`), move to the top of `lib/periodicals.js`, replacing its only import. A reason comment is added above them.
- The gate imports `extractPeriodicalGateId` from `./periodicals.js`.
- The re-export is the worker's call. On the preferred route (no re-export):
  - `routes/proxy-writes.js:46` splits its import;
  - five test files repoint their imports.
- Three comments on the moved code are corrected: the gate is no longer "below"; the slug function is no longer in the gate; and the slug's doc now refers to `PERIODICALS` below and notes the LIN-2575 join.
- `areas.json` is not edited, and no function body changes.

## Predicted measurements (seams.mjs before → after)

| Measure | Before | After (preferred) | After (re-export, no importer repointed) |
|---|--:|--:|--:|
| Files in scope | 432 | 432 | 432 |
| Unresolved / unmapped | 4 / 0 | 4 / 0 | 4 / 0 |
| Area→area link rows | 62 | 61 | 61 |
| Cross-area imports (distinct file pairs) | 887 | 888 | 887 |
| **Knots (two-way pairs)** | **18** | **17** | **17** |
| Knot groups | one of 9 | one of 9 (same areas) | one of 9 (same areas) |

If a sibling seams ticket merged first, the knot count and the link rows start one lower per merged sibling. The deltas are unaffected.

**Pairs that change:** one. Other features ↔ Runs & dispatch, 1 / 2 → **gone** (one-way Runs → Other, 3). No other pair changes, on either route.

**Links that change.**

| Link | Before | After (preferred) | After (re-export) |
|---|--:|--:|--:|
| Other → Runs | 1 | 0 | 0 |
| Runs → Other | 2 | 3 | 3 |
| Agent → Other | 2 | 3 | 2 |

**Expected changes outside the knots.** These are by design.
- Entry files:
  - `lib/periodicals.js` goes from 6 importers to 8 on the preferred route, or 7 with a re-export. Its importing areas stay the same.
  - `lib/periodical-report-gate.js` loses Other features as an importing area (2 importers → 1).
- Area sizes are unchanged.

**New crossings:**
- `lib/periodical-report-gate.js` → `lib/periodicals.js`, inside Runs → Other.
- On the preferred route also `routes/proxy-writes.js` → `lib/periodicals.js`, inside Agent → Other.

Both links were already one-way, so there is **no new knot**.

## Verified in a copy

- The tree was exported with `git archive origin/main` into `copy/` (branch `base`).
- Preferred route on branch `k3`: `seams-k3.json`, `seams-diff-k3.txt`.
- Re-export route on branch `k3r`: `seams-k3r.json`, `seams-diff-k3r.txt`.
- All three sibling tickets merged together (branch `combined`) give 18 → 15, with each one's deltas unchanged.

## Lines changed (as verified in the copy, preferred route)

`git diff --stat`: 8 files, +65 / −58.

The copy predates the slug-doc fix, which adds a line or two to `lib/periodicals.js`. Comment wording is the worker's, so comment lines may differ by a few. The code lines may not.

| File | + / − |
|---|---|
| `lib/periodicals.js` | +53 / −2 (marker block, reason comment, one comment path) |
| `lib/periodical-report-gate.js` | +1 / −48 |
| `routes/proxy-writes.js` | +2 / −1 |
| `tests/unit/periodical-report-gate.test.js` | +5 / −3 |
| `tests/unit/periodicals.test.js` | +1 / −1 |
| `tests/unit/proxy-periodical-report-gate-route.test.js` | +1 / −1 |
| `tests/unit/dispatch-route-periodical-id.test.js` | +1 / −1 |
| `tests/unit/periodical-runs.test.js` | +1 / −1 |

The re-export route has 2 files, +56 / −49.

## Behaviour change

**None.** The moved block is byte-identical apart from one doc-comment line ("the report-persistence gate below" → the gate's file name), which `diff` against the old block shows.

**Replay in the copy** (`tools/replay-k3.mjs`, output `replay-k3.txt`):
- Old modules came from an export of `47d87055`, and new ones from an export of `k3`.
- **9,828 cases, 0 differences.** They cover:
  - slug and build, on 2,029 titles (every live title, edge values and 2,000 generated strings);
  - extract and resolve, on 412 descriptions;
  - `checkPeriodicalReportGate`, on those descriptions × 4 comment sets × 3 target states;
  - `getPeriodicals()` and `buildPeriodicalNodes()` as JSON.
- A slug mutant (`_` as the joiner) differed on 1,909 of 2,029 titles.
- 18 of the descriptions resolve to a live periodical.
- `lib/periodicals.js` has no import left, so there is no cycle.

**Unit tests in the copy, with non-loopback egress blocked:**
- **549 / 549** in the ticket's 6 original named files (1.6 s). `dispatch-payload-validation` and `lin-3136-m2-session-declared`, now also named, were in the 214-file run.
- **4,332 / 4,332** in every unit file that imports `periodicals.js`, the gate, `periodical-runs.js`, `dispatch-validation.js`, `dispatch-entrance.js`, `routes/proxy-writes.js`, `routes/proxy.js` or `routes/dispatch.js` (214 files, 94 s).
- Full unit suite on the combined branch: **17,424 / 17,424**, plus 12 / 12.

## Run time

- `seams.mjs`: about 0.8 s per run.
- The named unit tests: under 2 s.
- The full unit suite: about 3.5 min on this host.
- The whole task: **under 45 minutes wall-clock** to an open PR. This is a prediction, not a measurement.

## Would falsify the prediction

- A knot count other than one lower than the start (18 → 17 at `47d87055`).
- Any new pair.
- A change to any other pair.
- A replay difference or a test failure.
- An import cycle between the gate and `lib/periodicals.js`.
- A reviewer finding that the marker belongs to the gate. The strongest counter-argument is its origin: LIN-694 created it for the gate. A reviewer would have to show that the gate's rule changes when the marker format or the slug changes. Today the gate checks presence only, and the slug's value matters only to the periodicals join (LIN-2575).
