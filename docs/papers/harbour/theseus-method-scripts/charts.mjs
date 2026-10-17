// Generates the two data figures for docs/papers/harbour/theseus-method.md (Figures 6 and 7).
//   node docs/papers/harbour/theseus-method-scripts/charts.mjs docs/papers/harbour/figures/theseus-method && npm run figures:theme
// Values, all at 509ed3fc: verbatim shares from experiments/verbatim/verbatim.md:7-17, rebuild-rung6b/arm/score.md:70,
// rebuild-rung7/arm/score.md:77-89 and consolidate-4-entrance/arm-4c/score.md:75-77; the entrance trajectory from
// docs/papers/harbour/consolidate-then-rebuild.md:71-76.
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2] || '.';
const MONO = 'JetBrains Mono, ui-monospace, monospace';
const f1 = n => n.toFixed(1);

// ---------- Figure: where rebuilds land ----------
{
  const W = 960, H = 330, X0 = 270, X1 = 920;
  const x = p => X0 + (X1 - X0) * p / 100;
  const rows = [
    { y: 74, name: 'clean room', sub: 'never sees the code' },
    { y: 132, name: 'design-first, merged', sub: 'reads the code, designs anew' },
    { y: 190, name: 'first attempts sent back', sub: 'by review, at the Done-when line' },
    { y: 248, name: 'merged as edits', sub: 'kept most of the old text' },
  ];
  const clean = [13.4, 19.4];
  const design = [37.0, 38.9, 40.0, 40.8, 45.7, 46.3, 47.9, 51.4, 52.6, 55.1];
  const sentBack = [[72.7, 45.7], [79.3, 51.4]];
  const edits = [[82.1, 'informed rewrite'], [86.1, 'design-first ticket']];
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif" font-size="12" role="img" aria-label="Share of a rebuild's lines found verbatim in the code it replaced. Two clean rooms kept 13 and 19 percent. Ten merged design-first rebuilds kept 37 to 55 percent. Two first attempts at 73 and 79 percent were sent back by review and merged at 46 and 51 percent. Two changes merged as edits at 82 and 86 percent. The Done-when line is about 60 percent.">`);
  o.push(`<defs><marker id="ao" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#eb6834"/></marker></defs>`);
  o.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
  o.push(`<text x="20" y="28" font-size="15" font-weight="600" fill="#111827">Where rebuilds land: share of the new lines found verbatim in the old code</text>`);
  // grid + axis
  for (const p of [0, 20, 40, 60, 80, 100]) {
    o.push(`<line x1="${x(p)}" y1="50" x2="${x(p)}" y2="272" stroke="#e5e7eb"/>`);
    o.push(`<text x="${x(p)}" y="290" font-size="10.5" fill="#6b7280" text-anchor="middle" font-family="${MONO}">${p}%</text>`);
  }
  // threshold
  o.push(`<line x1="${x(60)}" y1="46" x2="${x(60)}" y2="272" stroke="#111827" stroke-width="1.3" stroke-dasharray="5 4"/>`);
  o.push(`<text x="${x(60) + 6}" y="56" font-size="10.5" fill="#111827">Done-when line, about 60%</text>`);
  // row labels
  for (const r of rows) {
    o.push(`<text x="20" y="${r.y - 2}" font-size="12" font-weight="600" fill="#111827">${r.name}</text>`);
    o.push(`<text x="20" y="${r.y + 13}" font-size="10.5" fill="#6b7280">${r.sub}</text>`);
  }
  // clean room
  for (const p of clean) o.push(`<circle cx="${f1(x(p))}" cy="${rows[0].y}" r="5.5" fill="#6b7280"/>`);
  o.push(`<text x="${f1(x(19.4) + 12)}" y="${rows[0].y + 4}" font-size="10.5" fill="#6b7280" font-family="${MONO}">13–19%</text>`);
  // design-first, light beeswarm for near-ties
  design.forEach((p, i) => o.push(`<circle cx="${f1(x(p))}" cy="${rows[1].y + (i % 2 ? 5 : -5)}" r="5.5" fill="#2a78d6" stroke="#fff" stroke-width="1.5"/>`));
  o.push(`<text x="${f1(x(37) - 10)}" y="${rows[1].y + 4}" font-size="10.5" fill="#6b7280" text-anchor="end" font-family="${MONO}">37–55%</text>`);
  // sent back, with arrows to where they merged
  for (const [first, merged] of sentBack) {
    const x0 = x(first), x1 = x(merged);
    o.push(`<path d="M${f1(x0 - 3)} ${rows[2].y - 7} C ${f1(x0 - 30)} ${rows[1].y + 30}, ${f1(x1 + 30)} ${rows[1].y + 34}, ${f1(x1 + 3)} ${rows[1].y + 13}" fill="none" stroke="#eb6834" stroke-width="1.3" marker-end="url(#ao)"/>`);
    o.push(`<circle cx="${f1(x0)}" cy="${rows[2].y}" r="5.5" fill="#fff" stroke="#eb6834" stroke-width="2"/>`);
    o.push(`<text x="${f1(x0)}" y="${rows[2].y + 21}" font-size="10.5" fill="#6b7280" text-anchor="middle" font-family="${MONO}">${f1(first)}%</text>`);
  }
  // edits
  for (const [p, label] of edits) {
    o.push(`<circle cx="${f1(x(p))}" cy="${rows[3].y}" r="5.5" fill="#eb6834"/>`);
  }
  o.push(`<text x="${f1(x(82.1) - 10)}" y="${rows[3].y + 4}" font-size="10.5" fill="#6b7280" text-anchor="end" font-family="${MONO}">82.1%, 86.1%</text>`);
  o.push(`<text x="20" y="318" font-size="10.5" fill="#6b7280">Each dot is one merged change or first attempt. Lines compared as trimmed text, comments and imports excluded.</text>`);
  o.push('</svg>');
  writeFileSync(`${OUT}/where-rebuilds-land.svg`, o.join('\n') + '\n');
}

