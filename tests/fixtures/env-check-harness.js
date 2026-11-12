/**
 * Shared runner for scripts/env-check.sh tests (LIN-3788, LIN-2386).
 *
 * Runs a copy of env-check.sh in a temporary tree, so the test controls every
 * input the script reads from the host:
 *
 *   - `.nvmrc`: written from `nvmrc` (null = no file), so the Node floor is the
 *     test's choice. A stub `node` printing `nodeVersion` sits first on PATH.
 *   - `HOME`: a fresh temporary directory. `home` lists paths to create under it.
 *   - cwd: a fresh, empty directory inside the temporary tree, never the repo.
 *     `cwd` lists paths to create under it, for the cwd-relative candidate.
 *   - `PLAYWRIGHT_BROWSERS_PATH`: removed from the inherited environment. Set it
 *     only when `playwrightBrowsers` is given, which creates that directory with
 *     the listed entries.
 *   - `env`: extra overrides, applied last.
 *
 * Without these, a positive case passes on any machine that already has
 * browsers, and a negative case proves nothing. Defaults are hermetic; callers
 * opt in to anything else.
 *
 * Returns `{ out, err, status }`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);

export function runEnvCheck({
  nvmrc = '22',
  nodeVersion = '22.0.0',
  home = [],
  cwd = [],
  playwrightBrowsers,
  env = {},
} = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'env-check-'));
  try {
    const bin = join(tmp, 'bin');
    const fakeHome = join(tmp, 'home');
    const fakeCwd = join(tmp, 'cwd');
    mkdirSync(join(tmp, 'scripts'));
    mkdirSync(bin);
    mkdirSync(fakeHome);
    mkdirSync(fakeCwd);

    copyFileSync(new URL('scripts/env-check.sh', root), join(tmp, 'scripts', 'env-check.sh'));
    if (nvmrc !== null) writeFileSync(join(tmp, '.nvmrc'), `${nvmrc}\n`);

    const stub = join(bin, 'node');
    writeFileSync(stub, `#!/bin/sh\necho v${nodeVersion}\n`);
    chmodSync(stub, 0o755);

    for (const p of home) mkdirSync(join(fakeHome, p), { recursive: true });
    for (const p of cwd) mkdirSync(join(fakeCwd, p), { recursive: true });

    const childEnv = { ...process.env, HOME: fakeHome, PATH: `${bin}:${process.env.PATH}` };
    delete childEnv.PLAYWRIGHT_BROWSERS_PATH;
    if (playwrightBrowsers !== undefined) {
      const browsers = join(tmp, 'pw-browsers');
      mkdirSync(browsers);
      for (const p of playwrightBrowsers) mkdirSync(join(browsers, p), { recursive: true });
      childEnv.PLAYWRIGHT_BROWSERS_PATH = browsers;
    }
    Object.assign(childEnv, env);

    const r = spawnSync('bash', [join(tmp, 'scripts', 'env-check.sh')], {
      cwd: fakeCwd,
      encoding: 'utf8',
      env: childEnv,
    });
    return { out: r.stdout, err: r.stderr, status: r.status };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
