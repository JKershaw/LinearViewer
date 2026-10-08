import { measure } from './harness.mjs';
const LV = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const { loadCases, applyOverrides } = await import(`${LV}/scripts/eval/jev-routing-eval.mjs`);
const cases = loadCases(); applyOverrides(cases);
const rows = cases.map(c => {
  const b = c.bundle;
  const context = { parent: b.parent, siblings: b.siblings || [], siblingsTotal: b.siblingsTotal || 0, project: b.project, children: b.children || [], comments: b.comments || [], focusedChild: b.focusedChild || null, runs: b.runHistory?.runs || [] };
  return { id: c.id, ...measure(b.issue, context) };
});
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const keys = ['total', 'header', 'description', 'rawDescription', 'comments', 'commentsAll', 'facts', 'stages', 'rules', 'reply'];
console.log('part'.padEnd(16), 'median', 'p90', 'max', 'sum-share');
const totalSum = rows.reduce((n, r) => n + r.total, 0);
for (const k of keys) { const v = rows.map(r => r[k]); console.log(k.padEnd(16), String(q(v, .5)).padStart(6), String(q(v, .9)).padStart(6), String(Math.max(...v)).padStart(6), (v.reduce((a, b) => a + b, 0) / totalSum * 100).toFixed(1) + '%'); }
console.log('n', rows.length, 'with runs', cases.filter(c => c.bundle.runHistory?.runs?.length).length);
console.log('biggest:', rows.sort((a, b) => b.total - a.total).slice(0, 6).map(r => `${r.id}:${r.total}`).join(' '));
