#!/usr/bin/env bash
# replant-all.sh: plant each gap-list row into the HREF-fixed e7f7bd57 copy, run the codec tests at bf6f7507
S=/tmp/claude-0/-home-user/61183684-9674-527e-9fe5-98f9bb5cc446/scratchpad
D=$S/rebuild-exp2/2b; T=$S/rebuild-exp1/tree-2b; W=$S/rebuild-exp2/2b/replant-work
rm -rf $W; mkdir -p $W
ids=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$D/gap-list.json','utf8')).rows.map(r=>r.id).join(' '))")
run() {
  id=$1; w=$W/$id; mkdir -p $w/lib/providers $w/tests/unit; cp -r $T/lib/providers/jira $w/lib/providers/
  cp $T/package.json $w/; ln -s $T/node_modules $w/node_modules
  cp -r $T/tests/unit/jira-provider-adf-codec.test.js $w/tests/unit/
  # the test reads fixtures? copy tests/fixtures if referenced
  [ -d $T/tests/fixtures ] && ln -s $T/tests/fixtures $w/tests/fixtures
  node $D/plant.mjs $id $D/e7-hreffix.js $w/lib/providers/jira/adf.js >/dev/null || { echo "$id PLANTFAIL"; return; }
  (cd $w && timeout 25 node --test tests/unit/jira-provider-adf-codec.test.js > out.txt 2>&1); rc=$?
  f=$(grep -E "^# fail" $w/out.txt | awk '{print $3}')
  echo "$id rc=$rc fail=${f:-?}"
}
export -f run; export S D T W
for id in $ids; do echo $id; done | xargs -P 8 -I{} bash -c 'run {}' | sort
