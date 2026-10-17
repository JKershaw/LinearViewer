// Rough census of the session-record schema shared through state/sessions.json (the coupling the
// import map cannot see). APPROXIMATION: a "session record" is any object reached through an
// identifier named session|s|sess|entry|existing|prev|rec|target|current|fresh, or through
// `.sessions[...]`; a field is WRITTEN where it is an assignment target / delete target, READ
// otherwise. Common JS names (length, then, ...) and methods are excluded.
import { resolveCommit, show, parse, walk, productionJs, areaOf, churn } from './lib.mjs';
const commit = resolveCommit(process.argv[2] || 'HEAD');
const SESSION_IDS = /^(session|s|sess|entry|existing|prev|rec|target|current|fresh)$/;
const SKIP = new Set(['length', 'then', 'catch', 'push', 'map', 'filter', 'slice', 'includes', 'trim', 'split', 'join', 'toString', 'sessions', 'hasOwnProperty', 'forEach', 'find', 'some', 'every', 'startsWith']);
const fields = new Map();
const { perFile } = churn(commit);
for (const f of productionJs(commit)) {
  const ast = parse(show(commit, f));
  walk.fullAncestor(ast, (n, _s, anc) => {
    if (n.type !== 'MemberExpression' || n.computed) return;
    const o = n.object;
    const isSession = (o.type === 'Identifier' && SESSION_IDS.test(o.name)) ||
      (o.type === 'MemberExpression' && o.computed && o.object.type === 'MemberExpression' && o.object.property.name === 'sessions');
    if (!isSession) return;
    const name = n.property.name; if (!name || SKIP.has(name)) return;
    const p = anc[anc.length - 2];
    const write = (p.type === 'AssignmentExpression' && p.left === n) || (p.type === 'UnaryExpression' && p.operator === 'delete');
    if (p.type === 'CallExpression' && p.callee === n) return; // method call
    if (!fields.has(name)) fields.set(name, { w: new Set(), r: new Set() });
    fields.get(name)[write ? 'w' : 'r'].add(f);
  });
}
const rows = [...fields].map(([k, v]) => {
  const files = new Set([...v.w, ...v.r]); const areas = new Set([...files].map(areaOf));
  const change = [...files].reduce((s, f) => s + (perFile.get(f) || 0), 0);
  return { k, writers: [...v.w], readers: [...v.r].filter(x => !v.w.has(x)), files: files.size, areas: areas.size, score: files.size * change };
}).filter(r => r.writers.length >= 1 && r.areas >= 3).sort((a, b) => b.score - a.score);
console.log(`commit ${commit}: session-record fields touched in >= 3 areas: ${rows.length} (of ${fields.size} fields seen)`);
for (const r of rows.slice(0, 20)) console.log(`  ${String(r.score).padStart(5)}  ${r.k.padEnd(26)} files ${r.files} areas ${r.areas}  written in: ${r.writers.join(', ')}`);
