/**
 * LIN-3351 — dark-mode theming for the committed Library figure SVGs.
 *
 * The figures are frozen single-theme SVGs (white canvas, light-theme neutrals)
 * served as <img>, so page CSS cannot reach inside them. `themeSvg` injects one
 * marked <style> with an `@media (prefers-color-scheme: dark)` rule that remaps
 * only the neutrals; data hues are untouched so legends and "pale"/"lightest"
 * captions stay true. An <img> SVG follows the embedding element's
 * `color-scheme` (see public/library.css), so the same rule serves both the OS
 * path and the `html.theme-dark` cookie path.
 *
 * Pure and idempotent: an existing block is stripped and rebuilt, so a palette
 * change re-applies cleanly. Not regenerable from data (`data/` is gitignored),
 * hence a post-processor over the committed files.
 */

export const THEME_MARKER = 'data-figure-theme';

/** Copy of the `.theme-dark` tokens in public/style.css (an <img> SVG cannot read page var()s). A unit test guards drift. */
export const DARK_PALETTE = Object.freeze({
  bg: '#16181d',
  panel: '#1f222a',
  fg: '#e6e6e6',
  dim: '#9aa0a6',
  border: '#2c313a',
});

const WHITES = ['#fff', '#ffffff', 'white'];
const TEXT_DARK = ['#1f2937', '#333', '#1f2328', '#555', '#475569'];
const TEXT_MID = ['#6b7280', '#666', '#667085', '#888', '#6e7781', '#999', '#aaa', '#bbb', '#9ca3af', '#94a3b8'];
const GRID = ['#e5e7eb', '#eee', '#d1d5db', '#f0f0f0', '#cbd5e1', '#d9d9d9'];
const TRACKS = ['#f0f0f0', '#d1d5db', '#e5e7eb', '#eee'];
const PANELS = ['#f3f4f6', '#f9fafb'];

const sel = (prefix, attr, values) => values.map(v => `${prefix}[${attr}="${v}"]`).join(',');
const rule = (selectors, decl) => `${selectors}{${decl}}`;

/** Opacity (>= .9) values used by white rects: label plates behind dark text, not pale overlays. */
function plateOpacities(svg) {
  const found = new Set();
  for (const tag of svg.match(/<rect\b[^>]*>/g) || []) {
    const fill = /\bfill="([^"]*)"/.exec(tag)?.[1];
    const op = /\bfill-opacity="([^"]*)"/.exec(tag)?.[1];
    if (WHITES.includes(fill) && op !== undefined && Number(op) >= 0.9) found.add(op);
  }
  return [...found];
}

/**
 * Sequential heatmap ramps (white -> #2a78d6, as rgb() cell fills): light = low
 * would be a bright block on the dark canvas, with the text on it turned light.
 * Re-ramp dark -> #2a78d6 so low stays low and the cell text stays readable.
 * Only step-overlap/overlap-matrix.svg uses rgb() fills.
 */
