# What this stage really wrote

## Comment on LIN-4446 at 14:56:08

## Implementation: LIN-4446, slice 1 (cost formatter), PR ready for review

PR: https://github.com/JKershaw/LinearViewer/pull/2423 (branch `feat/lin-4446-shared-cost-format`, commit `24de9abc9`)

- The reading of the no-build-step rule is in `CLAUDE.md` and the front-end-browser area note (Lessons).
- `lib/cost-format.js` is the one formatter, served as `/shared/cost-format.js`. `public/cost-format.js` (34 lines) and its parity test are retired; the browser copy is now a 12-line module shim.
- `public/workspace-kpis.js` builds on DOMContentLoaded so the chart's tick callback never reads the formatter during script load.
- Evidence: the KPI ordering witness fails on the old code with the formatter TypeError; mutation checks, a real-browser check and the real-server 404s pass. Full unit suite 25,300 tests, 0 failures. CI green (unit, proxy, E2E shards, secret scan).
- No view is reworked or retired. Per the plan, the next slice waits for John's read of this one.

Raised for John: the PR describes what was cut (nothing) and the gaps (serving tests not run against HEAD; chart ordering not covered by e2e).
