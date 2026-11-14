#!/bin/bash
# LIN-4478: FROZEN_TOTAL_BYTES and the budget file's size at every first-parent commit up to REV
# that touched the budget file. Usage: bash ceilings.sh [rev=a886fb506] > ceilings.txt
REV=${1:-a886fb506}
F=tests/unit/prompt-size-budget.test.js
for h in $(git log --first-parent --reverse --format='%h' "$REV" -- $F); do
  d=$(git log -1 --format=%cs $h)
  v=$(git show "${h}:${F}" | grep -oE 'FROZEN_TOTAL_BYTES = [0-9]+' | grep -oE '[0-9]+')
  sz=$(git show "${h}:${F}" | wc -c | tr -d ' ')
  s=$(git log -1 --format=%s $h | cut -c1-80); case "$s" in Merge*) s=$(git log -1 --format=%b $h | head -1 | cut -c1-80);; esac
  echo "$d $h $v $sz $s"
done
