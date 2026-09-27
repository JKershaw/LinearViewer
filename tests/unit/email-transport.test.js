/**
 * Unit tests for lib/email-transport.js (LIN-1892 S2 item 2).
 *
 * The Resend transport is driven through an injected `fetch` stub, and
 * `globalThis.fetch` is replaced with a counting stub that throws for the
 * whole file: `tests/fixtures/network-guard.js` patches `http(s).request`
 * only and cannot see native `fetch` (C7), so "no real request left the
 * process" is asserted here directly, as a zero call count.
 *
 * Run with: node --test tests/unit/email-transport.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  createEmailTransport,
  createCaptureTransport,
  createConsoleTransport,
  createResendTransport,
  hashEmailRecipient,
  RESEND_ENDPOINT,
} from '../../lib/email-transport.js';

const KEY = 're_test_secret_key_value';
const FROM = 'Harbour <sign-in@example.test>';
const TO = 'Ada@Example.test';
const LINK = 'https://harbour.example/auth/email/confirm?t=SECRET_TOKEN_VALUE';
const MESSAGE = {
  to: TO,
  subject: 'Your Harbour sign-in link',
  text: `Sign in: ${LINK}`,
  html: `<a href="${LINK}">Sign in</a>`,
};

function recordingLogger() {
  const lines = [];
  const record = level => (...args) => lines.push({ level, text: args.map(String).join(' ') });
  return { lines, log: record('log'), info: record('info'), warn: record('warn'), error: record('error') };
}

function recordingFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

describe('email-transport', () => {
  let originalFetch;
  let globalFetchCalls = 0;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      globalFetchCalls += 1;
      throw new Error('real fetch is not allowed in email-transport tests');
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
    // C7: nothing in this file reached the real fetch (the tests that
    // deliberately exercise the default seam reset the counter themselves).
    assert.strictEqual(globalFetchCalls, 0, 'globalThis.fetch must never be called');
  });

  test('email off → createEmailTransport returns null', () => {
    assert.strictEqual(createEmailTransport({ env: {} }), null);
    assert.strictEqual(createEmailTransport({ env: { NODE_ENV: 'production' } }), null);
    assert.strictEqual(createEmailTransport({ env: { NODE_ENV: 'test' } }), null);
    // Resend keys without EMAIL_LINK_ORIGIN: off (fail closed, Host-header link poisoning).
    assert.strictEqual(createEmailTransport({ env: { NODE_ENV: 'production', RESEND_API_KEY: KEY, EMAIL_FROM: FROM } }), null);
  });

  test('Resend: POSTs the message JSON with a Bearer key and a timeout signal, via the injected fetch only', async () => {
    const { calls, fetchImpl } = recordingFetch(() => new Response('{"id":"e1"}', { status: 200 }));
    const logger = recordingLogger();
    const transport = createEmailTransport({ env: { NODE_ENV: 'production', RESEND_API_KEY: KEY, EMAIL_FROM: FROM, EMAIL_LINK_ORIGIN: 'https://harbour.example' }, fetchImpl, logger });

    assert.strictEqual(transport.kind, 'resend');
    const result = await transport.send(MESSAGE);

    assert.deepStrictEqual(result, { ok: true, status: 200 });
    assert.strictEqual(calls.length, 1);
    const [{ url, init }] = calls;
    assert.strictEqual(url, RESEND_ENDPOINT);
    assert.strictEqual(RESEND_ENDPOINT, 'https://api.resend.com/emails');
    assert.strictEqual(init.method, 'POST');
    assert.deepStrictEqual(init.headers, {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    });
    assert.deepStrictEqual(JSON.parse(init.body), {
      from: FROM,
      to: TO,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
    assert.ok(init.signal instanceof AbortSignal, 'the request carries an AbortSignal (timeout)');
    assert.strictEqual(globalFetchCalls, 0);
  });

  test('Resend: a non-2xx is { ok: false, status } and logs only the status and a hashed recipient', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(`{"message":"bad ${LINK}"}`, { status: 422 }));
    const logger = recordingLogger();
    const transport = createResendTransport({ apiKey: KEY, from: FROM, fetchImpl, logger });

    const result = await transport.send(MESSAGE);

    assert.deepStrictEqual(result, { ok: false, status: 422 });
    assert.strictEqual(logger.lines.length, 1);
    const [line] = logger.lines;
    assert.strictEqual(line.level, 'error');
    assert.match(line.text, /422/);
    assert.ok(line.text.includes(hashEmailRecipient(TO)), 'the hashed recipient is logged');
    for (const secret of [TO, TO.toLowerCase(), 'SECRET_TOKEN_VALUE', KEY, MESSAGE.subject]) {
      assert.ok(!line.text.includes(secret), `the log line must not contain ${secret}`);
    }
  });

  test('Resend: a thrown fetch (network error) is { ok: false } and logs no secret', async () => {
    const { fetchImpl } = recordingFetch(() => { throw new TypeError(`fetch failed for ${LINK}`); });
    const logger = recordingLogger();
    const transport = createResendTransport({ apiKey: KEY, from: FROM, fetchImpl, logger });

    const result = await transport.send(MESSAGE);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(logger.lines.length, 1);
    assert.ok(logger.lines[0].text.includes(hashEmailRecipient(TO)));
    for (const secret of [TO, 'SECRET_TOKEN_VALUE', KEY]) {
      assert.ok(!logger.lines[0].text.includes(secret), `the log line must not contain ${secret}`);
    }
  });

  test('Resend: a hung request is aborted by the timeout and resolves { ok: false }', async () => {
    const fetchImpl = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
    const logger = recordingLogger();
    const transport = createResendTransport({ apiKey: KEY, from: FROM, fetchImpl, logger, timeoutMs: 20 });

    const result = await transport.send(MESSAGE);

    assert.strictEqual(result.ok, false);
    assert.match(logger.lines[0].text, /TimeoutError|timeout/i);
  });

  test('the default fetch seam is globalThis.fetch (which network-guard.js cannot see — C7)', async () => {
    const callsBefore = globalFetchCalls;
    const logger = recordingLogger();
    const transport = createResendTransport({ apiKey: KEY, from: FROM, logger });
    const result = await transport.send(MESSAGE);
    assert.strictEqual(result.ok, false, 'the throwing global stub was used');
    assert.strictEqual(globalFetchCalls - callsBefore, 1);
    globalFetchCalls = callsBefore; // deliberate call; keep the file-level zero assertion about accidental ones
  });

  test('console transport: prints the message (dev opt-in), never sends', async () => {
    const logger = recordingLogger();
    const transport = createEmailTransport({ env: { NODE_ENV: 'development', EMAIL_TRANSPORT: 'console' }, logger });

    assert.strictEqual(transport.kind, 'console');
    const result = await transport.send(MESSAGE);

    assert.deepStrictEqual(result, { ok: true });
    assert.ok(logger.lines.some(l => l.text.includes(LINK)), 'the sign-in link reaches the server log');
  });

  test('console transport throws if constructed under production, even directly (defence in depth)', () => {
    assert.throws(() => createConsoleTransport({ env: { NODE_ENV: 'production' } }), /production/);
    // The factory never gets that far: the resolver already refuses the combination.
    assert.strictEqual(createEmailTransport({ env: { NODE_ENV: 'production', EMAIL_TRANSPORT: 'console' } }), null);
  });

  test('capture transport: records messages in .outbox and finds the latest per recipient', async () => {
    const transport = createCaptureTransport();
    assert.strictEqual(transport.kind, 'capture');
    assert.deepStrictEqual(transport.outbox, []);

    await transport.send({ ...MESSAGE, text: 'first' });
    await transport.send({ ...MESSAGE, to: 'someone@else.test', text: 'other' });
    const result = await transport.send({ ...MESSAGE, text: 'second' });

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(transport.outbox.length, 3);
    assert.strictEqual(transport.lastMessageTo(TO).text, 'second');
    assert.strictEqual(transport.lastMessageTo('ada@example.test').text, 'second', 'recipient match is case-insensitive');
    assert.strictEqual(transport.lastMessageTo('nobody@x.test'), null);
  });

  test('createEmailTransport under NODE_ENV=test + EMAIL_TRANSPORT=capture returns a capture transport', () => {
    const transport = createEmailTransport({ env: { NODE_ENV: 'test', EMAIL_TRANSPORT: 'capture' } });
    assert.strictEqual(transport.kind, 'capture');
    assert.ok(Array.isArray(transport.outbox));
  });

  test('hashEmailRecipient is sha256 of the trimmed, lowercased address', () => {
    const expected = createHash('sha256').update('ada@example.test').digest('hex');
    assert.strictEqual(hashEmailRecipient(' Ada@Example.test '), expected);
  });
});
