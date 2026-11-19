#!/usr/bin/env node
// The layer model: one generic record, kinds.json, actors.json, one JSON store. See BUILD-NOTES.md.
import fs from 'node:fs';

const here = new URL('.', import.meta.url);
const K = JSON.parse(fs.readFileSync(new URL('kinds.json', here), 'utf8'));
const ACTORS = JSON.parse(fs.readFileSync(new URL('actors.json', here), 'utf8'));
const STORE = process.env.LAYER_STORE || new URL('store.json', here);
const db = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : { next: 1, records: {}, log: [] };
const save = () => fs.writeFileSync(STORE, JSON.stringify(db, null, 1) + '\n');

class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const usage = (m) => { throw new Fail(1, m); };
const refuse = (m) => { throw new Fail(2, m); };

const LINKS = Object.keys(K.links);
const TYPES = { string: 'a string', number: 'a number', list: 'a list of strings', scope: 'a task id or project' };
const split = (ref) => { const [id, v] = String(ref).split('@'); return [id, v === undefined ? undefined : Number(v)]; };
const kindOf = (id) => db.records[id]?.[0].kind;
const num = (id) => Number(id.split('-').pop());
const at = (id, asOf) => (db.records[id] || []).filter((x) => !asOf || x.at <= asOf).pop();
const all = (asOf) => Object.keys(db.records).sort((a, b) => num(a) - num(b)).map((id) => at(id, asOf)).filter(Boolean);
const latest = (id) => at(id) || refuse(`no record '${id}'`);
const time = (s, flag) => { if (s === undefined) return undefined; const d = new Date(s); if (isNaN(d)) usage(`--${flag} is not a time: '${s}'`); return d.toISOString(); };
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
const firstLine = (s) => String(s ?? '').split('\n')[0];
const saying = (r) => firstLine(['says', 'asks', 'answer', 'reasoning', 'account', 'asked', 'done-when', 'head', 'ref', 'stage'].map((f) => r.fields[f]).find((x) => x !== undefined));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

function typeOk(t, v) {
  if (t === 'string') return typeof v === 'string';
  if (t === 'number') return typeof v === 'number' && isFinite(v);
  if (t === 'list') return Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (t === 'scope') return v === 'project' || kindOf(v) === 'task';
}

// A refusal for a key that does not belong where it was put, saying where it belongs.
function misplaced(key, kind, inLinks) {
  const owners = Object.keys(K.kinds).filter((k) => K.kinds[k].fields[key]);
  const where = inLinks && ['in', 'to'].includes(key) ? 'put it at the top level of the JSON'
    : inLinks && K.kinds[kind].fields[key] ? `it is a field of ${kind}: put it at the top level of the JSON`
    : !inLinks && LINKS.includes(key) ? 'it is a link: put it under links'
    : ['by', 'via', 'at'].includes(key) ? `it is not part of the JSON: use --${key}`
    : ['state', 'ended'].includes(key) ? 'state changes use: end <id> <state> <reason>'
    : ['id', 'v', 'op'].includes(key) ? 'the store sets it'
    : key === 'reason' ? 'use --reason on revise, or the reason of end'
    : key === 'fields' ? 'put fields at the top level of the JSON'
    : owners.length ? `it belongs to ${owners.join(', ')}`
    : inLinks ? `link types are: ${LINKS.join(', ')}`
    : `${kind} fields are: ${Object.keys(K.kinds[kind].fields).join(', ')}`;
  return inLinks ? `'${key}' is not a link type; ${where}` : `field '${key}' does not belong to ${kind}; ${where}`;
}

