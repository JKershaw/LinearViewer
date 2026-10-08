#!/usr/bin/env bash
# Count the production files that hold each named decision's signature at each snapshot (finding 2 of coherence-as-it-grows.md).
# Usage, from the repository root: bash docs/papers/harbour/coherence-as-it-grows-scripts/known-decisions.sh [sha ...]
# Production code is server.js, lib/, routes/ and public/ (minified and vendored files excluded by the pattern paths).
set -u
SHAS=${*:-"05d33f51 462ecafd a208d6b3 8b2be424 982fc662 d61903f3"}
count() { git grep -l -E "$1" "$2" -- server.js lib routes public 2>/dev/null | grep -v '\.min\.' | wc -l | tr -d ' '; }
printf "%-9s %s\n" sha "terminalStates fenceParse tsParse fmtDuration stampClassifier sessionClass shipLayout segmentRank ledgerHeading pageShell storeClear prodFiles"
for sha in $SHAS; do
  t1=$(count "\['completed', ?'canceled', ?'duplicate'\]" "$sha")
  t2=$(count 'fence = text\.match\(/```' "$sha")
  t3=$(count 'function (toMillis|toMs|_epoch)\(' "$sha")
  t4=$(count 'function format(Duration|Elapsed)\(' "$sha")
  t5=$(count 'decision-withdrawal-reversed' "$sha")
  t6=$(count 'isStandaloneSession|isTerminalLoop' "$sha")
  t7=$(count 'orderByDependency|computeProximityRings' "$sha")
  t8=$(count 'SEGMENT_RANK' "$sha")
  t9=$(count 'What CI Did Not Prove' "$sha")
  t10=$(count 'deployInfo: getDeployInfo\(\)' "$sha")
  t11=$(count 'async clear\(urlKey\)' "$sha")
  files=$(git ls-tree -r --name-only "$sha" | grep -E '^(server\.js|lib/.*\.(js|mjs)|routes/.*\.(js|mjs)|public/.*\.(js|mjs))$' | grep -vE 'vendor|\.min\.' | wc -l | tr -d ' ')
  printf "%-9s %s %s %s %s %s %s %s %s %s %s %s %s\n" "$sha" "$t1" "$t2" "$t3" "$t4" "$t5" "$t6" "$t7" "$t8" "$t9" "$t10" "$t11" "$files"
done
