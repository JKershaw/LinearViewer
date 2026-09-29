/**
 * LIN-3098 S3 — `GET /api/proxy/runner/prompt` (routes/proxy-runner-prompt.js)
 * and the public kit route `GET /runner-kit/:file` (routes/runner-kit.js).
 *
 * The prompt route runs its OWN chain — proxyLimiter → authenticateProxyToken
 * → requireGrant('take') — and is mounted in routes/proxy.js BEFORE
 * createProxyRunnerRoutes, whose path-scoped `take` gate would otherwise run a
 * second auth pass over the same request (R8). Pinned two ways: a counting
 * fake on the factory (limiter and auth each run exactly once), and the real
 * composer (the token is validated exactly once end to end).
 *
 * The kit route serves only the allow-listed kit files, byte for byte, and
 * those bytes hash to what the prompt pins (NB4).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProxyRunnerPromptRoutes } from '../../routes/proxy-runner-prompt.js';
import { createRunnerKitRoutes } from '../../routes/runner-kit.js';
import { buildRunnerKickoff, RUNNER_KIT_FILES } from '../../lib/prompts/runner-kickoff.js';
import { requireGrant } from '../../lib/require-grant.js';
import { buildInstructions } from '../../lib/proxy-instructions.js';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The factory alone, with counting fakes for the limiter and auth. */
function factoryApp({ grants = ['take', 'dispatch'], authenticate = true } = {}) {
  const counts = { limiter: 0, auth: 0, logged: [] };
  const app = express();
  app.use(createProxyRunnerPromptRoutes({
    proxyLimiter: (req, res, next) => { counts.limiter += 1; next(); },
    authenticateProxyToken: (req, res, next) => {
      counts.auth += 1;
      if (!authenticate) return res.status(401).json({ error: 'Missing or invalid Authorization header' });
      req.proxyUrlKey = ACME;
      req.proxyTokenGrants = grants;
      next();
    },
    requireGrant,
    logEvent: (req, endpoint, status) => counts.logged.push([endpoint, status])
  }));
  return { app, counts };
}

describe('GET /api/proxy/runner/prompt (factory)', () => {
  test('a take-grant token gets 200 text/plain equal to the builder\'s output for this base', async () => {
    const { app, counts } = factoryApp();
    const r = await call(app, 'GET', '/api/proxy/runner/prompt');
    assert.equal(r.status, 200);
    assert.match(r.contentType, /^text\/plain/);
    const base = r.body.match(/(http:\/\/127\.0\.0\.1:\d+)\/runner-kit\/runner\.mjs/)[1];
    assert.equal(r.body, buildRunnerKickoff({ baseUrl: base }));
    assert.equal(counts.limiter, 1, 'the limiter runs once');
    assert.equal(counts.auth, 1, 'auth runs once');
    assert.deepEqual(counts.logged, [['/api/proxy/runner/prompt', 200]]);
  });

  test('a readWrite token without the take grant gets 403 TAKE_GRANT_REQUIRED', async () => {
    const { app } = factoryApp({ grants: [] });
    const r = await call(app, 'GET', '/api/proxy/runner/prompt');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'TAKE_GRANT_REQUIRED');
  });

  test('no bearer gets 401 and the prompt is never built', async () => {
    const { app } = factoryApp({ authenticate: false });
    const r = await call(app, 'GET', '/api/proxy/runner/prompt', { headers: { Authorization: '' } });
    assert.equal(r.status, 401);
    assert.equal(typeof r.body, 'object');
  });
});

