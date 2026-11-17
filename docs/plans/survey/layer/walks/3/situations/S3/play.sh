#!/usr/bin/env bash
# S3. A count copied five ways. Recreates store.json from empty and plays each actor in order.
cd "$(dirname "$0")"
rm -f store.json
L() { node ../../model/layer.mjs "$@" --store store.json; }   # --store last: brief reads --text as a flag only when "brief" is argv[0]
# Summarise a find: count, then ids (with state when it isn't open).
n() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log("returned",a.length+":",a.map(r=>r.state==="open"?r.id:r.id+"["+r.state+" "+r.at.slice(11,16)+"]").join(" "))})'; }
q() { echo; echo "\$ $*"; }
D=2026-11-13

# ---- Seed (Harbour, 09:00): area-1 "Waiting" and 26 open findings to it (finding-2..finding-27)
q seed
L add area '{"name":"Waiting","paths":["lib/waiting/"]}' --by Harbour --at ${D}T09:00:00Z >/dev/null
for i in $(seq 1 26); do
  L add finding "{\"in\":\"area-1\",\"to\":\"area-1\",\"says\":\"Waiting item $i is stale in the Waiting view\"}" --by Harbour --at ${D}T09:00:00Z >/dev/null
done
L find --kind finding --to area-1 --by Harbour | n

# ---- 1. The ask's writer (John, 10:00): needs the count to state the scope
q "1. John 10:00"
L find --kind finding --to area-1 --state open --by John | n
L add task '{"in":"area-1","asked":"Clear the Waiting backlog: the 26 open findings addressed to Waiting (area-1).","done-when":"No open finding is addressed to area-1.","paths":["lib/waiting/"]}' --by John --at ${D}T10:00:00Z   # task-28

# ---- (setup the scene needs) breakdown (11:00): three child builds by sub-path
q "breakdown 11:00"
L brief breakdown --task task-28 --as-of ${D}T11:00:00Z --text
L add plan '{"in":"task-28","says":"Three child builds by sub-path: queue, render, notify; each ends the area-1 findings its change settles.","paths":["lib/waiting/"],"order":1}' --by breakdown --at ${D}T11:00:00Z >/dev/null  # plan-29
L link task-28 piece plan-29 --by breakdown --at ${D}T11:00:00Z >/dev/null
for p in queue render notify; do
  L add task "{\"in\":\"task-28\",\"done-when\":\"The area-1 findings under lib/waiting/$p/ are settled.\",\"paths\":[\"lib/waiting/$p/\"]}" --by breakdown --at ${D}T11:00:00Z >/dev/null
done  # task-30 queue, task-31 render, task-32 notify
L add run '{"in":"task-28","stage":"breakdown","claims":["lib/waiting/"],"account":"Split into task-30/31/32 by sub-path."}' --by breakdown --at ${D}T11:00:00Z >/dev/null  # run-33
L end run-33 done "session ended" --by breakdown --task task-28 --at ${D}T11:00:00Z >/dev/null

# ---- 2. Child build (implementation on task-30, 12:00): ends 1 finding
q "2. build task-30 12:00"
L brief implementation --task task-30 --as-of ${D}T12:00:00Z --text
L find --kind finding --to area-1 --state open --by implementation | n
L find --kind finding --to area-1 --path lib/waiting/queue/ --by implementation | n   # findings carry no paths
L add change '{"in":"task-30","ref":"PR #101","head":"a101"}' --by implementation --at ${D}T12:00:00Z >/dev/null  # change-34
L end finding-2 done "settled by change-34 (PR #101)" --by implementation --task task-30 --at ${D}T12:00:00Z >/dev/null
L add run '{"in":"task-30","stage":"implementation","claims":["lib/waiting/queue/"],"account":"PR #101 fixes Waiting item 1; ended finding-2."}' --by implementation --at ${D}T12:00:00Z >/dev/null  # run-35
L end run-35 done "session ended" --by implementation --task task-30 --at ${D}T12:00:00Z >/dev/null

