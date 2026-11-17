#!/usr/bin/env node
// The data layer model (design.md §3–4). One generic record, kinds.json, actors.json, one JSON store.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const K = JSON.parse(readFileSync(new URL('kinds.json', import.meta.url), 'utf8'));
const ACTORS = JSON.parse(readFileSync(new URL('actors.json', import.meta.url), 'utf8'));
const BASE = new Set(['id', 'kind', 'v', 'op', 'by', 'via', 'at', 'reason', 'in', 'to', 'state', 'stateReason', 'into', 'links']);
const USAGE = `layer.mjs [--store <path>] <command>
  add <kind> '<json>' | revise <id> '<json>' --reason <r> | end <id> <state> <reason> [--into <id>]
  link <id> <type> <id[@v]>        (writes take --by <actor> [--via <name>] [--at <time>])
  brief <actor> --task <id> [--as-of <t>] [--text]
  show --task <id> | get <id>[@v] | find [--kind] [--in] [--area] [--path] [--to] [--state] [--text] [--count]
                                   (queries take --by <actor> [--as-of <t>])`;

class Refused extends Error {}
class Usage extends Error {}
const refuse = (m) => { throw new Refused(m); };
const usage = (m) => { throw new Usage(m); };
const out = (o, code = 0) => { process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o, null, 2)) + '\n'); process.exit(code); };

function parse(argv, textTakesValue) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { pos.push(argv[i]); continue; }
    const k = argv[i].slice(2);
    if (k === 'count' || (k === 'text' && !textTakesValue)) o[k] = true;
    else if (i + 1 < argv.length) o[k] = argv[++i];
    else usage(`--${k} needs a value`);
  }
  return { pos, o };
}

let S, storePath;
const save = () => writeFileSync(storePath, JSON.stringify(S, null, 1));
const time = (t) => { if (t === undefined) return new Date().toISOString(); const d = new Date(t); if (isNaN(d)) usage(`bad time: ${t}`); return d.toISOString(); };
const json = (s) => { try { return JSON.parse(s); } catch { usage(`bad json: ${s}`); } };
const ref = (s) => { const [id, v] = String(s).split('@'); return { id, v: v === undefined ? undefined : Number(v) }; };
const versions = (id, asOf) => (S.records[id] || []).filter((x) => !asOf || x.at <= asOf);
const cur = (id, asOf) => versions(id, asOf).at(-1);
const all = (asOf) => Object.keys(S.records).map((id) => cur(id, asOf)).filter(Boolean);
const ended = (r) => r.state !== K.kinds[r.kind].start;
const overlap = (a = [], b = []) => a.some((x) => b.some((y) => x.startsWith(y) || y.startsWith(x)));
const isA = (id, kinds) => kinds.includes(cur(id)?.kind);
const TYPES = {
  string: (x) => typeof x === 'string',
  number: (x) => typeof x === 'number',
  strings: (x) => Array.isArray(x) && x.every((y) => typeof y === 'string'),
  task: (x) => isA(x, ['task']),
};

// §3.3 — shape only.
function check(r, prev) {
  const k = K.kinds[r.kind] || refuse(`kind ${r.kind} is not declared`);
  for (const f of Object.keys(r).filter((f) => !BASE.has(f))) {
    if (!k.fields[f]) refuse(`${f} is not a field of ${r.kind}`);
    if (!TYPES[k.fields[f]](r[f])) refuse(`${f} must be ${k.fields[f]}`);
  }
  if (r.kind === 'verdict' && !K.outcomes[r.of]?.includes(r.outcome)) refuse(`outcome ${r.outcome} is not in the set of ${r.of}`);
  if (prev?.asked !== undefined && r.asked !== prev.asked) refuse('asked is fixed once written');
  if (!ACTORS.includes(r.by)) refuse(`by ${r.by} is not a declared actor`);
  if (k.to && !(ACTORS.includes(r.to) || isA(r.to, ['task', 'area']))) refuse(`${r.kind} needs a to: a declared actor or a task or area`);
  if (!k.to && r.to !== undefined) refuse(`${r.kind} takes no to`);
  if (r.in !== undefined && !isA(r.in, ['task', 'area'])) refuse('in must be a task or an area');
  for (const [t, s] of Object.entries(r.links)) {
    if (!(t in K.links)) refuse(`${t} is not a link type`);
    const { id, v } = ref(s), target = cur(id);
    if (!target || (v !== undefined && !(v >= 1 && v <= S.records[id].length))) refuse(`link ${t} ${s} does not resolve`);
    if (t === 'on' && v === undefined) refuse('on must name a version: id@v');
    const j = K.links[t];
    if (j && (r.kind !== j[0] || target.kind !== j[1])) refuse(`${t} joins a ${j[0]} to a ${j[1]}`);
  }
  for (const l of k.requires || []) if (!r.links[l]) refuse(`a ${r.kind} needs an ${l} link`);
  if (r.state !== k.start) {
    if (!k.ends.includes(r.state)) refuse(`${r.state} is not an end of ${r.kind}`);
    if (!r.stateReason) refuse('an end needs a reason');
    if (K.takeover.includes(r.state) && !cur(r.into)) refuse(`${r.state} must name the record that takes over (--into)`);
  }
}

