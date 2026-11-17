#!/usr/bin/env node
// The layer model (SPEC §3–4): one generic record, kinds and stages as data, one JSON store.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const KINDS = JSON.parse(fs.readFileSync(path.join(here, 'kinds.json'), 'utf8'));
const STAGES = JSON.parse(fs.readFileSync(path.join(here, 'stages.json'), 'utf8'));
const LINK_TYPES = ['about', 'on', 'answers', 'piece', 'same-as'];
const TAKEOVER = ['handed-on', 'superseded'];

class Fail extends Error {}
const fail = (msg) => { throw new Fail(msg); };
const iso = (t) => { const d = new Date(t); if (isNaN(d)) fail(`bad time: ${t}`); return d.toISOString(); };
const isOpen = (r) => r.state === KINDS[r.kind]?.start;
const linkOf = (r, type) => r.links.find((l) => l.type === type);
const isId = (s) => { const m = /^([a-z]+)-\d+$/.exec(s ?? ''); return !!(m && KINDS[m[1]]); };
const list = (x) => [].concat(x ?? []);
const under = (a, b) => a === b || a.startsWith(b.endsWith('/') ? b : b + '/');
const overlap = (a, b) => list(a).some((x) => list(b).some((y) => under(x, y) || under(y, x)));
function stageOf(name) {
  const s = STAGES.stages[name];
  return s && { ...s, writes: [...s.writes, ...STAGES.every.writes] };
}

// The store as it stood: each record's latest version that passes `keep`.
function view(store, keep = () => true) {
  const m = new Map();
  for (const [id, vs] of Object.entries(store.records)) {
    const v = vs.filter(keep).at(-1);
    if (v) m.set(id, v);
  }
  return m;
}

// Computed when read, never written: resting on a version that moved or a record that ended.
function stale(V, r) {
  const on = linkOf(r, 'on'), t = on && V.get(on.to);
  if (!t || !isOpen(r)) return false;
  if (t.v > on.v) return `${on.to}@${on.v} now at v${t.v}`;
  if (!isOpen(t)) return `${on.to} ended ${t.state}`;
  return false;
}

