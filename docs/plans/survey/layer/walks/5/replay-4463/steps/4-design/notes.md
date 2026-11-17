# 4-design notes

**Written:** run-35 (ended done); decision-36 (top-down order, two-piece boundary, common.js not relocated), decision-37 (one bridge, no new names, inventory check), decision-38 (native import + fake DOM, no vm loader); plan-39 (piece 1, order 1) and plan-40 (piece 2, order 2), both `in` task-16; check-41 to review (the `/lib/` allow-list witness); check-42 to implementation (e2e witness, never marked passed unrun); finding-43 to area-1 (next views in order). Linked task-16 `piece` to plan-39.
**Revised:** check-32 (widened to import resolution), finding-8, finding-9 (what unlocks each Waiting entry now).
**Ended:** finding-18, -23, -26 done; finding-21 declined (general shim); finding-20 handed-on into plan-40; finding-27, -28, -29 handed-on into plan-39 (29 with a correction).

**Looked up:** `show --task`, open area-1 records and findings 6–15 (to map the ten Waiting entries), the `into` of finding-10/-12/-22/-24, check-32's fields, existing plans (none). Then plan-review's brief, to see what it will get.

**Refusals:** none.

**Relied on outside brief and queries:** everything read from source: the commit/merge check, `lib/components/page.js` module emission, 11 renderers loading `app.js`, `task-page.js`'s guards and last-script position, CSP in `lib/security-headers.js`, six renderers carrying the bridge, eleven `module.exports` files, `close-out.js`'s two users, `e2e` line 209, the 2,114-byte Lessons size, `areas.json` mapping, acorn as a dependency, the test file names.

**Carried but not needed:** lesson-2 and lesson-3 in full, finding-30 (scoping's), the full `asked` text twice (part 1 and done-when).

**Couldn't place:** `piece` takes one plan, so plan-review's brief part 2 shows plan-39 only; plan-40 shows only via `show`. "plan-review due" and "needs multiple sessions" have no field; put in the run account.
