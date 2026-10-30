/**
 * LIN-619 — production refuses to boot without a real SESSION_SECRET.
 *
 * Before this, server.js signed session cookies with the public default
 * 'dev-secret-change-in-production' in every environment and only warned when
 * the variable was unset. Now `resolveSessionSecret` (lib/session-options.js)
 * throws under NODE_ENV=production for an unset, blank or published secret,
 * and server.js exits 1 before the DB connects or the server listens.
 *
 * Run with: node --test tests/unit/lin-619-session-secret.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SESSION_SECRET, resolveSessionSecret } from '../../lib/session-options.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PRODUCTION_ERROR = /SESSION_SECRET/;

// The example values a `cp .env.example .env` or a copied README snippet would
// put in place. Every one must be refused in production.
const PUBLISHED_EXAMPLES = [
  'change-this-to-a-random-string',
  'any-random-string-for-sessions',
  'generate-a-secure-random-string',
  'test-secret-for-ci',
  'test-secret-for-playwright',
  'your-secret-here'
];

function publishedSecretLines(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
    .split('\n')
    .map(line => line.match(/^SESSION_SECRET=(\S+)\s*$/))
    .filter(Boolean)
    .map(match => match[1]);
}

describe('resolveSessionSecret under NODE_ENV=production (LIN-619)', () => {
  test('refuses an unset secret, naming SESSION_SECRET', () => {
    assert.throws(() => resolveSessionSecret({ NODE_ENV: 'production' }), PRODUCTION_ERROR);
  });

  test('refuses an empty or whitespace-only secret', () => {
    for (const SESSION_SECRET of ['', '   ', '\t\n']) {
      assert.throws(() => resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET }), PRODUCTION_ERROR, JSON.stringify(SESSION_SECRET));
    }
  });

  test('refuses the in-code default and every published example, also when padded with whitespace', () => {
    for (const value of [DEFAULT_SESSION_SECRET, ...PUBLISHED_EXAMPLES]) {
      for (const SESSION_SECRET of [value, `  ${value} `]) {
        assert.throws(() => resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET }), PRODUCTION_ERROR, value);
      }
    }
  });

  test('returns a real secret as given, with usedDefault false', () => {
    const SESSION_SECRET = 'a-real-random-secret-value';
    assert.deepStrictEqual(
      resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET }),
      { secret: SESSION_SECRET, usedDefault: false }
    );
  });

  test('the drift check: every SESSION_SECRET= line published in .env.example and README.md is refused', () => {
    const published = [...publishedSecretLines('.env.example'), ...publishedSecretLines('README.md')];
    assert.ok(published.length >= 3, `expected the published examples to be found, got ${JSON.stringify(published)}`);
    for (const SESSION_SECRET of published) {
      assert.throws(() => resolveSessionSecret({ NODE_ENV: 'production', SESSION_SECRET }), PRODUCTION_ERROR, SESSION_SECRET);
    }
  });
});

describe('resolveSessionSecret outside production keeps today\'s fallback (LIN-619)', () => {
  for (const NODE_ENV of ['development', 'test', undefined]) {
    test(`NODE_ENV=${NODE_ENV} with no secret falls back to the public default`, () => {
      assert.deepStrictEqual(
        resolveSessionSecret({ NODE_ENV }),
        { secret: DEFAULT_SESSION_SECRET, usedDefault: true }
      );
    });
  }

  test('an empty secret outside production still falls back to the default', () => {
    assert.deepStrictEqual(
      resolveSessionSecret({ NODE_ENV: 'test', SESSION_SECRET: '' }),
      { secret: DEFAULT_SESSION_SECRET, usedDefault: true }
    );
  });

  test('a set secret is returned as given, even a placeholder', () => {
    assert.deepStrictEqual(
      resolveSessionSecret({ NODE_ENV: 'development', SESSION_SECRET: 'test-secret-for-playwright' }),
      { secret: 'test-secret-for-playwright', usedDefault: false }
    );
  });

  test('production is keyed on strict NODE_ENV === "production", like the other production gates', () => {
    assert.deepStrictEqual(
      resolveSessionSecret({ NODE_ENV: 'Production' }),
      { secret: DEFAULT_SESSION_SECRET, usedDefault: true }
    );
  });
});

describe('server.js resolves the secret before anything connects or listens (LIN-619)', () => {
  test('the guard runs before the DB connect and app.listen', () => {
    const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
    const guardIdx = src.indexOf('resolveSessionSecret(process.env)');
    const connectIdx = src.indexOf('await dbClient.connect()');
    const listenIdx = src.indexOf('app.listen(PORT');
    assert.ok(guardIdx >= 0, 'server.js calls resolveSessionSecret');
    assert.ok(guardIdx < connectIdx, 'guard must run before the DB connects');
    assert.ok(connectIdx < listenIdx, 'DB connect precedes listen (sanity)');
    assert.doesNotMatch(src, /dev-secret-change-in-production/, 'the default lives in lib/session-options.js only');
  });
});

describe('booting server.js (LIN-619)', () => {
  let dataDir;
  // dotenv/config in server.js reads .env from the cwd. Point it at a file that
  // does not exist, so a developer's real .env cannot supply a secret.
  let baseEnv;

  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'lin-619-'));
    baseEnv = {
      PATH: process.env.PATH,
      HARBOUR_DATA_DIR: dataDir,
      DOTENV_CONFIG_PATH: join(dataDir, 'no-such.env')
    };
  });

  after(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('NODE_ENV=production with no SESSION_SECRET exits 1 with a message naming SESSION_SECRET', () => {
    const res = spawnSync(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...baseEnv, NODE_ENV: 'production', PORT: '0' },
      encoding: 'utf8',
      timeout: 60000
    });
    assert.strictEqual(res.status, 1, `expected exit 1, got ${res.status} (signal ${res.signal})\nstderr: ${res.stderr}`);
    assert.match(res.stderr, PRODUCTION_ERROR);
    assert.doesNotMatch(res.stderr, /\n\s+at /, 'a one-line message, not a stack trace');
  });

  test('NODE_ENV=test with no SESSION_SECRET still boots, warns, and serves /health', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...baseEnv, NODE_ENV: 'test', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    try {
      await waitFor(() => stdout.includes('Harbour running at'), 60000, () => `no listen line\nstdout: ${stdout}\nstderr: ${stderr}`);
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.strictEqual(res.status, 200);
      assert.match(stderr, /SESSION_SECRET not set, using default/);
    } finally {
      // A child that already crashed has emitted 'exit'; waiting again would hang.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, 'exit');
      }
    }
  });
});

// Asks the OS for a free loopback port, then releases it for the server to bind.
async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function waitFor(predicate, timeoutMs, describeFailure) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(describeFailure());
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
