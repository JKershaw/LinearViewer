// LIN-3189: lean replay cost per role (tokens, turns, wall-clock from the replay session's subagent transcripts, tagged "[replay LIN-n role]") against each original's whole-life cost (scorecard dispatches and working hours; survey-costmix-tokens.mjs weighted tokens, charged by session entered and by child named).
// Usage: node scripts/survey-replay-cost.mjs --subagents <~/.claude/projects/<replay project>/<session>/subagents> [--selection data/survey-replay/selection.json] [--costmix data/survey-replay/costmix-tokens.json] [--scorecard data/survey/scorecard.json] [--out data/survey-replay/cost.json]
// Run survey-costmix-tokens.mjs first: node scripts/survey-costmix-tokens.mjs --since 2026-08-01 --until 2026-10-01 --out data/survey-replay/costmix-tokens.json
// Weights are survey-costmix-tokens.mjs's (frontier-input equivalents: input 1, output 5, cache read 0.1, 1h cache write 2, 5m cache
// write 1.25; frontier ×1, mid ×0.6, cheap ×0.2). Each assistant message id counts once. A role's turns are its assistant messages;
// its wall-clock runs from its first to its last transcript timestamp. The blind readers (and the swapped-order second read) are measurement, reported apart.
// An original with no transcript (August, before local retention) has no token figure, never a zero. No proxy calls.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const subDir = arg('--subagents');
if (!subDir) throw new Error('--subagents is required');
const sel = JSON.parse(readFileSync(arg('--selection', 'data/survey-replay/selection.json'), 'utf8'));
const costmix = JSON.parse(readFileSync(arg('--costmix', 'data/survey-replay/costmix-tokens.json'), 'utf8'));
const scorecard = JSON.parse(readFileSync(arg('--scorecard', 'data/survey/scorecard.json'), 'utf8'));
const out = arg('--out', 'data/survey-replay/cost.json');

const tier = (m = '') => (/opus|fable/i.test(m) ? 1 : /sonnet/i.test(m) ? 0.6 : /haiku/i.test(m) ? 0.2 : 0);
const tierName = (m = '') => (/opus|fable/i.test(m) ? 'frontier' : /sonnet/i.test(m) ? 'mid' : /haiku/i.test(m) ? 'cheap' : 'other');
const unitsOf = (u, m) => { const w = tier(m); const c1 = u.cache_creation?.ephemeral_1h_input_tokens ?? 0; const c5 = (u.cache_creation_input_tokens || 0) - c1; return w * ((u.input_tokens || 0) + 5 * (u.output_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 2 * c1 + 1.25 * c5); };

const roles = [];
for (const f of readdirSync(subDir).filter((x) => x.endsWith('.jsonl'))) {
  const lines = readFileSync(join(subDir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const first = lines.find((e) => e.type === 'user');
  const c = first?.message?.content;
  const text = typeof c === 'string' ? c : (c || []).map((x) => x.text || '').join('');
  const m = text.match(/^\[replay (LIN-\d+) (implementer|reviewer|close-out|blind2?)\]/);
  if (!m) continue;
  const seen = new Set(); let units = 0, raw = 0, output = 0, turns = 0; const models = new Set(); let t0 = null, t1 = null;
  for (const e of lines) {
    if (e.timestamp) { t0 ??= e.timestamp; t1 = e.timestamp; }
    if (e.type !== 'assistant' || !e.message?.usage || seen.has(e.message.id)) continue;
    seen.add(e.message.id); turns++;
    const u = e.message.usage; models.add(tierName(e.message.model));
    units += unitsOf(u, e.message.model);
    raw += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    output += u.output_tokens || 0;
  }
  roles.push({ id: m[1], role: m[2], file: f, tiers: [...models], units: Math.round(units), rawTokens: raw, outputTokens: output, turns, wallS: (Date.parse(t1) - Date.parse(t0)) / 1000 });
}

// The original implementer's tier, read from its implementation sessions' own transcripts (pre-registration: report any mismatch).
const projects = arg('--projects', join(process.env.HOME, '.claude', 'projects'));
function implTiers(id) {
  const tiers = new Set();
  for (const s of costmix.sessionRows.filter((r) => r.issue === id && r.kind === 'implementation')) {
    const f = join(projects, `-Users-work-development-simple-dispatcher-workspaces-${s.ws}`, `${s.ws}.jsonl`);
    let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of txt.matchAll(/"model":"([^"]+)"/g)) if (m[1] !== '<synthetic>') tiers.add(tierName(m[1]));
  }
  return [...tiers];
}

const changes = new Map(scorecard.changes.map((c) => [c.id, c]));
const rows = sel.selected.map((s) => {
  const mine = roles.filter((r) => r.id === s.id && !r.role.startsWith('blind'));
  const lean = { roles: mine.length, units: mine.reduce((a, r) => a + r.units, 0), rawTokens: mine.reduce((a, r) => a + r.rawTokens, 0), turns: mine.reduce((a, r) => a + r.turns, 0), wallH: mine.reduce((a, r) => a + r.wallS, 0) / 3600 };
  const c = changes.get(s.id);
  const hasTx = s.transcripts > 0 && s.transcripts === s.sessions;
  const orig = {
    dispatches: c.dispatches, workH: c.workH,
    unitsBySession: hasTx ? Math.round(costmix.bySession[s.id] ?? 0) : null,
    unitsByChild: hasTx ? Math.round(costmix.byChild[s.id] ?? 0) : null,
    byKind: hasTx ? costmix.kindByTicket[s.id] ?? null : null,
    transcripts: `${s.transcripts}/${s.sessions}`,
    implementerTiers: hasTx ? implTiers(s.id) : null,
  };
  const r = (a, b) => (a != null && b ? +(a / b).toFixed(3) : null);
  return { id: s.id, repo: s.repo, stratum: s.stratum, lean, roleRows: mine, original: orig,
    ratio: { tokensBySession: r(lean.units, orig.unitsBySession), tokensByChild: r(lean.units, orig.unitsByChild), hours: r(lean.wallH, orig.workH), dispatches: r(mine.length, orig.dispatches) } };
});
const blind = roles.filter((r) => r.role.startsWith('blind'));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), rows, blind }, null, 1));
const fmt = (x) => (x == null ? '–' : x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(0) + 'k' : String(x));
console.log('id\trepo\tstratum\troles\tlean units\tturns\tlean h\torig sess\torig child\tdisp\tworkH\tratio sess\tratio child\tratio h');
for (const x of rows) console.log([x.id, x.repo === 'LinearViewer' ? 'Harbour' : 'runner', x.stratum, x.lean.roles, fmt(x.lean.units), x.lean.turns, x.lean.wallH.toFixed(3), fmt(x.original.unitsBySession), fmt(x.original.unitsByChild), x.original.dispatches ?? '–', x.original.workH ?? '–', x.ratio.tokensBySession ?? '–', x.ratio.tokensByChild ?? '–', x.ratio.hours ?? '–'].join('\t'));
console.log(`blind reads: ${blind.length}, units ${fmt(blind.reduce((a, r) => a + r.units, 0))}`);
