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
 *
 * LIN-3601: inside the proxy entrances (routes/proxy-dispatch.js, routes/proxy-kickoff.js,
 * lib/dispatch-entrance.js, treated as one unit) C1 asks only that a sink exists;
 * the gate in front of it is dispatch-entrance-proxy-grant-sweep.test.js's. Every
 * other proxy route file stays exact.
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
// LIN-3601: the proxy entrances are judged with lib/dispatch-entrance.js as one unit.
const ENTRANCE_LIB = { file: 'lib/dispatch-entrance.js', src: readFileSync(join(REPO, 'lib/dispatch-entrance.js'), 'utf8') };
const SCANNED_FILES = [...PROXY_ROUTE_FILES, ENTRANCE_LIB];

const GATED = "proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'),";
// LIN-3601: was { 'routes/proxy-dispatch.js': 3, 'routes/proxy-kickoff.js': 1 }, an exact count per
// file, each sink tied to the registration above it. Those two files and
// lib/dispatch-entrance.js are the proxy entrances (E); inside E a sink may sit in
// any of them, and the gate in front of each is carried by
// dispatch-entrance-proxy-grant-sweep.test.js (every write route of the composer is
// called with a readWrite token lacking `dispatch` and a read token; neither reaches
// addItem or expandCascadeAborts). Every OTHER proxy route file stays exact below.
const E_PROXY_FILES = new Set(['routes/proxy-dispatch.js', 'routes/proxy-kickoff.js', 'lib/dispatch-entrance.js']);

/** Each enqueue sink; outside E, with the route registration it sits under. */
function scanC1(files) {
  const v = [];
  const counts = {};
  for (const { file, src } of files) {
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\bcreateDispatchItem\(/.test(line) || /^\s*(\/\/|\*)/.test(line) || /^import\b/.test(line)) return;
      counts[file] = (counts[file] || 0) + 1;
      if (E_PROXY_FILES.has(file)) return;
      let reg = null;
      for (let j = i; j >= 0; j--) {
        if (/^\s{2}router\.(get|post|put|patch|delete|use)\(/.test(lines[j])) { reg = lines[j]; break; }
      }
      if (!reg || !reg.includes("router.post(") || !reg.includes(GATED)) {
        v.push(`${file}:${i + 1} createDispatchItem( is not under a dispatch-gated POST (${reg ? reg.trim().slice(0, 80) : 'no registration'})`);
      }
    });
  }
  const inE = [...E_PROXY_FILES].reduce((n, f) => n + (counts[f] || 0), 0);
  if (inE < 1) v.push('the proxy entrances hold no enqueue sink at all: expected at least one in routes/proxy-dispatch.js, routes/proxy-kickoff.js or lib/dispatch-entrance.js');
  for (const file of Object.keys(counts)) {
    if (!E_PROXY_FILES.has(file)) v.push(`${file}: an unlisted proxy enqueue sink`);
  }
  return v;
}

describe('LIN-3136 C1 — every proxy-token enqueue sink is behind the dispatch gate', () => {
  test('the live tree: the entrances hold an enqueue sink; no other proxy file holds one, and any outside E sits under a gated POST', () => {
    assert.deepEqual(scanC1(SCANNED_FILES), []);
  });

  // LIN-3601: 'mutation: the gate removed from a mount fails C1' (formerly here)
  // dropped `requireGrant('dispatch')` from a registration in routes/proxy-kickoff.js
  // and expected the positional scan to fail. The entrances' gating is now carried by
  // dispatch-entrance-proxy-grant-sweep.test.js: the same mutation, applied to
  // routes/proxy-kickoff.js, to routes/proxy-dispatch.js POST /dispatch, and a
  // planted ungated POST that calls createDispatchItem, each fail it in a scratch copy.

  test('LIN-3601: moving a sink between the entrance files keeps C1 clean; removing every sink from E fails it', () => {
    const moved = SCANNED_FILES.map(f => {
      if (f.file === 'routes/proxy-kickoff.js') return { ...f, src: f.src.replace('const item = await createDispatchItem({', 'const item = await moved({') };
      if (f.file === 'lib/dispatch-entrance.js') return { ...f, src: `${f.src}\nexport const moved2 = (store) => createDispatchItem({ store });\n` };
      return f;
    });
    assert.notDeepEqual(moved, SCANNED_FILES);
    assert.deepEqual(scanC1(moved), []);
    const none = SCANNED_FILES.map(f => (E_PROXY_FILES.has(f.file) ? { ...f, src: f.src.replaceAll('createDispatchItem(', 'somethingElse(') } : f));
    assert.ok(scanC1(none).some(m => m.startsWith('the proxy entrances hold no enqueue sink')));
  });

  test('mutation: a sink in a new ungated proxy route fails C1', () => {
    const planted = [...SCANNED_FILES, {
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
