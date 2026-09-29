/**
 * LIN-1892 S3-3 — the Settings "email identity" surface.
 *
 * Three levels: the store lookup (`AccountStore.listEmailIdentities`), the
 * renderer surface (email(s) shown; add link offered only when none AND email
 * sign-in is available), and the route→renderer threading (a source pin on
 * server.js's settings route, which no unit test boots — the same pattern the
 * account-home suite uses for server.js wiring). The real end-to-end
 * route+renderer path is covered by tests/e2e/settings.spec.js.
 *
 * Run with: node --test tests/unit/settings-account-email.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountStore } from '../../lib/account-store.js';
import { renderSettingsPage } from '../../lib/render-settings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('AccountStore.listEmailIdentities (S3-3)', () => {
  let dbDir;
  let client;
  let counter = 0;
  before(async () => { dbDir = mkdtempSync(join(tmpdir(), 'settings-email-')); client = new MangoClient(dbDir); await client.connect(); });
  after(async () => { if (client?.close) await client.close(); if (dbDir) rmSync(dbDir, { recursive: true, force: true }); });

  function store() {
    return new AccountStore({ collection: client.db(`se_${counter++}`).collection('accounts') });
  }

  test('returns the account\'s email scopes, canonicalising a merged session', async () => {
    const s = store();
    const P = await s.createAccount();
    await s.linkIdentity(P._id, 'email', 'p@x.io');
    const X = await s.createAccount();
    await s.linkIdentity(X._id, 'email', 'x@x.io');
    await s.mergeAccounts(P._id, X._id, {});

    assert.deepStrictEqual(await s.listEmailIdentities(P._id), ['p@x.io']);
    assert.deepStrictEqual(await s.listEmailIdentities(X._id), ['p@x.io'], 'a merged id resolves to canonical');
  });

  test('returns [] for no id, no account, and a non-email-only account; never throws', async () => {
    const s = store();
    assert.deepStrictEqual(await s.listEmailIdentities(null), []);
    assert.deepStrictEqual(await s.listEmailIdentities('missing'), []);
    const provider = await s.createAccount();
    await s.linkIdentity(provider._id, 'linear', 'v', {});
    assert.deepStrictEqual(await s.listEmailIdentities(provider._id), []);
  });
});

describe('renderSettingsPage — the email identity surface (S3-3)', () => {
  const ENV = ['EMAIL_TRANSPORT', 'NODE_ENV'];
  let saved;
  beforeEach(() => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
  const emailOn = () => { process.env.EMAIL_TRANSPORT = 'console'; process.env.NODE_ENV = 'development'; };
  const emailOff = () => { delete process.env.EMAIL_TRANSPORT; delete process.env.NODE_ENV; };

  test('shows the account\'s email(s) when present (and no add link)', () => {
    emailOff();
    const html = renderSettingsPage('Acme', { urlKey: 'acme', accountEmails: ['a@x.io', 'b@x.io'] });
    assert.match(html, /data-testid="settings-account-emails">a@x\.io, b@x\.io</);
    assert.doesNotMatch(html, /settings-account-add-email/);
  });

  test('offers the link-mode add when there is no email and email sign-in is available', () => {
    emailOn();
    const html = renderSettingsPage('Acme', { urlKey: 'acme', accountEmails: [] });
    assert.match(html, /data-testid="settings-account-add-email"[^>]*>Add email/);
    assert.match(html, /href="\/auth\/email\/register\?next=%2Fworkspace%2Facme%2Fsettings"/);
  });

  test('hides the add link when email sign-in is unavailable', () => {
    emailOff();
    const html = renderSettingsPage('Acme', { urlKey: 'acme', accountEmails: [] });
    assert.doesNotMatch(html, /settings-account-add-email/);
    assert.doesNotMatch(html, /settings-account-emails/);
  });
});

describe('server.js threads the account email into renderSettingsPage (S3-3)', () => {
  const source = readFileSync(join(ROOT, 'server.js'), 'utf8');

  function settingsRouteBody() {
    const start = source.indexOf("app.get('/workspace/:urlKey/settings'");
    assert.ok(start >= 0, 'the settings route exists');
    const end = source.indexOf('\napp.', start + 1);
    return source.slice(start, end);
  }

  test('the settings route looks up the account email and passes it to the renderer', () => {
    const body = settingsRouteBody();
    assert.match(body, /accountStore\.listEmailIdentities\(/, 'route reads the account email identity');
    const render = body.indexOf('renderSettingsPage(');
    assert.ok(render >= 0, 'route renders the settings page');
    assert.match(body.slice(render, render + 900), /accountEmails/, 'accountEmails is threaded into renderSettingsPage');
  });
});
