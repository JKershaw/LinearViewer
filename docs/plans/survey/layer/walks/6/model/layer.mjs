#!/usr/bin/env node
// The layer model (design.md §3–4): one generic record, kinds as data, one JSON store.
import fs from 'node:fs';

const here = new URL('.', import.meta.url);
const KINDS = JSON.parse(fs.readFileSync(new URL('kinds.json', here)));
const { actors: ACTORS, blind: BLIND } = JSON.parse(fs.readFileSync(new URL('actors.json', here)));
const LINKS = { about: 'list', on: 'list', 'same-as': 'list', answers: ['decision', 'question'], piece: ['task', 'plan'] };
const VALUED = ['store', 'by', 'via', 'at', 'reason', 'into', 'as-of', 'task', 'kind', 'in', 'area', 'path', 'to', 'state', 'text'];
const CMDS = ['add', 'revise', 'end', 'link', 'brief', 'show', 'get', 'find'];
const STALE_ENDS = ['superseded', 'withdrawn', 'abandoned', 'disproved'];
const SAYS = ['says', 'asks', 'what', 'answer', 'reasoning', 'account', 'done-when', 'name', 'asked'];

class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const usage = (m) => { throw new Fail(1, m); };
const refuse = (m) => { throw new Fail(2, m); };

// ---------- argv: every flag may appear anywhere; --text takes a value only for find ----------
function parse(argv, textValued) {
  const o = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { pos.push(argv[i]); continue; }
    let [k, v] = argv[i].slice(2).split(/=(.*)/s);
    if (!VALUED.includes(k) && k !== 'count') usage(`unknown flag --${k}`);
    if (k === 'count' || (k === 'text' && !textValued)) { o[k] = true; continue; }
    if (v === undefined && (v = argv[++i]) === undefined) usage(`--${k} needs a value`);
    o[k] = v;
  }
  return { o, pos };
}

const time = (s) => { const d = new Date(s); if (isNaN(d)) usage(`bad time: ${s}`); return d.toISOString(); };
const ref = (s) => { const [id, v] = String(s).split('@'); return { id, v: v === undefined ? undefined : Number(v) }; };
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
const segs = (p) => p.split('/').filter(Boolean);
const ov1 = (a, b) => { const x = segs(a), y = segs(b), n = Math.min(x.length, y.length); return x.slice(0, n).join('/') === y.slice(0, n).join('/'); };
const overlaps = (A = [], B = []) => A.some((a) => B.some((b) => ov1(a, b)));
const recPaths = (r) => [...(r.fields.paths || []), ...(r.fields.claims || [])];

let S; // the store
const kindOf = (id) => S.records[id]?.[0].kind;
const isKind = (id, ks) => ks.includes(kindOf(id));
const view = (id, T) => {
  const vs = S.records[id]; if (!vs) return;
  if (!T) return vs.at(-1);
  let r; for (const v of vs) if (Date.parse(v.at) <= Date.parse(T)) r = v; return r;
};
const all = (T) => Object.keys(S.records).map((id) => view(id, T)).filter(Boolean);
const live = (r) => r.state === KINDS[r.kind]?.start;
const hidden = (r, by) => r.kind === 'verdict' && BLIND.includes(by) && r.by !== by;

