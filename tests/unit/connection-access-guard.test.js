/**
 * LIN-3124 PR1 (G) — D6 connection-access guard suite (T4).
 *
 * Replaces `tests/unit/connection-store-no-read-switch.test.js` (retired) by
 * SUBSUMING all four of its arms and adding the D6 additions. Every arm is a
 * pure `check(sources) -> offenders` with a registered planted offender that
 * MUST fail it, plus a meta-test that fails if any arm lacks one.
 *
 * Mapping to the retired file's assertions:
 *   (a) only allow-listed modules import the store   -> arm a1 (exact)
 *   (b) no non-test source calls connectionStore.get -> arm b′ (LEGACY_CONNECTION_GET)
 *   (c) protected modules import nothing             -> arm c
 *   (d) no provider index.js imports the store       -> arm d
 *
 * Run with: node --test tests/unit/connection-access-guard.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStore } from '../../lib/connection-store.js';
import {
  loadRawSources,
  loadStrippedSources,
  stripComments,
  importerOffenders,
  readUsageOffenders,
  protectedImportOffenders,
  providerIndexImportOffenders,
  wiringOffenders,
  siblingCallOffenders,
  registryOffenders,
} from '../fixtures/connection-access-guards.js';

// ---------------------------------------------------------------------------
// Allow-lists / protected set (the D6 declarations)
// ---------------------------------------------------------------------------

const STORE_ALLOWED_IMPORTERS = [
  'server.js',
  'routes/auth.js',
  'routes/account-merge.js',
  'lib/github-install-flow.js',
  'routes/jira-auth.js',
];
// Declared for the PR2 modules; enforced as allow-lists now (the modules do
// not exist in PR1, so their importer set is empty and no file may add one).
const CREDENTIAL_ALLOWED_IMPORTERS = ['server.js'];
const LIFECYCLE_ALLOWED_IMPORTERS = ['server.js', 'lib/connection-credential.js'];
const READ_ALLOWED_MODULES = ['lib/connection-store.js', 'lib/connection-credential.js', 'lib/connection-lifecycle.js'];

const PROTECTED_MODULES = [
  'lib/workspace-token-resolver.js',
  'lib/workspace-token-refresh.js',
  'lib/credential-invariant-sweep.js',
  'routes/workspace-api.js',
  'lib/workspace.js',
  'lib/workspace-title-resolver.js',
  'lib/suspect-credential-refresh.js',
  'lib/refresh-on-resolve-gate.js',
];

const SIBLING_WRITES = [
  'putByConnection',
  'putIfRefreshTokenByConnection',
  'markSpendIntentByConnection',
  'clearSpendIntentByConnection',
];

const REAL = loadStrippedSources();
const RAW = loadRawSources();

// ---------------------------------------------------------------------------
// Synthetic-source helpers
// ---------------------------------------------------------------------------

function withFile(sources, rel, src) {
  const m = new Map(sources);
  m.set(rel, src);
  return m;
}

const STORE_IMPORT = "import { writeConnection } from '../lib/connection-store.js';\n";
const CRED_IMPORT = "import { x } from '../lib/connection-credential.js';\n";
const LIFECYCLE_IMPORT = "import { x } from '../lib/connection-lifecycle.js';\n";

// ---------------------------------------------------------------------------
// Source arms (pure `check(sources) -> offenders` + planted offender)
// ---------------------------------------------------------------------------

const SOURCE_ARMS = [
  {
    id: 'a1',
    name: 'connection-store.js importers are EXACTLY the allow-list',
    check: (s) => importerOffenders(s, 'lib/connection-store.js', STORE_ALLOWED_IMPORTERS, { exact: true }),
    planted: withFile(REAL, 'lib/evil-importer.js', STORE_IMPORT),
    plantedNote: 'an extra importer (also fails for a dropped allow-listed importer)',
  },
  {
    id: 'a2',
    name: 'connection-credential.js importers stay within the allow-list',
    check: (s) => importerOffenders(s, 'lib/connection-credential.js', CREDENTIAL_ALLOWED_IMPORTERS),
    planted: withFile(REAL, 'lib/evil-importer.js', CRED_IMPORT),
    plantedNote: 'an importer outside the allow-list',
  },
  {
    id: 'a3',
    name: 'connection-lifecycle.js importers stay within the allow-list',
    check: (s) => importerOffenders(s, 'lib/connection-lifecycle.js', LIFECYCLE_ALLOWED_IMPORTERS),
    planted: withFile(REAL, 'lib/evil-importer.js', LIFECYCLE_IMPORT),
    plantedNote: 'an importer outside the allow-list',
  },
  {
    id: 'b1',
    name: 'readConnection* identifiers live only in the reader modules',
    check: (s) => readUsageOffenders(s, READ_ALLOWED_MODULES),
    planted: withFile(REAL, 'routes/workspace-api.js', `${REAL.get('routes/workspace-api.js')}\nconnectionStore.readConnectionById('x');\n`),
    plantedNote: 'a read call in a protected route module',
  },
  {
    id: 'b2',
    name: 'no legacy connectionStore.get( anywhere (the retired arm b)',
    check: (s) => readUsageOffenders(s, READ_ALLOWED_MODULES),
    planted: withFile(REAL, 'server.js', `${REAL.get('server.js')}\nconnectionStore.get('a', 'b', 'c');\n`),
    plantedNote: 'a legacy .get( call',
  },
  {
    id: 'c',
    name: 'the protected modules import none of the three modules',
    check: (s) => protectedImportOffenders(s, PROTECTED_MODULES),
    planted: withFile(REAL, 'lib/workspace.js', `${REAL.get('lib/workspace.js')}\n${CRED_IMPORT}`),
    plantedNote: 'a protected module importing connection-credential.js',
  },
  {
    id: 'd',
    name: 'no provider index.js imports any of the three modules (LIN-675)',
    check: (s) => providerIndexImportOffenders(s),
    planted: withFile(REAL, 'lib/providers/github/index.js', `${REAL.get('lib/providers/github/index.js')}\n${STORE_IMPORT}`),
    plantedNote: 'a provider index importing connection-store.js',
  },
  {
    id: 'e1',
    name: 'connection wiring appears only in server.js',
    check: (s) => wiringOffenders(s),
    planted: withFile(REAL, 'lib/evil-wiring.js', "const c = db.collection('connections');\n"),
    plantedNote: 'connection wiring in another module',
  },
  {
    id: 'e2',
    name: 'new ConnectionStore( is constructed exactly once, in server.js',
    check: (s) => wiringOffenders(s),
    planted: withFile(REAL, 'server.js', `${REAL.get('server.js')}\nconst second = new ConnectionStore({ collection: connectionsCollection });\n`),
    plantedNote: 'a second ConnectionStore construction',
  },
  {
    id: 'f1',
    name: 'copyToConnection / finalizePromotion only from connection-credential.js',
    check: (s) => siblingCallOffenders(s, ['copyToConnection', 'finalizePromotion'], ['lib/connection-credential.js']),
    planted: withFile(REAL, 'server.js', `${REAL.get('server.js')}\nownerCredentialStore.copyToConnection('a', 'b', 'jira', 'c');\n`),
    plantedNote: 'a copyToConnection call outside its single caller',
  },
  {
    id: 'f2',
    name: 'deleteByConnection only from connection-lifecycle.js',
    check: (s) => siblingCallOffenders(s, ['deleteByConnection'], ['lib/connection-lifecycle.js']),
    planted: withFile(REAL, 'server.js', `${REAL.get('server.js')}\nownerCredentialStore.deleteByConnection('c');\n`),
    plantedNote: 'a deleteByConnection call outside lifecycle',
  },
  {
    id: 'f3',
    name: '*ByConnection writes only from connection-credential.js',
    check: (s) => siblingCallOffenders(s, SIBLING_WRITES, ['lib/connection-credential.js']),
    planted: withFile(REAL, 'routes/proxy.js', `${REAL.get('routes/proxy.js')}\nownerCredentialStore.putByConnection('c', {});\n`),
    plantedNote: 'a *ByConnection write outside the seam',
  },
  {
    id: 'f4',
    name: 'the deleted promoteToConnection name appears nowhere',
    check: (s) => siblingCallOffenders(s, ['promoteToConnection'], []),
    planted: withFile(REAL, 'lib/connection-credential.js', '\nstore.promoteToConnection();\n'),
    plantedNote: 'the deleted method name reappearing',
  },
];

describe('LIN-3124 PR1 T4 — D6 source arms', () => {
  for (const arm of SOURCE_ARMS) {
    test(`arm ${arm.id}: ${arm.name}`, () => {
      assert.deepEqual(arm.check(REAL), [], `arm ${arm.id} must be clean on the real corpus`);
      const offenders = arm.check(arm.planted);
      assert.ok(offenders.length > 0,
        `arm ${arm.id} must flag its planted offender (${arm.plantedNote}); got ${JSON.stringify(offenders)}`);
    });
  }

  test('meta: every source arm declares a planted offender that fails it', () => {
    for (const arm of SOURCE_ARMS) {
      assert.ok(arm.planted, `arm ${arm.id} is missing a planted case`);
      assert.ok(arm.check(arm.planted).length > 0, `arm ${arm.id}'s planted case does not fail it`);
    }
  });
});

// ---------------------------------------------------------------------------
// Prototype-reflection registry (every ConnectionStore method classified)
// ---------------------------------------------------------------------------

const METHOD_CLASSES = {
  _id: 'INTERNAL',
  put: 'WRITE',
  readConnectionByParts: 'READ',
};

describe('LIN-3124 PR1 T4 — ConnectionStore method registry', () => {
  const methods = Object.getOwnPropertyNames(ConnectionStore.prototype).filter(n => n !== 'constructor');

  test('every own method is classified READ or WRITE, and the naming law holds', () => {
    assert.deepEqual(registryOffenders(methods, METHOD_CLASSES), []);
  });

  test('the test-only read is renamed to readConnectionByParts and `get` is gone', () => {
    assert.ok(methods.includes('readConnectionByParts'), 'expected the renamed read');
    assert.ok(!methods.includes('get'), 'the ConnectionStore get() must be renamed to the readConnection* law');
  });

  test('planted: an unclassified / misnamed method fails the registry', () => {
    assert.ok(registryOffenders([...methods, 'mysteryMethod'], METHOD_CLASSES).length > 0);
    assert.ok(registryOffenders(['readSomethingElse'], { readSomethingElse: 'READ' }).length > 0);
    assert.ok(registryOffenders(['readMislabeled'], { readMislabeled: 'WRITE' }).length > 0);
  });
});

// ---------------------------------------------------------------------------
// String-aware comment stripper (the "a//b" hole) + independent import count
// ---------------------------------------------------------------------------

// The retired stripper: strips `//` after any non-`:` char, INCLUDING inside a
// string literal — so it hid a real offender that followed `"a//b"` on the line.
const badStrip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function stripperOffenders(stripFn) {
  const offenders = [];
  const commentOnly = '// connectionStore.readConnectionById(\nconst s = "a//b";\n';
  if (stripFn(commentOnly).includes('readConnectionById')) offenders.push('a comment mention survived stripping');
  const hole = 'const s = "a//b"; connectionStore.readConnectionById("x");\n';
  if (!stripFn(hole).includes('readConnectionById')) offenders.push('a real offender after "a//b" was hidden');
  return offenders;
}

describe('LIN-3124 PR1 T4 — string-aware comment stripper', () => {
  test('strips comment-only mentions and keeps a real offender after "a//b"', () => {
    assert.deepEqual(stripperOffenders(stripComments), []);
  });

  test('planted: the retired stripper hides the offender after "a//b"', () => {
    assert.ok(stripperOffenders(badStrip).length > 0,
      'the old stripper must be caught hiding an offender after a string containing //');
  });

  test('corpus self-check: import detection is unchanged by stripping, and matches the known 5', () => {
    const importLine = /^import\b[^\n]*connection-store\.js/m;
    const rawImporters = [...RAW].filter(([, s]) => importLine.test(s)).map(([r]) => r).sort();
    const strippedImporters = [...REAL].filter(([, s]) => importLine.test(s)).map(([r]) => r).sort();
    assert.deepEqual(rawImporters, strippedImporters, 'stripping must not change which files import the store');
    assert.deepEqual(rawImporters, [...STORE_ALLOWED_IMPORTERS].sort(), 'the independent count is the 5 known importers');
  });
});

// ---------------------------------------------------------------------------
// Retired guard's four assertions, subsumed (each old offender still fails)
// ---------------------------------------------------------------------------

describe('LIN-3124 PR1 T4 — retired no-read-switch assertions are subsumed', () => {
  test('(a) a non-allow-listed importer still fails', () => {
    assert.ok(importerOffenders(withFile(REAL, 'lib/evil.js', STORE_IMPORT), 'lib/connection-store.js', STORE_ALLOWED_IMPORTERS, { exact: true }).length > 0);
  });
  test('(b) a connectionStore.get( call still fails', () => {
    assert.ok(readUsageOffenders(withFile(REAL, 'server.js', `${REAL.get('server.js')}\nconnectionStore.get('a','b','c');\n`), READ_ALLOWED_MODULES).length > 0);
  });
  test('(c) a protected module importing the store still fails', () => {
    assert.ok(protectedImportOffenders(withFile(REAL, 'lib/workspace.js', `${REAL.get('lib/workspace.js')}\n${STORE_IMPORT}`), PROTECTED_MODULES).length > 0);
  });
  test('(d) a provider index importing the store still fails', () => {
    assert.ok(providerIndexImportOffenders(withFile(REAL, 'lib/providers/linear/index.js', `${REAL.get('lib/providers/linear/index.js')}\n${STORE_IMPORT}`)).length > 0);
  });
});

// ---------------------------------------------------------------------------
// Decoy lane registry (PR1 static stand-in)
// ---------------------------------------------------------------------------
//
// D6's session-credential rule has a static half (the 5 off-session raw readers,
// pinned in T5) and a behavioural half — a decoy-token test where the raw
// session row carries a decoy accessToken/credentials.token, the Connection
// holds the real one, and every lane must return the real one. In PR1 there is
// no connection-backed read yet, so the behavioural half lands with the read
// cutover (PR3, T18). This registry pins the LANE SET now, so a lane cannot be
// silently dropped before the behavioural test is written.
const DECOY_LANES = [
  { lane: 'browser (active binding)', accessor: 'getWorkspaceCallScope' },
  { lane: 'per-binding: dashboard fan-out', accessor: 'getBindingCallScope' },
  { lane: 'per-binding: resolveIssueBinding', accessor: 'resolveIssueBinding' },
  { lane: 'per-binding: settings probe (3-arg getWorkspaceToken)', accessor: 'getWorkspaceToken' },
  { lane: 'owner-scoped headless', accessor: 'resolveWorkspaceAccess' },
  { lane: 'owner-blind', accessor: 'getWorkspaceAccessToken' },
];

function decoyLaneOffenders(sources) {
  const workspaceSrc = sources.get('lib/workspace.js') || '';
  const serverSrc = sources.get('server.js') || '';
  const offenders = [];
  for (const { lane, accessor } of DECOY_LANES) {
    const present = workspaceSrc.includes(`function ${accessor}`) || serverSrc.includes(`function ${accessor}`);
    if (!present) offenders.push(`${lane}: accessor ${accessor} is missing`);
  }
  return offenders;
}

describe('LIN-3124 PR1 T4 — decoy lane registry (static)', () => {
  test('every decoy lane accessor exists (the lane set is intact)', () => {
    assert.deepEqual(decoyLaneOffenders(REAL), []);
  });

  test('planted: dropping a lane accessor fails the registry', () => {
    const dropped = new Map(REAL);
    dropped.set('lib/workspace.js', REAL.get('lib/workspace.js').replace('export function getWorkspaceCallScope(', 'function removedCallScope('));
    assert.ok(decoyLaneOffenders(dropped).length > 0);
  });
});
