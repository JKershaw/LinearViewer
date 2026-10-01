import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace } from '../fixtures/local-harness.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * LIN-3098 S3 — the served runner prompt on the running server: a real runner
 * credential fetches `GET /api/proxy/runner/prompt`, the kit is downloaded from
 * the URLs the prompt itself names (`GET /runner-kit/:file`), and the prompt's
 * own verify command accepts it (NB4). A plain readWrite token is refused.
 */
let urlKey;
let header;

async function cookieHeader(page) {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

test.beforeEach(async ({ page }) => {
  const seeded = await seedLocalWorkspace(page, null, { urlKey: 'runner-prompt', append: true, features: { proxy: true } });
  urlKey = seeded.urlKey;
  await page.goto(`/test/clear-proxy-tokens?urlKey=${urlKey}`);
  header = await cookieHeader(page);
});

test('a runner credential gets the prompt; the kit it names verifies against its pins', async ({ request }) => {
  const mint = await request.post(`/workspace/${urlKey}/api/proxy/tokens`, {
    headers: { Cookie: header, 'Content-Type': 'application/json' },
    data: { runner: true }
  });
  expect(mint.status()).toBe(201);
  const exchange = await request.post('/api/proxy/token', { headers: { Authorization: `Bearer ${(await mint.json()).token}` } });
  expect(exchange.status()).toBe(200);
  const working = (await exchange.json()).token;

  const res = await request.get('/api/proxy/runner/prompt', { headers: { Authorization: `Bearer ${working}` } });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^text\/plain/);
  const prompt = await res.text();
  expect(prompt).toContain('# Harbour runner (Claude Code)');
  expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);

  const dir = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'rk-prompt-'));
  try {
    for (const file of ['broker.mjs', 'runner.mjs']) {
      const url = prompt.match(new RegExp(`(https?://[^\\s]+/runner-kit/${file.replace('.', '\\.')})`))[1];
      const kit = await request.get(new URL(url).pathname);
      expect(kit.status()).toBe(200);
      writeFileSync(join(dir, file), await kit.body());
    }
    const verify = prompt.match(/```sh verify\n([\s\S]*?)```/)[1].trim();
    expect(execFileSync('sh', ['-c', verify], { cwd: dir, encoding: 'utf8' })).toContain('kit ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a plain readWrite token gets 403 TAKE_GRANT_REQUIRED', async ({ request }) => {
  const token = (await (await request.get(`/test/create-proxy-token?urlKey=${urlKey}&scope=readWrite`, { headers: { Cookie: header } })).json()).token;
  const res = await request.get('/api/proxy/runner/prompt', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe('TAKE_GRANT_REQUIRED');
});
