/**
 * LIN-1982 — `selectOwnerWorkspaceToken` (lib/workspace-token-resolver.js)
 * ranked candidates by RAW maximum `tokenExpiresAt`. A sentinel expiry
 * (`Number.MAX_SAFE_INTEGER`, what GitHub-family/Jira-Basic bindings store
 * for "never expires") therefore won selection PERMANENTLY over an
 * actively-refreshed Linear token the instant both existed as candidates for
 * the same (urlKey, ownerAccountId) — unbeatable by a token refresh (a fresh
 * `now+24h` always loses to a fake "never") and unbeatable by reconnecting
 * the workspace. LIN-1981's `linkProvider` mis-mirror is one confirmed way a
 * sentinel lands on a session row that should stay Linear-only.
 *
 * Fix: a finite, real expiry now always outranks a sentinel one, regardless
 * of raw magnitude — a sentinel only wins when it is the sole eligible
 * candidate (the ordinary, correct Local/PAT/Basic-only case).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000; // ~2.8h
const SENTINEL_MS = Number.MAX_SAFE_INTEGER;

function sessionRow(accountId, urlKey, accessToken, expiresAt, provider = 'linear') {
  return { session: { accountId, workspaces: [{ urlKey, provider, accessToken, tokenExpiresAt: expiresAt }] } };
}

describe('selectOwnerWorkspaceToken — finite beats sentinel (LIN-1982)', () => {
  test('a fresh, finite Linear token wins over a co-resident sentinel (Jira Basic) row for the SAME owner — the confirmed defect, fixed', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tok-linear-fresh', NOW + FAR_FUTURE_MS, 'linear'),
      sessionRow('account-A', 'acme', 'tok-jira-sentinel', SENTINEL_MS, 'jira'),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tok-linear-fresh');
    assert.equal(result.provider, 'linear');
    assert.equal(result.reason, 'ok');
  });

  test('order independence: the finite candidate still wins even when the sentinel row is scanned FIRST', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tok-jira-sentinel', SENTINEL_MS, 'jira'),
      sessionRow('account-A', 'acme', 'tok-linear-fresh', NOW + FAR_FUTURE_MS, 'linear'),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tok-linear-fresh');
  });

  test('a sentinel is still selected when it is the ONLY eligible candidate — the ordinary Local/PAT/Basic-only case is unaffected', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tok-local', SENTINEL_MS, 'local'),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tok-local');
    assert.equal(result.provider, 'local');
    assert.equal(result.reason, 'ok');
  });

  test('among TWO finite candidates, the later-expiring one still wins — the pre-existing rule, preserved', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tok-sooner', NOW + FAR_FUTURE_MS, 'linear'),
      sessionRow('account-A', 'acme', 'tok-later', NOW + FAR_FUTURE_MS * 2, 'linear'),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tok-later');
  });

  test('among TWO sentinel candidates (e.g. two never-expiring bindings), selection is stable — first-seen wins on a tie, preserved', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tok-first', SENTINEL_MS, 'jira'),
      sessionRow('account-A', 'acme', 'tok-second', SENTINEL_MS, 'github'),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tok-first', 'a strict > comparison never displaces an exact tie — same behaviour as before this ticket for a same-tier tie');
  });

  test('owner isolation is preserved: a DIFFERENT account\'s finite token never leaks in, even though it would out-rank this owner\'s sentinel by the new rule', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tok-A-sentinel', SENTINEL_MS, 'jira'),
      sessionRow('account-B', 'acme', 'tok-B-fresh', NOW + FAR_FUTURE_MS, 'linear'),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tok-A-sentinel', 'account-A has only the sentinel candidate; account-B\'s finite token is out of scope entirely');
  });

  test('a NEARLY-sentinel but genuinely finite expiry (just under the year-3000 floor) is still treated as finite, not sentinel', () => {
    const almostSentinel = Date.UTC(2999, 11, 31); // one day under the sentinel floor
    const sessions = [
      sessionRow('account-A', 'acme', 'tok-almost-sentinel', almostSentinel, 'linear'),
      sessionRow('account-A', 'acme', 'tok-true-sentinel', SENTINEL_MS, 'jira'),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tok-almost-sentinel', 'below the sentinel floor is finite and wins, exactly like an ordinary token');
  });
});
