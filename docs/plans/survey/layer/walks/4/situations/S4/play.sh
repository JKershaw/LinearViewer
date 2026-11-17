#!/usr/bin/env bash
# S4: two overlapping sessions claim the same item (Lighthouse). Recreates store.json from empty.
set -u
cd "$(dirname "$0")"
rm -f store.json
mkdir -p out
L() { node model/layer.mjs "$@"; }
D=2026-11-14

# --- Seed (by the scene's system actor, Lighthouse) ---------------------------------
L add task '{"asked":"Do the weekly read for Lighthouse.","done-when":"This week'"'"'s read is done and its study is written."}' --by Lighthouse --at ${D}T08:00:00Z >/dev/null   # task-1
L add area '{"name":"studies","paths":["studies/"]}' --by Lighthouse --at ${D}T08:00:00Z >/dev/null                                                                                # area-2
L add task '{"in":"task-1","asked":"Write the next study.","done-when":"The next study is written under studies/.","paths":["studies/"]}' --by Lighthouse --at ${D}T08:00:00Z >/dev/null   # task-3 (the due item)

# --- 1. Session A, 09:00: starts the weekly read; it will write the next study ------
L brief session-a --task task-1 --as-of ${D}T09:00:00Z --text > out/1-a-brief-task-1.txt
L brief session-a --task task-3 --as-of ${D}T09:00:00Z --text > out/1-a-brief-task-3.txt   # task-3 was in task-1's index
# A allocates the next study number from the files on disk (latest is LH050), not from the store.
L add run '{"in":"task-3","stage":"weekly-read","claims":["studies/LH051.md"],"account":"session-a"}' --by session-a --at ${D}T09:01:00Z > out/1-a-run.json   # run-4

# --- 2. Session B, 09:05 (overlapping): starts the weekly read too -------------------
L brief session-b --task task-1 --as-of ${D}T09:05:00Z --text > out/2-b-brief-task-1.txt
L brief session-b --task task-3 --as-of ${D}T09:05:00Z --text > out/2-b-brief-task-3.txt
# B sees "run-4 run - weekly-read" in its index: no owner, state or claim shown, and the same stage
# label B is about to write. Nothing in its brief or line says it is someone else's live run; it does
# not look it up. A's run is in the same task, so part 6 ("runs of other tasks") never shows it.
# B also reads disk while A has not yet written: latest is still LH050, so B allocates LH051.
L add run '{"in":"task-3","stage":"weekly-read","claims":["studies/LH051.md"],"account":"session-b"}' --by session-b --at ${D}T09:06:00Z > out/2-b-run.json   # run-5

# --- 3. Both record the study they write --------------------------------------------
# A, 09:40
L brief session-a --task task-3 --as-of ${D}T09:40:00Z --text > out/3-a-brief-task-3.txt
L add change '{"in":"task-3","ref":"studies/LH051.md","head":"LH051 by session-a (09:40)"}' --by session-a --at ${D}T09:40:00Z > out/3-a-change.json   # change-6
L end change-6 merged "study written to studies/LH051.md" --by session-a --at ${D}T09:41:00Z > /dev/null
L end task-3 done "LH051 written" --by session-a --at ${D}T09:41:00Z > /dev/null
L end run-4 done "study written" --by session-a --at ${D}T09:41:00Z > /dev/null

# B, 09:45
L brief session-b --task task-3 --as-of ${D}T09:45:00Z --text > out/3-b-brief-task-3.txt
L add change '{"in":"task-3","ref":"studies/LH051.md","head":"LH051 by session-b (09:45)"}' --by session-b --at ${D}T09:45:00Z > out/3-b-change.json   # change-7
L end change-7 merged "study written to studies/LH051.md" --by session-b --at ${D}T09:46:00Z > out/3-b-end-change.json
L end task-3 done "LH051 written" --by session-b --at ${D}T09:46:00Z > out/3-b-end-task.json
L end run-5 done "study written" --by session-b --at ${D}T09:46:00Z > /dev/null

# --- After: what the record shows -----------------------------------------------------
L show --task task-3 --by session-b --as-of ${D}T09:30:00Z > out/9-show-0930.json
L find --kind change --text LH051 --by session-b > out/9-find-lh051.json
echo done
