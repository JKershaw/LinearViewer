#!/bin/sh
# Run 5: presence guards on DOM methods in public/, at one commit (git grep over the commit's tree, no checkout).
# Usage (repo root): sh dom-guard-residue.sh <commit>
# Pattern A: `typeof X.m === / !== 'function'` (method-presence guard).   Pattern B: `X.m && ` or `X.m ? ` / `X.m || ` (bare presence test).
# Methods: the six scanned by tests/unit/public-element-method-guards.test.js plus focus, setSelectionRange, dispatchEvent, contains, querySelectorAll.
M='(contains|querySelectorAll|querySelector|closest|matches|focus|setSelectionRange|dispatchEvent|scrollIntoView|getBoundingClientRect|addEventListener|append|remove|insertBefore|replaceChildren)'
A=$(git grep -n -E "typeof [A-Za-z_\$][A-Za-z0-9_\$.]*\.$M *[!=]==? *'function'" "$1" -- public | wc -l | tr -d ' ')
B=$(git grep -n -E "[A-Za-z_\$][A-Za-z0-9_\$.]*\.$M *(&&|\|\||\?)" "$1" -- public | wc -l | tr -d ' ')
echo "${1%%:*} typeofGuards=$A presenceTests=$B"
