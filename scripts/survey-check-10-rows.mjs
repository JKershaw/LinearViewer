// LIN-3190 (survey-check-10): survey-protoconcepts-dollars.mjs's census unchanged, with each priced message also tallied by the
// price row it was priced at (cheap, mid, frontier-old, frontier-new, top; ROW below), per session ('S:<workspace>/<file>') and
// per week of September ('W:w0'..'W:w4', fleet or other directories). Used to test prototype-concepts.md's reading of dollars
// against weighted tokens: whether the gap between populations is the work's shape or which frontier price row it ran on.
// Usage: node scripts/survey-check-10-rows.mjs --out data/survey-check-10/mix.json   (then survey-check-10-rows-analyse.cjs)
// Same arguments and defaults as survey-protoconcepts-dollars.mjs (--since, --until, --prices, --projects, --state). No proxy calls.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = Date.parse(arg('--since', '2026-09-01') + 'T00:00:00Z');
const day = (v) => Date.parse(v.includes('T') ? v : v + 'T00:00:00Z');
const until = day(arg('--until', '2026-10-01T10:00:00Z'));
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const out = arg('--out', 'data/survey-protoconcepts/dollars.json');
const PRICES = JSON.parse(readFileSync(arg('--prices', 'data/survey-protoconcepts/repos/lighthouse/harbour/prices.json'), 'utf8')).models;
const state = arg('--state', join(homedir(), 'development', 'simple-dispatcher', 'state'));

// Last resort for a session with neither a header nor a fetched item: the run log line that created it (survey-proportional-tokens.mjs's rule).
const logIssue = new Map();
for (const f of readdirSync(state).filter((x) => /^dispatcher(\.run-\d{8}-\d{6})?\.log$/.test(x)).sort()) {
  let issue = null;
  for (const line of readFileSync(join(state, f), 'utf8').split('\n')) {
    let m;
    if (/^Found dispatch item: /.test(line)) { issue = null; continue; }
    if ((m = line.match(/^\s+Issue: (LIN-\d+)/))) { issue = m[1]; continue; }
    if ((m = line.match(/^Claimed item .*creating session: ([0-9a-f-]{36})/)) && issue) logIssue.set(m[1], issue);
  }
}

// Models with no row are priced at the nearest row of the same tier: the newer mid-tier model at the older mid row, the older
// top-priced and frontier models at their successors' and predecessors' rows. Synthetic messages carry no usage.
const ALIAS = { 'claude-sonnet-5-5': 'claude-sonnet-5', 'claude-fable-5': 'claude-fable-5-1', 'claude-opus-4-8': 'claude-opus-5' };
const unpriced = {};
// Fleet-wide components, in dollars and in survey-costmix-tokens.mjs's weighted units, to show where the two prices differ.
const parts = { usd: {}, weighted: {} };
const WT = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const part = (k, usd, w) => { parts.usd[k] = (parts.usd[k] || 0) + usd; parts.weighted[k] = (parts.weighted[k] || 0) + w; };
const ROW={'claude-haiku-4-5':'cheap','claude-sonnet-5':'mid','claude-opus-5':'frontier-old','claude-opus-5-5':'frontier-new','claude-fable-5-1':'top'};
const AGG={};globalThis.AGG=AGG;let CUR=null;globalThis.setCur=(x)=>{CUR=x};
const rec=(key,row,f)=>{const a=(AGG[key]||={});const r=(a[row]||={usd:0,w:0,inp:0,out:0,cr:0,c5:0,c1:0,outMax:0,chars4:0});f(r);};
const unitsOf = (u, m = '') => {
  const id = m.replace(/-\d{8}$/, ''); const p = PRICES[id] || PRICES[ALIAS[id]];
  if (!p) { if (id === '<synthetic>') return 0; unpriced[id || '?'] = (unpriced[id || '?'] || 0) + 1; return 0; }
  const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1;
  const w = WT(m);
  part('input', (u.input_tokens || 0) * p.input / 1e6, w * (u.input_tokens || 0)); part('output', (u.output_tokens || 0) * p.output / 1e6, w * 5 * (u.output_tokens || 0));
  part('cacheRead', (u.cache_read_input_tokens || 0) * p.cacheRead / 1e6, w * 0.1 * (u.cache_read_input_tokens || 0)); part('cacheWrite', (c5 * p.cacheWrite + c1 * p.cacheWrite1h) / 1e6, w * (1.25 * c5 + 2 * c1));
  if(CUR){const row=ROW[PRICES[id]?id:ALIAS[id]];const usd=((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output + (u.cache_read_input_tokens || 0) * p.cacheRead + c5 * p.cacheWrite + c1 * p.cacheWrite1h) / 1e6;const wu=w*((u.input_tokens||0)+5*(u.output_tokens||0)+0.1*(u.cache_read_input_tokens||0)+1.25*c5+2*c1);for(const key of CUR.keys)rec(key,row,(r)=>{r.usd+=usd;r.w+=wu;r.inp+=u.input_tokens||0;r.out+=u.output_tokens||0;r.cr+=u.cache_read_input_tokens||0;r.c5+=c5;r.c1+=c1;r.outMax+=CUR.outMax||0;r.chars4+=CUR.chars4||0;});}
  return ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output + (u.cache_read_input_tokens || 0) * p.cacheRead + c5 * p.cacheWrite + c1 * p.cacheWrite1h) / 1e6;
};
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x.text === 'string' ? x.text : typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y.text || '').join('\n') : '')).join('\n') : '');
const ITEM_RE = /"promptName"\s*:\s*(?:null|"[^"]*")\s*,\s*"kind"\s*:\s*(null|"[^"]*")\s*,\s*"issueIdentifier"\s*:\s*(null|"[A-Z]+-\d+")/g;

