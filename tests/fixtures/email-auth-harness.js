/**
 * Loopback harness for the email magic-link routes (LIN-1892 S2).
 *
 * Mounts the REAL `createEmailAuthRoutes` behind REAL `express-session`,
 * configured by the same `createSessionOptions` factory `server.js` uses
 * (lib/session-options.js — verdict 0def5b66 S2-2/G1-a: no copied literal),
 * over a REAL MongoSessionStore and real MangoDB account/edge/preference/
 * magic-link stores in a tmpdir. The login-CSRF defence rests on cookie
 * behaviour a fake `req.session` can't reproduce (no cookie → empty session,
 * `saveUninitialized:false` → no Set-Cookie on a refusal), so these tests
 * speak HTTP to it with a cookie jar per "browser".
 *
 * Loopback shape follows tests/unit/lin-1890-jira-entry-layer.test.js
 * (`listen(0, '127.0.0.1')`, LIN-2023). Unlike that file, which injects a fake
 * `req.session`, the session layer here is real. Requests go through
 * `node:http`, not `fetch`, so a test can stub `globalThis.fetch` to throw.
 *
 * Two harness-only routes stand in for the provider sign-ins the email tests
 * need as setup: `POST /__test/sign-in` runs the real `establishAccount` in
 * the browser's session, and `GET /__test/session` returns the session as
 * JSON for assertions.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import session from 'express-session';
import { MangoClient } from '@jkershaw/mangodb';
import { createSessionOptions } from '../../lib/session-options.js';
import { MongoSessionStore } from '../../lib/session-store.js';
import { ensureIndexes } from '../../lib/db-indexes.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { UserPreferencesStore } from '../../lib/user-preferences.js';
import { establishAccount } from '../../lib/account-session.js';
import { MagicLinkStore, MAGIC_LINK_COLLECTION } from '../../lib/email-auth.js';
import { createCaptureTransport } from '../../lib/email-transport.js';
import { createEmailAuthRoutes } from '../../routes/email-auth.js';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

/**
 * @param {Object} [options]
 * @param {Object|null} [options.transport] - defaults to a capture transport; `null` = email off
 * @param {Function} [options.sendLimiter] - defaults to a pass-through (the rate-limit test injects a real one)
 * @param {{ms: number}} [options.storeClock] - drives MagicLinkStore expiry
 * @param {{ms: number}} [options.nonceClock] - drives the routes' nonce ages
 * @param {string|null} [options.linkOrigin] - the configured origin for emailed links
 */
export async function startEmailAuthHarness({ transport = createCaptureTransport(), sendLimiter = (req, res, next) => next(), storeClock, nonceClock, linkOrigin = null } = {}) {
  const dbDir = mkdtempSync(join(tmpdir(), 'email-auth-harness-'));
  const client = new MangoClient(dbDir);
  await client.connect();
  const db = client.db('email_auth');
  await ensureIndexes(db);

  const stores = {
    accountStore: new AccountStore({ collection: db.collection('accounts') }),
    accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    userPreferencesStore: new UserPreferencesStore({ collection: db.collection('user-preferences') }),
    magicLinkStore: new MagicLinkStore({
      collection: db.collection(MAGIC_LINK_COLLECTION),
      ...(storeClock ? { now: () => new Date(storeClock.ms) } : {}),
    }),
  };

  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session(createSessionOptions({
    store: new MongoSessionStore({ collection: db.collection('sessions') }),
    secret: 'email-auth-harness-secret',
    env: { NODE_ENV: 'test' },
  })));

  app.post('/__test/sign-in', async (req, res) => {
    const { provider, scope, workspaceId, urlKey, staleAuth } = req.body;
    const established = await establishAccount(req.session, stores.accountStore, stores.accountWorkspaceStore, provider, scope, {}, workspaceId || null);
    if (workspaceId) {
      req.session.workspaces = [...(req.session.workspaces || []), { id: workspaceId, urlKey: urlKey || workspaceId, provider }];
    }
    if (staleAuth) req.session.identityAuthenticatedAt = 0;
    res.json(established);
  });
  app.get('/__test/session', (req, res) => {
    const { cookie, ...rest } = req.session;
    res.json(rest);
  });

  app.use(createEmailAuthRoutes({
    ...stores,
    transport,
    sendLimiter,
    linkOrigin,
    ...(nonceClock ? { now: () => nonceClock.ms } : {}),
  }));

  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    stores,
    transport,
    browser: () => new Browser(port),
    async close() {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
      await client.close();
      rmSync(dbDir, { recursive: true, force: true });
    },
  };
}

/** A cookie jar speaking HTTP to the harness. Each instance is one browser. */
export class Browser {
  constructor(port) {
    this.port = port;
    this.cookies = new Map();
  }

  get sid() {
    return this.cookies.get('connect.sid') || null;
  }

  request(method, path, { form, headers = {}, cookies = true } = {}) {
    const body = form ? new URLSearchParams(form).toString() : null;
    const allHeaders = { ...headers };
    if (body !== null) {
      allHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      allHeaders['Content-Length'] = Buffer.byteLength(body);
    }
    if (cookies && this.cookies.size) {
      allHeaders.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: this.port, method, path, headers: allHeaders }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'] || [];
          if (cookies) {
            for (const line of setCookie) {
              const [pair] = line.split(';');
              const eq = pair.indexOf('=');
              this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
            }
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            location: res.headers.location || null,
            setCookie,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.on('error', reject);
      if (body !== null) req.write(body);
      req.end();
    });
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, form, options = {}) { return this.request('POST', path, { ...options, form }); }

  async session() {
    const res = await this.get('/__test/session');
    return JSON.parse(res.text);
  }

  /** GET the email form and return its send nonce (null when there is no form). */
  async openForm() {
    const res = await this.get('/auth/email');
    return { res, nonce: hiddenField(res.text, 'nonce') };
  }

  /** Open the form, submit `email`, and return the send response. */
  async requestLink(email) {
    const { nonce } = await this.openForm();
    return this.post('/auth/email/send', { email, nonce }, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  }

  /** GET the confirm page for token `t`; returns the response and its nonce. */
  async openConfirm(t) {
    const res = await this.get(`/auth/email/confirm?t=${encodeURIComponent(t)}`);
    return { res, nonce: hiddenField(res.text, 'nonce') };
  }

  /** POST the confirm form as the page's own same-origin submit would. */
  confirm(t, nonce, { headers = { 'Sec-Fetch-Site': 'same-origin' } } = {}) {
    const form = { t };
    if (nonce !== undefined && nonce !== null) form.nonce = nonce;
    return this.post('/auth/email/confirm', form, { headers });
  }
}

/** The value of `<input type="hidden" name="…" value="…">`, or null. */
export function hiddenField(html, name) {
  const match = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`));
  return match ? match[1] : null;
}

/** The token `t` from the newest captured message to `email`. */
export function tokenFromOutbox(transport, email) {
  const message = transport.lastMessageTo(email);
  if (!message) return null;
  const match = message.text.match(/\/auth\/email\/confirm\?t=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}
