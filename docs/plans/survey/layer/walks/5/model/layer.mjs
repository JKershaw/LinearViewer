#!/usr/bin/env node
// The layer model (design.md §3–4): one generic record, kinds.json, actors.json, one JSON store.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const K = JSON.parse(fs.readFileSync(path.join(here, 'kinds.json'), 'utf8'));
const ACTORS = JSON.parse(fs.readFileSync(path.join(here, 'actors.json'), 'utf8'));
const fail = (code, out) => { throw { code, out }; };
const usage = (m) => fail(1, { usage: m });
const refuse = (m) => fail(2, { refused: m });

// ---- argv: flags anywhere; --text takes a value only for find
const VAL = new Set(['store', 'by', 'via', 'at', 'as-of', 'reason', 'into', 'task', 'kind', 'in', 'area', 'path', 'to', 'state']);
const CMDS = new Set(['add', 'revise', 'end', 'link', 'brief', 'show', 'get', 'find']);
function parse(argv) {
  let cmd;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { if (VAL.has(argv[i].slice(2))) i++; } else if (!cmd && CMDS.has(argv[i])) cmd = argv[i];
  }
  const o = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], n = a.slice(2);
    if (!a.startsWith('--')) pos.push(a);
    else if (VAL.has(n) || (n === 'text' && cmd === 'find')) { if (i + 1 >= argv.length) usage(`${a} needs a value`); o[n] = argv[++i]; }
    else if (n === 'text' || n === 'count') o[n] = true;
    else usage(`unknown flag ${a}`);
  }
  if (pos[0] !== cmd) usage('commands: add revise end link brief show get find');
  return { cmd, o, pos: pos.slice(1) };
}
const time = (s) => { const d = new Date(s); if (isNaN(d)) usage(`bad time ${s}`); return d.toISOString(); };
const json = (s) => {
  let j; try { j = JSON.parse(s); } catch { usage('bad JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) usage('JSON must be an object');
  return j;
};
const split = (ref) => { const [id, v] = String(ref).split('@'); return [id, v === undefined ? null : Number(v)]; };

// ---- store + version reads
let S, file, T = null;
const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(S, null, 1)); fs.renameSync(file + '.tmp', file); };
const vis = (id) => (S.records[id] || []).filter((r) => !T || r.at <= T);
const cur = (id) => vis(id).at(-1) || null;
const all = () => Object.keys(S.records).map(cur).filter(Boolean);
const isKind = (id, kinds) => !!S.records[id] && kinds.includes(S.records[id][0].kind);