const PRE=(txt)=>{const mp=new Map();for(const line of txt.split('\n')){if(!line.includes('"assistant"'))continue;let e;try{e=JSON.parse(line)}catch{continue}const m=e.message;if(e.type!=='assistant'||!m?.usage)continue;const r=mp.get(m.id)||{outMax:0,chars:0};r.outMax=Math.max(r.outMax,m.usage.output_tokens||0);for(const b of m.content||[]){if(b.type==='text')r.chars+=(b.text||'').length;else if(b.type==='thinking')r.chars+=(b.thinking||'').length;else if(b.type==='tool_use')r.chars+=JSON.stringify(b.input||{}).length;}mp.set(m.id,r);}return mp;};
const wk=(t)=>{const d=new Date(t);const day=Math.floor((t-Date.parse('2026-09-01T00:00:00Z'))/864e5);return 'w'+Math.floor(day/7);};
const sessions = []; let otherUnits = 0; let otherSessions = 0; let fleetUnmapped = 0; const unmapped = {};
for (const d of readdirSync(root)) {
  const fleet = d.includes('simple-dispatcher-workspaces');
  const dir = join(root, d); let files; try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of files) {
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const s = { ws: d.slice(-36), file: f.slice(0, 8), issue: null, kind: null, runner: false, stepper: false, units: 0, byChild: {}, byKind: {}, first: null, last: null };
    const timeline = []; // [t, child ticket, item kind] from the main transcript
    const seen = new Set();
    const main = readFileSync(p, 'utf8'); const PM=PRE(main); const SK=d.slice(-36)+'/'+f;
    s.runner = /You're \*{0,2}flying\*{0,2} a passage/.test(main); s.stepper = /You're running as the STEPPER/.test(main);
    const add = (t, units, child, kind) => {
      if (!(t >= since && t < until) || !units) return;
      s.units += units; s.byChild[child || s.issue || '?'] = (s.byChild[child || s.issue || '?'] || 0) + units;
      s.byKind[kind || s.kind || '?'] = (s.byKind[kind || s.kind || '?'] || 0) + units;
      s.first = Math.min(s.first ?? t, t); s.last = Math.max(s.last ?? t, t);
    };
    let child = null; let childKind = null;
    for (const line of main.split('\n')) {
      if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
      const m = e.message; if (!m) continue; const t = Date.parse(e.timestamp);
      if (e.type === 'user') {
        const c = textOf(m.content); if (!c) continue;
        if (!s.issue) { const h = c.match(/# (LIN-\d+) · ([\w-]+)/); if (h) { s.issue = h[1]; s.kind = h[2]; child = h[1]; childKind = h[2]; timeline.push([t, child, childKind]); } }
        if (c.includes('"promptName"')) for (const x of c.matchAll(ITEM_RE)) {
          const k = JSON.parse(x[1]); const iss = JSON.parse(x[2]);
          if (iss) { child = iss; childKind = k; timeline.push([t, iss, k]); }
          if (!s.issue && iss) { s.issue = iss; s.kind = k; } // a launch with no "# LIN-n · kind" header: the first item it fetched
          s.promptName ??= x[0].match(/"promptName"\s*:\s*"([^"]*)"/)?.[1] || null;
          if (s.kind === 'custom' && k && timeline.length <= 2) s.kind = k;
        }
      } else if (e.type === 'assistant' && m.usage && !seen.has(m.id)) { seen.add(m.id); const pm=PM.get(m.id)||{}; setCur(t>=since&&t<until?{keys:['S:'+SK,'W:'+wk(t)+(fleet?'f':'o')],outMax:pm.outMax,chars4:Math.ceil((pm.chars||0)/4)}:null); add(t, unitsOf(m.usage, m.model), child, childKind); setCur(null); }
    }
    const sub = join(dir, f.replace('.jsonl', ''), 'subagents');
    if (existsSync(sub)) for (const sf of readdirSync(sub)) {
      if (!sf.endsWith('.jsonl')) continue;
      const stxt=readFileSync(join(sub, sf), 'utf8'); const SP=PRE(stxt);
      for (const line of stxt.split('\n')) {
        if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== 'assistant' || !e.message?.usage || seen.has(e.message.id)) continue; seen.add(e.message.id);
        const t = Date.parse(e.timestamp); let at = [null, s.issue, s.kind]; for (const x of timeline) { if (x[0] <= t) at = x; else break; }
        const pm=SP.get(e.message.id)||{}; setCur(t>=since&&t<until?{keys:['S:'+SK,'W:'+wk(t)+(fleet?'f':'o')],outMax:pm.outMax,chars4:Math.ceil((pm.chars||0)/4)}:null); add(t, unitsOf(e.message.usage, e.message.model), at[1], at[2]); setCur(null);
      }
    }
    if (!s.units) continue;
    if (!fleet) { otherUnits += s.units; otherSessions++; continue; }
    if (!s.issue && logIssue.has(f.replace('.jsonl', ''))) { s.issue = logIssue.get(f.replace('.jsonl', '')); s.kind = 'unknown'; for (const k of Object.keys(s.byChild)) if (k === '?') { s.byChild[s.issue] = s.byChild['?']; delete s.byChild['?']; } }
    if (!s.issue) { fleetUnmapped += s.units; const k = s.promptName || 'no item fetched'; unmapped[k] = (unmapped[k] || 0) + s.units; continue; }
    s.SK=SK; sessions.push(s);
  }
}

