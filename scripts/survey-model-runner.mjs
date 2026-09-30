// LIN-3165: every fleet dispatch's model tier, harness, ticket and working hours, from simple-dispatcher's run logs and oplog, into a git-ignored snapshot.
// Usage: node scripts/survey-model-runner.mjs [sdStateDir=~/development/simple-dispatcher/state] [--out data/survey-model/runner.json]
// A dispatch is a "Found dispatch item" block (first sighting per item id). Its tier comes from the block's "Model (payload)" line:
// frontier (opus, fable), mid (sonnet), cheap (haiku and every OpenRouter model seen), unstated (no model line: the harness default,
// which before simple-dispatcher's LIN-1285 of 12 July was the only thing claude-code sessions ever ran at). Its session is the one
// the block claims or resumes; working hours are that session's SUMMARIZING/RESUMING/EXECUTING intervals in the oplog (each capped
// at 2 h, as survey-scorecard.mjs does), shared equally among the dispatches that ran in it. Dated by the oplog where it covers the
// item (from 12 July), else by position within the log file.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const dir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out') || join(homedir(), 'development/simple-dispatcher/state');
const out = arg('--out', 'data/survey-model/runner.json');
const CAP_H = 2;

export const tierOfPayload = (m) => (!m ? 'unstated' : /opus|fable/i.test(m) ? 'frontier' : /sonnet/i.test(m) ? 'mid' : 'cheap');

// Oplog: first-seen time per item, and working hours per session (8-char session prefix).
const itemTs = new Map(); const sess = new Map(); const workH = new Map();
const WORK = new Set(['SUMMARIZING', 'RESUMING', 'EXECUTING']);
for (const line of readFileSync(join(dir, 'oplog.jsonl'), 'utf8').split('\n')) {
  if (!line) continue;
  let o; try { o = JSON.parse(line); } catch { continue; }
  if (o.item && !itemTs.has(o.item)) itemTs.set(o.item, o.ts);
  let phase = null;
  if (o.event === 'state.session_added') phase = o.fields?.phase;
  else if (o.event === 'state.change' && o.changed?.phase) phase = o.changed.phase[1];
  else if (o.event === 'state.session_removed') phase = 'REMOVED';
  if (!phase || !o.session) continue;
  const t = Date.parse(o.ts); const s = sess.get(o.session);
  if (s && WORK.has(s.phase)) workH.set(o.session, (workH.get(o.session) || 0) + Math.min((t - s.last) / 36e5, CAP_H));
  sess.set(o.session, { phase, last: t });
}

const logs = readdirSync(dir).filter((f) => /^dispatcher(\.run-.*)?\.log$/.test(f)).map((f) => {
  const m = f.match(/(\d{8})-(\d{6})\.log$/);
  const end = statSync(join(dir, f)).mtime;
  const start = m ? new Date(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4)}`) : end;
  return { f, start, end };
}).sort((a, b) => a.start - b.start);

const items = new Map();
for (const { f, start, end } of logs) {
  const lines = readFileSync(join(dir, f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    const m = l.match(/^Found dispatch item: ([0-9a-f-]{36})/);
    if (!m || items.has(m[1])) return;
    const block = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 14) && !/^Found dispatch item/.test(lines[j]); j++) block.push(lines[j]);
    const field = (k) => (block.find((b) => b.startsWith(`  ${k}: `)) || '').slice(k.length + 4) || null;
    const model = field('Model (payload)'); const harness = field('Harness (payload)') || 'claude-code';
    const issue = (field('Issue') || '').match(/\b[A-Z]+-\d+\b/)?.[0] || null;
    const text = block.join('\n');
    const session = (text.match(/creating session: ([0-9a-f]{8})/) || text.match(/Resuming session ([0-9a-f]{8})/) || [])[1] || null;
    const shape = /\[follow-up\]/.test(text) ? 'followUp' : /Claimed item/.test(text) ? 'launch' : 'other';
    const est = new Date(start.getTime() + (end - start) * (i / Math.max(1, lines.length)));
    items.set(m[1], { item: m[1], ws: (field('Workspace') || '').toLowerCase(), issue, model, tier: tierOfPayload(model), harness, shape, session, at: itemTs.get(m[1]) || est.toISOString(), dated: itemTs.has(m[1]) ? 'oplog' : 'log' });
  });
}

// A follow-up beat resumes a held session and carries no model line of its own: it runs at the tier its session launched at.
const launchTier = new Map();
for (const it of [...items.values()].sort((a, b) => a.at.localeCompare(b.at))) if (it.session && it.shape === 'launch' && !launchTier.has(it.session)) launchTier.set(it.session, it);
for (const it of items.values()) if (it.tier === 'unstated' && it.shape !== 'launch' && launchTier.has(it.session)) { const l = launchTier.get(it.session); Object.assign(it, { tier: l.tier, model: l.model, harness: l.harness, inherited: true }); }

// Share each session's working hours among the dispatches that ran in it.
const perSession = new Map();
for (const it of items.values()) if (it.session) perSession.set(it.session, (perSession.get(it.session) || 0) + 1);
for (const it of items.values()) it.workH = it.session && workH.has(it.session) ? +(workH.get(it.session) / perSession.get(it.session)).toFixed(3) : null;

const rows = [...items.values()].sort((a, b) => a.at.localeCompare(b.at));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), logs: logs.length, oplogFrom: [...itemTs.values()][0], rows }));
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
console.log(`dispatches=${rows.length}`, by('tier'), by('harness'), by('shape'), 'timed', rows.filter((r) => r.workH != null).length);
