#!/usr/bin/env bash
# S1: lanes ask each other, and go ahead on silence. Recreates store.json from empty.
set -u
cd "$(dirname "$0")"
rm -f store.json
L() { node ../../model/layer.mjs --store store.json "$@"; echo; }
D=2026-11-13
T0=${D}T16:00:00Z

echo "### SEED (Harbour, $T0)"
L add area '{"name":"Runs & dispatch","paths":["lib/dispatch/"]}' --by Harbour --at $T0          # area-1
L add area '{"name":"LLM & prompts","paths":["lib/llm/"]}' --by Harbour --at $T0                  # area-2
L add task '{"asked":"LIN-4447 Runs & dispatch lane","paths":["lib/dispatch/"]}' --by Harbour --at $T0          # task-3
L add task '{"asked":"LIN-4448 LLM & prompts lane","paths":["lib/llm/"]}' --by Harbour --at $T0                 # task-4
L add task '{"in":"task-3","asked":"LIN-4458 classifier home and run census","paths":["lib/dispatch/census/"]}' --by Harbour --at $T0   # task-5
L add task '{"in":"task-3","asked":"LIN-4459 live-wait move","paths":["lib/dispatch/live-wait/"]}' --by Harbour --at $T0              # task-6
L link task-3 about area-1 --by Harbour --at $T0
L link task-4 about area-2 --by Harbour --at $T0

# ---------------------------------------------------------------- 16:42
T1=${D}T16:42:00Z
echo "### 1. LIN-4458 build session ($T1): brief"
L brief implementation --task task-5 --as-of $T1 --text
echo "### 1. lookup: where is LIN-4448's lane?"
L find --kind task --text LIN-4448 --by implementation --via "LIN-4458 build" --as-of $T1
L add run '{"in":"task-5","stage":"implementation","claims":["lib/dispatch/census/"]}' --by implementation --via "LIN-4458 build" --at $T1    # run-7
L add decision '{"in":"task-5","answer":"Census boundary: count runs dispatched from lib/dispatch/ only; classifier-only LLM calls stay outside the census","why":"The census measures dispatch, not model use","scope":"task-5"}' --by implementation --via "LIN-4458 build" --at $T1   # decision-8
L add question '{"in":"task-5","to":"task-4","asks":"Is the census boundary drawn right for the LLM & prompts lane? Tell me on LIN-4458 if you want it drawn differently.","options":["keep as drawn","redraw"],"recommended":"keep as drawn","if-unanswered":"LIN-4458 keeps the boundary as drawn (decision-8)","links":{"on":"decision-8@1","about":"area-2"}}' --by implementation --via "LIN-4458 build" --at $T1   # question-9

echo "### 2. LIN-4459 session ($T1): brief"
L brief implementation --task task-6 --as-of $T1 --text
L find --kind task --text LIN-4448 --by implementation --via "LIN-4459 session" --as-of $T1
L add run '{"in":"task-6","stage":"implementation","claims":["lib/dispatch/live-wait/","lib/llm/registry"]}' --by implementation --via "LIN-4459 session" --at $T1   # run-10
L add change '{"in":"task-6","ref":"PR #2432","head":"a1b2c3d"}' --by implementation --via "LIN-4459 session" --at $T1   # change-11
L add question '{"in":"task-6","to":"task-4","asks":"Do you agree the live-wait move (PR #2432)?","options":["agree","object"],"recommended":"agree","if-unanswered":"LIN-4459 proceeds with the move","links":{"on":"change-11@1","about":"area-2"}}' --by implementation --via "LIN-4459 session" --at $T1   # question-12
L end run-7 done "asked LIN-4448 lane (question-9); boundary kept as drawn unless told otherwise" --by implementation --via "LIN-4458 build" --at ${D}T16:50:00Z

# ---------------------------------------------------------------- 17:00
wake() {
  echo "### 3. LIN-4448 autopilot wakes ($1): brief"
  L brief autopilot --task task-4 --as-of $1 --text
  L find --to task-4 --state open --by autopilot --via "LIN-4448 autopilot" --as-of $1
}
wake ${D}T17:00:00Z

# ---------------------------------------------------------------- 17:06
T4=${D}T17:06:00Z
echo "### 4. LIN-4459 session ($T4): brief"
L brief implementation --task task-6 --as-of $T4 --text
echo "### 4. lookup: any answer to question-12?"
L get question-12 --by implementation --via "LIN-4459 session" --as-of $T4
L revise change-11 '{"head":"e4f5a6b"}' --reason "import change in lib/llm/ and one retired LLM entry" --by implementation --via "LIN-4459 session" --at $T4
L add question '{"in":"task-6","to":"task-4","asks":"PR #2432 now also changes an import in lib/llm/ and retires one LLM entry. Unless you say otherwise, proceeding to merge.","if-unanswered":"LIN-4459 merges PR #2432","links":{"on":"change-11@2","about":"area-2"}}' --by implementation --via "LIN-4459 session" --at $T4   # question-13
L end change-11 merged "merged on silence: question-12 and question-13 unanswered" --by implementation --via "LIN-4459 session" --at $T4
L end run-10 done "PR #2432 merged" --by implementation --via "LIN-4459 session" --at $T4

# ---------------------------------------------------------------- 20:00, 23:00
wake ${D}T20:00:00Z
wake ${D}T23:00:00Z

echo "### AFTER: what the record says (23:30)"
L find --to task-4 --by John --as-of ${D}T23:30:00Z
L show --task task-6 --by John --as-of ${D}T23:30:00Z
