/**
 * LIN-3138 (LIN-3134 T2-i) — F3 inertness + C4 secrecy censuses.
 *
 * F3: no file outside the five mechanism modules passes a non-empty
 *     `declaredGrants` or sets `grantDeclaration`.
 * C4: `grantDeclaration` / `grantRefusal` appear only inside the five mechanism
 *     modules (plus lib/proxy-tokens.js for the private `grantRefusal` FUNCTION
 *     name); none in any route file or projection body; `_formatItem` /
 *     `_formatHistoryItem` bodies contain no spread and neither token.
 *
 * The scanners are pure functions over `{file, src}`, so the mutation witnesses
 * plant an omission in a synthetic source string and assert the scan fails.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attachProxyContext } from '../../lib/proxy-preamble.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '../..');

const MECHANISM_MODULES = new Set([
  'proxy-preamble', 'dispatch-factory', 'dispatch-store', 'wake-credential', 'dispatch-wake'
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const rel = (abs) => abs.slice(REPO.length + 1);
const base = (file) => file.split('/').pop().replace(/\.js$/, '');

function loadProductionSources() {
  return [
    ...walk(join(REPO, 'routes')),
    ...walk(join(REPO, 'lib')),
    join(REPO, 'server.js')
  ].map((abs) => ({ file: rel(abs), src: readFileSync(abs, 'utf8') }));
}

/** Files/lines outside the allow-list whose source contains any of `tokens`. */
function scanTokens(files, tokens, extraAllow = new Set()) {
  const offenders = [];
  for (const { file, src } of files) {
    if (MECHANISM_MODULES.has(base(file)) || extraAllow.has(base(file))) continue;
    src.split('\n').forEach((line, i) => {
      for (const token of tokens) {
        if (line.includes(token)) offenders.push({ file, line: i + 1, token, text: line.trim() });
      }
    });
  }
  return offenders;
}

const scanF3 = (files) => scanTokens(files, ['declaredGrants', 'grantDeclaration']);
const scanC4 = (files) => scanTokens(files, ['grantDeclaration', 'grantRefusal'], new Set(['proxy-tokens']));

function extractMethod(src, name) {
  const start = src.indexOf(`${name}(doc) {`);
  assert.ok(start > -1, `${name} found`);
  const end = src.indexOf('\n  }\n', start);
  assert.ok(end > -1, `${name} body end found`);
  return src.slice(start, end);
}

const PRODUCTION = loadProductionSources();

// ── F3 inertness ─────────────────────────────────────────────────────────────

describe('F3 — declared-mint writer set is empty outside the mechanism modules', () => {
  test('no production file/line passes declaredGrants or sets grantDeclaration', () => {
    assert.deepEqual(scanF3(PRODUCTION), []);
  });

  test('mutation 4 (F3 half): a planted declaredGrants literal in a route fails F3', () => {
    const mutated = [...PRODUCTION, { file: 'routes/proxy-dispatch.js', src: "const x = { declaredGrants: ['dispatch'] };" }];
    assert.notDeepEqual(scanF3(mutated), []);
  });

  test('mutation 4 (F3 half): a planted grantDeclaration writer in a route fails F3', () => {
    const mutated = [...PRODUCTION, { file: 'routes/dispatch.js', src: 'item.grantDeclaration = record;' }];
    assert.notDeepEqual(scanF3(mutated), []);
  });
});

// ── C4 secrecy token census ──────────────────────────────────────────────────

describe('C4 — declared-mint tokens are confined to the mechanism modules', () => {
  test('grantDeclaration / grantRefusal appear only in the five modules (+ proxy-tokens fn)', () => {
    assert.deepEqual(scanC4(PRODUCTION), []);
  });

  test('mutation 6 (C4 half): a planted grantDeclaration in a 201 body fails C4', () => {
    const mutated = [...PRODUCTION, { file: 'routes/proxy-dispatch.js', src: 'res.status(201).json({ grantDeclaration: item.grantDeclaration });' }];
    assert.notDeepEqual(scanC4(mutated), []);
  });

  test('mutation 6 (C4 half): a planted grantRefusal in a route fails C4', () => {
    const mutated = [...PRODUCTION, { file: 'routes/dispatch.js', src: "jsonError(res, 400, 'x', { grantRefusal: 'Y' });" }];
    assert.notDeepEqual(scanC4(mutated), []);
  });

  test('_formatItem / _formatHistoryItem bodies contain no spread and neither token', () => {
    const storeSrc = readFileSync(join(REPO, 'lib', 'dispatch-store.js'), 'utf8');
    for (const name of ['_formatItem', '_formatHistoryItem']) {
      const body = extractMethod(storeSrc, name);
      assert.ok(!/\.\.\./.test(body), `${name} must contain no spread`);
      assert.ok(!body.includes('grantDeclaration'), `${name} must not mention grantDeclaration`);
      assert.ok(!body.includes('grantRefusal'), `${name} must not mention grantRefusal`);
    }
  });
});

// ── Inertness: stock attach has no grantDeclaration key ──────────────────────

describe('Inertness — a stock attachProxyContext call carries no declared record', () => {
  test('empty declaredGrants -> no grantDeclaration key', async () => {
    const result = await attachProxyContext({
      proxyTokenStore: { createToken: async () => ({ token: 'plain' }) },
      urlKey: 'acme', baseUrl: 'https://h', prompt: 'do', harness: 'opencode', createdBy: 'u1'
    });
    assert.equal('grantDeclaration' in result, false);
  });
});
