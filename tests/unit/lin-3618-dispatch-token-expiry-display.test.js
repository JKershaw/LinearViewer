/**
 * LIN-3618 — the mint modal shows a token's expiry: "never expires" (null/absent),
 * "expires <date>" (future), "expired <date>" (past). The API already returned
 * `expiresAt`; the UI hid it. The key list in Settings › Agent access pins its own
 * expiry text in tests/unit/settings-keys.test.js (LIN-3846 removed the Dispatch
 * page's list and its renderer).
 *
 * `public/dispatch.js` is a native ES module (LIN-4560), so this imports it over the
 * fake DOM (tests/unit/helpers/import-world.js) and drives the expiry helper and the
 * modal-body builder it exports, with common.js's `escapeHtml` stubbed. Until then it
 * ran a vm over a source slice of the classic script.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { importWorld } from './helpers/import-world.js';

let world = null;
afterEach(() => { if (world) world.restore(); world = null; });

async function loadPage() {
  world = importWorld({
    window: {
      escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      addEventListener() {},
    },
  });
  return world.importPage('dispatch.js');
}

const NOW = new Date('2026-10-19T12:00:00.000Z');
const FUTURE = '2027-01-17T12:00:00.000Z';
const PAST = '2026-09-01T12:00:00.000Z';
const day = (iso) => new Date(iso).toLocaleDateString();

test('formatDispatchTokenExpiry: null/absent never expires, future expires, past expired', async () => {
  const s = await loadPage();
  assert.equal(s.formatDispatchTokenExpiry(null, NOW), 'never expires');
  assert.equal(s.formatDispatchTokenExpiry(undefined, NOW), 'never expires');
  assert.equal(s.formatDispatchTokenExpiry(FUTURE, NOW), `expires ${day(FUTURE)}`);
  assert.equal(s.formatDispatchTokenExpiry(PAST, NOW), `expired ${day(PAST)}`);
});

test('the mint modal body shows "expires <date>", "expired <date>" or "never expires" and still shows the token', async () => {
  const s = await loadPage();
  // The clock is pinned (LIN-3949): the modal reads `now`, not the wall clock, so FUTURE stays future.
  const withExpiry = s.dispatchTokenModalBody('tok-123', FUTURE, NOW);
  assert.ok(withExpiry.includes('tok-123'));
  assert.ok(withExpiry.includes(`expires ${day(FUTURE)}`));
  const expired = s.dispatchTokenModalBody('tok-123', PAST, NOW);
  assert.ok(expired.includes(`expired ${day(PAST)}`));
  const forever = s.dispatchTokenModalBody('tok-123', null, NOW);
  assert.ok(forever.includes('never expires'));
  assert.ok(forever.includes('Authorization: Bearer'));
});
