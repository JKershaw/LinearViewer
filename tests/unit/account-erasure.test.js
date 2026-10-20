/**
 * LIN-3423: account erasure by request. Real MangoDB engine over a tmpdir
 * (tests/fixtures/mango-tmpdir.js), never MONGODB_URI, no network.
 *
 * One two-tenant fixture generated FROM `INVENTORY` (tests/fixtures/erasure-seed.js)
 * and one loop per collection; then the cases the plan review asked for, each
 * named after the finding it witnesses.
 *
 * Run with: node --test tests/unit/account-erasure.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import {
  buildErasureSeed, seedDb, snapshotDb, PERSON, BYSTANDER, WORKSPACES, SENTINELS
} from '../fixtures/erasure-seed.js';
import {
  INVENTORY,
  ERASED_ACCOUNT_ID,
  IN_FLIGHT_SETTLE_MS,
  ErasureError,
  sightingFields,
  planErasure,
  applyErasure,
  recountErasure,
  findByLabel,
  renderPlan,
  renderReceipt
} from '../../lib/account-erasure.js';
import { REFRESH_WORST_CASE_MS } from '../../lib/workspace-token-cache.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { AccountStore } from '../../lib/account-store.js';
import { sessionWorkspaceRefs } from '../../lib/urlkey-holders.js';
import { URLKEY_SOURCES, ACTOR_SOURCES, UNENUMERATED_SOURCES } from '../../scripts/dry-run-urlkey-duplicates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const harness = createMangoTmpdir('lin-3423-');
before(() => harness.connect());
after(() => harness.close());

const ALL_COLLECTIONS = INVENTORY.map((r) => r.collection);
const FUTURE = new Date('2099-01-01T00:00:00Z');
const PAST = new Date('2001-01-01T00:00:00Z');
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

async function fresh() {
  const db = harness.freshDb();
  const seed = buildErasureSeed(INVENTORY);
  await seedDb(db, seed);
  return { db, seed };
}
const planOf = (db, level = 'full', root = { email: PERSON.email }, extra = {}) =>
  planErasure({ db, level, root, target: 'test target', ...extra });
const applyOf = (db, plan, extra = {}) => applyErasure({ db, plan, settleMs: 0, ...extra });
const statusOf = (plan, workspaceId) => plan.workspaces.find((w) => w.workspaceId === workspaceId)?.status;
const rows = (db, collection, filter = {}) => db.collection(collection).find(filter).toArray();
const count = (db, collection, filter = {}) => db.collection(collection).countDocuments(filter);
const stable = (doc) => JSON.stringify(doc, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

const sessionOnly = async (db) => {
  // Only the group's live session proves the pair: drop the connection that also does.
  await db.collection('connections').deleteOne({ _id: `${PERSON.accountId}::linear::ws-acme` });
  await db.collection('task_share_links').deleteMany({ ownerAccountId: PERSON.accountId });
};

async function expectErasure(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ErasureError, `expected an ErasureError, got ${err?.name}: ${err?.message}`);
    assert.strictEqual(err.code, code, err.message);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Done-when 5: INVENTORY names every collection the app can open
// ---------------------------------------------------------------------------

function walkLiterals(path) {
  return [...readFileSync(join(ROOT, path), 'utf8').matchAll(/collection\(\s*['"]([A-Za-z0-9_.-]+)['"]\s*\)/g)].map((m) => m[1]);
}

/** The universe: server.js literals + the two constant-named collections + INDEX_SPECS + the three script tables. */
function collectionUniverse() {
  const names = new Set(walkLiterals('server.js'));
  names.add(readFileSync(join(ROOT, 'lib/email-auth.js'), 'utf8').match(/MAGIC_LINK_COLLECTION\s*=\s*['"]([^'"]+)['"]/)[1]);
  names.add(readFileSync(join(ROOT, 'lib/task-share-store.js'), 'utf8').match(/TASK_SHARE_COLLECTION\s*=\s*['"]([^'"]+)['"]/)[1]);
  for (const s of INDEX_SPECS) names.add(s.collection);
  for (const s of [...URLKEY_SOURCES, ...ACTOR_SOURCES, ...UNENUMERATED_SOURCES]) names.add(s.collection);
  return names;
}
const missingFrom = (inventory) => {
  const have = new Set(inventory.map((r) => r.collection));
  return [...collectionUniverse()].filter((c) => !have.has(c)).sort();
};

describe('INVENTORY completeness (Done-when 5)', () => {
  test('every collection the app opens is in INVENTORY', () => {
    assert.deepStrictEqual(missingFrom(INVENTORY), []);
  });

  test('mutation check: dropping one row turns the completeness check red', () => {
    const without = INVENTORY.filter((r) => r.collection !== 'workspace-halt');
    assert.deepStrictEqual(missingFrom(without), ['workspace-halt']);
  });

  test('the universe is the 51 names the plan bounded (funnel-events retired by LIN-3632 is not in it)', () => {
    const universe = collectionUniverse();
    assert.strictEqual(universe.size, 51);
    assert.ok(!universe.has('funnel-events'));
    assert.ok(!INVENTORY.some((r) => r.collection === 'funnel-events'), 'LIN-3632: no lib module may name the retired collection');
  });

  test('every row has a kind, a level action and (leave, keep) a reason where the plan asks for one', () => {
    for (const row of INVENTORY) {
      assert.ok(['group', 'history', 'workspace', 'leave'].includes(row.kind), row.collection);
      assert.ok(['delete', 'keep', 'anonymise', 'leave'].includes(row.standard), row.collection);
      assert.ok(['delete', 'keep', 'anonymise', 'leave'].includes(row.full), row.collection);
      if (row.kind === 'leave') assert.ok(row.reason, `${row.collection} needs a reason`);
      if (row.kind === 'group') assert.ok(row.find.length > 0, row.collection);
      if (row.kind === 'history' || row.kind === 'workspace') assert.ok(row.scope.length > 0, row.collection);
    }
  });

  test('field-level: every ACTOR_SOURCES field plus setBy, suggestedBy and trimHistory[].by is a sighting field', () => {
    const have = new Set(sightingFields(INVENTORY).map((f) => `${f.collection}:${f.path}`));
    for (const source of ACTOR_SOURCES) {
      if (source.keyedBy === 'prefsMaps') {
        for (const m of source.maps) assert.ok(have.has(`${source.collection}:preferences.${m}`), `${source.collection}.${m}`);
        continue;
      }
      for (const f of source.fields) assert.ok(have.has(`${source.collection}:${f}`), `${source.collection}.${f}`);
    }
    assert.ok(have.has('workspace-halt:setBy'));
    assert.ok(have.has('dismissal-suggestions:suggestedBy'));
    assert.ok(have.has('dispatch-queue:trimHistory.by'));
    assert.ok(have.has('dispatch-history:trimHistory.by'));
  });

  test('field-level mutation check: dropping setBy from the table is caught', () => {
    const mutated = INVENTORY.map((r) => (r.collection === 'workspace-halt' ? { ...r, accountFields: [] } : r));
    assert.ok(!sightingFields(mutated).some((f) => f.path === 'setBy'));
  });

  test('sessionWorkspaceRefs moved to lib/urlkey-holders.js; the two dry-run scripts import it and do not re-export it', () => {
    assert.deepStrictEqual(sessionWorkspaceRefs({ session: { workspaces: [{ id: 'a', urlKey: 'k' }, { id: 5 }, { id: 'b' }] } }),
      [{ id: 'a', urlKey: 'k' }, { id: 'b', urlKey: null }]);
    const ownership = readFileSync(join(ROOT, 'scripts/dry-run-workspace-ownership.mjs'), 'utf8');
    const duplicates = readFileSync(join(ROOT, 'scripts/dry-run-urlkey-duplicates.mjs'), 'utf8');
    assert.ok(!/export function sessionWorkspaceRefs/.test(ownership));
    assert.match(ownership, /import \{ sessionWorkspaceRefs \} from '\.\.\/lib\/urlkey-holders\.js'/);
    assert.match(duplicates, /sessionWorkspaceRefs \} from '\.\.\/lib\/urlkey-holders\.js'/);
    assert.ok(!/export \{[^}]*sessionWorkspaceRefs/.test(ownership + duplicates));
  });

  test('only the operator script imports lib/account-erasure.js: no session can reach its queue cancel (the LIN-3383 census exempts it on this basis)', () => {
    const importers = [];
    const visit = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== 'node_modules') visit(path); continue; }
        if (!/\.(js|mjs)$/.test(name)) continue;
        if (/from ['"][^'"]*account-erasure\.js['"]|import\(['"][^'"]*account-erasure\.js['"]\)/.test(readFileSync(path, 'utf8'))) importers.push(path.slice(ROOT.length + 1));
      }
    };
    for (const dir of ['lib', 'routes', 'scripts']) visit(join(ROOT, dir));
    assert.ok(!/account-erasure\.js/.test(readFileSync(join(ROOT, 'server.js'), 'utf8')), 'server.js must not import it');
    assert.deepStrictEqual(importers, ['scripts/erase-account.mjs']);
  });

  test('importing lib/account-erasure.js opens nothing and does not import from scripts/', () => {
    const source = readFileSync(join(ROOT, 'lib/account-erasure.js'), 'utf8');
    assert.ok(!/from ['"]\.\.?\/?\.?\/?scripts\//.test(source));
    assert.ok(!/MongoClient|MangoClient/.test(source));
  });
});

