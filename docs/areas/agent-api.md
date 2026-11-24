# Agent API (proxy)

Area notes for `agent-api` in the registry. Format and rules: README.md.

## Lessons

- `proxyLimiter` runs before `authenticateProxyToken` on purpose, so its key may trust a
  bearer only after auth has proved it (`provenCredentials` in `routes/proxy.js`); a key
  from an unverified bearer gives each junk bearer a fresh bucket and floods reach the
  token store (LIN-4378). The limiters skip under `NODE_ENV=test`, so a limiter
  test drives the real chain with it flipped off, as
  `tests/unit/lin-4378-proxy-limiter-per-credential.test.js` does.
- A recommend surface must not offer what the verb refuses: a rule for recommend-and-dispatch
  goes in `CODE_ROUTES` (`lib/code-routes.js`, iterated by `codeRouteOf` in `lib/openrouter.js`),
  which GET /recommend (`routes/proxy-compute.js`) and the task page also reach; a descent-arm check (`lib/dispatch-entrance.js`) covers one
  surface, without run facts. A caller's bypass rides the call options (`skipLiveWait`),
  never the recommendation context (LIN-4392).
- `/cost/:identifier` (`routes/proxy-compute.js`) is pinned by frozen baselines. A change to its window or shape
  moves `tests/fixtures/cost-replay/expected-changes.json` (W9 checks paths, not values, so pin moved values in
  `tests/unit/cost-read.test.js`), `tests/fixtures/cost-replay/goldens-lin4197.json` (amend its header with the
  reason; record with `tests/fixtures/cost-replay/record-lin4197.mjs`) and the `docs/passage-runner-prompt.md` drift
  guard. `tests/fixtures/cost-replay/goldens.json` stays the baseline: re-recording it erases the change list (LIN-4404).
- A format check on an optional create or PATCH field refuses (400); it is never the field's
  `present` gate. As a `present` gate it skipped the value, and the write succeeded without it: a
  Jira key or a Linear identifier in `parentId` vanished. Check presence first, then the writable
  contract, then the format (`routes/proxy-writes.js`, LIN-4451 create, LIN-4452 PATCH).
- A typed error a provider method gains reaches a caller only if every route calling that method
  maps it: `refs`/`partial` in the proxy write `SPEC`, and each session or feedback catch by hand.
  Provider tests passed while all three create lanes answered a bare 500 for a landed create. Pin
  it at the route boundary (`routes/proxy-writes.js`; `tests/unit/lin-4452-create-lane-envelope.test.js`).
- Every proxy write mount names its operation: `requireWriteScope('<op>')` for a readWrite route,
  `requireStageWrite('<op>')` for a grant-gated one, with `<op>` in `STAGE_WRITE_OPS`
  (`lib/stage-writes.js`; the gate is `lib/stage-write-gate.js`). A stamped token is refused any
  operation its allowance does not list, so a route nobody named would be refused to a reading
  stage without a word, and an unnamed name throws at mount. A new write route adds its operation
  to that list and a row to `CENSUS` in `tests/unit/lin-4468-stage-write-allowance.test.js`, or the
  census fails (LIN-4468).
- A token minted for a stage carries its `writes` and ticket, or has a reason not to. Pass both into
  the mint helpers (`lib/proxy-preamble.js`), or read them from the row (`lib/item-stage-stamp.js`).
  A wake, immediate or held, takes the stamp of the session it resumes, the parent, not the row that
  reported (`stampForWakeParent`; a held release gets the producing build's id from the store). A mint
  with neither is unrestricted, which is right only for a person's or a `custom` mint, listed with its
  reason in `tests/unit/dispatch-entrance-mint-sweep.test.js`. The refire broker minted unrestricted
  tokens for read-only rows because its mint was a bare `createToken`, which no helper-name search
  finds (LIN-4468).
- A proxy token records its `origin` and, for a dispatch token, its `runRecordId`, set at mint and copied once by the
  exchange (LIN-4492). A person's mint goes through `personMint()` (`lib/stage-writes.js`), which the census pins to the tokens
  page and the test seams; a bare `origin: 'person'` is ignored. Find every mint by its call (`tests/unit/lin-4492-mint-census.test.js`):
  a helper-name search misses a bare `createToken`, which is how LIN-4468 found its gap. A new mint fails the census until it is listed.
  An owner-issued runner or agent grant copy is a `person` credential: it acts as the owner, so a record written with it is filed as
  `person:<owner>` by design, and a comment posted with it is the owner's finding (one person test, `personOfCredential`, LIN-4548). `lib/run-lineage.js` `writerOf` is the pure refusal check; the records routes (`routes/proxy-records.js`,
  LIN-4493) call it, reading the runs from the records store, and a refusal names its reason (403).
- The dispatch factory allocates a row's id before its prompt is finalized (LIN-4492, `lib/dispatch-factory.js`). The prompt and every
  credential minted for the row name it; `addItem` takes that id only as its trusted third argument, never from a body field.
- A new proxy route file adds a row per registration to `tests/unit/proxy-endpoint-inventory-witness.test.js`, and each write
  mount a `CENSUS` row in `tests/unit/lin-4468-stage-write-allowance.test.js`; both fail until it does (LIN-4493 added seven and four).
- A dispatch credential files records only if its row names a run, so every finalizer passes the factory's `runRecordId`
  to its mint. The feedback autopilot dropped it (`routes/workspace-api-feedback.js`) until LIN-4531 made a fresh kickoff
  start a run (`startsRunRow`, `lib/run-identity.js`). Every `runRecordIdFor` caller passes `followUpTo` too, or a
  kickoff's follow-up reads as a run of its own.
- Records reads log who asked via `proxyAskerOf` (`lib/stage-writes.js`). The brief logs carried ids under a run only
  on its own task: a run's end ends them (LIN-4536).
