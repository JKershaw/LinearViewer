/**
 * Theme S1 foundation tests (LIN-785).
 *
 * Covers the centralized theming mechanism: the semantic + status token layer in
 * both themes, the removal of `.theme-amber`, self-hosted font loading, the
 * motion / a11y baseline, the pre-paint shell script, the light-as-default
 * behavior, and the durable theme-preference plumbing in user-preferences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderPage } from '../../lib/components/page.js';
import {
  applyUserPreferencesToSession,
  setThemeCookie,
  VALID_THEMES,
  THEME_COOKIE_MAX_AGE_MS
} from '../../lib/user-preferences.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = readFileSync(join(__dirname, '../../public/style.css'), 'utf8');

/** Slice the body of a selector's first rule block (no nested braces in this file). */
function ruleBody(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `expected ${selector} in stylesheet`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

// --- Token layer ------------------------------------------------------------

const SEMANTIC_TOKENS = [
  '--text', '--muted', '--faint', '--line', '--line-soft',
  '--card', '--card-h', '--raised', '--inset', '--brand', '--shadow'
];
const STATUS_TOKENS = ['--amber', '--amber-dim', '--slate', '--slate-dim', '--green-dim', '--red-dim'];

test(':root defines the semantic and running-status token layer', () => {
  const root = ruleBody(STYLE_CSS, ':root');
  for (const token of [...SEMANTIC_TOKENS, ...STATUS_TOKENS, '--focus']) {
    assert.match(root, new RegExp(`${token}\\s*:`), `:root must define ${token}`);
  }
});

test('.theme-dark re-binds the semantic + status tokens (dark values)', () => {
  const dark = ruleBody(STYLE_CSS, '.theme-dark');
  // Both layers must re-bind in dark so theming a subtree (e.g. the styleguide
  // panel) stays correct, not only when the class sits on <html>.
  for (const token of [...SEMANTIC_TOKENS, ...STATUS_TOKENS, '--focus']) {
    assert.match(dark, new RegExp(`${token}\\s*:`), `.theme-dark must re-bind ${token}`);
  }
});

test('--brand is teal (per LIN-782) in both themes', () => {
  assert.match(ruleBody(STYLE_CSS, ':root'), /--brand:\s*var\(--teal\)/);
  assert.match(ruleBody(STYLE_CSS, '.theme-dark'), /--brand:\s*var\(--teal\)/);
});

test('the .theme-amber variant is fully removed', () => {
  assert.doesNotMatch(STYLE_CSS, /theme-amber/, 'stylesheet must not reference theme-amber');
});

// --- Typography / fonts -----------------------------------------------------

test('self-hosts Inter and JetBrains Mono via @font-face (no build step)', () => {
  assert.match(STYLE_CSS, /@font-face[\s\S]*?font-family:\s*'Inter'[\s\S]*?\/fonts\/inter-400\.woff2/);
  assert.match(STYLE_CSS, /@font-face[\s\S]*?font-family:\s*'JetBrains Mono'[\s\S]*?\/fonts\/jetbrains-mono-400\.woff2/);
  // font-display: swap keeps a slow/blocked load from blanking text.
  assert.match(STYLE_CSS, /font-display:\s*swap/);
  // The loaded faces head their respective stacks.
  assert.match(STYLE_CSS, /--font-structural:\s*'JetBrains Mono'/);
  assert.match(STYLE_CSS, /--font-content:\s*'Inter'/);
});

// LIN-864: the theme's type scale (view title 700, metadata/chips 500, machine-ID
// mono 600) demands intermediate/heavier weights beyond the base 400. Each must be
// self-hosted so the browser never synthesizes faux-bold, which degrades the
// mono=fact / sans=label hierarchy. Every weight declared → matching vendored file.
const SELF_HOSTED_WEIGHTS = [
  ['Inter', 400, 'inter-400.woff2'],
  ['Inter', 500, 'inter-500.woff2'],
  ['Inter', 600, 'inter-600.woff2'],
  ['Inter', 700, 'inter-700.woff2'],
  ['JetBrains Mono', 400, 'jetbrains-mono-400.woff2'],
  ['JetBrains Mono', 500, 'jetbrains-mono-500.woff2'],
  ['JetBrains Mono', 600, 'jetbrains-mono-600.woff2'],
];

test('every type-scale weight is self-hosted via @font-face (no faux-bold)', () => {
  for (const [family, weight, file] of SELF_HOSTED_WEIGHTS) {
    // A single @font-face block binding this family + weight to its own woff2 file.
    const re = new RegExp(
      `@font-face\\s*\\{[^}]*?font-family:\\s*'${family}'[^}]*?font-weight:\\s*${weight}\\b[^}]*?\\/fonts\\/${file.replace(/[.]/g, '\\$&')}[^}]*?\\}`
    );
    assert.match(STYLE_CSS, re, `missing @font-face for ${family} ${weight} → /fonts/${file}`);
  }
});

test('the actual font files are vendored', () => {
  for (const [, , f] of SELF_HOSTED_WEIGHTS) {
    const bytes = readFileSync(join(__dirname, '../../public/fonts', f));
    assert.ok(bytes.length > 1000, `${f} should be a real woff2`);
    assert.equal(bytes.toString('ascii', 0, 4), 'wOF2', `${f} must be a woff2`);
  }
});

// --- Motion + a11y baseline -------------------------------------------------

test('ships motion keyframes, a focus-visible ring, and a reduced-motion baseline', () => {
  assert.match(STYLE_CSS, /@keyframes\s+pulse/);
  assert.match(STYLE_CSS, /@keyframes\s+shimmer/);
  assert.match(STYLE_CSS, /:focus-visible\s*\{[\s\S]*?outline:[\s\S]*?var\(--focus\)/);
  assert.match(STYLE_CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

// --- Theme S2 primitives (LIN-786) ------------------------------------------

// Every interactive primitive must rely on the global :focus-visible ring, so
// none may set `outline:none` — that would suppress the keyboard focus ring with
// no replacement. (The token-input's scoped :not(:focus-visible) suppression is
// the one allowed pattern and lives in common-actions.css, not here.)
test('no S2 primitive suppresses focus with outline:none', () => {
  const start = STYLE_CSS.indexOf('Theme S2 Primitives (LIN-786)');
  assert.notEqual(start, -1, 'expected the S2 primitives block in the stylesheet');
  // Bound the slice to the S2 section (it ends at the next major block).
  const end = STYLE_CSS.indexOf('Badge convergence anchor', start);
  assert.notEqual(end, -1, 'expected a following section to bound the S2 block');
  const block = STYLE_CSS.slice(start, end);
  assert.doesNotMatch(block, /outline:\s*none/, 'S2 primitives must not kill the focus ring');
});

test('primary Button and IconButton meet the 40px touch-target floor', () => {
  const primary = ruleBody(STYLE_CSS, '.btn--primary');
  assert.match(primary, /min-height:\s*40px/, '.btn--primary needs a ≥40px touch target');
  const iconBtn = ruleBody(STYLE_CSS, '.icon-btn {');
  assert.match(iconBtn, /min-height:\s*40px/, '.icon-btn needs a ≥40px touch target');
  assert.match(iconBtn, /min-width:\s*40px/, '.icon-btn needs a ≥40px touch target');
});

test('the run-status pill ships a dot + the running/error/queued modifiers on -dim text', () => {
  assert.match(STYLE_CSS, /\.status-pill__dot\s*\{/);
  assert.match(STYLE_CSS, /\.status-pill--running\s*\{\s*color:\s*var\(--amber-dim\)/);
  assert.match(STYLE_CSS, /\.status-pill--error\s*\{\s*color:\s*var\(--red-dim\)/);
  assert.match(STYLE_CSS, /\.status-pill--queued\s*\{\s*color:\s*var\(--slate-dim\)/);
  // The dot uses the bright fill token, and the running dot reuses the global
  // pulse keyframe (no new animation machinery).
  assert.match(STYLE_CSS, /\.status-pill--running\s+\.status-pill__dot\s*\{\s*background:\s*var\(--amber\)/);
  assert.match(STYLE_CSS, /\.status-pill--running\s+\.status-pill__dot\s*\{[\s\S]*animation:\s*pulse/);
});

test('--brand-dim is defined in both themes (the §11 AA text companion)', () => {
  assert.match(ruleBody(STYLE_CSS, ':root'), /--brand-dim\s*:/);
  assert.match(ruleBody(STYLE_CSS, '.theme-dark'), /--brand-dim\s*:/);
});

// --- AA verification of the §11 at-risk token pairs -------------------------
//
// WCAG 2.x relative-luminance + contrast ratio, computed over the resolved
// token hex values straight from the stylesheet, so changing a token without
// re-checking contrast fails this test.

function srgbToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(m, `expected a #rrggbb hex, got "${hex}"`);
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrast(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
/** Resolve a token to a hex, following up to a few `var(--x)` indirections. */
function resolveToken(themeSelector, name) {
  const block = ruleBody(STYLE_CSS, themeSelector);
  const root = ruleBody(STYLE_CSS, ':root');
  let cur = name;
  for (let i = 0; i < 6; i++) {
    const re = new RegExp(`${cur}\\s*:\\s*([^;]+);`);
    // Prefer the theme block's binding; fall back to :root for shared tokens.
    const val = (re.exec(block) || re.exec(root) || [])[1];
    assert.ok(val, `could not resolve ${cur} in ${themeSelector}/:root`);
    const v = val.trim();
    const varMatch = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
    if (varMatch) { cur = varMatch[1]; continue; }
    return v;
  }
  throw new Error(`token ${name} did not resolve to a value`);
}

const AA_NORMAL = 4.5;

test('§11 AA: --brand-dim as text on --card clears AA-normal in both themes', () => {
  for (const theme of [':root', '.theme-dark']) {
    const ratio = contrast(resolveToken(theme, '--brand-dim'), resolveToken(theme, '--card'));
    assert.ok(ratio >= AA_NORMAL, `${theme}: --brand-dim on --card is ${ratio.toFixed(2)}:1 (< ${AA_NORMAL})`);
  }
});

test('§11 AA: each status -dim text colour clears AA-normal on the page surface', () => {
  for (const theme of [':root', '.theme-dark']) {
    const bg = resolveToken(theme, '--bg');
    for (const tok of ['--green-dim', '--amber-dim', '--red-dim', '--slate-dim']) {
      const ratio = contrast(resolveToken(theme, tok), bg);
      assert.ok(ratio >= AA_NORMAL, `${theme}: ${tok} on --bg is ${ratio.toFixed(2)}:1 (< ${AA_NORMAL})`);
    }
  }
});

test('§11 note: --faint is structural (non-text), used only for hairlines', () => {
  // --faint on --bg is intentionally below the 4.5:1 TEXT bar — it is the
  // box-drawing / hairline colour (non-text, 3:1 bar), so it is NOT asserted as
  // a text pair. This test documents the exemption and guards the intent.
  const root = ruleBody(STYLE_CSS, ':root');
  assert.match(root, /--faint:\s*var\(--fg-vdim\)/, '--faint maps to the structural hairline token');
});

// --- Pre-paint shell --------------------------------------------------------

test('the shared shell emits a pre-paint theme script before the title', () => {
  const html = renderPage({ title: 'X', content: '<p>hi</p>' });
  // Reads the theme cookie and applies theme-dark to <html> before paint.
  assert.match(html, /document\.cookie/);
  assert.match(html, /theme-dark/);
  assert.match(html, /classList\.add\('theme-dark'\)/);
  // It must run ahead of the title so there is no flash of the light default.
  assert.ok(
    html.indexOf('document.cookie') < html.indexOf('<title>'),
    'pre-paint script must come before <title>'
  );
});

test('default render is light — no theme-dark class on body/html in static markup', () => {
  const html = renderPage({ title: 'X', content: '<p>hi</p>' });
  assert.doesNotMatch(html, /<html[^>]*class="[^"]*theme-dark/);
  assert.doesNotMatch(html, /<body[^>]*class="[^"]*theme-dark/);
});

// --- Persistence chain ------------------------------------------------------

test('applyUserPreferencesToSession rehydrates the theme preference', () => {
  const session = {};
  applyUserPreferencesToSession(session, { theme: 'dark' });
  assert.equal(session.theme, 'dark');

  const noTheme = {};
  applyUserPreferencesToSession(noTheme, { features: {} });
  assert.equal(noTheme.theme, undefined, 'absent preference must not set a theme');
});

test('VALID_THEMES is the light/dark allowlist', () => {
  assert.deepEqual(VALID_THEMES, ['light', 'dark']);
});

test('setThemeCookie writes a durable, client-readable theme cookie', () => {
  const calls = [];
  const res = { cookie: (name, value, opts) => calls.push({ name, value, opts }) };
  setThemeCookie(res, 'dark');
  assert.equal(calls.length, 1);
  const { name, value, opts } = calls[0];
  assert.equal(name, 'theme');
  assert.equal(value, 'dark');
  // Pre-paint script reads it via document.cookie, so it must NOT be httpOnly.
  assert.equal(opts.httpOnly, false);
  assert.equal(opts.sameSite, 'lax');
  assert.equal(opts.maxAge, THEME_COOKIE_MAX_AGE_MS);
  assert.ok(THEME_COOKIE_MAX_AGE_MS > 30 * 24 * 60 * 60 * 1000, 'cookie should outlive a session');
});