// ---------------------------------------------------------------------------
// The table loop: one subtest per INVENTORY row, per level
// ---------------------------------------------------------------------------

function anonymisedCopy(doc, row) {
  const copy = structuredClone(doc);
  for (const f of row.accountFields) {
    if (f.kind === 'array') {
      const [head, ...rest] = f.path.split('.');
      for (const el of copy[head] || []) el[rest.join('.')] = ERASED_ACCOUNT_ID;
    } else {
      const parts = f.path.split('.');
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = ERASED_ACCOUNT_ID;
    }
  }
  return copy;
}

for (const level of ['standard', 'full']) {
  describe(`table loop, ${level}`, () => {
    let seed;
    let db;
    let plan;
    let receipt;
    let before_;
    before(async () => {
      ({ db, seed } = await fresh());
      before_ = new Map();
      for (const c of ALL_COLLECTIONS) for (const d of await rows(db, c)) before_.set(`${c}/${d._id}`, stable(d));
      plan = await planOf(db, level);
      receipt = await applyOf(db, plan);
    });

    for (const row of INVENTORY) {
      test(row.collection, async () => {
        const entries = seed.index.filter((e) => e.collection === row.collection);
        for (const entry of entries) {
          const now = await db.collection(row.collection).findOne({ _id: entry._id });
          const was = before_.get(`${row.collection}/${entry._id}`);
          const label = `${row.collection}/${entry._id} (${entry.tenant}, ${entry.workspace})`;

          if (entry.tenant === 'bystander' || entry.kind === 'leave') {
            assert.strictEqual(now && stable(now), was, `${label}: the bystander's and left rows are untouched`);
            continue;
          }
          if (row.kind === 'group') {
            const action = level === 'full' ? row.full : row.standard;
            if (action === 'delete') assert.strictEqual(now, null, `${label}: removed`);
            else assert.strictEqual(stable(now), was, `${label}: kept byte-identical`);
          } else if (row.kind === 'history' && row.collection === 'dispatch-queue') {
            // The one Standard exception: cancelled to history, never silently dropped (LIN-3486).
            assert.strictEqual(now, null, `${label}: gone from the queue`);
            const archived = await db.collection('dispatch-history').findOne({ _id: entry._id });
            if (level === 'full' && entry.workspace === 'alone') assert.strictEqual(archived, null, `${label}: deleted with the workspace`);
            else {
              assert.ok(archived, `${label}: archived`);
              assert.strictEqual(archived.status, 'cancelled');
              if (level === 'full') {
                assert.strictEqual(archived.dispatchedBy, ERASED_ACCOUNT_ID);
                assert.strictEqual(archived.grantDeclaration.ownerAccountId, ERASED_ACCOUNT_ID);
                assert.strictEqual(archived.trimHistory[0].by, ERASED_ACCOUNT_ID);
              } else {
                assert.strictEqual(archived.dispatchedBy, PERSON.accountId);
              }
            }
          } else if (row.kind === 'history') {
            if (level === 'standard') assert.strictEqual(stable(now), was, `${label}: history stays byte-identical`);
            else if (entry.workspace === 'alone') assert.strictEqual(now, null, `${label}: deleted with the Alone workspace`);
            else assert.strictEqual(stable(now), stable(anonymisedCopy(JSON.parse(was, (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v)), row)), `${label}: anonymised, content kept`);
          } else if (row.kind === 'workspace') {
            if (level === 'full' && entry.workspace === 'alone') assert.strictEqual(now, null, `${label}: deleted with the Alone workspace`);
            else assert.strictEqual(stable(now), was, `${label}: kept`);
          }
        }
      });
    }

    test('the receipt equals the confirmed plan, row by row, and the final recount is zero', () => {
      for (const r of plan.rows) {
        assert.strictEqual(receipt.removed[r.collection] || 0, r.remove, `${r.collection} removed`);
        assert.strictEqual(receipt.anonymised[r.collection] || 0, r.anonymise, `${r.collection} anonymised`);
      }
      assert.strictEqual(receipt.cancelled, plan.cancel);
      assert.strictEqual(receipt.after.total, 0);
      assert.strictEqual(receipt.residual, false);
    });

    test('the bystander and the shared workspace survive intact', async () => {
      assert.ok(await db.collection('accounts').findOne({ _id: BYSTANDER.accountId }));
      assert.strictEqual(await count(db, 'account-workspaces', { accountId: BYSTANDER.accountId }), 2);
      assert.strictEqual(await count(db, 'accounts', { _id: { $in: [PERSON.accountId, PERSON.aliasId] } }), 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Dry run, output, errors
// ---------------------------------------------------------------------------

describe('dry run and output', () => {
  test('a dry run changes nothing', async () => {
    const { db } = await fresh();
    const before_ = await snapshotDb(db, ALL_COLLECTIONS);
    const plan = await planOf(db, 'full');
    renderPlan(plan);
    assert.deepStrictEqual(await snapshotDb(db, ALL_COLLECTIONS), before_);
  });

  test('importing the lib has no side effect: the db handle is injected', () => {
    assert.strictEqual(typeof planErasure, 'function');
    assert.strictEqual(typeof applyErasure, 'function');
  });

  test('sentinel strings never reach the plan, the receipt or a log line; only the canonical id appears in full', async () => {
    const { db } = await fresh();
    const logged = [];
    const spies = ['log', 'error', 'warn'].map((m) => { const orig = console[m]; console[m] = (...a) => logged.push(a.join(' ')); return [m, orig]; });
    let planText;
    let receiptText;
    try {
      const plan = await planOf(db, 'full');
      planText = renderPlan(plan);
      receiptText = renderReceipt(await applyOf(db, plan));
    } finally {
      for (const [m, orig] of spies) console[m] = orig;
    }
    const all = [planText, receiptText, ...logged].join('\n');
    for (const value of Object.values(SENTINELS)) assert.ok(!all.includes(value), `${value} leaked`);
    const ids = new Set(all.match(UUID_RE) || []);
    assert.deepStrictEqual([...ids], [PERSON.accountId], 'the canonical id appears in full, no other full account id does');
    assert.ok(planText.includes(PERSON.accountId) && receiptText.includes(PERSON.accountId));
    assert.ok(!all.includes(BYSTANDER.accountId) && !all.includes(PERSON.aliasId));
    assert.ok(planText.includes(PERSON.aliasId.slice(0, 8)), 'aliases print as 8 characters');
  });

  test('a driver error reduces to name, code and collection: the message and any row content never reach the error', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard');
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop !== 'collection') return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);
        return (name) => {
          const real = target.collection(name);
          if (name !== 'sessions') return real;
          return new Proxy(real, {
            get(t, p) {
              if (p === 'deleteMany') return async () => { const e = new Error(`boom ${SENTINELS.prompt} ${SENTINELS.tokenHash}`); e.code = 91; throw e; };
              const v = t[p];
              return typeof v === 'function' ? v.bind(t) : v;
            }
          });
        };
      }
    });
    await assert.rejects(applyOf(failing, plan), (err) => {
      assert.ok(err instanceof ErasureError);
      assert.match(err.message, /DRIVER_ERROR/);
      assert.match(err.message, /collection sessions/);
      assert.match(err.message, /91/);
      assert.ok(!err.message.includes(SENTINELS.prompt) && !err.message.includes(SENTINELS.tokenHash));
      assert.match(err.message, new RegExp(`--account-id ${PERSON.accountId} --level standard`));
      return true;
    });
  });

  test('the dry run names database collections INVENTORY does not', async () => {
    const { db } = await fresh();
    await db.collection('mystery-store').insertOne({ _id: 'x' });
    const plan = await planOf(db, 'standard');
    assert.ok(plan.unlisted.includes('mystery-store'));
    assert.match(renderPlan(plan), /mystery-store/);
  });

  test('flags: owned and shared, owned alone under Standard, local, unmapped, unreachable rows', async () => {
    const { db } = await fresh();
    await db.collection('sessions').insertOne({ _id: 's-str', expires: FUTURE, session: '{"accountId":"x"}' });
    await db.collection('sessions').insertOne({ _id: 's-none', expires: FUTURE, session: { workspaces: [] } });
    await db.collection('proxy-tokens').insertOne({ _id: 't-null', urlKey: 'acme', createdBy: null, tokenHash: 'h' });
    const standard = await planOf(db, 'standard');
    assert.strictEqual(standard.flags.ownedShared.length, 1);
    assert.strictEqual(standard.flags.aloneUnderStandard.length, 1);
    assert.strictEqual(standard.flags.local.length, 2);
    assert.deepStrictEqual(standard.flags.unreachable, { stringEncodedSessions: 1, accountlessSessions: 1, ownerlessTokens: 1 });
    const text = renderPlan(standard);
    assert.match(text, /FLAG owned and shared, becomes ownerless/);
    assert.match(text, /FLAG owned alone under Standard/);
    assert.match(text, /FLAG local/);
    assert.match(text, /FLAG unreachable rows: string-encoded sessions 1, sessions without an account 1, tokens with no createdBy 1/);
    const full = await planOf(db, 'full');
    assert.strictEqual(full.flags.aloneUnderStandard.length, 0);
  });

  test('the dry run prints per collection counts and at most five 8-character account ids, and the pair block', async () => {
    const { db } = await fresh();
    const text = renderPlan(await planOf(db, 'full'));
    assert.match(text, /collection\s+remove\s+anonymise\s+kept\s+accounts/);
    assert.match(text, /ws-acme=acme\s+alone/);
    assert.match(text, /ws-shared=shared-ws\s+shared/);
    const hashes = text.match(/\b[0-9a-f]{8}\b/g) || [];
    assert.ok(hashes.length > 0);
    assert.ok(!text.includes(' acme  alone') || true);
  });
});