// ---- shape checks (§3.3)
const TYPES = {
  string: (v) => typeof v === 'string',
  strings: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  number: (v) => typeof v === 'number' && isFinite(v),
  task: (v) => isKind(v, ['task']),
  'verdict-of': (v) => Object.hasOwn(K.outcomes, v),
};
function validate(r, prev) {
  const k = K.kinds[r.kind];
  if (!k) refuse(`unknown kind ${r.kind}`);
  for (const [f, v] of Object.entries(r.fields)) {
    if (!k.fields[f]) refuse(`${f} is not a field of ${r.kind}`);
    if (!TYPES[k.fields[f]](v)) refuse(`${f} must be ${k.fields[f]}`);
  }
  if (r.fields.outcome !== undefined && !(K.outcomes[r.fields.of] || []).includes(r.fields.outcome)) refuse(`outcome ${r.fields.outcome} is not in the set of ${r.fields.of}`);
  if (prev?.fields.asked !== undefined && r.fields.asked !== prev.fields.asked) refuse("a task's asked is fixed once written");
  if (!ACTORS[r.by]) refuse(`unknown actor ${r.by}`);
  if (k.handoff) {
    if (r.to === undefined) refuse(`a ${r.kind} needs a to`);
    if (!ACTORS[r.to] && !isKind(r.to, ['task', 'area'])) refuse(`to ${r.to} is not an actor, task or area`);
  } else if (r.to !== undefined) refuse(`a ${r.kind} takes no to`);
  if (r.in !== undefined && !isKind(r.in, ['task', 'area'])) refuse(`in ${r.in} is not a task or area`);
  for (const [t, val] of Object.entries(r.links)) {
    const L = K.links[t];
    for (const ref of L.list ? val : [val]) {
      const [id, v] = split(ref), vs = S.records[id];
      if (!vs || (v !== null && !(v >= 1 && v <= vs.length))) refuse(`link ${t} ${ref} does not resolve`);
      if (L.from && (r.kind !== L.from || vs[0].kind !== L.to)) refuse(`${t} joins a ${L.from} to a ${L.to}`);
    }
  }
  if (r.kind === 'verdict' && !r.links.on?.length) refuse('a verdict needs an on');
  if (r.state !== k.start || r.op === 'end') {
    if (!k.ends.includes(r.state)) refuse(`${r.state} is not an end of ${r.kind}`);
    if (!r.ended?.reason) refuse('an end needs a reason');
    if (K.takeover.includes(r.state) && r.ended.into === undefined) refuse(`${r.state} must name the record that takes over (--into)`);
    if (r.ended.into !== undefined && !S.records[r.ended.into]) refuse(`--into ${r.ended.into} does not resolve`);
  }
}
const fix = (t, ref) => {
  if (typeof ref !== 'string') refuse(`link ${t} must be an id`);
  if (t !== 'on' || ref.includes('@')) return ref;
  if (!S.records[ref]) refuse(`link on ${ref} does not resolve`);
  return `${ref}@${S.records[ref].length}`; // `on` without @v rests on the current version
};
function normLinks(given = {}) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) refuse('links must be an object');
  const out = {};
  for (const [t, val] of Object.entries(given)) {
    const L = K.links[t];
    if (!L) refuse(`unknown link ${t}`);
    if (L.list) out[t] = [...new Set((Array.isArray(val) ? val : [val]).map((x) => fix(t, x)))];
    else if (Array.isArray(val)) refuse(`${t} holds one`);
    else out[t] = fix(t, val);
  }
  return out;
}
function write(op, prev, next, o) {
  if (!o.by) usage('--by <actor> is required on writes');
  const r = { ...next, v: prev ? prev.v + 1 : 1, op, at: o.at ? time(o.at) : new Date().toISOString(), by: o.by };
  delete r.via; delete r.reason;
  if (o.via) r.via = o.via;
  if (op === 'revise') r.reason = o.reason;
  validate(r, prev);
  if (!prev) S.next++;
  (S.records[r.id] ||= []).push(r);
  save();
  return r;
}
const latest = (id) => S.records[id]?.at(-1) || refuse(`no record ${id}`);
const clone = (r) => JSON.parse(JSON.stringify(r));

// ---- views (§3.4)
const ended = (r) => r.state !== K.kinds[r.kind].start;
const isOpen = (r) => r.state === 'open';
function stale(r, seen = new Set()) {
  if (ended(r) || seen.has(r.id)) return [];
  seen.add(r.id);
  const flags = [];
  for (const ref of r.links.on || []) {
    const [id, v] = split(ref), t = cur(id);
    if (!t) continue;
    if (vis(id).some((x) => x.v > v && x.op === 'revise')) flags.push(`on ${ref}, now @${t.v}`);
    else if (K.staleEnds.includes(t.state)) flags.push(`on ${ref}, now ${t.state}`);
    else if (stale(t, new Set(seen)).length) flags.push(`on ${ref}, which is stale`);
  }
  return flags;
}
const answered = (q) => q.kind === 'question'
  && all().filter((d) => d.kind === 'decision' && d.state === 'stands' && d.links.answers && split(d.links.answers)[0] === q.id)
    .map((d) => ({ id: d.id, v: d.v, answer: d.fields.answer }))[0];
function view(r) {
  const o = { ...r }, s = stale(r), a = answered(r);
  if (s.length) o.stale = s;
  if (a) o.answered = a;
  return o;
}
const segs = (p) => p.split('/').filter(Boolean);
const ov = (a, b) => { const x = segs(a), y = segs(b); return x.slice(0, y.length).every((s, i) => s === y[i]); };
const anyOv = (A, B) => A.some((a) => B.some((b) => ov(a, b)));
const pathsOf = (r) => [...(r.fields.paths || []), ...(r.fields.claims || [])];
const line = (r) => String(r.fields[K.kinds[r.kind].line] ?? Object.values(r.fields).find((x) => typeof x === 'string') ?? '').split('\n')[0];

