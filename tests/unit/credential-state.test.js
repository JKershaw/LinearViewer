/**
 * Unit tests for the per-session credential DISPLAY state (LIN-1588, Beat 2 of
 * LIN-1577).
 *
 * `lib/credential-state.js` is not the credential rule — that is Beat 1's
 * `credentialVerdict` (tested in credential-health-predicate.test.js) and it is
 * reused by calling it. What is tested here is the step downstream: turning
 * `(agentTokenId, verdict index)` into the three-state value the Live Console
 * lane and the session page render.
 *
 * The load-bearing assertions are the `unknown` ones. Per LIN-1585 ~99.86% of
 * dispatches have no joinable agent-status row, so a null token is the ORDINARY
 * case — and "no evidence" must never resolve to `ok`, on either surface.
 *
 * Run with: node --test tests/unit/credential-state.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCredentialState,
  foldCredentialIndex,
  collectAgentTokenIds,
  CREDENTIAL_DEAD_VERDICT,
} from '../../lib/credential-state.js';

describe('resolveCredentialState (LIN-1588)', () => {
  test('a null token id is `unknown` — the ordinary case, not an edge case', () => {
    assert.strictEqual(resolveCredentialState(null, {}), 'unknown');
    assert.strictEqual(resolveCredentialState(undefined, {}), 'unknown');
    assert.strictEqual(resolveCredentialState('', {}), 'unknown');
  });

  test('a null token id stays `unknown` even when the index has verdicts', () => {
    assert.strictEqual(resolveCredentialState(null, { 'tok-1': 'ok' }), 'unknown');
  });

  test('a token ABSENT from the index is `unknown`, never a false `ok`', () => {
    // No recent events ⇒ no evidence ⇒ no verdict. This is the invariant the
    // ticket states: absence of death evidence is not health.
    assert.strictEqual(resolveCredentialState('tok-unseen', { 'tok-other': 'ok' }), 'unknown');
  });

  test('verdict credential_dead → dead', () => {
    assert.strictEqual(resolveCredentialState('tok-1', { 'tok-1': CREDENTIAL_DEAD_VERDICT }), 'dead');
    assert.strictEqual(resolveCredentialState('tok-1', { 'tok-1': 'credential_dead' }), 'dead');
  });

  test('verdict ok → ok', () => {
    assert.strictEqual(resolveCredentialState('tok-1', { 'tok-1': 'ok' }), 'ok');
  });

  test('an unrecognised verdict falls to `unknown`, never `ok`', () => {
    // Defensive: if Beat 1 ever grows a third verdict, this surface reports
    // "no answer" rather than inventing a healthy one.
    assert.strictEqual(resolveCredentialState('tok-1', { 'tok-1': 'degraded' }), 'unknown');
    assert.strictEqual(resolveCredentialState('tok-1', { 'tok-1': null }), 'unknown');
  });

  test('tolerates a missing index entirely', () => {
    assert.strictEqual(resolveCredentialState('tok-1'), 'unknown');
    assert.strictEqual(resolveCredentialState('tok-1', null), 'unknown');
  });

  test('an inherited Object.prototype key is not mistaken for a verdict', () => {
    // `{}` has a `constructor`; a naive `index[id]` truthiness check would read
    // it as a verdict for a token literally named "constructor".
    assert.strictEqual(resolveCredentialState('constructor', {}), 'unknown');
    assert.strictEqual(resolveCredentialState('toString', {}), 'unknown');
  });
});

describe('foldCredentialIndex (LIN-1588)', () => {
  test('folds Beat 1 token rows into a tokenId → verdict index', () => {
    const index = foldCredentialIndex([
      { tokenId: 'a', verdict: 'ok' },
      { tokenId: 'b', verdict: 'credential_dead' },
    ]);
    assert.deepEqual(index, { a: 'ok', b: 'credential_dead' });
  });

  test('rows with no tokenId are skipped', () => {
    assert.deepEqual(foldCredentialIndex([{ tokenId: null, verdict: 'ok' }, null, undefined]), {});
  });

  test('on a duplicate tokenId, credential_dead wins regardless of order', () => {
    // A missed death is a triage miss; a fabricated `ok` is the false-healthy
    // reading this ticket exists to prevent — so the collision resolves one way.
    assert.deepEqual(
      foldCredentialIndex([{ tokenId: 'a', verdict: 'credential_dead' }, { tokenId: 'a', verdict: 'ok' }]),
      { a: 'credential_dead' }
    );
    assert.deepEqual(
      foldCredentialIndex([{ tokenId: 'a', verdict: 'ok' }, { tokenId: 'a', verdict: 'credential_dead' }]),
      { a: 'credential_dead' }
    );
  });

  test('tolerates a non-array input', () => {
    assert.deepEqual(foldCredentialIndex(null), {});
    assert.deepEqual(foldCredentialIndex(undefined), {});
  });
});

describe('collectAgentTokenIds (LIN-1588)', () => {
  test('collects distinct non-null token ids', () => {
    const ids = collectAgentTokenIds([
      { agentTokenId: 'a' }, { agentTokenId: 'b' }, { agentTokenId: 'a' }, { agentTokenId: null },
    ]);
    assert.deepEqual([...ids].sort(), ['a', 'b']);
  });

  test('an all-null set is EMPTY — this is what short-circuits the credential read', () => {
    // The ~99.86% path (LIN-1585). An empty set is the signal both routes use to
    // skip the read entirely and keep their cost contracts unchanged.
    assert.strictEqual(collectAgentTokenIds([{ agentTokenId: null }, { agentTokenId: undefined }]).size, 0);
    assert.strictEqual(collectAgentTokenIds([]).size, 0);
    assert.strictEqual(collectAgentTokenIds(null).size, 0);
  });

  test('honours an optional per-loop filter', () => {
    const loops = [
      { agentTokenId: 'live', agentState: 'running' },
      { agentTokenId: 'finished', agentState: 'complete' },
    ];
    const ids = collectAgentTokenIds(loops, lp => lp.agentState === 'running');
    assert.deepEqual([...ids], ['live']);
  });
});