const bySession = {}; const byChild = {}; const kindByTicket = {};
for (const s of sessions) {
  bySession[s.issue] = (bySession[s.issue] || 0) + s.units;
  for (const [k, v] of Object.entries(s.byChild)) byChild[k] = (byChild[k] || 0) + v;
  const layer = s.kind === 'autopilot' ? (s.runner ? 'Runner' : s.stepper ? 'stepper' : 'autopilot') : s.kind;
  const kt = (kindByTicket[s.issue] ||= {}); kt[layer] = (kt[layer] || 0) + s.units;
}
const fleetUnits = sessions.reduce((a, s) => a + s.units, 0);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ since: new Date(since).toISOString(), until: new Date(until).toISOString(), generatedAt: new Date().toISOString(), unit: 'USD at list price', fleetUnits, fleetUnmapped, otherUnits, unpriced, parts, sessions: sessions.length, bySession, byChild, sessionRows: sessions.map(({ byChild: _, byKind: __, ...r }) => r), AGG }));
const tot = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log('share by component, dollars against weighted units (all transcripts read, inside and outside the window):', Object.fromEntries(Object.keys(parts.usd).map((k) => [k, `${(100 * parts.usd[k] / tot(parts.usd)).toFixed(1)}% / ${(100 * parts.weighted[k] / tot(parts.weighted)).toFixed(1)}%`])));
console.log(`fleet sessions=${sessions.length} $${fleetUnits.toFixed(0)} (+$${fleetUnmapped.toFixed(0)} in fleet sessions with no ticket); unpriced messages: ${JSON.stringify(unpriced)}`);
