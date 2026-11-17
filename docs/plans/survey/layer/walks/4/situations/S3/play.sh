#!/usr/bin/env bash
# S3. A count copied five ways. Recreates store.json from empty and plays the scene.
set -euo pipefail
cd "$(dirname "$0")"
rm -f store.json
L() { node ../../model/layer.mjs --store store.json "$@"; }
D=2026-11-13
say() { printf '\n===== %s =====\n' "$*"; }
# first open finding addressed to the area, as the actor sees it
first_open() { L find --to area-1 --state open --by "$1" --as-of "$2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const a=Array.isArray(r)?r:(r.records||r.results||[]);console.log(a.map(x=>x.id).join(" "))})'; }

say "Seed (Harbour): area-1 with 26 open findings addressed to it"
L add area '{"name":"runs-dispatch","paths":["lib/dispatch"]}' --by Harbour --at ${D}T08:00:00Z >/dev/null
for i in $(seq 1 26); do
  L add finding "{\"in\":\"area-1\",\"to\":\"area-1\",\"says\":\"Open finding $i in lib/dispatch\"}" --by Harbour --at ${D}T08:00:00Z >/dev/null
done
L find --to area-1 --state open --count --by Harbour --as-of ${D}T08:00:00Z

say "1. Ask's writer (John, 10:00)"
L find --to John --state open --by John --as-of ${D}T10:00:00Z
L find --to area-1 --state open --count --by John --as-of ${D}T10:00:00Z
L find --area area-1 --state open --count --by John --as-of ${D}T10:00:00Z   # path rule: findings carry no paths
# states scope as the live query, not a typed number -> task-28
L add task '{"in":"area-1","asked":"Clear the open findings addressed to area runs-dispatch (area-1). Scope is the live set: find --to area-1 --state open.","done-when":"find --to area-1 --state open --count returns 0","paths":["lib/dispatch"]}' --by John --at ${D}T10:00:00Z

build() { # $1 time, $2 how many findings to end
  local T=${D}T$1:00:00Z
  say "Build (implementation, $1:00) ends $2"
  L brief implementation --task task-28 --as-of $T --text
  local run; run=$(L add run '{"in":"task-28","stage":"implementation","claims":["lib/dispatch"]}' --by implementation --at $T | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')
  echo "run: $run"
  local ids; ids=$(first_open implementation $T)
  local n=0
  for f in $ids; do
    [ $n -ge $2 ] && break
    L end $f done "fixed by $run on task-28" --by implementation --at ${D}T$1:30:00Z >/dev/null
    echo "ended $f"; n=$((n+1))
  done
  L link $run about task-28@1 --by implementation --at ${D}T$1:40:00Z >/dev/null
  L end $run done "ended $2 finding(s)" --by implementation --at ${D}T$1:45:00Z >/dev/null
}

build 12 1

say "3. Plan reviewer (plan-review, 13:00)"
L brief plan-review --task task-28 --as-of ${D}T13:00:00Z --text
L find --kind plan --in task-28 --by plan-review --as-of ${D}T13:00:00Z
L add verdict '{"in":"task-28","of":"plan-review","outcome":"approve-with-notes","reasoning":"No plan piece exists; the scope is the ask itself. Scope is stated as a live query, so it needs no recount: the area line in the brief is the number. Note: no plan was written before building started.","links":{"on":"task-28@1"}}' --by plan-review --at ${D}T13:10:00Z

build 15 2
build 16 1

say "5. Reviewer (review, 17:00): the ask's number vs today's"
L brief review --task task-28 --as-of ${D}T17:00:00Z --text
L get task-28@1 --by review --as-of ${D}T17:00:00Z
L find --to area-1 --state open --count --by review --as-of ${D}T10:00:00Z
L find --to area-1 --state open --count --by review --as-of ${D}T13:00:00Z
L find --to area-1 --state open --count --by review --as-of ${D}T17:00:00Z
L find --to area-1 --state done --by review --as-of ${D}T17:00:00Z
L show --task task-28 --by review --as-of ${D}T17:00:00Z
L add verdict '{"in":"task-28","of":"review","outcome":"request-changes","reasoning":"The ask states its scope as a query, not a number, so there is no figure to be wrong. Re-running that query as of 10:00 and as of now gives both numbers from the store; the difference is exactly the findings ended done by the three runs in this task. Work is partial: open findings addressed to area-1 remain, so done-when is not met.","links":{"on":"task-28@1"}}' --by review --at ${D}T17:10:00Z

say "Log of reads"
node -e 'const s=require("./store.json");for(const l of s.log)console.log(l.at,l.by,l.q)'