// ---------- §3.3: what a write checks (shape only) ----------
function check(r, prev) {
  const K = KINDS[r.kind]; if (!K) refuse(`unknown kind: ${r.kind}`);
  for (const [f, val] of Object.entries(r.fields)) {
    const t = K.fields[f]; if (!t) refuse(`${r.kind} has no field ${f}`);
    const ok = t === 'list' ? Array.isArray(val) && val.every((x) => typeof x === 'string')
      : t === 'task-or-area' ? isKind(val, ['task', 'area']) : typeof val === t;
    if (!ok) refuse(`${f} must be ${t}`);
  }
  if (K.outcomes && !K.outcomes[r.fields.of]?.includes(r.fields.outcome)) refuse(`outcome ${r.fields.outcome} is not in the set for of=${r.fields.of}`);
  for (const f of K.fixed || []) if (prev && prev.fields[f] !== undefined && r.fields[f] !== prev.fields[f]) refuse(`${f} is fixed once written`);
  if (!ACTORS.includes(r.by)) refuse(`by: ${r.by} is not a declared actor`);
  if (r.to != null && !ACTORS.includes(r.to) && !isKind(r.to, ['task', 'area'])) refuse(`to: ${r.to} is not a declared actor, task or area`);
  if (K.handoff && r.to == null) refuse(`${r.kind} needs a to`);
  if (r.in != null && !isKind(r.in, ['task', 'area'])) refuse(`in: ${r.in} is not a task or area`);
  for (const [t, val] of Object.entries(r.links)) for (const s of [].concat(val)) {
    const { id, v } = ref(s);
    if (!S.records[id] || (v !== undefined && !S.records[id].some((x) => x.v === v))) refuse(`link ${t} ${s} does not resolve`);
    if (Array.isArray(LINKS[t]) && (r.kind !== LINKS[t][0] || kindOf(id) !== LINKS[t][1])) refuse(`${t} joins a ${LINKS[t][0]} to a ${LINKS[t][1]}`);
  }
  for (const l of K.needs || []) if (!r.links[l]?.length) refuse(`${r.kind} needs an ${l} link`);
  if (r.state !== K.start) {
    if (!K.ends.includes(r.state)) refuse(`${r.state} is not an end of ${r.kind} (${K.ends.join(', ')})`);
    if (!r.ended?.reason) refuse('a state change needs a reason');
    if (['handed-on', 'superseded'].includes(r.state) && !r.ended.into) refuse(`${r.state} must name the record that takes over (--into)`);
    if (r.ended.into && !S.records[r.ended.into]) refuse(`into: ${r.ended.into} does not resolve`);
  }
}

function normLinks(links, base = {}) {
  if (links != null && typeof links !== 'object') refuse('links must be an object');
  const out = { ...base };
  for (const [t, val] of Object.entries(links || {})) {
    if (!(t in LINKS)) refuse(`unknown link type: ${t}`);
    if (val == null) delete out[t];
    else if (LINKS[t] === 'list') out[t] = [].concat(val);
    else if (Array.isArray(val) && val.length !== 1) refuse(`${t} holds one link`);
    else out[t] = [].concat(val)[0];
  }
  if (out.on) out.on = out.on.map((s) => (String(s).includes('@') || !S.records[s] ? s : `${s}@${S.records[s].at(-1).v}`));
  return out;
}

function write(o, prev, r) {
  if (!o.by) usage('--by <actor> is required');
  const v = { id: r.id, kind: r.kind, v: prev ? prev.v + 1 : 1, op: r.op, at: o.at ? time(o.at) : new Date().toISOString(), by: o.by,
    via: o.via, reason: r.reason, in: r.in, to: r.to, state: r.state, ended: r.ended, links: r.links, fields: strip(r.fields) };
  check(v, prev);
  (S.records[v.id] ||= []).push(strip(v));
  return strip(v);
}

const body = (s) => {
  let j; try { j = JSON.parse(s); } catch { usage(`bad JSON: ${s}`); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) usage('JSON must be an object');
  return j;
};

// ---------- §3.4 views ----------
function deco(r, T) {
  const d = { ...r };
  if ((r.kind === 'verdict' || r.kind === 'decision') && live(r)) {
    const st = (r.links.on || []).map((s) => {
      const { id, v } = ref(s), cur = view(id, T); if (!cur) return null;
      if (STALE_ENDS.includes(cur.state)) return `on ${s}, now ${cur.state}`;
      const was = S.records[id].find((x) => x.v === v);
      return was && canon(was.fields) !== canon(cur.fields) ? `on ${s}, now @${cur.v}` : null;
    }).filter(Boolean);
    if (st.length) d.stale = st;
  }
  if (r.kind === 'question') {
    const a = all(T).filter((x) => x.kind === 'decision' && live(x) && x.links.answers && ref(x.links.answers).id === r.id);
    if (a.length) d.answered = a.map((x) => ({ id: x.id, answer: x.fields.answer, why: x.fields.why }));
  }
  if (r.kind === 'run' && r.state === 'open') {
    const ov = all(T).filter((x) => x.kind === 'run' && x.state === 'open' && x.id !== r.id && overlaps(x.fields.claims, r.fields.claims));
    if (ov.length) d.overlaps = ov.map((x) => x.id);
  }
  return d;
}

