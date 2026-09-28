/**
 * LIN-3130 S2a — L2 source pin (review f444705e / close-out d1ff048b).
 *
 * The consumer-recency fix relies on EVERY `createDispatchItem` call site
 * threading `proxyTokenStore`, so the enqueue stamp can fold the runner's
 * take-grant token into `consumerLastSeenAt`. A future call site that forgets
 * it would silently regress a runner-only workspace to "never polled" — this
 * source pin fails loudly instead. The factory's own definition is excluded;
 * only the 10 real call sites are checked, and each must be an object-literal
 * call (`createDispatchItem({ … })`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function findMatchingBrace(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

describe('LIN-3130 L2 — every createDispatchItem call site threads proxyTokenStore', () => {
  test('all object-literal call sites pass proxyTokenStore (runner recency cannot silently regress)', () => {
    const files = [...walk(join(REPO, 'routes')), ...walk(join(REPO, 'lib'))];
    const calls = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/createDispatchItem\s*\(/g)) {
        // Only object-literal calls; a comment mention (`createDispatchItem(...)`)
        // is not followed by `{`, and the definition is preceded by `function`.
        if (!/^\s*\{/.test(src.slice(m.index + m[0].length))) continue;
        if (/function\s+$/.test(src.slice(Math.max(0, m.index - 30), m.index))) continue;

        const open = src.indexOf('{', m.index + m[0].length);
        const close = findMatchingBrace(src, open);
        assert.ok(close !== -1, `${file}: unbalanced braces parsing a createDispatchItem call`);
        calls.push({
          file: file.slice(REPO.length + 1),
          hasProxyTokenStore: /\bproxyTokenStore\b/.test(src.slice(open, close + 1))
        });
      }
    }

    const missing = calls.filter((c) => !c.hasProxyTokenStore).map((c) => c.file);
    assert.deepEqual(missing, [], `createDispatchItem call sites missing proxyTokenStore: ${missing.join(', ')}`);
    assert.equal(calls.length, 10, `expected 10 createDispatchItem call sites, found ${calls.length}`);
  });
});
