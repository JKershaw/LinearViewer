#!/usr/bin/env bash
# S2. A withdrawn ruling leaves a false line. Recreates store.json from empty.
cd "$(dirname "$0")"
rm -f store.json
L() { echo; echo "\$ layer $*"; node ../../model/layer.mjs "$@" --store store.json || echo "(exit $?)"; }
D=2026-11-13

# --- Seed (Harbour; tasks by John; children by breakdown) ---
L add task '{"asked":"LIN-4448 LLM & prompts lane","paths":["lib/llm/"]}' --by John --at ${D}T09:00Z   # task-1
L add task '{"in":"task-1","asked":"","done-when":"LIN-4469: change merged with its witness","paths":["lib/llm/witness/"]}' --by breakdown --at ${D}T09:01Z   # task-2
L add change '{"in":"task-2","ref":"LIN-4469 PR","head":"h1"}' --by Harbour --at ${D}T09:02Z         # change-3

# --- 1. LIN-4469 autopilot (22:50): raises a question to John ---
L add question '{"in":"task-2","to":"John","asks":"May the LIN-4469 merge go ahead without the witness?","options":["yes, merge without it","no, wait for the witness"],"recommended":"no, wait for the witness","if-unanswered":"merge waits","links":{"about":"change-3"}}' --by autopilot --at ${D}T22:50Z
L show --task task-2 --by autopilot
# refused; nearest: Harbour (the system the autopilot is part of), relayed via autopilot
L show --task task-2 --as-of ${D}T22:50Z --by Harbour
L add question '{"in":"task-2","to":"John","asks":"May the LIN-4469 merge go ahead without the witness?","options":["yes, merge without it","no, wait for the witness"],"recommended":"no, wait for the witness","if-unanswered":"merge waits","links":{"about":"change-3"}}' --by Harbour --via autopilot --at ${D}T22:50Z   # question-4

# --- 2. LIN-4469 builder (23:11) = implementation on task-2: records that merge waits on question-4 ---
L brief implementation --task task-2 --as-of ${D}T23:11Z --text
L get question-4 --by implementation
L add decision '{"in":"task-2","answer":"Merge of change-3 waits on question-4 (the witness ruling)","why":"question-4 to John asks whether the merge may go ahead without the witness; until it is answered, merge is gated.","links":{"on":"question-4","about":"change-3"}}' --by implementation --at ${D}T23:11Z   # decision-5

# --- 3. LIN-4469 autopilot (23:40): withdraws question-4 ---
L end question-4 withdrawn "no longer needed" --by autopilot --at ${D}T23:40Z
# refused; nearest: Harbour via autopilot (a person may end any record)
L show --task task-2 --as-of ${D}T23:40Z --by Harbour
L end question-4 withdrawn "no longer needed" --by Harbour --via autopilot --at ${D}T23:40Z

# --- 4. A reader of LIN-4448, next morning (09:00): what is LIN-4469 waiting on? ---
L show --task task-1 --as-of 2026-11-14T09:00Z --by reader
# refused; nearest: John
L show --task task-1 --as-of 2026-11-14T09:00Z --by John
L show --task task-2 --as-of 2026-11-14T09:00Z --by John
L find --text gate --by John
L brief close-out --task task-2 --as-of 2026-11-14T09:00Z --text

# --- The question: does anything still say merge is gated? ---
L check
