#!/bin/bash
# fails.sh <tap> : failing top-level test locations (file:line name)
awk '/^not ok /{name=$0; getline; while ($0 !~ /location:/ && $0 !~ /^(ok|not ok) /) { if ((getline) <= 0) break } if ($0 ~ /location:/) {sub(/.*location: */,""); print $0 " :: " name} }' "$1" | sed "s#<scratch>/dl4/c/[a-z/-]*/tests#tests#" | sort -u