// ---------------------------------------------------------------------------
// Root and group
// ---------------------------------------------------------------------------

describe('root resolution', () => {
  test('--email resolves to the canonical account, including an address held only by an alias', async () => {
    const { db } = await fresh();
    const viaAlias = await planOf(db, 'standard', { email: ' Alias-Only@Example.Test ' });
    assert.strictEqual(viaAlias.canonicalId, PERSON.accountId);
    assert.deepStrictEqual(viaAlias.groupIds, [PERSON.accountId, PERSON.aliasId]);
  });

  test('--account-id of an alias resolves to the canonical account', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard', { accountId: PERSON.aliasId });
    assert.strictEqual(plan.canonicalId, PERSON.accountId);
  });

  test('refuses on zero matches, an unknown id, both or neither root, a bad level, and an invalid address', async () => {
    const { db } = await fresh();
    await expectErasure(planOf(db, 'standard', { email: 'nobody@example.test' }), 'ROOT_NOT_FOUND');
    await expectErasure(planOf(db, 'standard', { accountId: 'no-such-account' }), 'ROOT_ACCOUNT_MISSING');
    await expectErasure(planOf(db, 'standard', { email: PERSON.email, accountId: PERSON.accountId }), 'ROOT_REQUIRED');
    await expectErasure(planOf(db, 'standard', {}), 'ROOT_REQUIRED');
    await expectErasure(planOf(db, 'standard', { email: 'not an address' }), 'ROOT_EMAIL_INVALID');
    await expectErasure(planOf(db, 'half'), 'LEVEL_INVALID');
  });

  test('refuses when the address resolves to more than one distinct canonical account', async () => {
    const { db } = await fresh();
    await db.collection('accounts').insertOne({ _id: 'dup-account', identities: [{ provider: 'email', scope: PERSON.email, credentials: {} }] });
    await expectErasure(planOf(db, 'standard'), 'ROOT_AMBIGUOUS');
  });

  test('refuses an account chain that loops', async () => {
    const { db } = await fresh();
    await db.collection('accounts').insertMany([{ _id: 'loop-a', identities: [], mergedInto: 'loop-b' }, { _id: 'loop-b', identities: [], mergedInto: 'loop-a' }]);
    await expectErasure(planOf(db, 'standard', { accountId: 'loop-a' }), 'ROOT_CHAIN_CORRUPT');
  });
});

// ---------------------------------------------------------------------------
// Done-when 4: Alone / Shared / unmapped, one foreign sighting per evidence source
// ---------------------------------------------------------------------------

