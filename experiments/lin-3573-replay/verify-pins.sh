#!/bin/sh
# Verify every byte-pinned file in this harness against the repository's own object database.
#   ./verify-pins.sh <checkout-of-LinearViewer> [expected-harness-sha]
# Exit 0 only when: the two stored routers equal `git rev-parse <BASE_SHA>:<path>`, the three
# pinned rung-3 blobs equal `git rev-parse 80574964:<path>`, and (when given) HEAD of this
# harness checkout is the recorded harness SHA with a clean tree.
set -u
CHK=${1:?usage: verify-pins.sh <checkout> [expected-harness-sha]}
HERE=$(cd "$(dirname "$0")" && pwd)
BASE=$(cat "$HERE/BASE_SHA")
fail=0
check() { # <rev:path in checkout> <file in harness>
  want=$(git -C "$CHK" rev-parse "$1" 2>/dev/null) || { echo "MISSING $1 (is the commit fetched in $CHK?)"; fail=1; return; }
  got=$(git hash-object "$HERE/$2")
  if [ "$want" = "$got" ]; then echo "ok        $2  $got"; else echo "MISMATCH  $2  have=$got want=$want ($1)"; fail=1; fi
}
check "$BASE:routes/proxy-writes.js"  base/routes/proxy-writes.js
check "$BASE:routes/proxy-rulings.js" base/routes/proxy-rulings.js
check "80574964:experiments/rebuild-rung3/replay/lib/hooks.mjs"    lib/hooks.mjs
check "80574964:experiments/rebuild-rung3/replay/lib/prepare.mjs"  lib/prepare.mjs
check "80574964:experiments/rebuild-rung3/replay/lib/coverage.mjs" lib/coverage.mjs
if [ $# -ge 2 ]; then
  head=$(git -C "$HERE" rev-parse HEAD)
  if [ "$head" = "$2" ]; then echo "ok        harness HEAD $head"; else echo "MISMATCH  harness HEAD have=$head want=$2"; fail=1; fi
  if [ -n "$(git -C "$HERE" status --porcelain)" ]; then echo "DIRTY     harness tree has uncommitted changes"; fail=1; fi
fi
[ $fail -eq 0 ] && echo "ALL PINS OK" || echo "PIN CHECK FAILED"
exit $fail
