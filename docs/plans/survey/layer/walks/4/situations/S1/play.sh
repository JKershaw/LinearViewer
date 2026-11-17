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
