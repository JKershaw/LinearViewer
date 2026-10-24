/**
 * LIN-3849 guard (Classes 1 and 5): the `dispatch` and `proxy` per-user
 * switches are gone, so nothing may read them again, in shipped source or in the
 * living docs and served prose that describe them.
 *
 *   code: lib/ routes/ public/ server.js
 *   docs: docs/ (minus dated records), README.md, CLAUDE.md, public/llms.txt
 *
 * `dispatchEnabled` is deliberately NOT in the pattern: it survives as the opts
 * key fed by `runControls`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function grep(pattern, paths, excludes = []) {
  try {
    return execFileSync('git', ['grep', '-n', '-i', '-E', pattern, '--', ...paths, ...excludes.map((e) => `:!${e}`)], { cwd: ROOT, encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return [];
    throw e;
  }
}

// Reads of the two flags, and the identifiers that existed only to carry them.
const CODE = '(Flags|flags|features)\\??\\.(dispatch|proxy)([^A-Za-z]|$)|\\.(dispatch|proxy) (===|!==) (true|false)|needsFlag: .dispatch.|FEATURES\\.(DISPATCH|PROXY)|data-proxy-feature|proxyFeature|proxyEnabled|proxyAvailable|hasAutopilot|data-proxy-available';

test('no shipped source reads the removed dispatch / proxy switches', () => {
  const hits = grep(CODE, ['lib', 'routes', 'public', 'server.js'], ['public/llms.txt']);
  assert.deepEqual(hits, []);
});

const DOCS = 'featureFlags\\??\\.(dispatch|proxy)\\b|FEATURES\\.(DISPATCH|PROXY)|data-proxy-feature|data-proxy-available|proxyEnabled|proxyAvailable|proxy-off|owner-dispatch-off|proxy access is off|when `?proxy`? is (on|off)';

test('no living doc or served prose names a removed identifier', () => {
  const hits = grep(DOCS, ['docs', 'README.md', 'CLAUDE.md', 'public/llms.txt'],
    ['docs/lin-482-*', 'docs/reviews/*', 'docs/papers/*', 'docs/plan-LIN-*']);
  assert.deepEqual(hits, []);
});

test('the Settings page and the feature tables carry neither switch', async () => {
  const fd = await import('../../lib/feature-defaults.js');
  for (const key of ['dispatch', 'proxy']) {
    assert.ok(!fd.isValidFeatureKey(key), key);
    assert.ok(!(key in fd.FEATURE_DEFAULTS) && !(key in fd.FEATURE_LABELS) && !(key in fd.FEATURE_DESCRIPTIONS), key);
  }
  assert.equal(fd.FEATURES.DISPATCH, undefined);
  assert.equal(fd.FEATURES.PROXY, undefined);
});
