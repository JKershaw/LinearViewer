/**
 * LIN-3980: the pre-paint theme script is the one dark mechanism. Its contract:
 *   - a stored `theme` cookie always wins, light included;
 *   - with no cookie, only a page that opted in (`data-theme-system` on <html>)
 *     follows `prefers-color-scheme`;
 *   - every other page stays light with no cookie, as before.
 * The script is run for real in a vm with a stub document, so the test pins
 * behaviour, not the bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage, themePrepaintScriptHash, THEME_PREPAINT_SCRIPT_BODY } from '../../lib/components/page.js';
import { scriptBodyHash } from '../../lib/components/page.js';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '../../lib');

function runPrepaint({ cookie = '', systemDark = false, optedIn = false }) {
  const classes = new Set();
  const documentElement = {
    classList: { add: (c) => classes.add(c) },
    hasAttribute: (name) => name === 'data-theme-system' && optedIn,
  };
  const sandbox = {
    document: { cookie, documentElement },
    window: { matchMedia: (q) => ({ matches: q === '(prefers-color-scheme: dark)' && systemDark }) },
  };
  vm.runInNewContext(THEME_PREPAINT_SCRIPT_BODY, sandbox);
  return classes.has('theme-dark');
}

test('a stored dark preference wins everywhere', () => {
  assert.equal(runPrepaint({ cookie: 'theme=dark', systemDark: false }), true);
  assert.equal(runPrepaint({ cookie: 'theme=dark', systemDark: false, optedIn: true }), true);
});

test('a stored light preference wins over a dark system (the LIN-3980 bug)', () => {
  assert.equal(runPrepaint({ cookie: 'theme=light', systemDark: true, optedIn: true }), false);
});

test('no cookie on an opted-in page follows a dark system', () => {
  assert.equal(runPrepaint({ cookie: '', systemDark: true, optedIn: true }), true);
  assert.equal(runPrepaint({ cookie: '', systemDark: false, optedIn: true }), false);
});

test('no cookie on a page that did not opt in stays light, even on a dark system', () => {
  assert.equal(runPrepaint({ cookie: '', systemDark: true, optedIn: false }), false);
});

test('renderPage marks <html> only when the page opts in', () => {
  const opted = renderPage({ title: 'x', followSystemTheme: true });
  const plain = renderPage({ title: 'x' });
  assert.match(opted, /<html lang="en" data-theme-system>/);
  assert.match(plain, /<html lang="en">/);
});

test('every page emits the same pre-paint script, so one CSP hash covers all', () => {
  const body = THEME_PREPAINT_SCRIPT_BODY;
  const hash = scriptBodyHash(body);
  assert.equal(themePrepaintScriptHash(), hash);
  assert.ok(renderPage({ title: 'x', followSystemTheme: true }).includes(`<script>${body}</script>`));
  assert.ok(renderPage({ title: 'x' }).includes(`<script>${body}</script>`));
});

// body.is-landing once carried a dark remap that every page using the class
// inherited (the landing, Library, legal, KPIs, templates, styleguide and the
// signed-out previews). Those pages now opt in explicitly. A page that adds the
// class without opting in would silently lose system dark, so the guard is here.
test('every page that uses the is-landing body class opts in to the system theme', () => {
  const offenders = readdirSync(LIB)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => {
      const src = readFileSync(join(LIB, f), 'utf8');
      return /bodyClass:\s*(?:isLanding \? )?'is-landing/.test(src) && !/followSystemTheme/.test(src);
    });
  assert.deepEqual(offenders, []);
});

// LIN-3980 finding: the landing's dark tokens were a second copy, and library.css
// still had a `body.is-landing` system-dark rule beside the `.theme-dark` one, so a
// stored light preference lost on a dark system. Dark follows the one mechanism
// (the pre-paint script on `.theme-dark`), so no stylesheet may key a system-scheme
// rule on the landing's body class.
test('no stylesheet keys a prefers-color-scheme rule on body.is-landing', () => {
  const PUBLIC = join(LIB, '..', 'public');
  const offenders = readdirSync(PUBLIC)
    .filter((f) => f.endsWith('.css'))
    .filter((f) => /@media\s*\([^)]*prefers-color-scheme[^)]*\)\s*\{\s*body\.is-landing/.test(readFileSync(join(PUBLIC, f), 'utf8')));
  assert.deepEqual(offenders, []);
});
