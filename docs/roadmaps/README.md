# Roadmaps

Saved goal-anchored delivery roadmaps — the manual precursor to the **Critical Path**
experimental feature (epic **LIN-1378**).

Each roadmap takes a fuzzy goal and turns the flat backlog into an *ordered* plan:
a critical-path spine, workstream pillars, a wave-by-wave execution order sized to a
parallelism budget, and a short list of re-prioritisation moves. They are meant to be
kept and reviewed later against what actually shipped (the retro-accuracy loop,
LIN-1384).

## Lineage: cheap models, reliably

A roadmap degrades as it's patched — it accumulates strike-throughs and "done" markers
and drifts from "what's the plan now?" toward "what changed since last time?" So instead
of patching forever, we **regenerate** from current state as a fresh lineage and freeze
the old one as a historical record (the reset/supersede idea; a candidate Critical Path
subtask).

- **`cheap-models-reliably.html`** — **v1, build phase** (frozen at rev 6, superseded).
  How the mechanism got built. Critical path `LIN-1326` → {`LIN-1321` presets,
  `LIN-1204` key-billing} → goal. All three spine tasks completed; presets shipped via
  `LIN-1390`/`LIN-1391`. Carries a banner pointing forward to v2.
- **`cheap-models-reliably-v2.html`** — **v2, proving phase** (current). Regenerated once
  the build spine completed and the frontier moved from "build the mechanism" to "prove
  cheap models are reliable in use." Not a dependency spine — a **validation loop**
  (choose & route → instrument → run & supervise → harden → tune) anchored on four
  explicit acceptance tests. Points back to v1 as its origin.

## How these are generated

The repeatable method lives in the Critical Path MVP (**LIN-1379**): a copy-paste prompt
run against a Harbour proxy token. In short — orient over `/stack?view=digest`, scope to
the goal, build the real dependency graph from issue `relations` (separating hard `blocks`
from soft `related`, and reading inverse `blocks` to find *hidden* blockers and
already-cleared "ready now" tasks), then synthesise the spine, pillars, and waves.
