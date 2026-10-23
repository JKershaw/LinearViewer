/**
 * LIN-3771: the send door against a form-spam bot. Honeypot, minimum
 * GET-to-POST time and a 24h per-address cap, all answering with the same
 * check-inbox page a real send gets; the per-IP limiter stays a 429. Refusals
 * log a reason and never an address. LIN-3789: site-wide volume is a log-only
 * hourly alarm, never a refusal.
 *
 * Run with: node --test tests/unit/email-send-antispam.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { startEmailAuthHarness } from '../fixtures/email-auth-harness.js';
import { createEmailSendLimiter } from '../../routes/email-auth.js';
import { renderEmailSignInPage, renderEmailRegisterPage, renderEmailReproofPage, renderEmailLinkConfirmPage, renderEmailConfirmPage } from '../../lib/render-email-auth.js';
import { EMAIL_SEND_DAILY_MAX, EMAIL_SEND_MIN_FORM_MS } from '../../lib/email-auth.js';

const SAME_ORIGIN = { headers: { 'Sec-Fetch-Site': 'same-origin' } };

function captureWarnings() {
  const lines = [];
  const orig = console.warn;
  console.warn = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.warn = orig; } };
}

const linkCount = harness => harness.db.collection('email-magic-links').countDocuments({});

describe('honeypot', () => {
  let harness, warn;
  before(async () => { harness = await startEmailAuthHarness(); });
  after(async () => { await harness?.close(); });
  beforeEach(() => { warn = captureWarnings(); });
  afterEach(() => warn.restore());

  test('a filled honeypot gets the normal check-inbox page, sends nothing, stores nothing, logs only the reason', async () => {
    const real = await harness.browser().requestLink('real@x.io');
    const before = await linkCount(harness);
    const sent = harness.transport.outbox.length;

    const bot = harness.browser();
    const { nonce } = await bot.openForm();
    const res = await bot.post('/auth/email/send', { email: 'bot-victim@x.io', nonce, website: 'http://spam.example' }, SAME_ORIGIN);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.text, real.text, 'byte-identical to an accepted send');
    assert.strictEqual(await linkCount(harness), before);
    assert.strictEqual(harness.transport.outbox.length, sent);
    assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: honeypot']);
    assert.ok(!warn.lines.join('\n').includes('bot-victim'), 'the address is never logged');
  });

  test('an empty honeypot field (what a browser submits) is a normal send', async () => {
    const b = harness.browser();
    const { nonce } = await b.openForm();
    await b.post('/auth/email/send', { email: 'human@x.io', nonce, website: '' }, SAME_ORIGIN);
    assert.ok(harness.transport.lastMessageTo('human@x.io'));
  });

  test('the honeypot is on all three send forms and on no confirm form', () => {
    const field = /name="website"/;
    const n = 'N'.repeat(43);
    assert.match(renderEmailSignInPage({ nonce: n }), field);
    assert.match(renderEmailRegisterPage({ nonce: n }), field);
    assert.match(renderEmailReproofPage({ email: 'a@x.io', nonce: n }), field);
    assert.doesNotMatch(renderEmailLinkConfirmPage({ email: 'a@x.io', token: 'T'.repeat(43), nonce: n }), field);
    assert.doesNotMatch(renderEmailConfirmPage({ email: 'a@x.io', token: 'T'.repeat(43), nonce: n }), field);
  });
});

describe('minimum time between the form and the send', () => {
  let harness, clock, warn;
  before(async () => {
    clock = { ms: 1_000_000 };
    harness = await startEmailAuthHarness({ minFormMs: EMAIL_SEND_MIN_FORM_MS, nonceClock: clock });
  });
  after(async () => { await harness?.close(); });
  beforeEach(() => { warn = captureWarnings(); });
  afterEach(() => warn.restore());

  test('a POST inside the minimum is a silent refusal that does not consume the nonce; the same nonce works after the wait', async () => {
    const b = harness.browser();
    const { nonce } = await b.openForm();
    clock.ms += EMAIL_SEND_MIN_FORM_MS - 1;
    const early = await b.post('/auth/email/send', { email: 'fast@x.io', nonce }, SAME_ORIGIN);
    assert.strictEqual(early.status, 200);
    assert.match(early.text, /data-testid="email-check-inbox"/);
    assert.strictEqual(await linkCount(harness), 0);
    assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: too-fast']);

    clock.ms += 1;
    const late = await b.post('/auth/email/send', { email: 'fast@x.io', nonce }, SAME_ORIGIN);
    assert.strictEqual(late.text, early.text);
    assert.ok(harness.transport.lastMessageTo('fast@x.io'), 'the same nonce still sends once the minimum has passed');
  });
});

describe('24h per-address cap', () => {
  test(`coexists with the 15 minute cap: spaced sends stop after ${EMAIL_SEND_DAILY_MAX} in a day`, async () => {
    // LIN-3789: pinned literally so a constant edit cannot silently re-pin it.
    assert.strictEqual(EMAIL_SEND_DAILY_MAX, 20);
    // Production defaults for the router (minFormMs / alarmPerHour null); one clock
    // drives both the store and the nonce ages, so the 2 s form minimum is waited out.
    const clock = { ms: Date.now() };
    const warn = captureWarnings();
    const harness = await startEmailAuthHarness({ storeClock: clock, nonceClock: clock, minFormMs: null, alarmPerHour: null });
    const send = async () => {
      const b = harness.browser();
      const { nonce } = await b.openForm();
      clock.ms += EMAIL_SEND_MIN_FORM_MS;
      return b.post('/auth/email/send', { email: 'daily@x.io', nonce }, SAME_ORIGIN);
    };
    try {
      // Spaced 20 minutes apart, so the 3-per-15-minutes cap never trips.
      for (let i = 0; i < 20; i++) {
        await send();
        clock.ms += 20 * 60 * 1000;
      }
      const links = harness.db.collection('email-magic-links');
      assert.strictEqual(await links.countDocuments({ emailNorm: 'daily@x.io' }), 20);
      const res = await send();
      assert.strictEqual(res.status, 200);
      assert.match(res.text, /data-testid="email-check-inbox"/);
      assert.strictEqual(await links.countDocuments({ emailNorm: 'daily@x.io' }), 20, 'the 21st is refused');
      assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: recipient-daily-cap']);

      clock.ms += 24 * 60 * 60 * 1000;
      await send();
      assert.strictEqual(await links.countDocuments({ emailNorm: 'daily@x.io' }), 21);
    } finally { warn.restore(); await harness.close(); }
  });
});

describe('volume alarm fails open', () => {
  // LIN-3789: the alarm is a log line, not a gate. If counting the hour's sends
  // throws, the link is still sent and only the error name is logged.
  test('a failing volume count never blocks the send', async () => {
    const errs = [];
    const orig = console.error;
    console.error = (...a) => { errs.push(a.join(' ')); };
    const harness = await startEmailAuthHarness({ alarmPerHour: 1 });
    try {
      harness.stores.magicLinkStore.recentCount = async () => { throw new TypeError('boom'); };
      await harness.browser().requestLink('x@x.io');
      assert.ok(harness.transport.lastMessageTo('x@x.io'));
      assert.deepStrictEqual(errs, ['[email-auth] send volume check failed: TypeError']);
    } finally { console.error = orig; await harness.close(); }
  });
});

describe('per-IP limiter', () => {
  test('stays a 429 on refusal and logs the reason without any address', async () => {
    const warn = captureWarnings();
    const harness = await startEmailAuthHarness({ sendLimiter: createEmailSendLimiter({ skip: () => false }) });
    try {
      for (let i = 0; i < 10; i++) await harness.browser().requestLink(`ip${i}@x.io`);
      const res = await harness.browser().requestLink('ip-over@x.io');
      assert.strictEqual(res.status, 429);
      assert.match(res.text, /Too many sign-in emails requested/);
      assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: per-ip-limit']);
    } finally { warn.restore(); await harness.close(); }
  });
});

describe('nonce refusal', () => {
  test('a POST with a wrong nonce is still a 403 and logs the reason without any address', async () => {
    const warn = captureWarnings();
    const harness = await startEmailAuthHarness();
    try {
      const b = harness.browser();
      await b.openForm();
      const res = await b.post('/auth/email/send', { email: 'nonce-victim@x.io', nonce: 'N'.repeat(43) }, SAME_ORIGIN);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(await linkCount(harness), 0);
      assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: nonce']);
      assert.ok(!warn.lines.join('\n').includes('@'), 'the address is never logged');
    } finally { warn.restore(); await harness.close(); }
  });
});

// F1 (review): every test above passes minFormMs explicitly, and the
// harness forces it (and the alarm) off otherwise, so nothing pinned what production runs. These
// build the router with its own defaults (null = leave the options out).
describe('production defaults', () => {
  const sendAfterWait = async (harness, clock, email) => {
    const b = harness.browser();
    const { nonce } = await b.openForm();
    clock.ms += EMAIL_SEND_MIN_FORM_MS;
    return b.post('/auth/email/send', { email, nonce }, SAME_ORIGIN);
  };
  const withNodeEnv = async (value, fn) => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = value;
    try { return await fn(); } finally {
      if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved;
    }
  };

  test('under production a POST 1999 ms after the form is refused as too-fast, and 2000 ms is sent', async () => {
    const warn = captureWarnings();
    await withNodeEnv('production', async () => {
      const clock = { ms: 1_000_000 };
      const harness = await startEmailAuthHarness({ minFormMs: null, alarmPerHour: null, nonceClock: clock });
      try {
        const b = harness.browser();
        const { nonce } = await b.openForm();
        clock.ms += 1999;
        await b.post('/auth/email/send', { email: 'prod@x.io', nonce }, SAME_ORIGIN);
        assert.strictEqual(await linkCount(harness), 0);
        assert.deepStrictEqual(warn.lines, ['[email-auth] send refused: too-fast']);
        clock.ms += 1;
        await b.post('/auth/email/send', { email: 'prod@x.io', nonce }, SAME_ORIGIN);
        assert.ok(harness.transport.lastMessageTo('prod@x.io'));
      } finally { await harness.close(); }
    });
    warn.restore();
  });

  // LIN-3789: capture every console channel; the alarm is a warning but no line may carry an address.
  const captureAll = () => {
    const lines = [];
    const orig = { warn: console.warn, log: console.log, error: console.error };
    for (const k of Object.keys(orig)) console[k] = (...args) => { lines.push(args.join(' ')); };
    return { lines, restore: () => Object.assign(console, orig) };
  };
  const ALARM = n => `[email-auth] send volume alarm: ${n} in the last hour`;

  test('under production the 11th and 60th sends in an hour, to different addresses, are sent (no site-wide ceiling)', async () => {
    const cap = captureAll();
    try {
      await withNodeEnv('production', async () => {
        const clock = { ms: 1_000_000 };
        const harness = await startEmailAuthHarness({ minFormMs: null, alarmPerHour: null, nonceClock: clock, storeClock: clock });
        try {
          for (let i = 1; i <= 60; i++) {
            await sendAfterWait(harness, clock, `p${i}@x.io`);
            if (i === 11 || i === 60) assert.ok(harness.transport.lastMessageTo(`p${i}@x.io`), `send #${i} was sent`);
          }
          assert.strictEqual(await linkCount(harness), 60);
          assert.ok(!cap.lines.some(l => l.includes('global-ceiling') || l.includes('send refused')));
        } finally { await harness.close(); }
      });
    } finally { cap.restore(); }
  });

  test('the volume alarm logs once at the threshold, again only in the next hour, and never an address', async () => {
    const cap = captureAll();
    try {
      await withNodeEnv('production', async () => {
        const clock = { ms: 1_000_000 };
        const harness = await startEmailAuthHarness({ minFormMs: null, alarmPerHour: null, nonceClock: clock, storeClock: clock });
        try {
          for (let i = 1; i <= 49; i++) await sendAfterWait(harness, clock, `a${i}@x.io`);
          assert.deepStrictEqual(cap.lines, [], 'quiet below the threshold');
          await sendAfterWait(harness, clock, 'a50@x.io');
          assert.deepStrictEqual(cap.lines, [ALARM(50)]);
          for (let i = 51; i <= 60; i++) await sendAfterWait(harness, clock, `a${i}@x.io`);
          assert.deepStrictEqual(cap.lines, [ALARM(50)], 'at most once per hour');
          assert.strictEqual(harness.transport.lastMessageTo('a60@x.io') !== null, true, 'the alarm refuses nothing');

          clock.ms += 60 * 60 * 1000 + 1000;
          for (let i = 1; i <= 50; i++) await sendAfterWait(harness, clock, `b${i}@x.io`);
          assert.deepStrictEqual(cap.lines, [ALARM(50), ALARM(50)]);
          assert.ok(!cap.lines.join('\n').includes('@'), 'no address in any line');
        } finally { await harness.close(); }
      });
    } finally { cap.restore(); }
  });

  test('under NODE_ENV=test an immediate POST sends (the e2e bypass)', async () => {
    await withNodeEnv('test', async () => {
      const harness = await startEmailAuthHarness({ minFormMs: null, alarmPerHour: null });
      try {
        await harness.browser().requestLink('instant@x.io');
        assert.ok(harness.transport.lastMessageTo('instant@x.io'));
      } finally { await harness.close(); }
    });
  });
});
