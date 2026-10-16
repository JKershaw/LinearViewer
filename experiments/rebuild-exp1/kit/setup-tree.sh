#!/usr/bin/env bash
# setup-tree.sh <repo> <commit> <dest> [node_modules-dir]
# Extract <commit> of <repo> into <dest> (a scratch tree the kit runs tests in)
# without touching the repo's checkout, and give it dependencies: a symlink to
# an existing node_modules if one is given, otherwise `npm ci`.
set -euo pipefail
repo=$1 commit=$2 dest=$3 nm=${4:-}
mkdir -p "$dest"
git -C "$repo" archive "$commit" | tar -x -C "$dest"
if [ -n "$nm" ]; then ln -sfn "$nm" "$dest/node_modules"; else (cd "$dest" && npm ci --ignore-scripts); fi
git -C "$repo" rev-parse "$commit" > "$dest/.kit-commit"
echo "tree ready: $dest @ $(cat "$dest/.kit-commit")"