const firstLine = (r) => {
  const k = SAYS.find((f) => typeof r.fields[f] === 'string') ?? Object.keys(r.fields).find((f) => typeof r.fields[f] === 'string');
  return k ? r.fields[k].split('\n')[0] : '';
};

// ---------- §3.5 the brief ----------
function brief(actor, tid, T) {
  if (!ACTORS.includes(actor)) refuse(`${actor} is not a declared actor`);
  const t = view(tid, T); if (!t || t.kind !== 'task') refuse(`no task ${tid}`);
  const L = all(T).filter((r) => live(r) && !hidden(r, actor));
  const open = (r) => r.state === 'open';
  const tp = t.fields.paths || [];
  const asked = [], anc = new Set();
  for (let x = t; x && x.kind === 'task' && !anc.has(x.id); x = x.in && view(x.in, T)) {
    anc.add(x.id);
    if (x.fields.asked !== undefined) asked.push({ id: x.id, asked: x.fields.asked });
  }
  anc.delete(tid);
  let plan;
  if (t.links.piece) {
    let p = view(ref(t.links.piece).id, T);
    for (let n = 0; p && p.state === 'superseded' && p.ended?.into && n < 99; n++) p = view(p.ended.into, T);
    plan = p && live(p) ? [p] : [];
  } else plan = L.filter((r) => r.kind === 'plan' && r.in === tid);
  const runs = all(T).filter((r) => r.kind === 'run' && r.in === tid);
  const left = (a) => a !== actor && runs.some((r) => r.by === a && !open(r)) && !runs.some((r) => r.by === a && open(r));
  const addressed = L.filter((r) => open(r) && ((r.in === tid && r.to === actor) || r.to === tid || (r.in === tid && left(r.to))));
  const targets = new Set([t.links.piece && ref(t.links.piece).id, ...all(T).filter((r) => r.kind === 'change' && r.in === tid).map((r) => r.id)].filter(Boolean));
  const hits = (r) => ['about', 'on'].some((l) => [].concat(r.links[l] || []).some((s) => targets.has(ref(s).id)));
  const covers = (s) => s && (s === tid || anc.has(s) || (kindOf(s) === 'area' && overlaps(view(s, T)?.fields.paths, tp)));
  const stands = L.filter((r) => (r.kind === 'verdict' || r.kind === 'decision') && (r.in === tid || hits(r) || (r.kind === 'decision' && covers(r.fields.scope))));
  const areas = L.filter((r) => r.kind === 'area' && overlaps(r.fields.paths, tp))
    .map((a) => ({ id: a.id, name: a.fields.name, open: L.filter((r) => open(r) && r.to === a.id).length }));
  const others = L.filter((r) => r.kind === 'run' && open(r) && !(r.by === actor && r.in === tid) && overlaps(r.fields.claims, tp));
  const shown = new Set([tid, ...[...plan, ...addressed, ...stands, ...others].map((r) => r.id)]);
  const index = L.filter((r) => !shown.has(r.id) && ((open(r) && r.in === tid) || (r.kind === 'lesson' && overlaps(r.fields.paths, tp))))
    .map((r) => ({ id: r.id, kind: r.kind, to: r.to ?? null, says: firstLine(r) }));
  const prev = runs.filter((r) => !open(r) && r.by !== actor).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1);
  const b = {
    actor, asOf: T ?? null,
    task: { id: tid, ref: t.fields.ref ?? null, 'done-when': t.fields['done-when'] ?? null, paths: tp }, asked,
    plan: plan.map((r) => deco(r, T)), addressed: addressed.map((r) => deco(r, T)), stands: stands.map((r) => deco(r, T)),
    areas, runs: others.map((r) => deco(r, T)), index, account: prev ? { run: prev.id, by: prev.by, account: prev.fields.account ?? '' } : null,
  };
  b.carries = { asked: asked.length, plan: plan.length, addressed: addressed.length, stands: stands.length, areas: areas.length, runs: others.length, index: index.length, account: prev ? 1 : 0 };
  b.text = render(b);
  b.bytes = Buffer.byteLength(b.text);
  return b;
}

