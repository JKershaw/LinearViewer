// LIN-3187: list-price dollars per ticket from every local transcript, priced by Lighthouse's own prices.json, so a Harbour ticket and a Lighthouse study are priced alike.
// Usage: node scripts/survey-protoconcepts-dollars.mjs [--since 2026-09-01] [--until 2026-10-01T10:00:00Z] [--prices data/survey-protoconcepts/repos/lighthouse/harbour/prices.json] [--out data/survey-protoconcepts/dollars.json]
// survey-costmix-tokens.mjs's census unchanged (sessions, subagents, message-id de-duplication, both charging rules), with each
// message priced in dollars instead of weighted: input, output, cache read, 5-minute and 1-hour cache writes at the model's own
// row of Lighthouse's price table (JKershaw/lighthouse@7828bb8, read 26 Sep 2026); three models with no row are aliased below,
// an assumption stated in the paper. A model with no row is priced 0
// and its messages counted in unpriced. Output tokens are the transcript's own figure (Lighthouse estimates them from characters).
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
const unitsOf = (u, m = '') => {
  const id = m.replace(/-\d{8}$/, ''); const p = PRICES[id] || PRICES[ALIAS[id]];
  if (!p) { if (id === '<synthetic>') return 0; unpriced[id || '?'] = (unpriced[id || '?'] || 0) + 1; return 0; }
  const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1;
  const w = WT(m);
  part('input', (u.input_tokens || 0) * p.input / 1e6, w * (u.input_tokens || 0)); part('output', (u.output_tokens || 0) * p.output / 1e6, w * 5 * (u.output_tokens || 0));
  part('cacheRead', (u.cache_read_input_tokens || 0) * p.cacheRead / 1e6, w * 0.1 * (u.cache_read_input_tokens || 0)); part('cacheWrite', (c5 * p.cacheWrite + c1 * p.cacheWrite1h) / 1e6, w * (1.25 * c5 + 2 * c1));
  return ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output + (u.cache_read_input_tokens || 0) * p.cacheRead + c5 * p.cacheWrite + c1 * p.cacheWrite1h) / 1e6;
};
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x.text === 'string' ? x.text : typeof x.content === 'string' ? x.content : Array.isArray(x.content) ? x.content.map((y) => y.text || '').join('\n') : '')).join('\n') : '');
const ITEM_RE = /"promptName"\s*:\s*(?:null|"[^"]*")\s*,\s*"kind"\s*:\s*(null|"[^"]*")\s*,\s*"issueIdentifier"\s*:\s*(null|"[A-Z]+-\d+")/g;

const sessions = []; let otherUnits = 0; let otherSessions = 0; let fleetUnmapped = 0; const unmapped = {};
for (const d of readdirSync(root)) {
  const fleet = d.includes('simple-dispatcher-workspaces');
  const dir = join(root, d); let files; try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
  for (const f of files) {
    const p = join(dir, f); if (statSync(p).mtimeMs < since) continue;
    const s = { ws: d.slice(-36), file: f.slice(0, 8), issue: null, kind: null, runner: false, stepper: false, units: 0, byChild: {}, byKind: {}, first: null, last: null };
    const timeline = []; // [t, child ticket, item kind] from the main transcript
    const seen = new Set();
    const main = readFileSync(p, 'utf8');
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
      } else if (e.type === 'assistant' && m.usage && !seen.has(m.id)) { seen.add(m.id); add(t, unitsOf(m.usage, m.model), child, childKind); }
    }
    const sub = join(dir, f.replace('.jsonl', ''), 'subagents');
    if (existsSync(sub)) for (const sf of readdirSync(sub)) {
      if (!sf.endsWith('.jsonl')) continue;
      for (const line of readFileSync(join(sub, sf), 'utf8').split('\n')) {
        if (!line) continue; let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type !== 'assistant' || !e.message?.usage || seen.has(e.message.id)) continue; seen.add(e.message.id);
        const t = Date.parse(e.timestamp); let at = [null, s.issue, s.kind]; for (const x of timeline) { if (x[0] <= t) at = x; else break; }
        add(t, unitsOf(e.message.usage, e.message.model), at[1], at[2]);
      }
    }
    if (!s.units) continue;
    if (!fleet) { otherUnits += s.units; otherSessions++; continue; }
    if (!s.issue && logIssue.has(f.replace('.jsonl', ''))) { s.issue = logIssue.get(f.replace('.jsonl', '')); s.kind = 'unknown'; for (const k of Object.keys(s.byChild)) if (k === '?') { s.byChild[s.issue] = s.byChild['?']; delete s.byChild['?']; } }
    if (!s.issue) { fleetUnmapped += s.units; const k = s.promptName || 'no item fetched'; unmapped[k] = (unmapped[k] || 0) + s.units; continue; }
    sessions.push(s);
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
writeFileSync(out, JSON.stringify({ since: new Date(since).toISOString(), until: new Date(until).toISOString(), generatedAt: new Date().toISOString(), unit: 'USD at list price', fleetUnits, fleetUnmapped, otherUnits, unpriced, parts, sessions: sessions.length, bySession, byChild, sessionRows: sessions.map(({ byChild: _, byKind: __, ...r }) => r) }));
const tot = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log('share by component, dollars against weighted units (all transcripts read, inside and outside the window):', Object.fromEntries(Object.keys(parts.usd).map((k) => [k, `${(100 * parts.usd[k] / tot(parts.usd)).toFixed(1)}% / ${(100 * parts.weighted[k] / tot(parts.weighted)).toFixed(1)}%`])));
console.log(`fleet sessions=${sessions.length} $${fleetUnits.toFixed(0)} (+$${fleetUnmapped.toFixed(0)} in fleet sessions with no ticket); unpriced messages: ${JSON.stringify(unpriced)}`);