function input(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) usage('json must be an object');
  for (const f of Object.keys(j)) if (BASE.has(f) && !['in', 'to', 'links'].includes(f)) refuse(`${f} is set by the store`);
  if (j.links !== undefined && (typeof j.links !== 'object' || Array.isArray(j.links))) refuse('links must be an object');
  return j;
}

function write(base, op, o, reason) {
  if (!o.by) usage('writes need --by <actor>');
  const { via, reason: _r, ...r } = base;
  Object.assign(r, { v: (S.records[r.id]?.length || 0) + 1, op, by: o.by, at: time(o.at) });
  if (o.via) r.via = o.via;
  if (reason) r.reason = reason;
  check(r, S.records[r.id]?.at(-1));
  (S.records[r.id] ||= []).push(r);
  if (op === 'add') S.next++;
  save();
  return r;
}

// §3.4 — views computed when read.
function stale(r, asOf, seen = new Set()) {
  if (!r.links.on || ended(r) || seen.has(r.id)) return false;
  seen.add(r.id);
  const { id, v } = ref(r.links.on), t = cur(id, asOf);
  return !!t && (versions(id, asOf).some((x) => x.v > v && x.op === 'revise') || K.staleIf.includes(t.state) || stale(t, asOf, seen));
}
function view(r, asOf) {
  const d = { ...r };
  if (stale(r, asOf)) d.stale = true;
  if (r.kind === 'question') {
    const a = all(asOf).find((x) => x.kind === 'decision' && x.state === 'stands' && ref(x.links.answers).id === r.id);
    if (a) d.answered = { id: a.id, answer: a.answer, why: a.why };
  }
  return d;
}
const says = (r) => String(Object.keys(K.kinds[r.kind].fields).map((f) => r[f]).find((x) => typeof x === 'string') ?? '').split('\n')[0];
const line = (r) => [`${r.id}@${r.v} ${r.kind} (${r.state})${r.to ? ' to ' + r.to : ''}${r.links.on ? ' on ' + r.links.on : ''}${r.stale ? ' STALE' : ''}${r.answered ? ' answered by ' + r.answered.id : ''}`,
  ...Object.keys(K.kinds[r.kind].fields).filter((f) => f in r).map((f) => `  ${f}: ${[].concat(r[f]).join(', ')}`)].join('\n');

// §3.5 — the brief.
function brief(actor, taskId, asOf) {
  const t = cur(taskId, asOf);
  if (t?.kind !== 'task') refuse(`${taskId} is not a task`);
  const recs = all(asOf), open = recs.filter((r) => r.state === 'open'), live = recs.filter((r) => !ended(r));
  const chain = [];
  for (let x = t; x?.kind === 'task'; x = cur(x.in, asOf)) chain.push(x);
  const covers = chain.map((x) => x.id);
  const pieceId = t.links.piece && ref(t.links.piece).id, p = pieceId && cur(pieceId, asOf);
  const targets = new Set([pieceId, ...recs.filter((r) => r.kind === 'change' && r.in === t.id).map((r) => r.id)].filter(Boolean));
  const addressed = open.filter((r) => (r.in === t.id && r.to === actor) || r.to === t.id);
  const shown = new Set(addressed.map((r) => r.id));
  const b = {
    words: chain.filter((x) => x.asked !== undefined).map((x) => ({ id: x.id, asked: x.asked })),
    piece: p && !ended(p) ? [view(p, asOf)] : [],
    addressed: addressed.map((r) => view(r, asOf)),
    stands: live.filter((r) => ['verdict', 'decision'].includes(r.kind) && (r.in === t.id
      || ['about', 'on'].some((l) => r.links[l] && targets.has(ref(r.links[l]).id)) || covers.includes(r.scope))).map((r) => view(r, asOf)),
    areas: live.filter((r) => r.kind === 'area' && overlap(r.paths, t.paths)).map((a) => ({ id: a.id, name: a.name, open: open.filter((r) => r.to === a.id).length })),
    runs: open.filter((r) => r.kind === 'run' && r.in !== t.id && overlap(r.claims, t.paths)).map((r) => ({ id: r.id, in: r.in, by: r.by, claims: r.claims })),
    index: [...open.filter((r) => r.in === t.id && !shown.has(r.id)), ...live.filter((r) => r.kind === 'lesson' && overlap(r.paths, t.paths))]
      .map((r) => `${r.id} ${r.kind} ${r.to ?? '-'} ${says(r)}`),
  };
  const titles = { words: "1. The person's words", piece: '2. Its plan piece', addressed: '3. Addressed to it', stands: '4. What stands about this task',
    areas: '5. Its areas', runs: '6. Open runs of other tasks sharing a path', index: '7. Index of what else is known' };
  const fmt = { words: (w) => `${w.id}: ${w.asked}`, piece: line, addressed: line, stands: line,
    areas: (a) => `${a.id} ${a.name} (${a.open} open addressed to it)`, runs: (r) => `${r.id} in ${r.in} by ${r.by} claims ${r.claims.join(', ')}`, index: (s) => s };
  const text = [`# Brief for ${actor} on ${t.id}${asOf ? ' as of ' + asOf : ''}`,
    ...Object.keys(titles).map((k) => `## ${titles[k]}\n${b[k].length ? b[k].map(fmt[k]).join('\n') : '(none)'}`)].join('\n\n') + '\n';
  const carries = Object.fromEntries(Object.keys(b).map((k) => [k, b[k].length])), bytes = Buffer.byteLength(text);
  return { brief: { actor, task: t.id, asOf, ...b, carries, bytes }, text: `${text}\n-- carries ${JSON.stringify(carries)}; ${bytes} bytes` };
}