const full = (r) => [
  `${r.id} ${r.kind} [${r.state}] v${r.v} by ${r.by}${r.via ? ` via ${r.via}` : ''}${r.to ? ` to ${r.to}` : ''}${r.in ? ` in ${r.in}` : ''}`,
  ...Object.entries(r.fields).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(', ') : v}`),
  ...Object.entries(r.links).map(([k, v]) => `  ${k} → ${[].concat(v).join(', ')}`),
  ...(r.stale || []).map((s) => `  STALE: ${s}`),
  ...(r.answered || []).map((a) => `  ANSWERED by ${a.id}: ${a.answer}`),
  ...(r.overlaps ? [`  OVERLAPS: ${r.overlaps.join(', ')}`] : []),
].join('\n');

function render(b) {
  const sec = (n, title, lines) => `## ${n}. ${title}\n${lines.length ? lines.join('\n') : '(none)'}\n`;
  return [
    `# Brief for ${b.actor} on ${b.task.id}${b.asOf ? ` as of ${b.asOf}` : ''}\n`,
    sec(1, 'The task and the person\'s words', [`${b.task.id}${b.task.ref ? ` (${b.task.ref})` : ''}`, `done-when: ${b.task['done-when'] ?? ''}`,
      `paths: ${b.task.paths.join(', ')}`, ...b.asked.map((a) => `asked (${a.id}):\n${a.asked}`)]),
    sec(2, 'Its plan', b.plan.map(full)),
    sec(3, 'Addressed to it', b.addressed.map(full)),
    sec(4, 'What stands about this task', b.stands.map(full)),
    sec(5, 'Its areas', b.areas.map((a) => `${a.id} ${a.name}: ${a.open} open addressed to it`)),
    sec(6, 'Open runs sharing its paths', b.runs.map(full)),
    sec(7, 'Index of what else is known', b.index.map((i) => `${i.id} ${i.kind} → ${i.to ?? '-'}: ${i.says}`)),
    sec(8, 'The previous stage\'s account', b.account ? [`${b.account.run} by ${b.account.by}:\n${b.account.account}`] : []),
  ].join('\n');
}

