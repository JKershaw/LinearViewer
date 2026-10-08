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
const TEXT_DARK = ['#111827', '#1f2937', '#333', '#1f2328', '#555', '#475569'];
const TEXT_MID = ['#6b7280', '#666', '#667085', '#888', '#6e7781', '#999', '#aaa', '#bbb', '#9ca3af', '#94a3b8'];
const GRID = ['#e5e7eb', '#eee', '#d1d5db', '#f0f0f0', '#cbd5e1', '#d9d9d9'];
const TRACKS = ['#f0f0f0', '#d1d5db', '#e5e7eb', '#eee'];
const PANELS = ['#f3f4f6', '#f9fafb'];
/** White-filled non-rect shapes are the figures' "hollow" encoding: they must go dark with the canvas, not stay white discs. */
const HOLLOW_SHAPES = ['circle', 'path', 'polygon', 'ellipse'];
/**
 * Dark-neutral DATA fills (a category, not text): on the dark canvas they vanish, so lift to a mid tone that
 * stays darker than the light categories beside them (ordering preserved). Hue-specific: #3b1f5e is the
 * darkest step of the purple ramp in where-the-effort-goes/anatomy-tokens.svg.
 */
const DARK_DATA_FILLS = { '#1f2937': '#4b5563', '#3b1f5e': '#553185' };
/**
 * Figures whose captions name colours the dark remap would falsify. They keep their light rendering (empty
 * dark block) and are framed by a scoped `filter` in public/library.css instead.
 */
export const LIGHT_ONLY = Object.freeze(['steady-base-menu/menu-size-vs-risk.svg']);

const sel = (prefix, attr, values) => values.map(v => `${prefix}[${attr}="${v}"]`).join(',');
const rule = (selectors, decl) => `${selectors}{${decl}}`;

/** Opacity (>= .9) values used by white `shape`s: label plates / hollow markers, not pale overlays. */
function plateOpacities(svg, shape = 'rect') {
  const found = new Set();
  for (const tag of svg.match(new RegExp(`<${shape}\\b[^>]*>`, 'g')) || []) {
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

/** Dark fill for white non-rect shapes (opaque, or near-opaque plates), so hollow markers read hollow. */
function hollowRules(svg) {
  const bg = DARK_PALETTE.bg;
  return HOLLOW_SHAPES.flatMap(shape => [
    rule(WHITES.map(w => `${shape}[fill="${w}"]:not([fill-opacity])`).join(','), `fill:${bg}`),
    ...plateOpacities(svg, shape).map(op => rule(WHITES.map(w => `${shape}[fill="${w}"][fill-opacity="${op}"]`).join(','), `fill:${bg}`)),
  ]);
}

/**
 * Non-white translucent <rect>s read darker over the dark canvas, so "pale" would invert. Flatten them against
 * white in the dark block only: the light render keeps the original translucency (grid/range lines still show
 * through), and the dark render gets the solid pale hex. <circle> opacity is left alone (overlap shows density).
 */
function translucentRectRules(svg) {
  const seen = new Map();
  for (const tag of svg.match(/<rect\b[^>]*>/g) || []) {
    const fill = /\sfill="([^"]*)"/.exec(tag)?.[1];
    const op = /\sfill-opacity="([^"]*)"/.exec(tag)?.[1];
    if (!fill || op === undefined || WHITES.includes(fill)) continue;
    const solid = flattenOverWhite(fill, Number(op));
    if (solid) seen.set(`${fill}|${op}`, rule(`rect[fill="${fill}"][fill-opacity="${op}"]`, `fill:${solid};fill-opacity:1`));
  }
  return [...seen.values()];
}

