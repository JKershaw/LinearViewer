/**
 * LIN-3124 PR2 — F2: the D15 raw-credential census, from an explicit query.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-credential-census.test.js
 *
 * WRITER census — `workspace.credentials` writes and its delete in
 * lib/workspace.js (the second workspace-level mirror, D15).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { loadStrippedSources } from '../fixtures/connection-access-guards.js';

const D15_WORKSPACE_MIRROR_WRITER_CENSUS = 5;

function workspaceMirrorWriterLines(sources) {
  const src = sources.get('lib/workspace.js') || '';
  const writes = (src.match(/workspace\.credentials\s*=/g) || []).length;
  const deletes = (src.match(/delete\s+workspace\.credentials/g) || []).length;
  return writes + deletes;
}

describe('LIN-3124 PR2 — D15 raw-credential census (explicit query)', () => {
  const REAL = loadStrippedSources();

  test(`workspace.credentials writes/deletes in lib/workspace.js = ${D15_WORKSPACE_MIRROR_WRITER_CENSUS}`, () => {
    assert.strictEqual(workspaceMirrorWriterLines(REAL), D15_WORKSPACE_MIRROR_WRITER_CENSUS);
    const planted = new Map(REAL);
    planted.set('lib/workspace.js', `${REAL.get('lib/workspace.js')}\nworkspace.credentials = { token: leak };\n`);
    assert.strictEqual(workspaceMirrorWriterLines(planted), D15_WORKSPACE_MIRROR_WRITER_CENSUS + 1);
  });

  test('the two review-named readers are present: resolver legacy-only + workspace D1-served', () => {
    const resolver = REAL.get('lib/workspace-token-resolver.js');
    assert.match(resolver, /\.credentials\?\.installationId/, 'findActiveInstallationId (resolver:62)');
    const workspace = REAL.get('lib/workspace.js');
    // LIN-3124 PR3: getWorkspaceCallScope's Jira projection is a D1 accessor
    // body, now served from the binding/workspace accessor (side-table eligible)
    // instead of a raw `binding.credentials` read.
    assert.match(workspace, /const activeCreds = getBindingCredentials\(active\)/);
    assert.match(workspace, /activeCreds\?\.authType === 'oauth'/);
    assert.match(workspace, /activeCreds\?\.cloudId/);
    assert.match(workspace, /activeCreds\?\.email/);
    assert.match(workspace, /export function getBindingCredentials\(binding\)/);
  });

  // B4/R21 — the account-merge lifecycle wiring is pinned.
  test('B4/R21: exactly one onAccountMerged( call in routes/account-merge.js, after mergeAccounts(', () => {
    const mergeWiringCount = (sources) => {
      const src = sources.get('routes/account-merge.js') || '';
      return (src.match(/onAccountMerged\s*\(/g) || []).length;
    };
    assert.strictEqual(mergeWiringCount(REAL), 1, 'the merge must call onAccountMerged exactly once');
    const src = REAL.get('routes/account-merge.js');
    assert.ok(
      src.indexOf('onAccountMerged(') > src.indexOf('mergeAccounts('),
      'onAccountMerged must run AFTER mergeAccounts'
    );

    const dropped = new Map(REAL);
    dropped.set('routes/account-merge.js', src.replace(/await onAccountMerged\(/, 'await noop('));
    assert.strictEqual(mergeWiringCount(dropped), 0, 'the planted drop must be caught');
  });
});
