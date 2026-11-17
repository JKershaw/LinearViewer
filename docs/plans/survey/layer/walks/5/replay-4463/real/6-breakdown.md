# What this stage really wrote

## Comment on LIN-4463 at 16:05:48

### Breakdown

The approved plan is split into its two pieces. Plan review Approve: comment `73a74028-bbe9-4a4a-b502-8ed268a6bd08`, rev 1.

| Subtask | Piece | Blocked by | Session fit |
|---|---|---|---|
| **LIN-4471**: `/lib/` serving, bridge and import checks, workspace KPIs as a module | 1, the foundation and its smallest real consumer | none, lands first | One session. The plan pairs the foundation (re-keying `/shared/` to `/lib/`, the import helper, and the import-layout, bridge-inventory, served-leaf-owner and loader-census checks) with one real page module, so the specifier scheme is proven by a real page in the same change. Every item is small and fully specified. |
| **LIN-4472**: task page as a module, its suites as imports | 2, one real page top down | LIN-4471 | One session. It converts one page entry, the last script of one renderer, adds nothing to the bridge, and migrates that page's suites onto piece 1's helper. |

**Re-grounding.** Since the ticket was filed, the only commits on main are `b708a9815` (a merge) and `e8e92d50a` (LIN-4456). Neither touches a file or line the plan names. `e8e92d50a` edits `docs/architecture/source-map.md`, but not lines 151 or 347. The `/shared/` references and the four `window.CostFormat` readers still match the plan as amended by review note 7.

**Where the review's notes went.** I folded the review's eight builder notes into the subtask that each one affects:
- Into LIN-4471: the rewritten e2e witness, the helper's requirements, the corrected witness-timing predicate, keeping renderer coverage, whole-module and bare-read discovery, the other-features Waiting entry, the `docs/`-wide URL scope, and the KPI order pin.
- Into LIN-4472: the run-control and label-listener text pins.

**Cuts to `## As asked`: none.** The plan and the review agree on this: two views plus a bridge that stays the only one and shrinks under a check meets "one view at a time" and the first Done-when branch. The blind-read Done-when is judged after both pieces land. It is not a build subtask.

**What follows (not created here; one ticket each, by the same recipe):** `flight-companion.js`, then `observation.js`, then the `prompt-section.js` chain (`app.js`, `swipe.js`). After the last of these, the bridge and `tests/fixtures/browser-cost-format.js` are deleted.


## Subtasks it created (titles from LIN-4463.json's children; their descriptions and creation times are not in the material)

- LIN-4471: Front-end modules piece 1: /lib/ serving, bridge and import checks, workspace KPIs as a module
- LIN-4472: Front-end modules piece 2: task page as a module, its suites as imports