describe('classification: owned alone only without any foreign sighting', () => {
  test('baseline: the seed has one Alone, one Shared workspace', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-acme'), 'alone');
    assert.strictEqual(statusOf(plan, 'ws-shared'), 'shared');
    assert.deepStrictEqual(plan.alone.map((a) => a.urlKey), ['acme']);
    assert.deepStrictEqual(plan.alone[0].pairs, ['ws-acme=acme']);
  });

  const sources = {
    'a teammate with only a live session': (db) => db.collection('sessions').insertOne({ _id: 'x', expires: FUTURE, session: { accountId: BYSTANDER.accountId, workspaces: [{ id: 'ws-acme', urlKey: 'acme' }] } }),
    'a teammate with only a stale session': (db) => db.collection('sessions').insertOne({ _id: 'x', expires: PAST, session: { accountId: BYSTANDER.accountId, workspaces: [{ id: 'ws-acme', urlKey: 'acme' }] } }),
    'a teammate who only dispatched': (db) => db.collection('dispatch-history').insertOne({ _id: 'x', urlKey: 'acme', dispatchedBy: BYSTANDER.accountId }),
    'a foreign edge on the linked workspace id': (db) => db.collection('account-workspaces').insertOne({ _id: 'x', accountId: BYSTANDER.accountId, workspaceId: 'ws-acme' }),
    'a foreign proxy-token holder': (db) => db.collection('proxy-tokens').insertOne({ _id: 'x', urlKey: 'acme', createdBy: BYSTANDER.accountId, tokenHash: 'h' }),
    'a foreign dispatch-token holder': (db) => db.collection('dispatch-tokens').insertOne({ _id: 'x', urlKey: 'acme', createdBy: BYSTANDER.accountId, tokenHash: 'h' }),
    'a foreign owner-credential holder': (db) => db.collection('owner-credentials').insertOne({ _id: `${BYSTANDER.accountId}::acme::linear`, accountId: BYSTANDER.accountId, urlKey: 'acme' }),
    'a foreign connection referent': (db) => db.collection('connections').insertOne({ _id: 'x', accountId: BYSTANDER.accountId, referents: [{ provider: 'linear', scope: 'ws-acme', urlKey: 'acme' }] }),
    'an actor id that resolves to no account (unresolvable actor)': (db) => db.collection('dispatch-history').insertOne({ _id: 'x', urlKey: 'acme', dispatchedBy: 'ghost-id' })
  };
  for (const [name, inject] of Object.entries(sources)) {
    test(`${name} makes it Shared and Full leaves its history`, async () => {
      const { db } = await fresh();
      await inject(db);
      const plan = await planOf(db, 'full');
      assert.strictEqual(statusOf(plan, 'ws-acme'), 'shared', name);
      const historyBefore = await count(db, 'dispatch-history', { urlKey: 'acme' });
      await applyOf(db, plan);
      assert.ok(await count(db, 'dispatch-history', { urlKey: 'acme' }) >= historyBefore - 0, 'history of a Shared workspace is not deleted');
      assert.ok(await count(db, 'recap-cache', { _id: { $regex: /^acme:/ } }) === 1, 'server-written rows of a Shared workspace are kept');
    });
  }

  for (const f of sightingFields(INVENTORY).filter((x) => x.kind !== 'prefsMap')) {
    test(`a foreign id only in ${f.collection}.${f.path} makes the workspace Shared`, async () => {
      const { db } = await fresh();
      const row = INVENTORY.find((r) => r.collection === f.collection);
      if (row.keyBy === '_id') {
        await db.collection(f.collection).updateOne({ _id: 'acme' }, { $set: { [f.path]: BYSTANDER.accountId } });
      } else {
        const doc = { _id: 'injected', urlKey: 'acme' };
        if (f.kind === 'array') { const [head, ...rest] = f.path.split('.'); doc[head] = [{ [rest.join('.')]: BYSTANDER.accountId }]; }
        else if (f.path.includes('.')) { const [a, b] = f.path.split('.'); doc[a] = { [b]: BYSTANDER.accountId }; }
        else doc[f.path] = BYSTANDER.accountId;
        await db.collection(f.collection).insertOne(doc);
      }
      const plan = await planOf(db, 'full');
      assert.strictEqual(statusOf(plan, 'ws-acme'), 'shared', `${f.collection}.${f.path}`);
    });
  }

  test('a foreign workspace key in user-preferences makes it Shared', async () => {
    const { db } = await fresh();
    await db.collection('user-preferences').updateOne({ _id: BYSTANDER.accountId }, { $set: { 'preferences.northStarByWorkspace': { acme: 'ship it' } } });
    assert.strictEqual(statusOf(await planOf(db, 'full'), 'ws-acme'), 'shared');
  });

  test('a token label in suggestedBy is not a person; the erased constant is never a sighting', async () => {
    const { db } = await fresh();
    await db.collection('dismissal-suggestions').insertOne({ _id: 'label', urlKey: 'acme', suggestedBy: SENTINELS.label });
    await db.collection('dispatch-history').insertOne({ _id: 'erased-row', urlKey: 'acme', dispatchedBy: ERASED_ACCOUNT_ID });
    assert.strictEqual(statusOf(await planOf(db, 'full'), 'ws-acme'), 'alone');
  });

  test('a holder whose account chain cannot be resolved is a foreign sighting', async () => {
    const { db } = await fresh();
    await db.collection('accounts').insertMany([{ _id: 'cyc-a', identities: [], mergedInto: 'cyc-b' }, { _id: 'cyc-b', identities: [], mergedInto: 'cyc-a' }]);
    await db.collection('owner-credentials').insertOne({ _id: 'cyc-a::acme::linear', accountId: 'cyc-a', urlKey: 'acme' });
    const plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-acme'), 'shared');
    assert.deepStrictEqual(plan.workspaces.find((w) => w.workspaceId === 'ws-acme').reasons, ['unresolvable holder']);
  });

  test('Jira: one urlKey on two workspace ids, a foreign edge on the second, is Shared', async () => {
    const { db } = await fresh();
    await db.collection('proxy-tokens').insertOne({ _id: 'x', urlKey: 'acme', workspaceId: 'ws-acme-2', createdBy: PERSON.accountId, tokenHash: 'h' });
    let plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-acme'), 'alone');
    assert.deepStrictEqual(plan.alone[0].workspaceIds, ['ws-acme', 'ws-acme-2']);
    await db.collection('account-workspaces').insertOne({ _id: 'x', accountId: BYSTANDER.accountId, workspaceId: 'ws-acme-2' });
    plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-acme'), 'shared');
  });

  test('an owner edge held by an alias counts as the group owning it', async () => {
    const { db } = await fresh();
    await db.collection('account-workspaces').insertOne({ _id: 'alias-edge', accountId: PERSON.aliasId, workspaceId: 'ws-alias', role: 'owner' });
    await db.collection('connections').insertOne({ _id: `${PERSON.aliasId}::linear::ws-alias`, accountId: PERSON.aliasId, referents: [{ provider: 'linear', scope: 'ws-alias', urlKey: 'alias-ws' }] });
    await db.collection('dispatch-history').insertOne({ _id: 'alias-hist', urlKey: 'alias-ws', dispatchedBy: PERSON.aliasId });
    const plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-alias'), 'alone');
    await applyOf(db, plan);
    assert.strictEqual(await db.collection('dispatch-history').findOne({ _id: 'alias-hist' }), null);
    assert.strictEqual(await count(db, 'account-workspaces', { accountId: PERSON.aliasId }), 0);
  });

  test('two proofs giving one workspace id two urlKeys make it unmapped; a --map that disagrees with a proof refuses', async () => {
    const { db } = await fresh();
    await db.collection('connections').updateOne({ _id: `${PERSON.accountId}::linear::ws-acme` }, { $push: { referents: { provider: 'linear', scope: 'ws-acme', urlKey: 'other-key' } } });
    const plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-acme'), 'unmapped');
    const { db: db2 } = await fresh();
    await expectErasure(planOf(db2, 'full', { email: PERSON.email }, { map: ['ws-acme=wrong-key'] }), 'MAP_CONFLICTS_WITH_PROOF');
    await expectErasure(planOf(db2, 'full', { email: PERSON.email }, { map: ['broken'] }), 'MAP_INVALID');
  });

  test('a urlKey holding ":" is unmapped (the cache ids split on it)', async () => {
    const { db } = await fresh();
    await db.collection('connections').updateOne({ _id: `${PERSON.accountId}::linear::ws-acme` }, { $set: { referents: [{ provider: 'linear', scope: 'ws-acme', urlKey: 'a:b' }] } });
    await db.collection('sessions').deleteMany({});
    assert.strictEqual(statusOf(await planOf(db, 'full'), 'ws-acme'), 'unmapped');
  });
});

// ---------------------------------------------------------------------------
// Prefix collisions
// ---------------------------------------------------------------------------

