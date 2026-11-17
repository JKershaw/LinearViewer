#!/usr/bin/env bash
# S5. Proposals pile with nothing declining them (Lighthouse).
# Recreates store.json from empty and plays the whole scene. Output -> play.log.
set -u
cd "$(dirname "$0")"
rm -f store.json play.log
L() { node model/layer.mjs --store store.json "$@"; }
say() { echo "### $*" | tee -a play.log; }
# run a write, log it, print its id (or nothing on refusal)
W() { local out; out=$(L "$@"); echo "\$ layer $*" >>play.log; echo "$out" >>play.log; echo "$out" | jq -r '.id // empty'; }
# run a read, log it
R() { echo "\$ layer $*" >>play.log; L "$@" >>play.log; echo >>play.log; }

# ---- Seed (by the system actor): one area. John is declared in model/actors.json. No tracker.
say "seed 13 Nov"
AREA=$(W add area '{"name":"Lighthouse","paths":["src/","docs/","build/"]}' --by Lighthouse --at 2026-11-13T12:00:00Z)

# A run: Lighthouse dispatches it as a task (brief needs one), the run reads its brief and
# looks up what is already open for the keeper, files its proposals, ends its own work.
start_run() { # day -> sets TASK RUN
  local d=$1
  say "run on $d Nov"
  TASK=$(W add task "{\"in\":\"$AREA\",\"asked\":\"Daily run $d Nov: survey Lighthouse and propose changes to the keeper (John).\",\"done-when\":\"Proposals filed to John.\",\"paths\":[\"src/\",\"docs/\",\"build/\"]}" --by Lighthouse --at 2026-11-${d}T09:00:00Z)
  R brief run --task "$TASK" --as-of 2026-11-${d}T09:00:30Z --text
  R find --to John --state open --as-of 2026-11-${d}T09:00:30Z --by run
  RUN=$(W add run "{\"in\":\"$TASK\",\"stage\":\"run\",\"claims\":[]}" --by run --at 2026-11-${d}T09:01:00Z)
}
propose() { # day minute asks lapse-date -> id
  W add question "{\"in\":\"$TASK\",\"to\":\"John\",\"asks\":\"$3\",\"options\":[\"adopt\",\"decline\"],\"recommended\":\"adopt\",\"if-unanswered\":\"If John has not answered by $4, withdraw it: the change is not made.\",\"links\":{\"about\":\"$AREA\"}}" --by run --at 2026-11-${1}T09:${2}:00Z
}
restate() { # day minute asks lapse-date earlier-id -> new id; hands the earlier one on into it
  local new
  new=$(W add question "{\"in\":\"$TASK\",\"to\":\"John\",\"asks\":\"$3\",\"options\":[\"adopt\",\"decline\"],\"recommended\":\"adopt\",\"if-unanswered\":\"If John has not answered by $4, withdraw it: the change is not made. (Keeps the date of $5, which it restates.)\",\"links\":{\"about\":\"$AREA\",\"same-as\":\"$5\"}}" --by run --at 2026-11-${1}T09:${2}:00Z)
  W end "$5" handed-on "restated with a refinement as $new" --into "$new" --by run --at 2026-11-${1}T09:$(( 10#$2 + 1 )):00Z >/dev/null
  echo "$new"
}
end_run() { # day
  W end "$RUN" done "proposals filed" --by run --at 2026-11-${1}T09:10:00Z >/dev/null
  W end "$TASK" done "proposals filed to John" --by run --at 2026-11-${1}T09:10:00Z >/dev/null
}

# ---- 1. Five runs, 14-18 Nov, 09:00
start_run 14
P1=$(propose 14 02 "Cache the dependency install step in the build so repeat builds skip it." 2026-11-19)
P2=$(propose 14 03 "Add a link checker to the docs build that fails on broken internal links." 2026-11-19)
end_run 14

start_run 15
P3=$(propose 15 02 "Split build/config.yml into one file per section." 2026-11-20)
P4=$(restate 15 03 "Reuse one dependency cache across all build jobs, not per job." 2026-11-19 "$P1")
end_run 15

start_run 16
P5=$(propose 16 02 "Pin the toolchain version in one place (build/toolchain) and read it everywhere." 2026-11-21)
P6=$(restate 16 03 "Check docs links, external ones included, on a weekly schedule." 2026-11-19 "$P2")
end_run 16

start_run 17
P7=$(propose 17 02 "Delete the unused legacy export script src/export-legacy.sh." 2026-11-22)
P8=$(restate 17 03 "Move each config section to its own file and load them with one small loader." 2026-11-20 "$P3")
end_run 17

start_run 18
P9=$(propose 18 02 "Add a smoke test that runs the release script in dry-run mode." 2026-11-23)
P10=$(restate 18 03 "Key the shared dependency cache on the lockfile hash." 2026-11-19 "$P4")
end_run 18

# ---- 2. John does not answer: he is shown what is open for him, and writes nothing.
say "John, 18 Nov evening"
R find --to John --state open --as-of 2026-11-18T20:00:00Z --by John

# ---- 3. A sixth run, 19 Nov. Two open proposals carry a lapse date of 19 Nov: it carries
# out their if-unanswered (withdraw), and files one new proposal. It does not re-propose
# the lapsed ones.
start_run 19
W end "$P6" withdrawn "lapsed: no answer from John by 2026-11-19 (its if-unanswered)" --by run --at 2026-11-19T09:02:00Z >/dev/null
W end "$P10" withdrawn "lapsed: no answer from John by 2026-11-19 (its if-unanswered)" --by run --at 2026-11-19T09:02:00Z >/dev/null
P11=$(propose 19 03 "Add a CONTRIBUTING note on how to run the build locally." 2026-11-24)
end_run 19

say "after"
R find --to John --state open --as-of 2026-11-19T12:00:00Z --by John
R find --to John --as-of 2026-11-19T12:00:00Z --count --by John
R find --to John --state open --as-of 2026-11-19T12:00:00Z --count --by John
echo "ids: area=$AREA P1=$P1 P2=$P2 P3=$P3 P4=$P4 P5=$P5 P6=$P6 P7=$P7 P8=$P8 P9=$P9 P10=$P10 P11=$P11" | tee -a play.log
grep -n refused play.log || echo "no refusals" | tee -a play.log
