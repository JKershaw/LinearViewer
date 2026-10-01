/**
 * Unit tests for lib/owner-backfill.js (LIN-3142): the one-shot boot backfill
 * that gives every ownerless pre-cutoff workspace John's account as owner.
 *
 * Run with: node --test tests/unit/owner-backfill.test.js
 *
 * Against a REAL MangoDB tmpdir (precedent: tests/unit/account-workspace-store.test.js),
 * because the claims are about what the store holds afterwards and about the
 * `account_workspaces_one_owner` partial unique index, which MangoDB 0.1.2
 * enforces on insert, `$set` and an upsert's `$setOnInsert`. MangoDB
 * serialises writers, so true interleaving is proven on real MongoDB in
 * tests/unit/mongo-smoke.test.js (G11), not here.
 *
 * The module is loaded in the behaviour suite's `before`, not by a static
 * import, so the server.js / source wiring census (G13) at the bottom runs
 * and reports on its own even when the module fails to load.
 *
 * Group labels (G1–G10, G13) are the plan's test list (LIN-3142 plan §G).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MangoClient } from '@jkershaw/mangodb';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { checkWorkspaceOwner } from '../../lib/workspace-owner.js';
import { INDEX_SPECS, ensureIndexes } from '../../lib/db-indexes.js';
import { inferWorkspaceKind as scriptInferWorkspaceKind } from '../../scripts/dry-run-workspace-ownership.mjs';

const MODULE_URL = new URL('../../lib/owner-backfill.js', import.meta.url);
const MODULE_PATH = fileURLToPath(MODULE_URL);
const SERVER_PATH = fileURLToPath(new URL('../../server.js', import.meta.url));

// The pinned values, as literals: G13 asserts the module's constants equal
// exactly these (plan §B).
const PIN_ACCOUNT = 'e7e948a4-2951-4af4-b60e-572a473a491e';
const PIN_LINEAR_SCOPE = 'beb9398c-83b5-4d06-b65e-78d19bb0d2f7';
const CUTOFF_ISO = '2026-09-29T19:35:00.000Z';
const CUTOFF = new Date(CUTOFF_ISO);
const OWNER_INDEX_NAME = 'account_workspaces_one_owner';

const PRE = new Date('2026-09-01T00:00:00.000Z');
const JUST_BEFORE = new Date(CUTOFF.getTime() - 1);
const POST = new Date('2026-09-30T00:00:00.000Z');

const ALIAS = 'acct-john-alias';
const OTHER = 'acct-other';
const OTHER_MERGED = 'acct-other-merged';
const Z = 'acct-z';

// A synthetic org-id-shaped workspace id (G6e): a UUID, so `kind=container`,
// and deliberately NOT the pinned viewer id or any real id.
const SYNTH_ORG_WS = 'c0ffee00-1111-4222-8333-444455556666';

// Never in any output (plan §B "never printed"). PIN_ACCOUNT is permitted.
const CANARIES = [
  'john@example.test',
  'SECRET-CRED-JOHN',
  'SECRET-CRED-OTHER',
  'SECRET-AT-w05',
  'SECRET-RT-w05',
  'sid-SECRET-1',
  'SECRET-ERR-MESSAGE',
  PIN_LINEAR_SCOPE
];

const W = (n) => `ws-${String(n).padStart(2, '0')}`;

const WRITE_METHODS = new Set([
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace',
  'findOneAndDelete', 'replaceOne', 'deleteOne', 'deleteMany', 'bulkWrite', 'createIndex', 'createIndexes',
  'drop', 'dropIndex', 'dropIndexes'
]);

// --- fixtures ---------------------------------------------------------------

function johnDoc(extra = {}) {
  return {
    _id: PIN_ACCOUNT,
    identities: [
      { provider: 'linear', scope: PIN_LINEAR_SCOPE, credentials: { token: 'SECRET-CRED-JOHN' } },
      { provider: 'email', scope: 'john@example.test' }
    ],
    createdAt: PRE,
    updatedAt: PRE,
    ...extra
  };
}

// John, his merged-away alias, another account and that account's merged alias.
async function seedAccounts(db, { john = true } = {}) {
  const docs = [
    { _id: ALIAS, mergedInto: PIN_ACCOUNT, identities: [], createdAt: PRE, updatedAt: PRE },
    { _id: OTHER, identities: [{ provider: 'linear', scope: 'other-viewer', credentials: { token: 'SECRET-CRED-OTHER' } }], createdAt: PRE, updatedAt: PRE },
    { _id: OTHER_MERGED, mergedInto: OTHER, identities: [], createdAt: PRE, updatedAt: PRE }
  ];
  if (john) docs.push(johnDoc());
  await db.collection('accounts').insertMany(docs);
}

// A live session naming a workspace with no edge (G3a), carrying session canaries.
async function seedSession(db, workspaceId = W(5)) {
  await db.collection('sessions').insertOne({
    _id: 'sid-SECRET-1',
    expires: new Date(Date.now() + 60_000),
    session: {
      accountId: OTHER,
      workspaces: [{ id: workspaceId, urlKey: 'w05', accessToken: 'SECRET-AT-w05', refreshToken: 'SECRET-RT-w05' }]
    }
  });
  await db.collection('workspaces').insertOne({ _id: workspaceId, name: 'No edges', urlKey: 'w05', createdAt: PRE });
}

// Writes an edge directly, as the test seam does (routes/test.js). `createdAt`
// defaults to PRE; pass `createdAt: undefined` for an edge with the field absent.
async function seedEdge(db, fields) {
  const doc = { _id: randomUUID(), createdAt: PRE, ...fields };
  for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
  await db.collection('account-workspaces').insertOne(doc);
  return doc;
}

// Only the account-workspaces production indexes, so the owner index is real
// but `accounts_identity_unique` is not built (G7 "ambiguous" needs that).
async function buildEdgeIndexes(db) {
  const collection = db.collection('account-workspaces');
  for (const spec of INDEX_SPECS.filter(s => s.collection === 'account-workspaces')) {
    await collection.createIndex(spec.keySpec, spec.options);
  }
}

async function snapshot(db) {
  const rows = await db.collection('account-workspaces').find({}).toArray();
  rows.sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
  return structuredClone(rows);
}

async function edgesOf(db, workspaceId) {
  return db.collection('account-workspaces').find({ workspaceId }).toArray();
}

function captureLogger() {
  const entries = [];
  const push = level => (...args) => entries.push({ level, text: args.map(String).join(' ') });
  return {
    entries,
    log: push('log'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    debug: push('debug'),
    text: () => entries.map(e => e.text).join('\n'),
    lines: () => entries.map(e => e.text)
  };
}

const silentLogger = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

// `key=value` tokens of one `[owner-backfill] …` line.
function fieldsOf(line) {
  const out = {};
  for (const token of line.split(/\s+/)) {
    const i = token.indexOf('=');
    if (i > 0) out[token.slice(0, i)] = token.slice(i + 1);
  }
  return out;
}

// The single summary line, parsed. Every caller asserts there is exactly one.
function summaryOf(logger) {
  const lines = logger.lines().filter(l => /^\[owner-backfill\] owner=/.test(l));
  assert.strictEqual(lines.length, 1, `exactly one [owner-backfill] summary line, got ${lines.length}:\n${logger.text()}`);
  return fieldsOf(lines[0]);
}

// Per-target lines keyed by workspace id.
function targetLinesOf(logger) {
  const out = {};
  for (const entry of logger.entries) {
    if (!entry.text.startsWith('[owner-backfill] target ')) continue;
    const fields = fieldsOf(entry.text);
    assert.ok(!(fields.workspace in out), `one target line per workspace, ${fields.workspace} repeated`);
    out[fields.workspace] = { ...fields, level: entry.level, text: entry.text };
  }
  return out;
}

function assertNoCanary(text, where) {
  for (const value of CANARIES) {
    assert.ok(!text.includes(value), `${where} must not contain ${value}`);
  }
}

function assertNoKeyDeep(value, keys, path = 'report') {
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    assert.ok(!keys.includes(k), `${path} must not carry a "${k}" key`);
    assertNoKeyDeep(v, keys, `${path}.${k}`);
  }
}

/**
 * A Proxy over a db handle whose collections call `hook(name, method, args)`
 * before every method call (the hook may throw), and record every write call.
 * Methods are bound to the real collection, so MangoDB internals are untouched.
 */