// ---- brief (§3.5)
function brief(actor, tid) {
  if (!ACTORS[actor]) refuse(`unknown actor ${actor}`);
  const t = cur(tid);
  if (!t || t.kind !== 'task') refuse(`${tid} is not a task`);
  const chain = [];
  for (let x = t; x && x.kind === 'task' && !chain.includes(x); x = x.in ? cur(x.in) : null) chain.push(x);
  const ancestors = chain.slice(1).map((x) => x.id);
  const asked = chain.filter((x) => x.fields.asked !== undefined).map((x) => ({ id: x.id, asked: x.fields.asked }));
  const pieceIds = [];
  let piece = t.links.piece ? cur(split(t.links.piece)[0]) : null;
  while (piece && !pieceIds.includes(piece.id)) {
    pieceIds.push(piece.id);
    if (piece.state !== 'superseded') break;
    piece = cur(piece.ended.into);
  }
  if (piece && ended(piece)) piece = null;
  const rs = all().filter((r) => !ended(r)), tp = t.fields.paths || [];
  const addressed = rs.filter((r) => isOpen(r) && ((r.in === tid && r.to === actor) || r.to === tid)).map(view);
  const targets = new Set([...pieceIds, ...all().filter((r) => r.kind === 'change' && r.in === tid).map((r) => r.id)]);
  const refs = (r) => [...(r.links.about || []), ...(r.links.on || [])].map((x) => split(x)[0]);
  const covers = (r) => r.kind === 'decision' && (r.fields.scope === tid || ancestors.includes(r.fields.scope));
  const stands = rs.filter((r) => (r.kind === 'decision' || (r.kind === 'verdict' && (!ACTORS[actor].blind || r.by === actor)))
    && (r.in === tid || refs(r).some((x) => targets.has(x)) || covers(r))).map(view);
  const areas = rs.filter((r) => r.kind === 'area' && anyOv(r.fields.paths || [], tp))
    .map((a) => ({ id: a.id, name: a.fields.name, open: rs.filter((r) => isOpen(r) && r.to === a.id).length }));
  const runs = rs.filter((r) => r.kind === 'run' && isOpen(r) && !(r.by === actor && r.in === tid) && anyOv(r.fields.claims || [], tp))
    .map((r) => ({ id: r.id, by: r.by, in: r.in, stage: r.fields.stage, claims: r.fields.claims }));
  const shown = new Set([tid, ...addressed.map((r) => r.id), ...runs.map((r) => r.id)]);
  const index = rs.filter((r) => !shown.has(r.id) && ((isOpen(r) && r.in === tid) || (r.kind === 'lesson' && anyOv(r.fields.paths || [], tp))))
    .map((r) => ({ id: r.id, kind: r.kind, to: r.to, line: line(r) }));
  const b = { actor, asOf: T, task: { id: tid, ref: t.fields.ref, 'done-when': t.fields['done-when'], paths: tp }, asked,
    piece: piece && view(piece), replaced: pieceIds.filter((id) => id !== piece?.id), addressed, stands, areas, runs, index };
  b.carries = { asked: asked.length, piece: piece ? 1 : 0, addressed: addressed.length, stands: stands.length, areas: areas.length, runs: runs.length, index: index.length };
  b.text = render(b);
  b.bytes = Buffer.byteLength(b.text);
  return b;
}
const val = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const full = (r) => [`  ${r.id}@${r.v} ${r.kind} by ${r.by}${r.to ? ` to ${r.to}` : ''}${r.in ? ` in ${r.in}` : ''}${r.stale ? ` [STALE: ${r.stale.join('; ')}]` : ''}`,
  ...Object.entries(r.fields).map(([k, v]) => `    ${k}: ${val(v)}`),
  ...Object.entries(r.links).map(([k, v]) => `    ${k}: ${[].concat(v).join(', ')}`)];
function render(b) {
  const L = [`brief for ${b.actor} on ${b.task.id}${b.asOf ? ` as of ${b.asOf}` : ''}`,
    `1. task ${b.task.id}${b.task.ref ? ` (ref ${b.task.ref})` : ''}`, `  done-when: ${b.task['done-when'] ?? ''}`, `  paths: ${b.task.paths.join(', ')}`,
    ...b.asked.map((a) => `  asked (${a.id}):\n${a.asked}`),
    `2. plan piece${b.replaced.length ? ` (takes over from ${b.replaced.join(', ')})` : ''}:`, ...(b.piece ? full(b.piece) : ['  none']),
    '3. addressed to you:', ...(b.addressed.length ? b.addressed.flatMap(full) : ['  none']),
    '4. what stands:', ...(b.stands.length ? b.stands.flatMap(full) : ['  none']),
    '5. areas:', ...(b.areas.length ? b.areas.map((a) => `  ${a.id} ${a.name} (${a.open} open)`) : ['  none']),
    '6. open runs sharing paths:', ...(b.runs.length ? b.runs.map((r) => `  ${r.id} ${r.stage ?? ''} by ${r.by} in ${r.in ?? '-'}: ${(r.claims || []).join(', ')}`) : ['  none']),
    '7. index:', ...(b.index.length ? b.index.map((r) => `  ${r.id} ${r.kind}${r.to ? ` to ${r.to}` : ''}: ${r.line}`) : ['  none'])];
  return L.join('\n') + '\n';
}

