#!/usr/bin/env node
// Data-layer model (design.md §3–4). Node, ES modules, no dependencies.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { kinds, links: LINKS, takeover, staleEnds } = JSON.parse(readFileSync(join(here, 'kinds.json'), 'utf8'));
const ACTORS = JSON.parse(readFileSync(join(here, 'actors.json'), 'utf8'));
const STORE = process.env.LAYER_STORE || join(here, 'store.json');

class Exit extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const usage = (m) => { throw new Exit(1, m); };
const refuse = (m) => { throw new Exit(2, m); };

const load = () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : { next: 1, records: {}, log: [] });
const save = (s) => { writeFileSync(`${STORE}.tmp`, JSON.stringify(s, null, 1)); renameSync(`${STORE}.tmp`, STORE); };
const time = (x) => { const t = new Date(x); if (isNaN(t)) usage(`bad time: ${x}`); return t.toISOString(); };
const json = (x) => { try { const j = JSON.parse(x); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch {} usage(`not a JSON object: ${x}`); };

function parse(argv, cmd) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) pos.push(a);
    else if (a === '--count' || (a === '--text' && cmd === 'brief')) opt[a.slice(2)] = true;
    else if (i + 1 < argv.length) opt[a.slice(2)] = argv[++i];
    else usage(`${a} needs a value`);
  }
  return { pos, opt };
}

// The store as of a time: {id: {vs: versions written by then, now: latest of them}}.
function viewAt(s, asOf) {
  const t = asOf ? time(asOf) : null, db = {};
  for (const [id, all] of Object.entries(s.records)) {
    const vs = t ? all.filter((v) => v.at <= t) : all;
    if (vs.length) db[id] = { vs, now: vs.reduce((a, b) => (b.v > a.v ? b : a)) };
  }
  return db;
}

const base = (ref) => ref.split('@')[0];
const list = (x) => [].concat(x ?? []);
const segs = (p) => p.split('/').filter(Boolean);
const overlap = (a, b) => { const x = segs(a), y = segs(b); return x.slice(0, y.length).every((s, i) => s === y[i]) || y.slice(0, x.length).every((s, i) => s === x[i]); };
const anyOverlap = (as, bs) => list(as).some((a) => list(bs).some((b) => overlap(a, b)));
const pathsOf = (r) => r.fields.paths ?? r.fields.claims ?? [];
const isOpen = (r) => r.state === 'open';
const author = (db, id) => db[id].vs.find((v) => v.v === 1)?.by ?? db[id].vs[0].by;
const hidden = (db, actor, r) => ACTORS[actor]?.blind && r.kind === 'verdict' && author(db, r.id) !== actor;
const kindOf = (db, id) => db[id]?.now.kind;
const firstLine = (r) => { const k = Object.keys(kinds[r.kind].fields).find((f) => typeof r.fields[f] === 'string'); return k ? r.fields[k].split('\n')[0] : ''; };

// Views computed when read: stale (verdict/decision) and answered (question).
function flags(db, r) {
  const f = {};
  if ((r.kind === 'verdict' || r.kind === 'decision') && !r.ended) {
    const stale = [];
    for (const ref of list(r.links.on)) {
      const [id, v] = ref.split('@'), t = db[id];
      if (!t) continue;
      if (t.now.ended && staleEnds.includes(t.now.state)) { stale.push(`on ${ref}, ${id} ended ${t.now.state}${t.now.ended.into ? ` into ${t.now.ended.into}` : ''}`); continue; }
      const vs = [...t.vs].sort((a, b) => a.v - b.v);
      let last = 0;
      for (let i = 1; i < vs.length; i++) if (JSON.stringify(vs[i].fields) !== JSON.stringify(vs[i - 1].fields)) last = vs[i].v;
      if (last > +v) stale.push(`on ${ref}, now @${last}`);
    }
    if (stale.length) f.stale = stale;
  }
  if (r.kind === 'question') {
    const d = Object.values(db).map((x) => x.now).find((d) => d.kind === 'decision' && !d.ended && d.links.answers && base(d.links.answers) === r.id);
    if (d) f.answeredBy = d;
  }
  return f;
}
const out = (db, r) => ({ ...r, ...flags(db, r) });

