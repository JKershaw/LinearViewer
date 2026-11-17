#!/usr/bin/env node
// The model data layer (SPEC §3–4). Node 18+, ES modules, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));
const { kinds: KINDS, outcomes: OUTCOMES, links: LINKS, places: PLACES, takeover: TAKEOVER, moves: MOVES } = load('kinds.json');
const STAGES = load('stages.json');
const PEOPLE = load('people.json');
const LAYER = 'layer';
const has = Object.hasOwn;

// ---------- helpers ----------
const out = o => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const fail = (code, o) => { out(o); process.exit(code); };
const usage = msg => fail(1, { error: msg });
const ms = s => { const n = Date.parse(s); if (Number.isNaN(n)) usage(`bad time: ${s}`); return n; };
const last = a => a[a.length - 1];
const ref = s => { s = String(s); const i = s.lastIndexOf('@'); return i < 0 ? { id: s, v: null } : { id: s.slice(0, i), v: Number(s.slice(i + 1)) }; };
const isActor = n => typeof n === 'string' && (has(STAGES, n) || PEOPLE.includes(n));
const role = n => (has(STAGES, n) && STAGES[n].role) || null;
const live = r => r.cur.state === KINDS[r.kind]?.start; // not ended (closed records are those in an end state)
const isOpen = r => r.cur.state === 'open'; // rule 0
const linkId = (r, t) => r.cur.links[t] ? ref(r.cur.links[t]).id : null;

const FLAGS = ['store', 'retro', 'text', 'by', 'via', 'at', 'task', 'reason', 'to', 'as-of', 'kind', 'area', 'path', 'state'];
function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) pos.push(a);
    else if (!FLAGS.includes(a.slice(2))) usage(`unknown option ${a} (in, to and links go in the JSON)`);
    else if (a === '--retro' || (a === '--text' && argv[0] === 'brief')) opt[a.slice(2)] = true; // find's --text takes a value
    else opt[a.slice(2)] = argv[++i];
  }
  return { pos, opt };
}

// ---------- store and views ----------
const { pos, opt } = parse(process.argv.slice(2));
const file = opt.store || './store.json';
const existed = fs.existsSync(file);
const store = existed ? JSON.parse(fs.readFileSync(file, 'utf8')) : { retro: !!opt.retro, next: 1, records: {}, queries: [], hits: [] };
let dirty = !existed;

// Records as they stood at asOf: each record's highest version written at or before it.
function view(asOf) {
  const lim = asOf ? ms(asOf) : Infinity, V = {};
  for (const r of Object.values(store.records)) {
    const versions = r.versions.filter(x => ms(x.at) <= lim);
    if (versions.length) V[r.id] = { id: r.id, kind: r.kind, versions, cur: last(versions) };
  }
  return V;
}

// Stale: `on` points to a version revised since, to a record moved (superseded/withdrawn/abandoned), or to a stale record.
function stale(V, id, seen = new Set()) {
  if (seen.has(id)) return false;
  seen.add(id);
  const on = V[id]?.cur.links.on;
  if (!on) return false;
  const { id: tid, v } = ref(on), T = V[tid];
  if (!T) return false;
  return T.versions.some(x => x.op === 'revise' && x.v > v) || MOVES.includes(T.cur.state) || stale(V, tid, seen);
}
const full = (V, r) => ({ id: r.id, kind: r.kind, ...r.cur, stale: stale(V, r.id) });

function areasOf(V, taskId) {
  const tp = V[taskId]?.cur.fields.paths || [];
  return Object.values(V).filter(r => r.kind === 'area' && live(r) && (r.cur.fields.paths || []).some(a => tp.some(p => p.startsWith(a))));
}
// An area's finding is a finding addressed to that area.
const areaOfFinding = (V, r) => r.kind === 'finding' && V[r.cur.to]?.kind === 'area' ? r.cur.to : null;

