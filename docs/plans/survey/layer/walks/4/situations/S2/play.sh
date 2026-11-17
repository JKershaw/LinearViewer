#!/usr/bin/env bash
# S2. A withdrawn ruling leaves a false line. Recreates store.json from empty and plays the scene.
set -euo pipefail
cd "$(dirname "$0")"
rm -f store.json
L() { node ../../model/layer.mjs --store store.json "$@"; }

# Seed (Harbour): parent LIN-4448, child LIN-4469 with an open change.
L add task '{"asked":"LIN-4448 LLM & prompts"}' --by Harbour --at 2026-11-13T22:00:00Z          # task-1
L add task '{"in":"task-1","asked":"LIN-4469"}' --by Harbour --at 2026-11-13T22:00:00Z          # task-2
L add change '{"in":"task-2","ref":"LIN-4469 change","head":"h1"}' --by Harbour --at 2026-11-13T22:00:00Z  # change-3

# 1. LIN-4469's autopilot, 22:50: asks John whether merge may go ahead without the witness.
L brief autopilot --task task-2 --as-of 2026-11-13T22:50:00Z --text
L add question '{"in":"task-2","to":"John","asks":"May the merge of LIN-4469 go ahead without the witness (lin-4469-witness)?","options":["merge without witness","wait for witness"],"if-unanswered":"merge waits","links":{"about":"change-3"}}' \
  --by autopilot --at 2026-11-13T22:50:00Z                                                       # question-4

# 2. LIN-4469's builder, 23:11: records that merge waits on that question.
L brief implementation --task task-2 --as-of 2026-11-13T23:11:00Z --text
L get question-4 --by implementation --as-of 2026-11-13T23:11:00Z
L add finding '{"in":"task-2","to":"autopilot","says":"Merge of LIN-4469 waits on question-4 (may it merge without the witness?); do not merge until it is answered.","links":{"on":"question-4@1","about":"change-3"}}' \
  --by implementation --at 2026-11-13T23:11:00Z                                                  # finding-5

# 3. LIN-4469's autopilot, 23:40: withdraws the question; its re-brief shows finding-5 STALE, so it ends it.
L brief autopilot --task task-2 --as-of 2026-11-13T23:40:00Z --text
L end question-4 withdrawn "withdrawn by the autopilot" --by autopilot --at 2026-11-13T23:40:00Z
L brief autopilot --task task-2 --as-of 2026-11-13T23:40:10Z --text
L get finding-5 --by autopilot --as-of 2026-11-13T23:40:10Z
L end finding-5 declined "premise gone: question-4 withdrawn at 23:40, merge no longer waits on it" \
  --by autopilot --at 2026-11-13T23:40:30Z

# 4. A reader of LIN-4448, 09:00 next morning: what is LIN-4469 waiting on?
T=2026-11-14T09:00:00Z
L brief autopilot --task task-1 --as-of $T --text
L find --to John --state open --by John --as-of $T
L show --task task-1 --by John --as-of $T
L find --in task-2 --state open --by John --as-of $T
L find --text waits --by John --as-of $T
L show --task task-2 --by John --as-of $T
