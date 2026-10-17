# #4c: design-first rebuild of the dispatch-entrance authority, prediction (written before launch; revised before launch)

**Revision (before launch, after the fresh-reader check `fresh-reader.md`; origin/main now `675c0d33`, LIN-3605, which touched no cited file).** What the ticket now asks, and what changed here:
* A2 is a precise rule or an explicit retirement, and A4 is a comment-free count at the pin's strength (not "at least one"). Both need more scanner work, so the run-time range rises by about 15 minutes.
* The worker's replay is the existing ~2,455-input harness.
* The verbatim share is reported semicolon-normalised against the merge base, with the 60% threshold applied to it. "Outside pinned text" is dropped, because it cannot be computed.
* The function count is 106 (`functions.count`; `perFunction` adds the module).

The shape, verbatim and replay figures are unchanged.

**The question.** Once the decisions have one home (#4b, LIN-3604, PR #1913) and the location pins are gone
(#4a, LIN-3601, PR #1912), does a design-first rebuild leave the 37–55% verbatim band of round 2, and simplify further
than rung 5c (LIN-3592, the control) did?

## Baseline (`47d87055`, kit `experiments/rebuild-exp1/kit/shape.mjs`; `shape/*.json`)

| File | Lines | Code | Comment | Decision points | Functions | Over 10 | Worst function |
|---|---|---|---|---|---|---|---|
| `lib/dispatch-entrance.js` | 1,677 | 878 | 704 | 268 | 106 | 7 | `enterRecommendDispatch` 29 (`:1200-1494`); then `failure` 28 (`:804-934`), `enterSessionDispatch` 19, `finalizePrompt` 18 |
| `routes/dispatch.js` | 1,436 | 782 | 514 | 210 | 50 | 4 | the refire broker `POST /api/dispatch/broker-token` at `:1181`, 28 (not an entrance) |
| `routes/proxy-dispatch.js` | 750 | 326 | 382 | 100 | 28 | 4 | `formatDispatchWatch` 24 (`:118-198`) |
| `routes/proxy-kickoff.js` | 149 | 70 | 71 | 7 | 6 | 0 | `createKickoffRoutes` 5 |
| The entrance unit (four files) | 4,012 | **2,056** | 1,671 | **585** | 191 | 15 | **29** |
| `lib/dispatch-validation.js` (only if the design needs `executionFieldError`) | 317 | 153 | 130 | 60 | 20 | 1 | `validateDispatchPayload` 17 |

For comparison, the same unit at `15191460` (after 5c, before #4b) had 2,158 code lines, 649 decision points and a
worst function of 63. 5c had taken it from 2,450 / 708 / 122 (`docs/papers/harbour/rebuild-round.md:36`). So #4b
already halved the worst function (63 → 29) and moved 878 code lines into the authority.

The verbatim measure (`verbatim/vb.mjs`): it uses `experiments/verbatim/verbatim.mjs`'s rule for any pair of commits,
raw and with trailing semicolons normalised. It reproduces verbatim.mjs's LIN-3592 figure exactly (86.1%, longest run
151). #4b's own authority is 42.0% verbatim against the four files it replaced (raw = normalised; longest run 28),
and #4b's whole unit is 72.9% (the route files kept most of their GET/DELETE/PATCH code).

## Prediction

**Run**
- One PR, not split: about 85%. Merges: about 80%. No ruling: about 70%. The likeliest cause of a ruling is the
  plan-review loop over the conversions: #4a needed one at that point; #4b, which had a "what the plan must
  contain" section, needed none.
- 2 h – 3 h 15 min kickoff to merge. #4b took 1 h 36 with no test conversions. The A-class conversions add
  sequential commits, each with its scratch-copy evidence.

**Tests converted** (from `constraints.md`)
- A1 (the `POST_DISPATCH_GATE` anchor), A2 (the gate-predicate names), A3 (the inline `fields` literal) and A4 (the
  F3 E-count of two literals, converted to a comment-free count of the same strength): all four, about 55%; at least
  two, about 85%. A3 is the likeliest to be kept as written instead, since a design can keep one inline `fields`
  literal at no cost. A2: option (i), the precise rule keeping lin-3134's mutation tests, about 55%; option (ii),
  retiring mutations 1 and 1 (v) for the mint-sweep witness, about 45%.
- A5 (the `resolveProviderAccess` destructure line): converted about 35%; most designs keep one such line.
- A6 (the entrance file lists): only if a helper is added, about 25%.
- Expected total: 4 conversions (range 2–6), each with failing-then-passing evidence.
- LIN-3601's sweeps and the owner-gate fail-closed test unmodified: about 90%. Replacements go in new test files.
- No conversion weakens what its pin caught: about 85%. The risk is A4's count being written as "at least one".

**Shape after** (authority, plus any helper; the route files unchanged)
- Code lines 720–830 (a 5–18% cut from 878); centre 780. The entrance unit 1,900–2,010.
- Decision points 200–245 (a 9–25% cut from 268); centre 225. The unit 515–560.
- Worst function 12–20, centre 16; at most 20: about 75%. Most likely by splitting recommend-and-dispatch's two arms
  and the per-lane failure mapping, the two functions at 28–29 now.
- Comment lines roughly unchanged (700 ± 60), because every ticket reference and reason comment stays.

**Verbatim share** (new authority and helper against the merge base's `lib/dispatch-entrance.js`, plus
`lib/dispatch-validation.js` if it is touched)
- Centre 50%, range 42–60%; below 55%: about 60%; above 65% (an edit): about 10%.
- This is the semicolon-normalised share (the figure the ticket's 60% threshold applies to). Raw within 2 points of it,
  unless the worker changes the file's semicolon style.
- Why not lower: the file is contract-dense. Of its 733 non-trivial lines, 76 carry a fixed message string, 175 are
  `key: value` property lines and 64 are shorthand keys (`probe` count). That is 315 lines (43%) whose text is
  largely set by the bytes and key orders the ticket holds (the three 201 layouts `:408-466`, the row rules
  `:338-384`, the factory argument `:640-783`, the failure texts `:804-934`). A faithful rewrite reproduces most of
  them, so the share has a higher floor than round 2's routers had.
- Why not 5c's 86%: no test pins the authority's comments or whole lines once A1–A4 are converted, and the `nocomment`
  probe showed no comment pin at all. What 5c had to keep verbatim (the per-route text censuses) is gone.

**Replay** (the independent one, `replay-4c.md`, on two seeds against the merge's first parent)
- 0 differences on every tier: about 70%. If one ships, most likely in key order or first-failure order (the
  kind of change rung 5c and rung 7 made), or in the keepalive arm of recommend-and-dispatch.
- The direct-call class: 0 differences, the fail-closed property holds on the new side: about 90%.
- Coverage of `lib/dispatch-entrance*.js` at least 99%.
- The worker's own replay (the LIN-3604 harness, about 2,455 inputs at seed 3604): 0 differences reported, about 85%.

**Seams**: knots 18 → 18, no new pair or larger group: about 90%. A new helper named `lib/dispatch-entrance-*.js`
lands in Runs & dispatch by the guide's `dispatch-[^/]*` pattern (`scripts/code-shape/areas.json`, Runs & dispatch),
so it adds no area. The authority's imports today cross four existing knot pairs: Agent API, LLM & prompts, Other
features and Platform with Runs & dispatch (`seams/seams-47d87055.json`).

**Rulings**: 0. **Open questions**: the 8 from #1913 carried forward unchanged, plus 0–3 new (d) write-ups.

## What would answer the question

- **Leaves the band** (the hypothesis): share below 37%. I give it about 10%. The contract density above makes
  this unlikely even with every pin gone.
- **Inside the band, simplified further than 5c**: share 37–55% and worst function ≤ 20 (5c ended at 63; #4b at 29).
  About 55%. This would say consolidation, not the rebuild, does most of the simplifying. The rebuild's added value
  is a smaller second step, and the band is a property of faithful rewrites, not of pins.
- **Above the band**: 55–65%, explained in the PR by contract lines. About 25%.
