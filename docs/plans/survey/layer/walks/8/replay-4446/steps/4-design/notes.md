# 4-design notes (task-8)

**Written:** plan-26 (to plan-review; `task-8 piece`; about decision-24, check-15, finding-20, finding-21). decision-27 (scope project: the rule's reading and limits, SHARED_MODULES serving), decision-28 (task-8: module shim, `{ module }` entries), decision-29 (task-8: retirement, parity tests moved). All three go to implementation. finding-30 (to project: one counting method for observation.js). Checks to implementation: check-31 (served shape and boot), check-32 (purity), check-33 (shim on every page), check-34 (real browser), check-35 (retirement and grep), check-36 (PR text and stop). check-37 goes to plan-review. run-38 is ended done.
**Revised:** finding-18 (five renderers, not two) and check-19 (`how`).
**Handed on:** findings 9 and 17 to decision-27. Findings 10 and 11 to finding-21. Findings 12 and 22 to finding-30. finding-13 to decision-29. Findings 14 and 18 to plan-26.

**Looked up:** I ran `show --task task-8` and `get` for full texts, plans and existing checks, to avoid writing duplicates. I also ran `find --to project`, lessons, and `--to plan-review|implementation`.

**Refusals:** `{"error":"field about does not belong to plan"}`. Links can't go in `add` JSON, so I re-added without them and used `link`.

**The output relied on, and neither the brief nor a query gave:**
- the HEAD re-grounding (git log)
- area-note contents (Lessons 815/6144 bytes)
- a grep that found swipe, task-page and workspace-kpis renderers
- the consumer line numbers
- `tests/fixtures/browser-cost-format.js` and its users
- `observation-scan-due.test.js:59`
- the task-page golden
- `vendor-assets.test.js` pinning three URLs and the mount order
- the hash CSP in `lib/security-headers.js`
- the parity file holding the only server-side tests (`sumWords`)
- the 1,985 recount method
- source-map and the anchor-resolver test

**The brief carried, and the stage didn't need:** both lessons, findings 3–7, finding-20's growth figures, common.js's 1,456 comment count, and run-25 (it repeats decision-24).

**Couldn't place:** "plan-review due: yes" has no field; I used the plan's `to` and check-37. "Fits one session" has no field either.
