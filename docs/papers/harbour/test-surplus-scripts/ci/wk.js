const s=require("./data/ci-runs.json").repos.LinearViewer.runs;
function isoWeek(d){d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-day);const y0=new Date(Date.UTC(d.getUTCFullYear(),0,1));return "W"+String(Math.ceil(((d-y0)/864e5+1)/7)).padStart(2,"0");}
const q=(xs,p)=>{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y);const i=(a.length-1)*p;const lo=Math.floor(i),hi=Math.ceil(i);return +(a[lo]+(a[hi]-a[lo])*(i-lo)).toFixed(2);};
const out={};
for(const r of s){const w=isoWeek(new Date(r.created_at));const o=out[w]||={week:w,start:null,runs:0,pr:0,push:0,failed:0,succ:[],succMain:[],succPR:[]};
 o.runs++; if(r.event==="push")o.push++; else o.pr++; if(r.conclusion==="failure")o.failed++;
 if(r.conclusion==="success"){const m=(new Date(r.updated_at)-new Date(r.run_started_at))/60000; if(m>0&&m<120){o.succ.push(m); if(r.event==="push"&&r.head_branch==="main")o.succMain.push(m); else if(r.event==="pull_request")o.succPR.push(m);}}}
const rows=Object.values(out).sort((a,b)=>a.week.localeCompare(b.week)).map(o=>({week:o.week,runs:o.runs,pr:o.pr,push:o.push,failedRuns:o.failed,successN:o.succ.length,median:q(o.succ,.5),p90:q(o.succ,.9),mainN:o.succMain.length,mainMedian:q(o.succMain,.5),mainP90:q(o.succMain,.9),prMedian:q(o.succPR,.5),prP90:q(o.succPR,.9)}));
console.table(rows);
require("fs").writeFileSync("data/weekly.json",JSON.stringify(rows,null,1));
