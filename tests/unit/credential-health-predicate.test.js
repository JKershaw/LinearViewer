/**
 * Unit tests for the credential-health predicate (LIN-1586, Beat 1 of LIN-1577)
 *
 * Run with: node --test tests/unit/credential-health-predicate.test.js
 *
 * The fault this names: a dispatched worker whose workspace-scoped calls all
 * 503 with `token_ownerless` while its workspace-FREE calls keep succeeding.
 * Workspace health reports OK the whole time, because from the workspace's
 * point of view nothing is wrong — the credential is.
 *
 * The predicate is pure and folds already-projected rows, so every edge below
 * is provable without a collection, a clock, or a route.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { foldCredentialHealth, OWNERLESS_NOTE, CREDENTIAL_HEALTH_WINDOW_MS } from '../../lib/proxy-events.js';

const NOW = new Date('2026-07-25T12:00:00.000Z').getTime();
const SINCE = NOW - CREDENTIAL_HEALTH_WINDOW_MS;

// Minutes before NOW, as the store hands them over (a Date on the row).
const minsAgo = (n) => new Date(NOW - n * 60 * 1000);

function row({ tokenId = 'tok-1', tokenLabel = 'worker', status = 200, note = null, at = 1 } = {}) {
  return { tokenId, tokenLabel, status, note, timestamp: minsAgo(at) };
}

const fold = (rows) => foldCredentialHealth(rows, { since: SINCE });
const verdictFor = (rows, tokenId = 'tok-1') =>
  fold(rows).find(t => t.tokenId === tokenId)?.verdict;

describe('credential-health predicate (LIN-1586)', () => {
  test('the reason token is consumed unchanged, never redefined here', () => {
    // lib/workspace-token-resolver.js owns this vocabulary; Beat 1 only reads it.
    assert.strictEqual(OWNERLESS_NOTE, 'token_ownerless');
  });

  test('ownerless notes alone are NOT credential-dead', () => {
    // No successes in the window means no evidence the worker is still alive —
    // an idle or revoked token looks exactly like this, and re-issuing it is
    // not the answer.
    const rows = [
      row({ status: 503, note: OWNERLESS_NOTE, at: 2 }),
      row({ status: 503, note: OWNERLESS_NOTE, at: 3 })
    ];
    assert.strictEqual(verdictFor(rows), 'ok');
  });

  test('successes alone are NOT credential-dead', () => {
    const rows = [row({ status: 200, at: 2 }), row({ status: 200, at: 3 })];
    assert.strictEqual(verdictFor(rows), 'ok');
  });

  test('an ownerless note AND a success inside the window IS credential-dead', () => {
    // The signature of the LIN-1577 fault: still working, uniformly refused.
    const rows = [
      row({ status: 200, at: 2 }),
      row({ status: 503, note: OWNERLESS_NOTE, at: 3 })
    ];
    const [entry] = fold(rows);
    assert.strictEqual(entry.verdict, 'credential_dead');
    assert.strictEqual(entry.ownerlessCount, 1);
    assert.strictEqual(entry.okCount, 1);
    assert.strictEqual(entry.tokenLabel, 'worker');
  });

  test('halves straddling the window edge are NOT credential-dead', () => {
    // The success is inside the window, the ownerless note is older than it.
    // Two facts that never held at the same time are not a live fault.
    const windowMins = CREDENTIAL_HEALTH_WINDOW_MS / 60000;
    const rows = [
      row({ status: 200, at: 1 }),
      row({ status: 503, note: OWNERLESS_NOTE, at: windowMins + 5 })
    ];
    assert.strictEqual(verdictFor(rows), 'ok');

    // ...and symmetrically with the halves swapped.
    const swapped = [
      row({ status: 503, note: OWNERLESS_NOTE, at: 1 }),
      row({ status: 200, at: windowMins + 5 })
    ];
    assert.strictEqual(verdictFor(swapped), 'ok');
  });

  test('a row exactly ON the window boundary is excluded (the bound is exclusive)', () => {
    // Mirrors the query's `timestamp: { $gt: since }` — the JS fold must not
    // disagree with the read that feeds it.
    const rows = [
      row({ status: 200, at: 1 }),
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 503, note: OWNERLESS_NOTE, timestamp: new Date(SINCE) }
    ];
    assert.strictEqual(verdictFor(rows), 'ok');
  });

  test("LIN-961's English-sentence note does NOT match (exact equality, never includes)", () => {
    // `note` is free text. Its other writer emits a whole sentence; a fuzzy
    // match would eventually classify some future breadcrumb as this fault.
    const rows = [
      row({ status: 200, at: 2 }),
      row({ status: 200, note: 'free-tier fallback: no paid/OAuth key resolved', at: 3 })
    ];
    assert.strictEqual(verdictFor(rows), 'ok');
  });

  test('a note that merely CONTAINS the reason token does not match either', () => {
    const rows = [
      row({ status: 200, at: 2 }),
      row({ status: 503, note: `workspace unavailable: ${OWNERLESS_NOTE} (retryable)`, at: 3 })
    ];
    assert.strictEqual(verdictFor(rows), 'ok');
  });

  test('a 201 counts as the success half — not just 200', () => {
    // POST /agent/status and POST /dispatch log 201 and resolve no workspace:
    // for a dispatched worker they are the most common surviving call. Keying
    // on `status === 200` would miss the very sessions this is built to find.
    const rows = [
      row({ status: 201, endpoint: '/api/proxy/agent/status', at: 2 }),
      row({ status: 503, note: OWNERLESS_NOTE, at: 3 })
    ];
    assert.strictEqual(verdictFor(rows), 'credential_dead');
  });

  test('a 3xx counts as the success half; 4xx and 5xx do not', () => {
    assert.strictEqual(
      verdictFor([row({ status: 304, at: 2 }), row({ status: 503, note: OWNERLESS_NOTE, at: 3 })]),
      'credential_dead'
    );
    assert.strictEqual(
      verdictFor([row({ status: 404, at: 2 }), row({ status: 503, note: OWNERLESS_NOTE, at: 3 })]),
      'ok'
    );
  });

  test('503 alone is not the key — an ownerless 503 among plain 503s is what decides', () => {
    // 24 logEvent(…, 503) call sites at HEAD; exactly one passes this note.
    const noteless = [
      row({ status: 503, at: 1 }),
      row({ status: 503, at: 2 }),
      row({ status: 200, at: 3 })
    ];
    assert.strictEqual(verdictFor(noteless), 'ok');

    const withNote = [...noteless, row({ status: 503, note: OWNERLESS_NOTE, at: 4 })];
    assert.strictEqual(verdictFor(withNote), 'credential_dead');
  });

  test('the fold is per-token: one dead credential does not condemn its neighbours', () => {
    const rows = [
      row({ tokenId: 'dead', tokenLabel: 'worker-a', status: 201, at: 1 }),
      row({ tokenId: 'dead', tokenLabel: 'worker-a', status: 503, note: OWNERLESS_NOTE, at: 2 }),
      row({ tokenId: 'live', tokenLabel: 'worker-b', status: 200, at: 1 })
    ];
    const byId = Object.fromEntries(fold(rows).map(t => [t.tokenId, t]));
    assert.strictEqual(byId.dead.verdict, 'credential_dead');
    assert.strictEqual(byId.live.verdict, 'ok');
    assert.strictEqual(byId.dead.ownerlessCount, 1);
    assert.strictEqual(byId.live.ownerlessCount, 0);
  });

  test('rows with no tokenId are skipped — credential health needs a credential', () => {
    const rows = [
      { tokenId: null, tokenLabel: null, status: 200, note: null, timestamp: minsAgo(1) },
      { tokenId: null, tokenLabel: null, status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(2) }
    ];
    assert.deepStrictEqual(fold(rows), []);
  });

  test('legacy rows with no note field at all fold as note-free', () => {
    const rows = [
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 200, timestamp: minsAgo(1) },
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 503, timestamp: minsAgo(2) }
    ];
    const [entry] = fold(rows);
    assert.strictEqual(entry.ownerlessCount, 0);
    assert.strictEqual(entry.verdict, 'ok');
  });

  test('unreadable and missing timestamps are dropped, not counted at the epoch', () => {
    const rows = [
      row({ status: 200, at: 1 }),
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 503, note: OWNERLESS_NOTE, timestamp: 'not-a-date' },
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 503, note: OWNERLESS_NOTE, timestamp: null }
    ];
    assert.strictEqual(verdictFor(rows), 'ok');
  });

  test('ISO-string timestamps read the same as Date timestamps', () => {
    const rows = [
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 201, note: null, timestamp: minsAgo(2).toISOString() },
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(3).toISOString() }
    ];
    assert.strictEqual(verdictFor(rows), 'credential_dead');
  });

  test('a relabelled token keeps a label rather than blanking it', () => {
    const rows = [
      row({ tokenLabel: 'worker-old', status: 200, at: 3 }),
      { tokenId: 'tok-1', tokenLabel: null, status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(2) }
    ];
    const [entry] = fold(rows);
    assert.strictEqual(entry.tokenLabel, 'worker-old');
    assert.strictEqual(entry.verdict, 'credential_dead');
  });

  test('empty and absent input fold to nothing, never throw', () => {
    assert.deepStrictEqual(fold([]), []);
    assert.deepStrictEqual(fold(null), []);
    assert.deepStrictEqual(fold([null, undefined]), []);
  });

  test('the verdict carries no account id — it is a verdict, not an owner', () => {
    const rows = [
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 200, note: null, timestamp: minsAgo(1), createdBy: 'account-A' },
      { tokenId: 'tok-1', tokenLabel: 'worker', status: 503, note: OWNERLESS_NOTE, timestamp: minsAgo(2), createdBy: 'account-A' }
    ];
    const blob = JSON.stringify(fold(rows));
    assert.ok(!blob.includes('account-A'), `fold must not carry the owner id: ${blob}`);
  });

  test('the default window is 15 minutes', () => {
    assert.strictEqual(CREDENTIAL_HEALTH_WINDOW_MS, 15 * 60 * 1000);
  });
});
