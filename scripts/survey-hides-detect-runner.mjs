// LIN-3188: Detectors over the runner's record: D1f (auth/outage lines in feedback from >=3 sessions in 6 h), D5 (a parked parent not woken within 15 min of its child's terminal line), D5x (failed terminal posts that minted no wake), D8 (delivery floods and self-wakes); hits, misses against the record, and false-alarm reads.
// Usage: node scripts/survey-hides-detect-runner.mjs [--state /Users/work/development/simple-dispatcher/state] [--projects ~/.claude/projects] [--wake data/survey-hides/wake] [--out data/survey-hides]
// Needs data/survey-hides/runner.json (survey-hides-runner.mjs) and the wake extract (node scripts/survey-wake-extract.mjs --out
// data/survey-hides/wake, transcripts since 29 August). Parent->child edges are read from the parents' own transcripts: the item id
// in the result of each POST /dispatch, kickoff or recommend-and-dispatch call, plus the child's fetched item's sessionId (its
// parent's item). Child terminal lines and parent phases come from the oplog (12 July on). Repo: simple-dispatcher, except D1f,
// whose lines report Harbour's proxy and Linear credential failing. No proxy calls. Snapshot: data/survey-hides/detect-runner.json.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { classifyDonePosts } from './survey-hides-d5x-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const state = arg('--state', '/Users/work/development/simple-dispatcher/state');
const root = arg('--projects', join(homedir(), '.claude', 'projects'));
const wakeDir = arg('--wake', 'data/survey-hides/wake');
const out = arg('--out', 'data/survey-hides');
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const min = (ms) => Math.round(ms / 6000) / 10;
const iso = (t) => new Date(t).toISOString();

const ops = [];
for (const line of readFileSync(join(state, 'oplog.jsonl'), 'utf8').split('\n')) {
  if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
  if (!o.ts || (o.item && !/^[0-9a-f-]{8,}$/.test(o.item))) continue; // drop unit-test fixture lines
  o.t = Date.parse(o.ts); ops.push(o);
}
ops.sort((a, b) => a.t - b.t);
const itemSession = new Map();
for (const o of ops) if (o.item && o.session && !itemSession.has(o.item)) itemSession.set(o.item, o.session);
const phases = new Map();
for (const o of ops) if (o.event === 'state.change' && o.changed?.phase) { if (!phases.has(o.session)) phases.set(o.session, []); phases.get(o.session).push({ t: o.t, from: o.changed.phase[0], to: o.changed.phase[1] }); }
const phaseAt = (s, t) => { let p = null; for (const x of phases.get(s) || []) { if (x.t > t) break; p = x.to; } return p; };
const runner = JSON.parse(readFileSync(join(out, 'runner.json'), 'utf8'));

