# Notes: 1-survey-task (task-16, LIN-4463)

**Written** (all `in` task-16): run-17 (run, account revised in v2, ended `done`); finding-18 (common.js is the hub) → design; question-19 (which import specifier scheme) → design; finding-20 (test seam: plain Node imports, not a new loader) → design; finding-21 (one general bridge plus a shrink-only ratchet) → design; finding-22 (three Waiting entries out of scope) → scoping; finding-23 (symptom vs cause) → design; finding-24 (suggested order) → breakdown.

**Handed on:** finding-12 → finding-20; finding-10 → finding-21. Left open: finding-6/7/8/9/11/13/14/15, linked `about` where relevant.

**Looked up:** `show --task task-16` (no prior records), `find --area area-1` (returned only the task), `find --in area-1` (lessons 2–5), then `find --to area-1 --state open` to read the 10 Waiting entries. The brief only gave "area-1 (10 open)", and my real output drew on them.

**Refusals:** none. One slip: I added run-17 without `account`, so I revised it in before ending it, which cost one extra write.

**What my real output relied on that no brief or query gave:** repo inspection at c205190fd: 51 `window.*` globals, 29/28 renderers, 64 suites and 85 `world.run` calls, `scriptBodyHash` in page.js, `package.json` `"type": "module"`, 11 dual-export files and which of them are small, and the `/shared/` specifier in cost-format-global.js.

**Brief carried but unneeded:** lesson-2 (poll discipline). Done-when appears twice, inside `asked` and on its own.

**Couldn't place:** whether `scoping` or `breakdown` reads next. The "area note" my output cites maps to Waiting findings (`to` area-1), not to a record of its own.