// What a write checks (3.3): shape only.
function check(r, prev) {
  const kd = K.kinds[r.kind];
  if (!ACTORS.includes(r.by)) refuse(`by '${r.by}' is not a declared actor (actors.json)`);
  for (const [f, val] of Object.entries(r.fields)) {
    if (!kd.fields[f]) refuse(misplaced(f, r.kind, false));
    if (!typeOk(kd.fields[f], val)) refuse(`field '${f}' of ${r.kind} must be ${TYPES[kd.fields[f]]}`);
  }
  if (r.kind === 'verdict') {
    const set = K.outcomes[r.fields.judgement];
    if (!set) refuse(`verdict judgement must be one of: ${Object.keys(K.outcomes).join(', ')}`);
    if (!set.includes(r.fields.outcome)) refuse(`outcome '${r.fields.outcome}' is not in ${r.fields.judgement}'s set: ${set.join(', ')}`);
  }
  if (prev && prev.fields.asked !== undefined && r.fields.asked !== prev.fields.asked) refuse(`a task's asked is fixed once written`);
  if (r.to !== undefined && !(r.to === 'project' || ACTORS.includes(r.to) || kindOf(r.to) === 'task')) refuse(`to '${r.to}' must be a declared actor, a task record or project`);
  if (r.in !== undefined && kindOf(r.in) !== 'task') refuse(`in '${r.in}' is not a task`);
  for (const [type, val] of Object.entries(r.links)) {
    const ld = K.links[type];
    if (!ld) refuse(misplaced(type, r.kind, true));
    if (ld.list ? !Array.isArray(val) : typeof val !== 'string') refuse(`links.${type} holds ${ld.list ? 'a list of ids' : 'one id'}`);
    if (ld.from && r.kind !== ld.from) refuse(`links.${type} joins a ${ld.from} to a ${ld.target}; a ${r.kind} cannot carry it`);
    for (const ref of ld.list ? val : [val]) {
      const [id, v] = split(ref);
      if (!db.records[id]) refuse(`links.${type}: '${id}' does not resolve`);
      if (v !== undefined && !db.records[id].some((x) => x.v === v)) refuse(`links.${type}: '${ref}' has no such version`);
      if (ld.versioned && v === undefined) refuse(`links.${type} names exact versions: ${id}@<v>`);
      if (ld.target && kindOf(id) !== ld.target) refuse(`links.${type} must point to a ${ld.target}; '${id}' is a ${kindOf(id)}`);
    }
  }
  if (kd.needsTo && r.to === undefined) refuse(`a ${r.kind} must have a to (who acts on it next)`);
  if (kd.needsOn && !(r.links.on || []).length) refuse(`a ${r.kind} must have links.on (the exact version it rests on, id@v)`);
}

function parseJson(s) {
  let x; try { x = JSON.parse(s); } catch { usage(`not JSON: ${s}`); }
  return isObj(x) ? x : usage('the JSON must be an object');
}
function apply(r, input) {
  for (const [k, val] of Object.entries(input)) {
    if (k === 'in' || k === 'to') { if (val === null) delete r[k]; else r[k] = val; }
    else if (k === 'links') {
      if (!isObj(val)) refuse('links must be an object of type: id(s)');
      for (const [t, x] of Object.entries(val)) { if (x === null) delete r.links[t]; else r.links[t] = x; }
    } else if (val === null) delete r.fields[k];
    else r.fields[k] = val;
  }
}
function next(prev, op) {
  const r = structuredClone(prev);
  delete r.reason; delete r.via;
  return Object.assign(r, { v: prev.v + 1, op });
}
function commit(r, o, prev) {
  Object.assign(r, { at: o.at || new Date().toISOString(), by: o.by });
  if (o.via) r.via = o.via;
  check(r, prev);
  if (!prev) db.next++;
  (db.records[r.id] ||= []).push(r);
  save();
  return r;
}

const writes = {
  add([kind, json], o) {
    if (!kind || json === undefined) usage('add <kind> <json> --by <actor>');
    if (!K.kinds[kind]) refuse(`kind '${kind}' is not declared; kinds: ${Object.keys(K.kinds).join(', ')}`);
    const r = { id: `${kind}-${db.next}`, kind, v: 1, op: 'add', state: K.kinds[kind].start, links: {}, fields: {} };
    apply(r, parseJson(json));
    return commit(r, o);
  },
  revise([id, json], o) {
    if (!id || json === undefined || !o.reason) usage('revise <id> <json> --reason <r> --by <actor>');
    const prev = latest(id), r = next(prev, 'revise');
    r.reason = o.reason;
    apply(r, parseJson(json));
    return commit(r, o, prev);
  },
  end([id, state, ...why], o) {
    const reason = why.join(' ');
    if (!id || !state || !why.length) usage('end <id> <state> <reason> [--into <id>] --by <actor>');
    const prev = latest(id), kd = K.kinds[prev.kind];
    if (prev.ended) refuse(`${id} has already ended (${prev.state})`);
    if (!kd.ends.includes(state)) refuse(`'${state}' is not an end of ${prev.kind}; its ends: ${kd.ends.join(', ')}`);
    if (!reason.trim()) refuse('an end needs a reason');
    if (K.takeover.includes(state) && !o.into) refuse(`${state} names the record that takes over: --into <id>`);
    if (!K.takeover.includes(state) && o.into) refuse(`--into is only for ${K.takeover.join(' and ')}`);
    if (o.into && !db.records[o.into]) refuse(`--into '${o.into}' does not resolve`);
    const r = next(prev, 'end');
    r.state = state;
    r.ended = o.into ? { reason, into: o.into } : { reason };
    return commit(r, o, prev);
  },
  link([id, type, ref], o) {
    if (!id || !type || !ref) usage('link <id> <type> <id[@v]> --by <actor>');
    const prev = latest(id), r = next(prev, 'link'), ld = K.links[type];
    if (!ld) refuse(misplaced(type, prev.kind, true));
    r.links[type] = ld.list ? [...new Set([...(r.links[type] || []), ref])] : ref;
    return commit(r, o, prev);
  },
};

