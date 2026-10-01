// LIN-3174: every plan, plan-review, review and close-out leg (a fresh session of that kind) on Done tickets since 1 August, both repos, marked first or repeat of its kind on the ticket, with the follow-ups into it, its tokens and hours, into a git-ignored snapshot.
// Usage: node scripts/survey-repeats-census.mjs [--since 2026-08-01] [--cut 2026-09-30T20:00:00Z] [--out data/survey-repeats/census.json]
// Run first: survey-doubling-runner.mjs, survey-doubling-transcripts.mjs (both into data/survey-doubling/), survey-model-git.mjs
// --since 2026-05-01 --out data/survey-doubling/git.json, survey-repeats-fetch.mjs (the ticket list), and a same-day
// data/survey/scorecard.json from survey-scorecard.mjs (correct and complete verdicts). No proxy calls.
// A leg's kind is survey-doubling-analyse.mjs's (copied: importing that script runs it): exact where a local transcript fetched the
// item (29 Aug on), otherwise decoded from the bootstrap prompt's length. A leg is on the ticket its own Issue line names. It is a
// repeat when an earlier fresh session of the same kind ran on the same ticket at any date. A leg's dispatches are the fresh launch
// plus every follow-up whose root it is. The repo is the repo whose origin/main merges name the ticket (survey-model-git.mjs).
// Tokens (input + output + cache write + cache read, each API message once) and hours (first to last transcript line) come from the
// leg's Claude transcript, so they exist for September's Claude Code legs only.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const since = arg('--since', '2026-08-01');
const cut = arg('--cut', '2026-09-30T20:00:00Z');
const out = arg('--out', 'data/survey-repeats/census.json');
const projects = arg('--projects', join(homedir(), '.claude/projects'));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const runner = read('data/survey-doubling/runner.json');
const tx = read('data/survey-doubling/transcripts.json');
const git = read('data/survey-doubling/git.json');
const proxy = read('data/survey-repeats/proxy.json');
const score = new Map(read('data/survey/scorecard.json').changes.map((c) => [c.id, c]));
const monday = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const tally = (xs, f) => { const m = {}; for (const x of xs) { const k = f(x); m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };

// ---- Classification, as survey-doubling-analyse.mjs does it.
const WORK = new Set(['fresh', 'cold', 'warm']);
const items = runner.rows.filter((r) => WORK.has(r.shape) && r.at <= cut);
const byId = new Map(items.map((r) => [r.item, r]));
const exact = tx.items;
const takesFollowUp = new Set(items.filter((r) => r.shape !== 'fresh').map((r) => r.root));
const LEN = { 3: 'bug', 4: 'plan', 6: 'review', 7: 'blocked', 8: 'research', 9: 'autopilot|close-out', 11: 'plan-review', 14: 'implementation' };
function decode(r) {
  if (r.promptLen == null || r.promptLen > 2000) return null;
  const res = r.promptLen - (r.issueLine ? r.issueLine.length : 0);
  if (!r.issueLine) return res === 385 ? 'other' : null;
  for (const base of [524, 392, 292]) {
    const k = LEN[res - base]; if (!k) continue;
    if (base === 524 && !['plan', 'research', 'implementation'].includes(k)) continue;
    return k === 'autopilot|close-out' ? (takesFollowUp.has(r.item) ? 'autopilot' : 'close-out') : k;
  }
  return null;
}
const PHASES = ['research', 'plan', 'plan-review', 'implementation', 'review', 'close-out'];
const LEGS = ['plan', 'plan-review', 'review', 'close-out'];
for (const r of items) if (r.shape === 'fresh') {
  const e = exact[r.item]?.kind;
  let k = e || decode(r) || (r.harness === 'opencode' ? 'cheap harness, kind unread' : 'kind unread');
  if (k === 'implement') k = 'implementation';
  r.kind = k; r.kindHow = e ? 'exact' : decode(r) ? 'decoded' : 'none';
}
const tierOf = (m, h) => (h === 'opencode' ? 'cheap' : /opus|fable/i.test(m || '') ? 'frontier' : /sonnet/i.test(m || '') ? 'mid' : /haiku/i.test(m || '') ? 'cheap' : 'unknown');

// ---- Tokens and hours per Claude session, from its transcript files.
const sessionFiles = new Map();
for (const s of tx.sessions) (sessionFiles.get(s.ws) || sessionFiles.set(s.ws, new Set()).get(s.ws)).add(s.file);
const txCache = new Map();
function sessionUse(session) {
  if (txCache.has(session)) return txCache.get(session);
  const files = sessionFiles.get(session); let res = null;
  if (files) {
    const seen = new Set(); let tokens = 0, output = 0, first = null, last = null;
    for (const f of files) {
      const p = join(projects, `-Users-work-development-simple-dispatcher-workspaces-${session}`, `${f}.jsonl`); if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.timestamp) { if (!first || o.timestamp < first) first = o.timestamp; if (!last || o.timestamp > last) last = o.timestamp; }
        const m = o.message; if (!m?.usage || !m.id || seen.has(m.id)) continue; seen.add(m.id);
        const u = m.usage; tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); output += u.output_tokens || 0;
      }
    }
    if (first) res = { tokens, output, hours: (new Date(last) - new Date(first)) / 36e5 };
  }
  txCache.set(session, res); return res;
}

