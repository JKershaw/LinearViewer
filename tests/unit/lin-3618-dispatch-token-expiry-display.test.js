/**
 * LIN-3618 — the mint modal shows a token's expiry: "never expires" (null/absent),
 * "expires <date>" (future), "expired <date>" (past). The API already returned
 * `expiresAt`; the UI hid it. The key list in Settings › Agent access pins its own
 * expiry text in tests/unit/settings-keys.test.js (LIN-3846 removed the Dispatch
 * page's list and its renderer).
 *
 * `public/dispatch.js` is a browser script, so this vm-sandboxes the slice that
 * holds the expiry helper and the modal-body builder, the same technique as
 * tests/unit/dispatch-feedback-entries.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/dispatch.js'), 'utf8');

function makeSandbox() {
  const start = SRC.indexOf('function formatDispatchTokenExpiry');
  assert.notEqual(start, -1, 'formatDispatchTokenExpiry found in public/dispatch.js');
  const end = SRC.indexOf('function showDispatchTokenModal', start);
  assert.notEqual(end, -1, 'showDispatchTokenModal marks the end of the slice');
  const sandbox = {
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    Date
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC.slice(start, end), sandbox, { filename: 'dispatch.js-token-expiry-slice' });
  return sandbox;
}

const NOW = new Date('2026-10-19T12:00:00.000Z');
const FUTURE = '2027-01-17T12:00:00.000Z';
const PAST = '2026-09-01T12:00:00.000Z';
const day = (iso) => new Date(iso).toLocaleDateString();

test('formatDispatchTokenExpiry: null/absent never expires, future expires, past expired', () => {
  const s = makeSandbox();
  assert.equal(s.formatDispatchTokenExpiry(null, NOW), 'never expires');
  assert.equal(s.formatDispatchTokenExpiry(undefined, NOW), 'never expires');
  assert.equal(s.formatDispatchTokenExpiry(FUTURE, NOW), `expires ${day(FUTURE)}`);
  assert.equal(s.formatDispatchTokenExpiry(PAST, NOW), `expired ${day(PAST)}`);
});

test('the mint modal body shows "expires <date>" or "never expires" and still shows the token', () => {
  const s = makeSandbox();
  const withExpiry = s.dispatchTokenModalBody('tok-123', FUTURE);
  assert.ok(withExpiry.includes('tok-123'));
  assert.ok(withExpiry.includes(`expires ${day(FUTURE)}`));
  const forever = s.dispatchTokenModalBody('tok-123', null);
  assert.ok(forever.includes('never expires'));
  assert.ok(forever.includes('Authorization: Bearer'));
});