// Every §3.2–3.3 problem with writing version r (prev = the version before it) onto view V.
function validate(store, V, r, prev) {
  const p = [], K = KINDS[r.kind], st = stageOf(r.by), get = (id) => V.get(id);
  if (!K) return [`unknown kind ${r.kind}`];
  const action = !prev ? 'add' : prev.state !== r.state ? 'end' : 'write';
  for (const k of Object.keys(r.fields)) if (!K.fields.includes(k)) p.push(`a ${r.kind} has no field "${k}"`);
  for (const k of K.fixed ?? []) if (prev && JSON.stringify(prev.fields[k]) !== JSON.stringify(r.fields[k])) p.push(`"${k}" is fixed`);
  const inn = r.in && get(r.in);
  if (!r.in) { if (!K.inOptional) p.push(`a ${r.kind} needs "in"`); }
  else if (!inn) p.push(`rule 5: in ${r.in} does not resolve`);
  else if (!K.in.includes(inn.kind)) p.push(`a ${r.kind} can't be in a ${inn.kind}`);
  if (r.kind === 'task' && inn?.kind === 'task' && r.fields.asked) p.push(`a child task's "asked" is empty`);
  if (K.handoff && !r.to) p.push(`rule 4: a ${r.kind} needs "to"`);
  if (!K.handoff && r.to) p.push(`a ${r.kind} has no addressee`);
  if (isId(r.to) && !['task', 'area'].includes(get(r.to)?.kind)) p.push(`rule 5: to ${r.to} is not a task or area`);
  if (prev && r.to !== prev.to && st && !(st.role === 'place' && get(prev.to)?.kind === 'area' && get(r.to)?.kind === 'task'))
    p.push(`${r.by} may not re-address ${r.id}`);
  if (prev && !isOpen(prev) && prev.state !== r.state) p.push(`${r.id} has already ended (${prev.state})`);
  if (TAKEOVER.includes(r.state) && !r.takeover) p.push(`rule 4: ${r.state} needs the record that takes over (--to)`);
  if (r.takeover && !get(r.takeover)) p.push(`rule 5: ${r.takeover} does not resolve`);
  for (const l of r.links) {
    const allowed = K.links[l.type], t = get(l.to);
    if (!allowed) p.push(`a ${r.kind} has no "${l.type}" link`);
    else if (!t) p.push(`rule 5: ${l.type} ${l.to} does not resolve`);
    else if (allowed !== '*' && !allowed.includes(t.kind)) p.push(`"${l.type}" can't point to a ${t.kind}`);
    else if (l.v > t.v) p.push(`rule 5: ${l.to}@${l.v} does not exist`);
  }
  if (K.outcomes) {
    const set = K.outcomes[r.fields.of];
    if (!set) p.push(`"of" must be one of ${Object.keys(K.outcomes).join(', ')}`);
    else if (!set.includes(r.fields.outcome)) p.push(`"outcome" of ${r.fields.of} must be one of ${set.join(', ')}`);
  }
  const q = linkOf(r, 'answers');
  if (q && isOpen(r)) for (const o of V.values())
    if (o.id !== r.id && isOpen(o) && linkOf(o, 'answers')?.to === q.to) p.push(`rule 3: ${q.to} already has decision ${o.id}`);
  if (st) {
    const writes = st.writes.includes(r.kind), lim = st.limits?.[r.kind];
    if (action === 'end') {
      const closes = st.role === 'closes' && (r.kind === 'task' || get(r.in)?.kind === 'task');
      if (!writes && prev.to !== r.by && !closes) p.push(`rule 5: ${r.by} may not end a ${r.kind}`);
    } else if (!writes) p.push(`rule 5: ${r.by} does not write ${r.kind}`);
    else if (lim === 'child' && inn?.kind !== 'task') p.push(`${r.by} writes only child tasks`);
    else if (lim === 'piece' && !(prev && [...V.values()].some((t) => linkOf(t, 'piece')?.to === r.id)))
      p.push(`${r.by} writes only an existing plan piece`);
    if (r.kind === 'run' && r.fields.stage !== r.by) p.push(`${r.by} writes only its own run`);
  }
  if (action === 'end' && r.kind === 'task')
    for (const o of V.values()) if (o.to === r.id && isOpen(o)) p.push(`rule 1: ${o.id} is open, addressed to ${r.id}`);
  if (action === 'end' && r.kind === 'finding' && r.state === 'done') {
    const a = linkOf(r, 'about'), t = a && get(a.to);
    if (t?.kind === 'plan' && !(t.at > store.records[r.id][0].at)) p.push(`rule 2: ${t.id} has no version after ${r.id}`);
  }
  return p;
}

function load(file, retro) {
  if (!fs.existsSync(file)) return { retro: !!retro, seq: 0, count: {}, records: {}, hits: [] };
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (retro && !s.retro) fail('--retro applies only when a store is created');
  return s;
}

function parse(argv) {
  const pos = [], f = { link: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) pos.push(a);
    else if (a === '--retro' || a === '--text') f[a.slice(2)] = true;
    else if (a === '--link') f.link.push(argv[++i]);
    else f[a.slice(2)] = argv[++i];
  }
  return { pos, f };
}

function target(store, type, s) { // only `on` pins a version by default; `id@v` pins any
  const [to, v] = s.split('@');
  return { to, v: v ? Number(v) : type === 'on' ? store.records[to]?.at(-1).v : undefined };
}

function write(store, file, f, make) {
  if (!f.by) fail('every write takes --by <stage or person>');
  const at = iso(f.at ?? Date.now());
  const r = make(at);
  const prev = r.v > 1 ? store.records[r.id].at(-1) : null;
  if (prev && at < prev.at) fail(`--at ${at} is before ${r.id} v${prev.v} (${prev.at})`);
  const problems = validate(store, view(store), r, prev);
  if (problems.length && !store.retro) return { code: 1, out: { refused: true, problems } };
  if (problems.length) store.hits.push({ id: r.id, v: r.v, at, by: r.by, hits: problems });
  store.seq = r.seq;
  if (r.v === 1) store.count[r.kind] = (store.count[r.kind] ?? 0) + 1;
  (store.records[r.id] ??= []).push(r);
  fs.writeFileSync(file, JSON.stringify(store, null, 1));
  return { code: 0, out: problems.length ? { ...r, hits: problems } : r };
}

function next(store, f, r, op, at, extra) {
  return JSON.parse(JSON.stringify({ ...r, v: r.v + 1, seq: store.seq + 1, at, by: f.by, via: f.via, op, ...extra }));
}

