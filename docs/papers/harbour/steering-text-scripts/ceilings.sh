#!/bin/bash
F=tests/unit/prompt-size-budget.test.js
for h in $(git log --first-parent --reverse --format='%h' -- $F); do
  d=$(git log -1 --format=%cs $h)
  v=$(git show "${h}:${F}" | grep -oE 'FROZEN_TOTAL_BYTES = [0-9]+' | grep -oE '[0-9]+')
  sz=$(git show "${h}:${F}" | wc -c | tr -d ' ')
  s=$(git log -1 --format=%s $h | cut -c1-80); case "$s" in Merge*) s=$(git log -1 --format=%b $h | head -1 | cut -c1-80);; esac
  echo "$d $h $v $sz $s"
done
