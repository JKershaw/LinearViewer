# dispatch factory + validation replay (rung 5a)

Compares the outsider-visible behaviour of two versions of Harbour's
`lib/dispatch-factory.js` and `lib/dispatch-validation.js` (every export).
Both versions get the same inputs under the same frozen world; every
difference in what they return, throw, call, log, read or mutate is reported.
It never writes to `/home/user/LinearViewer` and never reaches the network
(the test tier allows loopback sockets only, for the route tests' own servers).

```
node replay.mjs --old pinned/origin-main --new <dir> [--n 3000] [--seed 1] [--out report.json] [--coverage]
                [--tiers test,edge,gen-v,gen-vx,gen-f] [--only <inputId>] [--jobs 4] [--quiet]
                [--rediscover-tests] [--test-files tests/unit/a.test.js,...] [--now ISO]
node selfcheck.mjs [--n 3000] [--seeds 1,7] [--mutant-tests] [--quick]
```

- `<dir>` holds `dispatch-factory.js` and `dispatch-validation.js`, directly
  or under `lib/` (a rebuild worktree root works). A rebuild may add helper
  files next to them: a relative import that exists in `<dir>` but NOT in the
  repo's `lib/` is loaded from `<dir>` (copied into the side's work tree on
  demand); everything else resolves to the repo's `lib/` (one shared instance
  for both sides). Set `REPLAY_SIDE_LIB_ALL=1` to also take files the repo has
  from `<dir>`.
- `pinned/origin-main/` = both files from `git show f4749b91:lib/<f>`, every
  relative import rewritten to an absolute `file:///home/user/LinearViewer/lib/…`
  URL (line-preserving) EXCEPT the factory's `./dispatch-validation.js`, which
  stays relative so each side's factory uses that side's validation.
- `pinned/test-files.json` = the 84 unit-test files that call a target export
  (discovered from 233 statically-reaching candidates with the old side;
  regenerate with `--rediscover-tests`, ~6 min).
- Default `--out` is `work/report.json`. A full run takes ~2 min (in-process
  tiers ~5 s, test tier ~105 s with 4 jobs).

Exit codes: `replay.mjs` 0 = no behavioural difference (key-order-only
differences are reported as info and do not count), 1 = at least one
difference, 2 = tool failure (bad dir, import failure, crash).
`selfcheck.mjs` 0 = every check passed, 1 = a check failed.

## Inputs (tiers; each counted separately in `totals.byTier`)

| tier | what | count at n=3000 |
|---|---|---|
| `test` | every call the existing unit tests make to a target export — directly or through `routes/*`, `lib/chat-tools.js`, `lib/follow-up-dispatch.js`, `server.js` — recorded live per side (below) | 6,354 calls in 84 files (936 `createDispatchItem`, 5,414 validation, 4 pilot-flag) + 2,159 TAP test outcomes |
| `edge` | hand-written cases from reading the code: every cap at/over the bound, first-error order pairs, null/undefined/odd body shapes, every guard's accept/refuse/fail-open/fail-closed edge, sync-vs-async store shapes, frozen/null `addItem` results, pilot timeouts, late settles, singleton-cache sequences | 339 inputs |
| `gen-v` | seeded `validateDispatchPayload` payloads: valid, 1-3 broken fields, fully random, odd body shapes, Proxy-read bodies; strings at cap/over cap/control chars/unicode/huge (10 MB prompts)/symbols/non-strings; every enum value | n |
| `gen-vx` | seeded calls of the small exports (`validateOpaqueDispatchField`, `validateSessionId`, the 8 entrance helpers, `isFilePointerPilotEnabled` with arg and from env) and three successive `.test()` calls on each exported regex (catches a stateful `/g`) | n/2 |
| `gen-f` | seeded `createDispatchItem` scenarios, stratified by profile (duplicate guard, run gate, budget/runaway, close-out, composed-run marker, anchor inheritance, routing tiers, finalize/grant, consumer stamp, file-pointer pilot, free, bad args, multi-call sequences) with noise from every other profile | n |

Every generated case has its own PRNG from `(seed, tier, index)`, so
`gen-f:1234` is the same at any `--n`. `--only gen-f:1234` re-runs one input
and puts the full old/new observations in `report.onlyDetail`.

### The fake world (in-process tiers)
Inputs are pure-data specs (`lib/world.mjs`) decoded freshly per side: every
store method, closure (`finalizePrompt`, `runGate`, `now`,
`getWorkspaceAccessToken`, `fetchIssueContext`, `readPlanBlock`,
`fetchPilotPrFiles`, `filePointerDoFetch`, …) is a recording fake with a
scripted response — resolve, reject, sync return, sync throw, hang, late
settle, by-argument, `addItem` echo (plain/frozen/null/same object), or a
cache `get` that runs the producer. Real `createTaskDoneCache()` instances can
be injected; the module singleton is exercised by inputs that omit it (unique
`urlKey` per input keeps inputs independent; sequence inputs hit it twice).

### Test tier
Each test file runs once per side as `node --import lib/test-preload.mjs
--test-reporter=tap <file>` (cwd = repo). A resolve hook redirects every
import of the repo's two target files to a generated shim that re-exports
that side's copy wrapped by `lib/test-record.mjs`: per call it records the
caller (`file:line`), arguments, every call into the argument's functions and
store methods (AsyncLocalStorage-attributed), console lines, settle mode,
result/error and argument mutation. Records are compared per file by call
index; TAP ok/not-ok per test and the file exit code are compared too.
Loopback ports in strings are normalised to `:PORT`.

