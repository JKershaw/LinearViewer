/**
 * LIN-3748 shared in-page measurement primitives (M1, M3, M4 sampler).
 *
 * Exported as source strings so they can be passed to page.evaluate. capture.mjs and
 * capture-gap.mjs carry inline copies of the same rgb()/effBg() logic (patched in
 * place, per the plan); census.mjs and validate-metrics.mjs import from here.
 *
 * M3 cause (verified 2026-10-21): Chrome serialises `color-mix()` backgrounds as
 * `color(srgb r g b / a)`, which the 09-26 `rgba?\(` regex did not match, so an
 * element's OWN translucent background (`.action-btn.save` = 12% green) was dropped
 * (null) or, in capture.mjs, treated as solid. parseColor() below reads srgb and falls
 * back to a 1x1 canvas for any other colour space (oklab, display-p3, ...).
 */

export const PARSE_COLOR_JS = String.raw`
function parseColor(s) {
  s = (s || '').trim();
  let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : (m[5] ? +m[4] / 100 : +m[4])];
  m = s.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+)(%?))?\s*\)$/);
  if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : (m[5] ? +m[4] / 100 : +m[4])];
  if (!s || s === 'transparent') return [0, 0, 0, 0];
  const c = (parseColor._c ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
  c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = s; c.fillRect(0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}`;

// Alpha-composite src over dst (dst opaque rgb).
export const COMPOSITE_JS = String.raw`
function over(dst, src) { const a = src[3]; return [src[0] * a + dst[0] * (1 - a), src[1] * a + dst[1] * (1 - a), src[2] * a + dst[2] * (1 - a)]; }
function lum(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function L(c) { return lum(c[0]) * 0.2126 + lum(c[1]) * 0.7152 + lum(c[2]) * 0.0722; }
function ratio(a, b) { const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }
// Effective background: the element's OWN background is the top layer (M3), then every
// translucent ancestor layer down to the first opaque one; page base white (light) or the
// body/html colour when nothing is opaque.
function effBg(el) {
  const layers = [];
  for (let a = el; a; a = a.parentElement) {
    const c = parseColor(getComputedStyle(a).backgroundColor);
    if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
  }
  let base = [255, 255, 255];
  if (layers.length && layers[layers.length - 1][3] >= 1) base = layers.pop().slice(0, 3);
  for (let i = layers.length - 1; i >= 0; i--) base = over(base, layers[i]);
  return base.map(Math.round);
}`;

// M1: geometry overflow rule, ported from tests/helpers.js expectNoClippedOverflow.
export const OVERFLOW_JS = String.raw`(() => {
  const vw = document.documentElement.clientWidth;
  const contains = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true; } return false; };
  const spill = [...document.body.querySelectorAll('*')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !contains(el); })
    .map(el => (el.dataset.testid || el.id || el.tagName.toLowerCase() + '.' + el.className) + '@' + Math.round(el.getBoundingClientRect().right) + '>' + vw);
  const bodyOver = document.body.scrollWidth - document.body.clientWidth;
  return { bodyOver, spill: spill.slice(0, 25), overflows: bodyOver > 0 || spill.length > 0 };
})()`;

// M4 sampler: every visible text-owning element, grouped by element+colour+bg.
// Threshold 4.5:1 for normal text; 3:1 for large (>=24px, or >=18.66px bold) text.
// Returns groups under threshold only. Still blind to background-image, pseudo-elements and
// text over non-ancestor layers (09-26 §7.5 residual; carried limit).
export const CENSUS_SAMPLER_JS = `(() => {
${PARSE_COLOR_JS}
${COMPOSITE_JS}
const groups = new Map();
let sampled = 0;
for (const el of document.querySelectorAll('body *')) {
  if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'OPTION', 'SVG', 'PATH'].includes(el.tagName.toUpperCase())) continue;
  const ownText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  if (!ownText) continue;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) continue;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
  const fg = parseColor(cs.color);
  if (fg[3] === 0) continue;
  const bg = effBg(el);
  // text colour itself may be translucent: composite it over the effective bg
  const fgc = fg[3] < 1 ? over(bg, fg) : fg;
  sampled++;
  const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
  const large = px >= 24 || (px >= 18.66 && bold);
  const need = large ? 3 : 4.5;
  const rt = +ratio(fgc, bg).toFixed(2);
  if (rt >= need) continue;
  const cls = (typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\\s+/).join('.') : '';
  const key = el.tagName.toLowerCase() + cls + '|' + cs.color + '|' + bg.join(',');
  const g = groups.get(key) || { element: el.tagName.toLowerCase() + cls, color: cs.color, bg: 'rgb(' + bg.join(',') + ')', ratio: rt, need, fontSize: cs.fontSize, fontWeight: cs.fontWeight, count: 0, samples: [] };
  g.count++;
  if (g.samples.length < 3) g.samples.push(ownText.slice(0, 50));
  groups.set(key, g);
}
return { sampled, groups: [...groups.values()].sort((a, b) => a.ratio - b.ratio) };
})()`;
