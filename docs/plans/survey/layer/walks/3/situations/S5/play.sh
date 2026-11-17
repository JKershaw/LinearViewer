#!/usr/bin/env bash
# S5. Proposals pile with nothing declining them. Recreates store.json from empty.
set -u
cd "$(dirname "$0")"
rm -f store.json
L() { node ../../model/layer.mjs "$@" --store store.json; }
# W: a write, printed compactly (id, version, state); a refusal prints in full.
W() { local o; o=$(L "$@"); local rc=$?; if [ $rc -eq 0 ]; then printf '%s' "$o" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s),v=r.versions.at(-1);console.log(`ok ${r.id} v${v.v} ${v.op} [${v.state}]`+(v.links&&Object.keys(v.links).length?" links "+JSON.stringify(v.links):""))})'; else echo "$o"; echo "exit $rc"; fi; }
say() { printf '\n### %s\n' "$*"; }
open_to_john() { L find --kind finding --to John --state open --by "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a.length+" open findings to John");for(const r of a)console.log("  "+r.id+" ["+r.at+"] "+r.fields.says+(r.links["same-as"]?"  (same-as "+r.links["same-as"]+")":""))})'; }

say 'Seed (Harbour): one area. The keeper John is already a declared person; no task.'
W add area '{"name":"lighthouse research","paths":["studies/","reads/","proposals.md"]}' --by Harbour --at 2026-11-13T09:00:00Z

# ---------- Run 1, 14 Nov 09:00 ----------
say 'Run 1: write as it really is (a scheduled run)'
W add finding '{"in":"area-1","to":"John","says":"Flag stale sources in the weekly read: any study citing data older than 90 days gets a stale marker."}' --by run --at 2026-11-14T09:00:00Z
say 'Run 1: ask for a brief as the nearest stage (survey-place); there is no task'
L brief survey-place --task area-1 --as-of 2026-11-14T09:00:00Z --text || echo "exit $?"
say 'Run 1 (as survey-place): what is open for the keeper?'
open_to_john survey-place
W add run '{"in":"area-1","stage":"survey-place","claims":["reads/2026-11-14.md"],"account":"Weekly read 14 Nov; two proposals to the keeper."}' --by survey-place --at 2026-11-14T09:00:00Z
W add finding '{"in":"area-1","to":"John","says":"Flag stale sources in the weekly read: any study citing data older than 90 days gets a stale marker."}' --by survey-place --at 2026-11-14T09:01:00Z
W add finding '{"in":"area-1","to":"John","says":"Mark studies whose underlying data is more than three months old, so the weekly read shows freshness at a glance."}' --by survey-place --at 2026-11-14T09:02:00Z
W end run-2 done 'read written; proposals finding-3, finding-4' --by survey-place --at 2026-11-14T09:03:00Z

# ---------- Run 2, 15 Nov 09:00 ----------
say 'Run 2 (as survey-place): what is open for the keeper?'
open_to_john survey-place
W add run '{"in":"area-1","stage":"survey-place","claims":["reads/2026-11-15.md"],"account":"Weekly read 15 Nov; two proposals to the keeper."}' --by survey-place --at 2026-11-15T09:00:00Z
W add finding '{"in":"area-1","to":"John","says":"Cap each weekly read at the five most-changed studies; link the rest underneath."}' --by survey-place --at 2026-11-15T09:01:00Z
W add finding '{"in":"area-1","to":"John","says":"Add a freshness check to the weekly read so out-of-date sources are visible."}' --by survey-place --at 2026-11-15T09:02:00Z
W end run-5 done 'read written; proposals finding-6, finding-7' --by survey-place --at 2026-11-15T09:03:00Z

# ---------- Run 3, 16 Nov 09:00 ----------
say 'Run 3 (as survey-place): what is open for the keeper?'
open_to_john survey-place
W add run '{"in":"area-1","stage":"survey-place","claims":["reads/2026-11-16.md"],"account":"Weekly read 16 Nov; two proposals to the keeper."}' --by survey-place --at 2026-11-16T09:00:00Z
W add finding '{"in":"area-1","to":"John","says":"Record which questions each study answered, so the weekly read can say what moved."}' --by survey-place --at 2026-11-16T09:01:00Z
W add finding '{"in":"area-1","to":"John","says":"Limit the weekly read to the top five studies by change and list the remainder as links."}' --by survey-place --at 2026-11-16T09:02:00Z
W end run-8 done 'read written; proposals finding-9, finding-10' --by survey-place --at 2026-11-16T09:03:00Z

# ---------- Run 4, 17 Nov 09:00 ----------
say 'Run 4 (as survey-place): what is open for the keeper?'
open_to_john survey-place
W add run '{"in":"area-1","stage":"survey-place","claims":["reads/2026-11-17.md"],"account":"Weekly read 17 Nov; two proposals to the keeper."}' --by survey-place --at 2026-11-17T09:00:00Z
W add finding '{"in":"area-1","to":"John","says":"Retire studies untouched for eight weeks into an archive section of the weekly read."}' --by survey-place --at 2026-11-17T09:01:00Z
W add finding '{"in":"area-1","to":"John","says":"Track the questions each study addresses so the weekly read reports progress per question."}' --by survey-place --at 2026-11-17T09:02:00Z
W end run-11 done 'read written; proposals finding-12, finding-13' --by survey-place --at 2026-11-17T09:03:00Z

# ---------- Run 5, 18 Nov 09:00 ----------
say 'Run 5 (as survey-place): what is open for the keeper?'
open_to_john survey-place
W add run '{"in":"area-1","stage":"survey-place","claims":["reads/2026-11-18.md"],"account":"Weekly read 18 Nov; two proposals to the keeper."}' --by survey-place --at 2026-11-18T09:00:00Z
W add finding '{"in":"area-1","to":"John","says":"Number studies from one counter file so two runs cannot allocate the same study id."}' --by survey-place --at 2026-11-18T09:01:00Z
W add finding '{"in":"area-1","to":"John","says":"Move studies nobody has updated in two months to an archive list."}' --by survey-place --at 2026-11-18T09:02:00Z
W end run-14 done 'read written; proposals finding-15, finding-16' --by survey-place --at 2026-11-18T09:03:00Z

# ---------- John does not answer ----------
say 'John: what is addressed to him (he does not answer; nothing is written)'
L find --to John --state open --by John | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a.length+" open records to John: "+a.map(r=>r.id).join(", "))})'

