/**
 * LIN-3846 census: every setting and every settings route is placed in exactly one area, and
 * the test fails on one that is placed nowhere. Settings = every FEATURE_DEFAULTS and
 * WORKSPACE_FEATURE_KEYS key, plus the +proxy default, the theme and consent. Routes = the
 * enumeration `grep -rnE "(app|router)\.(get|post)\(['\"]/(workspace/:urlKey/)?(settings|auth/openrouter)"
 * server.js lib routes`.
 *
 * Run with: node --test tests/unit/settings-areas-census.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AREAS, INDEX_ROUTES, STATE_MAX_LENGTH, getArea, settingsAreaUrl, areasHoldingSetting } from '../../lib/settings-areas.js';
import { FEATURE_DEFAULTS, WORKSPACE_FEATURE_KEYS } from '../../lib/feature-defaults.js';
import { renderSettingsPage } from '../../lib/render-settings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALL_AREAS = AREAS.map(a => a.id);

const SETTINGS = [...Object.keys(FEATURE_DEFAULTS), ...WORKSPACE_FEATURE_KEYS, 'proxyDefault', 'theme', 'consent'];

// How each setting shows on its area's page.
const MARKER = (key) => {
  if (key === 'theme') return 'data-testid="settings-theme"';
  if (key === 'consent') return 'data-testid="settings-openrouter-consent-status"';
  return `data-testid="settings-toggle-${key}"`;
};

const page = (area, extra = {}) => renderSettingsPage('Acme', { urlKey: 'acme', area, openRouterSource: 'oauth', isOwner: true, ...extra });

describe('settings: each renders in exactly one area', () => {
  for (const key of SETTINGS) {
    test(`${key}`, () => {
      const holders = areasHoldingSetting(key);
      assert.equal(holders.length, 1, `${key} must be placed in exactly one area, found: ${holders.join(', ') || 'none'}`);
      const rendersIn = ALL_AREAS.filter(id => page(id).includes(MARKER(key)));
      assert.deepEqual(rendersIn, holders, `${key} must render on the page of the area that holds it, and on no other`);
    });
  }

  test('the census names no setting that does not exist', () => {
    for (const a of AREAS) for (const k of a.features) assert.ok(SETTINGS.includes(k), `${a.id} lists unknown setting ${k}`);
  });

  test('witness: a setting removed from its area fails the census', () => {
    const features = getArea('features');
    const saved = features.features;
    features.features = saved.filter(k => k !== 'roadmap');
    try { assert.equal(areasHoldingSetting('roadmap').length, 0); } finally { features.features = saved; }
    assert.equal(areasHoldingSetting('roadmap').length, 1);
  });
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const ROUTE_RE = /(?:app|router)\.(get|post)\(\s*['"]\/(?:workspace\/:urlKey\/)?((?:settings|auth\/openrouter)[^'"]*)['"]/g;

function liveRoutes() {
  const files = [join(ROOT, 'server.js'), ...walk(join(ROOT, 'lib')), ...walk(join(ROOT, 'routes'))];
  const found = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(ROUTE_RE)) found.push({ file: relative(ROOT, f), route: `${m[1].toUpperCase()} /${m[2]}` });
  }
  return found;
}

describe('settings routes: each placed once', () => {
  const placed = [...INDEX_ROUTES, ...AREAS.flatMap(a => a.routes)];

  test('every route found in server.js, lib/ and routes/ is placed', () => {
    const live = liveRoutes();
    assert.ok(live.length >= 18, `the census should see the settings routes, saw ${live.length}`);
    const missing = live.filter(({ route }) => !placed.includes(route));
    // routes/settings.js registers the area page route with a parameter; it is the index/area GET.
    const unplaced = missing.filter(({ route }) => route !== 'GET /settings/:area');
    assert.deepEqual(unplaced, [], 'a settings route that is placed in no area');
  });

  test('no route is placed twice, and every placed route exists', () => {
    const dupes = placed.filter((r, i) => placed.indexOf(r) !== i);
    assert.deepEqual(dupes, []);
    const live = new Set(liveRoutes().map(r => r.route));
    const gone = placed.filter(r => !live.has(r));
    assert.deepEqual(gone, [], 'the census lists a route that no longer exists');
  });

  test('the new routes are registered (running/halt, change-log undo, consent/clear)', () => {
    const src = [
      readFileSync(join(ROOT, 'routes/settings.js'), 'utf8'),
      readFileSync(join(ROOT, 'routes/openrouter-auth.js'), 'utf8')
    ].join('\n');
    assert.match(src, /settings\/running\/halt/);
    assert.match(src, /settings\/change-log\/:source\/:id\/undo/);
    assert.match(src, /\/auth\/openrouter\/consent\/clear/);
  });

  test('the three model routes count as placed in Models', () => {
    assert.deepEqual(getArea('models').routes.sort(), ['POST /settings/ai-model-overrides', 'POST /settings/dispatch-defaults', 'POST /settings/model']);
  });

  test('witness: an unplaced route is reported', () => {
    const live = liveRoutes();
    const without = AREAS.flatMap(a => a.routes).filter(r => r !== 'POST /settings/theme');
    const unplaced = live.filter(({ route }) => ![...INDEX_ROUTES, ...without].includes(route) && route !== 'GET /settings/:area');
    assert.ok(unplaced.some(u => u.route === 'POST /settings/theme'));
  });
});

describe('sidebar states', () => {
  const ctx = { providerBindings: [{ displayName: 'Linear', active: true }], defaultModelName: 'Sonnet 5.5', haltMode: 'none', hasRunner: true, keyCount: 3, healthProblems: 1, changeLogCount: 2, featuresOn: 4, openRouterSource: 'oauth' };

  test('every area has a short state, at most the cap, and tone', () => {
    for (const a of AREAS) {
      const s = a.state(ctx);
      assert.ok(s.text.length > 0 && s.text.length <= STATE_MAX_LENGTH, `${a.id}: "${s.text}"`);
      assert.ok(['ok', 'bad'].includes(s.tone));
    }
  });

  test('the words: a red dot for what needs fixing, stop and pause, no runner', () => {
    assert.deepEqual(getArea('health').state(ctx), { text: '1 to fix', tone: 'bad' });
    assert.deepEqual(getArea('health').state({ healthProblems: 0 }), { text: 'All clear', tone: 'ok' });
    assert.equal(getArea('running').state({ ...ctx, haltMode: 'stop' }).text, 'Stopped');
    assert.equal(getArea('running').state({ ...ctx, haltMode: 'pause' }).tone, 'bad');
    assert.equal(getArea('running').state({ ...ctx, hasRunner: false }).text, 'No runner');
    assert.equal(getArea('running').state(ctx).text, 'Runner ready');
    assert.equal(getArea('models').state(ctx).text, 'Sonnet 5.5');
    assert.equal(getArea('agent-access').state({ keyCount: 1 }).text, '1 key');
    assert.equal(getArea('account').state({ openRouterSource: 'free' }).text, 'Free tier');
    assert.equal(getArea('change-log').state({ changeLogCount: 0 }).text, 'Empty');
  });

  test('a long model name is clipped to the cap', () => {
    assert.ok(getArea('models').state({ defaultModelName: 'A very long model display name' }).text.length <= STATE_MAX_LENGTH);
  });

  test('every state renders in the sidebar of every page with its testid', () => {
    const states = Object.fromEntries(AREAS.map(a => [a.id, a.state(ctx)]));
    const html = page('account', { states });
    for (const a of AREAS) assert.match(html, new RegExp(`data-testid="settings-state-${a.id}"`));
    assert.match(html, /settings-dot/, 'the red dot is drawn for a state that needs fixing');
  });
});

test('settingsAreaUrl lands on the area, or the index', () => {
  assert.equal(settingsAreaUrl('acme'), '/workspace/acme/settings');
  assert.equal(settingsAreaUrl('a b', 'sources', { provider_ok: 'jira' }), '/workspace/a%20b/settings/sources?provider_ok=jira');
});
