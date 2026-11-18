#!/usr/bin/env node
// The layer model (§3–§4): one generic record, kinds.json, actors.json, one JSON store.
import fs from 'node:fs';

const here = (f) => new URL(f, import.meta.url);
const K = JSON.parse(fs.readFileSync(here('kinds.json')));
const A = JSON.parse(fs.readFileSync(here('actors.json')));
const FILE = process.env.LAYER_STORE || here('store.json');
const S = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : { next: 1, records: {}, log: [] };
const save = () => fs.writeFileSync(FILE, JSON.stringify(S, null, 2) + '\n');
const now = new Date().toISOString();

const fail = (code, error) => { throw { code, error }; };
const usage = (m) => fail(1, m);
const refuse = (m) => fail(2, m);
const time = (t) => { if (t === undefined) return undefined; const d = new Date(t); if (isNaN(d)) usage(`bad time: ${t}`); return d.toISOString(); };
const json = (s) => { try { const o = JSON.parse(s); if (o && typeof o === 'object' && !Array.isArray(o)) return o; } catch {} usage('body must be a JSON object'); };

// ---- reading the store ----
const vers = (id, asOf) => (S.records[id] || []).filter((x) => !asOf || x.at <= asOf);
const cur = (id, asOf) => vers(id, asOf).at(-1);
const all = (asOf) => Object.keys(S.records).map((id) => cur(id, asOf)).filter(Boolean);
const split = (ref) => { const [id, v] = String(ref).split('@'); return [id, v === undefined ? undefined : Number(v)]; };
const isTask = (id, asOf) => cur(id, asOf)?.kind === 'task';
const ended = (r) => r.state !== K.kinds[r.kind].start;
const stageOf = (r) => r.fields.stage ?? r.by;
const firstLine = (s) => (s === undefined ? undefined : String(s).split('\n')[0]);
const say = (r) => { const f = Object.entries(K.kinds[r.kind].fields).find(([n, t]) => t === 'text' && r.fields[n] !== undefined); return f ? firstLine(r.fields[f[0]]) : ''; };
const JUDGES = Object.keys(K.outcomes);

// A blind actor sees no verdicts but its own, and no accounts of runs by verdict-writing stages.
function seen(r, who) {
  if (!r || !A[who]?.blind) return r;
  if (r.kind === 'verdict' && r.by !== who) return null;
  if (r.kind === 'run' && JUDGES.includes(stageOf(r)) && r.by !== who) { const { account, ...fields } = r.fields; return { ...r, fields }; }
  return r;
}

// Views computed when read: stale, answered, under an ended task.
function flags(r, asOf) {
  const o = { ...r };
  if ((r.kind === 'verdict' || r.kind === 'decision') && !ended(r)) {
    const stale = (r.links.on || []).flatMap((ref) => {
      const [id, v] = split(ref); const t = cur(id, asOf);
      if (!t) return [];
      if (K.staleEnds.includes(t.state)) return [`on ${ref}, now ${t.state}`];
      return JSON.stringify(S.records[id][v - 1].fields) !== JSON.stringify(t.fields) ? [`on ${ref}, now @${t.v}`] : [];
    });
    if (stale.length) o.stale = stale;
  }
  if (r.kind === 'question') {
    const d = all(asOf).find((d) => d.kind === 'decision' && d.state === 'stands' && d.links.answers === r.id);
    if (d) o.answered = d;
  }
  if (r.state === 'open') {
    const t = [r.in, r.to].find((x) => { const t = cur(x, asOf); return t?.kind === 'task' && ended(t); });
    if (t) o.underEnded = t;
  }
  return o;
}