# ---------- Run 6, 19 Nov 09:00 ----------
say 'Run 6 (as survey-place): what is open for the keeper?'
open_to_john survey-place
say 'Run 6: looks for repeats by text (the words differ, so substring search finds only some)'
for t in freshness 'five' archive questions; do printf '%s: ' "$t"; L find --kind finding --to John --state open --text "$t" --by survey-place | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(r=>r.id).join(", ")))'; done
W add run '{"in":"area-1","stage":"survey-place","claims":["reads/2026-11-19.md"],"account":"Weekly read 19 Nov. Ten proposals open to the keeper, none answered since 14 Nov; five are restatements of earlier ones. Linked each to its original and asked the keeper once instead of proposing more."}' --by survey-place --at 2026-11-19T09:00:00Z
W link finding-4 same-as finding-3 --by survey-place --at 2026-11-19T09:01:00Z
W link finding-7 same-as finding-3 --by survey-place --at 2026-11-19T09:01:00Z
W link finding-10 same-as finding-6 --by survey-place --at 2026-11-19T09:01:00Z
W link finding-13 same-as finding-9 --by survey-place --at 2026-11-19T09:01:00Z
W link finding-16 same-as finding-12 --by survey-place --at 2026-11-19T09:01:00Z
W add question '{"in":"area-1","to":"John","asks":"Ten proposals to you are open since 14-18 Nov, none answered; five restate earlier ones (linked same-as). Which should stand?","options":["take finding-3, finding-6, finding-9, finding-12, finding-15; decline the five repeats","decline all and start fresh","leave them open"],"recommended":"take the five originals; decline the five repeats","if-unanswered":"they stay open; nothing in the record expires them"}' --by survey-place --at 2026-11-19T09:02:00Z
W end run-17 done 'read written; repeats linked; question-18 to the keeper' --by survey-place --at 2026-11-19T09:03:00Z

# ---------- The question ----------
say 'Answer: what is open for the keeper now, and does anything end?'
L find --to John --state open --by Harbour | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log(a.length+" open to John: "+a.map(r=>r.id+(r.links["same-as"]?"="+r.links["same-as"]:"")).join(", "))})'
L find --state done --by Harbour | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);console.log("ended done: "+a.map(r=>r.id+" ("+r.kind+")").join(", "))})'
L check
