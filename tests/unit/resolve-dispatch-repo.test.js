/**
 * LIN-1210 — repo precedence on cross-project child dispatch.
 *
 * `resolveDispatchRepo(callerRepo, derivedRepo, { inherited })` is the single
 * seam both `/api/proxy/recommend-and-dispatch` precedence sites use (the
 * verb-override branch and the recommendation-descent branch). It orders a
 * caller-supplied repo against the server-derived repo:
 *
 *   - LIN-537 invariant (default, `inherited` false/absent): a user-explicit
 *     caller repo always wins; an omitted one falls back to the derived repo.
 *     Byte-for-byte the old `callerRepo || derivedRepo || null`.
 *   - LIN-1210 fix (`inherited: true`): when the caller's repo was merely
 *     inherited (e.g. an orchestrator forwarding a parent project's repo onto a
 *     cross-project child fan-out), the derived child/node repo wins over it —
 *     but still falls back to the inherited repo when the child has none.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDispatchRepo } from '../../lib/prompt-formatters.js';

test('LIN-537 invariant: a user-explicit caller repo always wins over the derived repo', () => {
  // Default (no marker) and explicit-inherited-false both keep LIN-537.
  assert.equal(resolveDispatchRepo('caller-repo', 'derived-repo'), 'caller-repo');
  assert.equal(resolveDispatchRepo('caller-repo', 'derived-repo', { inherited: false }), 'caller-repo');
});

test('LIN-537 invariant: an omitted caller repo falls back to the derived repo', () => {
  assert.equal(resolveDispatchRepo(undefined, 'derived-repo'), 'derived-repo');
  assert.equal(resolveDispatchRepo(null, 'derived-repo'), 'derived-repo');
  assert.equal(resolveDispatchRepo('', 'derived-repo'), 'derived-repo');
});

test('LIN-1210: on an inherited caller repo, a DIFFERENT child/derived repo wins (cross-project descent)', () => {
  // The core bug: parent project repo=alpha inherited onto a child in a
  // different project whose repo=beta. The child (derived) repo must win so the
  // worker runs in the child's codebase, not the parent's.
  assert.equal(resolveDispatchRepo('alpha', 'beta', { inherited: true }), 'beta');
});

test('LIN-1210: a repo-less child falls back to the inherited caller repo (unchanged)', () => {
  // Same-context repo-less child: derived repo is null, so the inherited repo is
  // still used — a repo-less child stays byte-for-byte unchanged.
  assert.equal(resolveDispatchRepo('alpha', null, { inherited: true }), 'alpha');
  assert.equal(resolveDispatchRepo('alpha', undefined, { inherited: true }), 'alpha');
  assert.equal(resolveDispatchRepo('alpha', '', { inherited: true }), 'alpha');
});

test('LIN-1210: a same-repo descent is unaffected by the inherited marker', () => {
  // Same-project descent: derived repo equals the inherited repo, so the result
  // is identical with or without the marker.
  assert.equal(resolveDispatchRepo('alpha', 'alpha', { inherited: true }), 'alpha');
  assert.equal(resolveDispatchRepo('alpha', 'alpha', { inherited: false }), 'alpha');
});

test('returns null when neither a caller nor a derived repo is present', () => {
  assert.equal(resolveDispatchRepo(undefined, undefined), null);
  assert.equal(resolveDispatchRepo(null, null, { inherited: true }), null);
  assert.equal(resolveDispatchRepo('', '', { inherited: true }), null);
});
