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
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const pkg = JSON.parse(read('package.json'));
const pin = read('.nvmrc').trim();

test('.nvmrc is a major-only pin and equals engines.node', () => {
  assert.match(pin, /^\d+$/);
  assert.equal(pkg.engines?.node, pin);
});

test('pin is not below any runtime dependency Node floor', () => {
  const lock = JSON.parse(read('package-lock.json'));
  let checked = 0;
  for (const [name, v] of Object.entries(lock.packages || {})) {
    if (v.dev || !v.engines?.node) continue;
    const m = /^>=\s*(\d+)/.exec(v.engines.node);
    if (!m) continue;
    checked++;
    assert.ok(Number(pin) >= Number(m[1]), `${name} needs >=${m[1]}`);
  }
  assert.ok(checked > 0, 'no runtime Node floors found in package-lock.json');
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

// Run a copy of env-check.sh in a temp tree whose .nvmrc we control, with a stub `node`
// first on PATH, so the script's own reading of .nvmrc is what decides the output.
function runEnvCheck({ nvmrc, nodeVersion }) {
  const tmp = mkdtempSync(join(tmpdir(), 'env-check-'));
  try {
    mkdirSync(join(tmp, 'scripts'));
    mkdirSync(join(tmp, 'bin'));
    copyFileSync(new URL('scripts/env-check.sh', root), join(tmp, 'scripts', 'env-check.sh'));
    if (nvmrc !== null) writeFileSync(join(tmp, '.nvmrc'), `${nvmrc}\n`);
    const stub = join(tmp, 'bin', 'node');
    writeFileSync(stub, `#!/bin/sh\necho v${nodeVersion}\n`);
    chmodSync(stub, 0o755);
    const r = spawnSync('bash', [join(tmp, 'scripts', 'env-check.sh')], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(tmp, 'bin')}:${process.env.PATH}` },
    });
    return { out: r.stdout, err: r.stderr };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('env-check derives its Node requirement from .nvmrc, from any cwd', () => {
  const old = runEnvCheck({ nvmrc: '99', nodeVersion: '18.0.0' });
  assert.match(old.out, /need ≥99/);
  assert.match(old.out, /Install Node\.js 99\+/);

  // A node newer than any pin the script could have copied, still below this .nvmrc.
  const between = runEnvCheck({ nvmrc: '99', nodeVersion: '50.0.0' });
  assert.match(between.out, /need ≥99/);

  const ok = runEnvCheck({ nvmrc: '99', nodeVersion: '99.0.0' });
  assert.match(ok.out, /\(≥99 required\)/);
  assert.doesNotMatch(ok.out, /Upgrade Node\.js/);
});

test('env-check without a usable .nvmrc skips the floor check without shell errors', () => {
  for (const nvmrc of [null, 'lts/*']) {
    const r = runEnvCheck({ nvmrc, nodeVersion: '18.0.0' });
    assert.doesNotMatch(r.err, /integer expression/);
    assert.doesNotMatch(r.out, /Upgrade Node\.js/);
    assert.match(r.out, /floor not checked/);
  }
});
