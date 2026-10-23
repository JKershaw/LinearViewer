/**
 * LIN-3788 — one Node pin (.nvmrc), read everywhere else.
 *
 * Node 20 is EOL and a runtime dependency already needs >=22, so the pin must
 * be a supported major, identical in `.nvmrc` and `engines.node`, and CI and
 * env-check must read it rather than copy it.
 *
 * Run with: node --test tests/unit/node-version-pin.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const pkg = JSON.parse(read('package.json'));
const pin = read('.nvmrc').trim();

test('.nvmrc is a major-only pin and equals engines.node', () => {
  assert.match(pin, /^\d+$/);
  assert.equal(pkg.engines?.node, pin);
});

test('pin is not below any runtime dependency Node floor', () => {
  for (const name of Object.keys(pkg.dependencies || {})) {
    const dep = JSON.parse(read(`node_modules/${name}/package.json`));
    const m = /^>=\s*(\d+)/.exec(dep.engines?.node || '');
    if (m) assert.ok(Number(pin) >= Number(m[1]), `${name} needs >=${m[1]}`);
  }
});

test('every setup-node step reads .nvmrc, none hard-codes a version', () => {
  const dir = new URL('.github/workflows/', root);
  let steps = 0;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /^\s*node-version:/m, `${f} hard-codes node-version`);
    steps += (text.match(/actions\/setup-node@/g) || []).length;
    assert.equal(
      (text.match(/node-version-file: '\.nvmrc'/g) || []).length,
      (text.match(/actions\/setup-node@/g) || []).length,
      f,
    );
  }
  assert.ok(steps >= 4);
});

test('env-check derives its Node requirement from .nvmrc, from any cwd', () => {
  assert.doesNotMatch(read('scripts/env-check.sh'), /\b20\b/);
  const out = execFileSync('bash', [new URL('scripts/env-check.sh', root).pathname], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });
  assert.match(out, new RegExp(`(≥${pin} required|need ≥${pin})`));
});
