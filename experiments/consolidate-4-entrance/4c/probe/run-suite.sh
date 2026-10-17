#!/bin/bash
# run-suite.sh <tree> <outprefix> [files...]  — unit tests in <tree>, network blocked, TAP out.
T=$1; O=$2; shift 2
cd $T || exit 2
unset OPENROUTER_API_KEY OPENROUTER_FREE_TIER_KEY $(env | grep -o "^OPENROUTER[A-Z_]*"); unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy ALL_PROXY NO_PROXY
export BLOCK_NET_LOG=$O.net.log
: > $BLOCK_NET_LOG
if [ $# -eq 0 ]; then set -- tests/unit/*.test.js scripts/code-shape/seams.test.mjs; fi
start=$(date +%s)
NODE_OPTIONS="--import=<scratch>/dl4/c/probe/block-net.mjs" TZ=UTC node --test --test-reporter=tap "$@" > $O.tap 2> $O.err
rc=$?
echo "rc=$rc secs=$(( $(date +%s) - start ))" > $O.rc