// ---- Tickets.
const state = new Map(proxy.list.map((t) => [t.identifier, t]));
const gitById = new Map(git.rows.map((g) => [g.id, g]));
const repoOf = (id) => { const g = gitById.get(id); if (!g) return 'no merge'; return g.repos.length > 1 ? 'both' : g.repos[0] === 'LinearViewer' ? 'LinearViewer' : 'simple-dispatcher'; };
const followUps = new Map(); for (const r of items) if (r.shape !== 'fresh') (followUps.get(r.root) || followUps.set(r.root, []).get(r.root)).push(r);
const legsByTicket = new Map();
for (const r of items) if (r.shape === 'fresh' && PHASES.includes(r.kind) && r.issueLine) (legsByTicket.get(r.issueLine) || legsByTicket.set(r.issueLine, []).get(r.issueLine)).push(r);

const legs = []; const tickets = [];
for (const [id, ls] of legsByTicket) {
  if (state.get(id)?.state !== 'Done') continue;
  ls.sort((a, b) => a.at.localeCompare(b.at));
  const ord = {}; const inWindow = [];
  for (const r of ls) {
    ord[r.kind] = (ord[r.kind] || 0) + 1;
    const prev = ls.filter((x) => x.kind === r.kind && x.at < r.at).at(-1);
    if (!LEGS.includes(r.kind) || r.at < since) continue;
    const fu = followUps.get(r.item) || [];
    const use = r.harness === 'opencode' ? null : sessionUse(r.session);
    const leg = { item: r.item, issue: id, kind: r.kind, kindHow: r.kindHow, round: ord[r.kind], repeat: ord[r.kind] > 1, at: r.at, week: monday(r.at), session: r.session, prevItem: prev?.item || null, prevAt: prev?.at || null, tier: tierOf(r.launchModel || r.model, r.harness), harness: r.harness || null, dispatches: 1 + fu.length, followUps: fu.length, tokens: use?.tokens ?? null, output: use?.output ?? null, hours: use?.hours ?? null, repo: repoOf(id) };
    legs.push(leg); inWindow.push(leg);
  }
  if (!inWindow.length) continue;
  const g = gitById.get(id); const impl = ls.find((x) => x.kind === 'implementation');
  const rounds = {}; for (const k of PHASES) rounds[k] = ls.filter((x) => x.kind === k).length;
  tickets.push({ issue: id, repo: repoOf(id), rounds, firstLeg: ls[0].at, prodLines: g?.prodLines ?? null, testLines: g?.testLines ?? null, area: g?.area ?? null, risk: g?.risk ?? null, writerTier: g?.writerTier ?? null, implTier: impl ? tierOf(impl.launchModel || impl.model, impl.harness) : null, parent: state.get(id)?.parent || null, labels: state.get(id)?.labels || [], timeline: ls.map((x) => [x.at, x.kind, x.item.slice(0, 8)]) });
}