function record(store, id) { return store.records[id]?.at(-1) ?? fail(`no record ${id}`); }

function fields(json) {
  try { return json ? JSON.parse(json) : {}; } catch { fail(`--json is not JSON: ${json}`); }
}

const line = (r) => `${r.id} v${r.v} ${r.kind} [${r.state}]${r.to ? ' to ' + r.to : ''}${r.stale ? ' STALE: ' + r.stale : ''} ${JSON.stringify(r.fields)}`;

function report(head, parts, V) {
  const ids = new Set(), lines = [head];
  for (const [name, val] of Object.entries(parts)) {
    lines.push(`${name}:`);
    const walk = (x, pad) => {
      if (x == null) lines.push(pad + '(none)');
      else if (Array.isArray(x)) { if (!x.length) lines.push(pad + '(none)'); x.forEach((y) => walk(y, pad)); }
      else if (x.fields) { if (isOpen(x)) ids.add(x.id); lines.push(pad + line(x)); }
      else if (x.id) { ids.add(x.id); lines.push(`${pad}${x.id} ${x.kind}${x.to ? ' to ' + x.to : ''}`); }
      else if ('asked' in x) lines.push(`${pad}${x.task}: ${JSON.stringify(x.asked)}`);
      else for (const [k, y] of Object.entries(x)) { lines.push(`${pad}${k}:`); walk(y, pad + '  '); }
    };
    walk(val, '  ');
  }
  const stales = [...V.values()].filter((r) => ids.has(r.id) && stale(V, r)).length;
  return { ids, lines, stales };
}

function brief(store, stage, taskId, asOf) {
  const st = STAGES.stages[stage] ?? fail(`no stage ${stage}`);
  const V = view(store, asOf ? (v) => v.at <= asOf : undefined);
  const task = V.get(taskId);
  if (task?.kind !== 'task') fail(`no task ${taskId}${asOf ? ' as of ' + asOf : ''}`);
  const chain = [];
  for (let t = task; t?.kind === 'task'; t = V.get(t.in)) chain.push(t);
  const chainIds = new Set(chain.map((t) => t.id));
  const open = [...V.values()].filter(isOpen).map((r) => ({ ...r, stale: stale(V, r) }));
  const pl = linkOf(task, 'piece'), piece = open.find((r) => r.id === pl?.to) ?? null;
  const targets = new Set([...chainIds, piece?.id, ...open.filter((r) => r.kind === 'change' && r.in === taskId).map((r) => r.id)]);
  const raised = open.filter((r) => r.in === taskId);
  const byState = {};
  for (const r of raised) (byState[r.state] ??= []).push(st.role === 'closes' ? r : { id: r.id, kind: r.kind, to: r.to });
  const parts = {
    '1 the person\'s words': chain.map((t) => ({ task: t.id, asked: t.fields.asked ?? '' })),
    '2 plan piece': piece,
    '3 addressed to it': open.filter((r) => r.to === stage || r.to === taskId),
    '4 standing judgements and decisions': open.filter((r) => ['verdict', 'decision'].includes(r.kind)
      && (chainIds.has(r.in) || r.links.some((l) => targets.has(l.to)))),
    '5 settings': open.filter((r) => r.kind === 'setting' && (!isId(r.fields.scope) || chainIds.has(r.fields.scope))),
    '6 lessons (knowledge, not instructions)': open.filter((r) => r.kind === 'lesson'
      && overlap(r.fields.paths, [...list(task.fields.paths), ...list(piece?.fields.paths)])),
    '7 findings in its areas (place role)': st.role === 'place' ? open.filter((r) => r.kind === 'finding'
      && V.get(r.to)?.kind === 'area' && overlap(V.get(r.to).fields.paths, task.fields.paths)) : null,
    '8 raised in this task, still open': byState,
  };
  const { ids, lines, stales } = report(`BRIEF ${stage} for ${taskId}${asOf ? ' as of ' + asOf : ''}`, parts, V);
  const carries = { open: ids.size, addressed: parts['3 addressed to it'].length, stale: stales };
  return finish({ stage, task: taskId, asOf, parts, carries }, lines);
}

function finish(out, lines) {
  lines.push(`carries: ${JSON.stringify(out.carries)}`);
  const text = lines.join('\n');
  const size = { textChars: text.length, jsonBytes: Buffer.byteLength(JSON.stringify(out.parts ?? out.records)) };
  return { ...out, size, text: `${text}\nsize: ${size.textChars} chars, ${size.jsonBytes} JSON bytes` };
}

