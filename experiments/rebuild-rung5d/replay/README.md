# pipeline-loops behavioural replay (rung 5d)

This tool compares two versions of Harbour's `lib/pipeline-loops.js`. It runs
the same scenarios through an OLD and a NEW version and reports every
difference an outsider could observe. It never writes to
`/home/user/LinearViewer` and makes no network calls (anything non-loopback
is blocked and counted). It also makes no model calls.

```sh
node replay.mjs --old pinned/origin-main --new <dirOrFile> [--n 3000] [--seed 1] [--out report.json]
                [--coverage] [--jobs 4] [--tiers test,edge,gen] [--only gen:1234] [--recapture] [--quiet]
node selfcheck.mjs [--n 3000] [--mutant-n 1500]     # ~8 min
```

- `--old` and `--new` each take a folder that contains `pipeline-loops.js`,
  or the file itself. `--old` defaults to `pinned/origin-main`.
- `pinned/origin-main/pipeline-loops.js` comes from
  `git show f4749b91:lib/pipeline-loops.js`, with its six `./x.js` imports
  rewritten in place to `file:///home/user/LinearViewer/lib/x.js`. The rewrite
  keeps line numbers stable, so the file has the same 1868 lines.
- Exit codes:

  | Code | Meaning |
  |---|---|
  | 0 | identical |
  | 1 | at least one difference, or the export surface differs |
  | 2 | the tool failed |

- If you don't pass `--out`, the report goes to `work/report.json`.
- For an identity run, use `--new pinned/origin-main`.

## How it works

### Sides (`lib/prepare.mjs`, `lib/hooks.mjs`)

Each side is copied to `work/run-<pid>/<side>/lib/`, and its relative imports
are handled in one of two ways:

- **Imports that exist in the side's own folder** are copied along and stay
  relative. A rebuild's new helper modules therefore count as part of that
  side.
- **All other imports** are rewritten in place to absolute URLs into the
  repo's `lib/`, so both sides share one instance of every unchanged module.

A loader hook passes `?inst=<side>-<scenarioId>` from the main file to every
module inside the side tree. As a result, **every scenario on every side
gets a fresh module instance**. This resets the hidden warn-once Set
(`_warnedMalformedCauses`), and anything a rebuild might add, to the same
empty state for both sides.

The scenarios run in worker threads, 220 scenarios per worker and 4 workers
at a time.

### Hermetic setup (`lib/hermetic.mjs`)

- `TZ=UTC`, `NODE_ENV=test`, and `OBSERVATION_*` / proxy / `DISPATCH_*` env
  vars are scrubbed.
- `OBSERVATION_FEED_TIMING`, the only env var the module reads, is set by
  each scenario.
- The clock is frozen at `2026-10-01T12:00:00Z`: `Date.now()` and `new Date()`
  return that instant.
  - The frozen `Date` keeps `instanceof Date` true for structured-cloned
    Dates. `toEpochMs` depends on this.
- `Math.random` is reseeded for each step.
- The network guard blocks any non-loopback connect, `dns` call or `fetch`.

### Inputs (`totals.byTier`)

The default run has 3,795 inputs:

| Tier | Inputs | Source |
|---|---|---|
| `test` | 751 | Unique calls captured from the existing unit tests |
| `edge` | 44 | Targeted cases written from the code |
| `gen` | 3,000 | Seeded generated scenarios |

**`test` (`lib/capture*.mjs`).** These inputs were captured by running 35
test files in place under a preload. The preload adds the frozen clock, the
network guard, and a resolve hook that gives every importer of
`lib/pipeline-loops.js` a recording shim:

- The importers are tests and the `lib/`/`routes/` modules they drive:
  dashboard, chat-tools, the observer sweep, the materializer, the ticket
  closer and others.
- The shim records each boundary call: its args, with store objects replaced
  by `{$store}` placeholders, a transcript of every store call (args plus the
  sync, async, throw or reject outcome), and the env.
- Up to 40 calls are kept per call site, then duplicates are dropped
  (1,083 raw calls from the 27 files that reach the module became 751 unique ones).
- Replay serves each recorded store transcript back, matched by method plus
  canonical args.
- **Capture fidelity:** for all 751 calls, replaying them on the old side
  reproduces exactly what the real call returned inside the test
  (`capture.fidelity`).