function main() {
  const argv = process.argv.slice(2);
  let { pos, o } = parse(argv, false);
  if (pos[0] === 'find') ({ pos, o } = parse(argv, true));
  storePath = o.store || './store.json';
  S = existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : { next: 1, records: {}, log: [] };
  const [cmd, a, b, c] = pos, asOf = o['as-of'] && time(o['as-of']);
  const latest = (id) => S.records[id]?.at(-1) || refuse(`no record ${id}`);
  const logged = (by) => {
    if (!by) usage('queries need --by <actor>');
    const i = argv.indexOf('--store');
    S.log.push({ at: new Date().toISOString(), by, q: i < 0 ? argv : [...argv.slice(0, i), ...argv.slice(i + 2)] });
    save();
  };
  switch (cmd) {
    case 'add': {
      if (!a || !b) usage(USAGE);
      const j = input(json(b));
      return out(write({ id: `${a}-${S.next}`, kind: a, ...j, links: j.links || {}, state: K.kinds[a]?.start }, 'add', o));
    }
    case 'revise': {
      if (!a || !b || !o.reason) usage(USAGE);
      const p = latest(a), j = input(json(b));
      return out(write({ ...p, ...j, links: { ...p.links, ...j.links } }, 'revise', o, o.reason));
    }
    case 'end': {
      if (!a || !b || !c) usage(USAGE);
      const p = latest(a);
      if (!K.kinds[p.kind].ends.includes(b)) refuse(`${b} is not an end of ${p.kind}`);
      return out(write({ ...p, state: b, stateReason: c, into: o.into }, 'end', o, c));
    }
    case 'link': {
      if (!a || !b || !c) usage(USAGE);
      const p = latest(a);
      return out(write({ ...p, links: { ...p.links, [b]: c } }, 'link', o));
    }
    case 'brief': {
      if (!a || !o.task) usage(USAGE);
      const r = brief(a, o.task, asOf);
      logged(a);
      return out(o.text ? r.text : r.brief);
    }
    case 'show': {
      if (!o.task) usage(USAGE);
      const t = cur(o.task, asOf) || refuse(`no record ${o.task}`), runs = all(asOf).filter((r) => r.kind === 'run' && r.state === 'open');
      logged(o.by);
      return out({ task: view(t, asOf), records: all(asOf).filter((r) => r.in === t.id).map((r) => view(r, asOf)),
        overlap: runs.flatMap((x, i) => runs.slice(i + 1).filter((y) => (x.in === t.id || y.in === t.id) && overlap(x.claims, y.claims)).map((y) => [x.id, y.id])) });
    }
    case 'get': {
      if (!a) usage(USAGE);
      const { id, v } = ref(a), vs = versions(id, asOf);
      if (!vs.length) refuse(`no record ${id}${asOf ? ' as of ' + asOf : ''}`);
      logged(o.by);
      return out(v === undefined ? { ...view(vs.at(-1), asOf), versions: vs } : vs.find((x) => x.v === v) || refuse(`no version ${a}`));
    }
    case 'find': {
      const area = o.area && (cur(o.area, asOf) || refuse(`no record ${o.area}`));
      const rs = all(asOf).filter((r) => (!o.kind || r.kind === o.kind) && (!o.in || r.in === o.in) && (!o.to || r.to === o.to)
        && (!o.state || r.state === o.state) && (!o.path || overlap(r.paths || r.claims, [o.path]))
        && (!area || (r.id !== area.id && overlap(r.paths || r.claims, area.paths)))
        && (!o.text || JSON.stringify(r).toLowerCase().includes(o.text.toLowerCase())));
      logged(o.by);
      return out(o.count ? { count: rs.length } : rs.map((r) => view(r, asOf)));
    }
    default: usage(USAGE);
  }
}

try { main(); } catch (e) {
  if (e instanceof Refused) out({ refused: e.message }, 2);
  if (e instanceof Usage) out({ usage: e.message }, 1);
  throw e;
}