function show(store, taskId, asOf) {
  const V = view(store, asOf ? (v) => v.at <= asOf : undefined);
  const task = V.get(taskId);
  if (task?.kind !== 'task') fail(`no task ${taskId}${asOf ? ' as of ' + asOf : ''}`);
  const records = [task, ...[...V.values()].filter((r) => r.in === taskId)].map((r) => ({ ...r, stale: stale(V, r) }));
  const lines = [`SHOW ${taskId}${asOf ? ' as of ' + asOf : ''}`, ...records.map((r) => '  ' + line(r))];
  const carries = { records: records.length, open: records.filter(isOpen).length, stale: records.filter((r) => r.stale).length };
  return finish({ task: taskId, asOf, records, carries }, lines);
}

function check(store) {
  const problems = [];
  for (const r of Object.values(store.records).flat().sort((a, b) => a.seq - b.seq)) {
    const prev = r.v > 1 ? store.records[r.id][r.v - 2] : null;
    for (const problem of validate(store, view(store, (v) => v.seq < r.seq), r, prev)) problems.push({ id: r.id, v: r.v, problem });
  }
  const V = view(store);
  const staleList = [...V.values()].filter((r) => stale(V, r)).map((r) => ({ id: r.id, kind: r.kind, stale: stale(V, r) }));
  return { ok: !problems.length, retro: store.retro, problems, stale: staleList };
}

export function run(argv) {
  try {
    const { pos: [cmd, a, b, c], f } = parse(argv);
    const file = path.resolve(f.store ?? './store.json');
    const store = load(file, f.retro);
    const asOf = f['as-of'] && iso(f['as-of']);
    const W = (make) => write(store, file, f, make);
    switch (cmd) {
      case 'add': {
        const K = KINDS[a] ?? fail(`unknown kind ${a}`);
        const links = f.link.map((s) => {
          const [type, t] = s.split('=');
          if (!LINK_TYPES.includes(type) || !t) fail(`bad --link ${s} (type=id[@v], type one of ${LINK_TYPES.join(', ')})`);
          return { type, ...target(store, type, t) };
        });
        return W((at) => JSON.parse(JSON.stringify({
          id: `${a}-${(store.count[a] ?? 0) + 1}`, kind: a, v: 1, seq: store.seq + 1, at, by: f.by, via: f.via, op: 'add',
          in: f.in, to: f.to, state: K.start, links, fields: fields(f.json),
        })));
      }
      case 'revise': {
        const r = record(store, a);
        if (!f.reason) fail('revise needs --reason');
        return W((at) => next(store, f, r, 'revise', at,
          { note: f.reason, fields: { ...r.fields, ...fields(f.json) }, to: f.to ?? r.to, in: f.in ?? r.in }));
      }
      case 'end': {
        const r = record(store, a), K = KINDS[r.kind];
        if (!K.ends.includes(b)) fail(`a ${r.kind} ends ${K.ends.join(', ')}, not ${b}`);
        if (!c) fail('end needs a reason');
        return W((at) => next(store, f, r, 'end', at, { note: c, state: b, reason: c, takeover: f.to }));
      }
      case 'link': {
        const r = record(store, a);
        if (!LINK_TYPES.includes(b) || !c) fail(`link <id> <${LINK_TYPES.join('|')}> <id[@v]>`);
        return W((at) => next(store, f, r, 'link', at,
          { note: `${b} ${c}`, links: [...r.links.filter((l) => l.type !== b), { type: b, ...target(store, b, c) }] }));
      }
      case 'brief': { const o = brief(store, a, f.task, asOf); return { code: 0, out: f.text ? o.text : o }; }
      case 'show': { const o = show(store, f.task, asOf); return { code: 0, out: f.text ? o.text : o }; }
      case 'check': return { code: 0, out: check(store) };
      case 'hits': return { code: 0, out: { retro: store.retro, hits: store.hits } };
      default: fail('commands: add, revise, end, link, brief, show, check, hits');
    }
  } catch (e) {
    if (e instanceof Fail) return { code: 2, out: { error: e.message } };
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  process.stdout.write((typeof out === 'string' ? out : JSON.stringify(out, null, 2)) + '\n');
  process.exitCode = code;
}