// What a write checks: shape only (§3.3).
function check(db, r, prev) {
  const K = kinds[r.kind];
  if (!K) refuse(`kind not declared: ${r.kind}`);
  if (!ACTORS[r.by]) refuse(`by is not a declared actor: ${r.by}`);
  for (const [k, val] of Object.entries(r.fields)) {
    const ty = K.fields[k];
    if (!ty) refuse(`field ${k} does not belong to ${r.kind}`);
    const ok = ty === 'text' ? typeof val === 'string'
      : ty === 'number' ? typeof val === 'number'
      : ty === 'list' ? Array.isArray(val) && val.every((x) => typeof x === 'string')
      : typeof val === 'string' && ['task', 'area'].includes(kindOf(db, val)); // record (scope)
    if (!ok) refuse(`field ${k} must be ${ty === 'record' ? 'a task or area id' : ty}`);
  }
  if (K.outcomes && !(K.outcomes[r.fields.of] ?? []).includes(r.fields.outcome)) refuse(`outcome ${r.fields.outcome} is not in the set for ${r.fields.of}`);
  if (prev && r.kind === 'task' && r.fields.asked !== prev.fields.asked) refuse("a task's asked doesn't change once written");
  if (r.in !== undefined && !['task', 'area'].includes(kindOf(db, r.in))) refuse(`in must be a task or area: ${r.in}`);
  if (r.to !== undefined && !ACTORS[r.to] && !['task', 'area'].includes(kindOf(db, r.to))) refuse(`to must be a declared actor, task or area: ${r.to}`);
  if (K.to && r.to === undefined) refuse(`a ${r.kind} must have a to`);
  for (const [ty, val] of Object.entries(r.links)) {
    const L = LINKS[ty];
    if (!L) refuse(`link type not declared: ${ty}`);
    if (!!L.many !== Array.isArray(val)) refuse(`${ty} holds ${L.many ? 'a list' : 'one'}`);
    for (const ref of list(val)) {
      const [id, v] = String(ref).split('@'), t = db[id];
      if (!t || (v !== undefined && !t.vs.some((x) => x.v === +v)) || (L.versioned && v === undefined)) refuse(`link does not resolve: ${ty} ${ref}`);
      if (L.from && (r.kind !== L.from || t.now.kind !== L.to)) refuse(`${ty} joins a ${L.from} to a ${L.to}`);
    }
  }
  if (K.on && !list(r.links.on).length) refuse(`a ${r.kind} must have an on`);
}

// `on` links rest on exact versions: a bare id is pinned to its current version.
const pinRef = (db, ty, ref) => (LINKS[ty]?.versioned && typeof ref === 'string' && !ref.includes('@') && db[ref] ? `${ref}@${db[ref].now.v}` : ref);
const pin = (db, links) => Object.fromEntries(Object.entries(links).map(([ty, v]) => [ty, Array.isArray(v) ? v.map((x) => pinRef(db, ty, x)) : pinRef(db, ty, v)]));

function put(s, db, b, op, opt, reason) {
  const prev = db[b.id]?.now;
  const r = { id: b.id, kind: b.kind, v: prev ? prev.v + 1 : 1, op, at: opt.at ? time(opt.at) : new Date().toISOString(), by: opt.by };
  if (opt.via) r.via = opt.via;
  if (reason) r.reason = reason;
  if (b.in != null) r.in = b.in;
  if (b.to != null) r.to = b.to;
  r.state = b.state;
  if (b.ended) r.ended = b.ended;
  r.links = b.links;
  r.fields = b.fields;
  check(db, r, prev);
  (s.records[r.id] ??= []).push(r);
  return r;
}

function ancestors(db, id) {
  const up = [];
  for (let c = db[id]?.now.in; c && kindOf(db, c) === 'task' && !up.includes(c); c = db[c].now.in) up.push(c);
  return up;
}

