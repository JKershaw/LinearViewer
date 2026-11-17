#!/usr/bin/env bash
# S4: two overlapping sessions claim the same item (Lighthouse). Recreates store.json from empty.
# Actors (model/actors.json): session-a, session-b, Lighthouse (system actor).
set -u
cd "$(dirname "$0")"
rm -f store.json
rm -rf out && mkdir -p out
L() { node model/layer.mjs "$@"; }
D=2026-11-14

# --- Seed (by the scene's system actor, Lighthouse) ---------------------------------
L add task '{"asked":"Do the weekly read for Lighthouse.","done-when":"This week'"'"'s read is done and its study is written."}' --by Lighthouse --at ${D}T08:00:00Z >/dev/null   # task-1
L add area '{"name":"studies","paths":["studies/"]}' --by Lighthouse --at ${D}T08:00:00Z >/dev/null                                                                                # area-2
L add task '{"in":"task-1","asked":"Write the next study.","done-when":"The next study is written under studies/.","paths":["studies/"]}' --by Lighthouse --at ${D}T08:00:00Z >/dev/null   # task-3 (the due item)

# --- 1. Session A, 09:00: starts the weekly read; it will write the next study ------
L brief session-a --task task-1 --as-of ${D}T09:00:00Z --text > out/1-a-brief-task-1.txt
L brief session-a --task task-3 --as-of ${D}T09:00:00Z --text > out/1-a-brief-task-3.txt   # task-3 was task-1's only index entry
# Its index is empty; no runs. A allocates the next number from the files on disk (latest LH050),
# not from the store (the store holds no studies), and claims that file.
L add run '{"in":"task-3","stage":"weekly-read","claims":["studies/LH051.md"],"account":"session-a"}' --by session-a --at ${D}T09:01:00Z > out/1-a-run.json   # run-4

# --- 2. Session B, 09:05 (overlapping): starts the weekly read too -------------------
L brief session-b --task task-1 --as-of ${D}T09:05:00Z --text > out/2-b-brief-task-1.txt
L brief session-b --task task-3 --as-of ${D}T09:05:00Z --text > out/2-b-brief-task-3.txt
# Part 6 is "(none)": it lists runs of OTHER tasks only. Part 7 lists a bare "run-4 run - weekly-read"
# (no owner, state or claim). B did not write it, so B follows the pointer.
L get run-4 --by session-b --as-of ${D}T09:05:00Z > out/2-b-get-run-4.json
# B learns session-a holds an open run on this same item, claiming studies/LH051.md. Disk still shows
# LH050 as latest (A has not written yet), so the next free number by disk would also be LH051.
# B takes LH052 instead, and tells A (it can't decline the scene's line: it writes a study).
L add run '{"in":"task-3","stage":"weekly-read","claims":["studies/LH052.md"],"account":"session-b"}' --by session-b --at ${D}T09:06:00Z > out/2-b-run.json   # run-5
L add finding '{"in":"task-3","to":"session-a","says":"Two sessions are on task-3 at once: run-4 (you) claims studies/LH051.md, so I (run-5) took studies/LH052.md. One weekly study is due; if you finish LH051 first, I will still write mine as asked but you may want to mark one redundant.","links":{"about":"run-4"}}' --by session-b --at ${D}T09:06:00Z > out/2-b-finding.json   # finding-6
L link finding-6 on run-4@1 --by session-b --at ${D}T09:06:00Z > /dev/null

# --- 3. Both record the study they write --------------------------------------------
# A, 09:40
L brief session-a --task task-3 --as-of ${D}T09:40:00Z --text > out/3-a-brief-task-3.txt
L add change '{"in":"task-3","ref":"studies/LH051.md","head":"LH051 written by session-a"}' --by session-a --at ${D}T09:40:00Z > out/3-a-change.json   # change-7
L link change-7 about run-4 --by session-a --at ${D}T09:40:00Z > /dev/null
L end change-7 merged "study written to studies/LH051.md" --by session-a --at ${D}T09:41:00Z > /dev/null
L end finding-6 done "read; LH051 written, LH052 is B's" --by session-a --at ${D}T09:41:00Z > /dev/null
L end run-4 done "study LH051 written" --by session-a --at ${D}T09:41:00Z > /dev/null
L end task-3 done "LH051 written (change-7); run-5 still writing LH052" --by session-a --at ${D}T09:41:00Z > /dev/null

# B, 09:45
L brief session-b --task task-3 --as-of ${D}T09:45:00Z --text > out/3-b-brief-task-3.txt
L add change '{"in":"task-3","ref":"studies/LH052.md","head":"LH052 written by session-b"}' --by session-b --at ${D}T09:45:00Z > out/3-b-change.json   # change-8
L link change-8 about run-5 --by session-b --at ${D}T09:45:00Z > /dev/null
L end change-8 merged "study written to studies/LH052.md" --by session-b --at ${D}T09:46:00Z > /dev/null
L end run-5 done "study LH052 written" --by session-b --at ${D}T09:46:00Z > /dev/null
L end task-3 done "LH052 written (change-8)" --by session-b --at ${D}T09:46:00Z > out/3-b-end-task.json

# --- Probes (not actors): what the record shows afterwards ------------------------------
L show --task task-3 --by Lighthouse --as-of ${D}T09:30:00Z > out/9-show-0930.json
L show --task task-3 --by Lighthouse > out/9-show-end.json
L find --in task-3 --kind change --by Lighthouse > out/9-find-changes.json
L get task-3 --by Lighthouse > out/9-task-3.json
echo done
