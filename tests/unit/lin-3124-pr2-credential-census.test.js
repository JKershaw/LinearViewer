/**
 * LIN-3124 PR2 — F2: the D15 raw-credential census, from an explicit query.
 *
 * Run with: node --test tests/unit/lin-3124-pr2-credential-census.test.js
 *
 * The reviews carried a D15 pin whose historical count was 24, corrected to 22
 * (Plan Review Verdict 71050cc5 non-blocking 3 -> 3b83f17c non-blocking 1),
 * naming two extra readers: `lib/workspace-token-resolver.js:62`
 * (`findActiveInstallationId`) and `lib/workspace.js:782-785` (the Jira
 * projection of `getWorkspaceCallScope`). Because that count is only meaningful
 * against an explicitly stated query, this file OWNS the query and its count on
 * the PR2 tree, and pins both:
 *
 *   READ census — comment-stripped `lib/`, `routes/`, `server.js`; a line
 *   matching /\.credentials([^a-zA-Z_]|$)/ that is NOT a write
 *   (/\.credentials\s*=/), excluding the modules owned by other D15 sub-classes:
 *   account identities (lib/account-store.js), the connection seam
 *   (lib/connection-*.js) and the GitHub-family `refreshCredential` reads
 *   (lib/providers/github/index.js, github-projects), plus the test fixture
 *   (routes/test.js).
 *
 *   WRITER census — `workspace.credentials` writes and its delete in
 *   lib/workspace.js (the second workspace-level mirror, D15).
 *
 * These are counts, not hashes: PR3's read cutover will change the READ census
 * (several raw reads convert to accessors), and the failure here is the signal
 * to re-state the query and its new value.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { loadStrippedSources } from '../fixtures/connection-access-guards.js';

const D15_READ_CENSUS = 24;
const D15_WORKSPACE_MIRROR_WRITER_CENSUS = 4;

// Files whose `.credentials` occurrences belong to a different D15 sub-class.
const D15_EXCLUDED_FILES = new Set([
  'lib/account-store.js',        // account identities
  'lib/connection-store.js',     // legacy dual-write
  'lib/connection-credential.js',// the connection seam
  'lib/connection-binding.js',   // the connection seam
  'lib/connection-lifecycle.js', // the connection seam
  'routes/test.js',              // test fixture
  'lib/providers/github/index.js',          // refreshCredential reads
  'lib/providers/github-projects/index.js', // refreshCredential reads
]);

const CREDENTIAL = /\.credentials([^a-zA-Z_]|$)/;
const CREDENTIAL_WRITE = /\.credentials\s*=/;

function rawCredentialReadLines(sources) {
  let count = 0;
  for (const [rel, src] of sources) {
    if (D15_EXCLUDED_FILES.has(rel)) continue;
    for (const line of src.split('\n')) {
      if (CREDENTIAL.test(line) && !CREDENTIAL_WRITE.test(line)) count++;
    }
  }
  return count;
}

function workspaceMirrorWriterLines(sources) {
  const src = sources.get('lib/workspace.js') || '';
  const writes = (src.match(/workspace\.credentials\s*=/g) || []).length;
  const deletes = (src.match(/delete\s+workspace\.credentials/g) || []).length;
  return writes + deletes;
}

describe('LIN-3124 PR2 — D15 raw-credential census (explicit query)', () => {
  const REAL = loadStrippedSources();

  test(`raw .credentials reads outside the other D15 sub-classes = ${D15_READ_CENSUS}`, () => {
    assert.strictEqual(rawCredentialReadLines(REAL), D15_READ_CENSUS,
      're-state the query and its value if PR3 converted a raw read');
  });

  test('planted: a new raw .credentials read is caught (+1 / −1)', () => {
    const plus = new Map(REAL);
    plus.set('lib/workspace.js', `${REAL.get('lib/workspace.js')}\nconst leak = binding.credentials.token;\n`);
    assert.strictEqual(rawCredentialReadLines(plus), D15_READ_CENSUS + 1);

    const minus = new Map(REAL);
    minus.set('lib/workspace.js', REAL.get('lib/workspace.js').replace('return match?.credentials?.token;', 'return match;'));
    assert.strictEqual(rawCredentialReadLines(minus), D15_READ_CENSUS - 1);
  });

  test(`workspace.credentials writes/deletes in lib/workspace.js = ${D15_WORKSPACE_MIRROR_WRITER_CENSUS}`, () => {
    assert.strictEqual(workspaceMirrorWriterLines(REAL), D15_WORKSPACE_MIRROR_WRITER_CENSUS);
    const planted = new Map(REAL);
    planted.set('lib/workspace.js', `${REAL.get('lib/workspace.js')}\nworkspace.credentials = { token: leak };\n`);
    assert.strictEqual(workspaceMirrorWriterLines(planted), D15_WORKSPACE_MIRROR_WRITER_CENSUS + 1);
  });

  test('the two review-named readers are present and unedited', () => {
    const resolver = REAL.get('lib/workspace-token-resolver.js');
    assert.match(resolver, /\.credentials\?\.installationId/, 'findActiveInstallationId (resolver:62)');
    const workspace = REAL.get('lib/workspace.js');
    // getWorkspaceCallScope's Jira projection (the D1 accessor body)
    assert.match(workspace, /binding\.credentials\?\.authType === 'oauth'/);
    assert.match(workspace, /binding\.credentials\?\.cloudId/);
    assert.match(workspace, /binding\.credentials\?\.email/);
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
