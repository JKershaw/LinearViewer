/**
 * Unit tests for lib/email-availability.js (LIN-1892 S2 item 1, G2/G3).
 *
 * Email sign-in is on ONLY by an explicit operator choice — `NODE_ENV` alone
 * never turns it on. Every matrix row passes its own env object, with
 * `NODE_ENV` set (or absent) explicitly, so nothing here depends on the
 * runner's own environment.
 *
 * Run with: node --test tests/unit/email-availability.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveEmailTransportKind,
  isEmailSignInAvailable,
  resolvePromptStepMode,
  resolveEmailTransportRefusal,
} from '../../lib/email-availability.js';
import { createEmailTransport } from '../../lib/email-transport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, '../../lib/email-availability.js');

const KEY = 're_test_secret_key_value';
const FROM = 'Harbour <sign-in@example.test>';

// `NODE_ENV` / email variables → kind, step mode, refused-combination warning.
// The two S2-3 rows (verdict 0def5b66, G3-a) are marked.
const MATRIX = [
  { name: 'unset / none', env: {}, kind: null, step: 'off', warns: false },
  { name: 'development / none', env: { NODE_ENV: 'development' }, kind: null, step: 'off', warns: false },
  { name: 'test / none', env: { NODE_ENV: 'test' }, kind: null, step: 'off', warns: false },
  { name: 'production / none', env: { NODE_ENV: 'production' }, kind: null, step: 'off', warns: false },
  { name: 'unset / EMAIL_TRANSPORT=console', env: { EMAIL_TRANSPORT: 'console' }, kind: 'console', step: 'off', warns: false },
  { name: 'unset / EMAIL_TRANSPORT=console, EMAIL_PROMPT_STEP=on', env: { EMAIL_TRANSPORT: 'console', EMAIL_PROMPT_STEP: 'on' }, kind: 'console', step: 'on', warns: false },
  { name: 'development / EMAIL_TRANSPORT=console', env: { NODE_ENV: 'development', EMAIL_TRANSPORT: 'console' }, kind: 'console', step: 'off', warns: false },
  { name: 'production / EMAIL_TRANSPORT=console', env: { NODE_ENV: 'production', EMAIL_TRANSPORT: 'console' }, kind: null, step: 'off', warns: true },
  // Not marked "+ warning" in the plan's matrix, but the rule is one rule: an
  // explicit EMAIL_TRANSPORT the resolver can't honour is named at startup.
  { name: 'development / EMAIL_TRANSPORT=capture', env: { NODE_ENV: 'development', EMAIL_TRANSPORT: 'capture' }, kind: null, step: 'off', warns: true },
  { name: 'unset / EMAIL_TRANSPORT=capture', env: { EMAIL_TRANSPORT: 'capture' }, kind: null, step: 'off', warns: true },
  { name: 'test / EMAIL_TRANSPORT=capture', env: { NODE_ENV: 'test', EMAIL_TRANSPORT: 'capture' }, kind: 'capture', step: 'opt-in', warns: false },
  // S2-3 (G3-a): a developer's .env passes these through beside Playwright's
  // command-line EMAIL_TRANSPORT=capture (server.js loads .env under test).
  { name: 'S2-3: test / EMAIL_TRANSPORT=capture + EMAIL_PROMPT_STEP=on', env: { NODE_ENV: 'test', EMAIL_TRANSPORT: 'capture', EMAIL_PROMPT_STEP: 'on' }, kind: 'capture', step: 'opt-in', warns: false },
  { name: 'S2-3: test / EMAIL_TRANSPORT=capture + RESEND_API_KEY + EMAIL_FROM', env: { NODE_ENV: 'test', EMAIL_TRANSPORT: 'capture', RESEND_API_KEY: KEY, EMAIL_FROM: FROM }, kind: 'capture', step: 'opt-in', warns: false },
  { name: 'production / key only', env: { NODE_ENV: 'production', RESEND_API_KEY: KEY }, kind: null, step: 'off', warns: false },
  { name: 'production / from only', env: { NODE_ENV: 'production', EMAIL_FROM: FROM }, kind: null, step: 'off', warns: false },
  { name: 'production / key + from', env: { NODE_ENV: 'production', RESEND_API_KEY: KEY, EMAIL_FROM: FROM }, kind: 'resend', step: 'on', warns: false },
  { name: 'production / key + from + EMAIL_TRANSPORT=resend', env: { NODE_ENV: 'production', RESEND_API_KEY: KEY, EMAIL_FROM: FROM, EMAIL_TRANSPORT: 'resend' }, kind: 'resend', step: 'on', warns: false },
  { name: 'unset / key + from (self-hosted with a real key)', env: { RESEND_API_KEY: KEY, EMAIL_FROM: FROM }, kind: 'resend', step: 'on', warns: false },
  { name: 'production / key + from + EMAIL_TRANSPORT=console', env: { NODE_ENV: 'production', RESEND_API_KEY: KEY, EMAIL_FROM: FROM, EMAIL_TRANSPORT: 'console' }, kind: null, step: 'off', warns: true },
  { name: 'production / EMAIL_TRANSPORT=resend without key + from', env: { NODE_ENV: 'production', EMAIL_TRANSPORT: 'resend' }, kind: null, step: 'off', warns: true },
  { name: 'unset / EMAIL_PROMPT_STEP=on only', env: { EMAIL_PROMPT_STEP: 'on' }, kind: null, step: 'off', warns: false },
  { name: 'unset / empty-string variables count as unset', env: { EMAIL_TRANSPORT: '', RESEND_API_KEY: '', EMAIL_FROM: '' }, kind: null, step: 'off', warns: false },
  ...[undefined, 'development', 'test', 'production'].map(nodeEnv => ({
    name: `${nodeEnv ?? 'unset'} / EMAIL_TRANSPORT=bogus`,
    env: nodeEnv ? { NODE_ENV: nodeEnv, EMAIL_TRANSPORT: 'bogus' } : { EMAIL_TRANSPORT: 'bogus' },
    kind: null,
    step: 'off',
    warns: true,
  })),
];

describe('email-availability env matrix', () => {
  for (const row of MATRIX) {
    test(row.name, () => {
      const env = Object.freeze({ ...row.env });
      assert.strictEqual(resolveEmailTransportKind(env), row.kind, 'kind');
      assert.strictEqual(isEmailSignInAvailable(env), row.kind !== null, 'predicate');
      assert.strictEqual(resolvePromptStepMode(env), row.step, 'step mode');

      // The predicate and the transport factory can't disagree (G2: one
      // source of truth behind the transport, the 503s and both CTAs).
      const transport = createEmailTransport({ env, fetchImpl: async () => { throw new Error('no fetch in this test'); } });
      assert.strictEqual(transport !== null, isEmailSignInAvailable(env), 'transport ⇔ predicate');
      if (transport) assert.strictEqual(transport.kind, row.kind);

      const reason = resolveEmailTransportRefusal(env);
      if (row.warns) {
        assert.strictEqual(typeof reason, 'string', 'refused combination has a reason');
        assert.match(reason, /EMAIL_TRANSPORT/, 'the reason names the variable');
      } else {
        assert.strictEqual(reason, null, 'no warning');
      }
    });
  }
});

describe('email-availability', () => {
  test('defaults to process.env when called with no argument', () => {
    // Only shape is asserted: the runner's env is not something this test pins.
    assert.ok([null, 'resend', 'console', 'capture'].includes(resolveEmailTransportKind()));
    assert.strictEqual(typeof isEmailSignInAvailable(), 'boolean');
    assert.ok(['on', 'off', 'opt-in'].includes(resolvePromptStepMode()));
  });

  test('NODE_ENV alone never turns email on, whatever its value', () => {
    for (const nodeEnv of [undefined, '', 'development', 'test', 'production', 'staging']) {
      const env = nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv };
      assert.strictEqual(isEmailSignInAvailable(env), false, `NODE_ENV=${nodeEnv}`);
    }
  });

  test('refusal reasons carry no secret and do not echo an unknown value', () => {
    const reasons = [
      resolveEmailTransportRefusal({ NODE_ENV: 'production', RESEND_API_KEY: KEY, EMAIL_FROM: FROM, EMAIL_TRANSPORT: 'console' }),
      resolveEmailTransportRefusal({ NODE_ENV: 'production', EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: KEY }),
      resolveEmailTransportRefusal({ EMAIL_TRANSPORT: 'hunter2-not-a-transport' }),
    ];
    for (const reason of reasons) {
      assert.strictEqual(typeof reason, 'string');
      assert.ok(!reason.includes(KEY), 'no API key in the reason');
      assert.ok(!reason.includes('hunter2'), 'an unknown value is not echoed');
    }
  });

  test('the source has no import (a leaf: it can never close an import cycle, N6)', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8');
    assert.doesNotMatch(source, /^\s*import\b/m);
    assert.doesNotMatch(source, /\bimport\s*\(/);
    assert.doesNotMatch(source, /\brequire\s*\(/);
  });
});
