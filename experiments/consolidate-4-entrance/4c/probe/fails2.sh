#!/bin/bash
# all failing (sub)tests with their file: "file :: name"
awk '/^ *not ok /{n=$0; sub(/^ *not ok [0-9]+ - /,"",n); want=1; next} want && /location:/ {l=$0; sub(/.*location: .*\/tests\//,"tests/",l); sub(/:[0-9]+:[0-9]+.*$/,"",l); print l " :: " n; want=0} /^ *(ok|not ok) /{want=0}' "$1" | sort -u
