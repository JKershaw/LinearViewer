// compare.cjs <arm>...: shape + replay summary per arm (replay vs the original behaviour, arms/A)
const fs=require('fs'), path=require('path')
const rows=[]
for (const a of process.argv.slice(2)) {
  const dir=path.join(__dirname,a); const r={arm:a}
  try { const s=JSON.parse(fs.readFileSync(dir+'/shape.json','utf8')); const c=s.cyclomatic||s.complexity
    const units=(s.functions?.total??s.functions?.count)+1
    Object.assign(r,{code:s.lines?.code, comments:s.lines?.comment, fns:units-1, decisions:c.total-units, worst:c.max?.cyclomatic, longest:s.longestFunction?.byCodeLines?.codeLines ?? s.longestFunction?.codeLines})
  } catch(e){}
  try { const d=JSON.parse(fs.readFileSync(dir+'/diff.json','utf8'))
    r.cells=Object.values(d.totals).reduce((n,t)=>n+t.different,0); r.groups=(d.groups||[]).length
    r.privCells=(d.privateDifferences||[]).length; r.privGroups=(d.privateGroups||[]).length
  } catch(e){}
  rows.push(r)
}
console.table(rows)