- The capture checks `git status` before and after (`repoUnchanged: true`).
- Four tests across three files fail under the frozen clock
  (liveness-real-lean-sweep, observer-efficacy-signal, observer-sweep).
  Their calls are still captured.
- The capture is cached in `work/captured-*.v8`; `--recapture` redoes it.

**`edge` (`lib/edge.mjs`).** Targeted cases cover:

- the 30-day cutoff exactly and at +1 ms, `horizon:'all'`, and an epoch-0
  `dispatchedAt`
- `now` passed as a string or a number (throws)
- non-iterable lists, and malformed rows called repeatedly (warn-once)
- inclusive window bounds, exact-`dispatchId` ties and null timestamps
- same-millisecond `localeCompare` tie-breaks
- an `__anchor__:`-named issue, and general autopilot anchors
- the full agent-state truth table
- legacy, garbage and missing digests
- lean vs non-lean on the same rows
- abort harvest: later, earlier, `[skipped]`, lean
- the decision, answer, withdrawal and reversal lifecycle
- every `_buildSessions` stitch branch: the LIN-1393 straddle (four forms),
  a group id that is a session key, an aged-out group root, an incompatible
  root, legacy chains with a dash root, an autopilot root, cycles,
  self-loops, missing roots, duplicate `loopId`s, inference
  (seed/descendant/ancestor, foreign-stamped rows, a second orchestrator),
  and `taskPosition` with `maxTasks` set to `'3'`, `0`, `1`, `2.5`, `null` or
  `Infinity`
- every I/O guard
- self-heal: stale rows, a vanished row, `updateOne` rejecting with a bare
  string or an empty `Error`, `find` rejecting
- `OBSERVATION_FEED_TIMING`
- sync and garbage store results, and sync store throws

**`gen` (`lib/gen.mjs`).** Each case is a pure function of
`(seed, 'gen', index)`, so `--only gen:1234` reproduces it.

Each scenario contains a realistic workspace history (`genWorld`):

- 1–7 issues with a parent graph, occasionally cyclic
- autopilot runs, 25% of them general (no issue), with workers that are
  stamped, unstamped or foreign-stamped
- follow-up chains: stamped with the root's group id, the parent's id or a
  foreign id, unstamped legacy chains, dangling, cyclic
- aborts (`[aborted]`, `[skipped]` or `[done]`), wake rows, live queue rows
- rows outside the 30-day window, duplicate ids, malformed rows
- `dispatchedAt`/`resolvedAt` given as ISO strings, `Date`s, epoch numbers,
  `+00:00` offsets, garbage or missing, and `resolvedAt` earlier than
  `dispatchedAt`

Feedback follows the parsers' grammar: heartbeats, evidence, usage,
resources, ticket markers, parked waits, decisions (valid or malformed, with
`assistant-text` runs before them), answer, withdrawn and reversed stamps,
wake markers and terminal markers. Timestamps are sometimes out of order,
null or garbage.

Digests come from the real `digestFeedback`:

- fresh (70%)
- missing, null, stale, legacy (no `answeredDecisions`/`withdrawal*`), no
  version, or weird

Agent-status entries are in the `listStatus` shape. They come with or
without `dispatchId`, carry free-form statuses, and include tokens.

Families: `buildLoops`, `sessionsChain` (each side runs its own `_buildLoops`
and then `_buildSessions`), `sessionsHandBuilt`, the four `get*` readers,
`_fetchWorkspaceData` and `redigestHistoryRows` (both over a semantic fake
store), `small` (every other export and internal), and `sequence` (2–3 calls
in one instance, for warn-once).

The semantic fake store (`lib/fakes.mjs`) answers by args, the way the
Mongo-backed stores do:

- issue filter, `since` window, projection, `_id $in`
- 30% of runs are `naive` (opts ignored), like most test doubles
- injected failures: sync values, throws, rejections, non-array or `null`
  shapes, `find` rejecting or dropping a row, `updateOne` failing

### What is compared per step (`lib/compare.mjs`)

