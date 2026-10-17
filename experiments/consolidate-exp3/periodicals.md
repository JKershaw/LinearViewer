# Round 3: the Periodicals before and after

Before is `d349e78c` (the round's start, 17 Oct 07:02Z); after is `2e8cba6e` (origin/main after LIN-3611, 16:44Z).
Every tool reads git objects, not a checkout, and all were run from the branch head against both commits' trees. The
other tools (`seams.mjs`, `areas.json`, `known-decisions.sh`, `fnshape.mjs`, `coherence-census.mjs`) are in both commits
and byte-identical there and at the branch head. `census.mjs` is in neither commit: it was run from
`experiments/consolidate-1-census/` (branch only) against each commit's tree. It is a candidate instrument for the Drift &
Coherence Review, not yet a Periodical's tool.

```
node scripts/code-shape/seams.mjs <repo> <sha> scripts/code-shape/areas.json
node experiments/periodicals-before-after/fnshape.mjs <repo> <sha>
node experiments/consolidate-1-census/census.mjs <repo> <sha> --areas-commit d349e78c
bash docs/papers/harbour/coherence-as-it-grows-scripts/known-decisions.sh d349e78c 2e8cba6e
REPO=<repo> node experiments/periodicals-before-after/coherence-census.mjs admissions <sha>
```

| Measure | `d349e78c` | `2e8cba6e` |
| --- | --- | --- |
| Seams & Tangles: knots / knot groups | 20 / one of 9 areas | 16 / one of 9 areas |
| Seams & Tangles: link rows / cross-area imports | 64 / 902 | 60 / 888 |
| Functions at cyclomatic ≥ 50 / ≥ 100 / > 10 (`server.js`, `lib/`, `routes/`) | 10 / 1 / 572 | 9 / 1 / 568 |
| Code lines / functions / total cyclomatic (same scope) | 73,425 / 6,474 / 27,944 | 73,394 / 6,548 / 27,929 |
| Census (candidate): groups / sites (cross-area groups) | 310 / 1,026 (202) | 310 / 1,023 (202) |
| Known decisions, files per decision (11 named) | 5, 0, 0, 5, 8, 6, 4, 2, 6, 15, 19 | identical |
| Comments admitting a second copy / sync-pinning tests | 121 / 34 | 120 / 34 |

- **Knots gone (4):** Providers ↔ Runs and pages ↔ Other (LIN-3600), Agent API ↔ pages (LIN-3606), Other ↔ Runs
  (LIN-3610). No knot was born. Agent API → Runs fell 46 → 34 imports (LIN-3604).
- **Functions at ≥ 50:** the two entrance handlers (63 and 52) left; `createDispatchItem` went 49 → 51 through
  LIN-3604's factory change and crossed the line. The one ≥ 100 is `runCommand` in the runner kit, untouched.
- **Census:** gone, the `WAITING_WAKE_MARKERS` constant group (LIN-3602) and the entrance's 201-receipt record group
  (LIN-3604); born, a field-list echo of `OPAQUE_FIELDS` (LIN-3604) and a near-copy of `relayDispatchRefusal`
  between the authority and `routes/proxy.js` (LIN-3611).
- **Not in any Periodical's tool (hand or ticket counts, from the scores):** waiting-on-a-person sites 23 → 14 grep
  hits (10 deciders → 1 authority); entrance sites per decision 95 → 26; the four entrance files' worst function
  63 → 13, decision points 649 → 555, code lines 2,158 → 2,115.
- The admissions census lost one line: `routes/proxy-dispatch.js`'s task-budget comment, "parity with
  routes/dispatch.js", gone with the route copy it described (LIN-3604).

The raw JSON is not committed; each command re-runs from git objects in a few seconds.