# ---- 3. Plan reviewer (plan-review on task-28, 13:00): needs the number
q "3. plan-review task-28 13:00"
L brief plan-review --task task-28 --as-of ${D}T13:00:00Z --text
L find --kind finding --to area-1 --state open --by plan-review | n
L find --kind finding --to area-1 --by plan-review | n
L add verdict '{"in":"task-28","of":"plan-review","outcome":"approve-with-notes","reasoning":"The three slices cover area-1. Scope now: 25 open findings to area-1 (find, 13:00). The ask says 26: right at 10:00; finding-2 ended at 12:00.","links":{"on":"plan-29"}}' --by plan-review --at ${D}T13:00:00Z >/dev/null  # verdict-36
L add run '{"in":"task-28","stage":"plan-review","account":"Approved plan-29 with notes (verdict-36)."}' --by plan-review --at ${D}T13:00:00Z >/dev/null  # run-37
L end run-37 done "session ended" --by plan-review --task task-28 --at ${D}T13:00:00Z >/dev/null

# ---- 4. Two more builds (15:00 ends 2, 16:00 ends 1)
q "4a. build task-31 15:00"
L brief implementation --task task-31 --as-of ${D}T15:00:00Z --text | tail -4
L find --kind finding --to area-1 --state open --by implementation | n
L add change '{"in":"task-31","ref":"PR #102","head":"b102"}' --by implementation --at ${D}T15:00:00Z >/dev/null  # change-38
L end finding-3 done "settled by change-38 (PR #102)" --by implementation --task task-31 --at ${D}T15:00:00Z >/dev/null
L end finding-4 done "settled by change-38 (PR #102)" --by implementation --task task-31 --at ${D}T15:00:00Z >/dev/null
L add run '{"in":"task-31","stage":"implementation","claims":["lib/waiting/render/"],"account":"PR #102 fixes Waiting items 2-3; ended finding-3, finding-4."}' --by implementation --at ${D}T15:00:00Z >/dev/null  # run-39
L end run-39 done "session ended" --by implementation --task task-31 --at ${D}T15:00:00Z >/dev/null
q "4b. build task-32 16:00"
L brief implementation --task task-32 --as-of ${D}T16:00:00Z --text | tail -4
L find --kind finding --to area-1 --state open --by implementation | n
L add change '{"in":"task-32","ref":"PR #103","head":"c103"}' --by implementation --at ${D}T16:00:00Z >/dev/null  # change-40
L end finding-5 done "settled by change-40 (PR #103)" --by implementation --task task-32 --at ${D}T16:00:00Z >/dev/null
L add run '{"in":"task-32","stage":"implementation","claims":["lib/waiting/notify/"],"account":"PR #103 fixes Waiting item 4; ended finding-5."}' --by implementation --at ${D}T16:00:00Z >/dev/null  # run-41
L end run-41 done "session ended" --by implementation --task task-32 --at ${D}T16:00:00Z >/dev/null

# ---- 5. Reviewer (review on task-32, 17:00): compares the ask's number with today's
q "5. review task-32 17:00"
L brief review --task task-32 --as-of ${D}T17:00:00Z --text
L find --kind finding --to area-1 --state open --by review | n
q "reviewer asks for the count as of the ask (find has no as-of; flag accepted)"
L find --kind finding --to area-1 --state open --as-of ${D}T10:00:00Z --by review | n
L find --kind finding --to area-1 --by review | n
L get finding-2 --as-of ${D}T10:00:00Z --by review | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log(r.id,"as of 10:00:",r.state)})'
L add verdict '{"in":"task-32","of":"review","outcome":"approve","reasoning":"PR #103 settles Waiting item 4 (finding-5). On scope: 22 findings to area-1 are open now; the ask'"'"'s 26 was right at 10:00, since 4 ended after it (finding-2 12:00, finding-3 and finding-4 15:00, finding-5 16:00).","links":{"on":"change-40"}}' --by review --at ${D}T17:00:00Z >/dev/null  # verdict-42
L add run '{"in":"task-32","stage":"review","account":"Approved change-40 (verdict-42)."}' --by review --at ${D}T17:00:00Z >/dev/null  # run-43
L end run-43 done "session ended" --by review --task task-32 --at ${D}T17:00:00Z >/dev/null

# ---- The question, from the record
q "end: check"
L check
q "end: every typed count"
L find --text 26 --by John | n
L find --text 25 --by John | n
L find --text 22 --by John | n
q "end: show task-28"
L show --task task-28 --by John | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.task.id,o.task.state,o.task.fields.asked);for(const r of o.records)console.log(" ",r.id,r.kind,r.state,r.stale?"STALE":"",JSON.stringify(r.fields).slice(0,110))})'
