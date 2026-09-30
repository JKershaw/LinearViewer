// LIN-3150: draw the what-supervisors-do figures as hand-written SVG from data/survey-supervise/analysis.json (no dependencies).
// Usage: node scripts/survey-supervise-render.mjs [--dir data/survey-supervise] [--out docs/papers/harbour/figures/what-supervisors-do]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/survey-supervise');
const outDir = arg('--out', 'docs/papers/harbour/figures/what-supervisors-do');
mkdirSync(outDir, { recursive: true });
const A = JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8'));

const FONT = 'font-family="Inter, Helvetica, Arial, sans-serif"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, o = '') => {
  const at = { 'font-size': '12', fill: '#333' }; for (const [, k, v] of o.matchAll(/([a-z-]+)="([^"]*)"/g)) at[k] = v;
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${FONT} ${Object.entries(at).map(([k, v]) => `${k}="${v}"`).join(' ')}>${esc(s)}</text>`;
};
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>\n`;
const MECH = '#2b6cb0'; const JUDG = '#dd8a2e';
const LABEL = { rearm: 'Re-arm a wake (gate reply)', read: 'Read tracker / dispatch state', restate: 'Restate or summarise state', judge: "Judge a worker's report", dispatch: 'Write and send the next beat', orient: 'Re-ground or orient', poll: 'Wait or poll', relay: 'Relay a ruling or escalation', decide: 'Decide the next task', work: "Do a worker's job", recover: 'Recover from an error', land: 'Set status, merge, Done' };

// Headline: each class's share of the supervision token bill, split into its mechanical and judgement parts.
function headline(file) {
  const rows = A.classes; const W = 780; const x0 = 220; const bw = W - x0 - 90; const max = Math.max(...rows.map((r) => r.unitShare));
  const H = 96 + rows.length * 30 + 60;
  let b = text(20, 26, 'Where the supervision token bill goes, by action class', 'font-size="15" font-weight="600"');
  b += text(20, 46, `September 2026: ${A.census.steps.toLocaleString('en')} steps in ${A.census.sessions} supervisor sessions (Runner, leg, stepper, autopilot, wake); share of weighted tokens.`, 'fill="#666" font-size="11"');
  b += text(20, 62, `Mechanical ${A.mechanical.unitShareViaClasses}% · judgement ${(100 - A.mechanical.unitShareViaClasses).toFixed(1)}% (split from a double hand-coded sample of 220 steps).`, 'fill="#666" font-size="11"');
  rows.forEach((r, i) => {
    const y = 80 + i * 30; const wm = (bw * r.mechanicalUnitShare) / max; const wj = (bw * r.judgementUnitShare) / max;
    b += text(20, y + 15, LABEL[r.cls] || r.cls, 'font-size="12"');
    b += `<rect x="${x0}" y="${y}" width="${wm.toFixed(1)}" height="20" fill="${MECH}"><title>${esc(r.cls)} mechanical ${r.mechanicalUnitShare}%</title></rect>`;
    b += `<rect x="${(x0 + wm).toFixed(1)}" y="${y}" width="${wj.toFixed(1)}" height="20" fill="${JUDG}"><title>${esc(r.cls)} judgement ${r.judgementUnitShare}%</title></rect>`;
    b += text(x0 + wm + wj + 6, y + 15, `${r.unitShare}%`, 'font-size="11" fill="#555"');
  });
  const ly = 80 + rows.length * 30 + 22;
  b += `<rect x="${x0}" y="${ly - 10}" width="12" height="12" fill="${MECH}"/>` + text(x0 + 16, ly, 'mechanical: fully determined by observable state', 'font-size="11"');
  b += `<rect x="${x0}" y="${ly + 8}" width="12" height="12" fill="${JUDG}"/>` + text(x0 + 16, ly + 18, 'judgement: needs reading and weighing text', 'font-size="11"');
  writeFileSync(join(outDir, file), svg(W, H + 10, b));
}

// Per layer: share of the supervision bill, split mechanical/judgement from the sample; and the share of wakes that changed nothing.
function layers(file) {
  const L = ['Runner', 'leg', 'stepper', 'autopilot', 'wake']; const W = 780; const x0 = 130; const bw = 330; const max = Math.max(...L.map((l) => A.byLayer[l].unitShare));
  const H = 100 + L.length * 40 + 50;
  let b = text(20, 26, 'Each layer’s token share, split mechanical vs judgement, and wakes that changed nothing', 'font-size="15" font-weight="600"');
  b += text(20, 46, 'Bar: the layer’s share of September supervision tokens, split by its hand-coded sample.', 'fill="#666" font-size="11"');
  b += text(20, 61, 'Right: share of its wake cycles with no dispatch, judgement, relay or decision.', 'fill="#666" font-size="11"');
  b += text(640, 76, 'no-action wakes', 'font-size="11" fill="#666"');
  L.forEach((l, i) => {
    const y = 90 + i * 40; const s = A.byLayer[l]; const m = A.mechanical.byLayerDirect[l] / 100; const w = (bw * s.unitShare) / max;
    b += text(20, y + 15, l, 'font-size="12"') + text(20, y + 29, `${A.census.sessionsByLayer[l]} sessions`, 'fill="#888" font-size="11"');
    b += `<rect x="${x0}" y="${y}" width="${(w * m).toFixed(1)}" height="22" fill="${MECH}"/><rect x="${(x0 + w * m).toFixed(1)}" y="${y}" width="${(w * (1 - m)).toFixed(1)}" height="22" fill="${JUDG}"/>`;
    b += text(x0 + w + 6, y + 15, `${s.unitShare}% (${A.mechanical.byLayerDirect[l]}% mech.)`, 'font-size="11" fill="#555"');
    const q = A.wakes.byLayer[l]; b += text(640, y + 15, `${q.noActionShare}% of ${q.cycles}`, 'font-size="12"');
  });
  const ly = 90 + L.length * 40 + 18;
  b += `<rect x="${x0}" y="${ly - 10}" width="12" height="12" fill="${MECH}"/>` + text(x0 + 16, ly, 'mechanical', 'font-size="11"') + `<rect x="${x0 + 100}" y="${ly - 10}" width="12" height="12" fill="${JUDG}"/>` + text(x0 + 116, ly, 'judgement', 'font-size="11"');
  writeFileSync(join(outDir, file), svg(W, H, b));
}

headline('bill-by-class.svg');
layers('layers.svg');
console.log(`wrote ${outDir}/bill-by-class.svg, layers.svg`);