// ---------- Figure: the entrance, step by step ----------
{
  const W = 960, H = 268, X0 = 330, X1 = 790;
  const x = v => X0 + (X1 - X0) * v / 125;
  const rows = [
    { label: 'before', sub: 'three route files', worst: 122, dp: 708, fill: '#9ca3af' },
    { label: 'rebuilt alone', sub: 'design-first, no consolidation', worst: 63, dp: 649, fill: '#9ca3af' },
    { label: 'seam freed, then consolidated', sub: 'tests first, then one authority', worst: 29, dp: 585, fill: '#2a78d6' },
    { label: 'authority rebuilt', sub: 'design-first, 45.7% verbatim', worst: 13, dp: 555, fill: '#2a78d6' },
  ];
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, system-ui, sans-serif" font-size="12" role="img" aria-label="The dispatch entrance's most complex function, in decision points. Before: 122. Rebuilt alone: 63. After freeing the seam and consolidating: 29. After rebuilding the consolidated authority: 13. Decision points across the four files: 708, 649, 585, 555.">`);
  o.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
  o.push(`<text x="20" y="28" font-size="15" font-weight="600" fill="#111827">One target, step by step: the entrance's most complex function, in decision points</text>`);
  o.push(`<text x="${X1 + 40}" y="46" font-size="10.5" fill="#6b7280" text-anchor="middle">decision points,</text>`);
  o.push(`<text x="${X1 + 40}" y="60" font-size="10.5" fill="#6b7280" text-anchor="middle">whole entrance</text>`);
  rows.forEach((r, i) => {
    const y = 72 + i * 44;
    o.push(`<text x="20" y="${y + 9}" font-size="12" font-weight="600" fill="#111827">${r.label}</text>`);
    o.push(`<text x="20" y="${y + 24}" font-size="10.5" fill="#6b7280">${r.sub}</text>`);
    o.push(`<rect x="${X0}" y="${y}" width="${f1(x(r.worst) - X0)}" height="22" rx="4" fill="${r.fill}"/>`);
    o.push(`<text x="${f1(x(r.worst) + 8)}" y="${y + 15}" font-size="12" font-weight="600" fill="#111827" font-family="${MONO}">${r.worst}</text>`);
    o.push(`<text x="${X1 + 40}" y="${y + 15}" font-size="11" fill="#111827" text-anchor="middle" font-family="${MONO}">${r.dp}</text>`);
  });
  o.push(`<line x1="${X0}" y1="64" x2="${X0}" y2="${72 + 3 * 44 + 30}" stroke="#d1d5db"/>`);
  o.push(`<text x="20" y="${H - 14}" font-size="10.5" fill="#6b7280">Grey: a design-first rebuild on its own, from an earlier round. Blue: the method's moves, starting from that rebuild's output.</text>`);
  o.push('</svg>');
  writeFileSync(`${OUT}/entrance-steps.svg`, o.join('\n') + '\n');
}
console.log('written');
