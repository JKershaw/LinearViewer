/**
 * LIN-3124 PR1 (G) — selector-family body hashes (T6).
 *
 * The plan's D7/§7 promise the eight selector-family functions in
 * lib/workspace-token-resolver.js have ZERO diff: connection-backed reads are
 * routed AROUND them (D7) rather than editing them, because they carry the
 * LIN-2278/2349/2275/1982 ranking protections and selectOwnerSessionRow is the
 * LIN-2640 surface. Any edit to one of these bodies must fail here, and the
 * owner must update the hash deliberately (and re-justify in review).
 *
 * Goldens were generated at the pre-change SHA (the file is byte-identical
 * across 50588aef..HEAD). Bodies are extracted from the comment-stripped source
 * and hashed with sha256.
 *
 * LIN-2389: five bodies (selectOwnerWorkspaceToken, selectExpiredOwnerRow,
 * selectOwnerSessionRow, selectAllOwnerSessionRows, selectOwnerWorkspaceRow) were
 * re-baselined for the finder-only swap `data?.workspaces?.find(w => w.urlKey === urlKey)`
 * -> `findWorkspaceByUrlKey(data?.workspaces, urlKey)` (and findIndex likewise).
 * No ranking, filter, or loop line changed.
 *
 * SHA-256 of the exact extracted body text. Run with:
 *   node --test tests/unit/lin-3124-selector-body-hashes.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadStrippedSources, extractFunction, sha256 } from '../fixtures/connection-access-guards.js';

const RESOLVER = 'lib/workspace-token-resolver.js';

const EXPECTED = {
  findActiveInstallationId: '0915d5358c930e778d683f86e4fd7cd9380dc5c9a308f75419cc1ece104ed9d8',
  isSentinelExpiry: '23f844f9e9e0ea4be01e4da766dc45b7ad84bc4c86c57186f2bce274c2ddfad1',
  isBetterCandidate: 'd706cebe6982379914d4bc7c67e43c9323c95c4b6fe7a7b9ecee8adbcc1acf32',
  selectOwnerWorkspaceToken: 'b018341ce504d02d3258124fc0c96618b22e7b4af50dff8555e5305e5012a056',
  selectExpiredOwnerRow: '2d4f9ef4d148c1bba3e5bd743ea06424fa0b1ccd64806132d60798a514649dab',
  selectOwnerSessionRow: '6a627e7bf7c651a00fc940f0ecf9a3adb362243bd24e8ffa9892b1ac1073d189',
  selectAllOwnerSessionRows: 'f74645969e00277b6ccfb4fc4e97a91f59b3e979971e36c89198a13f12c0f54e',
  selectOwnerWorkspaceRow: '47107bcf38358d0530cd6a7ed3d5f25e0fa12904be95cbcd14e3569b293bb6df',
};

describe('LIN-3124 PR1 T6 — selector-family body hashes (zero diff)', () => {
  const source = loadStrippedSources().get(RESOLVER);

  test('the resolver is present', () => {
    assert.ok(source, `expected ${RESOLVER} in the source corpus`);
  });

  for (const [name, expected] of Object.entries(EXPECTED)) {
    test(`${name} body is byte-identical`, () => {
      const body = extractFunction(source, name);
      assert.ok(body, `expected to extract ${name}`);
      assert.equal(sha256(body), expected,
        `${name} changed. D7 promises the selector family has zero diff — connection-backed reads are routed around ` +
        'it (LIN-2640: selectOwnerSessionRow must not gain a provider filter). If the change is deliberate, update ' +
        'this hash and re-justify in review.');
    });
  }

  test('planted: a one-character edit changes the hash and fails', () => {
    const body = extractFunction(source, 'selectOwnerSessionRow');
    assert.notEqual(sha256(body.replace('{', '{ ')), EXPECTED.selectOwnerSessionRow);
  });
});
