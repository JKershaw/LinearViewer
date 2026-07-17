# Roadmaps

Saved goal-anchored delivery roadmaps — the manual precursor to the **Critical Path**
experimental feature (epic **LIN-1378**).

Each roadmap takes a fuzzy goal and turns the flat backlog into an *ordered* plan:
a critical-path spine, workstream pillars, a wave-by-wave execution order sized to a
parallelism budget, and a short list of re-prioritisation moves. They are meant to be
kept and reviewed later against what actually shipped (the retro-accuracy loop,
LIN-1384).

## Contents

- **`cheap-models-reliably.html`** — road to running cheap models reliably (Opus for
  research & review, cheaper models elsewhere, billed & trusted). Critical path:
  `LIN-1326` (account model) → {`LIN-1321` presets, `LIN-1204` key-billing} → goal.
  Self-contained, theme-aware page; open it directly in a browser.

## How these are generated

The repeatable method lives in the Critical Path MVP (**LIN-1379**): a copy-paste prompt
run against a Harbour proxy token. In short — orient over `/stack?view=digest`, scope to
the goal, build the real dependency graph from issue `relations` (separating hard `blocks`
from soft `related`, and reading inverse `blocks` to find *hidden* blockers and
already-cleared "ready now" tasks), then synthesise the spine, pillars, and waves.
