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
  selectOwnerWorkspaceToken: 'ac9af47ba418b9701bc2992842d64a7b83e39d639761e9fda2565005619597ab',
  selectExpiredOwnerRow: 'dac05941845c24726564cf855abe97370ea5b9275d0e62b2e15a88cbb65a8543',
  selectOwnerSessionRow: '6172020832b5923851c333624a1939a3b7fae589f29fe4653d36fd681d605659',
  selectAllOwnerSessionRows: '1cc7841a541f5f12cd5be90c977e9b70f8374bd4aed146dbc708a6ab323758bc',
  selectOwnerWorkspaceRow: 'c3cb443a50b8988673d83d09205a638b7bcb34295cde557c77fea89c1e52e784',
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
