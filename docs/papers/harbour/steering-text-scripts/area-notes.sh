#!/bin/bash
# LIN-4478: Waiting bullets, Lessons bytes and total bytes of the area notes (README aside) at
# every first-parent commit up to REV that touched docs/areas/. Usage: bash area-notes.sh [rev=a886fb506] > area-notes.txt
REV=${1:-a886fb506}
for h in $(git log --first-parent --reverse --format=%h "$REV" -- docs/areas); do
  d=$(git log -1 --format=%cs $h)
  files=$(git ls-tree --name-only "${h}" docs/areas/ | grep -E '\.md$' | grep -v README)
  W=0; L=0; B=0
  for f in $files; do
    t=$(git show "${h}:${f}")
    w=$(printf '%s\n' "$t" | awk '/^## Waiting/{s=1;next} /^## /{s=0} s && /^- /{n++} END{print n+0}')
    lb=$(printf '%s\n' "$t" | awk '/^## Lessons/{s=1;next} /^## /{s=0} s{b+=length($0)+1} END{print b+0}')
    W=$((W+w)); L=$((L+lb)); B=$((B+${#t}))
  done
  echo "$d $h waiting=$W lessonsB=$L totalB=$B"
done
