/**
 * LIN-3136 censuses C1 and C4 (acceptance 13, server side; C3 lives in
 * lin-3134-declared-mint-census.test.js, C5 in lin-3136-copy-surface-census).
 *
 *  C1 every `createDispatchItem(` in `routes/proxy-*.js` (the proxy-token
 *     enqueue sinks) sits inside one of the three POST handlers that carry
 *     `requireGrant('dispatch')`, so no proxy-token route enqueues ungated.
 *  C4 the Flight Companion turn (`routes/proxy-flight-companion.js`) keeps
 *     `followUpMode: 'propose'`: it proposes a follow-up for the human to
 *     approve and never enqueues one itself.
 *
 * Pure scanners over `{file, src}`; the mutation witnesses plant a change in a
 * synthetic copy and assert the scan fails.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

const PROXY_ROUTE_FILES = readdirSync(join(REPO, 'routes'))
  .filter(name => /^proxy-.*\.js$/.test(name))
  .map(name => ({ file: `routes/${name}`, src: readFileSync(join(REPO, 'routes', name), 'utf8') }));

const GATED = "proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'),";
const EXPECTED_SINKS = { 'routes/proxy-dispatch.js': 3, 'routes/proxy-kickoff.js': 1 };

/** Each enqueue sink with the route registration it sits under. */
function scanC1(files) {
  const v = [];
  const counts = {};
  for (const { file, src } of files) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\bcreateDispatchItem\(/.test(line) || /^\s*(\/\/|\*)/.test(line) || /^import\b/.test(line)) return;
      counts[file] = (counts[file] || 0) + 1;
      let reg = null;
      for (let j = i; j >= 0; j--) {
        if (/^\s{2}router\.(get|post|put|patch|delete|use)\(/.test(lines[j])) { reg = lines[j]; break; }
      }
      if (!reg || !reg.includes("router.post(") || !reg.includes(GATED)) {
        v.push(`${file}:${i + 1} createDispatchItem( is not under a dispatch-gated POST (${reg ? reg.trim().slice(0, 80) : 'no registration'})`);
      }
    });
  }
  for (const [file, n] of Object.entries(EXPECTED_SINKS)) {
    if ((counts[file] || 0) !== n) v.push(`${file}: expected ${n} enqueue sinks, found ${counts[file] || 0}`);
  }
  for (const file of Object.keys(counts)) {
    if (!(file in EXPECTED_SINKS)) v.push(`${file}: an unlisted proxy enqueue sink`);
  }
  return v;
}

describe('LIN-3136 C1 — every proxy-token enqueue sink is behind the dispatch gate', () => {
  test('the live tree: 4 sinks, all under the three gated POST handlers', () => {
    assert.deepEqual(scanC1(PROXY_ROUTE_FILES), []);
  });

  test('mutation: the gate removed from a mount fails C1', () => {
    const mutated = PROXY_ROUTE_FILES.map(f => (f.file === 'routes/proxy-kickoff.js'
      ? { ...f, src: f.src.replace("requireWriteScope, requireGrant('dispatch'), async", 'requireWriteScope, async') } : f));
    assert.ok(scanC1(mutated).some(m => m.startsWith('routes/proxy-kickoff.js:') && m.includes('not under a dispatch-gated POST')));
  });

  test('mutation: a sink in a new ungated proxy route fails C1', () => {
    const planted = [...PROXY_ROUTE_FILES, {
      file: 'routes/proxy-new.js',
      src: "export function x() {\n  router.post('/api/proxy/new', proxyLimiter, authenticateProxyToken, requireWriteScope, async (req, res) => {\n      const item = await createDispatchItem({});\n  });\n}\n"
    }];
    const v = scanC1(planted);
    assert.ok(v.some(m => m.startsWith('routes/proxy-new.js:3')));
    assert.ok(v.some(m => m === 'routes/proxy-new.js: an unlisted proxy enqueue sink'));
  });
});

function scanC4(files) {
  const fc = files.find(f => f.file === 'routes/proxy-flight-companion.js');
  if (!fc) return ['routes/proxy-flight-companion.js is missing'];
  const v = [];
  if (!fc.src.includes("followUpMode: 'propose'")) v.push("followUpMode: 'propose' is gone");
  if (/followUpMode:\s*'(?!propose')/.test(fc.src)) v.push('another followUpMode is set');
  if (/\bcreateDispatchItem\(/.test(fc.src)) v.push('the Flight Companion turn enqueues directly');
  return v;
}

describe('LIN-3136 C4 — the Flight Companion turn proposes, never enqueues', () => {
  test("the live tree keeps followUpMode: 'propose'", () => {
    assert.deepEqual(scanC4(PROXY_ROUTE_FILES), []);
  });

  test("mutation: followUpMode switched away from 'propose' fails C4", () => {
    const mutated = PROXY_ROUTE_FILES.map(f => (f.file === 'routes/proxy-flight-companion.js'
      ? { ...f, src: f.src.replace("followUpMode: 'propose'", "followUpMode: 'send'") } : f));
    assert.ok(scanC4(mutated).length > 0);
  });
});