// ---- what a write checks: shape only ----
function check(r, prev) {
  const k = K.kinds[r.kind] || refuse(`unknown kind: ${r.kind}`);
  if (!A[r.by]) refuse(`by is not a declared actor: ${r.by}`);
  for (const [f, val] of Object.entries(r.fields)) {
    const t = k.fields[f] || refuse(`field ${f} does not belong to ${r.kind}`);
    const ok = t === 'number' ? typeof val === 'number'
      : t === 'list' ? Array.isArray(val) && val.every((s) => typeof s === 'string')
      : typeof val !== 'string' ? false
      : t === 'actor' ? !!A[val]
      : t === 'scope' ? val === 'project' || isTask(val)
      : t === 'judgement' ? JUDGES.includes(val)
      : t === 'outcome' ? (K.outcomes[r.fields.judgement] || []).includes(val)
      : true;
    if (!ok) refuse(`field ${f} is not a valid ${t}: ${JSON.stringify(val)}`);
  }
  if (prev?.fields.asked !== undefined && r.fields.asked !== prev.fields.asked) refuse("a task's asked is fixed once written");
  if (r.to !== undefined && !(r.to === 'project' || A[r.to] || isTask(r.to))) refuse(`to is not an actor, a task or project: ${r.to}`);
  if (k.handoff && r.to === undefined) refuse(`a ${r.kind} must have a to`);
  if (r.in !== undefined && !isTask(r.in)) refuse(`in is not a task: ${r.in}`);
  if (!r.links || typeof r.links !== 'object' || Array.isArray(r.links)) refuse('links must be an object');
  for (const [type, val] of Object.entries(r.links)) {
    const L = K.links[type] || refuse(`unknown link type: ${type}`);
    if (L.one ? typeof val !== 'string' : !Array.isArray(val)) refuse(`link ${type} holds ${L.one ? 'one id' : 'a list'}`);
    if (L.from && r.kind !== L.from) refuse(`${type} joins a ${L.from} to a ${L.to}`);
    for (const ref of [].concat(val)) {
      const [id, v] = split(ref); const t = cur(id);
      if (!t || (v !== undefined && !S.records[id][v - 1])) refuse(`link ${type} does not resolve: ${ref}`);
      if (L.to && t.kind !== L.to) refuse(`${type} joins a ${L.from} to a ${L.to}`);
    }
  }
  for (const l of k.needs || []) if (!r.links[l]?.length) refuse(`a ${r.kind} must have ${l}`);
}
// `on` names exact versions: a bare id is pinned to its current version.
const pin = (links) => Object.fromEntries(Object.entries(links || {}).map(([t, val]) => [t,
  K.links[t]?.pin && Array.isArray(val) ? val.map((ref) => (String(ref).includes('@') || !cur(ref) ? ref : `${ref}@${cur(ref).v}`)) : val]));

// ---- CLI ----
const FLAGS = { add: 'by via at', revise: 'by via at reason', end: 'by via at into', link: 'by via at',
  brief: 'task as-of text', show: 'by as-of task', get: 'by as-of', find: 'by as-of kind in to state text count' };
const [cmd, ...rest] = process.argv.slice(2);
const bools = cmd === 'brief' ? ['text'] : ['count'];
const pos = []; const opt = {};

function main() {
  if (!FLAGS[cmd]) usage('commands: add, revise, end, link, brief, show, get, find');
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) { pos.push(rest[i]); continue; }
    const k = rest[i].slice(2);
    if (!FLAGS[cmd].split(' ').includes(k)) usage(`unknown flag for ${cmd}: --${k}`);
    if (bools.includes(k)) opt[k] = true; else if (i + 1 < rest.length) opt[k] = rest[++i]; else usage(`--${k} needs a value`);
  }
  if (cmd === 'brief') return brief(pos[0] || usage('brief <actor> --task <id>'), opt.task || usage('brief needs --task'), time(opt['as-of']));
  if (!opt.by) usage('--by is required');
  return ['add', 'revise', 'end', 'link'].includes(cmd) ? write() : query();
}

function write() {
  const snap = (o) => ({ id: o.id, kind: o.kind, v: o.v, op: cmd, at: time(opt.at) ?? now, by: opt.by, via: opt.via, reason: o.reason,
    in: o.in, to: o.to, state: o.state, ended: o.ended, links: o.links, fields: o.fields });
  let r;
  if (cmd === 'add') {
    const [kind, body] = pos; if (!body) usage("add <kind> '<json>'");
    const { in: inT, to, links = {}, ...fields } = json(body);
    r = snap({ id: `${kind}-${S.next}`, kind, v: 1, in: inT, to, state: K.kinds[kind]?.start, links: pin(links), fields });
    check(r); S.next++;
  } else {
    const p = cur(pos[0] || usage(`${cmd} <id> …`)) || refuse(`no such record: ${pos[0]}`);
    const base = { ...p, v: p.v + 1, reason: undefined };
    if (cmd === 'revise') {
      if (!pos[1]) usage("revise <id> '<json>' --reason <r>"); if (!opt.reason) usage('revise needs --reason');
      const { in: inT, to, links, ...fields } = json(pos[1]);
      r = snap({ ...base, reason: opt.reason, in: inT ?? p.in, to: to ?? p.to, links: { ...p.links, ...pin(links) }, fields: { ...p.fields, ...fields } });
    } else if (cmd === 'end') {
      const [, state, reason] = pos; if (!state) usage('end <id> <state> <reason> [--into <id>]');
      if (ended(p)) refuse(`${p.id} has already ended (${p.state})`);
      if (!K.kinds[p.kind].ends.includes(state)) refuse(`${state} is not an end of ${p.kind}`);
      if (!reason) refuse('a state change needs a reason');
      if (K.takeover.includes(state) && !opt.into) refuse(`${state} must name the record that takes over (--into)`);
      if (opt.into && !cur(opt.into)) refuse(`--into does not resolve: ${opt.into}`);
      r = snap({ ...base, state, ended: { reason, into: opt.into } });
    } else {
      const [, type, target] = pos; if (!target) usage('link <id> <type> <id[@v]>');
      const L = K.links[type] || refuse(`unknown link type: ${type}`);
      const val = pin({ [type]: L.one ? target : [target] })[type];
      r = snap({ ...base, links: { ...p.links, [type]: L.one ? val : [...new Set([...(p.links[type] || []), ...val])] } });
    }
    check(r, p);
  }
  (S.records[r.id] ||= []).push(r); save();
  return r;
}

