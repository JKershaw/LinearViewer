/**
 * LIN-4009 closed-class sweep: one primary colour, one focus ring, no blue fills.
 *
 * The blue `--blue` token is the data-viz hue (ship-journey, chart-helpers, swim),
 * so it stays. Blue text, borders, rings and filled actions on the pages this
 * ticket owns moved to `--brand` / `--brand-dim`. These tests keep that true:
 *
 *   1. The sheet list is derived from the renderers, not hand-written, and must
 *      be exactly the 13 sheets the in-scope pages load (a parse miss fails loudly).
 *   2. Every `var(--blue` selector in those sheets is one of six named, reasoned,
 *      out-of-scope members (LIN-4015 / LIN-4014), and each member's producer
 *      files are pinned, so a new producer or a widened file set fails here.
 *   3. No custom property resolving to a blue hue except `--blue` itself, and no
 *      blue colour literal outside a `var(--blue` line, in those sheets.
 *   4. No `background*` declaration anywhere in public/*.css resolves to `--blue`
 *      or `#2563eb`, except the two named specimen/data-viz rules.
 *   5. A negative control: the classifier must flag `--focus: #0d6efd;`, so the
 *      sweep cannot go vacuous if its regex or hue range is edited later.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

// --- 1. the sheets the in-scope pages load ------------------------------------

const RENDERERS = [
  'lib/render.js', 'lib/render-task-page.js', 'lib/render-observation.js',
  'lib/render-settings.js', 'lib/render-live-console.js', 'lib/components/footer.js'
];

function sheetsIn(src) {
  const out = new Set();
  for (const m of src.matchAll(/stylesheets:([^\n]*)/g)) {
    let body = m[1];
    const ident = /\bSTYLESHEETS\b/.exec(body);
    if (ident) {
      const decl = /const STYLESHEETS = (\[[^\]]*\])/.exec(src);
      assert.ok(decl, 'STYLESHEETS identifier must resolve to a const array');
      body = decl[1];
    }
    for (const s of body.matchAll(/'(\/[^']+\.css)'/g)) out.add(s[1].slice(1));
  }
  // The feedback widget is loaded by the footer on every page.
  for (const s of src.matchAll(/href="\/([^"]+\.css)"/g)) out.add(s[1]);
  return out;
}

function inScopeSheets() {
  const all = new Set();
  for (const f of RENDERERS) for (const s of sheetsIn(read(f))) all.add(s);
  return [...all].sort();
}

test('the in-scope sheets are derived from the renderers and total 13', () => {
  const sheets = inScopeSheets();
  assert.deepEqual(sheets, [
    'chat.css', 'common-actions.css', 'feedback-widget.css', 'live-console.css',
    'observation.css', 'run-control.css', 'session.css', 'settings.css', 'stage-track.css',
    'style.css', 'swipe.css', 'task-chat.css', 'task-page.css'
  ]);
});

// --- 2. the closed set of var(--blue selectors ------------------------------

// Out-of-scope members (LIN-4015 retires the --blue names; LIN-4014 owns Landing).
// Each names its reason and the files that draw it; the producers are pinned below.
const ALLOWED = [
  { sheet: 'style.css', selector: '.setup-notice a', reason: 'Landing only (LIN-4014)',
    producers: ['lib/render-landing.js', 'lib/render.js'] },
  { sheet: 'style.css', selector: '.prompt-text a', reason: 'dead on in-scope pages: escaped text, nothing renders markdown into it (LIN-4015)',
    producers: ['lib/render-prompts.js', 'lib/render.js', 'public/app.js', 'public/templates.js'] },
  { sheet: 'style.css', selector: '.dispatch-preset-select:focus', reason: 'Dispatch page only (LIN-4015)',
    producers: ['public/dispatch.js'] },
  { sheet: 'style.css', selector: '.token-label-input:focus', reason: 'token fields on Dispatch, Proxy, styleguide and plain pages (LIN-4015)',
    producers: ['lib/components/plain-page.js', 'lib/render-dispatch.js', 'lib/render-proxy.js', 'lib/render-styleguide.js'] },
  { sheet: 'style.css', selector: '.error-container a:not([class])', reason: 'auth and error pages, pinned blue by dark-theme-native-controls (LIN-4015)',
    producers: ['lib/render-email-auth.js', 'lib/render-pages.js'] },
  { sheet: 'swipe.css', selector: '.swipe-card-link a:hover', reason: 'Swipe page only (LIN-4015)',
    producers: ['public/swipe.js'] }
];

// Whole-token class match: `setup-notice` must not match `runner-setup-notice`.
function producersOf(selector) {
  const cls = /\.([a-z][a-z0-9-]*)/.exec(selector)[1];
  const re = new RegExp(`(^|[\\s"'.])${cls}([\\s"'{:,>)\\[]|$)`);
  const hits = [];
  for (const f of [...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'public'))]) {
    if (re.test(readFileSync(f, 'utf8'))) hits.push(relative(ROOT, f));
  }
  return hits.sort();
}

// Selector text for each line: a rule opens on the line that holds its `{`.
function blueLines(sheet) {
  const lines = stripComments(read(`public/${sheet}`)).split('\n');
  const out = [];
  let sel = '';
  lines.forEach((line, i) => {
    const open = /^([^{}]+)\{/.exec(line.trim());
    if (open) sel = open[1].trim();
    if (line.includes('var(--blue')) out.push({ sheet, line: i + 1, selector: sel });
  });
  return out;
}

test('every var(--blue selector in the in-scope sheets is one of the six named members', () => {
  const found = inScopeSheets().flatMap(blueLines);
  const allowed = new Set(ALLOWED.map(a => `${a.sheet}|${a.selector}`));
  const unexpected = found.filter(f => !allowed.has(`${f.sheet}|${f.selector}`));
  assert.deepEqual(unexpected.map(f => `${f.sheet}:${f.line} ${f.selector}`), [],
    'blue on an in-scope page: repoint to --brand / --brand-dim, or route to a named gap');
  for (const a of ALLOWED) {
    assert.ok(found.some(f => f.sheet === a.sheet && f.selector === a.selector),
      `${a.sheet} ${a.selector} is allowlisted but no longer uses var(--blue: drop it from ALLOWED`);
  }
});

test('each allowlisted member is drawn only by its pinned producer files', () => {
  for (const a of ALLOWED) {
    assert.deepEqual(producersOf(a.selector), a.producers,
      `${a.selector}: producer set changed (a new producer must be routed, not silently allowed)`);
  }
});

// --- 3. blue-valued tokens and literals -------------------------------------

function hexToRgb(hex) {
  const h = hex.slice(1);
  const full = h.length === 3 || h.length === 4 ? h.slice(0, 3).split('').map(c => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hueSat([r, g, b]) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const d = max - min, l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r / 255) h = 60 * (((g - b) / 255 / d) % 6);
  else if (max === g / 255) h = 60 * ((b - r) / 255 / d + 2);
  else h = 60 * ((r - g) / 255 / d + 4);
  return { h: (h + 360) % 360, s };
}
const isBlue = (rgb) => { const { h, s } = hueSat(rgb); return h >= 200 && h <= 250 && s >= 0.5; };

/** Colour literals on one stripped line: hex and rgb()/rgba(). */
function literalsOn(line) {
  const out = [];
  for (const m of line.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{8}\b|#[0-9a-f]{3}\b/gi)) out.push(hexToRgb(m[0].slice(0, 7)));
  for (const m of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) out.push([+m[1], +m[2], +m[3]]);
  return out;
}

/** The classifier: returns the blue literals on lines that are not a `var(--blue` use. */
function blueLiteralViolations(css) {
  const bad = [];
  stripComments(css).split('\n').forEach((line, i) => {
    if (/^\s*--blue\s*:/.test(line) || line.includes('var(--blue')) return;
    if (literalsOn(line).some(isBlue)) bad.push(`${i + 1}: ${line.trim()}`);
  });
  return bad;
}

/** Resolve every declared custom property of a theme block, following var() chains. */
function themeTokens(css, selector) {
  const block = (re) => {
    const m = re.exec(css);
    return m ? css.slice(m.index + m[0].length, css.indexOf('}', m.index + m[0].length)) : '';
  };
  const root = block(/:root\s*\{/), dark = block(/\.theme-dark\s*\{/);
  const decl = (text) => new Map([...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const merged = new Map([...decl(root), ...(selector === '.theme-dark' ? decl(dark) : [])]);
  const resolve = (name, depth = 0) => {
    const v = merged.get(name);
    if (v === undefined || depth > 6) return undefined;
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
    return ref ? resolve(ref[1], depth + 1) : v;
  };
  return { names: [...merged.keys()], raw: merged, resolve };
}

test('no in-scope custom property resolves to a blue hue except --blue', () => {
  const css = stripComments(read('public/style.css'));
  for (const theme of [':root', '.theme-dark']) {
    const { names, resolve } = themeTokens(css, theme);
    const bad = names.filter(n => n !== '--blue').filter(n => {
      const v = resolve(n);
      return v && /^#[0-9a-f]{6}$/i.test(v) && isBlue(hexToRgb(v));
    });
    assert.deepEqual(bad, [], `${theme}: blue-valued tokens ${bad.join(', ')}`);
  }
});

test('--focus is declared as the brand colour in both themes, so the house ring cannot be a second blue', () => {
  const css = stripComments(read('public/style.css'));
  for (const theme of [':root', '.theme-dark']) {
    assert.equal(themeTokens(css, theme).raw.get('--focus'), 'var(--brand)', `${theme}: --focus must be var(--brand)`);
  }
});

test('no blue colour literal in the in-scope sheets outside a var(--blue line', () => {
  const bad = inScopeSheets().flatMap(s => blueLiteralViolations(read(`public/${s}`)).map(v => `${s}:${v}`));
  assert.deepEqual(bad, []);
});

// --- 4. no blue background anywhere in the public stylesheets -----------------

// swim-cp-clear-pill: an out-of-scope Swim page chip tinted in the data-viz hue
// (LIN-4015). styleguide .sg-space-bar: a spacing specimen, not an action.
const BACKGROUND_ALLOWED = new Set(['swim.css|.swim-cp-clear-pill', 'swim.css|.swim-cp-clear-pill:hover', 'styleguide.css|.sg-space-bar']);

function backgroundBlueUses(sheet) {
  const lines = stripComments(read(`public/${sheet}`)).split('\n');
  const hits = [];
  let sel = '';
  lines.forEach((line) => {
    const open = /^([^{}]+)\{/.exec(line.trim());
    if (open) sel = open[1].trim();
    if (/background[a-z-]*\s*:[^;]*(var\(--blue(?![-\w])|#2563eb)/i.test(line)) hits.push(`${sheet}|${sel}`);
  });
  return hits;
}

test('no background* declaration in public/*.css resolves to --blue or #2563eb (named specimens aside)', () => {
  const sheets = readdirSync(join(ROOT, 'public')).filter(f => f.endsWith('.css'));
  const bad = sheets.flatMap(backgroundBlueUses).filter(h => !BACKGROUND_ALLOWED.has(h));
  assert.deepEqual(bad, []);
});

// --- 5. the negative control --------------------------------------------------

test('negative control: the classifier flags a blue focus token and a blue literal', () => {
  const planted = '.x {\n  --focus: #0d6efd;\n}\n.y {\n  outline: 2px solid rgb(0, 0, 238);\n}';
  const hits = blueLiteralViolations(planted);
  assert.equal(hits.length, 2, `classifier should flag both planted literals, got: ${hits.join(' | ')}`);
  assert.ok(/background[a-z-]*\s*:[^;]*(var\(--blue(?![-\w])|#2563eb)/i.test('  background: var(--blue, #2563eb);'));
});
