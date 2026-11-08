#!/usr/bin/env bash
# LIN-4394 run 5: in-remit surfaces audit (LV). Usage: surfaces.sh <LV repo> ; pins: 5334c81a (run-4 pin), 9574d537 (run-5 pin), f25aa127 (rolling base)
R=$1; P=9574d5371cd78a4ce0ab98bc5278706eb4e1bc6f; A=5334c81a7207b9f2cc85ca429a2c6b18e1635c0e; F=f25aa127
for rng in "$A..$P" "$F..$P"; do
  echo "== window $rng"
  for pre in '.github/' 'docs/plans/' 'public/' 'tests/' 'lib/' 'routes/' 'scripts/'; do
    n=$(git -C "$R" log --first-parent -m --name-only --format='@@C@@%H' "$rng" -- "$pre" | awk '/^@@C@@/{c++} END{print c+0}')
    a=$(git -C "$R" log --first-parent -m --numstat --no-renames --format='' "$rng" -- "$pre" | awk -v p="$pre" '{s+=$1} END{print s+0}')
    echo "$pre landings=$n added_lines=$a"
  done
  echo "docs/reviews landings=$(git -C "$R" log --first-parent -m --format='%H' "$rng" -- docs/reviews | wc -l | tr -d ' ')"
  echo "experiments/**/replay/work landings=$(git -C "$R" log --first-parent -m --format='%H' "$rng" -- 'experiments/**/replay/work' | wc -l | tr -d ' ')"
done
echo "== Periodicals, dispatch-store, server.js (delta window $A..$P)"
for f in lib/periodicals.js lib/dispatch-store.js server.js lib/prompt-template-defs.js public/prompt-section.js; do
  echo "$f touches=$(git -C "$R" log --first-parent -m --format='%H' $A..$P -- $f | wc -l | tr -d ' ') lines@$A=$(git -C "$R" show $A:$f | wc -l | tr -d ' ') lines@$P=$(git -C "$R" show $P:$f | wc -l | tr -d ' ')"
done
echo "== tests/ file and test-call growth at pins"
for rev in $F $A $P; do
  echo "$rev unit_files=$(git -C "$R" ls-tree -r --name-only $rev tests/unit | grep -c '\.test\.js$') static_test_calls=$(git -C "$R" grep -E -c '^\s*(test|it)\(' $rev -- tests scripts 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')"
done
echo "== cluster (Home / task page) unique landings, delta and rolling; docs/areas, fixtures, budget test, proxy, runner, source-map, llms"
for rng in "$A..$P" "$F..$P"; do
  echo "cluster unique landings $rng: $(git -C "$R" log --first-parent -m --format=%h $rng -- public/prompt-section.js lib/task-page-loader.js lib/render.js lib/render-task-page.js routes/task-page.js public/app.js public/task-page.js lib/task-board-view.js 'lib/home-*.js' | sort -u | wc -l | tr -d ' ')"
  echo "docs/areas landings $rng: $(git -C "$R" log --first-parent --format=%h $rng -- docs/areas | wc -l | tr -d ' ')"
  echo "tests/fixtures landings $rng: $(git -C "$R" log --first-parent --format=%h $rng -- tests/fixtures | wc -l | tr -d ' ')"
  echo "prompt-size-budget test landings $rng: $(git -C "$R" log --first-parent --format=%h $rng -- tests/unit/prompt-size-budget.test.js | wc -l | tr -d ' ')"
  echo "routes/proxy.js landings $rng: $(git -C "$R" log --first-parent --format=%h $rng -- routes/proxy.js | wc -l | tr -d ' ')"
  echo "lib/runner-kit/runner.mjs landings $rng: $(git -C "$R" log --first-parent --format=%h $rng -- lib/runner-kit/runner.mjs | wc -l | tr -d ' ')"
  echo "source-map.md landings $rng: $(git -C "$R" log --first-parent --format=%h $rng -- docs/architecture/source-map.md | wc -l | tr -d ' ')"
  echo "llms.txt landings $rng: $(git -C "$R" log --first-parent --format=%h $rng -- public/llms.txt | wc -l | tr -d ' ')"
done
