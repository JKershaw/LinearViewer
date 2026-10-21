/**
 * LIN-3748 M2: boot the review server on :3199 with the landing-faithful env.
 *
 * The visual-maker env (playwright.visual.config.js) renders 1 landing CTA; live
 * harbour.cat renders 4 (Linear, GitHub, Jira, email). This reproduces
 * playwright.config.js UNCONFIGURED_ENV plus the held GitHub App vars (:96, with a
 * freshly generated PEM), with:
 *   - LINEAR_ACCESS_TOKEN= cleared explicitly (a local .env PAT would 302 `/`);
 *   - HARBOUR_DATA_DIR pinned to a scratch dir (LIN-3583; never touches ./data);
 *   - plan-review N3: YAP_BASE_URL, JIRA_REDIRECT_URI, JIRA_OAUTH_TEST_BASE rewritten
 *     from :3001 to :3199 (UNCONFIGURED_ENV hardcodes :3001, which is not this server).
 *
 * Usage (repo root):  node docs/reviews/_evidence-2026-10-21/capture/boot-3199.mjs [dataDir]
 * Docs-only tooling; the UNCONFIGURED_ENV string is parsed out of playwright.config.js
 * at run time so it cannot drift from the config.
 */
import crypto from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const PORT = process.env.PORT || '3199';
const cfg = readFileSync('playwright.config.js', 'utf8');
const m = cfg.match(/const UNCONFIGURED_ENV = '([^']+)'/);
if (!m) throw new Error('UNCONFIGURED_ENV not found in playwright.config.js');

const env = { ...process.env };
for (const pair of m[1].split(/\s+/)) {
  const i = pair.indexOf('=');
  env[pair.slice(0, i)] = pair.slice(i + 1);
}
for (const k of ['YAP_BASE_URL', 'JIRA_REDIRECT_URI', 'JIRA_OAUTH_TEST_BASE']) {
  env[k] = env[k].replace('localhost:3001', `localhost:${PORT}`);
}
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
Object.assign(env, {
  PORT,
  LINEAR_ACCESS_TOKEN: '',
  HARBOUR_DATA_DIR: process.argv[2] || path.join(os.tmpdir(), 'lin-3748-data'),
  GITHUB_CLIENT_ID: 'test-held-client',
  GITHUB_CLIENT_SECRET: 'test-held-secret',
  GITHUB_APP_ID: '424242',
  GITHUB_APP_SLUG: 'held-test-app',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }),
});
mkdirSync(env.HARBOUR_DATA_DIR, { recursive: true });
console.log(`booting :${PORT} data=${env.HARBOUR_DATA_DIR} YAP=${env.YAP_BASE_URL} JIRA_REDIRECT=${env.JIRA_REDIRECT_URI}`);
spawn('node', ['server.js'], { env, stdio: 'inherit' });
