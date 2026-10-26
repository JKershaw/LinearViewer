// Pure-helper tests for pages.mjs. Outside the tests/unit and scripts/code-shape globs, so it never
// joins `npm test`. Run: node --test tests/judge/pages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pngSize, layoutClass, PAGES, AREAS, coverageOfChange, coveredRenderers, cssNamesIn, parsePixelDiff, renderersOf } from './pages.mjs';

test('the page list holds the pages and states the ticket asks for (LIN-3889 adds the back-link pages and audit-report) (the 4th, Running with no runner, is the Running page itself)', () => {
  const ids = PAGES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['home', 'task', 'dispatch', 'proxy', 'audit', 'settings-index', 'styleguide', 'privacy', 'terms', ...AREAS.map((a) => `settings-${a}`)]) assert.ok(ids.includes(id), id);
  // LIN-3987: the list follows every state the page list carries (home-copy-*, home-failed, home-running and home-stages-done
  // were added by LIN-3968 without this pin, which was already stale on main).
  assert.deepEqual(PAGES.filter((p) => p.state).map((p) => p.state).sort(), ['ask-open', 'audit-report', 'change-log-entry', 'email-signin', 'home-copy-first', 'home-copy-written', 'home-failed', 'home-failed-first', 'home-run-panel-open', 'home-run-panel-opencode', 'home-run-panel-pick', 'home-running', 'home-stages-done', 'key-open', 'live-history', 'live-working', 'models-panel-open', 'models-staged', 'obs-two-runs', 'obs-two-runs', 'obs-two-runs', 'paused', 'swipe-dispatch-open', 'task-build-done', 'task-chat-open', 'task-failed', 'task-guest', 'task-member', 'task-no-runner', 'task-ready', 'task-running', 'task-waiting']);
  for (const id of ['account-home', 'workspace-not-found']) assert.ok(ids.includes(id), id);
  assert.equal(AREAS.length, 8);
});

test('states that write data never share an urlKey with a plain page', () => {
  const plain = new Set(PAGES.filter((p) => !p.state).map((p) => p.urlKey));
  for (const p of PAGES.filter((q) => q.state === 'key-open' || q.state === 'change-log-entry' || q.state === 'home-run-panel-open' || q.state === 'home-run-panel-opencode' || q.state === 'home-run-panel-pick' || q.state === 'swipe-dispatch-open' || q.state === 'live-working' || q.state === 'live-history')) assert.ok(!plain.has(p.urlKey), p.id);
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

// LIN-3975 (judge classification): the layout class comes from each PNG's own size, not from the comparator's text,
// which can carry a pixel count even when the two pages differ in height.
const pngOf = (width, height) => {
  const buf = Buffer.alloc(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
};
test('layoutClass reads each PNG size: a height change is layout, even when the comparator also counted pixels', () => {
  assert.deepEqual(pngSize(pngOf(1280, 1409)), { width: 1280, height: 1409 });
  assert.equal(pngSize(Buffer.from('not a png at all, just text')), null);
  assert.equal(layoutClass(pngOf(1280, 900), pngOf(1280, 900)), 'paint (same size)');
  assert.equal(layoutClass(pngOf(1280, 1409), pngOf(1280, 1451)), 'layout (page size 1280x1409 -> 1280x1451)');
});

test('parsePixelDiff reads the comparator message', () => {
  assert.deepEqual(parsePixelDiff('Expected an image 1280px by 900px, received 1280px by 900px. 123 pixels (ratio 0.01 of all image pixels) are different.'), { pixels: 123 });
  assert.deepEqual(parsePixelDiff('Expected an image 1280px by 900px, received 1280px by 901px.'), { sizeMismatch: true });
  assert.equal(parsePixelDiff('something else'), null);
});