// Views (3.4), computed when read: answered, stale, under an ended task.
function view(r, asOf) {
  const flags = {};
  if (r.kind === 'question') {
    const d = all(asOf).filter((x) => x.kind === 'decision' && x.state === 'stands' && x.links.answers === r.id).pop();
    if (d) flags.answered = { by: d.id, answer: d.fields.answer };
  }
  if ((r.kind === 'verdict' || r.kind === 'decision') && !r.ended) {
    const stale = (r.links.on || []).flatMap((ref) => {
      const [id, v] = split(ref), t = at(id, asOf), base = db.records[id].find((x) => x.v === v);
      if (!t) return [];
      if (t.ended && K.staleEnds.includes(t.state)) return [`on ${ref}: target ${t.state}${t.ended.into ? ' into ' + t.ended.into : ''}`];
      return canon(base.fields) !== canon(t.fields) ? [`on ${ref}, now @${t.v}`] : [];
    });
    if (stale.length) flags.stale = stale;
  }
  if (r.state === 'open') {
    const t = [r.in, r.to].find((x) => x && kindOf(x) === 'task' && at(x, asOf)?.ended);
    if (t) flags['under-ended-task'] = t;
  }
  return Object.keys(flags).length ? { ...r, flags } : r;
}

// The brief (3.5).
function brief(actor, tid, asOf) {
  if (!ACTORS.includes(actor)) refuse(`'${actor}' is not a declared actor`);
  const rs = all(asOf), get = (id) => at(id, asOf), task = get(tid);
  if (!task || task.kind !== 'task') refuse(`'${tid}' is not a task${asOf ? ' as of ' + asOf : ''}`);
  const open = rs.filter((r) => r.state === 'open');
  const shown = new Set([tid]);
  const full = (r) => (shown.add(r.id), view(r, asOf));
  const stageOf = (r) => r.fields.stage || r.by;

  const chain = [];
  for (let t = task; t && !chain.includes(t); t = t.in && get(t.in)) chain.push(t);
  const p1 = { id: tid, ref: task.fields.ref, 'done-when': task.fields['done-when'],
    asked: chain.filter((t) => t.fields.asked !== undefined).map((t) => ({ task: t.id, asked: t.fields.asked })) };

  let plans;
  if (task.links.piece) {
    let p = get(task.links.piece);
    for (const seen = new Set(); p && p.state === 'superseded' && !seen.has(p.id); seen.add(p.id)) p = get(p.ended.into);
    plans = p && !p.ended ? [p] : [];
  } else plans = rs.filter((r) => r.kind === 'plan' && r.in === tid && r.state === 'kept').sort((a, b) => (a.fields.order ?? 0) - (b.fields.order ?? 0));
  const p2 = plans.map((p) => (p.to === actor ? full(p) : (shown.add(p.id), { id: p.id, first: String(p.fields.says ?? '').split(/\n\s*\n/)[0] })));

  const runsHere = rs.filter((r) => r.kind === 'run' && r.in === tid);
  const leftBehind = (s) => runsHere.some((r) => stageOf(r) === s && r.ended) && !runsHere.some((r) => stageOf(r) === s && !r.ended);
  const endedKids = rs.filter((r) => r.kind === 'task' && r.in === tid && r.ended).map((r) => r.id);
  const p3 = open.filter((r) => (r.in === tid && r.to === actor) || r.to === tid
    || (r.in === tid && ACTORS.includes(r.to) && leftBehind(r.to))
    || endedKids.includes(r.in) || endedKids.includes(r.to)).map(full);

  const targets = new Set([tid, task.links.piece, ...plans.map((p) => p.id),
    ...rs.filter((r) => r.in === tid && (r.kind === 'change' || r.kind === 'plan')).map((r) => r.id)].filter(Boolean));
  const touches = (r) => [...(r.links.about || []), ...(r.links.on || [])].some((x) => targets.has(split(x)[0]));
  const covers = (r) => r.kind === 'decision' && (r.fields.scope === 'project' || chain.some((t) => t.id === r.fields.scope));
  const p4 = rs.filter((r) => (r.kind === 'verdict' || r.kind === 'decision') && !r.ended && (r.in === tid || touches(r) || covers(r))).map(full);

  const p5 = { 'open-to-project': open.filter((r) => r.to === 'project').length,
    'lessons-holding': rs.filter((r) => r.kind === 'lesson' && r.state === 'holds').length,
    lookup: ['find --to project --state open [--text <words>] --by <you>', 'find --kind lesson --state holds [--text <words>] --by <you>'] };

  open.filter((r) => r.kind === 'run' && r.in === tid && r.by === actor).forEach((r) => shown.add(r.id));
  const p6 = open.filter((r) => r.kind === 'run' && !shown.has(r.id)).map((r) => (shown.add(r.id), { id: r.id, task: r.in, stage: stageOf(r) }));
  const p7 = open.filter((r) => r.in === tid && !shown.has(r.id)).map((r) => (shown.add(r.id), { id: r.id, kind: r.kind, to: r.to, first: saying(r) }));
  const prev = rs.filter((r) => r.kind === 'run' && r.in === tid && r.ended && r.by !== actor).sort((a, b) => (a.at < b.at ? -1 : 1)).pop();
  const p8 = prev ? { id: prev.id, stage: stageOf(prev), first: firstLine(prev.fields.account) } : null;
  if (prev) shown.add(prev.id);

  const parts = { task: p1, plan: p2, addressed: p3, stands: p4, project: p5, runs: p6, index: p7, previous: p8 };
  const text = render(actor, asOf, parts);
  return { actor, task: tid, asOf, carries: [...shown], bytes: Buffer.byteLength(text), parts, text };
}

