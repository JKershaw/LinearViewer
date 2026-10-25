// Pure-helper tests for pages.mjs. Outside the tests/unit and scripts/code-shape globs, so it never
// joins `npm test`. Run: node --test tests/judge/pages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, AREAS, coverageOfChange, coveredRenderers, cssNamesIn, parsePixelDiff, renderersOf } from './pages.mjs';

test('the page list holds the pages and states the ticket asks for (LIN-3889 adds the back-link pages and audit-report) (the 4th, Running with no runner, is the Running page itself)', () => {
  const ids = PAGES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['home', 'task', 'dispatch', 'proxy', 'audit', 'settings-index', 'styleguide', 'privacy', 'terms', ...AREAS.map((a) => `settings-${a}`)]) assert.ok(ids.includes(id), id);
  assert.deepEqual(PAGES.filter((p) => p.state).map((p) => p.state).sort(), ['ask-open', 'audit-report', 'change-log-entry', 'email-signin', 'home-run-panel-open', 'key-open', 'models-panel-open', 'models-staged', 'paused', 'swipe-dispatch-open']);
  for (const id of ['account-home', 'workspace-not-found']) assert.ok(ids.includes(id), id);
  assert.equal(AREAS.length, 8);
});

test('states that write data never share an urlKey with a plain page', () => {
  const plain = new Set(PAGES.filter((p) => !p.state).map((p) => p.urlKey));
  for (const p of PAGES.filter((q) => q.state === 'key-open' || q.state === 'change-log-entry' || q.state === 'home-run-panel-open')) assert.ok(!plain.has(p.urlKey), p.id);
});

test('every mask names a reason', () => {
  for (const p of PAGES) for (const m of p.masks || []) assert.ok(m.selector && m.reason, p.id);
});

test('cssNamesIn keeps top-level public stylesheets only', () => {
  assert.deepEqual(cssNamesIn(['public/settings.css', 'public/x.js', 'docs/a.css', 'public/sub/y.css', 'public/audit.css']), ['audit.css', 'settings.css']);
});

test('coverage: a changed stylesheet whose renderer is on no listed page is reported', () => {
  const renderers = { 'settings.css': ['lib/render-settings.js'], 'collective.css': ['lib/render-collective.js'] };
  const r = coverageOfChange(['public/settings.css', 'public/collective.css', 'lib/x.js'], (css) => renderers[css] || []);
  assert.deepEqual(r.changed, ['collective.css', 'settings.css']);
  assert.deepEqual(r.uncovered, [{ css: 'collective.css', renderers: ['lib/render-collective.js'] }]);
});

test('coverage: nothing changed, or only covered renderers, is clean', () => {
  assert.deepEqual(coverageOfChange([], () => []).uncovered, []);
  assert.deepEqual(coverageOfChange(['public/audit.css'], () => ['lib/render-audit.js']).uncovered, []);
  assert.ok(coveredRenderers().has('lib/components/page.js'));
});

test('renderersOf finds the renderer that links a stylesheet, in this repo at HEAD', () => {
  assert.ok(renderersOf(new URL('../..', import.meta.url).pathname, 'HEAD', 'audit.css').includes('lib/render-audit.js'));
  assert.deepEqual(renderersOf(new URL('../..', import.meta.url).pathname, 'HEAD', 'no-such-sheet-xyz.css'), []);
});

test('parsePixelDiff reads the comparator message', () => {
  assert.deepEqual(parsePixelDiff('Expected an image 1280px by 900px, received 1280px by 900px. 123 pixels (ratio 0.01 of all image pixels) are different.'), { pixels: 123 });
  assert.deepEqual(parsePixelDiff('Expected an image 1280px by 900px, received 1280px by 901px.'), { sizeMismatch: true });
  assert.equal(parsePixelDiff('something else'), null);
});
