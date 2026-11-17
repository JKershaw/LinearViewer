#!/usr/bin/env bash
# next.sh <replay> <prev-n> <prev-actor> <task> [<n> <actor> <as-of>]: record the step just finished, then brief the next.
set -e; cd "$(dirname "$0")"
node step.mjs "$1" after "$2" "$3" "$4"
[ -n "$5" ] && node step.mjs "$1" before "$5" "$6" "$4" "$7"; true