function query() {
  if (!A[opt.by]) refuse(`by is not a declared actor: ${opt.by}`);
  const asOf = time(opt['as-of']); const by = opt.by;
  const view = (r) => flags(r, asOf);
  let res;
  if (cmd === 'get') {
    const [id, v] = split(pos[0] || usage('get <id>[@<v>]'));
    const vs = vers(id, asOf).map((x) => seen(x, by)).filter(Boolean);
    const one = v === undefined ? vs.at(-1) : vs.find((x) => x.v === v);
    if (!one) refuse(`no such record: ${pos[0]}`);
    res = v === undefined ? { ...view(one), versions: vs } : view(one);
  } else if (cmd === 'show') {
    const t = cur(opt.task || usage('show --task <id>'), asOf);
    if (t?.kind !== 'task') refuse(`no such task: ${opt.task}`);
    res = { task: view(t), records: all(asOf).filter((r) => r.in === t.id).map((r) => seen(r, by)).filter(Boolean).map(view) };
  } else {
    const rs = all(asOf).map((r) => seen(r, by)).filter(Boolean).filter((r) => (!opt.kind || r.kind === opt.kind)
      && (!opt.in || r.in === opt.in) && (!opt.to || r.to === opt.to) && (!opt.state || r.state === opt.state)
      && (!opt.text || JSON.stringify(r.fields).toLowerCase().includes(opt.text.toLowerCase())));
    res = opt.count ? { count: rs.length } : rs.map(view);
  }
  S.log.push({ at: now, by, cmd, args: rest, asOf: asOf ?? null }); save();
  return res;
}