// ---- September's dispatches per correct change (survey-doubling-analyse.mjs's population), and the repeats' part in it.
const WORKKIND = new Map(items.map((r) => [r.item, r]));
const perIssue = new Map(); for (const r of items) if (r.issue) (perIssue.get(r.issue) || perIssue.set(r.issue, []).get(r.issue)).push(r);
const isRunner = (s) => s.runner && s.header === 'autopilot';
const passageEpics = new Set(tx.sessions.filter((s) => isRunner(s) && s.headerIssue).map((s) => s.headerIssue));
const sept = git.rows.filter((g) => g.lastMerge >= '2026-06-01').map((g) => ({ g, week: monday(g.lastMerge), ds: perIssue.get(g.id) || [], sc: score.get(g.id) }))
  .filter((c) => c.sc && c.ds.length && !passageEpics.has(c.g.id) && c.g.prodLines > 0 && c.week >= '2026-08-31' && c.week < '2026-09-29');
const septGood = sept.filter((c) => c.sc.good).length;
const septDs = sept.flatMap((c) => c.ds);
const ordinal = new Map(); // item -> {kind, round} over every fresh leg of the ticket its Issue line names
for (const [, ls] of legsByTicket) { const o = {}; for (const r of [...ls].sort((a, b) => a.at.localeCompare(b.at))) { o[r.kind] = (o[r.kind] || 0) + 1; ordinal.set(r.item, { kind: r.kind, round: o[r.kind] }); } }
const legOf = (d) => ordinal.get(d.shape === 'fresh' ? d.item : d.root);
const inRepeat = (d) => { const o = legOf(d); return o && LEGS.includes(o.kind) && o.round > 1; };
const inFirst = (d) => { const o = legOf(d); return o && LEGS.includes(o.kind) && o.round === 1; };
const septSessions = new Map(); for (const d of septDs) if (d.shape === 'fresh' && d.harness !== 'opencode' && d.session) septSessions.set(d.item, d);
let tokAll = 0, tokRep = 0, hAll = 0, hRep = 0, withTx = 0;
for (const [, d] of septSessions) { const u = sessionUse(d.session); if (!u) continue; withTx++; tokAll += u.tokens; hAll += u.hours; if (inRepeat(d)) { tokRep += u.tokens; hRep += u.hours; } }
const septSplit = {
  changes: sept.length, good: septGood, dispatches: septDs.length, perGood: +(septDs.length / septGood).toFixed(1),
  inRepeatLegs: septDs.filter(inRepeat).length, inFirstLegs: septDs.filter(inFirst).length,
  repeatPerGood: +(septDs.filter(inRepeat).length / septGood).toFixed(2), repeatShare: +(septDs.filter(inRepeat).length / septDs.length).toFixed(3),
  repeatByKind: tally(septDs.filter(inRepeat), (d) => legOf(d).kind),
  freshSessionsWithTranscript: withTx, tokenShare: +(tokRep / tokAll).toFixed(3), hourShare: +(hRep / hAll).toFixed(3), tokensRepeat: tokRep, tokensAll: tokAll, hoursRepeat: +hRep.toFixed(1), hoursAll: +hAll.toFixed(1),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), since, cut, legs, tickets, septSplit }));
const R = (xs) => ({ n: xs.length, first: xs.filter((l) => !l.repeat).length, repeat: xs.filter((l) => l.repeat).length });
console.log('legs', R(legs), 'tickets', tickets.length);
for (const k of LEGS) console.log(k, R(legs.filter((l) => l.kind === k)), 'rounds', tally(legs.filter((l) => l.kind === k), (l) => l.round));
console.log('by repo', Object.fromEntries(['LinearViewer', 'simple-dispatcher', 'both', 'no merge'].map((r) => [r, R(legs.filter((l) => l.repo === r))])));
console.log('by kindHow', tally(legs, (l) => l.kindHow), 'tier', tally(legs, (l) => `${l.tier}${l.repeat ? ' repeat' : ''}`));
console.log('by week', Object.fromEntries([...new Set(legs.map((l) => l.week))].sort().map((w) => [w, R(legs.filter((l) => l.week === w))])));
console.log('tickets with any repeat', tickets.filter((t) => LEGS.some((k) => t.rounds[k] > 1)).length, 'repeats per ticket', tally(tickets, (t) => LEGS.reduce((a, k) => a + Math.max(0, t.rounds[k] - 1), 0)));
console.log('september', JSON.stringify(septSplit));
