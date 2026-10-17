# LIN-3604 entrance replay

Drives the four dispatch entrances (session `POST /workspace/:urlKey/api/dispatch`, proxy
`POST /api/proxy/dispatch`, both arms of `POST /api/proxy/recommend-and-dispatch`, and
`POST /api/proxy/autopilot/kickoff`) over HTTP, old tree against new, on one seeded input stream,
and compares every observable channel. Not part of the unit suite.

```sh
R=experiments/lin-3604-entrance-replay
mkdir -p /tmp/old && git archive $(git merge-base HEAD origin/main) | tar -x -C /tmp/old && ln -s $PWD/node_modules /tmp/old/node_modules
TZ=UTC NODE_ENV=test node --import ./$R/preload.mjs ./$R/run.mjs --tree /tmp/old --out /tmp/old.jsonl
TZ=UTC NODE_ENV=test node --import ./$R/preload.mjs ./$R/run.mjs --tree "$PWD"   --out /tmp/new.jsonl
node $R/compare.mjs /tmp/old.jsonl /tmp/new.jsonl
```

* `preload.mjs` freezes the clock, shortens the keepalive timers (a flush is a few ms, the heartbeat never
  fires) and captures `console`.
* `inputs.mjs` is the seeded stream (seed 3604): template-plus-mutation inputs per entrance, the
  multi-fault class (one fault per check step, every ordered pair of steps, seeded triples, pairs inside the
  shared payload validator), a valid-issue-without-`dispatch` class, keepalive and hang-up cases, and
  no-body-parser cases.
* `world.mjs` builds the recording fakes one input runs in (stores, token store, provider, the Agent-API
  closures). No network and no model call is possible.
* `run.mjs` records, per input: status, the headers that matter, body bytes (key order included), every
  dependency call in order with its arguments (`addItem` arguments with sorted keys), and console output.
* `compare.mjs` reports every difference, and runs the vacuity guard: in the OLD run a pair of faults must be
  answered exactly as its earlier step's single fault, so a pair can never pass by testing nothing.