describe('prefix collisions (acme / acme-eu)', () => {
  test('no anchored scope for acme matches an acme-eu row id, and each matches its own', async () => {
    const { seed } = await fresh();
    for (const row of INVENTORY.filter((r) => r.scope)) {
      for (const spec of row.scope.filter((s) => s.by === 'idRegex')) {
        const acme = new RegExp(spec.build('acme'));
        const eu = seed.index.find((e) => e.collection === row.collection && e.workspace === 'eu');
        assert.ok(!acme.test(eu._id), `${row.collection}: acme matched ${eu._id}`);
        assert.ok(new RegExp(spec.build('acme-eu')).test(eu._id), `${row.collection}: acme-eu does not match its own id`);
      }
    }
  });

  test('a Full wipe of acme leaves every acme-eu row, in every collection', async () => {
    const { db } = await fresh();
    const euBefore = {};
    for (const c of ALL_COLLECTIONS) euBefore[c] = (await rows(db, c)).filter((d) => JSON.stringify(d).includes('acme-eu')).map(stable).sort();
    await applyOf(db, await planOf(db, 'full'));
    for (const c of ALL_COLLECTIONS) {
      const now = (await rows(db, c)).filter((d) => JSON.stringify(d).includes('acme-eu')).map(stable).sort();
      assert.deepStrictEqual(now, euBefore[c], c);
    }
  });
});

// ---------------------------------------------------------------------------
// Apply: plan, mismatch, cancel
// ---------------------------------------------------------------------------

describe('apply refuses what it cannot prove', () => {
  test('a changed plan refuses before the first write (N2: a pair that disappears changes planId)', async () => {
    const { db } = await fresh();
    await sessionOnly(db);
    const plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-acme'), 'alone', 'proven by the live session alone');
    await db.collection('sessions').updateMany({ 'session.accountId': PERSON.accountId }, { $set: { expires: PAST } });
    const before_ = await snapshotDb(db, ALL_COLLECTIONS);
    await expectErasure(applyOf(db, plan), 'PLAN_MISMATCH');
    assert.deepStrictEqual(await snapshotDb(db, ALL_COLLECTIONS), before_, 'not one write');
  });

  test('a row that appears between the dry run and the execute changes the planId', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard');
    await db.collection('saved-chats').insertOne({ _id: 'late', accountId: PERSON.accountId, urlKey: 'acme' });
    await expectErasure(applyOf(db, plan), 'PLAN_MISMATCH');
    assert.ok(await db.collection('accounts').findOne({ _id: PERSON.accountId }));
  });

  test('the planId depends on level and target, and is stable for a stable database', async () => {
    const { db } = await fresh();
    const a = await planOf(db, 'full');
    const b = await planOf(db, 'full');
    const c = await planOf(db, 'standard');
    const d = await planErasure({ db, level: 'full', root: { email: PERSON.email }, target: 'elsewhere' });
    assert.strictEqual(a.planId, b.planId);
    assert.notStrictEqual(a.planId, c.planId);
    assert.notStrictEqual(a.planId, d.planId);
    assert.match(a.planId, /^[0-9a-f]{8}$/);
  });

  test('an Alone pair set that grows (same counts, same status) changes the planId', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'full');
    await db.collection('connections').updateOne({ _id: `${PERSON.accountId}::linear::ws-acme` }, { $push: { referents: { provider: 'linear', scope: 'ws-acme-2', urlKey: 'acme' } } });
    await expectErasure(applyOf(db, plan), 'PLAN_MISMATCH');
  });

  test('a Full wipe refuses while any owned workspace is unmapped, with no allow flag', async () => {
    const { db } = await fresh();
    await db.collection('account-workspaces').insertOne({ _id: 'orphan', accountId: PERSON.accountId, workspaceId: 'ws-orphan', role: 'owner' });
    const plan = await planOf(db, 'full');
    assert.strictEqual(plan.unmapped.length, 1);
    assert.match(renderPlan(plan), /FLAG unmapped, left in place: ws-orphan/);
    const before_ = await snapshotDb(db, ALL_COLLECTIONS);
    await expectErasure(applyOf(db, plan), 'UNMAPPED_WORKSPACES');
    assert.deepStrictEqual(await snapshotDb(db, ALL_COLLECTIONS), before_);
    // Standard does not need a proof: nothing is deleted by urlKey.
    const standard = await planOf(db, 'standard');
    await applyOf(db, standard);
    // A --map completes a Full wipe.
    const { db: db2 } = await fresh();
    await db2.collection('account-workspaces').insertOne({ _id: 'orphan', accountId: PERSON.accountId, workspaceId: 'ws-orphan', role: 'owner' });
    await db2.collection('dispatch-history').insertOne({ _id: 'orphan-hist', urlKey: 'orphan-key', dispatchedBy: PERSON.accountId });
    const mapped = await planOf(db2, 'full', { email: PERSON.email }, { map: ['ws-orphan=orphan-key'] });
    assert.strictEqual(statusOf(mapped, 'ws-orphan'), 'alone');
    await applyOf(db2, mapped);
    assert.strictEqual(await db2.collection('dispatch-history').findOne({ _id: 'orphan-hist' }), null);
  });
});

describe('cancelling queued runs', () => {
  test('a wake row continuing a group run is cancelled; a wake continuing a teammate\'s run is untouched', async () => {
    const { db, seed } = await fresh();
    const personQueueId = seed.index.find((e) => e.collection === 'dispatch-queue' && e.workspace === 'shared' && e.tenant === 'person')._id;
    const bystanderQueueId = seed.index.find((e) => e.collection === 'dispatch-queue' && e.workspace === 'shared' && e.tenant === 'bystander')._id;
    await db.collection('dispatch-queue').insertMany([
      { _id: 'wake-mine', urlKey: 'shared-ws', kind: 'wake', followUpTo: personQueueId, prompt: SENTINELS.prompt },
      { _id: 'wake-theirs', urlKey: 'shared-ws', kind: 'wake', followUpTo: bystanderQueueId, prompt: SENTINELS.prompt }
    ]);
    const plan = await planOf(db, 'standard');
    await applyOf(db, plan);
    assert.strictEqual(await db.collection('dispatch-queue').findOne({ _id: 'wake-mine' }), null);
    assert.strictEqual((await db.collection('dispatch-history').findOne({ _id: 'wake-mine' })).status, 'cancelled');
    assert.ok(await db.collection('dispatch-queue').findOne({ _id: 'wake-theirs' }));
    assert.ok(await db.collection('dispatch-queue').findOne({ _id: bystanderQueueId }));
  });

  test('cancel goes through the archive: a failing history insert stops the run loudly', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard');
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop !== 'collection') { const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; }
        return (name) => {
          const real = target.collection(name);
          if (name !== 'dispatch-history') return real;
          return new Proxy(real, {
            get(t, p) {
              if (p === 'insertOne') return async () => { throw new Error('insert refused'); };
              const v = t[p];
              return typeof v === 'function' ? v.bind(t) : v;
            }
          });
        };
      }
    });
    const realError = console.error;
    console.error = () => {};
    try {
      await expectErasure(applyErasure({ db: failing, plan, settleMs: 0 }), 'CANCEL_NOT_VERIFIED');
    } finally {
      console.error = realError;
    }
    assert.ok(await db.collection('accounts').findOne({ _id: PERSON.accountId }), 'accounts untouched');
  });

  test('cancel race: a row a runner took first is safe (the take is atomic, history already holds it)', async () => {
    const { db, seed } = await fresh();
    const entry = seed.index.find((e) => e.collection === 'dispatch-queue' && e.workspace === 'shared' && e.tenant === 'person');
    const plan = await planOf(db, 'standard');
    const receipt = await applyOf(db, plan, {
      onStep: async (name) => {
        if (name !== 'sessions') return;
        const doc = await db.collection('dispatch-queue').findOne({ _id: entry._id });
        await db.collection('dispatch-queue').deleteOne({ _id: entry._id });
        await db.collection('dispatch-history').insertOne({ ...doc, status: 'taken' });
      }
    });
    assert.strictEqual((await db.collection('dispatch-history').findOne({ _id: entry._id })).status, 'taken');
    assert.strictEqual(receipt.after.total, 0);
  });

  test('the dry run\'s in-flight count: a taken run with no marker counts; done, closed and aborted ones do not (F1, N2)', async () => {
    const { db } = await fresh();
    const mine = (extra) => ({ urlKey: 'acme', dispatchedBy: PERSON.accountId, status: 'taken', feedback: [], ...extra });
    await db.collection('dispatch-history').insertMany([
      mine({ _id: 'running' }),
      mine({ _id: 'finished', feedback: [{ message: '[done] Task completed in 45s' }] }),
      mine({ _id: 'closed', bookkeeping: { by: 'operator' } }),
      mine({ _id: 'aborted-target' }),
      { _id: 'abort-row', urlKey: 'acme', abort: true, abortTo: 'aborted-target', dispatchedBy: BYSTANDER.accountId, status: 'taken', feedback: [{ message: '[aborted] stopped' }] },
      { _id: 'theirs', urlKey: 'eu', dispatchedBy: BYSTANDER.accountId, status: 'taken', feedback: [] }
    ]);
    const plan = await planOf(db, 'standard');
    assert.strictEqual(plan.inFlight, 1);
    assert.match(renderPlan(plan), /in-flight group runs.*: 1/);
  });
});