// ---- D1f: an outage or dead credential seen by several sessions ---------------------------------------------------
// A feedback line (the oplog keeps its first 60 characters) carries an error signature: an auth error, Harbour's
// WORKSPACE_NOT_CONNECTED, a dead credential, or a bare 401/403/502/503 in an HTTP context. A bare code must not be part of a
// ticket id, PR number, port, path or hex id (LIN-1503, #401, :503, /401, 2c35c2ea-ea00-401e) and must sit with an HTTP word
// (proxy, auth, credential, Linear, status, returns, still, probe, error, workspace, lane, retry). Lines about credential
// *work* ("credential flag", "credential path", "the credential cutover") carry no error word and so do not match.
// Usage lines and link digests are skipped. Rule: lines from >=3 distinct sessions within 6 h open an episode.
const SIG = /AUTHENTICATION_ERROR|not authenticated|Authentication required|WORKSPACE_NOT_CONN|credential (?:is |was |has )?(?:dead|expired|revoked|rejected|not recovered)|(?<![\w#:/.-])(?:401|403|502|503)(?![\w:.-])/i;
const CTX = /proxy|auth|credential|linear|http|status|return|flap|probe|still|harbour|api|error|workspace|lane|retry|again/i;
const sigLines = [];
for (const o of ops) {
  if (o.event !== 'feedback.post' || !o.ok) continue;
  const m = o.msg || ''; if (/^\[(usage|links)\]/.test(m)) continue;
  const hit = m.match(SIG); if (!hit) continue;
  if (/^\d{3}$/.test(hit[0]) && !CTX.test(m)) continue;
  sigLines.push({ ts: o.ts, t: o.t, session: itemSession.get(o.item) || o.item.slice(0, 8), msg: m.slice(0, 60) });
}
const d1f = [];
for (let i = 0; i < sigLines.length; i++) {
  const win = sigLines.filter((x) => x.t >= sigLines[i].t && x.t - sigLines[i].t <= 6 * 36e5);
  const who = [...new Set(win.map((x) => x.session))];
  if (who.length < 3) continue;
  const last = d1f[d1f.length - 1];
  const fireT = win.find((x, j) => new Set(win.slice(0, j + 1).map((y) => y.session)).size >= 3).t;
  if (last && sigLines[i].t <= last.endT) { last.endT = Math.max(last.endT, win[win.length - 1].t); continue; }
  d1f.push({ firstLine: sigLines[i].ts, fires: iso(fireT), endT: win[win.length - 1].t, startT: sigLines[i].t });
}
for (const e of d1f) { const inE = sigLines.filter((x) => x.t >= e.startT && x.t <= e.endT); e.sessions = new Set(inE.map((x) => x.session)).size; e.lines = inE.length; e.sample = inE.slice(0, 4).map((x) => x.msg); e.end = iso(e.endT); delete e.endT; delete e.startT; }
// The record to compare against (hand-entered from the cited documents and tickets).
const RECORD = [
  { id: '2026-07-16/25 WORKSPACE_NOT_CONNECTED', onset: '2026-07-16', noticed: 'agents blocked and filed LIN-1539 (durable WORKSPACE_NOT_CONNECTED fix) by 24 Jul', note: 'repeated 503 WORKSPACE_NOT_CONNECTED, LIN-1539' },
  { id: '2026-08-08 Linear 401 flood', onset: '2026-08-08T10:53Z', noticed: '2026-08-09T09:30Z (investigation started from the tail; onset found later by a fleet sweep)', note: 'docs/incidents/2026-08-09-proxy-401-flood.md' },
  { id: 'LIN-3181 dead Linear credential', onset: '2026-09-30T22:00Z (about 11 h before 1 Oct)', noticed: '2026-10-01 (LIN-3181)', note: '203 rejections, healed every 30 s' },
];

// ---- Edges: parent session -> child items, from the transcripts --------------------------------------------------
const sessions = JSON.parse(readFileSync(join(wakeDir, 'sessions.json'), 'utf8'));
const deliveries = readFileSync(join(wakeDir, 'deliveries.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(sessions.map((s) => [s.id, s]));
const delivBy = new Map(); for (const d of deliveries) { if (!delivBy.has(d.session)) delivBy.set(d.session, []); delivBy.get(d.session).push(d); }
for (const v of delivBy.values()) v.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
const itemOwner = new Map(); // item id -> full session id that owns it (root item or a follow-up into it)
for (const s of sessions) { if (s.rootItem) itemOwner.set(s.rootItem, s.id); for (const a of s.aliases || []) itemOwner.set(a, s.id); }
for (const d of deliveries) if (d.item && !itemOwner.has(d.item)) itemOwner.set(d.item, d.session);
const DISPATCH = /api\/proxy\/dispatch\b[^|]*(-X\s*'?POST|-d\s|--data|--json)|autopilot\/kickoff|recommend-and-dispatch/;
const edges = new Map(); // child item -> { parent (full session id), t, via }
for (const s of sessions) if (s.parentItem && s.rootItem && itemOwner.has(s.parentItem)) edges.set(s.rootItem, { parent: itemOwner.get(s.parentItem), via: 'child-item-sessionId' });
const since = Date.parse('2026-08-29');
for (const d of readdirSync(root)) {
  if (!d.startsWith('-Users-work-development-simple-dispatcher-workspaces-')) continue;
  for (const f of readdirSync(join(root, d))) {
    if (!f.endsWith('.jsonl')) continue; const p = join(root, d, f); if (statSync(p).mtimeMs < since) continue;
    const sid = f.slice(0, 36); if (!byId.has(sid)) continue;
    const pending = new Map();
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.includes('dispatch') && !line.includes('tool_result')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const c = e.message?.content; if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b.type === 'tool_use' && b.name === 'Bash' && DISPATCH.test(String(b.input?.command || ''))) pending.set(b.id, e.timestamp);
        if (b.type === 'tool_result' && pending.has(b.tool_use_id)) {
          const t = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text || '').join('\n') : '';
          const id = t.match(new RegExp(`"(?:id|itemId)"\\s*:\\s*"(${U})"`))?.[1];
          if (id && !edges.has(id)) edges.set(id, { parent: sid, via: 'parent-post', t: pending.get(b.tool_use_id) });
          pending.delete(b.tool_use_id);
        }
      }
    }
  }
}

// ---- D5: a parked parent not woken within 15 minutes of its child's terminal line ---------------------------------
// Terminal lines are the markers Harbour mints a wake from ([done], [complete], [failed], [aborted], [blocked]). The parent must be
// parked (AWAITING_FOLLOWUP or AWAITING_EXTERNAL in the oplog) at the moment of the line. A wake is "delivered" when a delivery
// into the parent carries this child's outcome line (first 30 characters); any delivery at all is reported alongside.
const TERM = /^\[(done|complete|failed|aborted|blocked)\]/;
const snapshotEnd = Math.max(...deliveries.map((d) => Date.parse(d.at)));
const terminalPosts = ops.filter((o) => o.event === 'feedback.post' && o.ok && TERM.test(o.msg || '') && o.t >= since);
const d5 = []; let checked = 0; const parkedChecked = [];
const seenChild = new Set();
for (const p of terminalPosts) {
  const e = edges.get(p.item); if (!e) continue;
  const key = p.item + (p.msg || '').slice(0, 12); if (seenChild.has(key)) continue; seenChild.add(key);
  checked++;
  const ps = e.parent.slice(0, 8); const ph = phaseAt(ps, p.t);
  if (ph !== 'AWAITING_FOLLOWUP' && ph !== 'AWAITING_EXTERNAL') continue;
  if (p.t > snapshotEnd - 15 * 6e4) continue; // too recent to judge
  const ds = (delivBy.get(e.parent) || []).filter((d) => Date.parse(d.at) >= p.t - 5000);
  const match = ds.find((d) => d.outcomeLine && d.outcomeLine.slice(0, 30) === (p.msg || '').slice(0, 30));
  const any = ds[0];
  // The parent leaving its park (the hold signalled, or a resume) is a delivery too, even where the transcript's wake text was not parsed.
  const woke = (phases.get(ps) || []).find((x) => x.t >= p.t - 5000 && /^AWAITING_/.test(x.from));
  const gapMatch = match ? Date.parse(match.at) - p.t : null; const gapAny = any ? Date.parse(any.at) - p.t : null; const gapWoke = woke ? woke.t - p.t : null;
  const rec = { childItem: p.item.slice(0, 8), child: itemSession.get(p.item) || null, parent: ps, parentIssue: byId.get(e.parent)?.issue || null, parentLayer: byId.get(e.parent)?.layer || null, parentPhase: ph, line: (p.msg || '').slice(0, 40), at: p.ts, gapMatchMin: gapMatch == null ? null : min(gapMatch), gapAnyMin: gapAny == null ? null : min(gapAny), parentNext: woke ? `${woke.from}->${woke.to}` : null, gapParentMin: gapWoke == null ? null : min(gapWoke), nextSource: any?.source || null, via: e.via };
  parkedChecked.push(rec);
  const firstSign = Math.min(gapMatch ?? Infinity, gapAny ?? Infinity, woke && woke.to !== 'FAILED' && woke.to !== 'CANCELLED' ? gapWoke : Infinity);
  if (firstSign > 15 * 6e4) {
    // What ended the wait: the failsafe (a resume after silence), the parent failing, or nothing; and the next session on the ticket.
    rec.idleMin = Number.isFinite(firstSign) ? min(firstSign) : (woke ? min(gapWoke) : null);
    rec.endedBy = woke?.to === 'FAILED' || woke?.to === 'CANCELLED' ? `parent ${woke.to} after ${min(gapWoke)} min` : any?.source === 'failsafe-reconfirm' || any?.source === 'silence-refire' || woke?.to === 'RESUMING' ? 'stall failsafe' : any ? `late ${any.source}` : 'nothing';
    const nextOnTicket = sessions.filter((s) => s.issue && s.issue === rec.parentIssue && Date.parse(s.first) > p.t && s.id !== e.parent).sort((a, b) => Date.parse(a.first) - Date.parse(b.first))[0];
    rec.nextSessionOnTicket = nextOnTicket ? { kind: nextOnTicket.kind, layer: nextOnTicket.layer, afterMin: min(Date.parse(nextOnTicket.first) - p.t) } : null;
    d5.push(rec);
  }
}

// ---- D5x: a terminal line the runner failed to post (fire-and-forget, no retry) -----------------------------------------
// If Harbour never stored the line, no wake was minted. Within the transcript window, look for a wake anywhere that carries it.
// LIN-3210: the counts distinguish a retry that HEALED (an ok [done] feedback.post for the item — no longer a false
// posted) from an unhealed loss, and count done_post_failed / unresolved (a done_post_started with no outcome).
const d5xCounts = classifyDonePosts(ops, runner.feedback.failures);
const falsePostedItems = new Set(d5xCounts.falseDonePosted.map((o) => o.item));
const d5x = runner.feedback.failures.filter((f) => TERM.test(f.msg || '')).map((f) => {
  const t = Date.parse(f.ts); const inWindow = t >= since;
  const w = inWindow ? deliveries.find((d) => d.outcomeLine && d.outcomeLine.slice(0, 28) === f.msg.slice(0, 28) && Date.parse(d.at) >= t - 6e4 && Date.parse(d.at) - t < 6 * 36e5) : null;
  const e = edges.get(f.item) || null;
  // LIN-3210: a FALSE done_posted is one with no ok [done] row for the item. A healed retry has one, so it is
  // not "logged anyway" (and is not a loss). This replaces the old 60 s hook.done_posted window, which read a
  // recovered retry as a false posted (red while right).
  const provedAnyway = !f.healed && falsePostedItems.has(f.item);
  let parent = null;
  if (e) {
    const ps = e.parent.slice(0, 8); const woke = (phases.get(ps) || []).find((x) => x.t >= t && /^AWAITING_/.test(x.from));
    parent = { session: ps, issue: byId.get(e.parent)?.issue || null, layer: byId.get(e.parent)?.layer || null, phaseAtLine: phaseAt(ps, t), next: woke ? `${woke.from}->${woke.to}` : null, afterMin: woke ? min(woke.t - t) : null };
  }
  return { at: f.ts, status: f.status ?? f.cause, line: f.msg.slice(0, 40), session: f.session, doneLoggedAnyway: provedAnyway, hasParentEdge: e ? true : (inWindow ? false : null), parent, wakeSeenAnyway: inWindow ? !!w : null, wakeGapMin: w ? min(Date.parse(w.at) - t) : null };
});

// ---- D8: delivery floods and self-wakes -------------------------------------------------------------------------
// Flood: more than 12 deliveries (wakes, gates, re-fires; the launch excluded) into one session inside any 60 minutes; reported at
// >12, >30 and >60 an hour. Self-wake: a wake into the session that dispatched the producing item itself (an edge from the session to itself).
const floods = [];
for (const [sid, ds] of delivBy) {
  const ts = ds.filter((d) => d.source !== 'launch').map((d) => Date.parse(d.at));
  let best = 0, at = null;
  for (let i = 0, j = 0; j < ts.length; j++) { while (ts[j] - ts[i] > 36e5) i++; if (j - i + 1 > best) { best = j - i + 1; at = ts[i]; } }
  if (best > 12) { const s = byId.get(sid); floods.push({ session: sid.slice(0, 8), issue: s?.issue, layer: s?.layer, perHour: best, from: iso(at), sources: ds.filter((d) => Math.abs(Date.parse(d.at) - at) <= 36e5).reduce((m, d) => ((m[d.source] = (m[d.source] || 0) + 1), m), {}) }); }
}
floods.sort((a, b) => b.perHour - a.perHour);
const selfWakes = [];
for (const d of deliveries) if (d.wake && d.item) { const e = edges.get(d.item); if (e && e.parent === d.session) selfWakes.push({ session: d.session.slice(0, 8), at: d.at, child: d.child }); }

const result = {
  about: 'LIN-3188 runner-side detectors. Windows: D1f and D5x 12 Jul-1 Oct (oplog); D5 and D8 29 Aug-1 Oct (transcripts).',
  d1f: { rule: '>=3 distinct sessions post a feedback line with an auth/outage signature inside 6 h', lines: sigLines.length, episodes: d1f, record: RECORD, sigLines: sigLines.map(({ t, ...r }) => r) },
  d5: { rule: 'parent parked (AWAITING_FOLLOWUP/EXTERNAL) when its child posts a wake-minting terminal line, and no delivery carrying that line within 15 min', edges: edges.size, edgeVia: [...edges.values()].reduce((m, e) => ((m[e.via] = (m[e.via] || 0) + 1), m), {}), terminalPostsInWindow: terminalPosts.length, withParentEdge: checked, parentParked: parkedChecked.length, hits: d5, parkedChecked },
  d5x: { rule: 'a wake-minting terminal line whose POST failed; doneLoggedAnyway counts a FALSE done_posted (no ok [done] feedback.post for the item), donePostFailed an honest loss, unresolved a done_post_started with no outcome', n: d5x.length, doneLoggedAnyway: d5xCounts.doneLoggedAnyway, donePostFailed: d5xCounts.donePostFailed, unresolved: d5xCounts.unresolved, healedLosses: d5xCounts.healedLosses, unhealedLosses: d5xCounts.unhealedLosses, rows: d5x },
  d8: { floods: floods.slice(0, 40), floodsN: { over12: floods.length, over30: floods.filter((f) => f.perHour > 30).length, over60: floods.filter((f) => f.perHour > 60).length }, floodsByMonth: floods.reduce((m, f) => ((m[f.from.slice(0, 7)] = (m[f.from.slice(0, 7)] || 0) + 1), m), {}), selfWakes },
};
writeFileSync(join(out, 'detect-runner.json'), JSON.stringify(result, null, 1));
console.log('D1f lines by day', JSON.stringify(sigLines.reduce((m, x) => { const d = x.ts.slice(0, 10); (m[d] ??= new Set()).add(x.session); return m; }, {}), (k, v) => (v instanceof Set ? v.size : v)));
console.log('D1f lines', sigLines.length, 'episodes', JSON.stringify(d1f));
console.log('edges', edges.size, result.d5.edgeVia, 'terminal posts', terminalPosts.length, 'with edge', checked, 'parent parked', parkedChecked.length, 'D5 hits', d5.length);
for (const h of d5) console.log('  D5', JSON.stringify(h));
console.log('D5x', JSON.stringify({ n: d5x.length, doneLoggedAnyway: d5xCounts.doneLoggedAnyway, donePostFailed: d5xCounts.donePostFailed, unresolved: d5xCounts.unresolved, healedLosses: d5xCounts.healedLosses, unhealedLosses: d5xCounts.unhealedLosses }), JSON.stringify(d5x));
console.log('D8', JSON.stringify(result.d8.floodsN), JSON.stringify(result.d8.floodsByMonth), JSON.stringify(floods.slice(0, 8)), 'self-wakes', selfWakes.length);
