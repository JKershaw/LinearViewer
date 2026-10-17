#!/bin/bash
S=<scratch>/dl4/c
for p in indent nocomment rename fields callshape declared access gate; do
  cp $S/probe/de-$p.js $S/probe/tp/lib/dispatch-entrance.js
  $S/probe/run-suite.sh $S/probe/tp $S/probe/r-$p
  echo "$p $(cat $S/probe/r-$p.rc) $(grep '^# fail' $S/probe/r-$p.tap)"
done
cp $S/tree/lib/dispatch-entrance.js $S/probe/tp/lib/dispatch-entrance.js
$S/probe/run-suite.sh $S/probe/tp-split $S/probe/r-split
echo "split $(cat $S/probe/r-split.rc) $(grep '^# fail' $S/probe/r-split.tap)"