function render(r) {
  const head = `${r.id} ${r.kind} v${r.v} [${r.state}] by ${r.by}${r.to ? ` to ${r.to}` : ''}`;
  const body = Object.entries(r.fields).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  const ln = Object.entries(r.links).map(([k, v]) => `  ${k} → ${list(v).join(', ')}`);
  return [head, ...body, ...ln, ...list(r.stale).map((x) => `  STALE ${x}`), ...(r.answeredBy ? [`  answered by ${r.answeredBy.id}: ${r.answeredBy.fields.answer ?? ''}`] : [])].join('\n');
}

// A brief (§3.5): deterministic, eight parts, ended records left out.
function brief(db, actor, taskId, asOf = null) {
  const T = db[taskId]?.now;
  if (T?.kind !== 'task') refuse(`not a task: ${taskId}`);
  const all = Object.values(db).map((x) => x.now).filter((r) => !hidden(db, actor, r));
  const live = all.filter((r) => !r.ended), open = all.filter(isOpen);
  const anc = ancestors(db, taskId), tp = T.fields.paths ?? [];

  const task = { id: T.id, ref: T.fields.ref, 'done-when': T.fields['done-when'], paths: tp,
    asked: [T, ...anc.map((a) => db[a].now)].filter((t) => t.fields.asked !== undefined).map((t) => ({ id: t.id, asked: t.fields.asked })) };

  let plan;
  if (T.links.piece) {
    let p = db[base(T.links.piece)]?.now;
    const seen = new Set();
    while (p?.ended?.into && !seen.has(p.id)) { seen.add(p.id); p = db[p.ended.into]?.now; }
    plan = p && !p.ended ? [p] : [];
  } else plan = live.filter((r) => r.kind === 'plan' && r.in === taskId);

  const runs = all.filter((r) => r.kind === 'run' && r.in === taskId), by = (r) => author(db, r.id);
  const gone = new Set(runs.filter((r) => r.ended).map(by).filter((a) => a !== actor && !runs.some((r) => !r.ended && by(r) === a)));
  const addressed = open.filter((r) => r.to === taskId || (r.in === taskId && (r.to === actor || gone.has(r.to))));

  const piece = [...plan.map((p) => p.id), ...(T.links.piece ? [base(T.links.piece)] : [])];
  const changes = all.filter((r) => r.kind === 'change' && r.in === taskId).map((r) => r.id);
  const touches = (r) => [...list(r.links.about), ...list(r.links.on)].map(base).some((id) => piece.includes(id) || changes.includes(id));
  const covers = (d) => { const sc = d.fields.scope, k = kindOf(db, sc); return k === 'task' ? sc === taskId || anc.includes(sc) : k === 'area' && anyOverlap(db[sc].now.fields.paths, tp); };
  const stands = live.filter((r) => (r.kind === 'decision' || r.kind === 'verdict') && (r.in === taskId || touches(r) || (r.kind === 'decision' && covers(r))))
    .map((r) => ({ ...out(db, r), restsOn: list(r.links.on) }));

  const areas = live.filter((r) => r.kind === 'area' && anyOverlap(r.fields.paths, tp))
    .map((a) => ({ id: a.id, name: a.fields.name, open: open.filter((r) => r.to === a.id).length }));
  const others = live.filter((r) => r.kind === 'run' && !(r.in === taskId && by(r) === actor) && anyOverlap(r.fields.claims, tp));

  const carried = new Set([...addressed, ...others].map((r) => r.id));
  const index = [...open.filter((r) => r.in === taskId && !carried.has(r.id)), ...live.filter((r) => r.kind === 'lesson' && anyOverlap(r.fields.paths, tp))]
    .map((r) => ({ id: r.id, kind: r.kind, to: r.to ?? null, says: firstLine(r) }));

  const last = runs.filter((r) => r.ended && by(r) !== actor).sort((a, b) => (a.at < b.at ? -1 : 1)).pop();
  const previous = last ? { run: last.id, by: by(last), account: last.fields.account ?? '' } : null;

  const parts = { task, plan, addressed: addressed.map((r) => out(db, r)), stands, areas, runs: others, index, previous };
  const text = [
    `# Task ${task.id}${task.ref ? ` (${task.ref})` : ''}`, `done-when: ${task['done-when'] ?? ''}`, `paths: ${tp.join(', ')}`,
    ...task.asked.map((a) => `asked (${a.id}): ${a.asked}`),
    '## Plan', ...plan.map(render), '## Addressed to you', ...parts.addressed.map(render),
    '## What stands', ...stands.map((r) => `${render(r)}\n  rests on: ${r.restsOn.join(', ') || '-'}`),
    '## Areas', ...areas.map((a) => `${a.id} ${a.name}: ${a.open} open`),
    '## Open runs sharing paths', ...others.map((r) => `${r.id} by ${by(r)} in ${r.in}: ${r.fields.claims.join(', ')}`),
    '## Index', ...index.map((x) => `${x.id} ${x.kind} to ${x.to ?? '-'}: ${x.says}`),
    '## Previous stage', previous ? `${previous.run} by ${previous.by}:\n${previous.account}` : '-',
  ].join('\n') + '\n';
  const ids = (xs) => xs.map((x) => x.id);
  const carries = { task: T.id, plan: ids(plan), addressed: ids(addressed), stands: ids(stands), areas: ids(areas), runs: ids(others), index: ids(index), previous: last?.id ?? null };
  return { actor, task: taskId, asOf, carries, bytes: Buffer.byteLength(text), parts, text };
}