// ---------- rules ----------
function issues(V, id, kind, s) {
  const o = [], bad = (rule, msg) => o.push({ rule, msg: `${id}: ${msg}` }), K = KINDS[kind];
  if (!K) { bad('3.2', `unknown kind ${kind}`); return o; }
  for (const [f, val] of Object.entries(s.fields)) {
    const spec = typeof K.fields[f] === 'string' ? { type: K.fields[f] } : K.fields[f], type = spec?.type;
    if (spec === undefined) { bad('3.2', `${kind} has no field ${f}`); continue; }
    if (type === 'text' && typeof val !== 'string') bad('3.2', `${f} must be text`);
    if ((type === 'list' || type === 'paths') && !(Array.isArray(val) && val.every(x => typeof x === 'string'))) bad('3.2', `${f} must be a list of strings`);
    if (spec.enum && !spec.enum.includes(val)) bad('3.2', `${f} must be one of ${spec.enum.join(', ')}`);
    if (spec.outcomeOf && !(OUTCOMES[s.fields[spec.outcomeOf]] || []).includes(val)) bad('3.2', `${f} ${val} is not in the ${s.fields[spec.outcomeOf]} outcome set`);
    if (spec.emptyInChild && val && V[s.in]?.kind === kind) bad('3.2', `a child ${kind}'s ${f} is empty`);
  }
  if (s.state !== K.start && !K.ends.includes(s.state)) bad('3.2', `${s.state} is not a state of ${kind}`);
  if (TAKEOVER.includes(s.state) && !V[s.takeover]) bad('4', `${s.state} needs the record that takes over (--to <id>)`);
  if (!isActor(s.by) && s.by !== LAYER) bad('5', `by ${s.by} is not a declared stage or person`);
  if (K.handoff) { if (!(isActor(s.to) || PLACES.includes(V[s.to]?.kind))) bad('4', `to ${s.to} is not a declared stage, person, task or area`); }
  else if (s.to != null) bad('3.1', `only the hand-off kinds have a to`);
  if (s.in != null && !PLACES.includes(V[s.in]?.kind)) bad('3.1', `in ${s.in} is not a task or area`);
  for (const [type, r] of Object.entries(s.links)) {
    const L = LINKS[type], { id: tid, v } = ref(r), T = V[tid];
    if (!L) bad('3.1', `unknown link ${type}`);
    else if (!T || (v != null && !(v >= 1 && v <= T.cur.v))) bad('5', `link ${type} ${r} does not resolve`);
    else if ((L.from && !L.from.includes(kind)) || (L.to && !L.to.includes(T.kind))) bad('3.1', `${type} links a ${(L.from || ['any']).join('/')} to a ${(L.to || ['any']).join('/')}`);
  }
  return o;
}
const rule1 = (V, id) => {
  const open = Object.values(V).filter(r => r.cur.to === id && isOpen(r)).map(r => r.id);
  return open.length ? [{ rule: '1', msg: `${id} can't close while records addressed to it are open: ${open.join(', ')}` }] : [];
};
const rule2 = (V, id, kind, s, createdAt) => {
  const p = s.links.about && V[ref(s.links.about).id];
  if (kind !== 'finding' || s.state !== 'done' || p?.kind !== 'plan') return [];
  return p.versions.some(x => x.op === 'revise' && ms(x.at) > ms(createdAt)) ? []
    : [{ rule: '2', msg: `${id} can't end done: plan piece ${p.id} has no version written after the finding` }];
};
const rule3 = (V, id, s) => {
  const q = s.links.answers && ref(s.links.answers).id;
  const others = q ? Object.values(V).filter(r => r.id !== id && linkId(r, 'answers') === q).map(r => r.id) : [];
  return others.length ? [{ rule: '3', msg: `${q} already has a decision: ${others.join(', ')}` }] : [];
};
const rule5 = (by, kind) => has(STAGES, by) && !STAGES[by].writes.includes(kind) ? [{ rule: '5', msg: `stage ${by} may not add a ${kind}` }] : [];

// Rule 6: who may revise or end R. `task` is the task the acting stage is working (--task).
function may(V, by, task, R, op, s) {
  const cur = R.cur, person = PEOPLE.includes(by), stage = has(STAGES, by), area = areaOfFinding(V, R);
  if (op === 'revise' && area && s.to !== cur.to && V[s.to]?.kind === 'task') return person || role(by) === 'place';
  if (op === 'revise' && role(by) === 'piece' && R.kind === 'plan') return Boolean(task && V[task] && linkId(V[task], 'piece') === R.id);
  if (person || R.versions[0].by === by || cur.to === by) return true;
  if (stage && task && cur.to === task) return true;
  if (role(by) === 'closes' && task && (cur.in === task || R.id === task)) return true;
  if (op === 'end' && stage && task && area && areasOf(V, task).some(a => a.id === area)) return true;
  return false;
}
const rule6 = (V, R, op, s) => may(V, opt.by, opt.task, R, op, s) ? [] : [{ rule: '6', msg: `${opt.by} may not ${op} ${R.id}` }];

