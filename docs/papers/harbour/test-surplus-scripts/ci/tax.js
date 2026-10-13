const rows=require("./data/ci-failures.json").rows;const runs=require("./data/ci-runs.json").repos.LinearViewer.runs;
const job=r=>{const j=r.failingJobs.map(x=>x.split(":")[0]);return j.some(x=>/^Unit/.test(x))&&j.some(x=>/^E2E/.test(x))?"unit+e2e":j.some(x=>/^Unit/.test(x))?"unit":j.some(x=>/^E2E/.test(x))?"e2e":j.some(x=>/^Secret/.test(x))?"secret-scan":"other"};
const grp=c=>({flaky:"flaky",fault:"product fix","test updated":"test updated","pin bump":"test updated (pin bump)",unresolved:"unresolved",infra:"infra","doc/prompt":"doc/prompt","merge-main only":"merge-main/no-change","no-change":"merge-main/no-change","config/tooling":"config/tooling"}[c]||c);
const t=(xs,f)=>xs.reduce((m,r)=>{const k=f(r);m[k]=(m[k]||0)+1;return m},{});
const P={pre:r=>r.date<"2026-10-01",post:r=>r.date>="2026-10-01"};
const out={};
for(const [n,f] of Object.entries(P)){const xs=rows.filter(f);const rr=runs.filter(r=>f({date:r.created_at}));
 const byRun=new Map();for(const r of xs){const k=r.runId;if(!byRun.has(k))byRun.set(k,r);} // first attempt per run
 out[n]={runs:rr.length,failedAttempts:xs.length,attemptsPer100Runs:+(100*xs.length/rr.length).toFixed(1),failingRuns:byRun.size,
  attemptsByJobClass:t(xs,r=>job(r)+" | "+grp(r.class)),attemptsByClass:t(xs,r=>grp(r.class)),
  prAttemptsByClass:t(xs.filter(r=>r.event==="pull_request"),r=>grp(r.class)),
  runsByJobClass:t([...byRun.values()],r=>job(r)+" | "+grp(r.class)),
  logsAvailable:xs.filter(r=>r.logAvailable).length};}
out.byMonth=t(rows,r=>r.date.slice(0,7)+" | "+job(r)+" | "+grp(r.class));
out.postRows=rows.filter(P.post).map(r=>({date:r.date.slice(0,16),runId:r.runId,attempt:r.attempt,event:r.event,branch:r.branch,job:job(r),class:r.class,testFiles:r.testFiles,fixFiles:(r.evidence?.files||[]).map(f=>f.kind+":"+f.file)}));
require("fs").writeFileSync("data/taxonomy.json",JSON.stringify(out,null,1));
console.log(JSON.stringify({pre:out.pre,post:out.post},null,1));
for(const r of out.postRows)console.log(r.date,r.runId,r.event,r.job,r.class,r.testFiles.join(",").slice(0,90),"|",r.fixFiles.join(",").slice(0,120));
