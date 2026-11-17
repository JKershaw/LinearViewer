# Notes: 1-survey-task (task-9, LIN-4446)

**Written** (13:12:08.528 onward, 1s apart):
- finding-10 → design: imports need a served place for pure modules, and a purity rule
- finding-11 (in area-1) → area-1: classic scripts and `common.js` globals block turning views into modules. Out of slice. Linked `about` task-9 (v2).
- finding-12 → design: the vm test harness can't load modules
- check-13 → review: measure "lighter" on logic, not comments
- finding-14 → design: the-second-copy pattern, so each slice deletes the old copy and its parity test
- finding-15 → design: recommended order, with cost-format as the first slice
- check-16 → John: John reads the first slice's result before the next starts
- run-17 → ended `done`

Nothing ended or handed on. Nothing was addressed to survey-task.

**Looked up:** `show --task task-9`, `find --area area-1` and `--to survey-task`, plus `--text` for cost-format, parity, second-copy, common.js, observation.js, module and build step. I did this to avoid duplicates. finding-5 and finding-6 touch `common.js` but are separate issues, so I left them alone.

**Refusals:** none.

**What the output relied on that neither the brief nor a query gave:** the repo itself at 4b5001ddf. That covers `server.js:1228` static serving, `lib/components/page.js` script tags, the `common.js` and `observation.js` line and comment counts, the 68 commits, the 130 vm test files, `client-world.js`, `docs/papers/harbour/the-second-copy.md` §9–10, the `lib/cost-format.js` and `public/cost-format.js` contents, the 4 consumers, `cost-read-census.test.js:85`, and the CSP header.

**What the brief carried that the stage didn't need:** lesson-2 (poll discipline), and the area's 5 open findings, which were counted but not used.

**Couldn't place:** who the next stage is (the brief says nothing about it), so I addressed the work to `design`. The slice also needs paths outside the task's paths (`lib/`, `tests/`, `server.js`), which I noted in finding-15 instead of revising the task.