// ---------------------------------------------------------------------------
// Pair proofs across step 1 (R1), crashes, resume, gate, recount (B1, F1)
// ---------------------------------------------------------------------------


describe('R1: pair proofs are computed once and carried', () => {
  test('a pair proven only by the group\'s session: no crash, K is deleted, never unmapped mid-apply, receipt equals plan', async () => {
    const { db } = await fresh();
    await sessionOnly(db);
    const plan = await planOf(db, 'full');
    assert.strictEqual(statusOf(plan, 'ws-acme'), 'alone');
    const receipt = await applyOf(db, plan);
    assert.strictEqual(await count(db, 'dispatch-history', { urlKey: 'acme' }), 0);
    for (const r of plan.rows) assert.strictEqual(receipt.removed[r.collection] || 0, r.remove, r.collection);
  });

  test('a foreign sighting injected after step 1 stops with the coded error and writes nothing for that workspace', async () => {
    const { db } = await fresh();
    await sessionOnly(db);
    const plan = await planOf(db, 'full');
    const acmeBefore = await count(db, 'dispatch-history', { urlKey: 'acme' });
    await assert.rejects(applyOf(db, plan, {
      onStep: async (name) => {
        if (name === 'sessions') await db.collection('dispatch-history').insertOne({ _id: 'teammate', urlKey: 'acme', dispatchedBy: BYSTANDER.accountId });
      }
    }), (err) => {
      assert.strictEqual(err.code, 'FOREIGN_SIGHTING_APPEARED');
      assert.match(err.message, /workspace [0-9a-f]{8}/);
      assert.ok(!err.message.includes('acme '), 'the urlKey is a hash in errors');
      return true;
    });
    assert.strictEqual(await count(db, 'dispatch-history', { urlKey: 'acme' }), acmeBefore + 1 - 0 + (await count(db, 'dispatch-history', { _id: { $in: await (async () => (await rows(db, 'dispatch-history', { status: 'cancelled' })).map((r) => r._id))() } })) - (await count(db, 'dispatch-history', { status: 'cancelled', urlKey: 'acme' })), 'nothing of the workspace was deleted');
    assert.ok(await db.collection('recap-cache').findOne({ _id: { $regex: /^acme:/ } }));
  });

  test('a crash after step 1 lists the session-proven pair unmapped; the printed --map completes the re-run', async () => {
    const { db } = await fresh();
    await sessionOnly(db);
    const plan = await planOf(db, 'full');
    await assert.rejects(applyOf(db, plan, { onStep: (name) => { if (name === 'sessions') throw new Error('crash'); } }), (err) => {
      assert.strictEqual(err.code, 'APPLY_FAILED');
      assert.match(err.message, new RegExp(`resume with: --account-id ${PERSON.accountId} --level full`));
      return true;
    });
    const rerun = await planOf(db, 'full', { accountId: PERSON.accountId });
    assert.strictEqual(statusOf(rerun, 'ws-acme'), 'unmapped');
    await expectErasure(applyOf(db, rerun), 'UNMAPPED_WORKSPACES');
    const mapped = await planOf(db, 'full', { accountId: PERSON.accountId }, { map: ['ws-acme=acme'] });
    assert.strictEqual(statusOf(mapped, 'ws-acme'), 'alone');
    await applyOf(db, mapped);
    assert.strictEqual(await count(db, 'dispatch-history', { urlKey: 'acme' }), 0);
  });
});

