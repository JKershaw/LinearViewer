#!/usr/bin/env node
// The layer: one generic record, kinds from kinds.json, one JSON store. See BUILD-NOTES.md.
import fs from 'node:fs';

const KINDS = JSON.parse(fs.readFileSync(new URL('./kinds.json', import.meta.url), 'utf8'));
const LINK_TYPES = ['about', 'answers', 'same-as', 'on'];
const END_OF_TIME = '9999-12-31T23:59:59.999Z';
const USAGE = `usage: node layer.mjs <command> [--store path] [--retro] [--at time] [--by who] [--via who]
  add <kind> '<json>'             revise <id> '<json>' <reason>
  end <id> <state> <reason> [--target id]   link <id> <type> <target>
  brief <reader> --task <id> [--as-of time]   check   hits`;

// ---- args, output, store
const pos = [], opt = {};
for (let a = process.argv.slice(2), i = 0; i < a.length; i++) {
  if (a[i] === '--retro') opt.retro = true;
  else if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[++i];
  else pos.push(a[i]);
}
const out = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); process.exit(code); };
const fail = (obj, code = 1) => out({ ok: false, ...obj }, code);

const storePath = opt.store || './store.json';
const store = fs.existsSync(storePath)
  ? JSON.parse(fs.readFileSync(storePath, 'utf8'))
  : { retro: !!opt.retro, next: {}, records: {}, hits: [] };
const retro = store.retro || !!opt.retro;
const save = () => fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n');

