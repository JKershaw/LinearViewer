/**
 * Unit tests for lib/email-auth.js (LIN-1892 S2 item 3): `normalizeEmail`,
 * the `MagicLinkStore`, and the send/confirm nonce helpers (G1).
 *
 * The store runs against a REAL MangoDB tmpdir instance (precedent:
 * tests/unit/account-session.test.js). MangoDB serialises writers, so the
 * consume race here is only a sequential sanity check; the real race proof
 * is in tests/unit/mongo-smoke.test.js (N4).
 *
 * Run with: node --test tests/unit/email-auth.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import {
  normalizeEmail,
  hashToken,
  MagicLinkStore,
  MAGIC_LINK_COLLECTION,
  MAGIC_LINK_TTL_MS,
  EMAIL_SEND_THROTTLE_MAX,
  EMAIL_SEND_THROTTLE_WINDOW_MS,
  EMAIL_NONCE_MAX_AGE_MS,
  mintConfirmNonce,
  verifyAndClearConfirmNonce,
  mintSendNonce,
  verifySendNonce,
} from '../../lib/email-auth.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');

describe('normalizeEmail', () => {
  test('trims and lowercases', () => {
    assert.strictEqual(normalizeEmail(' A@X.io '), 'a@x.io');
    assert.strictEqual(normalizeEmail('Ada.Lovelace+tag@Example.CO.uk'), 'ada.lovelace+tag@example.co.uk');
  });

  test('refuses anything that is not a plausible address', () => {
    for (const bad of ['', '   ', 'no-at-sign', 'a@b', 'a b@c.io', '@x.io', 'a@', 'a@@x.io', 'a@x .io', `${'a'.repeat(250)}@x.io`, null, undefined, 42, ['a@x.io'], { email: 'a@x.io' }]) {
      assert.strictEqual(normalizeEmail(bad), null, `should refuse ${JSON.stringify(bad)}`);
    }
  });
});

describe('MagicLinkStore', () => {
  let client;
  let dbDir;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'email-auth-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore(clock) {
    const collection = client.db(`email_${counter++}`).collection(MAGIC_LINK_COLLECTION);
    const store = new MagicLinkStore({ collection, ...(clock ? { now: () => new Date(clock.ms) } : {}) });
    return { store, collection };
  }

  test('issue: a 32-byte base64url token, stored ONLY as its SHA-256, with the plan\'s document shape', async () => {
    const clock = { ms: Date.parse('2026-09-27T12:00:00Z') };
    const { store, collection } = freshStore(clock);

    const { token, expiresAt } = await store.issue({ emailNorm: 'a@x.io', requestNonceHash: 'req-hash' });

    assert.match(token, /^[A-Za-z0-9_-]{43}$/, '32 bytes → 43 base64url chars');
    assert.strictEqual(Buffer.from(token, 'base64url').length, 32);
    const docs = await collection.find({}).toArray();
    assert.strictEqual(docs.length, 1);
    assert.deepStrictEqual(docs[0], {
      _id: sha256(token),
      emailNorm: 'a@x.io',
      mode: 'signin',
      linkToAccountId: null,
      requestNonceHash: 'req-hash',
      createdAt: new Date(clock.ms),
      expiresAt: new Date(clock.ms + MAGIC_LINK_TTL_MS),
      consumedAt: null,
    });
    assert.deepStrictEqual(expiresAt, new Date(clock.ms + 15 * 60 * 1000), '15-minute expiry');
    assert.notStrictEqual(docs[0]._id, token);
    assert.ok(!JSON.stringify(docs).includes(token), 'the plain token is nowhere in the DB');
    assert.strictEqual(await collection.findOne({ _id: token }), null);
  });

  test('issue: two issues for one address are distinct tokens', async () => {
    const { store } = freshStore();
    const a = await store.issue({ emailNorm: 'a@x.io' });
    const b = await store.issue({ emailNorm: 'a@x.io' });
    assert.notStrictEqual(a.token, b.token);
  });

  test('issue: refuses an un-normalised address and an inconsistent mode', async () => {
    const { store, collection } = freshStore();
    await assert.rejects(store.issue({ emailNorm: ' A@X.io ' }), /normalised/);
    await assert.rejects(store.issue({ emailNorm: 'a@x.io', mode: 'other' }), /mode/);
    await assert.rejects(store.issue({ emailNorm: 'a@x.io', mode: 'link' }), /linkToAccountId/);
    await assert.rejects(store.issue({ emailNorm: 'a@x.io', mode: 'signin', linkToAccountId: 'acct-1' }), /linkToAccountId/);
    assert.strictEqual(await collection.countDocuments({}), 0);
  });

  test('issue: a link-mode token records the account it is bound to (S3 seam)', async () => {
    const { store } = freshStore();
    const { token } = await store.issue({ emailNorm: 'a@x.io', mode: 'link', linkToAccountId: 'acct-P' });
    const peeked = await store.peek(token);
    assert.strictEqual(peeked.mode, 'link');
    assert.strictEqual(peeked.linkToAccountId, 'acct-P');
  });

  test('peek: returns the link without consuming it, any number of times', async () => {
    const { store, collection } = freshStore();
    const { token } = await store.issue({ emailNorm: 'a@x.io', requestNonceHash: 'req-hash' });

    const first = await store.peek(token);
    const second = await store.peek(token);

    assert.strictEqual(first.emailNorm, 'a@x.io');
    assert.strictEqual(first.mode, 'signin');
    assert.strictEqual(first.requestNonceHash, 'req-hash');
    assert.deepStrictEqual(second, first);
    const stored = await collection.findOne({ _id: sha256(token) });
    assert.strictEqual(stored.consumedAt, null, 'peek never consumes');
  });

  test('consume: single use — the first call wins, a replay gets null', async () => {
    const clock = { ms: Date.parse('2026-09-27T12:00:00Z') };
    const { store, collection } = freshStore(clock);
    const { token } = await store.issue({ emailNorm: 'a@x.io' });

    clock.ms += 60 * 1000;
    const consumed = await store.consume(token);
    const replay = await store.consume(token);

    assert.strictEqual(consumed.emailNorm, 'a@x.io');
    assert.deepStrictEqual(consumed.consumedAt, new Date(clock.ms));
    assert.strictEqual(replay, null);
    assert.strictEqual(await store.peek(token), null, 'a consumed link no longer peeks');
    const stored = await collection.findOne({ _id: sha256(token) });
    assert.deepStrictEqual(stored.consumedAt, new Date(clock.ms));
  });

  test('consume: parallel consumes of one token yield exactly one winner (sequential on MangoDB; real race in mongo-smoke)', async () => {
    const { store } = freshStore();
    const { token } = await store.issue({ emailNorm: 'a@x.io' });
    const results = await Promise.all(Array.from({ length: 10 }, () => store.consume(token)));
    assert.strictEqual(results.filter(Boolean).length, 1);
  });

  test('expiry: past 15 minutes, peek and consume both refuse, and nothing is consumed', async () => {
    const clock = { ms: Date.parse('2026-09-27T12:00:00Z') };
    const { store, collection } = freshStore(clock);
    const { token } = await store.issue({ emailNorm: 'a@x.io' });

    clock.ms += MAGIC_LINK_TTL_MS - 1;
    assert.ok(await store.peek(token), 'still valid just inside the window');

    clock.ms += 1;
    assert.strictEqual(await store.peek(token), null);
    assert.strictEqual(await store.consume(token), null);
    const stored = await collection.findOne({ _id: sha256(token) });
    assert.strictEqual(stored.consumedAt, null);
  });

  test('unknown and malformed tokens are refused without throwing (query values may be arrays or objects)', async () => {
    const { store } = freshStore();
    await store.issue({ emailNorm: 'a@x.io' });
    const malformed = [undefined, null, '', 'short', 'x'.repeat(43) + 'y', 'A'.repeat(42) + '=', ['a'], { $ne: null }, 42];
    for (const bad of malformed) {
      assert.strictEqual(await store.peek(bad), null, `peek ${JSON.stringify(bad)}`);
      assert.strictEqual(await store.consume(bad), null, `consume ${JSON.stringify(bad)}`);
    }
    assert.strictEqual(await store.peek('A'.repeat(43)), null, 'well-formed but unknown');
  });

  test('recentCountForEmail: counts one address\'s issues inside the window only (the per-email throttle)', async () => {
    const clock = { ms: Date.parse('2026-09-27T12:00:00Z') };
    const { store } = freshStore(clock);

    await store.issue({ emailNorm: 'a@x.io' });
    clock.ms += 5 * 60 * 1000;
    await store.issue({ emailNorm: 'a@x.io' });
    await store.issue({ emailNorm: 'b@x.io' });
    clock.ms += 5 * 60 * 1000;
    await store.issue({ emailNorm: 'a@x.io' });

    assert.strictEqual(await store.recentCountForEmail('a@x.io'), 3);
    assert.strictEqual(await store.recentCountForEmail('b@x.io'), 1);
    assert.strictEqual(await store.recentCountForEmail('c@x.io'), 0);

    // The first issue falls out of the 15-minute window.
    clock.ms += 5 * 60 * 1000 + 1;
    assert.strictEqual(await store.recentCountForEmail('a@x.io'), 2);
    assert.strictEqual(await store.recentCountForEmail('a@x.io', 60 * 60 * 1000), 3, 'explicit window');
  });

  test('throttle constants: 3 sends per address per 15 minutes', () => {
    assert.strictEqual(EMAIL_SEND_THROTTLE_MAX, 3);
    assert.strictEqual(EMAIL_SEND_THROTTLE_WINDOW_MS, 15 * 60 * 1000);
  });
});

describe('confirm nonce (G1)', () => {
  const T0 = Date.parse('2026-09-27T12:00:00Z');
  const TOKEN = 'T'.repeat(43);
  const OTHER_TOKEN = 'U'.repeat(43);

  test('mint stores only hashes, bound to the token, and returns the plain nonce', () => {
    const session = {};
    const nonce = mintConfirmNonce(session, TOKEN, T0);

    assert.match(nonce, /^[A-Za-z0-9_-]{43}$/);
    assert.deepStrictEqual(session.emailConfirm, {
      nonceHash: sha256(nonce),
      tokenHash: hashToken(TOKEN),
      issuedAt: T0,
    });
    assert.strictEqual(hashToken(TOKEN), sha256(TOKEN));
    assert.ok(!JSON.stringify(session).includes(nonce), 'the plain nonce is not in the session');
    assert.ok(!JSON.stringify(session).includes(TOKEN), 'the plain token is not in the session');
  });

  test('the right token + nonce verifies once, and is cleared', () => {
    const session = {};
    const nonce = mintConfirmNonce(session, TOKEN, T0);

    assert.strictEqual(verifyAndClearConfirmNonce(session, { t: TOKEN, nonce }, T0 + 1000), true);
    assert.strictEqual('emailConfirm' in session, false);
    assert.strictEqual(verifyAndClearConfirmNonce(session, { t: TOKEN, nonce }, T0 + 2000), false, 'replay');
  });

  test('every failing call also clears (single use, pass or fail)', () => {
    const cases = [
      { name: 'wrong nonce', input: nonce => ({ t: TOKEN, nonce: 'N'.repeat(43) }) },
      { name: 'missing nonce', input: () => ({ t: TOKEN }) },
      { name: 'nonce minted for a different token', input: nonce => ({ t: OTHER_TOKEN, nonce }) },
      { name: 'non-string inputs', input: () => ({ t: [TOKEN], nonce: { $ne: '' } }) },
    ];
    for (const { name, input } of cases) {
      const session = {};
      const nonce = mintConfirmNonce(session, TOKEN, T0);
      assert.strictEqual(verifyAndClearConfirmNonce(session, input(nonce), T0 + 1000), false, name);
      assert.strictEqual('emailConfirm' in session, false, `${name}: cleared`);
      // The right pair no longer works either: the nonce was spent by the failure.
      assert.strictEqual(verifyAndClearConfirmNonce(session, { t: TOKEN, nonce }, T0 + 2000), false, `${name}: spent`);
    }
  });

  test('a nonce older than 15 minutes is refused (and cleared)', () => {
    const session = {};
    const nonce = mintConfirmNonce(session, TOKEN, T0);
    assert.strictEqual(EMAIL_NONCE_MAX_AGE_MS, 15 * 60 * 1000);
    assert.strictEqual(verifyAndClearConfirmNonce(session, { t: TOKEN, nonce }, T0 + EMAIL_NONCE_MAX_AGE_MS + 1), false);
    assert.strictEqual('emailConfirm' in session, false);

    const fresh = {};
    const edgeNonce = mintConfirmNonce(fresh, TOKEN, T0);
    assert.strictEqual(verifyAndClearConfirmNonce(fresh, { t: TOKEN, nonce: edgeNonce }, T0 + EMAIL_NONCE_MAX_AGE_MS), true, 'exactly 15 minutes is still inside');
  });

  test('a session that never minted (no cookie → empty session) is refused', () => {
    assert.strictEqual(verifyAndClearConfirmNonce({}, { t: TOKEN, nonce: 'N'.repeat(43) }, T0), false);
    assert.strictEqual(verifyAndClearConfirmNonce(undefined, { t: TOKEN, nonce: 'N'.repeat(43) }, T0), false);
  });

  test('re-minting (a second GET) replaces the earlier nonce', () => {
    const session = {};
    const first = mintConfirmNonce(session, TOKEN, T0);
    const second = mintConfirmNonce(session, TOKEN, T0 + 1000);
    assert.notStrictEqual(first, second);
    assert.strictEqual(verifyAndClearConfirmNonce(session, { t: TOKEN, nonce: first }, T0 + 2000), false);
  });
});

describe('send nonce (hardening)', () => {
  const T0 = Date.parse('2026-09-27T12:00:00Z');

  test('mint stores only the hash; the right nonce verifies', () => {
    const session = {};
    const nonce = mintSendNonce(session, T0);
    assert.deepStrictEqual(session.emailSend, { nonceHash: sha256(nonce), issuedAt: T0 });
    assert.strictEqual(verifySendNonce(session, nonce, T0 + 1000), true);
  });

  test('stays valid inside its window, so a double-submitted form is not refused', () => {
    const session = {};
    const nonce = mintSendNonce(session, T0);
    assert.strictEqual(verifySendNonce(session, nonce, T0 + 1000), true);
    assert.strictEqual(verifySendNonce(session, nonce, T0 + 2000), true);
  });

  test('a refusal leaves the session untouched (so a refused send saves no session and sets no cookie)', () => {
    const session = {};
    const nonce = mintSendNonce(session, T0);
    const snapshot = JSON.stringify(session);
    for (const bad of [undefined, '', 'N'.repeat(43), [nonce], { $ne: '' }]) {
      assert.strictEqual(verifySendNonce(session, bad, T0 + 1000), false, JSON.stringify(bad));
      assert.strictEqual(JSON.stringify(session), snapshot);
    }
    const empty = {};
    assert.strictEqual(verifySendNonce(empty, nonce, T0), false, 'no minted nonce (no cookie)');
    assert.deepStrictEqual(empty, {});
  });

  test('a send nonce older than 15 minutes is refused', () => {
    const session = {};
    const nonce = mintSendNonce(session, T0);
    assert.strictEqual(verifySendNonce(session, nonce, T0 + EMAIL_NONCE_MAX_AGE_MS + 1), false);
  });

  test('a send nonce cannot stand in for a confirm nonce, or the reverse', () => {
    const TOKEN = 'T'.repeat(43);
    const session = {};
    const sendNonce = mintSendNonce(session, T0);
    const confirmNonce = mintConfirmNonce(session, TOKEN, T0);
    assert.strictEqual(verifySendNonce(session, confirmNonce, T0 + 1), false);
    assert.strictEqual(verifyAndClearConfirmNonce(session, { t: TOKEN, nonce: sendNonce }, T0 + 1), false);
  });
});