// ---------- main ----------
function main(argv) {
  let p = parse(argv, false);
  const cmd = p.pos.find((x) => CMDS.includes(x));
  if (!cmd) usage(`command is one of: ${CMDS.join(', ')}`);
  if (cmd === 'find') p = parse(argv, true);
  const { o } = p, pos = p.pos.slice(); pos.splice(pos.indexOf(cmd), 1);
  const file = o.store || 'store.json';
  S = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { next: 1, records: {}, log: [] };
  const T = o['as-of'] ? time(o['as-of']) : undefined;
  const need = (n) => { if (pos.length < n) usage(`${cmd} needs ${n} argument(s)`); };
  const prevOf = (id) => S.records[id]?.at(-1) || refuse(`no record ${id}`);
  if (o.by && !ACTORS.includes(o.by) && !['add', 'revise', 'end', 'link'].includes(cmd)) refuse(`by: ${o.by} is not a declared actor`);
  let out;
  if (cmd === 'add') {
    need(2);
    const { in: inn, to, links, ...fields } = body(pos[1]);
    if (!KINDS[pos[0]]) refuse(`unknown kind: ${pos[0]}`);
    out = write(o, null, { id: `${pos[0]}-${S.next}`, kind: pos[0], op: 'add', in: inn, to, state: KINDS[pos[0]].start, links: normLinks(links), fields });
    S.next++;
  } else if (cmd === 'revise') {
    need(2); if (!o.reason) usage('revise needs --reason');
    const prev = prevOf(pos[0]), j = body(pos[1]), { in: inn, to, links, ...fields } = j;
    out = write(o, prev, { ...prev, op: 'revise', reason: o.reason, in: 'in' in j ? inn : prev.in, to: 'to' in j ? to : prev.to,
      ended: prev.ended, links: normLinks(links, prev.links), fields: { ...prev.fields, ...fields } });
  } else if (cmd === 'end') {
    need(2); const prev = prevOf(pos[0]);
    out = write(o, prev, { ...prev, op: 'end', reason: undefined, state: pos[1], ended: strip({ reason: pos[2] ?? '', into: o.into }) });
  } else if (cmd === 'link') {
    need(3); const prev = prevOf(pos[0]), [, type, target] = pos;
    const val = LINKS[type] === 'list' ? [...(prev.links[type] || []), target] : target;
    out = write(o, prev, { ...prev, op: 'link', reason: undefined, links: normLinks({ [type]: val }, prev.links) });
  } else {
    const by = o.by ?? (cmd === 'brief' ? pos[0] : null);
    if (cmd === 'brief') {
      need(1); if (!o.task) usage('brief needs --task <id>');
      out = brief(pos[0], o.task, T);
    } else if (cmd === 'show') {
      if (!o.task) usage('show needs --task <id>');
      const t = view(o.task, T); if (!t || t.kind !== 'task') refuse(`no task ${o.task}`);
      out = { task: deco(t, T), records: all(T).filter((r) => r.in === o.task && !hidden(r, by)).map((r) => deco(r, T)) };
    } else if (cmd === 'get') {
      need(1); const { id, v } = ref(pos[0]);
      const vs = (S.records[id] || []).filter((x) => !T || Date.parse(x.at) <= Date.parse(T));
      if (!vs.length || hidden(vs[0], by)) refuse(`no record ${id}`);
      if (v !== undefined) out = vs.find((x) => x.v === v) || refuse(`no version ${pos[0]}`);
      else out = { ...deco(view(id, T), T), versions: vs };
    } else {
      let rs = all(T).filter((r) => !hidden(r, by));
      const a = o.area && (view(o.area, T) || refuse(`no area ${o.area}`));
      for (const [k, f] of Object.entries({ kind: (r) => r.kind === o.kind, in: (r) => r.in === o.in, to: (r) => r.to === o.to, state: (r) => r.state === o.state,
        area: (r) => r.id !== o.area && (r.in === o.area || overlaps(recPaths(r), a.fields.paths)),
        path: (r) => overlaps(recPaths(r), [o.path]), text: (r) => JSON.stringify(r.fields).toLowerCase().includes(String(o.text).toLowerCase()) })) if (o[k] !== undefined) rs = rs.filter(f);
      out = o.count ? { count: rs.length } : rs.map((r) => deco(r, T));
    }
    const { store, by: _b, 'as-of': _a, ...rest } = o;
    S.log.push({ at: new Date().toISOString(), by, cmd, args: [...pos, ...Object.entries(rest).map(([k, v]) => (v === true ? `--${k}` : `--${k}=${v}`))], asOf: T ?? null });
  }
  fs.writeFileSync(file, JSON.stringify(S, null, 1) + '\n');
  if (cmd === 'brief') {
    if (o.text) return process.stdout.write(`${out.text}\ncarries: ${Object.entries(out.carries).map(([k, v]) => `${k} ${v}`).join(', ')}; ${out.bytes} bytes\n`);
    delete out.text;
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

try { main(process.argv.slice(2)); } catch (e) {
  if (!(e instanceof Fail)) throw e;
  process.stdout.write(JSON.stringify(e.code === 2 ? { refused: e.message } : { usage: e.message }) + '\n');
  process.exit(e.code);
}