function buildCss(svg) {
  const p = DARK_PALETTE;
  const rules = [
    // Canvas and opaque white fills (not <text>: white labels on bars stay white; not translucent overlays).
    rule(WHITES.map(w => `rect[fill="${w}"]:not([fill-opacity])`).join(','), `fill:${p.bg}`),
    rule(sel('', 'stroke', WHITES), `stroke:${p.bg}`),
    // Near-opaque white label plates sit behind dark-turned-light text, so they darken too.
    ...plateOpacities(svg).map(op => rule(WHITES.map(w => `rect[fill="${w}"][fill-opacity="${op}"]`).join(','), `fill:${p.bg}`)),
    ...hollowRules(svg),
    // Dark labels on light data fills (marked data-on-fill by markTextOnFill) keep their original dark colour.
    rule(sel('text', 'fill', TEXT_DARK).split(',').map(x => `${x}:not([data-on-fill])`).join(','), `fill:${p.fg}`),
    rule(sel('', 'stroke', TEXT_DARK), `stroke:${p.fg}`),
    rule(sel('text', 'fill', TEXT_MID).split(',').map(x => `${x}:not([data-on-fill])`).join(','), `fill:${p.dim}`),
    rule(sel('', 'stroke', TEXT_MID), `stroke:${p.dim}`),
    rule(sel('', 'stroke', GRID), `stroke:${p.border}`),
    rule(sel('', 'fill', PANELS), `fill:${p.panel}`),
    // Bar tracks. #cbd5e1/#d9d9d9 fills are data ("pale"/unlabelled series) and stay.
    rule(sel('rect', 'fill', TRACKS), `fill:${p.border}`),
    rule('text:not([fill]):not([class]):not([data-on-fill])', `fill:${p.fg}`),
    ...Object.entries(DARK_DATA_FILLS).map(([from, to]) => rule(['rect', 'circle', 'path'].map(e => `${e}[fill="${from}"]`).join(','), `fill:${to}`)),
    // growth-atlas figures are class-styled in their own <style>; `svg` raises specificity above it.
    rule('svg .t,svg .h', `fill:${p.fg}`),
    rule('svg .a,svg .s', `fill:${p.dim}`),
    rule('svg .f', `fill:${p.panel};stroke:${p.border}`),
    rule('svg .g', `stroke:${p.border}`),
    ...Object.entries(TINTS).map(([from, to]) => rule(`rect[fill="${from}"]`, `fill:${to}`)),
    ...translucentRectRules(svg),
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

const ON_FILL = 'data-on-fill';
const ON_FILL_RE = new RegExp(`\\s${ON_FILL}="1"`, 'g');
const NEUTRAL_FILLS = new Set([...WHITES, ...TRACKS, ...PANELS, ...Object.keys(TINTS)]);

function luminance(hexColor) {
  let h = hexColor.slice(1);
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Mark dark-by-design labels that sit on a light DATA fill (in-bar values on pale segments). The text remap
 * would turn them light-on-light, so the rules exclude `[data-on-fill]`. A label qualifies when the topmost
 * earlier <rect> containing its anchor point is a light, non-neutral hex fill. Rotated text is skipped
 * (no figure rotates in-bar labels; the sweep ignores transforms). Geometry only, so re-running is stable.
 */
function markTextOnFill(svg) {
  const rects = [];
  const num = (tag, name) => Number(new RegExp(`\\s${name}="(-?[\\d.]+)"`).exec(tag)?.[1]);
  return svg.replace(/<rect\b[^>]*>|<text\b[^>]*>/g, tag => {
    if (tag.startsWith('<rect')) {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(n => num(tag, n));
      let fill = /\sfill="([^"]*)"/.exec(tag)?.[1];
      const op = /\sfill-opacity="([^"]*)"/.exec(tag)?.[1];
      // A translucent rect is judged by the colour it shows over white (what the dark block flattens it to).
      if (fill && op !== undefined && !WHITES.includes(fill)) fill = flattenOverWhite(fill, Number(op)) ?? fill;
      if ([x, y, w, h].every(Number.isFinite) && fill && fill !== 'none') rects.push({ x, y, w, h, fill });
      return tag;
    }
    const fill = /\sfill="([^"]*)"/.exec(tag)?.[1];
    if (/\stransform=/.test(tag) || (fill !== undefined && !TEXT_DARK.includes(fill) && !TEXT_MID.includes(fill))) return tag;
    const x = num(tag, 'x'), y = num(tag, 'y') - 2;
    if (![x, y].every(Number.isFinite)) return tag;
    const top = rects.findLast(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    if (!top || NEUTRAL_FILLS.has(top.fill) || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(top.fill) || luminance(top.fill) < 0.45) return tag;
    return tag.replace(/^<text\b/, `<text ${ON_FILL}="1"`);
  });
}

const BLOCK_RE = new RegExp(`<style ${THEME_MARKER}(?:="[^"]*")?[^>]*>[\\s\\S]*?</style>`, 'g');

/**
 * @param {string} svgText
 * @param {string} [name] path relative to the figures dir; LIGHT_ONLY figures get an empty dark block.
 */
export function themeSvg(svgText, name) {
  const bare = svgText.replace(BLOCK_RE, '').replace(ON_FILL_RE, '');
  if (LIGHT_ONLY.includes(name)) {
    return bare.replace(/<svg\b[^>]*>/, open => `${open}<style ${THEME_MARKER}="light-only">/* light-only: caption colour words name neutrals */</style>`);
  }
  const marked = markTextOnFill(bare);
  const block = `<style ${THEME_MARKER}="1">${buildCss(marked)}</style>`;
  return marked.replace(/<svg\b[^>]*>/, open => open + block);
}