function brief(actor, taskId, asOf) {
  if (!A[actor]) refuse(`not a declared actor: ${actor}`);
  const task = cur(taskId, asOf);
  if (task?.kind !== 'task') refuse(`no such task: ${taskId}`);
  const f = (r) => flags(r, asOf);
  const recs = all(asOf).map((r) => seen(r, actor)).filter(Boolean);
  const open = recs.filter((r) => r.state === 'open');
  const chain = [];
  for (let t = task; t && !chain.includes(t); t = t.in && cur(t.in, asOf)) chain.push(t);
  // 1. the task and the person's words
  const p1 = { id: task.id, ref: task.fields.ref, 'done-when': task.fields['done-when'],
    asked: chain.filter((t) => t.fields.asked !== undefined).map((t) => ({ task: t.id, asked: t.fields.asked })) };
  // 2. its plan
  let plan;
  if (task.links.piece) {
    let p = cur(task.links.piece, asOf); const hops = new Set();
    while (p?.state === 'superseded' && p.ended?.into && !hops.has(p.id)) { hops.add(p.id); p = cur(p.ended.into, asOf); }
    plan = p ? [p] : [];
  } else plan = recs.filter((r) => r.kind === 'plan' && r.in === task.id && r.state === 'kept');
  // 3. addressed to it
  const runs = recs.filter((r) => r.kind === 'run' && r.in === task.id);
  const left = (who) => who !== actor && A[who] && runs.some((r) => stageOf(r) === who) && runs.every((r) => stageOf(r) !== who || ended(r));
  const underChild = (r) => [r.in, r.to].some((x) => { const c = cur(x, asOf); return c?.kind === 'task' && c.in === task.id && ended(c); });
  const addressed = open.filter((r) => (r.in === task.id && (r.to === actor || left(r.to))) || r.to === task.id || underChild(r));
  // 4. what stands about this task
  const targets = [task.links.piece, ...plan.map((p) => p.id), ...recs.filter((r) => r.kind === 'change' && r.in === task.id).map((r) => r.id)];
  const touches = (r) => [...(r.links.about || []), ...(r.links.on || [])].some((ref) => targets.includes(split(ref)[0]));
  const ids = chain.map((t) => t.id);
  const stands = recs.filter((r) => (r.kind === 'verdict' || r.kind === 'decision') && r.state === 'stands'
    && (r.in === task.id || touches(r) || (r.kind === 'decision' && (r.fields.scope === 'project' || ids.includes(r.fields.scope)))));
  // 5. the project
  const project = { open: open.filter((r) => r.to === 'project').length, lessons: recs.filter((r) => r.kind === 'lesson' && r.state === 'holds').length,
    lookup: ['find --to project --text <words>', 'find --kind lesson --text <words>'] };
  // 6. other open runs
  const others = open.filter((r) => r.kind === 'run' && !(r.in === task.id && stageOf(r) === actor)).map((r) => ({ id: r.id, task: r.in, stage: stageOf(r) }));
  // 7. index of what else is known
  const shown = new Set([...plan, ...addressed, ...stands, ...others].map((r) => r.id));
  const index = open.filter((r) => r.in === task.id && !shown.has(r.id)).map((r) => ({ id: r.id, kind: r.kind, to: r.to, says: say(r) }));
  // 8. the previous stage
  const last = runs.filter((r) => ended(r) && stageOf(r) !== actor).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).at(-1);
  const previous = last ? { id: last.id, stage: stageOf(last), account: firstLine(last.fields.account) } : null;

  const parts = { task: p1, plan: plan.map(f), addressed: addressed.map(f), stands: stands.map(f), project, runs: others, index, previous };
  const carries = { asked: p1.asked.length, plan: plan.length, addressed: addressed.length, stands: stands.length,
    projectOpen: project.open, lessons: project.lessons, runs: others.length, index: index.length, previous: last ? 1 : 0 };
  const text = render(actor, asOf ?? now, parts);
  if (opt.text) return text;
  return { actor, task: task.id, asOf: asOf ?? now, carries, bytes: Buffer.byteLength(text), parts };
}

function render(actor, asOf, P) {
  const full = (r) => [`${r.id}@${r.v} ${r.kind} [${r.state}]${r.to ? ` to ${r.to}` : ''} by ${r.by}${r.via ? ` via ${r.via}` : ''} at ${r.at}`,
    ...Object.entries(r.fields).map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    ...Object.entries(r.links).map(([k, v]) => `  ${k} -> ${[].concat(v).join(', ')}`),
    ...(r.stale || []).map((s) => `  STALE ${s}`),
    ...(r.answered ? [`  answered by ${r.answered.id}: ${r.answered.fields.answer}`] : [])].join('\n');
  const sec = (h, lines) => [`## ${h}`, ...(lines.length ? lines : ['(none)'])];
  const t = P.task;
  return [`# Brief for ${actor} on ${t.id} as of ${asOf}`,
    ...sec('1. The task and the person\'s words', [`${t.id}${t.ref ? ` ref ${t.ref}` : ''}${t['done-when'] ? ` | done when: ${t['done-when']}` : ''}`,
      ...t.asked.map((a) => `asked (${a.task}): ${a.asked}`)]),
    ...sec('2. Its plan', P.plan.map(full)),
    ...sec('3. Addressed to you', P.addressed.map(full)),
    ...sec('4. What stands about this task', P.stands.map(full)),
    ...sec('5. The project', [`${P.project.open} open addressed to project (${P.project.lookup[0]}); ${P.project.lessons} lessons hold (${P.project.lookup[1]})`]),
    ...sec('6. Other open runs', P.runs.map((r) => `${r.id} in ${r.task} stage ${r.stage}`)),
    ...sec('7. Index of what else is known', P.index.map((r) => `${r.id} ${r.kind}${r.to ? ` to ${r.to}` : ''}: ${r.says}`)),
    ...sec('8. The previous stage', P.previous ? [`${P.previous.id} ${P.previous.stage}: ${P.previous.account ?? ''} (in full: get ${P.previous.id})`] : []),
  ].join('\n') + '\n';
}

try {
  const res = main();
  process.stdout.write(typeof res === 'string' ? res : JSON.stringify(res, null, 2) + '\n');
} catch (e) {
  if (typeof e?.code !== 'number') throw e;
  process.stdout.write(JSON.stringify({ error: e.error }) + '\n');
  process.exitCode = e.code;
}