// ---- commands
function main(argv) {
  const { cmd, o, pos } = parse(argv);
  file = o.store || 'store.json';
  S = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { next: 1, records: {}, log: [] };
  if (cmd === 'add') {
    if (pos.length !== 2) usage("add <kind> '<json>'");
    const { in: inn, to, links, ...fields } = json(pos[1]), k = K.kinds[pos[0]];
    if (!k) refuse(`unknown kind ${pos[0]}`);
    const r = { id: `${pos[0]}-${S.next}`, kind: pos[0], state: k.start, fields, links: normLinks(links) };
    if (inn !== undefined) r.in = inn;
    if (to !== undefined) r.to = to;
    return write('add', null, r, o);
  }
  if (cmd === 'revise') {
    if (pos.length !== 2 || !o.reason) usage("revise <id> '<json>' --reason <r>");
    const { in: inn, to, links, ...fields } = json(pos[1]), prev = latest(pos[0]), r = clone(prev);
    Object.assign(r.fields, fields);
    Object.assign(r.links, normLinks(links));
    if (inn !== undefined) r.in = inn;
    if (to !== undefined) r.to = to;
    return write('revise', prev, r, o);
  }
  if (cmd === 'end') {
    if (pos.length !== 3) usage('end <id> <state> <reason> [--into <id>]');
    const prev = latest(pos[0]), r = clone(prev);
    r.state = pos[1];
    r.ended = { reason: pos[2] };
    if (o.into) r.ended.into = o.into;
    return write('end', prev, r, o);
  }
  if (cmd === 'link') {
    if (pos.length !== 3) usage('link <id> <type> <id[@v]>');
    const prev = latest(pos[0]), r = clone(prev), [, t, target] = pos, L = K.links[t];
    if (!L) refuse(`unknown link ${t}`);
    const ref = fix(t, target);
    r.links[t] = L.list ? [...new Set([...(r.links[t] || []), ref])] : ref;
    return write('link', prev, r, o);
  }
  // reads
  if (o['as-of']) T = time(o['as-of']);
  const by = cmd === 'brief' ? o.by || pos[0] : o.by;
  if (!by) usage('--by <actor> is required on queries');
  S.log.push({ at: new Date().toISOString(), by, cmd, args: argv.filter((a, i) => a !== '--store' && argv[i - 1] !== '--store'), asOf: T });
  save();
  if (cmd === 'brief') {
    if (pos.length !== 1 || !o.task) usage('brief <actor> --task <id> [--as-of <time>] [--text]');
    const b = brief(pos[0], o.task);
    if (o.text) return `${b.text}-- carries ${JSON.stringify(b.carries)}; ${b.bytes} bytes\n`;
    delete b.text;
    return b;
  }
  if (cmd === 'show') {
    const t = o.task && cur(o.task);
    if (!o.task) usage('show --task <id>');
    if (!t || t.kind !== 'task') refuse(`${o.task} is not a task`);
    return { task: view(t), records: all().filter((r) => r.in === o.task).map(view)
      .map((r) => ({ id: r.id, kind: r.kind, v: r.v, state: r.state, to: r.to, line: line(r), stale: r.stale, answered: r.answered })) };
  }
  if (cmd === 'get') {
    if (pos.length !== 1) usage('get <id>[@<v>]');
    const [id, v] = split(pos[0]), vs = vis(id), r = v === null ? vs.at(-1) : vs.find((x) => x.v === v);
    if (!r) refuse(`no record ${pos[0]}${T ? ` as of ${T}` : ''}`);
    return v === null ? { ...view(r), versions: vs } : r;
  }
  // find
  let rs = all();
  if (o.area && !cur(o.area)) refuse(`no record ${o.area}`);
  const ap = o.area ? cur(o.area).fields.paths || [] : [], text = o.text?.toLowerCase();
  rs = rs.filter((r) => (!o.kind || r.kind === o.kind) && (!o.in || r.in === o.in) && (!o.to || r.to === o.to) && (!o.state || r.state === o.state)
    && (!o.area || (r.id !== o.area && (r.in === o.area || anyOv(pathsOf(r), ap))))
    && (!o.path || anyOv(pathsOf(r), [o.path])) && (!text || JSON.stringify(r.fields).toLowerCase().includes(text)));
  return o.count ? { count: rs.length } : rs.map(view);
}

try {
  const out = main(process.argv.slice(2));
  process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out, null, 2) + '\n');
} catch (e) {
  if (typeof e?.code !== 'number') throw e;
  process.stdout.write(JSON.stringify(e.out) + '\n');
  process.exitCode = e.code;
}