| Kind | What it covers |
|---|---|
| `outcome` | return / throw / resolve / reject |
| `async-shape` | whether the call returns a promise |
| `error` | name, constructor and message |
| `return` | deep, key order ignored. `undefined`-valued keys count, so they differ from absent keys. Dates, Maps, Sets, functions and NaN/-0 are tagged. The `_hierarchyHelpers` closures are invoked on probe ids. |
| `console` | every console call, in order |
| `storeCalls` | every store call with canonical args, as a multiset |
| `input-mutation` | the args after the call |
| `store-result-mutation` | the module mutating what a store returned |
| `unhandled-rejection` | rejections nobody handled |
| `import-side-effects` | console output at import time |

Three info kinds are reported in `infoGroups` and don't count as
differences:

| Info kind | What it covers |
|---|---|
| `key-order` | order of object keys, Maps and Sets |
| `alias` | an output object that *is* an input object or a store-returned object, or that appears twice |
| `storeCalls:order` | the same store calls in a different order |

`exportsDiff` compares:

- export names
- function arity and whether each function is async
- every `__internal` member, including `LOOKBACK_MS`
- whether the re-exports are the *same* function objects as
  `lib/digest-feedback.js`'s

Groups are keyed by kind + function + normalised path, with counts per tier
and one example each.

### Coverage (`--coverage`)

Coverage uses V8 precise coverage through `node:inspector`, collected in each
worker and folded per file across all module instances and workers. The
import rewrite keeps line numbers, so they match the source file.

- A block counts as hit when the union painting covered its first character.
- V8 drops ranges whose count equals the parent's, so naive summing
  under-counts.
- Coverage is reported per tier and for all tiers together.

## Self-check results

From `selfcheck.mjs`, with `--n 3000` for the identity runs and
`--mutant-n 1500` for the mutants. The full table is in
`work/selfcheck/selfcheck.json`.

| check | result | differing (test/edge/gen) | caught as |
|---|---|---|---|
| identity seed 1 (old vs old) | PASS | 0/3795 (0/0/0) | — |
| identity seed 2 (old vs old) | PASS | 0/3795 (0/0/0) | — |
| M1 agentState blocked→running | PASS | 98/2295 (16/2/80) | return 108 |
| M2 window upper bound inclusive→exclusive | PASS | 30/2295 (8/1/21) | return 32 |
| M3 warn-once removed (warn every time) | PASS | 35/2295 (0/2/33) | console 48 |
| M4 _assembleSession sorts the caller's array in place | PASS | 9/2295 (0/2/7) | input-mutation 9 |
| M5 lean projection keeps feedback | PASS | 418/2295 (244/5/169) | storeCalls 419, return 23 |
| M6 lean promptText present-as-undefined | PASS | 715/2295 (287/9/419) | return 809 |
| M7 live cutoff off-by-one (< → <=) | PASS | 1/2295 (0/1/0) | return 1 |
| M8 self-heal write-back drops the version guard | PASS | 168/2295 (62/4/102) | storeCalls 169 |
| I1 key order only (must be info, not a difference) | PASS | 0/2295 (0/0/0) | info: 925× key-order __internal._buildLoops $[] |
| I2 feedback copied instead of shared (aliasing only) | PASS | 0/2295 (0/0/0) | info: 556× alias __internal._buildLoops $[].feedback (old shares) |

Coverage of the pinned file (seed 1, all tiers): lines 800/800 (100%), blocks 749/759; by tier {'test': '97.13%', 'edge': '98.63%', 'gen': '100%'}.
The 10 never-hit blocks are unreachable defensive code: L713/L720 `lineage…get(lineageId) || []` (the key is always present), L1245/L1246/L1373/L1374 `continue`s for autopilot/sessionId loops (always already claimed by passes 1–2), L1335/L1337/L1338 (a claimed root always has a record; a chain root is always in `loopById`; autopilot roots are always claimed), L1729 `timing || {}`.

## Limits

- **The stores are models.** The semantic store follows the real query
  predicates, not Mongo. A rebuild that issues *different* store queries
  gets truthful but modelled answers, and the change shows up as
  `storeCalls`.
- **Captured transcripts.** Test-tier transcripts fall back to call order
  when the args don't match.
- **Shared modules.** `lib/` modules outside the side folder are shared,
  pinned at the checkout, and not compared.
- **Concurrency.** Interleaving inside `Promise.all` is not explored. Both
  sides get immediately-resolving stores.
- **Order is info only.** Key order and aliasing are reported as info,
  never as differences. Treat a new `alias` group as a review item: callers
  may mutate shared arrays. The one known aliasing is that `loop.feedback`
  is the input's array.