const time = (s, name) => {
  if (s === undefined) return new Date().toISOString();
  const d = new Date(s);
  return isNaN(d) ? fail({ refused: [{ field: name, message: `not an ISO time: ${s}` }] }) : d.toISOString();
};
const parseJson = (s) => {
  try { const v = JSON.parse(s ?? '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  return fail({ refused: [{ field: 'json', message: 'fields must be a JSON object' }] });
};

// ---- references: kind-n, kind-n#piece, kind-n@version
const REF = /^([a-z]+)-(\d+)(?:([#@])(.+))?$/;
const parseRef = (s) => {
  const m = typeof s === 'string' && s.match(REF);
  return m && KINDS[m[1]] ? { kind: m[1], id: `${m[1]}-${m[2]}`, sep: m[3], rest: m[4] } : null;
};
const refsOf = (r, name) => [...[].concat(r.fields[name] ?? []), ...r.links.filter((l) => l.type === name).map((l) => l.to)];
const fieldRefs = (r) => [r.in, r.to, r.target, ...Object.values(r.fields).flatMap((v) => (Array.isArray(v) ? v : [v]))]
  .filter((s) => parseRef(s));

// ---- versions and views
const versionAt = (rec, t) => rec.versions.filter((x) => x.at <= t).at(-1);
const snap = (rec, x) => x && { id: rec.id, kind: rec.kind, ...x };
const viewAt = (t) => Object.fromEntries(Object.values(store.records)
  .map((rec) => [rec.id, snap(rec, versionAt(rec, t))]).filter(([, r]) => r));
const live = (r) => r.state === 'open' || (KINDS[r.kind].live || []).includes(r.state);
// a version is superseded once a later *revise* exists (links and ends don't move content)
const superseded = (id, v, t) => (store.records[id]?.versions || []).some((x) => x.v > v && x.op === 'revise' && x.at <= t);
const resolves = (s, V, t) => {
  const p = parseRef(s);
  if (!p) return false;
  const r = V[p.id];
  if (!r) return false;
  if (p.sep === '#') return r.fields.pieces?.[p.rest] !== undefined;
  if (p.sep === '@') return store.records[p.id].versions.some((x) => x.v === +p.rest && x.at <= t);
  return true;
};

// ---- §3.2 field checks (always refusals)
function fieldFailures(r) {
  const K = KINDS[r.kind], f = [], no = (field, message) => f.push({ field, message });
  for (const k of Object.keys(r.fields)) if (!K.fields.includes(k)) no(k, `${r.kind} has no field ${k}`);
  for (const k of K.required || []) if (r.fields[k] === undefined || r.fields[k] === '') no(k, `${r.kind} needs ${k}`);
  for (const [k, vals] of Object.entries(K.values || {}))
    if (r.fields[k] !== undefined && !vals.includes(r.fields[k])) no(k, `${k} must be one of ${vals.join(', ')}`);
  if (r.to !== undefined) {
    const p = parseRef(r.to);
    if (!K.to) no('to', `${r.kind} takes no to`);
    else if (typeof r.to !== 'string') no('to', 'to names one addressee');
    else if (p ? !K.to.includes(p.kind) : K.to.every((x) => KINDS[x])) no('to', `${r.kind} is addressed to: ${K.to.join(', ')}`);
  }
  if (r.state !== 'open' && !K.ends.includes(r.state)) no('state', `${r.kind} ends: ${K.ends.join(', ')}`);
  if (r.state !== 'open' && !r.reason) no('reason', 'an end needs a reason');
  if ((K.endTarget || []).includes(r.state) && !r.target) no('target', `${r.state} needs --target <record>`);
  return f;
}

// ---- §3.3 rules (refusals in motion, hits in retro)
function ruleFailures(id, t) {
  const V = viewAt(t), r = V[id], K = KINDS[r.kind], all = Object.values(V), f = [];
  const hit = (rule, message) => f.push({ rule, message });
  const questionsOf = (d) => [...refsOf(d, 'basis'), ...refsOf(d, 'answers')]
    .map(parseRef).filter((p) => p && V[p.id]?.kind === 'question').map((p) => p.id);

  if (r.kind === 'task' && r.state !== 'open') {
    const open = all.filter((x) => x.to === id && x.state === 'open').map((x) => x.id);
    if (open.length) hit(1, `${id} can't close while records addressed to it are open: ${open.join(', ')}`);
  }
  if (r.kind === 'finding' && r.state === 'done') {
    const created = store.records[id].versions[0].at;
    for (const p of refsOf(r, 'about').map(parseRef).filter((p) => p && V[p.id]?.kind === 'plan'))
      if (!store.records[p.id].versions.some((x) => x.op === 'revise' && x.at > created && x.at <= r.at))
        hit(2, `${id} is about ${p.id}; it can't end done without a newer version of that plan`);
  }
  if (r.kind === 'decision' && live(r))
    for (const q of questionsOf(r)) {
      const others = all.filter((x) => x.kind === 'decision' && x.id !== id && live(x) && questionsOf(x).includes(q));
      if (others.length) hit(3, `${q} already has a decision (${others.map((x) => x.id).join(', ')}); a second decider is refused`);
    }
  if (r.kind === 'verdict' && live(r))
    for (const s of refsOf(r, 'on')) {
      const p = parseRef(s);
      if (p && p.sep !== '@') hit(4, `a verdict is on one version (id@v), not ${s}`);
      else if (p && superseded(p.id, +p.rest, t)) hit(4, `${s} is superseded; the verdict would be stale`);
    }
  if (K.handoff && !r.to) hit(5, `${r.kind} is a hand-off kind and needs to`);
  for (const s of fieldRefs(r)) if (!resolves(s, V, t)) hit(6, `${s} does not resolve`);
  for (const l of r.links)
    if (parseRef(l.to) ? !resolves(l.to, V, t) : l.type !== 'on') hit(6, `link ${l.type} ${l.to} does not resolve`);
  return f;
}

// ---- writes
function write(rec, change, after) {
  const at = time(opt.at, 'at'), prev = rec.versions.at(-1);
  if (!opt.by) fail({ refused: [{ field: 'by', message: 'every write needs --by' }] });
  if (prev && at < prev.at) fail({ refused: [{ field: 'at', message: `${at} is before ${rec.id}'s last version (${prev.at})` }] });
  const base = prev ? { fields: prev.fields, in: prev.in, to: prev.to, state: prev.state, reason: prev.reason, target: prev.target, links: prev.links } : {};
  const x = { v: rec.versions.length + 1, at, by: opt.by, via: opt.via, ...base, ...change };
  const ff = fieldFailures(snap(rec, x));
  if (ff.length) fail({ refused: ff });
  store.records[rec.id] = rec;
  rec.versions.push(x);
  const hits = ruleFailures(rec.id, at);
  if (hits.length && !retro) fail({ refused: hits });
  const logged = hits.map((h) => ({ record: rec.id, ...h, at }));
  store.hits.push(...logged);
  after?.(at);
  save();
  out({ ok: true, record: snap(rec, x), ...(retro && { hits: logged }) });
}

// rule 4: revising a record makes live verdicts on its older versions stale
function staleVerdicts(rec, at) {
  for (const vr of Object.values(store.records)) {
    const x = vr.versions.at(-1);
    if (vr.kind !== 'verdict' || !live(snap(vr, x))) continue;
    const moved = refsOf(x, 'on').some((s) => { const p = parseRef(s); return p?.id === rec.id && p.sep === '@' && superseded(rec.id, +p.rest, at); });
    if (moved) vr.versions.push({ ...x, v: vr.versions.length + 1, op: 'end', at, by: 'layer', via: undefined, note: undefined,
      state: 'stale', reason: `${rec.id} revised to v${rec.versions.length}` });
  }
}
const getRec = (id) => store.records[id] || fail({ refused: [{ field: 'id', message: `no record ${id}` }] });

// ---- brief (§3.4)
function brief(reader, taskId, t) {
  const V = viewAt(t), task = V[taskId], all = Object.values(V);
  if (!task || task.kind !== 'task') fail({ refused: [{ field: 'task', message: `no task ${taskId} as of ${t}` }] });
  const plans = refsOf(task, 'about').map(parseRef).filter((p) => p && V[p.id]?.kind === 'plan');
  const pieces = plans.map((p) => ({ ref: p.sep === '#' ? `${p.id}#${p.rest}` : p.id, version: V[p.id].v,
    text: p.sep === '#' ? V[p.id].fields.pieces?.[p.rest] : V[p.id].fields.pieces }));
  const areas = [task.in, ...refsOf(task, 'about')].map(parseRef).filter((p) => p && V[p.id]?.kind === 'area').map((p) => p.id);
  const paths = areas.flatMap((a) => [].concat(V[a].fields.paths ?? [])).filter((p) => typeof p === 'string' && p);
  const overlap = (ps) => [].concat(ps ?? []).some((p) => typeof p === 'string' && paths.some((q) => p.startsWith(q) || q.startsWith(p)));
  const touches = (r) => areas.includes(r.to) || refsOf(r, 'about').some((s) => areas.includes(parseRef(s)?.id)) || overlap(r.fields.about);

  const addressed = all.filter((r) => r.state === 'open' && (r.to === reader || r.to === taskId));
  const seen = new Set(addressed.map((r) => r.id));
  const decisions = all.filter((r) => r.kind === 'decision' && r.in === taskId && live(r));
  const lessons = all.filter((r) => r.kind === 'lesson' && live(r) && touches(r) && !seen.has(r.id));
  const findings = all.filter((r) => r.kind === 'finding' && r.state === 'open' && touches(r) && !seen.has(r.id));
  const checks = all.filter((r) => r.kind === 'check' && r.state === 'open' && r.in === taskId && !seen.has(r.id));

  const item = (r) => ({ id: r.id, kind: r.kind, state: r.state, by: r.by, ...(r.to && { to: r.to }), ...r.fields });
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const line = (r) => `- ${r.id} [${r.state}]${r.to ? ` to ${r.to}` : ''} by ${r.by}: ` +
    Object.entries(r.fields).map(([k, v]) => `${k}: ${show(v)}`).join('; ');
  const sec = (title, rs, fn = line) => (rs.length ? [`${title}:`, ...rs.map(fn)] : []);
  const text = [
    `Brief for ${reader} on ${taskId} as of ${t}`,
    `Asked: ${task.fields.asked ?? '(none: see plan piece)'}`,
    ...pieces.map((p) => `Plan piece ${p.ref} (v${p.version}): ${show(p.text)}`),
    ...sec('Open, addressed to you or this task', addressed),
    ...sec('Decisions on the task', decisions),
    ...sec('Lessons for its areas and paths', lessons),
    ...sec('Open findings for its areas and paths', findings),
    ...sec('Open checks', checks, (r) => `- ${r.id} [${r.state}]`),
  ].join('\n');

  const carried = [...addressed, ...decisions, ...lessons, ...findings, ...checks];
  const records = {};
  for (const r of [task, ...plans.map((p) => V[p.id]), ...carried]) records[r.kind] = (records[r.kind] || 0) + 1;
  const carries = { open: carried.filter((r) => r.state === 'open').length, instructions: addressed.length };
  const size = { chars: text.length, records };
  return {
    ok: true, reader, task: taskId, asOf: t, asked: task.fields.asked ?? null, pieces,
    addressed: addressed.map(item), decisions: decisions.map(item), lessons: lessons.map(item),
    findings: findings.map(item), checks: checks.map((r) => ({ id: r.id, state: r.state })),
    carries, size,
    text: `${text}\nCarries ${carries.open} open, ${carries.instructions} instructions; size ${size.chars} chars; records: ` +
      Object.entries(records).map(([k, n]) => `${k} ${n}`).join(', '),
  };
}

// ---- commands
const [cmd, a1, a2, a3] = pos;
switch (cmd) {
  case 'add': {
    if (!KINDS[a1]) fail({ refused: [{ field: 'kind', message: `unknown kind ${a1}; declared: ${Object.keys(KINDS).join(', ')}` }] });
    const { in: inn, to, ...fields } = parseJson(a2);
    const id = `${a1}-${(store.next[a1] = (store.next[a1] || 0) + 1)}`;
    write({ id, kind: a1, versions: [] }, { op: 'add', fields, in: inn, to, state: 'open', links: [] });
    break;
  }
  case 'revise': {
    const rec = getRec(a1), prev = rec.versions.at(-1), data = parseJson(a2);
    if (!a3) fail({ refused: [{ field: 'reason', message: 'a revision needs a reason' }] });
    const { in: inn, to, ...changed } = data;
    for (const k of KINDS[rec.kind].fixed || [])
      if (k in changed && JSON.stringify(changed[k]) !== JSON.stringify(prev.fields[k])) fail({ refused: [{ field: k, message: `${k} is fixed` }] });
    const fields = Object.fromEntries(Object.entries({ ...prev.fields, ...changed }).filter(([, v]) => v !== null));
    write(rec, { op: 'revise', note: a3, fields, ...('in' in data && { in: inn }), ...('to' in data && { to }) },
      (at) => staleVerdicts(rec, at));
    break;
  }
  case 'end': {
    const rec = getRec(a1);
    if (!a2 || a2 === 'open') fail({ refused: [{ field: 'state', message: `${rec.kind} ends: ${KINDS[rec.kind].ends.join(', ')}` }] });
    write(rec, { op: 'end', state: a2, reason: a3, target: opt.target });
    break;
  }
  case 'link': {
    const rec = getRec(a1);
    if (!LINK_TYPES.includes(a2)) fail({ refused: [{ field: 'type', message: `link types: ${LINK_TYPES.join(', ')}` }] });
    if (!a3) fail({ refused: [{ field: 'target', message: 'link needs a target' }] });
    write(rec, { op: 'link', links: [...rec.versions.at(-1).links, { type: a2, to: a3 }] });
    break;
  }
  case 'brief':
    if (!a1 || !opt.task) fail({ error: USAGE }, 2);
    out(brief(a1, opt.task, opt['as-of'] ? time(opt['as-of'], 'as-of') : new Date().toISOString()));
    break;
  case 'check': {
    const failures = Object.entries(KINDS).filter(([, K]) => K.handoff && !(K.ends || []).length)
      .map(([kind]) => ({ kind, rule: 5, message: `hand-off kind ${kind} declares no ends` }));
    for (const rec of Object.values(store.records))
      for (const f of [...fieldFailures(snap(rec, rec.versions.at(-1))), ...ruleFailures(rec.id, END_OF_TIME)])
        failures.push({ record: rec.id, ...f });
    out({ ok: !failures.length, retro, failures }, failures.length ? 1 : 0);
    break;
  }
  case 'hits':
    out({ ok: true, retro, hits: store.hits });
    break;
  default:
    fail({ error: USAGE }, 2);
}