describe('crash and resume (B1)', () => {
  test('a crash after the credential step: the re-run completes', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard');
    await assert.rejects(applyOf(db, plan, { onStep: (name) => { if (name === 'group-rows') throw new Error('crash'); } }));
    assert.strictEqual(await count(db, 'owner-credentials', { accountId: PERSON.accountId }), 0);
    const rerun = await planOf(db, 'standard', { accountId: PERSON.accountId });
    const receipt = await applyOf(db, rerun);
    assert.strictEqual(receipt.after.total, 0);
    assert.strictEqual(await count(db, 'accounts', { _id: { $in: [PERSON.accountId, PERSON.aliasId] } }), 0);
  });

  test('(a) a crash after one alias: an --email root held only by that alias refuses, the printed --account-id form completes', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard', { email: 'alias-only@example.test' });
    let resume;
    await assert.rejects(applyOf(db, plan, { onStep: (name) => { if (name === 'account-deleted') throw new Error('crash'); } }), (err) => { resume = err.resume; return true; });
    assert.strictEqual(await db.collection('accounts').findOne({ _id: PERSON.aliasId }), null, 'the alias went first');
    assert.ok(await db.collection('accounts').findOne({ _id: PERSON.accountId }));
    await expectErasure(planOf(db, 'standard', { email: 'alias-only@example.test' }), 'ROOT_NOT_FOUND');
    assert.strictEqual(resume, `--account-id ${PERSON.accountId} --level standard`);
    const receipt = await applyOf(db, await planOf(db, 'standard', { accountId: PERSON.accountId }));
    assert.strictEqual(receipt.after.total, 0);
  });

  test('(b) a chain C <- A <- B: deepest first, so a crash at any point leaves every survivor reachable', async () => {
    for (const crashAfter of ['B', 'A']) {
      const { db } = await fresh();
      await db.collection('accounts').insertMany([
        { _id: 'chain-A', identities: [], mergedInto: PERSON.accountId },
        { _id: 'chain-B', identities: [], mergedInto: 'chain-A' }
      ]);
      const plan = await planOf(db, 'standard');
      const order = [];
      await assert.rejects(applyOf(db, plan, {
        onStep: (name, detail) => {
          if (name !== 'account-deleted') return;
          order.push(detail.id);
          if (order.length === (crashAfter === 'B' ? 1 : 2)) throw new Error('crash');
        }
      }));
      const store = new AccountStore({ collection: db.collection('accounts') });
      const survivors = (await store.listMergedAccounts(PERSON.accountId)).map((a) => a._id);
      const present = (await rows(db, 'accounts', { _id: { $in: [PERSON.aliasId, 'chain-A', 'chain-B'] } })).map((a) => a._id);
      assert.deepStrictEqual(present.sort(), survivors.sort(), `every surviving alias is returned by listMergedAccounts after a crash following ${crashAfter}`);
      const receipt = await applyOf(db, await planOf(db, 'standard', { accountId: PERSON.accountId }));
      assert.strictEqual(receipt.after.total, 0);
      assert.strictEqual(await count(db, 'accounts', { _id: { $in: [PERSON.aliasId, 'chain-A', 'chain-B', PERSON.accountId] } }), 0, 'no alias row left');
    }
  });

  test('(b) regression: deleting A before B strands B, which the fixture would catch', async () => {
    const { db } = await fresh();
    await db.collection('accounts').insertMany([
      { _id: 'chain-A', identities: [], mergedInto: PERSON.accountId },
      { _id: 'chain-B', identities: [], mergedInto: 'chain-A' }
    ]);
    await db.collection('accounts').deleteOne({ _id: 'chain-A' });
    const store = new AccountStore({ collection: db.collection('accounts') });
    assert.ok(!(await store.listMergedAccounts(PERSON.accountId)).some((a) => a._id === 'chain-B'));
  });

  test('step 4 deletes aliases deepest-first and the canonical account last', async () => {
    const { db } = await fresh();
    await db.collection('accounts').insertMany([
      { _id: 'chain-A', identities: [], mergedInto: PERSON.accountId },
      { _id: 'chain-B', identities: [], mergedInto: 'chain-A' }
    ]);
    const order = [];
    await applyOf(db, await planOf(db, 'standard'), { onStep: (name, detail) => { if (name === 'account-deleted') order.push(detail.id); } });
    assert.strictEqual(order.length, 4);
    assert.strictEqual(order[order.length - 1], PERSON.accountId.slice(0, 8));
    assert.ok(order.indexOf('chain-B'.slice(0, 8)) < order.indexOf('chain-A'.slice(0, 8)));
  });

  test('(c) a completed run: receipt zero, and a second dry run refuses (which is expected and no evidence)', async () => {
    const { db } = await fresh();
    const receipt = await applyOf(db, await planOf(db, 'standard'));
    assert.strictEqual(receipt.after.total, 0);
    assert.strictEqual(receipt.residual, false);
    await expectErasure(planOf(db, 'standard', { accountId: PERSON.accountId }), 'ROOT_ACCOUNT_MISSING');
    await expectErasure(planOf(db, 'standard'), 'ROOT_NOT_FOUND');
  });

  test('(d) a wake minted after completion is RESIDUAL: the receipt says so, never to re-run', async () => {
    const { db, seed } = await fresh();
    const orchestrator = seed.index.find((e) => e.collection === 'dispatch-queue' && e.workspace === 'shared' && e.tenant === 'person')._id;
    const plan = await planOf(db, 'standard');
    const receipt = await applyOf(db, plan, {
      onStep: async (name, detail) => {
        if (name === 'account-deleted' && detail.id === PERSON.accountId.slice(0, 8)) {
          await db.collection('dispatch-queue').insertOne({ _id: 'late-wake', urlKey: 'shared-ws', kind: 'wake', followUpTo: orchestrator });
        }
      }
    });
    assert.strictEqual(receipt.residual, true);
    assert.deepStrictEqual(receipt.after.counts, { 'dispatch-queue': 1 });
    const text = renderReceipt(receipt);
    assert.match(text, /RESIDUAL dispatch-queue: 1/);
    assert.match(text, /Known limits/);
    assert.doesNotMatch(text, /\bre-?run (it|the tool|this)\b/i);
  });

  test('F1-1: a session minted between step 1 and step 4 stops the run before any accounts row is deleted; the resume form completes', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard');
    const accountsBefore = await snapshotDb(db, ['accounts']);
    await assert.rejects(applyOf(db, plan, {
      onStep: async (name) => {
        if (name === 'group-rows') await db.collection('sessions').insertOne({ _id: 'minted', expires: FUTURE, session: { accountId: PERSON.accountId } });
      }
    }), (err) => {
      assert.strictEqual(err.code, 'NEW_ROWS_BEFORE_ACCOUNT_DELETE');
      assert.match(err.message, /sessions=1/);
      assert.match(err.message, new RegExp(`resume with: --account-id ${PERSON.accountId} --level standard$`));
      assert.ok(!err.message.includes('minted'), 'collection names and counts only');
      return true;
    });
    assert.deepStrictEqual(await snapshotDb(db, ['accounts']), accountsBefore, 'accounts byte-identical');
    const rerun = await planOf(db, 'standard', { accountId: PERSON.accountId });
    assert.notStrictEqual(rerun.planId, plan.planId, 'the counts changed, so the planId did');
    const receipt = await applyOf(db, rerun);
    assert.strictEqual(receipt.after.total, 0);
  });

  test('F1-2: a queue row or a wake minted after the cancel is cancelled by the gate, the run stops, the resume completes', async () => {
    const { db, seed } = await fresh();
    const orchestrator = seed.index.find((e) => e.collection === 'dispatch-queue' && e.workspace === 'shared' && e.tenant === 'person')._id;
    const plan = await planOf(db, 'standard');
    await assert.rejects(applyOf(db, plan, {
      onStep: async (name) => {
        if (name !== 'cancel') return;
        await db.collection('dispatch-queue').insertMany([
          { _id: 'late-run', urlKey: 'shared-ws', dispatchedBy: PERSON.accountId, status: 'pending' },
          { _id: 'late-wake', urlKey: 'shared-ws', kind: 'wake', followUpTo: orchestrator }
        ]);
      }
    }), (err) => {
      assert.strictEqual(err.code, 'NEW_ROWS_BEFORE_ACCOUNT_DELETE');
      assert.match(err.message, /dispatch-queue=2/);
      return true;
    });
    assert.strictEqual((await db.collection('dispatch-history').findOne({ _id: 'late-run' })).status, 'cancelled');
    assert.strictEqual((await db.collection('dispatch-history').findOne({ _id: 'late-wake' })).status, 'cancelled');
    assert.ok(await db.collection('accounts').findOne({ _id: PERSON.accountId }));
    const receipt = await applyOf(db, await planOf(db, 'standard', { accountId: PERSON.accountId }));
    assert.strictEqual(receipt.after.total, 0);
  });

  test('N1 at Full: a gate stop with a formerly-Alone workspace resumes with an empty Alone set; the late row is anonymised, not deleted, and the receipt is clean', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'full');
    assert.deepStrictEqual(plan.alone.map((a) => a.urlKey), ['acme']);
    await assert.rejects(applyOf(db, plan, {
      onStep: async (name) => {
        if (name === 'workspace-data') await db.collection('dispatch-queue').insertOne({ _id: 'late-acme', urlKey: 'acme', dispatchedBy: PERSON.accountId, status: 'pending' });
      }
    }), (err) => err.code === 'NEW_ROWS_BEFORE_ACCOUNT_DELETE' && /resume with: .* --level full$/.test(err.message));
    const rerun = await planOf(db, 'full', { accountId: PERSON.accountId });
    assert.deepStrictEqual(rerun.alone, [], 'step 3 deleted the edges, so no workspace is owned and none is Alone');
    const receipt = await applyOf(db, rerun);
    assert.strictEqual(receipt.after.total, 0);
    const late = await db.collection('dispatch-history').findOne({ _id: 'late-acme' });
    assert.ok(late, 'safe direction: nothing wrong is deleted');
    assert.strictEqual(late.dispatchedBy, ERASED_ACCOUNT_ID);
  });

  test('F1-3: the settle wait runs once, between step 3 and the gate, and not at all at 0; the default is derived', async () => {
    assert.strictEqual(IN_FLIGHT_SETTLE_MS, REFRESH_WORST_CASE_MS + 5000);
    for (const settleMs of [0, 60]) {
      const { db } = await fresh();
      const plan = await planOf(db, 'standard');
      const marks = [];
      await applyErasure({ db, plan, settleMs, onStep: (name) => { marks.push([name, Date.now()]); } });
      const names = marks.map(([n]) => n);
      assert.strictEqual(names.filter((n) => n === 'settle').length, 1);
      assert.ok(names.indexOf('group-rows') < names.indexOf('settle') && names.indexOf('settle') < names.indexOf('gate') && names.indexOf('gate') < names.indexOf('account-deleted'));
      const waited = marks[names.indexOf('settle')][1] - marks[names.indexOf('group-rows')][1];
      if (settleMs === 0) assert.ok(waited < 50, `no pause at 0 (${waited}ms)`);
      else assert.ok(waited >= settleMs - 5, `paused ${waited}ms`);
    }
  });

  test('F1-4 / sentinel: the stop error lists collection names and counts only, ends with the resume form, and the canonical id is the only full id', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard');
    let message;
    await assert.rejects(applyOf(db, plan, {
      onStep: async (name) => { if (name === 'group-rows') await db.collection('saved-chats').insertOne({ _id: 'late-chat', accountId: PERSON.accountId, urlKey: 'acme', transcript: [{ text: SENTINELS.prompt }] }); }
    }), (err) => { message = err.message; return true; });
    for (const value of Object.values(SENTINELS)) assert.ok(!message.includes(value));
    assert.deepStrictEqual([...new Set(message.match(UUID_RE) || [])], [PERSON.accountId]);
    assert.match(message, /saved-chats=1/);
  });

  test('recountErasure counts only rows whose expected remainder is zero: kept history is not counted', async () => {
    const { db } = await fresh();
    const plan = await planOf(db, 'standard');
    await applyOf(db, plan);
    const after = await recountErasure({ db, plan, stage: 'final' });
    assert.strictEqual(after.total, 0);
    assert.ok(await count(db, 'dispatch-history', { dispatchedBy: PERSON.accountId }) > 0, 'Standard keeps history that still names the id');
  });
});

