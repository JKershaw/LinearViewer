/**
 * Unit tests for the theme token layer + pre-paint bootstrap (LIN-756).
 *
 * Run with: node --test tests/unit/theme-tokens.test.js
 *
 * Guards three things the foundation work must hold:
 *  1. The doc-vocabulary aliases (--amber/--slate/--muted) and the net-new
 *     surface/elevation tokens (--raised/--card/--inset) are present in ALL THREE
 *     theme blocks (:root / .theme-dark / .theme-amber), symmetrically.
 *  2. The theme-specific --green/--red are NOT clobbered — each block keeps its
 *     own distinct value.
 *  3. renderPage emits the pre-paint theme bootstrap as the first head script,
 *     before any stylesheet link, and the settings page renders the theme control.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderPage } from '../../lib/components/page.js';
import { renderSettingsPage } from '../../lib/render-settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, '../../public/style.css'), 'utf8');

/** Extract the declaration body of a top-level rule (`selector { ... }`). */
function blockBody(css, selector) {
  const start = css.indexOf(selector + ' {');
  assert.ok(start !== -1, `selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  assert.ok(close !== -1, `unterminated block: ${selector}`);
  return css.slice(open + 1, close);
}

const ROOT = blockBody(CSS, ':root');
const DARK = blockBody(CSS, '.theme-dark');
const AMBER = blockBody(CSS, '.theme-amber');

const NEW_TOKENS = ['--amber', '--slate', '--muted', '--raised', '--card', '--inset'];

describe('theme token layer (LIN-756)', () => {
  for (const [name, block] of [[':root', ROOT], ['.theme-dark', DARK], ['.theme-amber', AMBER]]) {
    test(`${name} defines every new doc/surface token`, () => {
      for (const token of NEW_TOKENS) {
        assert.match(block, new RegExp(`${token}\\s*:`), `${name} is missing ${token}`);
      }
    });
  }

  test('--green keeps its distinct per-theme value (not clobbered)', () => {
    assert.match(ROOT, /--green:\s*#16a34a/);
    assert.match(DARK, /--green:\s*#2ee65f/);
    assert.match(AMBER, /--green:\s*#8fdb5f/);
  });

  test('--red keeps its distinct per-theme value (not clobbered)', () => {
    assert.match(ROOT, /--red:\s*#cc0000/);
    assert.match(DARK, /--red:\s*#ff6b6b/);
    assert.match(AMBER, /--red:\s*#ff5f56/);
  });

  test('surface/elevation tokens are concrete colors per theme, not shared aliases', () => {
    // --card differs across themes (a real ramp, not one value reused).
    const card = (block) => block.match(/--card:\s*([^;]+);/)[1].trim();
    assert.notStrictEqual(card(ROOT), card(DARK));
    assert.notStrictEqual(card(DARK), card(AMBER));
  });
});

describe('pre-paint theme bootstrap (LIN-756)', () => {
  const html = renderPage({ title: 'T', stylesheets: ['/style.css'] });

  test('emits an inline bootstrap that reads localStorage theme and sets documentElement', () => {
    assert.match(html, /localStorage\.getItem\('theme'\)/);
    assert.match(html, /document\.documentElement\.className/);
  });

  test('falls back to the theme cookie when localStorage is empty', () => {
    assert.match(html, /document\.cookie\.match/);
  });

  test('the bootstrap runs before the first stylesheet link (no FOUC)', () => {
    const scriptIdx = html.indexOf("localStorage.getItem('theme')");
    const cssIdx = html.indexOf('<link rel="stylesheet"');
    assert.ok(scriptIdx !== -1 && cssIdx !== -1);
    assert.ok(scriptIdx < cssIdx, 'theme bootstrap must precede stylesheet links');
  });
});

describe('settings theme control (LIN-756)', () => {
  const BASE = { urlKey: 'acme', workspaces: [], availableModels: [] };

  test('renders the appearance section with all three theme options', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-testid="settings-section-appearance"/);
    assert.match(html, /data-theme-option="light"/);
    assert.match(html, /data-theme-option="dark"/);
    assert.match(html, /data-theme-option="amber"/);
  });

  test('marks the active theme and posts to the theme route', () => {
    const html = renderSettingsPage('Acme', { ...BASE, theme: 'amber' });
    assert.match(html, /\/workspace\/acme\/settings\/theme/);
    // The amber option carries the active marker / pressed state.
    assert.match(html, /data-theme-option="amber" aria-pressed="true"/);
  });

  test('defaults to light when no theme is provided', () => {
    const html = renderSettingsPage('Acme', BASE);
    assert.match(html, /data-theme-option="light" aria-pressed="true"/);
  });
});