// ---------- writes ----------
const cmd = process.argv.slice(2).join(' ');
function commit(probs, at, apply) {
  if (probs.length && !store.retro) fail(2, { refused: probs });
  for (const p of probs) store.hits.push({ ...p, at, cmd });
  apply();
  dirty = true;
}
function pinLinks(V, links) {
  const o = {};
  for (const [t, r] of Object.entries(links || {})) {
    const { id, v } = ref(r);
    o[t] = LINKS[t]?.pinned && v == null && V[id] ? `${id}@${V[id].cur.v}` : String(r);
  }
  return o;
}
// Rule 7: a decision that answers a question ends the question, by the layer.
function rule7(id, s, at) {
  const Q = s.links.answers && store.records[ref(s.links.answers).id];
  if (!Q || Q.kind !== 'question') return;
  const cur = last(Q.versions);
  if (cur.state !== KINDS[Q.kind].start) return;
  const reason = `answered by ${id}`;
  Q.versions.push({ ...cur, v: cur.v + 1, op: 'end', at, by: LAYER, via: undefined, reason, state: LINKS.answers.ends, stateReason: reason });
}
const json = s => { try { const o = JSON.parse(s ?? '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {} usage('expected a JSON object'); };

function write(c) {
  if (!opt.by || opt.by === LAYER) usage('every write needs --by <stage or person>');
  const at = opt.at ? new Date(ms(opt.at)).toISOString() : new Date().toISOString();
  const V = view();
  if (c === 'add') {
    const kind = pos[1];
    if (!has(KINDS, kind)) usage(`unknown kind ${kind}`);
    const { in: inn, to, links, ...fields } = json(pos[2]);
    const id = `${kind}-${store.next}`;
    const s = { v: 1, op: 'add', at, by: opt.by, via: opt.via, in: inn, to, state: KINDS[kind].start, fields, links: pinLinks(V, links) };
    commit([...issues(V, id, kind, s), ...rule5(opt.by, kind), ...rule3(V, id, s)], at, () => {
      store.next++;
      store.records[id] = { id, kind, versions: [s] };
      rule7(id, s, at);
    });
    return out(store.records[id]);
  }
  const R = V[pos[1]];
  if (!R) usage(`no record ${pos[1]}`);
  const base = { ...R.cur, v: R.cur.v + 1, at, by: opt.by, via: opt.via, reason: undefined };
  let s, probs;
  if (c === 'revise') {
    if (!opt.reason) usage('revise needs --reason');
    const body = json(pos[2]), { to, ...fields } = body;
    s = { ...base, op: 'revise', reason: opt.reason, fields: { ...R.cur.fields, ...fields }, ...('to' in body ? { to } : {}) };
    const fixed = Object.keys(fields).filter(f => (KINDS[R.kind].fields[f] || {}).fixed === true && JSON.stringify(fields[f]) !== JSON.stringify(R.cur.fields[f]));
    probs = [...issues(V, R.id, R.kind, s), ...fixed.map(f => ({ rule: '3.2', msg: `${R.id}: ${f} is fixed` })), ...rule6(V, R, 'revise', s)];
  } else if (c === 'end') {
    const [, , state, reason] = pos;
    if (!state || !reason) usage('end <id> <state> <reason>');
    s = { ...base, op: 'end', reason, state, stateReason: reason, takeover: opt.to };
    probs = [...issues(V, R.id, R.kind, s), ...rule6(V, R, 'end', s), ...rule2(V, R.id, R.kind, s, R.versions[0].at)];
    if (!live(R)) probs.push({ rule: '3.2', msg: `${R.id} has already ended (${R.cur.state})` });
    if (!KINDS[R.kind].ends.includes(state)) probs.push({ rule: '3.2', msg: `${state} is not an end of ${R.kind}` });
    if (R.kind === 'task') probs.push(...rule1(V, R.id));
  } else {
    const [, , type, target] = pos;
    if (!type || !target) usage('link <id> <type> <id[@v]>');
    s = { ...base, op: 'link', links: { ...R.cur.links, ...pinLinks(V, { [type]: target }) } };
    probs = [...issues(V, R.id, R.kind, s), ...(type === 'answers' ? rule3(V, R.id, s) : [])];
  }
  commit(probs, at, () => {
    store.records[R.id].versions.push(s);
    if (c === 'link' && pos[2] === 'answers') rule7(R.id, s, at);
  });
  out(store.records[R.id]);
}

// ---------- reads ----------
const says = r => {
  const f = Object.entries(KINDS[r.kind].fields).find(([k, sp]) => (sp === 'text' || sp?.type === 'text') && r.cur.fields[k]);
  return f ? String(r.cur.fields[f[0]]).split('\n')[0] : '';
};
const line = r => ({ id: r.id, kind: r.kind, to: r.cur.to ?? null, says: says(r) });

function brief(stage, taskId, asOf) {
  if (!has(STAGES, stage)) usage(`${stage} is not a declared stage`);
  const V = view(asOf), T = V[taskId], all = Object.values(V);
  if (T?.kind !== 'task') usage(`no task ${taskId}${asOf ? ` as of ${asOf}` : ''}`);
  const words = [];
  for (let x = T; x?.kind === 'task'; x = V[x.cur.in]) words.push({ task: x.id, asked: x.cur.fields.asked ?? '' });
  const ancestors = new Set(words.slice(1).map(w => w.task));
  const pieceId = linkId(T, 'piece'), P = V[pieceId] && live(V[pieceId]) ? V[pieceId] : null;
  const addressed = all.filter(r => isOpen(r) && ((r.cur.in === taskId && r.cur.to === stage) || r.cur.to === taskId));
  const changes = all.filter(r => r.kind === 'change' && r.cur.in === taskId).map(r => r.id);
  const parent = V[T.cur.in]?.kind === 'task' ? T.cur.in : null;
  const sibling = id => id !== taskId && V[id]?.kind === 'task' && parent && V[id].cur.in === parent;
  const subjects = r => ['about', 'on'].map(t => linkId(r, t)).filter(Boolean);
  const stands = all.filter(r => ['verdict', 'decision'].includes(r.kind) && live(r) && (r.cur.in === taskId ||
    (!sibling(r.cur.in) && subjects(r).some(x => x === pieceId || (!ancestors.has(r.cur.in) && changes.includes(x))))));
  const areas = areasOf(V, taskId);
  const areaFindings = role(stage) === 'place'
    ? all.filter(r => isOpen(r) && areas.some(a => a.id === areaOfFinding(V, r))) : null;
  const shown = new Set([taskId, pieceId, ...addressed.map(r => r.id), ...stands.map(r => r.id)]);
  const near = [...(T.cur.fields.paths || []), ...(P?.cur.fields.paths || [])];
  const overlap = ps => (ps || []).some(a => near.some(b => a.startsWith(b) || b.startsWith(a)));
  const index = all.filter(r => !shown.has(r.id) && !areaOfFinding(V, r) &&
    ((isOpen(r) && r.cur.in === taskId) || (r.kind === 'lesson' && live(r) && overlap(r.cur.fields.paths))));
  const b = {
    stage, task: taskId, asOf: asOf || null,
    words,
    piece: P ? full(V, P) : null,
    addressed: addressed.map(r => full(V, r)),
    stands: stands.map(r => full(V, r)),
    areas: areas.map(a => ({ id: a.id, name: a.cur.fields.name })),
    ...(areas.length ? {} : { areasNote: 'no area matches the task\'s paths' }),
    ...(areaFindings ? { areaFindings: areaFindings.map(r => full(V, r)) } : {}),
    index: index.map(line),
  };
  b.carries = { words: words.length, piece: P ? 1 : 0, addressed: addressed.length, stands: stands.length, areas: areas.length,
    ...(areaFindings ? { areaFindings: areaFindings.length } : {}), index: index.length };
  const text = render(b);
  b.size = { jsonBytes: Buffer.byteLength(JSON.stringify(b)), textBytes: Buffer.byteLength(text) };
  return { b, text: `${text}\nSize: ${b.size.jsonBytes} bytes as JSON, ${b.size.textBytes} bytes as text` };
}
function rec(r) {
  const head = `  ${r.id} ${r.kind} v${r.v} [${r.state}]${r.stale ? ' STALE (resting on a moved version)' : ''} by ${r.by}${r.to ? ` to ${r.to}` : ''}${r.in ? ` in ${r.in}` : ''}`;
  const body = [...Object.entries(r.fields).map(([k, v]) => `    ${k}: ${typeof v === 'string' ? v.replace(/\n/g, '\n      ') : JSON.stringify(v)}`),
    ...Object.entries(r.links).map(([k, v]) => `    ${k} -> ${v}`)];
  return [head, ...body].join('\n');
}
function render(b) {
  const sec = (n, title, rows) => `${n}. ${title}\n${rows.length ? rows.join('\n') : '  (none)'}`;
  return [
    `Brief for ${b.stage} on ${b.task}${b.asOf ? ` as of ${b.asOf}` : ''}`,
    sec(1, 'The person\'s words', b.words.map(w => `  ${w.task}: ${w.asked ? JSON.stringify(w.asked) : '(empty)'}`)),
    sec(2, 'Its plan piece', b.piece ? [rec(b.piece)] : []),
    sec(3, 'Addressed to it', b.addressed.map(rec)),
    sec(4, 'What stands about this task', b.stands.map(rec)),
    sec(5, 'Its areas', b.areas.length ? b.areas.map(a => `  ${a.id} ${a.name}`) : [`  ${b.areasNote}`]),
    ...(b.areaFindings ? [sec(6, 'Its areas\' open findings', b.areaFindings.map(rec))] : []),
    sec(7, 'Index of what else is known', b.index.map(l => `  ${l.id} ${l.kind}${l.to ? ` to ${l.to}` : ''}: ${l.says}`)),
    `Carries: ${Object.entries(b.carries).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  ].join('\n');
}

function query(name, args, result) {
  if (!isActor(opt.by)) usage('queries need --by <declared stage or person>');
  store.queries.push({ at: new Date().toISOString(), by: opt.by, query: name, args, returned: Array.isArray(result) ? result.length : 1 });
  dirty = true;
  out(result);
}
const matchPath = (r, p) => Object.entries(KINDS[r.kind].fields).some(([k, sp]) => sp === 'paths' && (r.cur.fields[k] || []).some(x => x.startsWith(p) || p.startsWith(x)));

function check() {
  const V = view(), problems = [];
  for (const r of Object.values(V)) {
    problems.push(...issues(V, r.id, r.kind, r.cur), ...rule5(r.versions[0].by, r.kind), ...rule3(V, r.id, r.cur),
      ...rule2(V, r.id, r.kind, r.cur, r.versions[0].at), ...(r.kind === 'task' && !live(r) ? rule1(V, r.id) : []));
  }
  return { problems, stale: Object.keys(V).filter(id => stale(V, id)) };
}

// ---------- dispatch ----------
const c = pos[0];
if (['add', 'revise', 'end', 'link'].includes(c)) write(c);
else if (c === 'brief') {
  if (!opt.task) usage('brief <stage> --task <id> [--as-of <time>] [--text]');
  const { b, text } = brief(pos[1], opt.task, opt['as-of']);
  out(opt.text ? text : b);
} else if (c === 'show') {
  if (!opt.task) usage('show --task <id> [--as-of <time>] --by <who>');
  const V = view(opt['as-of']), T = V[opt.task];
  if (T?.kind !== 'task') usage(`no task ${opt.task}`);
  query('show', { task: opt.task, asOf: opt['as-of'] || null },
    { task: full(V, T), records: Object.values(V).filter(r => r.cur.in === opt.task).map(r => full(V, r)) });
} else if (c === 'get') {
  const V = view(opt['as-of']), R = V[pos[1]];
  if (!R) usage(`no record ${pos[1]}`);
  query('get', { id: pos[1], asOf: opt['as-of'] || null }, { ...full(V, R), versions: R.versions });
} else if (c === 'find') {
  const V = view(), f = opt;
  const res = Object.values(V).filter(r => (!f.kind || r.kind === f.kind) && (!f.state || r.cur.state === f.state) &&
    (!f.to || r.cur.to === f.to) && (!f.area || r.cur.in === f.area || r.cur.to === f.area) && (!f.path || matchPath(r, f.path)) &&
    (!f.text || JSON.stringify(r.cur.fields).toLowerCase().includes(f.text.toLowerCase()))).map(r => full(V, r));
  query('find', Object.fromEntries(['kind', 'area', 'path', 'to', 'state', 'text'].filter(k => f[k]).map(k => [k, f[k]])), res);
} else if (c === 'check') out(check());
else if (c === 'hits') out({ retro: store.retro, hits: store.hits });
else usage('commands: add, revise, end, link, brief, show, get, find, check, hits');

if (dirty) fs.writeFileSync(file, JSON.stringify(store, null, 1) + '\n');