function recordText(r) {
  const head = `${r.id} ${r.kind} [${r.state}] v${r.v} by ${r.by}${r.via ? ' via ' + r.via : ''} at ${r.at}${r.in ? ' in ' + r.in : ''}${r.to ? ' to ' + r.to : ''}`;
  const lines = [head, ...Object.entries(r.fields).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(' | ') : String(v).replace(/\n/g, '\n    ')}`)];
  const links = Object.entries(r.links).map(([t, v]) => `${t}=${[].concat(v).join(',')}`);
  if (links.length) lines.push(`  links: ${links.join(' ')}`);
  if (r.flags?.answered) lines.push(`  answered by ${r.flags.answered.by}: ${r.flags.answered.answer}`);
  for (const s of r.flags?.stale || []) lines.push(`  STALE: ${s}`);
  if (r.flags?.['under-ended-task']) lines.push(`  under ended task ${r.flags['under-ended-task']}`);
  return lines.join('\n');
}
function render(actor, asOf, p) {
  const sec = (title, items) => [`## ${title}`, ...(items.length ? items : ['(none)'])].join('\n');
  return [
    `# Brief for ${actor} on ${p.task.id}${asOf ? ' as of ' + asOf : ''}`,
    sec('1 The task and the person\'s words', [`${p.task.id}${p.task.ref ? ' ref ' + p.task.ref : ''}${p.task['done-when'] ? '\ndone when: ' + p.task['done-when'] : ''}`,
      ...p.task.asked.map((a) => `asked (${a.task}):\n${a.asked}`)]),
    sec('2 Its plan', p.plan.map((x) => (x.kind ? recordText(x) : `${x.id}: ${x.first} (get ${x.id})`))),
    sec('3 Addressed to it', p.addressed.map(recordText)),
    sec('4 What stands', p.stands.map(recordText)),
    sec('5 The project', [`${p.project['open-to-project']} open addressed to project; ${p.project['lessons-holding']} lessons hold. Look up: ${p.project.lookup.join('; ')}`]),
    sec('6 Other open runs', p.runs.map((r) => `${r.id} ${r.task ?? 'project'} ${r.stage}`)),
    sec('7 Index', p.index.map((r) => `${r.id} ${r.kind} to=${r.to ?? '-'} ${r.first}`)),
    sec('8 The previous stage', p.previous ? [`${p.previous.id} ${p.previous.stage}: ${p.previous.first} (get ${p.previous.id})`] : []),
  ].join('\n\n');
}

