# LIN-3573 replay harness (old vs new `routes/proxy-writes.js` + `routes/proxy-rulings.js`)

Built for LIN-3574 (S1 of LIN-3573). Lives on the never-merged branch
`experiments/lin-3573-replay`; nothing here enters the LinearViewer repository.

## What it does

The REAL `routes/proxy.js` composer is loaded twice from the checkout under test
(`routes/proxy.js?variant=old` and `?variant=new`). A `module.register` resolve hook
(`lib/redirect-hook.mjs`) redirects each variant's imports of `./proxy-writes.js` and
`./proxy-rulings.js` to run-time `.mjs` copies, so both variants use the real closures
(`logEvent`, `writeRejected`, `graphqlErrorStatus`, `resolve*Input`, ...) and the real
module-scope singletons (`commentDedupe`, `commentDedupeGenerations`), one set per variant.
Both are mounted on their own Express app bound to `127.0.0.1` with
`installAsyncErrorForwarding()`, `express.json({ limit: '250kb' })` and `server.js`'s final
four-argument error handler. Identical recording fakes sit under both; a controllable clock
is installed before any repo module loads (dedupe expiry and the 5 s SWR need time to move).

A seeded, stateful generator (`lib/gen.mjs`) sends the same request sequence to both and
`lib/compare.mjs` compares, per request: status, JSON body (key order ignored), handler-set
headers, and every recorded call grouped by channel (provider calls with arguments,
`resolveWorkspaceAccess(urlKey, owner, { source })`, ledger, `onTicketWrite`, event store
`recordEvent`, credential registry `markSuspect`/`witnessAccepted` -- which is how
`logEvent`'s `skipWitness` shows up --, dismissal/task/shelved stores, sessions-feed cache
`keyFor/get/clear`, dispatch store reads), console level sequence, unhandled rejections and
outbound `fetch` attempts (there must be none).

## Verbatim sources, run-time copies

* `base/routes/proxy-writes.js`, `base/routes/proxy-rulings.js` are the base files exactly as
  at the SHA in `BASE_SHA`. No rewritten `.mjs` copy is ever committed.
* `lib/hooks.mjs`, `lib/prepare.mjs`, `lib/coverage.mjs` are the pinned rung-3 blobs from
  commit `80574964` (`experiments/rebuild-rung3/replay/lib/`), byte-identical.
* `.mjs` copies are generated at run time by `prepareCopy(srcFile, destDir, repoRoot)` and the
  hook's `initialize({ workDirUrl, repoParentUrl, port })` against the checkout given by `--repo`.

Check the pins (S2/S3 run this before using the harness):

    ./verify-pins.sh <LinearViewer checkout> <recorded harness SHA>

It asserts each stored router's `git hash-object` equals `git rev-parse <BASE_SHA>:<path>`
in the checkout, the three pinned blobs equal `git rev-parse 80574964:<path>`, and that this
harness's HEAD is the recorded SHA with a clean tree.

## Running

    # old vs old (Gate 1 + Gate 3 source data), then the planted mutants (Gate 2)
    node gates.mjs --repo <checkout> --seeds 1,2,3 --n 12000 --mutant-n 9000 --out-dir results

    # one replay: base routers vs the checkout's rebuilt routers
    node replay.mjs --repo <checkout> --seed 1 --n 12000 --coverage \
         --new-writes <checkout>/routes/proxy-writes.js --new-rulings <checkout>/routes/proxy-rulings.js \
         --out report.json

    # a single planted mutant
    node replay.mjs --repo <checkout> --mutant drop-source-on-PATCH --out m.json

`--only <i>` replays request `i` alone and includes full old/new detail in the report.
Run under Node >= 22 (developed on v25.9.0); the process sets `NODE_ENV=test` itself.

## Gates (see `results/GATE-RESULTS.json`)

1. old vs old: 0 differences over >= 3,000 requests; every URL form >= 100; every status /
   `logEvent` pair the catalogue names (and every pair observed) >= 5; `?source=` on >= 25% of
   each of the 13 write forms, all five values; the bad-`target` order cases; no outbound calls.
2. every planted mutant (`lib/mutants.mjs`) reads red on its own variant; the one control
   (`{ source: undefined }` on POST /issues) reads equivalent.
3. V8 precise block coverage over the old copies: every executable block reached >= 5 times
   or justified in `dead-blocks.json`.

`expect` in the generator ("status/logEvent") names the exit each request targets; the run
fails if a request takes a different exit than the catalogue says, so the catalogue is also
the table of reachable pairs.
