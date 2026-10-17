TITLE: Unit suite: cap local `node --test` file concurrency at half the CPUs by default, with an env override; CI unchanged (package.json, scripts/run-unit-tests.mjs)

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** By default, a local `npm run test:unit` (and `npm test`, and the local `npm run test:hermetic`) uses a bounded share of the machine. CI keeps its current speed and invocation.
* Two sessions then fit in the machine's cores.
* Three sessions oversubscribe much less than today: about 1.5× the cores instead of about 2.6× on 8 CPUs (12 test processes instead of 21).
* That reduces the load. It doesn't guarantee no freeze, because memory may also be a limit: each test file is its own node process.
* On a machine running more sessions, `UNIT_TEST_CONCURRENCY=1` or `2` is the lever.

**Why.** On 16 October, three agent sessions on the operator's laptop each ran the full unit suite while other node work was going on, and the laptop hit 100% CPU and froze. The suite is about 17,400 tests in 823 `tests/unit` files and takes about 2–2.5 min.
* `package.json:9` runs `node --test tests/unit/*.test.js scripts/eval/eval-dense.test.mjs scripts/code-shape/seams.test.mjs` with no `--test-concurrency`.
* Node's default runs up to `os.availableParallelism() - 1` files at once, each in its own process. So each session takes nearly the whole machine.

**Decision.** Treat this as a direction to verify, not a fixed spec.
* **Wrapper.** Add `scripts/run-unit-tests.mjs`.
  * The npm scripts keep the shell glob and pass the already-expanded file list to it: `"test:unit": "node scripts/run-unit-tests.mjs tests/unit/*.test.js scripts/eval/eval-dense.test.mjs scripts/code-shape/seams.test.mjs"`. `"test"` (`package.json:7`) gets the same change, before `&& playwright test`.
  * The wrapper spawns `process.execPath` with `nodeTestArgs(files, n)`, `stdio: 'inherit'` and the inherited env, and exits with the child's code (1 if a signal killed it).
  * Keep the glob in the shell, not in JS. Npm already expands it through `sh -c`, and that keeps the file list and its order exactly as today.
  * In the header, note that `--test-concurrency` needs Node ≥ 20.10. The repo has no `engines` field, `.nvmrc` or `.node-version`; CI's `node-version: '20'` (`.github/workflows/test.yml:35`) resolves to a later 20.x.
* **Concurrency choice.** Put it in a pure, exported function `unitTestConcurrency({ env, cpus })`:
  * `UNIT_TEST_CONCURRENCY` set and non-empty → a positive integer, used as is. Anything else is refused with a clear message. An empty value counts as unset.
  * else `CI` set → no flag, which is today's behaviour.
    * Use the repo's existing truthiness check, a non-empty `process.env.CI`, which matches `playwright.config.js:17-23`.
    * So a local `CI=false` counts as CI here, as it already does for Playwright. Note this in the script's header.
  * else `max(1, floor(cpus / 2))`, where `main` passes `cpus = os.availableParallelism()`.
  * When a flag is applied, print one stderr line naming N and the CPU count.
  * `--test-concurrency` can't go in `NODE_OPTIONS` (Node rejects it there), so it has to be on the command line.
  * Also export a pure `nodeTestArgs(files, n)`. It returns `['--test', ...(n ? ['--test-concurrency=' + n] : []), ...files]` and throws on an empty `files`, because a bare `node --test` would auto-discover a different set of files.
* **CI unchanged.** CI runs `npm run test:hermetic` and `npm run test:hermetic:proxy` with `CI: true` (`.github/workflows/test.yml:47-51`, `:59-63`). The hermetic script reaches the suite through `spawn('npm', ['run', 'test:unit'], …)` (`scripts/assert-unit-suite-hermetic.mjs:135`).
  * With `CI` set, the wrapper adds no flag, so the `node --test` argv CI runs stays the same.
  * The hermetic positive control requires watcher installs to be at least the file count (`scripts/assert-unit-suite-hermetic.mjs:170-171`). The wrapper only adds one install, so that check still holds.
  * Don't change the workflow.
* **Test.** Add `tests/unit/run-unit-tests.test.js`. It binds no server. If you add one anyway, it binds `127.0.0.1`.
  * Import the pure functions and cover:
    * the override wins, even with `CI=true`;
    * an invalid override (`0`, `-1`, `abc`, `2.5`) is refused;
    * an empty override counts as unset;
    * a non-empty `CI` (`true`, and `false` too) → no flag;
    * an unset or empty `CI` → local;
    * `floor(cpus/2)` with a floor of 1 (cpus 1, 2, 3, 8, 16);
    * `nodeTestArgs` puts the flag only when `n` is given, keeps the file order, and throws on an empty list.
  * Add one spawned check:
    * Spawn the wrapper with a dry-run flag and an env built as `{ ...process.env, CI: 'true' }` with `UNIT_TEST_CONCURRENCY` deleted.
    * Assert the argv it would run is exactly `['--test', ...files]`.
    * Use two or three placeholder file names; the dry run must not check that they exist.
* **No census to update.** At `origin/main`, no test pins `package.json` script text. Check again at your base.
* **Docs.** `CLAUDE.md:22` and `:23` both quote the bare `node --test tests/unit/*.test.js`, and an agent can copy either of them past the cap. Change both in place and add no line:
  * `:22` → "- `npm test` - Run all tests (unit via `npm run test:unit`, then Playwright E2E)". That is −15 bytes.
  * `:23` → "- `npm run test:unit` - Run unit tests only (`node --test` over `tests/unit/*.test.js` + two `scripts/` tests; locally at half the CPUs, `UNIT_TEST_CONCURRENCY=N` overrides; CI unchanged). Use this, not a bare `node --test` glob". That is +148 bytes.
  * CLAUDE.md is at **110/110 lines** and 10,587/12,000 bytes (`tests/unit/claude-md-line-budget.test.js:28-29`). The net +133 bytes takes it to 10,720 bytes, still at 110 lines.
  * `README.md:188` can stay as it is.
  * Optionally, add `UNIT_TEST_CONCURRENCY` as a test-only line in `docs/architecture/configuration.md`, next to `MONGODB_TEST_URI` (`:13`).

**This is one PR. Don't split it into child tickets.**

Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.

No live checks; no paid model calls.

**Done when.** The PR is merged with `ci-success` green. The PR shows:
* one local full-suite run's wall time and the concurrency it used (the wrapper's stderr line);
* that CI's invocation is unchanged: `.github/workflows/test.yml` is untouched, and the `CI=true` test shows the argv has no flag.

**Out of scope.**
* e2e/Playwright `workers` (owned by LIN-625).
* Other repos.
* Other direct full-suite runners, which stay unbounded:
  * `scripts/survey-tests-mutate.mjs:18,24-27`, which could later import `unitTestConcurrency`;
  * the usage comment at `scripts/survey-tests-reporter.mjs:2`;
  * the repo-agnostic coverage periodical at `lib/periodicals.js:281`.
* Prompt text: no stage template or runner prompt names the unit command, so none changes.