## Hermetic setup (both sides identically)
- `TZ=UTC`; `HARBOUR_*`, `GITHUB_*`, `DISPATCH_*`, `OPENROUTER_*`,
  `FREE_TIER_*` cleared; per input `process.env` is a Proxy over a frozen
  copy plus the input's `env`, recording which keys are read.
- Clock frozen at `2026-10-02T12:00:00Z` (`Date`, `Date.now`); timers stay real.
- `Math.random`, `crypto.randomUUID` (CJS, ESM named export, `globalThis.crypto`)
  and sync `crypto.randomBytes` are one seeded stream, reseeded per input;
  consumption counts are compared.
- `net`/`tls`/`dns`/`http(s)`/`fetch` throw and are counted (loopback allowed
  in the test tier); the default PR reader's `globalThis.fetch` is therefore
  observed as a blocked attempt.
- `github-pr-files`' module cache is cleared before every input and side.
- Import census (`importCensus`): new globals, env changes, listeners and how
  each specifier resolved. At f4749b91: none, none, none.

## Comparison (`lib/compare.mjs`) — kinds in `groups[].kind`
`settle:<a>-><b>` (sync-throw / promise-reject / promise-resolve /
sync-return / pending after 1.5 s / missing-export), `return` (deep, key order
ignored, first differing path), `error.message` / `error.class` /
`error.props` (own props such as `duplicateDispatch`, `status`), `deps.calls`
(different dependency calls), `deps.order` (same calls, other order),
`deps.args`, `console`, `input-mutation`, `env-reads`, `payload-reads`,
`random.*`, `leaked-timers`, `unhandled-rejection`, `network`,
`returned-identity` (is the returned item the store's own object),
`call-count`; test tier adds `test-call-sequence`, `test-call-count`,
`test-args` (upstream divergence), `test-outcome pass->fail|fail->pass|added|missing`,
`test-file exit code`, `test-records-missing`. `exportsDiff` lists
added/removed exports and changed constant values; `exportsInfo` arity.
Key-order-only differences go to `infoGroups` (kind `key-order`). Each group
has a count, per-tier counts and one example (with the input spec).

## Self-check results (n=3000, `node selfcheck.mjs --mutant-tests`)
14/14 checks pass (about 14 min with the test tier run for every mutant).
Details are in `work/selfcheck/selfcheck.json` and `work/selfcheck.log`.

| check | differing inputs (by tier) |
|---|---|
| old vs old, seed 1 / seed 7 (all tiers, 14,193 inputs each) | 0 / 0 |
| flip: duplicate gate `force !== true` → `=== true` | 812 (edge 14, gen-f 481, test 317) |
| drop field: `terminal` gone from the `addItem` argument | 2,825 (edge 97, gen-f 1,973, test 755) |
| default: `applyDefaultHarness = false` | 1,506 (edge 84, gen-f 933, test 489) |
| error message: `sessionId must not be empty` reworded | 74 (edge 1, gen-v 3, gen-vx 13, test 57) |
| bound: `MAX_IDENTIFIER_LENGTH` 100 → 101 | 56 (edge 3, gen-v 51, test 1; 2 unit tests fail) |
| bound: runaway `>= 30` → `> 30` | 35 (edge 1, gen-f 24, test 10) |
| order: issueId check moved after followUpTo | 15 (edge 1, gen-v 14) |
| singleton guard cache → fresh cache per call | 56 (edge 1, gen-f 55) |
| clock: pilot `armDecidedAt` uses injected `now` | 6 (gen-f 6, the `[file-pointer]` log's `gapMs`) |
| unknown-effort `console.warn` removed | 87 (edge 5, gen-v 82; 2 unit tests fail) |
| key order only: `model`/`harness` swapped in `addItem` arg | 0 differing, 5,290 info (correctly ignored) |

Mutants caught: 10/10 behavioural mutants, and the key-order-only control correctly produced no differences (selfcheck counts all 11 as passing). Coverage of the
f4749b91 copies from the in-process inputs (seed 1):
- `dispatch-factory.js`: 545/545 lines (100%), blocks 317/319.
- `dispatch-validation.js`: 182/182 lines (100%), blocks 129/129.

The two blocks that never run are both unreachable:
- L84 is `valueWithin`'s timer `if (settled) return`. Settling always calls
  `clearTimeout` first, so the timer never fires after a settle.
- L146 is `assemblePilotPointer`'s `: Promise.resolve([])`. Its only caller
  always passes a function.

## Known limits
- The fakes are models of the stores/closures, not the real ones (the test
  tier is the real-store witness, but only for what the tests exercise).
- Thrown TypeError texts are V8's (e.g. "Cannot read properties of null
  (reading 'followUpTo')"); a rebuild that throws a different TypeError text
  for garbage input shows as `error.message` — triage those separately.
- Hangs are only scripted where the old code has a timeout (pilot reads with
  injected 5–60 ms caps); default 2–4 s caps are only exercised with
  immediate responses. The 1.5 s watchdog reports `pending`.
- `leaked-timers` counts `Timeout` handles after a 3×setImmediate flush; a
  rebuild leaving a short timer that fires before the flush is not seen.
- The test tier matches calls by index per file: one inserted call shifts the
  rest (reported as `test-call-sequence`/`test-call-count`). Randomness is
  seeded, so a rebuild consuming extra randomness can cascade into later ids.
- Lib modules other than the two targets (and helpers present only in the
  side dir) are shared from the repo checkout; changes to them are not compared.
- In-process line coverage is measured; the test tier is not part of the
  coverage figure.
