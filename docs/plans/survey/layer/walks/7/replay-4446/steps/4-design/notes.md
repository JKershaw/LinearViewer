# 4-design notes (task-9, LIN-4446)

**Written:** plan-28 (plan, to plan-review; linked as task-9's `piece`); decision-29 (engineering choice: SHARED_MODULES allow-list + module shim, scope task-9, about finding-10/19/12/24); checks to review check-31 (parity assertions moved, not deleted), check-32 (real-browser shim check), check-33 (every page carrying a CostFormat consumer has the shim); finding-30 (to area-1: common.js/swim.js twins, next leaf slices); run-34 (done).
**Revised:** finding-21 (five renderers, not two; adds golden, fixture, source-map); check-13 (observation.js comment count is method-dependent: 1,006 vs 1,985 of 4,679).
**Handed on:** finding-12/14/15/21/24 into plan-28; finding-10/19 into decision-29; finding-20 into finding-30. Left open: check-13/22/23 (review), check-16 (John).

**Looked up:** `show --task task-9` and `get` on check-13 to see its version history (v1 1,985 vs v2 1,006), which the brief does not show; `find --area area-1` to avoid duplicating finding-11/25 (module loader, observation.js size already there); `find --kind plan` (none existed).

**Refusals:** none.

**Relied on beyond brief/queries:** the repo itself at HEAD 4b5001ddf: the grep finding render-swipe/task-page/workspace-kpis, consumer line numbers, `tests/fixtures/browser-cost-format.js`, the task-page golden, the parity file's server-side cases, `vendor-assets.test.js` pinning three URLs, `lib/security-headers.js` CSP, `docs/areas/front-end-browser.md` Lessons size (815/6144), `the-second-copy.md`, its own line recount.

**Brief carried, unneeded:** lesson-2 (timeline refresher); area-1's count; the full asked text twice over (asked + done-when).

**Couldn't place:** "plan-review due: yes" has no field; carried as plan's `to`.