function run(s, cmd, pos, opt) {
  const WRITES = ['add', 'revise', 'end', 'link'], READS = ['brief', 'show', 'get', 'find'];
  if (!WRITES.includes(cmd) && !READS.includes(cmd)) usage(`usage: layer.mjs <${[...WRITES, ...READS].join('|')}> … --by <actor>`);
  const by = cmd === 'brief' ? pos[0] : opt.by;
  if (!by) usage(cmd === 'brief' ? 'brief <actor> --task <id>' : `${cmd} needs --by <actor>`);
  if (READS.includes(cmd)) {
    if (!ACTORS[by]) refuse(`not a declared actor: ${by}`);
    const db = viewAt(s, opt['as-of']), res = read(db, by, cmd, pos, opt);
    s.log.push({ at: new Date().toISOString(), by, cmd, args: { ...opt, pos }, asOf: opt['as-of'] ? time(opt['as-of']) : null });
    return res;
  }
  const db = viewAt(s), need = (n, u) => { if (pos.length < n) usage(u); };
  const cur = (id) => db[id]?.now ?? refuse(`no record: ${id}`);
  if (cmd === 'add') {
    need(2, "add <kind> '<json>' --by <actor>");
    const { in: i, to, links = {}, ...fields } = json(pos[1]);
    const r = put(s, db, { id: `${pos[0]}-${s.next}`, kind: pos[0], in: i, to, state: kinds[pos[0]]?.start, links: pin(db, links), fields }, 'add', opt);
    s.next++;
    return r;
  }
  if (cmd === 'revise') {
    need(2, "revise <id> '<json>' --reason <r> --by <actor>");
    if (!opt.reason) usage('revise needs --reason');
    const p = cur(pos[0]), j = json(pos[1]), { in: i, to, links, ...fields } = j;
    const f = { ...p.fields, ...fields };
    for (const k of Object.keys(f)) if (f[k] === null) delete f[k];
    const b = { ...p, in: 'in' in j ? i : p.in, to: 'to' in j ? to : p.to, links: { ...p.links, ...pin(db, links ?? {}) }, fields: f };
    return put(s, db, b, 'revise', opt, opt.reason);
  }
  if (cmd === 'end') {
    need(3, 'end <id> <state> <reason> [--into <id>] --by <actor>');
    const [id, state, reason] = pos, p = cur(id);
    if (p.ended) refuse(`${id} has already ended: ${p.state}`);
    if (!kinds[p.kind].ends.includes(state)) refuse(`${state} is not an end of ${p.kind}: ${kinds[p.kind].ends.join(', ')}`);
    if (!reason.trim()) refuse('a state change needs a reason');
    if (takeover.includes(state) && !opt.into) refuse(`${state} must name the record that takes over (--into)`);
    if (opt.into && !db[opt.into]) refuse(`--into does not resolve: ${opt.into}`);
    return put(s, db, { ...p, state, ended: opt.into ? { reason, into: opt.into } : { reason } }, 'end', opt);
  }
  need(3, 'link <id> <type> <id[@v]> --by <actor>');
  const [id, ty, ref] = pos, p = cur(id), L = LINKS[ty];
  if (!L) refuse(`link type not declared: ${ty}`);
  const val = pinRef(db, ty, ref), links = { ...p.links };
  links[ty] = L.many ? [...new Set([...list(links[ty]), val])] : val;
  return put(s, db, { ...p, links }, 'link', opt);
}

