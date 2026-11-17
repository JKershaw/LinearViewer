#!/usr/bin/env bash
# S1. Lanes ask each other, and go ahead on silence. Recreates store.json from empty.
cd "$(dirname "$0")"
rm -f store.json
L() { echo; echo "\$ layer $*"; node ../../model/layer.mjs "$@" --store store.json || echo "(exit $?)"; }
D=2026-11-13

# --- Seed (Harbour; tasks by John; children by breakdown) ---
L add area '{"name":"Runs & dispatch","paths":["lib/runs/"]}' --by Harbour --at ${D}T09:00Z            # area-1
L add area '{"name":"LLM & prompts","paths":["lib/llm/"]}' --by Harbour --at ${D}T09:00Z              # area-2
L add task '{"asked":"LIN-4447 Runs & dispatch lane","paths":["lib/runs/"]}' --by John --at ${D}T09:01Z  # task-3
L add task '{"in":"task-3","asked":"","done-when":"LIN-4458: the run census is built","paths":["lib/runs/census/"]}' --by breakdown --at ${D}T09:02Z  # task-4
L add task '{"in":"task-3","asked":"","done-when":"LIN-4459: the live-wait move lands","paths":["lib/runs/live-wait/"]}' --by breakdown --at ${D}T09:02Z  # task-5
L add task '{"asked":"LIN-4448 LLM & prompts lane","paths":["lib/llm/"]}' --by John --at ${D}T09:03Z   # task-6

# --- 1. LIN-4458 build session (16:42) = implementation on task-4 ---
L brief implementation --task task-4 --as-of ${D}T16:42Z --text
L add run '{"in":"task-4","stage":"implementation","claims":["lib/runs/census/"],"account":"Drew the census boundary; asked the LLM lane whether it is drawn right."}' --by implementation --at ${D}T16:42Z   # run-7
# what it really is: a question to the other lane, with a default if unanswered
L add question '{"in":"task-4","to":"task-6","asks":"Is the census boundary drawn right?","options":["as drawn","drawn differently"],"recommended":"as drawn","if-unanswered":"keep the boundary as drawn"}' --by implementation --at ${D}T16:42Z
# refused (rule 5); nearest it may write: a finding to the other lane's task
L add finding '{"in":"task-4","to":"task-6","says":"From LIN-4458: is the census boundary drawn right? Tell me on LIN-4458 if you want it drawn differently; if no answer, I keep it as drawn."}' --by implementation --at ${D}T16:42Z   # finding-8
L add decision '{"in":"task-4","answer":"Census boundary as drawn","why":"Drawn by the build; asked the LLM lane in finding-8; kept unless it says otherwise.","links":{"about":"finding-8"}}' --by implementation --at ${D}T16:42Z   # decision-9

# --- 2. LIN-4459 session (16:42) = implementation on task-5 ---
L brief implementation --task task-5 --as-of ${D}T16:42Z --text
L add run '{"in":"task-5","stage":"implementation","claims":["lib/runs/live-wait/"],"account":"Live-wait move in PR #2432; asked the LLM lane to agree it."}' --by implementation --at ${D}T16:42Z   # run-10
L add change '{"in":"task-5","ref":"PR #2432","head":"a1"}' --by implementation --at ${D}T16:42Z     # change-11
L add question '{"in":"task-5","to":"task-6","asks":"Do you agree the live-wait move (PR #2432)?","options":["agree","object"]}' --by implementation --at ${D}T16:42Z
# refused (rule 5); finding instead
L add finding '{"in":"task-5","to":"task-6","says":"From LIN-4459: please agree the live-wait move (PR #2432).","links":{"about":"change-11"}}' --by implementation --at ${D}T16:42Z   # finding-12

# --- 3. LIN-4448 autopilot wakes (17:00, 20:00, 23:00) ---
L add run '{"in":"task-6","stage":"autopilot","account":"woke"}' --by autopilot --at ${D}T17:00Z
L find --to task-6 --by autopilot
# refused; nearest declared stage for a parent lane: breakdown
L brief breakdown --task task-6 --as-of ${D}T17:00Z --text
L add run '{"in":"task-6","stage":"breakdown","account":"Autopilot wake 17:00. Two findings addressed to the lane (finding-8, finding-12), both from the Runs lane. Read; not answered this wake."}' --by breakdown --at ${D}T17:00Z   # run-13
L end run-13 done "wake over" --by breakdown --task task-6 --at ${D}T17:01Z

# --- 4. LIN-4459 session (17:06): proceeds to merge on silence ---
L brief implementation --task task-5 --as-of ${D}T17:06Z --text
L get finding-12 --by implementation
L add decision '{"in":"task-5","answer":"Proceed to merge PR #2432","why":"Unless you say otherwise ... proceeding to merge. No reply to finding-12.","links":{"about":"finding-12"}}' --by implementation --at ${D}T17:06Z   # decision-14
L end change-11 merged "PR #2432 merged" --by implementation --task task-5 --at ${D}T17:06Z
L end run-10 done "merged" --by implementation --task task-5 --at ${D}T17:07Z

L brief breakdown --task task-6 --as-of ${D}T20:00Z --text
L add run '{"in":"task-6","stage":"breakdown","account":"Autopilot wake 20:00. Same two findings to the lane, still open. Not answered."}' --by breakdown --at ${D}T20:00Z   # run-15
L end run-15 done "wake over" --by breakdown --task task-6 --at ${D}T20:01Z
L brief breakdown --task task-6 --as-of ${D}T23:00Z --text
L add run '{"in":"task-6","stage":"breakdown","account":"Autopilot wake 23:00. Same two findings to the lane, still open. Not answered."}' --by breakdown --at ${D}T23:00Z   # run-16
L end run-16 done "wake over" --by breakdown --task task-6 --at ${D}T23:01Z

# --- The question: where did each ask go, who saw it, what does silence mean? ---
L find --to task-6 --by John
L show --task task-3 --by John
L show --task task-5 --by John
L brief breakdown --task task-3 --text
L check