function wrapDb(db, hook = () => {}) {
  const writes = [];
  const wrapCollection = (name, collection) => new Proxy(collection, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (WRITE_METHODS.has(prop)) writes.push({ collection: name, method: prop, args });
        hook(name, prop, args);
        return value.apply(target, args);
      };
    }
  });
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === 'collection') return (name, ...rest) => wrapCollection(name, target.collection(name, ...rest));
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return { db: proxy, writes };
}

// A db whose every write throws: "zero writes" by call count AND by state.
function guardWrites(db) {
  return wrapDb(db, (name, method) => {
    if (WRITE_METHODS.has(method)) throw new Error(`unexpected write: ${name}.${method}`);
  });
}

async function cloneDb(src, dst) {
  for (const name of ['accounts', 'account-workspaces', 'sessions', 'workspaces']) {
    const rows = await src.collection(name).find({}).toArray();
    if (rows.length) await dst.collection(name).insertMany(structuredClone(rows));
  }
}

// --- the behaviour suite ----------------------------------------------------

describe('owner-backfill (LIN-3142)', () => {
  let mod;
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    mod = await import(MODULE_URL);
    dbDir = mkdtempSync(join(tmpdir(), 'owner-backfill-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return client.db(`ob_${counter++}`);
  }

  // A db with the edge indexes built and the standard accounts seeded.
  async function readyDb({ john = true } = {}) {
    const db = freshDb();
    await buildEdgeIndexes(db);
    await seedAccounts(db, { john });
    return db;
  }

  function stores(db) {
    const accountStore = new AccountStore({ collection: db.collection('accounts') });
    const accountWorkspaceStore = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') });
    return { accountStore, accountWorkspaceStore };
  }

  // The G1/G3 population: one workspace per path, plus out-of-scope ones.
  async function seedMixed(db) {
    await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });                          // insert path
    await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(1) });
    await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(2) });                    // promote path
    await seedEdge(db, { accountId: OTHER, workspaceId: W(2) });
    await seedEdge(db, { accountId: ALIAS, workspaceId: W(3) });                          // merged-alias promote
    await seedEdge(db, { accountId: OTHER, workspaceId: W(4), role: 'owner' });           // owned by someone else
    await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(4) });
    await seedSession(db, W(5));                                                          // no edge at all
    await seedEdge(db, { accountId: OTHER, workspaceId: W(7), createdAt: POST });         // post-cutoff
    await seedEdge(db, { accountId: OTHER, workspaceId: W(9), createdAt: null });         // undatable
    await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: SYNTH_ORG_WS });            // G6e
  }

  describe('constants and kind label', () => {
    test('the pins, cutoff and index name are the plan §B values', () => {
      assert.strictEqual(mod.PIN_ACCOUNT, PIN_ACCOUNT);
      assert.strictEqual(mod.PIN_LINEAR_SCOPE, PIN_LINEAR_SCOPE);
      assert.ok(mod.CUTOFF instanceof Date);
      assert.strictEqual(mod.CUTOFF.toISOString(), CUTOFF_ISO);
      assert.strictEqual(mod.OWNER_INDEX_NAME, OWNER_INDEX_NAME);
    });

    test('inferWorkspaceKind is a faithful copy of the dry-run script\'s (parity; a UUID is `container`, never "fixed")', () => {
      const samples = [
        'github:42', 'github:org/repo', 'jira:5b10', 'jira:abc', SYNTH_ORG_WS, PIN_ACCOUNT,
        'a8c4b5e3-5392-42fb-884e-086f691fa0b8', 'C0FFEE00-1111-4222-8333-444455556666',
        'a1b2c3-org-id', 'org-alpha', W(1), ''
      ];
      for (const id of samples) {
        assert.strictEqual(mod.inferWorkspaceKind(id), scriptInferWorkspaceKind(id), `kind of ${JSON.stringify(id)}`);
      }
      assert.strictEqual(mod.inferWorkspaceKind(SYNTH_ORG_WS), 'container');
      assert.strictEqual(mod.inferWorkspaceKind(W(1)), 'linear-org');
    });
  });

  describe('G1 assignment: ownerless pre-cutoff → John (T1, T2)', () => {
    test('G1a insert path: John has no edge → one new owner edge for PIN_ACCOUNT, the others byte-identical', async () => {
      const db = await readyDb();
      const a = await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const b = await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(1) });
      const initial = await snapshot(db);
      const logger = captureLogger();

      await mod.runOwnerBackfill({ db, logger });

      const edges = await edgesOf(db, W(1));
      assert.strictEqual(edges.length, 3, 'the edge count for W1 goes 2 → 3');
      const added = edges.find(e => e._id !== a._id && e._id !== b._id);
      assert.strictEqual(added.accountId, PIN_ACCOUNT);
      assert.strictEqual(added.workspaceId, W(1));
      assert.strictEqual(added.role, 'owner');
      assert.ok(added.createdAt instanceof Date, 'createdAt is a Date');
      assert.deepStrictEqual(new Set(Object.keys(added)), new Set(['_id', 'accountId', 'workspaceId', 'createdAt', 'role']));
      const after = await snapshot(db);
      for (const prior of initial) {
        assert.deepStrictEqual(after.find(e => e._id === prior._id), prior, 'a pre-existing edge is untouched');
      }

      const { accountStore, accountWorkspaceStore } = stores(db);
      assert.strictEqual(await accountWorkspaceStore.getWorkspaceOwnerAccountId(W(1), accountStore), PIN_ACCOUNT);

      const summary = summaryOf(logger);
      assert.deepStrictEqual(
        { owner: summary.owner, cutoff: summary.cutoff, targets: summary.targets, assigned: summary.assigned, alreadyMember: summary.alreadyMember, raced: summary.raced, failed: summary.failed, undatable: summary.undatable, mode: summary.mode, skipped: summary.skipped },
        { owner: PIN_ACCOUNT, cutoff: CUTOFF_ISO, targets: '1', assigned: '1', alreadyMember: '0', raced: '0', failed: '0', undatable: '0', mode: 'write', skipped: 'none' }
      );
      const line = targetLinesOf(logger)[W(1)];
      assert.ok(line, 'a target line for W1');
      assert.strictEqual(line.kind, 'linear-org');
      assert.strictEqual(line.edges, '2');
      assert.strictEqual(line.johnAlreadyMember, 'no');
      assert.strictEqual(line.outcome, 'assigned');
    });

    test('G1b promote path: John\'s plain edge gains role owner in place; no second John edge', async () => {
      const db = await readyDb();
      const john = await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(2) });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(2) });
      const logger = captureLogger();

      await mod.runOwnerBackfill({ db, logger });

      const edges = await edgesOf(db, W(2));
      assert.strictEqual(edges.length, 2, 'edge count unchanged');
      const promoted = edges.find(e => e._id === john._id);
      assert.strictEqual(promoted.role, 'owner');
      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ accountId: PIN_ACCOUNT, workspaceId: W(2) }), 1);
      const summary = summaryOf(logger);
      assert.strictEqual(summary.assigned, '1');
      assert.strictEqual(summary.alreadyMember, '1');
      assert.strictEqual(targetLinesOf(logger)[W(2)].johnAlreadyMember, 'yes');
    });

    test('G1c merged-alias John edge is promoted; no PIN_ACCOUNT edge is created; the owner resolves to John', async () => {
      const db = await readyDb();
      const alias = await seedEdge(db, { accountId: ALIAS, workspaceId: W(3) });
      const logger = captureLogger();

      await mod.runOwnerBackfill({ db, logger });

      const edges = await edgesOf(db, W(3));
      assert.strictEqual(edges.length, 1, 'no edge added');
      assert.strictEqual(edges[0]._id, alias._id);
      assert.strictEqual(edges[0].role, 'owner');
      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ accountId: PIN_ACCOUNT }), 0);
      const { accountStore, accountWorkspaceStore } = stores(db);
      assert.strictEqual(await accountWorkspaceStore.getWorkspaceOwnerAccountId(W(3), accountStore), PIN_ACCOUNT);
      assert.deepStrictEqual(
        await checkWorkspaceOwner({ workspaceId: W(3), accountId: PIN_ACCOUNT }, { accountWorkspaceStore, accountStore }),
        { status: 'owner' }
      );
      assert.strictEqual(summaryOf(logger).alreadyMember, '1');
      assert.strictEqual(targetLinesOf(logger)[W(3)].johnAlreadyMember, 'yes');
    });

    test('G1d alias edge (earlier) and PIN_ACCOUNT edge (later): the PIN_ACCOUNT edge is promoted, the alias stays plain', async () => {
      const db = await readyDb();
      const alias = await seedEdge(db, { accountId: ALIAS, workspaceId: W(4), createdAt: new Date('2026-08-01T00:00:00Z') });
      const john = await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(4), createdAt: PRE });

      await mod.runOwnerBackfill({ db, logger: captureLogger() });

      const edges = await edgesOf(db, W(4));
      assert.strictEqual(edges.find(e => e._id === john._id).role, 'owner');
      assert.ok(!edges.find(e => e._id === alias._id).role, 'the alias edge stays plain');
      assert.strictEqual(edges.filter(e => e.role === 'owner').length, 1);
    });

    test('G1e planOwnerBackfill (pure): promoteEdgeId, johnAlreadyMember and workspaceId ordering', () => {
      const e = (id, accountId, workspaceId, extra = {}) => ({ _id: id, accountId, workspaceId, createdAt: PRE, ...extra });
      const edges = [
        e('e4a', ALIAS, W(4), { createdAt: new Date('2026-08-01T00:00:00Z') }),
        e('e4b', PIN_ACCOUNT, W(4)),
        e('e3', ALIAS, W(3)),
        e('e2a', PIN_ACCOUNT, W(2)),
        e('e2b', OTHER, W(2)),
        e('e1a', OTHER, W(1)),
        e('e1b', OTHER_MERGED, W(1))
      ];
      const mergedInto = new Map([[ALIAS, PIN_ACCOUNT], [OTHER_MERGED, OTHER]]);

      const plan = mod.planOwnerBackfill({ edges, mergedInto, johnAccountId: PIN_ACCOUNT, cutoff: CUTOFF });
      assert.deepStrictEqual(plan.targets.map(t => t.workspaceId), [W(1), W(2), W(3), W(4)], 'sorted by workspaceId');
      const by = Object.fromEntries(plan.targets.map(t => [t.workspaceId, t]));
      assert.deepStrictEqual(by[W(1)], { workspaceId: W(1), kind: 'linear-org', edgeCount: 2, promoteEdgeId: null, johnAlreadyMember: false });
      assert.deepStrictEqual(by[W(2)], { workspaceId: W(2), kind: 'linear-org', edgeCount: 2, promoteEdgeId: 'e2a', johnAlreadyMember: true });
      assert.deepStrictEqual(by[W(3)], { workspaceId: W(3), kind: 'linear-org', edgeCount: 1, promoteEdgeId: 'e3', johnAlreadyMember: true });
      assert.deepStrictEqual(by[W(4)], { workspaceId: W(4), kind: 'linear-org', edgeCount: 2, promoteEdgeId: 'e4b', johnAlreadyMember: true });
      assert.deepStrictEqual(plan.undatable, []);

      const unresolved = mod.planOwnerBackfill({ edges, mergedInto, johnAccountId: null, cutoff: CUTOFF });
      assert.deepStrictEqual(unresolved.targets.map(t => t.workspaceId), [W(1), W(2), W(3), W(4)]);
      for (const t of unresolved.targets) {
        assert.strictEqual(t.johnAlreadyMember, null, 'unknown when John is unresolved');
        assert.strictEqual(t.promoteEdgeId, null);
      }
    });

    test('G1e alias choice among several alias edges: the earliest by (createdAt, _id), undatable last', () => {
      const ALIAS2 = 'acct-john-alias-2';
      const edges = [
        { _id: 'b', accountId: ALIAS2, workspaceId: W(6), createdAt: PRE },
        { _id: 'a', accountId: ALIAS, workspaceId: W(6), createdAt: PRE },
        { _id: '0', accountId: ALIAS, workspaceId: W(6), createdAt: null },
        { _id: 'c', accountId: OTHER, workspaceId: W(6), createdAt: new Date('2026-01-01T00:00:00Z') }
      ];
      const mergedInto = new Map([[ALIAS, PIN_ACCOUNT], [ALIAS2, PIN_ACCOUNT]]);
      const plan = mod.planOwnerBackfill({ edges, mergedInto, johnAccountId: PIN_ACCOUNT, cutoff: CUTOFF });
      assert.strictEqual(plan.targets.length, 1);
      assert.strictEqual(plan.targets[0].promoteEdgeId, 'a', 'tie on createdAt broken by _id; the undatable edge sorts last');
    });
  });

  describe('G2 existing owners are never touched (T3)', () => {
    test('a non-John owner, an owner on a merged-away account, and John\'s alias as owner: zero writes, targets=0', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1), role: 'owner' });            // G2a
      await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(1) });
      await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(2), role: 'owner' });     // G2b
      await seedEdge(db, { accountId: OTHER, workspaceId: W(2) });
      await seedEdge(db, { accountId: ALIAS, workspaceId: W(3), role: 'owner' });            // G2c
      await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(3) });
      const initial = await snapshot(db);
      const guarded = guardWrites(db);
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db: guarded.db, logger });

      assert.deepStrictEqual(guarded.writes, [], 'no write call at all');
      assert.deepStrictEqual(await snapshot(db), initial, 'the collection is unchanged');
      assert.deepStrictEqual(report.targets, []);
      const summary = summaryOf(logger);
      assert.strictEqual(summary.targets, '0');
      assert.strictEqual(summary.assigned, '0');
      assert.strictEqual(summary.skipped, 'none');
      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ accountId: PIN_ACCOUNT, workspaceId: W(2) }), 0, 'no John edge added under a foreign owner');
    });
  });

  describe('G3 out-of-scope workspaces', () => {
    test('G3a a workspace known only to sessions/workspaces (no edge) is never a target and gains no edge (T4)', async () => {
      const db = await readyDb();
      await seedSession(db, W(5));
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db, logger });

      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ workspaceId: W(5) }), 0);
      assert.ok(!report.targets.some(t => t.workspaceId === W(5)));
      assert.ok(!(W(5) in targetLinesOf(logger)));
      assert.strictEqual(summaryOf(logger).targets, '1', 'only W1');
    });

    test('G3b post-cutoff: earliest edge at CUTOFF or later is untouched; CUTOFF − 1 ms is a target (strict <) (T9/R1)', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(6), createdAt: CUTOFF });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(7), createdAt: POST });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(8), createdAt: JUST_BEFORE });
      await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(8), createdAt: POST });
      const initial = await snapshot(db);
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db, logger });

      assert.deepStrictEqual(report.targets.map(t => t.workspaceId), [W(8)]);
      assert.deepStrictEqual(report.undatable, []);
      const after = await snapshot(db);
      for (const ws of [W(6), W(7)]) {
        assert.deepStrictEqual(after.filter(e => e.workspaceId === ws), initial.filter(e => e.workspaceId === ws), `${ws} untouched`);
      }
      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ workspaceId: W(8), role: 'owner', accountId: PIN_ACCOUNT }), 1);
      const summary = summaryOf(logger);
      assert.strictEqual(summary.targets, '1');
      assert.strictEqual(summary.undatable, '0');
    });

    test('G3b classifyWorkspaces / summariseOwnership: post-cutoff counts as ownerless but not ownerlessPreCutoff', () => {
      const edges = [
        { _id: 'a', accountId: OTHER, workspaceId: W(6), createdAt: CUTOFF },
        { _id: 'b', accountId: OTHER, workspaceId: W(7), createdAt: POST },
        { _id: 'c', accountId: OTHER, workspaceId: W(8), createdAt: JUST_BEFORE },
        { _id: 'd', accountId: OTHER, workspaceId: W(1), createdAt: PRE, role: 'owner' },
        { _id: 'e', accountId: PIN_ACCOUNT, workspaceId: W(1), createdAt: PRE },
        { _id: 'f', accountId: OTHER, workspaceId: W(9), createdAt: null }
      ];
      const classified = mod.classifyWorkspaces(edges, { cutoff: CUTOFF });
      assert.ok(classified instanceof Map);
      assert.strictEqual(classified.get(W(6)).status, 'post-cutoff');
      assert.strictEqual(classified.get(W(7)).status, 'post-cutoff');
      assert.strictEqual(classified.get(W(8)).status, 'target');
      assert.strictEqual(classified.get(W(1)).status, 'owned');
      assert.strictEqual(classified.get(W(9)).status, 'undatable');
      assert.strictEqual(classified.get(W(1)).hasOwner, true);
      assert.strictEqual(classified.get(W(8)).hasOwner, false);
      assert.strictEqual(classified.get(W(8)).earliest.getTime(), JUST_BEFORE.getTime());
      assert.strictEqual(classified.get(W(9)).earliest, null);
      assert.strictEqual(classified.get(W(1)).edges.length, 2);

      assert.deepStrictEqual(mod.summariseOwnership(classified), {
        workspacesWithEdges: 5,
        ownerEdges: 1,
        ownerless: 4,
        ownerlessPreCutoff: 1,
        undatable: 1
      });
    });

    test('G3c undatable: null, absent and unparseable createdAt are reported, never written; mixed edges use the datable minimum', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(9), createdAt: null });           // the epoch guard
      await seedEdge(db, { accountId: OTHER, workspaceId: W(10), createdAt: undefined });     // field absent
      await seedEdge(db, { accountId: OTHER, workspaceId: W(11), createdAt: 'not-a-date' });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(12), createdAt: null });
      await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(12), createdAt: PRE });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(13), createdAt: null });
      await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(13), createdAt: POST });
      const initial = await snapshot(db);
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db, logger });

      assert.deepStrictEqual(report.undatable, [
        { workspaceId: W(9), kind: 'linear-org', edgeCount: 1 },
        { workspaceId: W(10), kind: 'linear-org', edgeCount: 1 },
        { workspaceId: W(11), kind: 'linear-org', edgeCount: 1 }
      ]);
      assert.deepStrictEqual(report.targets.map(t => t.workspaceId), [W(12)]);
      const after = await snapshot(db);
      for (const ws of [W(9), W(10), W(11), W(13)]) {
        assert.deepStrictEqual(after.filter(e => e.workspaceId === ws), initial.filter(e => e.workspaceId === ws), `${ws} untouched`);
      }
      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ workspaceId: W(9), role: 'owner' }), 0, 'null createdAt is not the epoch');
      const undatableLines = logger.lines().filter(l => l.startsWith('[owner-backfill] undatable '));
      assert.deepStrictEqual(undatableLines.map(fieldsOf), [
        { workspace: W(9), kind: 'linear-org', edges: '1' },
        { workspace: W(10), kind: 'linear-org', edges: '1' },
        { workspace: W(11), kind: 'linear-org', edges: '1' }
      ]);
      const summary = summaryOf(logger);
      assert.strictEqual(summary.undatable, '3');
      assert.strictEqual(summary.targets, '1');
      assert.strictEqual(summary.assigned, '1');
    });
  });

  describe('G4 idempotent re-run (T5)', () => {
    test('a second and third run find nothing to do and make zero write calls', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(2) });
      await seedEdge(db, { accountId: ALIAS, workspaceId: W(3) });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(4), role: 'owner' });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(7), createdAt: POST });

      const first = captureLogger();
      await mod.runOwnerBackfill({ db, logger: first });
      assert.strictEqual(summaryOf(first).assigned, '3');
      const afterFirst = await snapshot(db);

      for (const run of ['second', 'third']) {
        const guarded = guardWrites(db);
        const logger = captureLogger();
        await mod.runOwnerBackfill({ db: guarded.db, logger });
        assert.deepStrictEqual(guarded.writes, [], `${run} run: zero write calls`);
        assert.deepStrictEqual(await snapshot(db), afterFirst, `${run} run: the collection is unchanged`);
        const summary = summaryOf(logger);
        assert.strictEqual(summary.targets, '0');
        assert.strictEqual(summary.assigned, '0');
        assert.strictEqual(summary.skipped, 'none');
      }
    });
  });

  describe('G5 predicate edge: role:null (T11, flag F1)', () => {
    test('G5a all edges role:null, no John edge → ownerless; John inserted as owner', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(14), role: null });
      await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(14), role: null });
      const logger = captureLogger();

      await mod.runOwnerBackfill({ db, logger });

      const owner = await db.collection('account-workspaces').findOne({ workspaceId: W(14), role: 'owner' });
      assert.strictEqual(owner?.accountId, PIN_ACCOUNT);
      assert.strictEqual(summaryOf(logger).assigned, '1');
    });

    test('G5b John\'s own edge with role:null is promoted (the $exists:false filter would silently skip it)', async () => {
      const db = await readyDb();
      const john = await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(15), role: null });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(15) });
      const logger = captureLogger();

      await mod.runOwnerBackfill({ db, logger });

      const edge = await db.collection('account-workspaces').findOne({ _id: john._id });
      assert.strictEqual(edge.role, 'owner');
      const summary = summaryOf(logger);
      assert.strictEqual(summary.assigned, '1', 'assigned by modifiedCount, not raced');
      assert.strictEqual(summary.raced, '0');
      assert.strictEqual(summary.alreadyMember, '1');
    });

    test('G5c owner presence is role === "owner": a role:null edge beside an owner edge is still owned', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(16), role: null });
      await seedEdge(db, { accountId: OTHER, workspaceId: W(16), role: 'owner' });
      const initial = await snapshot(db);
      const guarded = guardWrites(db);
      const logger = captureLogger();

      await mod.runOwnerBackfill({ db: guarded.db, logger });

      assert.deepStrictEqual(guarded.writes, []);
      assert.deepStrictEqual(await snapshot(db), initial);
      assert.strictEqual(summaryOf(logger).targets, '0');
    });
  });

  describe('G6 dry run writes nothing and prints no secrets', () => {
    test('G6a write:false plans exactly what the live run does, with zero writes', async () => {
      const db = await readyDb();
      await seedMixed(db);
      const twin = freshDb();
      await buildEdgeIndexes(twin);
      await cloneDb(db, twin);
      const initial = await snapshot(db);
      const guarded = guardWrites(db);
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db: guarded.db, write: false, logger });

      assert.deepStrictEqual(guarded.writes, [], 'zero write calls');
      assert.deepStrictEqual(await snapshot(db), initial, 'the collection is unchanged');
      assert.strictEqual(report.mode, 'dry-run');
      assert.strictEqual(report.skipped, null);
      assert.deepStrictEqual(report.gates, { ownerIndex: true, identity: 'ok' });

      const lines = targetLinesOf(logger);
      assert.deepStrictEqual(Object.keys(lines).sort(), [W(1), W(2), W(3), SYNTH_ORG_WS].sort());
      for (const line of Object.values(lines)) assert.strictEqual(line.outcome, 'would-assign', line.text);
      assert.strictEqual(lines[W(1)].johnAlreadyMember, 'no');
      assert.strictEqual(lines[W(2)].johnAlreadyMember, 'yes');
      assert.strictEqual(lines[W(3)].johnAlreadyMember, 'yes');

      const summary = summaryOf(logger);
      assert.strictEqual(summary.mode, 'dry-run');
      assert.strictEqual(summary.targets, '4');
      assert.strictEqual(summary.assigned, '0');
      assert.strictEqual(summary.alreadyMember, '0');
      assert.strictEqual(summary.raced, '0');
      assert.strictEqual(summary.failed, '0');
      assert.strictEqual(summary.undatable, '1');
      assert.strictEqual(summary.skipped, 'none');
      assert.strictEqual(report.summary.ownerlessPreCutoff, 4);

      const live = await mod.runOwnerBackfill({ db: twin, logger: silentLogger });
      const shape = t => ({ workspaceId: t.workspaceId, kind: t.kind, edgeCount: t.edgeCount, promoteEdgeId: t.promoteEdgeId, johnAlreadyMember: t.johnAlreadyMember });
      assert.deepStrictEqual(report.targets.map(shape), live.targets.map(shape), 'the dry run lists what the live run assigns');
      assert.strictEqual(live.counts.assigned, 4);
    });

    test('G6b identity failure still plans in dry-run: johnAlreadyMember unknown, nothing written', async () => {
      const db = await readyDb({ john: false });
      await seedMixed(db);
      const initial = await snapshot(db);
      const guarded = guardWrites(db);
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db: guarded.db, write: false, logger });

      assert.deepStrictEqual(guarded.writes, []);
      assert.deepStrictEqual(await snapshot(db), initial);
      assert.strictEqual(report.gates.identity, 'no-match');
      assert.strictEqual(report.skipped, 'identity-no-match');
      assert.deepStrictEqual(report.targets.map(t => t.workspaceId), [W(1), W(2), W(3), SYNTH_ORG_WS].sort());
      for (const t of report.targets) assert.strictEqual(t.johnAlreadyMember, null);
      for (const line of Object.values(targetLinesOf(logger))) {
        assert.strictEqual(line.johnAlreadyMember, 'unknown', line.text);
        assert.strictEqual(line.outcome, 'would-assign', line.text);
      }
      const summary = summaryOf(logger);
      assert.strictEqual(summary.owner, 'unresolved');
      assert.strictEqual(summary.mode, 'dry-run');
      assert.strictEqual(summary.skipped, 'identity-no-match');
      assert.strictEqual(summary.targets, '4');
    });

    for (const write of [true, false]) {
      test(`G6c secret safety (${write ? 'write' : 'dry-run'}): no canary, PIN_LINEAR_SCOPE included, in any log line or the report`, async () => {
        const db = await readyDb();
        await seedMixed(db);
        const logger = captureLogger();

        const report = await mod.runOwnerBackfill({ db, write, logger });

        assert.ok(logger.text().includes(PIN_ACCOUNT), 'PIN_ACCOUNT is printed on purpose (owner=)');
        assertNoCanary(logger.text(), 'the log');
        assertNoCanary(JSON.stringify(report), 'the report');
        assertNoKeyDeep(report, ['identities', 'credentials']);
      });

      test(`G6e (${write ? 'write' : 'dry-run'}) a synthetic org-id-shaped workspace id is printed only as workspace=/workspaceId; the viewer id never is`, async () => {
        const db = await readyDb();
        await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: SYNTH_ORG_WS });
        const logger = captureLogger();

        const report = await mod.runOwnerBackfill({ db, write, logger });

        const line = targetLinesOf(logger)[SYNTH_ORG_WS];
        assert.ok(line, 'a target line for the synthetic workspace');
        assert.match(line.text, new RegExp(`^\\[owner-backfill\\] target workspace=${SYNTH_ORG_WS} kind=container edges=1 johnAlreadyMember=yes outcome=${write ? 'assigned' : 'would-assign'}$`));
        assert.deepStrictEqual(report.targets.map(t => t.workspaceId), [SYNTH_ORG_WS]);

        const text = logger.text();
        const all = text.split(SYNTH_ORG_WS).length - 1;
        const asWorkspace = text.split(`workspace=${SYNTH_ORG_WS}`).length - 1;
        assert.ok(all > 0);
        assert.strictEqual(all, asWorkspace, 'in the log the id appears only as a workspace= value');
        const json = JSON.stringify(report);
        assert.strictEqual(json.split(SYNTH_ORG_WS).length - 1, json.split(`"workspaceId":"${SYNTH_ORG_WS}"`).length - 1, 'in the report only as a workspaceId field');
        assertNoCanary(text, 'the log');
        assertNoCanary(json, 'the report');
      });
    }
  });

  describe('G7 identity fail-closed (T8)', () => {
    const cases = [
      {
        name: 'no-match',
        skipped: 'identity-no-match',
        seed: async db => { await db.collection('accounts').insertOne({ ...johnDoc(), identities: [{ provider: 'email', scope: 'john@example.test' }] }); }
      },
      {
        name: 'ambiguous',
        skipped: 'identity-ambiguous',
        seed: async db => {
          await db.collection('accounts').insertMany([johnDoc(), { _id: Z, identities: [{ provider: 'linear', scope: PIN_LINEAR_SCOPE }] }]);
        }
      },
      {
        name: 'pinned-missing',
        skipped: 'identity-pinned-missing',
        seed: async db => { await db.collection('accounts').insertOne({ _id: Z, identities: [{ provider: 'linear', scope: PIN_LINEAR_SCOPE }] }); }
      },
      {
        name: 'mismatch',
        skipped: 'identity-mismatch',
        seed: async db => {
          await db.collection('accounts').insertMany([
            { ...johnDoc(), identities: [{ provider: 'email', scope: 'john@example.test' }] },
            { _id: Z, identities: [{ provider: 'linear', scope: PIN_LINEAR_SCOPE }] }
          ]);
        }
      },
      {
        name: 'unavailable (corrupt mergedInto chain)',
        skipped: 'identity-unavailable',
        seed: async db => {
          // mergeAccounts refuses to build a cycle, so the corruption is seeded directly
          // (precedent: tests/unit/workspace-owner.test.js).
          await db.collection('accounts').insertMany([
            { ...johnDoc(), mergedInto: Z },
            { _id: Z, mergedInto: PIN_ACCOUNT, identities: [] }
          ]);
        }
      },
      {
        name: 'unavailable (the account store throws on getAccount)',
        skipped: 'identity-unavailable',
        seed: async db => { await db.collection('accounts').insertOne(johnDoc()); },
        // AccountStore.getAccount is a findOne by _id.
        hook: (name, method, args) => {
          if (name === 'accounts' && method === 'findOne' && args[0] && '_id' in args[0]) {
            throw Object.assign(new Error('SECRET-ERR-MESSAGE'), { code: 'EACCOUNTS' });
          }
        }
      }
    ];

    for (const c of cases) {
      test(`${c.name} → skipped=${c.skipped}, zero writes, boot continues`, async () => {
        const db = freshDb();
        await buildEdgeIndexes(db);
        await c.seed(db);
        await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
        await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(2) });
        const initial = await snapshot(db);
        const wrapped = wrapDb(db, c.hook);
        const logger = captureLogger();

        const report = await mod.runOwnerBackfill({ db: wrapped.db, logger });

        assert.deepStrictEqual(wrapped.writes, [], 'zero write calls');
        assert.deepStrictEqual(await snapshot(db), initial, 'the collection is unchanged');
        assert.strictEqual(report.skipped, c.skipped);
        assert.strictEqual(report.gates.identity, c.skipped.replace(/^identity-/, ''));
        const summary = summaryOf(logger);
        assert.strictEqual(summary.skipped, c.skipped);
        assert.strictEqual(summary.owner, 'unresolved');
        assert.strictEqual(summary.mode, 'write');
        assert.strictEqual(summary.assigned, '0');
        assert.strictEqual(summary.targets, 'na', 'skipped before planning');
        assertNoCanary(logger.text(), 'the log');
        assertNoCanary(JSON.stringify(report), 'the report');
      });
    }

    test('ok (alias): the identity is on an account merged into PIN_ACCOUNT → skipped=none, writes proceed', async () => {
      const db = freshDb();
      await buildEdgeIndexes(db);
      await db.collection('accounts').insertMany([
        { ...johnDoc(), identities: [{ provider: 'email', scope: 'john@example.test' }] },
        { _id: Z, mergedInto: PIN_ACCOUNT, identities: [{ provider: 'linear', scope: PIN_LINEAR_SCOPE, credentials: { token: 'SECRET-CRED-JOHN' } }] }
      ]);
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db, logger });

      assert.strictEqual(report.gates.identity, 'ok');
      const summary = summaryOf(logger);
      assert.strictEqual(summary.skipped, 'none');
      assert.strictEqual(summary.owner, PIN_ACCOUNT);
      assert.strictEqual(summary.assigned, '1');
      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ workspaceId: W(1), role: 'owner', accountId: PIN_ACCOUNT }), 1);
      assertNoCanary(logger.text(), 'the log');
    });

    test('resolveJohn returns {ok:true, accountId} with the canonical id, and {ok:false, reason} otherwise', async () => {
      const resolve = async (docs, accountStoreOverride) => {
        const db = freshDb();
        if (docs.length) await db.collection('accounts').insertMany(docs);
        const accountsCollection = db.collection('accounts');
        const accountStore = accountStoreOverride || new AccountStore({ collection: accountsCollection });
        return mod.resolveJohn({ accountsCollection, accountStore });
      };

      assert.deepStrictEqual(await resolve([johnDoc()]), { ok: true, accountId: PIN_ACCOUNT });
      assert.deepStrictEqual(
        await resolve([johnDoc({ mergedInto: 'acct-survivor' }), { _id: 'acct-survivor', identities: [] }]),
        { ok: true, accountId: 'acct-survivor' },
        'the pinned account merged into a survivor resolves to the survivor'
      );
      assert.deepStrictEqual(await resolve([]), { ok: false, reason: 'no-match' });
      assert.deepStrictEqual(
        await resolve([johnDoc(), { _id: Z, identities: [{ provider: 'linear', scope: PIN_LINEAR_SCOPE }] }]),
        { ok: false, reason: 'ambiguous' }
      );
      assert.deepStrictEqual(
        await resolve([{ _id: Z, identities: [{ provider: 'linear', scope: PIN_LINEAR_SCOPE }] }]),
        { ok: false, reason: 'pinned-missing' }
      );

      const db = freshDb();
      await db.collection('accounts').insertOne(johnDoc());
      const accountsCollection = db.collection('accounts');
      const real = new AccountStore({ collection: accountsCollection });
      const throwing = {
        findAccountByIdentity: (...args) => real.findAccountByIdentity(...args),
        resolveCanonicalAccountId: (...args) => real.resolveCanonicalAccountId(...args),
        getAccount: async () => { throw new Error('SECRET-ERR-MESSAGE'); }
      };
      assert.deepStrictEqual(await mod.resolveJohn({ accountsCollection, accountStore: throwing }), { ok: false, reason: 'unavailable' });
    });
  });

  describe('G8 gates (T10)', () => {
    async function indexedWith(spec) {
      const db = freshDb();
      await seedAccounts(db);
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      if (spec) await db.collection('account-workspaces').createIndex(spec.keySpec, spec.options);
      return db;
    }

    test('G8a owner index missing → skipped=owner-index-missing, targets=na, zero writes', async () => {
      const db = await indexedWith(null);
      const initial = await snapshot(db);
      const guarded = guardWrites(db);
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db: guarded.db, logger });

      assert.deepStrictEqual(guarded.writes, []);
      assert.deepStrictEqual(await snapshot(db), initial);
      assert.strictEqual(report.skipped, 'owner-index-missing');
      assert.strictEqual(report.gates.ownerIndex, false);
      const summary = summaryOf(logger);
      assert.strictEqual(summary.skipped, 'owner-index-missing');
      assert.strictEqual(summary.targets, 'na');
      assert.strictEqual(summary.undatable, 'na');
      assert.strictEqual(summary.assigned, '0');
    });

    test('G8b a same-named index with the wrong spec does not count: non-unique, or unique without the partial filter', async () => {
      const nonUnique = await indexedWith({ keySpec: { workspaceId: 1, role: 1 }, options: { name: OWNER_INDEX_NAME, partialFilterExpression: { role: 'owner' } } });
      const noPartial = await indexedWith({ keySpec: { workspaceId: 1, role: 1 }, options: { name: OWNER_INDEX_NAME, unique: true } });
      for (const db of [nonUnique, noPartial]) {
        assert.strictEqual(await mod.hasOwnerIndex(db), false);
        const guarded = guardWrites(db);
        const logger = captureLogger();
        await mod.runOwnerBackfill({ db: guarded.db, logger });
        assert.deepStrictEqual(guarded.writes, []);
        assert.strictEqual(summaryOf(logger).skipped, 'owner-index-missing');
      }
    });

    test('G8c the production spec (ensureIndexes) counts; an absent collection answers false without throwing', async () => {
      const db = freshDb();
      await ensureIndexes(db, { logger: { warn() {} } });
      assert.strictEqual(await mod.hasOwnerIndex(db), true);

      const edgeOnly = freshDb();
      await buildEdgeIndexes(edgeOnly);
      assert.strictEqual(await mod.hasOwnerIndex(edgeOnly), true);

      assert.strictEqual(await mod.hasOwnerIndex(freshDb()), false);
    });

    test('G8d write:false with the owner index missing still plans and reports targets, writing nothing', async () => {
      const db = await indexedWith(null);
      const guarded = guardWrites(db);
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db: guarded.db, write: false, logger });

      assert.deepStrictEqual(guarded.writes, []);
      assert.strictEqual(report.skipped, 'owner-index-missing');
      assert.deepStrictEqual(report.targets.map(t => t.workspaceId), [W(1)]);
      assert.strictEqual(report.targets[0].johnAlreadyMember, false);
      const summary = summaryOf(logger);
      assert.strictEqual(summary.mode, 'dry-run');
      assert.strictEqual(summary.targets, '1');
      assert.strictEqual(summary.skipped, 'owner-index-missing');
    });

    test('G8e an unexpected throw inside the step resolves as skipped=unexpected-error, with no message text and no writes', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const wrapped = wrapDb(db, (name, method) => {
        if (name === 'account-workspaces' && method === 'find') throw new Error('SECRET-ERR-MESSAGE');
      });
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db: wrapped.db, logger });

      assert.deepStrictEqual(wrapped.writes, []);
      assert.strictEqual(report.skipped, 'unexpected-error');
      assert.strictEqual(summaryOf(logger).skipped, 'unexpected-error');
      assertNoCanary(logger.text(), 'the log');
      assertNoCanary(JSON.stringify(report), 'the report');
    });
  });

  describe('G9 per-workspace failure isolation (T10)', () => {
    test('a failing write on one workspace is failed (code only), the others are assigned, and the next run heals it', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const w2Edge = await seedEdge(db, { accountId: OTHER, workspaceId: W(2) });
      await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(3) });
      const initial = await snapshot(db);
      const touchesW2 = (args) => {
        const [filter = {}, update = {}] = args;
        return filter.workspaceId === W(2) || filter._id === w2Edge._id || update.$setOnInsert?.workspaceId === W(2);
      };
      const wrapped = wrapDb(db, (name, method, args) => {
        if (name === 'account-workspaces' && WRITE_METHODS.has(method) && touchesW2(args)) {
          throw Object.assign(new Error('SECRET-ERR-MESSAGE'), { code: 8000 });
        }
      });
      const logger = captureLogger();

      const report = await mod.runOwnerBackfill({ db: wrapped.db, logger });

      const after = await snapshot(db);
      assert.deepStrictEqual(after.filter(e => e.workspaceId === W(2)), initial.filter(e => e.workspaceId === W(2)), 'W2 untouched');
      for (const ws of [W(1), W(3)]) {
        assert.strictEqual(await db.collection('account-workspaces').countDocuments({ workspaceId: ws, role: 'owner' }), 1, `${ws} assigned`);
      }
      const summary = summaryOf(logger);
      assert.strictEqual(summary.assigned, '2');
      assert.strictEqual(summary.failed, '1');
      assert.strictEqual(report.counts.failed, 1);
      const lines = targetLinesOf(logger);
      assert.strictEqual(lines[W(2)].outcome, 'failed');
      assert.strictEqual(lines[W(2)].code, '8000');
      assert.match(lines[W(2)].text, / outcome=failed code=8000$/);
      const errors = logger.entries.filter(e => e.level === 'error');
      assert.strictEqual(errors.length, 1, 'logger.error for W2 only');
      assert.ok(errors[0].text.includes(`workspace=${W(2)}`));
      assertNoCanary(logger.text(), 'the log');
      assertNoCanary(JSON.stringify(report), 'the report');

      const heal = captureLogger();
      await mod.runOwnerBackfill({ db, logger: heal });
      const healed = summaryOf(heal);
      assert.strictEqual(healed.targets, '1');
      assert.strictEqual(healed.assigned, '1');
      assert.strictEqual(await db.collection('account-workspaces').countDocuments({ workspaceId: W(2), role: 'owner', accountId: PIN_ACCOUNT }), 1);
    });

    test('an error with no code is logged as code=<err.name>, never with its message', async () => {
      const db = await readyDb();
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const wrapped = wrapDb(db, (name, method) => {
        if (name === 'account-workspaces' && WRITE_METHODS.has(method)) throw new TypeError('SECRET-ERR-MESSAGE');
      });
      const logger = captureLogger();

      await mod.runOwnerBackfill({ db: wrapped.db, logger });

      const line = targetLinesOf(logger)[W(1)];
      assert.strictEqual(line.outcome, 'failed');
      assert.strictEqual(line.code, 'TypeError');
      assert.strictEqual(summaryOf(logger).failed, '1');
      assertNoCanary(logger.text(), 'the log');
    });
  });

  describe('G10 one-owner index on MangoDB, and raced accounting (T7, MangoDB half)', () => {
    async function indexedDb() {
      const db = freshDb();
      const { failed } = await ensureIndexes(db, { logger: { warn() {} } });
      assert.deepStrictEqual(failed.filter(f => f.collection === 'account-workspaces'), []);
      await db.collection('accounts').insertOne(johnDoc());
      return db;
    }

    async function planFor(db) {
      const edges = await db.collection('account-workspaces').find({}).toArray();
      return mod.planOwnerBackfill({ edges, mergedInto: new Map(), johnAccountId: PIN_ACCOUNT, cutoff: CUTOFF });
    }

    test('G10a promote loses to a competitor promoted after planning → raced=1, one owner, no throw', async () => {
      const db = await indexedDb();
      const edgesCollection = db.collection('account-workspaces');
      await seedEdge(db, { accountId: PIN_ACCOUNT, workspaceId: W(1) });
      const rival = await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const plan = await planFor(db);
      assert.ok(plan.targets[0].promoteEdgeId, 'promote path');
      await edgesCollection.updateOne({ _id: rival._id }, { $set: { role: 'owner' } });

      const result = await mod.executeOwnerBackfill({ edgesCollection, plan, johnAccountId: PIN_ACCOUNT, logger: captureLogger() });

      assert.strictEqual(result.raced, 1);
      assert.strictEqual(result.assigned, 0);
      assert.strictEqual(result.failed, 0);
      const owners = await edgesCollection.find({ workspaceId: W(1), role: 'owner' }).toArray();
      assert.deepStrictEqual(owners.map(o => o._id), [rival._id]);
    });

    test('G10b insert-as-owner loses → raced=1 and no stray plain John edge (flag F2)', async () => {
      const db = await indexedDb();
      const edgesCollection = db.collection('account-workspaces');
      const rival = await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const plan = await planFor(db);
      assert.strictEqual(plan.targets[0].promoteEdgeId, null, 'insert path');
      await edgesCollection.updateOne({ _id: rival._id }, { $set: { role: 'owner' } });

      const result = await mod.executeOwnerBackfill({ edgesCollection, plan, johnAccountId: PIN_ACCOUNT, logger: captureLogger() });

      assert.strictEqual(result.raced, 1);
      assert.strictEqual(result.assigned, 0);
      assert.strictEqual(result.failed, 0);
      assert.strictEqual(await edgesCollection.countDocuments({ workspaceId: W(1), role: 'owner' }), 1);
      assert.strictEqual(await edgesCollection.countDocuments({ accountId: PIN_ACCOUNT, workspaceId: W(1) }), 0, 'no stray John edge');
    });

    test('G10c the engine rejects a second owner by $set and by insertOne; role null/absent stays unconstrained', async () => {
      const db = await indexedDb();
      const collection = db.collection('account-workspaces');
      const a = await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const b = await seedEdge(db, { accountId: OTHER_MERGED, workspaceId: W(1) });
      await collection.updateOne({ _id: a._id }, { $set: { role: 'owner' } });

      await assert.rejects(() => collection.updateOne({ _id: b._id }, { $set: { role: 'owner' } }), /E11000|duplicate key/i);
      await assert.rejects(
        () => collection.insertOne({ _id: randomUUID(), accountId: PIN_ACCOUNT, workspaceId: W(1), createdAt: new Date(), role: 'owner' }),
        /E11000|duplicate key/i
      );
      await collection.insertOne({ _id: randomUUID(), accountId: ALIAS, workspaceId: W(1), createdAt: new Date(), role: null });
      await collection.insertOne({ _id: randomUUID(), accountId: Z, workspaceId: W(1), createdAt: new Date() });
      assert.strictEqual(await collection.countDocuments({ workspaceId: W(1) }), 4);
      assert.strictEqual(await collection.countDocuments({ workspaceId: W(1), role: 'owner' }), 1);
    });

    test('G10d five concurrent executes of one plan → one owner, one John edge, no rejection (accounting only; MangoDB serialises)', async () => {
      const db = await indexedDb();
      const edgesCollection = db.collection('account-workspaces');
      await seedEdge(db, { accountId: OTHER, workspaceId: W(1) });
      const plan = await planFor(db);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => mod.executeOwnerBackfill({ edgesCollection, plan, johnAccountId: PIN_ACCOUNT, logger: silentLogger }))
      );

      assert.deepStrictEqual(results.filter(r => r.status === 'rejected'), []);
      const total = key => results.reduce((n, r) => n + r.value[key], 0);
      assert.strictEqual(total('assigned'), 1);
      assert.strictEqual(total('failed'), 0);
      assert.strictEqual(total('raced'), 4);
      assert.strictEqual(await edgesCollection.countDocuments({ workspaceId: W(1), role: 'owner' }), 1);
      assert.strictEqual(await edgesCollection.countDocuments({ accountId: PIN_ACCOUNT, workspaceId: W(1) }), 1);
    });
  });
});

