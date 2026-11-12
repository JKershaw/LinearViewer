/**
 * Node version policy, enforced (LIN-3788, rewritten under LIN-4419).
 *
 * The policy has one value per job, and this file ties them together:
 *
 *   - `.nvmrc`: the major we install, test in CI and run in production. CI and
 *     env-check read it rather than copy it. It must be a supported major:
 *     even (LTS), or 27 and later (Node ends the odd/even model at 27 and every
 *     major becomes LTS; 26 is the last odd/even-era release).
 *   - `package.json` `engines.node`: what we accept from contributors, `>=` the
 *     `.nvmrc` floor. npm warns (EBADENGINE) only outside this range.
 *   - `package.json` `devEngines.runtime`: the production pin. Railpack reads
 *     this before `engines.node`, so widening `engines` alone could move
 *     production onto a newer Node. `onFail` must be `ignore`: `warn` replaces
 *     EBADENGINE with EBADDEVENGINES.
 *   - `package-lock.json` root `engines` mirrors `package.json`.
 *   - README §Setup names the floor; the newest-LTS workflow is the one
 *     `setup-node` step that does not read `.nvmrc`.
 *
 * `nodePinViolations` is the single rule set. The first test runs it on the real
 * repository; the broken-input tests run it on deliberately wrong copies, each of
 * which must fail, so a loosened rule cannot pass vacuously.
 *
 * env-check's ready line and floor check are tested here too (LIN-2386 wording).
 *
 * Run with: node --test tests/unit/node-version-pin.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runEnvCheck } from '../fixtures/env-check-harness.js';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const LTS_WORKFLOW = 'node-lts-scheduled.yml';
const SETUP_NODE_STEPS_MIN = 5;

export function nodePinViolations({ nvmrc, pkg, lock, readme, workflows }) {
  const out = [];
  const pin = nvmrc.trim();

  if (!/^\d+$/.test(pin)) {
    out.push(`.nvmrc must be a numeric major, got "${pin}"`);
  } else if (!(Number(pin) % 2 === 0 || Number(pin) >= 27)) {
    out.push(
      `.nvmrc ${pin} is an odd major. Odd majors are not LTS; from Node 27 every major is LTS (27.0.0 in April 2027), so a bump to 27+ must revise this rule, not fight it.`,
    );
  }

  const wantEngines = `>=${pin}`;
  if (pkg.engines?.node !== wantEngines) {
    out.push(`package.json engines.node must be "${wantEngines}", got ${JSON.stringify(pkg.engines?.node)}`);
  }

  const rt = pkg.devEngines?.runtime;
  if (!rt) {
    out.push('package.json devEngines.runtime is missing (the production Node pin)');
  } else {
    if (JSON.stringify(Object.keys(rt).sort()) !== JSON.stringify(['name', 'onFail', 'version'])) {
      out.push(`devEngines.runtime must have exactly name, version, onFail; got ${JSON.stringify(rt)}`);
    }
    if (rt.name !== 'node') out.push(`devEngines.runtime.name must be "node", got ${JSON.stringify(rt.name)}`);
    if (rt.version !== pin) out.push(`devEngines.runtime.version must be "${pin}" (= .nvmrc), got ${JSON.stringify(rt.version)}`);
    if (rt.onFail !== 'ignore') {
      out.push(`devEngines.runtime.onFail must be "ignore" (warn turns EBADENGINE into EBADDEVENGINES), got ${JSON.stringify(rt.onFail)}`);
    }
  }

  const lockEngines = lock.packages?.['']?.engines?.node;
  if (lockEngines !== pkg.engines?.node) {
    out.push(`package-lock.json root engines.node (${JSON.stringify(lockEngines)}) must equal package.json's (${JSON.stringify(pkg.engines?.node)})`);
  }

  const setup = readme.split(/^(?=## )/m).find((s) => s.startsWith('## Setup')) ?? '';
  if (!new RegExp(`Node\\.js ${pin} or newer`).test(setup)) {
    out.push(`README §Setup must name the floor: "Node.js ${pin} or newer"`);
  }

  let steps = 0;
  let readsNvmrc = 0;
  let ltsSteps = 0;
  for (const [file, text] of Object.entries(workflows)) {
    for (const m of text.matchAll(/^\s*node-version:[ \t]*(.*)$/gm)) {
      const v = m[1].trim();
      if (file === LTS_WORKFLOW && v === "'lts/*'") ltsSteps++;
      else out.push(`${file} sets node-version: ${v}; only ${LTS_WORKFLOW} may, as 'lts/*', and every other setup-node step must read .nvmrc`);
    }
    steps += (text.match(/actions\/setup-node@/g) || []).length;
    readsNvmrc += (text.match(/node-version-file: '\.nvmrc'/g) || []).length;
  }
  if (ltsSteps !== 1) out.push(`expected exactly one node-version: 'lts/*' in ${LTS_WORKFLOW}, found ${ltsSteps}`);
  if (steps !== readsNvmrc + ltsSteps) {
    out.push(`${steps} setup-node steps, but ${readsNvmrc} read .nvmrc and ${ltsSteps} use lts/*`);
  }
  if (steps < SETUP_NODE_STEPS_MIN) out.push(`expected at least ${SETUP_NODE_STEPS_MIN} setup-node steps, found ${steps}`);

  return out;
}

function realInputs() {
  const dir = new URL('.github/workflows/', root);
  const workflows = {};
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    workflows[f] = readFileSync(new URL(f, dir), 'utf8');
  }
  return {
    nvmrc: read('.nvmrc'),
    pkg: JSON.parse(read('package.json')),
    lock: JSON.parse(read('package-lock.json')),
    readme: read('README.md'),
    workflows,
  };
}

// Deep copy of the real repo's inputs, so each broken case changes exactly one thing.
const copy = (x) => structuredClone(x);

test('the real repository satisfies the Node version policy', () => {
  assert.deepEqual(nodePinViolations(realInputs()), []);
});

test('pin is not below any runtime dependency Node floor', () => {
  const pin = read('.nvmrc').trim();
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

test('the policy accepts a bumped pin of 27 with the same shape', () => {
  const i = copy(realInputs());
  i.nvmrc = '27\n';
  i.pkg.engines.node = '>=27';
  i.pkg.devEngines.runtime.version = '27';
  i.lock.packages[''].engines.node = '>=27';
  i.readme = i.readme.replace('Node.js 24 or newer', 'Node.js 27 or newer');
  assert.deepEqual(nodePinViolations(i), []);
});

const BROKEN = {
  'pin 25 (odd, not LTS)': (i) => {
    i.nvmrc = '25\n';
    i.pkg.engines.node = '>=25';
    i.pkg.devEngines.runtime.version = '25';
    i.lock.packages[''].engines.node = '>=25';
    i.readme = i.readme.replace('Node.js 24 or newer', 'Node.js 25 or newer');
  },
  'engines pinned exactly, not a range': (i) => {
    i.pkg.engines.node = '24';
    i.lock.packages[''].engines.node = '24';
  },
  'devEngines.runtime missing': (i) => {
    delete i.pkg.devEngines;
  },
  'devEngines.runtime version differs from .nvmrc': (i) => {
    i.pkg.devEngines.runtime.version = '22';
  },
  'devEngines.runtime onFail is warn': (i) => {
    i.pkg.devEngines.runtime.onFail = 'warn';
  },
  'devEngines.runtime has an extra key': (i) => {
    i.pkg.devEngines.runtime.extra = true;
  },
  'lock root has no engines': (i) => {
    delete i.lock.packages[''].engines;
  },
  'lock root engines differs from package.json': (i) => {
    i.lock.packages[''].engines.node = '>=22';
  },
  'README §Setup has no floor': (i) => {
    i.readme = i.readme.replace('Node.js 24 or newer', 'Node is required');
  },
  'workflow hard-codes node-version 22': (i) => {
    i.workflows['test.yml'] = i.workflows['test.yml'].replace("node-version-file: '.nvmrc'", "node-version: '22'");
  },
  "a second lts/* outside the newest-LTS workflow": (i) => {
    i.workflows['secret-scan-scheduled.yml'] = i.workflows['secret-scan-scheduled.yml'].replace(
      "node-version-file: '.nvmrc'",
      "node-version: 'lts/*'",
    );
  },
  'the newest-LTS workflow is missing': (i) => {
    delete i.workflows[LTS_WORKFLOW];
  },
};

for (const [name, break_] of Object.entries(BROKEN)) {
  test(`the policy rejects: ${name}`, () => {
    const base = realInputs();
    assert.deepEqual(nodePinViolations(base), [], 'base must pass before a single input is broken');
    const i = copy(base);
    break_(i);
    assert.ok(nodePinViolations(i).length > 0, `expected a violation for: ${name}`);
  });
}

test('env-check derives its Node requirement from .nvmrc, from any cwd', () => {
  const old = runEnvCheck({ nvmrc: '99', nodeVersion: '18.0.0' });
  assert.match(old.out, /need ≥99/);
  assert.match(old.out, /Install Node\.js 99\+/);

  // A node newer than any pin the script could have copied, still below this .nvmrc.
  const between = runEnvCheck({ nvmrc: '99', nodeVersion: '50.0.0' });
  assert.match(between.out, /need ≥99/);

  const ok = runEnvCheck({ nvmrc: '99', nodeVersion: '99.0.0' });
  assert.match(ok.out, /\(≥99 required; CI tests 99 — \.nvmrc\)/);
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