function read(db, by, cmd, pos, opt) {
  const visible = Object.values(db).map((x) => x.now).filter((r) => !hidden(db, by, r));
  if (cmd === 'brief') { if (!opt.task) usage('brief <actor> --task <id>'); return brief(db, by, opt.task, opt['as-of'] ? time(opt['as-of']) : null); }
  if (cmd === 'get') {
    if (!pos[0]) usage('get <id>[@<v>] --by <actor>');
    const [id, v] = pos[0].split('@'), rec = db[id];
    if (!rec) refuse(`no record: ${id}`);
    if (hidden(db, by, rec.now)) refuse(`${id} is a verdict hidden from blind actor ${by}`);
    if (v === undefined) return { ...out(db, rec.now), versions: rec.vs };
    return rec.vs.find((x) => x.v === +v) ?? refuse(`no version: ${pos[0]}`);
  }
  if (cmd === 'show') {
    if (kindOf(db, opt.task) !== 'task') opt.task ? refuse(`not a task: ${opt.task}`) : usage('show --task <id> --by <actor>');
    const inside = (r) => r.id === opt.task || ancestors(db, r.id).includes(opt.task);
    const records = visible.filter(inside);
    const runs = visible.filter((r) => r.kind === 'run' && isOpen(r)), overlaps = [];
    for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
      const [a, b] = [runs[i], runs[j]];
      const shared = list(a.fields.claims).filter((x) => anyOverlap([x], b.fields.claims));
      if (shared.length && (inside(a) || inside(b))) overlaps.push({ runs: [a.id, b.id], paths: shared });
    }
    return { task: opt.task, records: records.map((r) => out(db, r)), overlap: overlaps };
  }
  let rs = visible;
  if (opt.kind) rs = rs.filter((r) => r.kind === opt.kind);
  if (opt.in) rs = rs.filter((r) => r.in === opt.in);
  if (opt.to) rs = rs.filter((r) => r.to === opt.to);
  if (opt.state) rs = rs.filter((r) => r.state === opt.state);
  if (opt.path) rs = rs.filter((r) => anyOverlap(pathsOf(r), opt.path));
  if (opt.area) {
    const a = db[opt.area]?.now;
    if (a?.kind !== 'area') refuse(`not an area: ${opt.area}`);
    rs = rs.filter((r) => r.in === a.id || (r.id !== a.id && anyOverlap(pathsOf(r), a.fields.paths)));
  }
  if (opt.text) rs = rs.filter((r) => JSON.stringify(r.fields).toLowerCase().includes(opt.text.toLowerCase()));
  return opt.count ? { count: rs.length } : rs.map((r) => out(db, r));
}

try {
  const [cmd, ...rest] = process.argv.slice(2), { pos, opt } = parse(rest, cmd), s = load();
  const res = run(s, cmd, pos, opt);
  save(s);
  if (cmd === 'brief' && opt.text) process.stdout.write(res.text);
  else { if (cmd === 'brief') delete res.text; console.log(JSON.stringify(res, null, 2)); }
} catch (e) {
  if (!(e instanceof Exit)) throw e;
  console.log(JSON.stringify({ error: e.message }));
  process.exit(e.code);
}
