const {execFileSync}=require("child_process");const fs=require("fs");
const s=require("./data/ci-runs.json").repos.LinearViewer.runs;
function isoWeek(d){d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-day);const y0=new Date(Date.UTC(d.getUTCFullYear(),0,1));return "W"+String(Math.ceil(((d-y0)/864e5+1)/7)).padStart(2,"0");}
const weeks=["W27","W30","W33","W34","W35","W36","W37","W38","W39","W40","W41","W42"];const N=8;
const cache=fs.existsSync("data/jobs.json")?require("./data/jobs.json"):{};
for(const w of weeks){const xs=s.filter(r=>r.event==="push"&&r.head_branch==="main"&&r.conclusion==="success"&&r.run_attempt===1&&isoWeek(new Date(r.created_at))===w);
 const k=Math.max(1,Math.floor(xs.length/N));const pick=xs.filter((_,i)=>i%k===0).slice(0,N);
 for(const r of pick){if(cache[r.id])continue;
  const j=JSON.parse(execFileSync("gh",["api",`repos/JKershaw/LinearViewer/actions/runs/${r.id}/jobs?per_page=50`,"--jq","[.jobs[]|{name,started_at,completed_at,steps:[.steps[]|{name,started_at,completed_at}]}]"],{encoding:"utf8"}));
  cache[r.id]={week:w,created_at:r.created_at,wall:(new Date(r.updated_at)-new Date(r.run_started_at))/60000,jobs:j};}}
fs.writeFileSync("data/jobs.json",JSON.stringify(cache));
const q=(xs,p)=>{const a=[...xs].sort((x,y)=>x-y);const i=(a.length-1)*p;const lo=Math.floor(i),hi=Math.ceil(i);return +(a[lo]+(a[hi]-a[lo])*(i-lo)).toFixed(2);};
const dur=(o)=>(new Date(o.completed_at)-new Date(o.started_at))/60000;
const res=[];
for(const w of weeks){const rs=Object.values(cache).filter(c=>c.week===w);const g={};
 for(const c of rs){for(const j of c.jobs){const n=j.name.replace(/E2E shard \d\/\d/,"E2E (max shard)");if(n.startsWith("E2E"))continue;(g[n]||=[]).push(dur(j));
   for(const st of j.steps||[]){if(/Run unit tests|Install/.test(st.name)&&st.completed_at){(g["  step: "+n.slice(0,4)+" / "+st.name]||=[]).push(dur(st));}}}
  const e=c.jobs.filter(j=>j.name.startsWith("E2E"));(g["E2E slowest shard"]||=[]).push(Math.max(...e.map(dur)));(g["E2E mean shard"]||=[]).push(e.map(dur).reduce((a,b)=>a+b,0)/e.length);
  for(const j of e){const st=(j.steps||[]).find(x=>/Run E2E/.test(x.name));if(st)(g["  step: E2E run (mean shard)"]||=[]).push(dur(st));}
  (g["wall"]||=[]).push(c.wall);(g["job-minutes total"]||=[]).push(c.jobs.reduce((a,j)=>a+dur(j),0));}
 const row={week:w,n:rs.length};for(const [k,v] of Object.entries(g))row[k]=q(v,.5);res.push(row);}
fs.writeFileSync("data/jobs-summary.json",JSON.stringify(res,null,1));
for(const r of res)console.log(JSON.stringify(r));
