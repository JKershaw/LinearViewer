/**
 * LIN-3114 — lib/loose-json.js behaviour + a census that no other lib/ module
 * re-grows a private fence-strip → brace-slice → JSON.parse copy.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJsonObject, stripCodeFence } from '../../lib/loose-json.js';

describe('extractJsonObject', () => {
  test('parses bare JSON', () => {
    assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
  });
  test('strips a ```json fence', () => {
    assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  });
  test('strips a bare ``` fence and surrounding prose', () => {
    assert.deepEqual(extractJsonObject('Here:\n```\n{"a":1}\n```\nthanks'), { a: 1 });
  });
  test('uses the FIRST fenced block', () => {
    assert.deepEqual(extractJsonObject('```\n{"a":1}\n```\n```\n{"b":2}\n```'), { a: 1 });
  });
  test('slices first { to LAST } out of prose', () => {
    assert.deepEqual(extractJsonObject('Sure! {"a":{"b":2}} hope that helps'), { a: { b: 2 } });
  });
  test('returns null on garbage, truncation, empty and non-strings', () => {
    for (const bad of ['no json', '{"a":', '', '   ', '}{', null, undefined, 42, {}]) {
      assert.equal(extractJsonObject(bad), null, String(bad));
    }
  });
  test('arrays and scalars are not objects', () => {
    assert.equal(extractJsonObject('[1,2]'), null);
    assert.equal(extractJsonObject('"x"'), null);
    assert.equal(extractJsonObject('null'), null);
  });
});

describe('stripCodeFence', () => {
  test('returns first fenced body, trimmed', () => {
    assert.equal(stripCodeFence('```text\n hello \n```'), 'hello');
  });
  test('returns trimmed input when unfenced', () => {
    assert.equal(stripCodeFence('  plain  '), 'plain');
  });
});

describe('census: no private loose-JSON copies in lib/', () => {
  const libDir = fileURLToPath(new URL('../../lib', import.meta.url));
  const walk = dir => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
  const owner = join(libDir, 'loose-json.js');

  test('no other lib module defines extractJsonObject or slices first-{/last-}', () => {
    const offenders = [];
    for (const f of walk(libDir)) {
      if (f === owner) continue;
      const src = readFileSync(f, 'utf8');
      if (/function\s+extractJsonObject\s*\(/.test(src)) offenders.push(`${f}: local extractJsonObject`);
      if (/lastIndexOf\(\s*['"]\}['"]\s*\)/.test(src)) offenders.push(`${f}: lastIndexOf('}') brace-slice`);
    }
    assert.deepEqual(offenders, []);
  });
});
