import fs from 'node:fs'; import path from 'node:path';
const W = process.argv[2];
const areas = JSON.parse(fs.readFileSync(W + '/docs/areas/areas.json', 'utf8')).areas.map(a => ({ ...a, rx: a.match.map(m => new RegExp(m)) }));
const areaOf = p => (areas.find(a => a.rx.some(r => r.test(p))) || {}).slug || null;
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else out.push(path.relative(W, p)); } return out; };
const lines = p => fs.readFileSync(path.join(W, p), 'utf8').split('\n').length - 1;
const all = [...walk(W + '/lib'), ...walk(W + '/routes'), ...walk(W + '/public'), 'server.js', ...walk(W + '/scripts')];
const T = {}; for (const a of areas) T[a.slug] = { name: a.name, files: [], jsL: 0, n: 0 };
const srcArea = {};
for (const p of all) {
  if (/\.test\.[cm]?js$/.test(p) || /\.min\.js$/.test(p) || !/\.[cm]?js$/.test(p)) continue;
  const a = areaOf(p); if (!a) continue;
  const L = lines(p); srcArea[p] = a; T[a].files.push([p, L]); T[a].jsL += L; T[a].n++;
}
const E = {}; // edges area->area : count of imports
for (const p of Object.keys(srcArea)) {
  const txt = fs.readFileSync(path.join(W, p), 'utf8');
  const seen = new Set();
  for (const m of txt.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"`]((?:\.\.?\/)[^'"`]+)['"`]/g)) {
    const r = path.normalize(path.join(path.dirname(p), m[1])); const b = srcArea[r]; const a = srcArea[p];
    if (b && a !== b && !seen.has(r)) { seen.add(r); const k = a + '>' + b; E[k] = (E[k] || 0) + 1; }
  }
}
const said = p => {
  const t = fs.readFileSync(path.join(W, p), 'utf8').slice(0, 30000).split('\n').filter((l, k) => !(k === 0 && l.startsWith('#!'))).join('\n');
  let m = t.match(/^\s*\/\*\*?([\s\S]*?)\*\//), body = '';
  if (m) body = m[1].split('\n').map(l => l.replace(/^\s*\*\s?/, '')).join('\n');
  else { const ls = []; for (const l of t.split('\n')) { if (/^\s*\/\//.test(l)) ls.push(l.replace(/^\s*\/\/\s?/, '')); else if (ls.length || l.trim()) break; } body = ls.join('\n'); }
  const paras = body.split(/\n\s*\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!paras.length) return '';
  let s = paras[0]; if (s.length < 40 && paras[1] && !/[.:]$/.test(s)) s = s + '. ' + paras[1]; else if (s.length < 40 && paras[1]) s = s + ' ' + paras[1];
  const cut = s.search(/\.\s/); if (cut > 40) s = s.slice(0, cut + 1);
  s = s.replace(/\s*\((?:LIN-[\d]+[^)]*)\)/g, '').replace(/`/g, '');
  return s.length > 190 ? s.slice(0, 187).replace(/\s+\S*$/, '') + '…' : s;
};
let withHeader = 0, total = 0; for (const p of Object.keys(srcArea)) { total++; if (said(p)) withHeader++; }
console.log('files with an opening comment:', withHeader, 'of', total);
const out = { areas: {}, edges: E, withHeader, total };
for (const a of areas) { const t = T[a.slug]; t.files.sort((x, y) => y[1] - x[1]); out.areas[a.slug] = { name: t.name, lines: t.jsL, files: t.n, top: t.files.slice(0, 6).map(f => [f[0], f[1], said(f[0])]) }; }
fs.writeFileSync(process.argv[3], JSON.stringify(out));
for (const a of areas) { const t = out.areas[a.slug]; console.log(a.slug, t.lines, t.files, t.top.slice(0,4).map(f => f[0].replace(/^(lib|routes|public)\//,'') + ':' + f[1]).join(' ')); }
const es = Object.entries(E).sort((a, b) => b[1] - a[1]); console.log(es.length, 'edges'); console.log(es.slice(0, 45).map(e => e[0] + '=' + e[1]).join('\n'));