describe('GET /api/proxy/runner/prompt (the real composer, routes/proxy.js)', () => {
  function composerApp(grants) {
    let validations = 0;
    const app = buildApp({
      proxyTokenStore: {
        ...BASE_DEPS().proxyTokenStore,
        validateToken: async () => {
          validations += 1;
          return { tokenId: 't1', urlKey: ACME, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants };
        }
      }
    });
    return { app, validations: () => validations };
  }

  test('resolves, and the token is validated exactly once (mounted before the runner sub-router\'s gate)', async () => {
    const { app, validations } = composerApp(['take', 'dispatch']);
    const r = await call(app, 'GET', '/api/proxy/runner/prompt');
    assert.equal(r.status, 200);
    assert.match(r.body, /^# /);
    assert.equal(validations(), 1);
  });

  test('without take: 403 TAKE_GRANT_REQUIRED from the route\'s own gate', async () => {
    const { app, validations } = composerApp([]);
    const r = await call(app, 'GET', '/api/proxy/runner/prompt');
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'TAKE_GRANT_REQUIRED');
    assert.equal(validations(), 1);
  });

  test('the neighbouring runner routes are unaffected', async () => {
    const { app } = composerApp(['take', 'dispatch']);
    const r = await call(app, 'GET', '/api/proxy/runner/poll');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { items: [], otherConsumerLastSeenAt: null });
  });

  test('routes/proxy.js mounts the prompt route before createProxyRunnerRoutes', () => {
    const src = readFileSync(join(ROOT, 'routes', 'proxy.js'), 'utf8');
    const prompt = src.indexOf('router.use(createProxyRunnerPromptRoutes(');
    const runner = src.indexOf('router.use(createProxyRunnerRoutes(');
    assert.ok(prompt !== -1 && runner !== -1 && prompt < runner);
  });
});

describe('/api/proxy/instructions points a runner at the prompt', () => {
  const BASE_URL = 'https://harbour.example';
  test('a take-grant token sees the one pointer line, inside the Runner Endpoints section', () => {
    const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite', grants: ['take', 'dispatch'] });
    const section = text.slice(text.indexOf('## Runner Endpoints'));
    assert.equal(section.split(`GET ${BASE_URL}/api/proxy/runner/prompt`).length - 1, 1);
  });
  test('any other token does not', () => {
    for (const grants of [[], ['dispatch'], undefined]) {
      const text = buildInstructions({ baseUrl: BASE_URL, scope: 'readWrite', grants });
      assert.ok(!text.includes('/api/proxy/runner/prompt'), `grants=${JSON.stringify(grants)}`);
    }
  });
});

describe('GET /runner-kit/:file (public, allow-listed)', () => {
  const kitApp = () => {
    const app = express();
    app.use(createRunnerKitRoutes());
    return app;
  };

  for (const file of ['broker.mjs', 'runner.mjs']) {
    test(`${file}: 200, JavaScript, byte-for-byte, and it hashes to the prompt's pin`, async () => {
      const r = await call(kitApp(), 'GET', `/runner-kit/${file}`, { headers: { Authorization: '' } });
      assert.equal(r.status, 200);
      assert.match(r.contentType, /javascript/);
      const onDisk = readFileSync(join(ROOT, 'lib', 'runner-kit', file), 'utf8');
      assert.equal(r.body, onDisk);
      const pin = createHash('sha256').update(onDisk).digest('hex');
      assert.ok(buildRunnerKickoff({ baseUrl: 'https://x.example' }).includes(pin));
    });
  }

  test('N4: each file is read once and served from memory (a later disk change is not served mid-process)', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'rk-kitcache-'));
    try {
      writeFileSync(join(dir, 'broker.mjs'), '// first broker\n');
      writeFileSync(join(dir, 'runner.mjs'), '// first runner\n');
      const app = express();
      app.use(createRunnerKitRoutes({ kitDir: dir }));
      const first = await call(app, 'GET', '/runner-kit/runner.mjs', { headers: { Authorization: '' } });
      assert.equal(first.body, '// first runner\n');
      writeFileSync(join(dir, 'runner.mjs'), '// changed on disk\n');
      const second = await call(app, 'GET', '/runner-kit/runner.mjs', { headers: { Authorization: '' } });
      assert.equal(second.body, '// first runner\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the served set is exactly the kit', () => {
    assert.deepEqual([...RUNNER_KIT_FILES].sort(), ['broker.mjs', 'runner.mjs']);
  });

  for (const path of ['/runner-kit/nope.mjs', '/runner-kit/..%2Fbroker.mjs', '/runner-kit/..%2F..%2Fserver.js', '/runner-kit/Broker.mjs']) {
    test(`${path} → 404`, async () => {
      const r = await call(kitApp(), 'GET', path, { headers: { Authorization: '' } });
      assert.equal(r.status, 404);
    });
  }

  test('server.js mounts the kit route', () => {
    const src = readFileSync(join(ROOT, 'server.js'), 'utf8');
    assert.match(src, /app\.use\(createRunnerKitRoutes\(\)\)/);
  });
});