const queries = {
  get([ref], o) {
    if (!ref) usage('get <id>[@<v>] --by <actor>');
    const [id, v] = split(ref);
    if (!db.records[id]) refuse(`no record '${id}'`);
    if (v !== undefined) return view(db.records[id].find((x) => x.v === v && (!o.asOf || x.at <= o.asOf)) || refuse(`${id} has no version ${v}${o.asOf ? ' as of ' + o.asOf : ''}`), o.asOf);
    const c = at(id, o.asOf) || refuse(`${id} did not exist as of ${o.asOf}`);
    return { ...view(c, o.asOf), versions: db.records[id].filter((x) => x.v <= c.v) };
  },
  find(_, o) {
    const rs = all(o.asOf).filter((r) => (!o.kind || r.kind === o.kind)
      && (!o.in || (o.in === 'project' ? !r.in : r.in === o.in)) && (!o.to || r.to === o.to) && (!o.state || r.state === o.state)
      && (!o.text || Object.values(r.fields).join('\n').toLowerCase().includes(o.text.toLowerCase())));
    return o.count ? { count: rs.length } : { records: rs.map((r) => view(r, o.asOf)) };
  },
  show(_, o) {
    if (!o.task) usage('show --task <id> --by <actor>');
    const t = at(o.task, o.asOf);
    if (!t || t.kind !== 'task') refuse(`'${o.task}' is not a task${o.asOf ? ' as of ' + o.asOf : ''}`);
    return { task: view(t, o.asOf), records: all(o.asOf).filter((r) => r.in === o.task).map((r) => view(r, o.asOf)) };
  },
};

const FLAGS = { add: ['by', 'via', 'at'], revise: ['by', 'via', 'at', 'reason'], end: ['by', 'via', 'at', 'into'], link: ['by', 'via', 'at'],
  brief: ['task', 'as-of', 'text'], get: ['by', 'as-of'], show: ['by', 'as-of', 'task'], find: ['by', 'as-of', 'kind', 'in', 'to', 'state', 'text', 'count'] };
const BOOLS = { brief: ['text'], find: ['count'] };

function parse(cmd, args) {
  const pos = [], o = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { pos.push(args[i]); continue; }
    const f = args[i].slice(2);
    if (!FLAGS[cmd].includes(f)) usage(`unknown flag --${f} for ${cmd}; flags: ${FLAGS[cmd].map((x) => '--' + x).join(' ')}`);
    if ((BOOLS[cmd] || []).includes(f)) o[f] = true;
    else if (args[i + 1] === undefined) usage(`--${f} needs a value`);
    else o[f] = args[++i];
  }
  o.at = time(o.at, 'at');
  o.asOf = time(o['as-of'], 'as-of');
  return { pos, o };
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (!FLAGS[cmd]) usage('commands: add, revise, end, link, brief, show, get, find');
  const { pos, o } = parse(cmd, args);
  let out;
  if (cmd === 'brief') {
    if (!pos[0] || !o.task) usage('brief <actor> --task <id> [--as-of <time>] [--text]');
    out = brief(pos[0], o.task, o.asOf || new Date().toISOString());
    db.log.push({ at: new Date().toISOString(), by: pos[0], cmd, args, asOf: o.asOf ?? null });
    save();
    if (o.text) { process.stdout.write(out.text + '\n'); process.exit(0); }
    delete out.text;
  } else {
    if (!o.by) usage(`${cmd} needs --by <actor>`);
    if (writes[cmd]) out = writes[cmd](pos, o);
    else {
      if (!ACTORS.includes(o.by)) refuse(`by '${o.by}' is not a declared actor (actors.json)`);
      out = queries[cmd](pos, o);
      db.log.push({ at: new Date().toISOString(), by: o.by, cmd, args, asOf: o.asOf ?? null });
      save();
    }
  }
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  if (!(e instanceof Fail)) throw e;
  console.log(JSON.stringify({ error: e.message }));
  process.exit(e.code);
}
