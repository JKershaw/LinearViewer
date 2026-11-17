#!/usr/bin/env bash
# S4. Two overlapping sessions claim the same item. Recreates store.json from empty and plays each actor in order.
cd "$(dirname "$0")"
rm -f store.json
L() { node ../../model/layer.mjs "$@" --store store.json; }   # --store last: brief reads --text as a flag only when "brief" is argv[0]
ids() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log("returned",a.length+":",a.map(r=>r.id+"["+r.state+"]"+(r.fields.claims?" claims "+r.fields.claims:"")).join(" "))})'; }
q() { echo; echo "\$ $*"; }
D=2026-11-13

# ---- Seed (08:00): area-1 studies (Harbour), task-2 the weekly read (John), finding-3 the due item (Harbour, to task-2)
q seed
L add area '{"name":"studies","paths":["studies/"]}' --by Harbour --at ${D}T08:00:00Z >/dev/null
L add task '{"in":"area-1","asked":"The weekly read.","paths":["studies/"]}' --by John --at ${D}T08:00:00Z >/dev/null
L add finding '{"in":"task-2","to":"task-2","says":"Due: write the next study."}' --by Harbour --at ${D}T08:00:00Z >/dev/null
echo seeded

# ---- 1. Session A (09:00): starts the weekly read; will write the next study
q "1. Session A 09:00: write as itself"
L add run '{"in":"task-2","stage":"weekly-read","claims":["studies/"],"account":"Session A: weekly read."}' --by "Session A" --at ${D}T09:00:00Z
echo "exit $?"
q "1. Session A acts as implementation"
L brief implementation --task task-2 --as-of ${D}T09:00:00Z --text
L find --path studies/ --by implementation | ids      # what studies exist? (the record holds none; disk shows LH050 last)
L add run '{"in":"task-2","stage":"implementation","claims":["studies/LH051.md"],"account":"Session A: weekly read; writing the next study, LH051."}' --by implementation --at ${D}T09:00:00Z >/dev/null  # run-4

# ---- 2. Session B (09:05, overlapping): starts the weekly read too; will write the next study
q "2. Session B 09:05: write as itself"
L add run '{"in":"task-2","stage":"weekly-read","claims":["studies/"],"account":"Session B: weekly read."}' --by "Session B" --at ${D}T09:05:00Z
echo "exit $?"
q "2. Session B acts as implementation"
L brief implementation --task task-2 --as-of ${D}T09:05:00Z --text
L find --path studies/ --by implementation | ids      # what studies exist? -> run-4 claims studies/LH051.md
L get run-4 --by implementation | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.id,r.state,r.at,JSON.stringify(r.fields))})'
L add run '{"in":"task-2","stage":"implementation","claims":["studies/LH052.md"],"account":"Session B: weekly read; run-4 already claims LH051, so writing the next study as LH052."}' --by implementation --at ${D}T09:05:00Z >/dev/null  # run-5
L add finding '{"in":"task-2","to":"John","says":"Two sessions are on the weekly read: run-4 (since 09:00) claims the due study as LH051; run-5 writes LH052. One study may be redundant."}' --by implementation --at ${D}T09:05:00Z >/dev/null  # finding-6

# ---- 3. Both record the study they write
q "3a. Session A 09:30 records its study (no fresh brief mid-session)"
L add change '{"in":"task-2","ref":"studies/LH051.md","head":"a051"}' --by implementation --at ${D}T09:30:00Z >/dev/null  # change-7
L end finding-3 done "written as LH051 (change-7)" --by implementation --task task-2 --at ${D}T09:30:00Z >/dev/null
L end run-4 done "LH051 written (change-7)" --by implementation --task task-2 --at ${D}T09:30:00Z >/dev/null
echo ok
q "3b. Session B 09:35 records its study"
L add change '{"in":"task-2","ref":"studies/LH052.md","head":"b052"}' --by implementation --at ${D}T09:35:00Z >/dev/null  # change-8
L end finding-3 done "written as LH052 (change-8)" --by implementation --task task-2 --at ${D}T09:35:00Z
echo "exit $?"
L end run-5 done "LH052 written (change-8); finding-3 was already ended by another run" --by implementation --task task-2 --at ${D}T09:35:00Z >/dev/null

# ---- The question, from the record
q "end: check"
L check
q "end: show task-2"
L show --task task-2 --by John | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.task.id,o.task.state);for(const r of o.records)console.log(" ",r.id,r.kind,r.state,"by",r.by,r.to?"to "+r.to:"",JSON.stringify(r.fields))})'
q "end: what reaches John"
L find --to John --state open --by John | ids
q "end: a fresh brief on the weekly read (next session, 14 Nov 09:00)"
L brief implementation --task task-2 --as-of 2026-11-14T09:00:00Z --text
