#!/bin/bash
# direct-selfcheck.sh <base tree> : the direct-call class's planted mutants (each must differ)
S=<scratch>/dl4/c/replay
BASE=$1; W=$S/work/direct-mutants-$$; mkdir -p $W
mk() { # id from to
  local d=$W/$1; mkdir -p $d; for e in $(ls -A $BASE); do if [ "$e" = lib ]; then cp -r $BASE/lib $d/lib; else ln -s $BASE/$e $d/$e; fi; done
  node -e 'const fs=require("fs");const [f,a,b]=process.argv.slice(1);const s=fs.readFileSync(f,"utf8");if(s.split(a).length!==2){console.error("anchor x"+(s.split(a).length-1));process.exit(3)}fs.writeFileSync(f,s.replace(a,b))' $d/lib/dispatch-entrance.js "$2" "$3" || return 3
  node $S/direct.mjs --old $BASE --new $d --seed 1 --out $S/reports/direct-mutant-$1.json | head -1 | sed "s/^/$1: /"
}
mk fail-open "  if (typeof ctx.ownerGate !== 'function') {" "  if (false && typeof ctx.ownerGate !== 'function') {"
mk gate-late "    if (await ctx.ownerGate(target ?? 'cli')) return;

    // The rest of the body, in the order the caller is told about it.
    const bodyFailure = await runSteps(SESSION_AFTER_GATE, input);
    if (bodyFailure) return kit.rejectBody(bodyFailure);" "    // The rest of the body, in the order the caller is told about it.
    const bodyFailure = await runSteps(SESSION_AFTER_GATE, input);
    if (bodyFailure) return kit.rejectBody(bodyFailure);
    if (await ctx.ownerGate(target ?? 'cli')) return;"
mk gate-target "ctx.ownerGate(target ?? 'cli')" "ctx.ownerGate(target)"
mk gate-ignored "    if (await ctx.ownerGate(target ?? 'cli')) return;" "    await ctx.ownerGate(target ?? 'cli');"
