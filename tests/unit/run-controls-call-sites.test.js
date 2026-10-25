/**
 * LIN-3849 guard (Class 2): a route that renders a page must get its feature
 * flags from `requestFeatureFlags(req)` (which adds the derived `runControls` /
 * `runSetup` bits), never from the sync `getFeatureFlags(session)`. A render
 * handler left on the sync call would silently drop the owner's run controls on
 * that one page.
 *
 * The sync calls that remain are NOT renders: they gate on a stored flag and
 * return JSON / a redirect, or feed prompt generation. They are listed by file
 * with their count and reason, so a new or forgotten sync call fails here with
 * the file and line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALLOWED_SYNC = {
  'routes/collective.js': [4, 'JSON gates on `collective`; the page render uses requestFeatureFlags'],
  'routes/flight-companion.js': [4, 'JSON / SSE gates on `flightCompanion`'],
  'routes/live-console.js': [1, 'JSON gate on `liveConsole`'],
  'routes/ship-biscuit.js': [1, 'JSON gate on `shipBiscuit` (a keepalive test pins it is not delayed)'],
  'routes/task-chat.js': [2, 'JSON gates on `taskChat`'],
  'routes/workspace-api-prompts.js': [2, 'prompt generation reads the stored flags, no nav'],
  'routes/workspace-api-roadmap.js': [7, 'JSON roadmap API, no nav'],
  'routes/workspace-api.js': [1, 'recommend call options (session flags), no nav'],
  'server.js': [2, 'the `.ship` redirect check; the post-401 re-render (no req: it calls resolveRunControls beside it)']
};

function files() {
  const out = ['server.js'];
  for (const f of readdirSync(join(ROOT, 'routes'))) if (f.endsWith('.js')) out.push(`routes/${f}`);
  return out;
}

test('every sync getFeatureFlags( call in routes/ and server.js is a listed non-render use', () => {
  const found = {};
  for (const f of files()) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (l.includes('getFeatureFlags(') && !/^\s*import /.test(l)) (found[f] ||= []).push(i + 1);
    });
  }
  for (const [f, lines] of Object.entries(found)) {
    assert.ok(ALLOWED_SYNC[f], `${f}:${lines.join(',')} calls the sync getFeatureFlags( but is not listed: render handlers must use requestFeatureFlags(req)`);
    assert.equal(lines.length, ALLOWED_SYNC[f][0], `${f}: expected ${ALLOWED_SYNC[f][0]} sync calls (${ALLOWED_SYNC[f][1]}), found at lines ${lines.join(',')}`);
  }
  for (const f of Object.keys(ALLOWED_SYNC)) assert.ok(found[f], `${f} is listed but has no sync call left: shrink the allowlist`);
});

test('every renderer that draws the nav forwards featureFlags to renderNavBar', () => {
  const bad = [];
  for (const dir of ['lib', 'routes']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!f.endsWith('.js')) continue;
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      const re = /renderNavBar\(\s*\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(src))) {
        if (!/featureFlags/.test(m[1])) bad.push(`${dir}/${f}: ${m[0].slice(0, 80)}`);
      }
    }
  }
  // Landing is unauthenticated: it has no urlKey, so no run controls to carry.
  const real = bad.filter((b) => !b.startsWith('lib/render-landing.js'));
  assert.deepEqual(real, [], 'a renderNavBar call that drops featureFlags loses the owner\'s Dispatch link and queue/rulings badges on that page');
});
