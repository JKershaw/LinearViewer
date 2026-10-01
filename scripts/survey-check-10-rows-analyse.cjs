// LIN-3190 (survey-check-10): from survey-check-10-rows.mjs's snapshot, the fleet's price-row mix by week, dollars per million
// weighted tokens by row and by population (the populations of data/orig/survey-protoconcepts/harbour.json, i.e. the author's
// survey-protoconcepts-harbour.mjs output), and each population's median re-priced wholly at one frontier row.
// Usage: node scripts/survey-check-10-rows-analyse.cjs <dir holding mix.json>   (writes <dir>/pops.json). No proxy calls.
const S=require('path').resolve(process.argv[2]);const mix=require(S+'/mix.json');const h=require(process.cwd()+'/data/orig/survey-protoconcepts/harbour.json');
const P=JSON.parse(require('fs').readFileSync('data/survey-protoconcepts/repos/lighthouse/harbour/prices.json','utf8')).models;
const RP={cheap:P['claude-haiku-4-5'],mid:P['claude-sonnet-5'],'frontier-old':P['claude-opus-5'],'frontier-new':P['claude-opus-5-5'],top:P['claude-fable-5-1']};
const WT={cheap:.2,mid:.6,'frontier-old':1,'frontier-new':1,top:1};
const A=mix.AGG;const add=(t,r)=>{for(const k of Object.keys(r))t[k]=(t[k]||0)+r[k];};
const fleetSK=new Set(mix.sessionRows.map(s=>s.SK));
const sum=(keys)=>{const t={};for(const k of keys)for(const [row,r] of Object.entries(A[k]||{})){t[row]||={};add(t[row],r);}return t;};
const show=(lab,t)=>{const U=Object.values(t).reduce((a,r)=>a+r.usd,0),W=Object.values(t).reduce((a,r)=>a+r.w,0);console.log(lab,'$'+U.toFixed(0),'W',(W/1e6).toFixed(0)+'M','$/Mw',(U/W*1e6).toFixed(2),Object.entries(t).sort().map(([k,r])=>`${k}: w ${(100*r.w/W).toFixed(1)}% $ ${(100*r.usd/U).toFixed(1)}% ($/Mw ${(r.usd/r.w*1e6).toFixed(2)})`).join(' | '));return {U,W};};
const fleetT=sum([...fleetSK].map(k=>'S:'+k));show('FLEET(2004)',fleetT);
for(const w of ['w0','w1','w2','w3','w4'])show('week '+w+' (fleet dirs incl. no-ticket)',sum(['W:'+w+'f']));
// components fleet in-window
const comp=(t)=>{let c={inp:0,out:0,cr:0,cw:0},cw={inp:0,out:0,cr:0,cw:0};for(const [row,r] of Object.entries(t)){const p=RP[row],w=WT[row];c.inp+=r.inp*p.input/1e6;c.out+=r.out*p.output/1e6;c.cr+=r.cr*p.cacheRead/1e6;c.cw+=(r.c5*p.cacheWrite+r.c1*p.cacheWrite1h)/1e6;cw.inp+=w*r.inp;cw.out+=w*5*r.out;cw.cr+=w*.1*r.cr;cw.cw+=w*(1.25*r.c5+2*r.c1);}const a=Object.values(c).reduce((x,y)=>x+y),b=Object.values(cw).reduce((x,y)=>x+y);return Object.keys(c).map(k=>`${k} ${(100*c[k]/a).toFixed(1)}%/${(100*cw[k]/b).toFixed(1)}%`).join(' ');};
console.log('components $/weighted fleet in window:',comp(fleetT));
// output placeholder
const o=Object.values(fleetT).reduce((a,r)=>({out:a.out+r.out,outMax:a.outMax+r.outMax,chars4:a.chars4+r.chars4}),{out:0,outMax:0,chars4:0});console.log('output tokens: first-seen',(o.out/1e6).toFixed(1)+'M','max-over-copies',(o.outMax/1e6).toFixed(1)+'M','chars/4',(o.chars4/1e6).toFixed(1)+'M');
// populations
const byIssue={};for(const s of mix.sessionRows)(byIssue[s.issue]||=[]).push(s.SK);
const q=(xs,p)=>{const a=[...xs].sort((x,y)=>x-y);const i=(a.length-1)*p;const lo=Math.floor(i);return a[lo]+(a[Math.ceil(i)]-a[lo])*(i-lo)};
const reprice=(t,f)=>{let u=0;for(const [row,r] of Object.entries(t)){const p=f(row);u+=(r.inp*p.input+r.out*p.output+r.cr*p.cacheRead+r.c5*p.cacheWrite+r.c1*p.cacheWrite1h)/1e6;}return u;};
const W=(t)=>Object.values(t).reduce((a,r)=>a+r.w,0),U=(t)=>Object.values(t).reduce((a,r)=>a+r.usd,0);
const pops={};for(const r of h.rows){pops[r.pop]||=[];pops[r.pop].push(r.id);}
const res={};
for(const [pop,ids] of Object.entries(pops)){const ts=ids.map(id=>sum((byIssue[id]||[]).map(k=>'S:'+k)));const tot={};for(const t of ts)for(const [row,r] of Object.entries(t)){tot[row]||={};add(tot[row],r);}
 const {U:u,W:w}=show(`POP ${pop} n${ids.length} pooled`,tot);
 const per=ts.map(t=>U(t)/W(t)*1e6).filter(x=>isFinite(x));
 const allFN=ts.map(t=>reprice(t,row=>row==='mid'||row==='cheap'?RP[row]:RP['frontier-new']));const allFO=ts.map(t=>reprice(t,row=>row==='mid'||row==='cheap'?RP[row]:RP['frontier-old']));
 res[pop]={medUsd:q(ts.map(U),.5),medW:q(ts.map(W),.5)/1e6,medUsdPerMw:q(per,.5),pooledUsdPerMw:u/w*1e6,medAllFN:q(allFN,.5),medAllFO:q(allFO,.5)};
 console.log('   ',JSON.stringify(res[pop],(k,v)=>typeof v==='number'?+v.toFixed(2):v));}
console.log('pipeline/lean: $',(res['pipeline paper'].medUsd/res['lean paper'].medUsd).toFixed(2),'W',(res['pipeline paper'].medW/res['lean paper'].medW).toFixed(2),'all-FN $',(res['pipeline paper'].medAllFN/res['lean paper'].medAllFN).toFixed(2),'all-FO $',(res['pipeline paper'].medAllFO/res['lean paper'].medAllFO).toFixed(2),'$/Mw med',(res['pipeline paper'].medUsdPerMw/res['lean paper'].medUsdPerMw).toFixed(2),'pooled',(res['pipeline paper'].pooledUsdPerMw/res['lean paper'].pooledUsdPerMw).toFixed(2));
require('fs').writeFileSync(S+'/pops.json',JSON.stringify(res,null,1));