const RAMP_HI = [0x2a, 0x78, 0xd6];
function heatmapRules(svg) {
  const bg = [0x16, 0x18, 0x1d];
  const out = [];
  for (const v of new Set(svg.match(/<rect\b[^>]*\bfill="rgb\([^"]*\)"/g)?.map(t => /fill="(rgb\([^"]*\))"/.exec(t)[1]))) {
    const [r, g, b] = v.match(/\d+/g).map(Number);
    if (!(b > r)) continue;
    const t = Math.min(1, Math.max(0, (255 - r) / (255 - RAMP_HI[0])));
    const c = bg.map((x, i) => x + (RAMP_HI[i] - x) * t);
    out.push(rule(`rect[fill="${v}"]`, `fill:#${c.map(hex).join('')}`));
  }
  return out;
}

function buildCss(svg) {
  const p = DARK_PALETTE;
  const rules = [
    // Canvas and opaque white fills (not <text>: white labels on bars stay white; not translucent overlays).
    rule(WHITES.map(w => `rect[fill="${w}"]:not([fill-opacity])`).join(','), `fill:${p.bg}`),
    rule(sel('', 'stroke', WHITES), `stroke:${p.bg}`),
    // Near-opaque white label plates sit behind dark-turned-light text, so they darken too.
    ...plateOpacities(svg).map(op => rule(WHITES.map(w => `rect[fill="${w}"][fill-opacity="${op}"]`).join(','), `fill:${p.bg}`)),
    rule(sel('text', 'fill', TEXT_DARK), `fill:${p.fg}`),
    rule(sel('', 'stroke', TEXT_DARK), `stroke:${p.fg}`),
    rule(sel('text', 'fill', TEXT_MID), `fill:${p.dim}`),
    rule(sel('', 'stroke', TEXT_MID), `stroke:${p.dim}`),
    rule(sel('', 'stroke', GRID), `stroke:${p.border}`),
    rule(sel('', 'fill', PANELS), `fill:${p.panel}`),
    // Bar tracks. #cbd5e1/#d9d9d9 fills are data ("pale"/unlabelled series) and stay.
    rule(sel('rect', 'fill', TRACKS), `fill:${p.border}`),
    rule('text:not([fill]):not([class])', `fill:${p.fg}`),
    // growth-atlas figures are class-styled in their own <style>; `svg` raises specificity above it.
    rule('svg .t,svg .h', `fill:${p.fg}`),
    rule('svg .a,svg .s', `fill:${p.dim}`),
    rule('svg .f', `fill:${p.panel};stroke:${p.border}`),
    rule('svg .g', `stroke:${p.border}`),
    ...Object.entries(TINTS).map(([from, to]) => rule(`rect[fill="${from}"]`, `fill:${to}`)),
    ...heatmapRules(svg),
  ];
  return `@media (prefers-color-scheme: dark){${rules.join('')}}`;
}

/**
 * Light tints that would be bright blocks on the dark canvas: the two-step blue evidence ramp
 * (prototype-concepts/concept-lever-matrix.svg, re-ramped dark so cell text stays readable) and
 * the warm band in which-rules-pay/cost-vs-production-changes.svg.
 */
const TINTS = { '#dbeafe': '#1d2d44', '#93c5fd': '#2a5a9a', '#fff7ed': '#2a2118' };

const hex = n => Math.round(n).toString(16).padStart(2, '0');

/** Blend a #rgb/#rrggbb colour at `alpha` over white; null when the colour is not a hex literal. */
function flattenOverWhite(color, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  return '#' + [0, 2, 4].map(i => hex(255 + (parseInt(h.slice(i, i + 2), 16) - 255) * alpha)).join('');
}

/** Flatten non-white translucent <rect>s to a solid colour: identical on the white canvas, correct on the dark one. <circle> opacity is left alone. */
function flattenRects(svg) {
  return svg.replace(/<rect\b[^>]*>/g, tag => {
    const fill = /\bfill="([^"]*)"/.exec(tag)?.[1];
    const opM = /\sfill-opacity="([^"]*)"/.exec(tag);
    if (!fill || !opM || WHITES.includes(fill)) return tag;
    const solid = flattenOverWhite(fill, Number(opM[1]));
    if (!solid) return tag;
    return tag.replace(opM[0], '').replace(`fill="${fill}"`, `fill="${solid}"`);
  });
}

const BLOCK_RE = new RegExp(`<style ${THEME_MARKER}(?:="[^"]*")?[^>]*>[\\s\\S]*?</style>`, 'g');

export function themeSvg(svgText) {
  const flat = flattenRects(svgText.replace(BLOCK_RE, ''));
  const block = `<style ${THEME_MARKER}="1">${buildCss(flat)}</style>`;
  return flat.replace(/<svg\b[^>]*>/, open => open + block);
}