// --- G13: wiring and source census -------------------------------------------
// server.js boots a real app on import and is never imported by the unit suite,
// so its wiring is checked as source text (house pattern:
// tests/unit/observer-pass-server-wiring-census.test.js).

// Module source with its comments removed (JSDoc/block comments that open a
// line, whole-line and trailing `//` comments), so a mention in a comment
// neither satisfies nor trips a check.
function stripComments(source) {
  return source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('owner-backfill wiring and source census (LIN-3142 G13)', () => {
  test('server.js imports runOwnerBackfill from ./lib/owner-backfill.js', () => {
    const src = readFileSync(SERVER_PATH, 'utf8');
    assert.match(src, /import\s*\{[^}]*\brunOwnerBackfill\b[^}]*\}\s*from\s*['"]\.\/lib\/owner-backfill\.js['"]/);
  });

  // Anchored on top-level statements (column 0), so a comment that names
  // either call cannot stand in for it.
  test('server.js awaits runOwnerBackfill({ db }) after ensureIndexes(db) and before app.listen(', () => {
    const src = readFileSync(SERVER_PATH, 'utf8');
    const ensure = src.search(/^await ensureIndexes\(db\)/m);
    const calls = [...src.matchAll(/^await runOwnerBackfill\(\{ db \}\)/gm)];
    const listen = src.search(/^const server = app\.listen\(/m);
    assert.notStrictEqual(ensure, -1, 'await ensureIndexes(db) is present');
    assert.notStrictEqual(listen, -1, 'app.listen( is present');
    assert.strictEqual(calls.length, 1, 'exactly one top-level await runOwnerBackfill({ db })');
    assert.ok(calls[0].index > ensure, 'after await ensureIndexes(db)');
    assert.ok(calls[0].index < listen, 'before app.listen(');
    const codeCalls = src.split('\n').filter(l => /\brunOwnerBackfill\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    assert.strictEqual(codeCalls.length, 1, 'boot calls it once, in the default write mode (no write flag)');
  });

  test('lib/owner-backfill.js reads no env var and imports nothing from scripts/', () => {
    const src = stripComments(readFileSync(MODULE_PATH, 'utf8'));
    assert.ok(!src.includes('process.env'), 'no env var: a production env var would be host configuration');
    assert.ok(!/from\s*['"][^'"]*scripts\//.test(src), 'lib/ never imports scripts/');
    assert.ok(!/import\(\s*['"][^'"]*scripts\//.test(src), 'no dynamic import of scripts/ either');
  });

  test('the pins, cutoff and index name are source literals with the plan §B values', () => {
    const src = readFileSync(MODULE_PATH, 'utf8');
    assert.match(src, new RegExp(`export const PIN_ACCOUNT\\s*=\\s*['"]${PIN_ACCOUNT}['"]`));
    assert.match(src, new RegExp(`export const PIN_LINEAR_SCOPE\\s*=\\s*['"]${PIN_LINEAR_SCOPE}['"]`));
    assert.match(src, /export const CUTOFF\s*=\s*new Date\(['"]2026-09-29T19:35:00(\.000)?Z['"]\)/);
    assert.match(src, new RegExp(`export const OWNER_INDEX_NAME\\s*=\\s*['"]${OWNER_INDEX_NAME}['"]`));
  });

  test('PIN_LINEAR_SCOPE is used only as the identity lookup/count value: never in a logger call, template or error string', () => {
    const src = stripComments(readFileSync(MODULE_PATH, 'utf8'));
    assert.strictEqual(src.split(PIN_LINEAR_SCOPE).length - 1, 1, 'the viewer-id literal appears once, in its declaration');

    const uses = src.split('\n').filter(l => /\bPIN_LINEAR_SCOPE\b/.test(l) && !/export const PIN_LINEAR_SCOPE\s*=/.test(l));
    assert.ok(uses.length > 0, 'the identity gate uses the pin');
    for (const line of uses) {
      assert.ok(!/\b(logger|console)\.\w+\s*\(/.test(line), `not passed to a logger: ${line.trim()}`);
      assert.ok(!/\$\{[^}]*\bPIN_LINEAR_SCOPE\b/.test(line), `not interpolated into a template: ${line.trim()}`);
      assert.ok(!/\bError\s*\(/.test(line), `not in an error: ${line.trim()}`);
      assert.ok(!/\+\s*PIN_LINEAR_SCOPE\b|\bPIN_LINEAR_SCOPE\s*\+/.test(line), `not concatenated into a string: ${line.trim()}`);
      assert.match(
        line,
        /scope\s*:\s*PIN_LINEAR_SCOPE\b|findAccountByIdentity\(\s*['"]linear['"]\s*,\s*PIN_LINEAR_SCOPE\s*\)/,
        `only as the identity lookup/count value: ${line.trim()}`
      );
    }
  });
});
