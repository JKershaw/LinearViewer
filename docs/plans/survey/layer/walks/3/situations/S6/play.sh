#!/usr/bin/env bash
# S6. A task with neither git nor a tracker. Recreates store.json from empty.
set -u
cd "$(dirname "$0")"
rm -f store.json
L() { node ../../model/layer.mjs "$@" --store store.json; }
# W: a write, printed compactly (id, version, state); a refusal prints in full.
W() { local o; o=$(L "$@"); local rc=$?; if [ $rc -eq 0 ]; then printf '%s' "$o" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s),v=r.versions.at(-1);console.log(`ok ${r.id} v${v.v} ${v.op} [${v.state}]`+(v.links&&Object.keys(v.links).length?" links "+JSON.stringify(v.links):""))})'; else echo "$o"; echo "exit $rc"; fi; }
say() { printf '\n### %s\n' "$*"; }

say 'Seed: area and lesson by Harbour, task by John (local workspace, no repository)'
W add area '{"name":"newsletter","paths":["newsletter/"]}' --by Harbour --at 2026-11-13T10:00:00Z
W add lesson '{"in":"area-1","says":"members read on phones; keep it under 400 words","paths":["newsletter/"],"checked-at":"2026-11-13"}' --by Harbour --at 2026-11-13T10:00:00Z
W add task '{"asked":"Write the March newsletter: the AGM date, the new treasurer, and the spring fixtures","done-when":"the March newsletter has gone to members","paths":["newsletter/2027-03.md"]}' --by John --at 2026-11-13T10:00:00Z

# ---------- survey-task, 10:30 ----------
say 'survey-task: its brief'
L brief survey-task --task task-3 --as-of 2026-11-13T10:30:00Z --text
W add run '{"in":"task-3","stage":"survey-task","claims":["newsletter/2027-03.md"],"account":"Surveyed the ask. Three facts are named but none of their values is in the record; asked John to confirm them and told implementation to draft with marked placeholders."}' --by survey-task --at 2026-11-13T10:30:00Z
W add finding '{"in":"task-3","to":"implementation","says":"The ask names three facts (AGM date, new treasurer, spring fixtures) but no value for any is in the record: draft with marked placeholders. lesson-2: phone readers, under 400 words."}' --by survey-task --at 2026-11-13T10:35:00Z
W add check '{"in":"task-3","to":"John","what":"The AGM date, the new treasurer'\''s name, and the spring fixture list","why-person":"Only the club'\''s own records hold them; nothing in the workspace does","how":"Reply with the three facts, or confirm the ones in the draft"}' --by survey-task --at 2026-11-13T10:36:00Z
W end run-4 done 'survey written: finding-5, check-6' --by survey-task --task task-3 --at 2026-11-13T10:40:00Z

# ---------- implementation, 11:00 ----------
say 'implementation: its brief'
L brief implementation --task task-3 --as-of 2026-11-13T11:00:00Z --text
W add run '{"in":"task-3","stage":"implementation","claims":["newsletter/2027-03.md"],"account":"Drafted newsletter/2027-03.md, saved as local file version 1 (318 words, three short sections: AGM, treasurer, spring fixtures). AGM date, treasurer name and fixture dates are [placeholders] pending check-6."}' --by implementation --at 2026-11-13T11:00:00Z
say 'implementation: record the file version as it really is (a file and its version)'
W add change '{"in":"task-3","file":"newsletter/2027-03.md","version":"1"}' --by implementation --at 2026-11-13T11:20:00Z
say 'implementation: nearest declared form (change: ref = the file, head = its version)'
W add change '{"in":"task-3","ref":"newsletter/2027-03.md","head":"local file version 1 (saved 2026-11-13 11:20, 318 words)"}' --by implementation --at 2026-11-13T11:20:00Z
W end finding-5 done 'drafted with the three facts as marked placeholders; under 400 words' --by implementation --task task-3 --at 2026-11-13T11:25:00Z
W end run-7 done 'draft saved: change-8' --by implementation --task task-3 --at 2026-11-13T11:30:00Z

# ---------- review, 12:00 ----------
say 'review: its brief'
L brief review --task task-3 --as-of 2026-11-13T12:00:00Z --text
say 'review: looks up the change and the open check'
L get change-8 --by review
L get check-6 --by review
W add run '{"in":"task-3","stage":"review","claims":["newsletter/2027-03.md"],"account":"Reviewed file version 1 of newsletter/2027-03.md: approve-with-notes (verdict-10)."}' --by review --at 2026-11-13T12:00:00Z
W add verdict '{"in":"task-3","of":"review","outcome":"approve-with-notes","reasoning":"318 words, under lesson-2'\''s 400; one screen per section on a phone; covers the three items asked. Note: the AGM date, treasurer name and fixture dates are placeholders until check-6 is answered.","links":{"on":"change-8"}}' --by review --at 2026-11-13T12:10:00Z
W end run-9 done 'verdict-10' --by review --task task-3 --at 2026-11-13T12:15:00Z

# ---------- close-out, 13:00 ----------
say 'close-out: its brief'
L brief close-out --task task-3 --as-of 2026-11-13T13:00:00Z --text
W add run '{"in":"task-3","stage":"close-out","claims":["newsletter/2027-03.md"],"account":"Sent file version 1 of newsletter/2027-03.md to the members list from the local workspace. check-6 (the facts) was still open to John."}' --by close-out --at 2026-11-13T13:00:00Z
say 'close-out: record the send as it really is'
W end change-8 sent 'emailed to the members list from the local workspace' --by close-out --task task-3 --at 2026-11-13T13:05:00Z
say 'close-out: nearest declared end (merged)'
W end change-8 merged 'sent: file version 1 emailed to the members list from the local workspace' --by close-out --task task-3 --at 2026-11-13T13:05:00Z
W end run-11 done 'sent change-8 v1' --by close-out --task task-3 --at 2026-11-13T13:10:00Z
W end task-3 done 'March newsletter sent to members' --by close-out --task task-3 --at 2026-11-13T13:10:00Z

# ---------- The question ----------
say 'Answer: the task as it stands after close-out'
L show --task task-3 --by Harbour | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.task.id+" ["+o.task.state+"]");for(const r of o.records)console.log("  "+r.id+" "+r.kind+" ["+r.state+"]"+(r.to?" to "+r.to:"")+(Object.keys(r.links).length?" "+JSON.stringify(r.links):"")+(r.stale?" STALE":""))})'
say 'John: what is addressed to him'
L find --to John --state open --by John | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a.length+" open to John: "+a.map(r=>r.id+" ("+r.kind+", in "+r.in+")").join(", "))})'
L check