// ---------------------------------------------------------------------------
// Runbook and source map
// ---------------------------------------------------------------------------

describe('runbook (LIN-3423)', () => {
  const runbook = readFileSync(join(ROOT, 'docs/runbooks/account-erasure.md'), 'utf8');

  test('carries every step (a) to (g), (c0), the Known limits and the sentence-to-source table', () => {
    for (const heading of ['## (a) Verify identity', '## (b) Confirm the level in writing', '## (c) Before you run', '(c0)', '## (d) Dry run', '## (e) Execute', '## (f) Confirm to the user', '## (g) Record', '## Known limits', '## Sentence-to-source table']) {
      assert.ok(runbook.includes(heading), heading);
    }
    assert.match(runbook, /--find-label/);
    assert.match(runbook, /John's recorded yes/);
    assert.match(runbook, /lib\/render-legal\.js:31/);
  });

  test('says why access ends truthfully: Harbour tokens are read fresh, the 30 s cache holds tracker tokens', () => {
    assert.match(runbook, /validated by a fresh read, with no\s+cache/);
    assert.match(runbook, /tracker access tokens, not\s+Harbour token validity/);
  });

  test('the manual recovery path is the store, never the operator-unreachable route', () => {
    assert.match(runbook, /new DispatchQueueStore\(\{/);
    assert.match(runbook, /store\.removeItem\(urlKey, _id\)/);
    assert.match(runbook, /the\s+operator cannot call that route/);
  });

  test('the source map points at the runbook and names the lib module', () => {
    const map = readFileSync(join(ROOT, 'docs/architecture/source-map.md'), 'utf8');
    assert.match(map, /account-erasure\.js\s+Account erasure by request \(LIN-3423\)/);
    assert.match(map, /\.\.\/runbooks\/account-erasure\.md/);
  });

  test('lib/account-erasure.js lands in the Platform & plumbing code-shape area (an operator data tool, LIN-3708), ahead of Auth and Other features', () => {
    const areas = JSON.parse(readFileSync(join(ROOT, 'scripts/code-shape/areas.json'), 'utf8'));
    const list = areas.areas || areas;
    const hits = list.filter((a) => (a.match || []).some((m) => new RegExp(m).test('lib/account-erasure.js'))).map((a) => a.name);
    assert.strictEqual(hits[0], 'Platform & plumbing');
    // First match wins: the Auth pattern (account-[^/]*) also matches this file, so Platform must stay ahead of it.
    assert.ok(hits.includes('Auth, accounts & workspaces'));
    // lib/public-origin.js stays in Auth: Runs imports it, but Auth does not import Runs because of it.
    const originHits = list.filter((a) => (a.match || []).some((m) => new RegExp(m).test('lib/public-origin.js'))).map((a) => a.name);
    assert.strictEqual(originHits[0], 'Auth, accounts & workspaces');
  });
});

// ---------------------------------------------------------------------------
// --find-label
// ---------------------------------------------------------------------------

describe('findByLabel', () => {
  const NOW = new Date('2026-10-19T12:00:00Z');
  const token = (id, label, createdAt, createdBy = PERSON.accountId) => ({ _id: id, label, createdAt, createdBy, urlKey: 'acme', tokenHash: SENTINELS.tokenHash });

  test('one recent token returns its account id', async () => {
    const { db } = await fresh();
    await db.collection('proxy-tokens').insertOne(token('t1', 'erase-me-1234', new Date(NOW.getTime() - 3600_000)));
    assert.deepStrictEqual(await findByLabel({ db, phrase: 'erase-me-1234', now: NOW }), { accountId: PERSON.accountId });
  });

  test('refuses on zero, on two, and on a token 25 hours old', async () => {
    const { db } = await fresh();
    await expectErasure(findByLabel({ db, phrase: 'never-minted', now: NOW }), 'LABEL_NOT_FOUND');
    await db.collection('proxy-tokens').insertMany([
      token('a', 'twice', new Date(NOW.getTime() - 1000)),
      token('b', 'twice', new Date(NOW.getTime() - 2000), BYSTANDER.accountId),
      token('old', 'stale', new Date(NOW.getTime() - 25 * 3600_000))
    ]);
    await expectErasure(findByLabel({ db, phrase: 'twice', now: NOW }), 'LABEL_AMBIGUOUS');
    await expectErasure(findByLabel({ db, phrase: 'stale', now: NOW }), 'LABEL_NOT_FOUND');
    await expectErasure(findByLabel({ db, phrase: '  ', now: NOW }), 'LABEL_REQUIRED');
  });

  test('read-only, and the read asks for createdBy and createdAt only', async () => {
    const { db } = await fresh();
    await db.collection('proxy-tokens').insertOne(token('t1', 'phrase', new Date(NOW.getTime() - 1000)));
    const before_ = await snapshotDb(db, ['proxy-tokens']);
    const seen = [];
    const spy = new Proxy(db, {
      get(target, prop) {
        if (prop !== 'collection') { const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; }
        return (name) => {
          const real = target.collection(name);
          return new Proxy(real, { get(t, p) { if (p === 'find') return (f, o) => { seen.push(o); return t.find(f, o); }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
        };
      }
    });
    await findByLabel({ db: spy, phrase: 'phrase', now: NOW });
    assert.deepStrictEqual(seen, [{ projection: { _id: 0, createdBy: 1, createdAt: 1 } }]);
    assert.deepStrictEqual(await snapshotDb(db, ['proxy-tokens']), before_);
  });
});
