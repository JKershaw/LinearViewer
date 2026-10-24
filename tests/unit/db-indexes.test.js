/**
 * Unit tests for lib/db-indexes.js (LIN-610).
 *
 * Run with: node --test tests/unit/db-indexes.test.js
 *
 * Covers:
 * - every declared INDEX_SPEC is applied against a real MangoDB instance
 * - ensureIndexes is idempotent (safe to run twice, no duplicates)
 * - a failing (e.g. duplicate unique) build is tolerated: it is logged and
 *   skipped, the rest still apply, and startup never throws
 * - the deliberately-excluded `_id`-only collections get no extra index
 */
import { test, describe, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import {
  INDEX_SPECS, ensureIndexes, tierOf, sameKeySpec, deferredIndexState, applyDeferredIndexes, reportDeferredIndexes,
  scheduleDeferredIndexBuild
} from '../../lib/db-indexes.js';
import { ProxyEventStore } from '../../lib/proxy-events.js';
import { PromptTraceStore } from '../../lib/prompt-trace-store.js';
import { LlmCallLogStore } from '../../lib/llm-call-log.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { TaskShareStore } from '../../lib/task-share-store.js';
import { recordingCollection } from '../fixtures/mango-tmpdir.js';

// Collections the audit deliberately left on the auto `_id` index.
const EXCLUDED_COLLECTIONS = [
  'user-preferences',
  'workspace-preferences',
  'recap-cache',
  'run-summary-cache',
  'session-summary-cache',
  'brief-cache',
  // connections (LIN-3127) was excluded while the store was write-only. LIN-3124
  // PR2 (D10) adds the referent index `{ 'referents.urlKey': 1,
  // 'referents.provider': 1 }` for the connection-first read arms and removes
  // it from this list; the composite-`_id` point lookups stay on the auto
  // `_id_` index.
  // scheduler-locks (LIN-2128): the plan relies on THIS test staying red until
  // the exclusion lands, not on manual review, to catch a future contributor
  // adding an INDEX_SPECS entry here (plan-review F2; PR #1149 review F-B).
  'scheduler-locks',
  // harbour-comments (LIN-2648/LIN-2649): wereRecordedByHarbour queries by
  // `_id` (the `${urlKey}::${commentId}` composition), served by the automatic
  // `_id_` index — deliberately NOT indexed via INDEX_SPECS. This entry is the
  // enforcement for that decision: it relies on THIS test staying red until
  // the exclusion lands, not on manual review, to catch a future contributor
  // adding an INDEX_SPECS entry here.
  'harbour-comments',
  // workspace-halt (LIN-2994/LIN-3023): get/set/clear all filter on the bare
  // `_id: urlKey`, served by the automatic `_id_` index — deliberately NOT
  // indexed via INDEX_SPECS. This entry is the enforcement for that decision:
  // it relies on THIS test staying red until the exclusion lands, not on
  // manual review, to catch a future contributor adding an INDEX_SPECS entry
  // here.
  'workspace-halt',
  // model-routing (LIN-3853): read and written by the bare `_id: urlKey`, served by the
  // automatic `_id_` index, like workspace-halt and workspace-preferences above.
  'model-routing'
];

// MangoDB serialises an index key into a name; compare by key spec instead.
function hasIndexFor(indexList, keySpec) {
  const want = JSON.stringify(keySpec);
  return indexList.some(idx => JSON.stringify(idx.key) === want);
}

const BOOT_SPECS = INDEX_SPECS.filter(s => tierOf(s) === 'boot');
const DEFERRED_SPECS = INDEX_SPECS.filter(s => tierOf(s) === 'deferred');

describe('db-indexes', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'db-indexes-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshDb() {
    return client.db(`idx_${counter++}`);
  }

  test('INDEX_SPECS only targets non-excluded collections', () => {
    const targeted = new Set(INDEX_SPECS.map(s => s.collection));
    for (const excluded of EXCLUDED_COLLECTIONS) {
      assert.ok(
        !targeted.has(excluded),
        `excluded collection "${excluded}" must not be indexed`
      );
    }
  });

  test('every declared index is applied on a MangoDB instance', async () => {
    const db = freshDb();
    const { applied, failed } = await ensureIndexes(db);

    assert.strictEqual(failed.length, 0, 'no spec should fail on a clean db');
    assert.strictEqual(applied.length, BOOT_SPECS.length);

    // Confirm each boot spec is actually present on its collection.
    for (const spec of BOOT_SPECS) {
      const list = await db.collection(spec.collection).indexes();
      assert.ok(
        hasIndexFor(list, spec.keySpec),
        `expected index ${JSON.stringify(spec.keySpec)} on "${spec.collection}"`
      );
    }
  });

  test('declares the connection referent index (LIN-3124 PR2, D10)', () => {
    // Backs the connection-first read arms' referent lookup
    // (ConnectionStore.readConnectionsByReferent) so resolving a connection by
    // `{urlKey, provider}` is an indexed read, not a collection scan.
    const hasIt = INDEX_SPECS.some(s =>
      s.collection === 'connections' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ 'referents.urlKey': 1, 'referents.provider': 1 })
    );
    assert.ok(hasIt, 'connections must have a {referents.urlKey:1, referents.provider:1} index');
  });

  test('declares the bounded newest-first dispatch-history index (LIN-1030)', () => {
    // Backs `find({urlKey}).sort({resolvedAt:-1}).limit(n)` in listHistory so the
    // /api/proxy/dispatch read is a top-N slice, not a whole-history scan+sort.
    const hasIt = INDEX_SPECS.some(s =>
      s.collection === 'dispatch-history' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, resolvedAt: -1 })
    );
    assert.ok(hasIt, 'dispatch-history must have a {urlKey:1, resolvedAt:-1} index');
  });

  test('declares the general-anchor agent-status dispatchId index (LIN-2934 D1)', () => {
    // Backs AgentStatusStore.listStatus's dispatchId pushdown (the
    // getSessionsForIssues extraItems anchor read) so it uses the
    // {urlKey, dispatchId} index instead of scanning the workspace's status log.
    const hasIt = INDEX_SPECS.some(s =>
      s.collection === 'foreman-status' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, dispatchId: 1 })
    );
    assert.ok(hasIt, 'foreman-status must have a {urlKey:1, dispatchId:1} index');
  });

  test('declares the task-mode-events per-task and time indexes, neither a TTL (LIN-2942)', () => {
    // getTaskMode reads {accountId: {$in: group}, urlKey, issueIdentifier}
    // sorted by `at`; countByEntryRung reads the whole log sorted by `at`.
    // The log is lifetime-retained, so neither may be a TTL.
    for (const keySpec of [{ accountId: 1, urlKey: 1, issueIdentifier: 1, at: 1 }, { at: 1 }]) {
      const spec = INDEX_SPECS.find(s =>
        s.collection === 'task-mode-events' &&
        JSON.stringify(s.keySpec) === JSON.stringify(keySpec)
      );
      assert.ok(spec, `task-mode-events must have a ${JSON.stringify(keySpec)} index`);
      assert.strictEqual(spec.options?.expireAfterSeconds, undefined);
    }
  });

  test('declares the per-account dispatch indexes on both collections (LIN-2952 + LIN-3238)', () => {
    // ONE index per collection serves both readers: the milestone funnel reads a
    // person's dispatches by `dispatchedBy`, earliest `dispatchedAt` first
    // (lib/milestone-funnel.js, LIN-2952), and countFreshRunsSince range-scans the
    // UTC day by attribution, queue first then history (LIN-3238). Without it the
    // read is an unindexed collection scan. Plain, non-TTL.
    for (const collection of ['dispatch-queue', 'dispatch-history']) {
      const spec = INDEX_SPECS.find(s =>
        s.collection === collection &&
        JSON.stringify(s.keySpec) === JSON.stringify({ dispatchedBy: 1, dispatchedAt: 1 })
      );
      assert.ok(spec, `${collection} must have a {dispatchedBy:1, dispatchedAt:1} index`);
      assert.strictEqual(
        spec.options?.expireAfterSeconds,
        undefined,
        `${collection} {dispatchedBy:1, dispatchedAt:1} must be a plain index, not a TTL`
      );
    }
  });

  test('declares the close-out-events idempotency and per-task indexes, neither a TTL (LIN-3248)', () => {
    // The unique key is the record's idempotency contract (urlKey + prUrl +
    // headSha + by — a press and the person's later merge are distinct); the
    // per-task key backs listForIssue's oldest-first read. The log is
    // lifetime-retained, so neither may be a TTL.
    const unique = INDEX_SPECS.find(s =>
      s.collection === 'close-out-events' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, prUrl: 1, headSha: 1, by: 1 })
    );
    assert.ok(unique, 'close-out-events must have a {urlKey:1,prUrl:1,headSha:1,by:1} index');
    assert.deepStrictEqual(unique.options, { unique: true });
    assert.strictEqual(unique.options?.expireAfterSeconds, undefined);

    const perTask = INDEX_SPECS.find(s =>
      s.collection === 'close-out-events' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, issueIdentifier: 1, at: 1 })
    );
    assert.ok(perTask, 'close-out-events must have a {urlKey:1,issueIdentifier:1,at:1} index');
    assert.strictEqual(perTask.options?.expireAfterSeconds, undefined);
  });

  test('declares the close-out-events press index for the funnel\'s merge-clicked step, not a TTL (LIN-3500)', () => {
    // CloseOutEventsStore.firstPressAt reads {by:'press', accountId $in} sorted
    // by `at` oldest first. The log is lifetime-retained, so it may not be a TTL.
    const spec = INDEX_SPECS.find(s =>
      s.collection === 'close-out-events' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ by: 1, accountId: 1, at: 1 })
    );
    assert.ok(spec, 'close-out-events must have a {by:1,accountId:1,at:1} index');
    assert.strictEqual(spec.options?.expireAfterSeconds, undefined);
    assert.ok(!INDEX_SPECS.some(s => s.collection === 'funnel-events'), 'the funnel-events store is retired (LIN-3500)');
  });

  test('declares observer-state\'s eviction index keyed on lastSeenAt, never updatedAt (LIN-2129 review F1, pinned LIN-2142)', () => {
    // cleanup() (lib/observer-state-store.js) evicts on last-SEEN, not
    // last-CHANGED — updatedAt only moves on a genuine transition, so an
    // index keyed there instead would (mis)accelerate a scan that deletes a
    // live, diagnosis-stable instance. This pins the CORRECT keySpec so a
    // future edit cannot silently re-key the index back to updatedAt without
    // this test naming exactly what broke.
    const hasIt = INDEX_SPECS.some(s =>
      s.collection === 'observer-state' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ lastSeenAt: 1 })
    );
    assert.ok(hasIt, 'observer-state must have a {lastSeenAt:1} index');
    const hasWrongKey = INDEX_SPECS.some(s =>
      s.collection === 'observer-state' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ updatedAt: 1 })
    );
    assert.strictEqual(hasWrongKey, false, 'observer-state must NOT be indexed on updatedAt — that is the wrong eviction contract');
  });

  test('declares the followUpTo BFS discovery index on both dispatch collections (LIN-1307)', () => {
    // Backs the materializer's followUpTo BFS (_collectSessionIssues / _sessionsTouchingIssue)
    // so a per-write chain-root resolution isn't an unindexed workspace-scoped scan.
    for (const collection of ['dispatch-history', 'dispatch-queue']) {
      const hasIt = INDEX_SPECS.some(s =>
        s.collection === collection &&
        JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, followUpTo: 1 })
      );
      assert.ok(hasIt, `${collection} must have a {urlKey:1, followUpTo:1} index`);
    }
  });

  test('declares the durable session-group discovery index on both dispatch collections (LIN-1341)', () => {
    // Backs the materializer's group-keyed discovery (_collectSessionIssues /
    // _sessionsTouchingIssue) so a stamped follow-up's session is one indexed
    // read, not a followUpTo chain-walk.
    for (const collection of ['dispatch-history', 'dispatch-queue']) {
      const hasIt = INDEX_SPECS.some(s =>
        s.collection === collection &&
        JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, sessionGroupId: 1 })
      );
      assert.ok(hasIt, `${collection} must have a {urlKey:1, sessionGroupId:1} index`);
    }
  });

  test('declares the per-runner-session lineage discovery index on both dispatch collections (LIN-1468)', () => {
    // Backs _collectGroupFeedback's re-keyed candidate query so the merge's
    // sibling lookup is one indexed read, not an unindexed scan.
    for (const collection of ['dispatch-history', 'dispatch-queue']) {
      const hasIt = INDEX_SPECS.some(s =>
        s.collection === collection &&
        JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, rootItemId: 1 })
      );
      assert.ok(hasIt, `${collection} must have a {urlKey:1, rootItemId:1} index`);
    }
  });

  test('declares the producing-item wake-witness index on both dispatch collections (LIN-1698)', () => {
    // Backs a future lookup of a minted wake row by its producing item — no
    // reader in Phase 1 (declared ahead of the spun-out reconciliation-sweep
    // ticket, its first consumer), but populated by this ticket's addItem/
    // _archiveItem threading.
    for (const collection of ['dispatch-history', 'dispatch-queue']) {
      const hasIt = INDEX_SPECS.some(s =>
        s.collection === collection &&
        JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, producingItemId: 1, producingItemAttempt: -1 })
      );
      assert.ok(hasIt, `${collection} must have a {urlKey:1, producingItemId:1, producingItemAttempt:-1} index`);
    }
  });

  test('declares the run-count indexes on both dispatch collections (LIN-3238)', () => {
    // Backs countFreshRunsSince: a per-account attached range scan over the UTC
    // day, in the queue and (after the archive hop) in history. Plain, non-TTL.
    for (const collection of ['dispatch-queue', 'dispatch-history']) {
      const spec = INDEX_SPECS.find(s =>
        s.collection === collection &&
        JSON.stringify(s.keySpec) === JSON.stringify({ dispatchedBy: 1, dispatchedAt: 1 })
      );
      assert.ok(spec, `${collection} must have a {dispatchedBy:1, dispatchedAt:1} index (LIN-3238)`);
      assert.strictEqual(
        spec.options?.expireAfterSeconds,
        undefined,
        `${collection} {dispatchedBy:1, dispatchedAt:1} must be a plain index, not a TTL`
      );
    }
  });

  test('declares the liveness-alarms per-workspace state index (LIN-3258)', () => {
    const spec = INDEX_SPECS.find(s =>
      s.collection === 'liveness-alarms' &&
      JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, clearedAt: 1, startedAt: -1 })
    );
    assert.ok(spec, 'liveness-alarms must have a {urlKey:1, clearedAt:1, startedAt:-1} index');
    assert.strictEqual(spec.options?.expireAfterSeconds, undefined, 'liveness-alarms must be a plain index, not a TTL');
  });

  test('declares the partial unique one-owner-per-workspace index on account-workspaces (LIN-1892)', () => {
    const spec = INDEX_SPECS.find(s => s.options.name === 'account_workspaces_one_owner');
    assert.ok(spec, 'expected an account_workspaces_one_owner spec');
    assert.strictEqual(spec.collection, 'account-workspaces');
    assert.deepStrictEqual(spec.keySpec, { workspaceId: 1, role: 1 });
    assert.deepStrictEqual(spec.options, {
      unique: true,
      partialFilterExpression: { role: 'owner' },
      name: 'account_workspaces_one_owner'
    });
    assert.ok(spec.reason, 'the spec carries a reason line');
  });

  test('no two account-workspaces specs share a key spec (LIN-1892 collision guard)', () => {
    // MangoDB's createIndex early-returns on a matching keySpec whatever the
    // options, so a second spec on an existing key (e.g. the owner index on
    // plain `{workspaceId: 1}`) silently never builds there. Scoped to
    // account-workspaces on purpose: `accounts` declares the same key twice
    // by design (LIN-1338's unique spec plus the retained LIN-1327 one).
    const keys = INDEX_SPECS
      .filter(s => s.collection === 'account-workspaces')
      .map(s => JSON.stringify(s.keySpec));
    assert.deepStrictEqual(keys, [...new Set(keys)], `duplicate account-workspaces key spec in ${keys.join(', ')}`);
  });

  test('declares the email-magic-links throttle and TTL-cleanup indexes (LIN-1892 S2 item 8)', async () => {
    // {emailNorm:1, createdAt:-1} backs MagicLinkStore.recentCountForEmail (the
    // per-email send throttle); the TTL on expiresAt is cleanup only — expiry
    // itself is enforced by the peek/consume query, never by the TTL daemon.
    const specs = INDEX_SPECS.filter(s => s.collection === 'email-magic-links');
    assert.deepStrictEqual(
      specs.map(s => ({ keySpec: s.keySpec, options: s.options })),
      [
        { keySpec: { emailNorm: 1, createdAt: -1 }, options: {} },
        // LIN-3771: backs MagicLinkStore.recentCount (the hourly send-volume alarm, LIN-3789).
        { keySpec: { createdAt: -1 }, options: {} },
        { keySpec: { expiresAt: 1 }, options: { expireAfterSeconds: 86400 } }
      ]
    );

    const db = freshDb();
    await ensureIndexes(db);
    const list = await db.collection('email-magic-links').indexes();
    const ttl = list.find(idx => JSON.stringify(idx.key) === JSON.stringify({ expiresAt: 1 }));
    assert.ok(ttl, 'the TTL index is built');
    assert.strictEqual(ttl.expireAfterSeconds, 86400);
  });

  test('email-magic-links is the only collection with a TTL index (the LIN-610 no-TTL rule\'s one exception)', () => {
    const ttlCollections = INDEX_SPECS.filter(s => s.options && s.options.expireAfterSeconds !== undefined).map(s => s.collection);
    assert.deepStrictEqual(ttlCollections, ['email-magic-links']);
  });

  test('unique option is honoured for tokenHash indexes', async () => {
    const db = freshDb();
    await ensureIndexes(db);

    const list = await db.collection('proxy-tokens').indexes();
    const tokenHashIdx = list.find(idx => JSON.stringify(idx.key) === JSON.stringify({ tokenHash: 1 }));
    assert.ok(tokenHashIdx, 'proxy-tokens tokenHash index should exist');
    assert.strictEqual(tokenHashIdx.unique, true, 'tokenHash index should be unique');
  });

  test('is idempotent: running twice does not duplicate indexes or throw', async () => {
    const db = freshDb();
    await ensureIndexes(db);

    const before = {};
    for (const spec of INDEX_SPECS) {
      before[spec.collection] = (await db.collection(spec.collection).indexes()).length;
    }

    // Second run must be a no-op (createIndex early-returns on a matching spec).
    const { failed } = await ensureIndexes(db);
    assert.strictEqual(failed.length, 0, 'second run should not fail');

    for (const spec of INDEX_SPECS) {
      const after = (await db.collection(spec.collection).indexes()).length;
      assert.strictEqual(
        after,
        before[spec.collection],
        `index count for "${spec.collection}" changed on re-run`
      );
    }
  });

  test('tolerates a failing index build: logs, skips, continues, never throws', async () => {
    // Fake db whose first collection's createIndex throws (simulating a
    // production unique build over pre-existing duplicate tokenHash data), and
    // whose every other createIndex succeeds. ensureIndexes must catch the
    // throw, record it as failed, and still apply the rest.
    const failingCollection = INDEX_SPECS[0].collection;
    let firstThrown = false;
    const warnings = [];

    const fakeDb = {
      collection(name) {
        return {
          async createIndex(keySpec) {
            if (name === failingCollection && !firstThrown) {
              firstThrown = true;
              const err = new Error('E11000 duplicate key error');
              err.name = 'DuplicateKeyError';
              throw err;
            }
            return `${name}_${JSON.stringify(keySpec)}`;
          }
        };
      }
    };

    const logger = { warn: msg => warnings.push(msg) };

    let result;
    await assert.doesNotReject(async () => {
      result = await ensureIndexes(fakeDb, { logger });
    }, 'ensureIndexes must never throw on a failing build');

    assert.strictEqual(result.failed.length, 1, 'exactly one build should fail');
    assert.strictEqual(result.failed[0].collection, failingCollection);
    assert.strictEqual(result.applied.length, BOOT_SPECS.length - 1, 'the rest still apply');
    assert.strictEqual(warnings.length, 1, 'the failure should be logged once');
    assert.match(warnings[0], /db-indexes/);
    assert.match(warnings[0], new RegExp(failingCollection));
  });

  // ---------------------------------------------------------------------------
  // LIN-3162 (LIN-3157 A2) / LIN-3163 (B, post-deploy index fix): the plain
  // timestamp indexes backing the DB-side paged reads. LIN-3163 extends each
  // paged-list key so it matches that list's sort key exactly (after the
  // `urlKey:1` prefix) — the A2 `{urlKey, timestamp:-1}` shape did not cover
  // the `_id`/`_seq` tie-break and lost to the vestigial expiry index in
  // production, leaving a full-workspace blocking sort.
  // ---------------------------------------------------------------------------

  test('declares the four sort-matching paged-list indexes plus the per-issue successor (LIN-3163)', () => {
    const expected = [
      ['proxy-events', { urlKey: 1, timestamp: -1, _id: -1 }],
      ['prompt-traces', { urlKey: 1, timestamp: -1, _seq: -1, _id: -1 }],
      ['llm-call-log', { urlKey: 1, timestamp: -1, _id: -1 }],
      ['foreman-status', { urlKey: 1, timestamp: -1, _id: -1 }],
      ['llm-call-log', { urlKey: 1, issueIdentifier: 1, timestamp: -1 }]
    ];
    for (const [collection, keySpec] of expected) {
      const hasIt = INDEX_SPECS.some(s =>
        s.collection === collection && JSON.stringify(s.keySpec) === JSON.stringify(keySpec)
      );
      assert.ok(hasIt, `${collection} must have a ${JSON.stringify(keySpec)} index (LIN-3163)`);
    }
  });

  test('the four superseded A2 {urlKey,timestamp:-1} specs are gone (LIN-3163)', () => {
    // The A2 shape is a strict prefix of the extended key, so keeping both
    // would cost a second index write on every insert while the planner still
    // could not use the prefix for the tie-break.
    for (const collection of ['proxy-events', 'prompt-traces', 'llm-call-log', 'foreman-status']) {
      const hasPlainA2 = INDEX_SPECS.some(s =>
        s.collection === collection && JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, timestamp: -1 })
      );
      assert.ok(!hasPlainA2, `${collection} must not keep the superseded {urlKey:1,timestamp:-1} spec`);
    }
  });

  test('each paged list\'s cursor sort equals its declared index key after the urlKey prefix (LIN-3163 parity guard)', async () => {
    // CI runs MangoDB, which has no query planner, so no test can observe the
    // planner picking the index. This guard holds fixed the ONE thing that
    // decides it: the index key must be the list's sort key with `urlKey:1`
    // prepended. Change a list's sort or its index spec without the other and
    // this fails — the exact drift that produced the production blocking sort.
    // The four A2/B paged lists all declare a `urlKey:1,timestamp:-1` key (the
    // issue-scoped llm-call-log successor is excluded by the `issueIdentifier`
    // guard).
    const pagedListSpec = (collection) => (s) =>
      s.collection === collection &&
      s.keySpec.urlKey === 1 &&
      s.keySpec.timestamp === -1 &&
      s.keySpec.issueIdentifier === undefined;
    const cases = [
      { collection: 'proxy-events', make: c => new ProxyEventStore({ collection: c }), list: s => s.listEvents('parity-ws', { limit: 5, offset: 0 }), match: pagedListSpec('proxy-events') },
      { collection: 'proxy-events', make: c => new ProxyEventStore({ collection: c }), list: s => s.listSelfCredentialTrail('parity-ws', 'parity-token', { limit: 5 }), match: pagedListSpec('proxy-events') },
      { collection: 'prompt-traces', make: c => new PromptTraceStore({ collection: c }), list: s => s.listTraces('parity-ws', { limit: 5, offset: 0 }), match: pagedListSpec('prompt-traces') },
      { collection: 'llm-call-log', make: c => new LlmCallLogStore({ collection: c }), list: s => s.listCalls('parity-ws', { limit: 5, offset: 0 }), match: pagedListSpec('llm-call-log') },
      { collection: 'foreman-status', make: c => new AgentStatusStore({ collection: c }), list: s => s.listStatus('parity-ws', { limit: 5, offset: 0 }), match: pagedListSpec('foreman-status') }
    ];
    for (const { collection, make, list, match } of cases) {
      const recorded = recordingCollection(freshDb().collection(collection));
      await list(make(recorded));
      const cursor = recorded.__record.cursors.at(-1);
      assert.ok(cursor, `${collection}: the paged list issued a find()`);
      assert.strictEqual(cursor.sorts.length, 1, `${collection}: exactly one sort must be pushed into the cursor`);
      const spec = INDEX_SPECS.find(match);
      assert.ok(spec, `${collection}: a urlKey-prefixed paged-list index must be declared`);
      // Compare ORDERED key entries, not deep equality: a compound index is
      // defined by key order, and `assert.deepStrictEqual` on objects ignores
      // insertion order, so `{urlKey,timestamp,_id}` would equal
      // `{urlKey,_id,timestamp}`. Each paged list's index key must be exactly
      // `urlKey:1` followed by the sort keys in sort order.
      assert.deepStrictEqual(
        Object.entries(spec.keySpec),
        [['urlKey', 1], ...Object.entries(cursor.sorts[0])],
        `${collection}: the declared index key must equal the list sort with the urlKey prefix, in order (LIN-3163)`
      );
    }
  });

  test('task_share_links list index equals its cursor sort after the urlKey prefix (LIN-3330 parity guard)', async () => {
    const recorded = recordingCollection(freshDb().collection('task_share_links'));
    await new TaskShareStore({ collection: recorded }).listForTask('parity-ws', 'LIN-1');
    const cursor = recorded.__record.cursors.at(-1);
    assert.ok(cursor, 'listForTask issued a find()');
    assert.strictEqual(cursor.sorts.length, 1, 'exactly one sort is pushed into the cursor');
    const spec = INDEX_SPECS.find(s => s.collection === 'task_share_links' && s.keySpec.issueIdentifier === 1);
    assert.ok(spec, 'the urlKey-prefixed list index is declared');
    assert.deepStrictEqual(
      Object.entries(spec.keySpec),
      [['urlKey', 1], ['issueIdentifier', 1], ...Object.entries(cursor.sorts[0])],
      'the declared index key must equal the query equality prefix + listForTask\'s sort, in order (LIN-3163)'
    );
  });

  test('B removed the pre-A2 expiry specs; observation-sessions keeps its cleanup index (LIN-3163)', () => {
    const removed = [
      ['dispatch-history', { historyExpiresAt: 1 }],
      ['proxy-events', { urlKey: 1, expiresAt: 1 }],
      ['foreman-status', { urlKey: 1, expiresAt: 1 }],
      ['llm-call-log', { urlKey: 1, expiresAt: 1 }],
      ['llm-call-log', { urlKey: 1, issueIdentifier: 1, expiresAt: 1 }],
      ['prompt-traces', { urlKey: 1, expiresAt: 1 }]
    ];
    for (const [collection, keySpec] of removed) {
      const hasIt = INDEX_SPECS.some(s =>
        s.collection === collection && JSON.stringify(s.keySpec) === JSON.stringify(keySpec)
      );
      assert.ok(!hasIt, `${collection} ${JSON.stringify(keySpec)} must be gone after B`);
    }
    // observation-sessions is a TTL'd derived read-model, explicitly out of scope:
    // it keeps its own {historyExpiresAt} cleanup index.
    const keepsObservation = INDEX_SPECS.some(s =>
      s.collection === 'observation-sessions' && JSON.stringify(s.keySpec) === JSON.stringify({ historyExpiresAt: 1 })
    );
    assert.ok(keepsObservation, 'observation-sessions keeps its cleanup index');
  });

  test('the A2 timestamp indexes are plain, not TTL; email-magic-links stays the only TTL (LIN-3162)', () => {
    const a2 = INDEX_SPECS.filter(s => s.keySpec && s.keySpec.timestamp === -1);
    assert.ok(a2.length >= 5, 'the A2 timestamp indexes are present');
    for (const spec of a2) {
      assert.strictEqual(
        spec.options?.expireAfterSeconds,
        undefined,
        `${spec.collection} ${JSON.stringify(spec.keySpec)} must be a plain index, not a TTL`
      );
    }
    const ttlCollections = INDEX_SPECS
      .filter(s => s.options && s.options.expireAfterSeconds !== undefined)
      .map(s => s.collection);
    assert.deepStrictEqual(ttlCollections, ['email-magic-links']);
  });
});

describe('KPI daily rollup indexes (LIN-3724)', () => {
  test('the rollup collection has a unique { urlKey, day } spec', () => {
    const spec = INDEX_SPECS.find(s => s.collection === 'kpi-daily-rollup');
    assert.ok(spec, 'kpi-daily-rollup spec present');
    assert.deepStrictEqual(spec.keySpec, { urlKey: 1, day: 1 });
    assert.strictEqual(spec.options.unique, true);
    assert.ok(spec.reason);
  });

  test('both dispatch-history window specs are declared, deferred and ascending (LIN-3811)', () => {
    for (const keySpec of [{ urlKey: 1, dispatchedAt: 1 }, { dispatchedAt: 1, urlKey: 1 }]) {
      const spec = INDEX_SPECS.find(s => s.collection === 'dispatch-history' && sameKeySpec(s.keySpec, keySpec));
      assert.ok(spec, `dispatch-history ${JSON.stringify(keySpec)} declared`);
      assert.strictEqual(tierOf(spec), 'deferred');
    }
  });

  test('dispatch-queue { urlKey, dispatchedAt } is deliberately not declared (LIN-3811)', () => {
    assert.ok(!INDEX_SPECS.some(s => s.collection === 'dispatch-queue' && sameKeySpec(s.keySpec, { urlKey: 1, dispatchedAt: 1 })));
  });
});

describe('deferred index tier (LIN-3811)', () => {
  let dbDir;
  let client;
  let counter = 0;
  const quiet = () => {
    const lines = { log: [], warn: [], error: [] };
    return { lines, log: m => lines.log.push(m), warn: m => lines.warn.push(m), error: m => lines.error.push(m) };
  };

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'db-indexes-deferred-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  const freshDb = () => client.db(`deferred_${counter++}`);

  test('the deferred specs are the five agreed, each with a reason', () => {
    const ids = DEFERRED_SPECS.map(s => `${s.collection} ${JSON.stringify(s.keySpec)}`).sort();
    assert.deepStrictEqual(ids, [
      'dispatch-history {"dispatchedAt":1,"urlKey":1}',
      'dispatch-history {"urlKey":1,"dispatchedAt":1}',
      'foreman-status {"timestamp":1}',
      'owner-credentials {"urlKey":1}',
      'proxy-events {"timestamp":1}'
    ]);
    for (const spec of DEFERRED_SPECS) assert.ok(spec.reason);
  });

  test('every deferred spec is non-unique with no TTL (correctness indexes cannot be deferred)', () => {
    for (const spec of DEFERRED_SPECS) {
      assert.ok(!spec.options?.unique, `${spec.collection} ${JSON.stringify(spec.keySpec)} must not be unique`);
      assert.strictEqual(spec.options?.expireAfterSeconds, undefined);
    }
  });

  test('every tier value is boot or deferred', () => {
    for (const spec of INDEX_SPECS) assert.ok(['boot', 'deferred'].includes(tierOf(spec)));
  });

  test('ROLLUP_HISTORY_INDEX deep-equals a declared deferred dispatch-history keySpec', async () => {
    const { ROLLUP_HISTORY_INDEX } = await import('../../lib/kpi-daily-rollup.js');
    assert.ok(DEFERRED_SPECS.some(s => s.collection === 'dispatch-history' && sameKeySpec(s.keySpec, ROLLUP_HISTORY_INDEX)));
  });

  test('ensureIndexes never calls createIndex for a deferred spec', async () => {
    const created = [];
    const fakeDb = { collection: name => ({ createIndex: async keySpec => { created.push([name, keySpec]); return 'x'; } }) };
    const { applied } = await ensureIndexes(fakeDb);
    assert.strictEqual(created.length, BOOT_SPECS.length);
    for (const spec of DEFERRED_SPECS) {
      assert.ok(!created.some(([c, k]) => c === spec.collection && sameKeySpec(k, spec.keySpec)));
    }
    assert.strictEqual(applied.length, BOOT_SPECS.length);
  });

  test('state reads pending, then built after apply; an absent collection is pending without throwing', async () => {
    const db = freshDb();
    const before = await deferredIndexState(db);
    assert.strictEqual(before.length, DEFERRED_SPECS.length);
    assert.ok(before.every(s => s.built === false));

    const logger = quiet();
    const { applied, failed } = await applyDeferredIndexes(db, { logger });
    assert.strictEqual(failed.length, 0);
    assert.strictEqual(applied.length, DEFERRED_SPECS.length);
    assert.ok((await deferredIndexState(db)).every(s => s.built === true));
    // one start and one finish line per spec
    assert.strictEqual(logger.lines.log.filter(m => /building/.test(m)).length, DEFERRED_SPECS.length);
    assert.strictEqual(logger.lines.log.filter(m => /built .* as /.test(m)).length, DEFERRED_SPECS.length);
  });

  test('apply is idempotent: a second run builds nothing', async () => {
    const db = freshDb();
    await applyDeferredIndexes(db, { logger: quiet() });
    const { applied, failed } = await applyDeferredIndexes(db, { logger: quiet() });
    assert.strictEqual(applied.length, 0);
    assert.strictEqual(failed.length, 0);
  });

  test('an index built by hand under another name counts as built (matched by key spec)', async () => {
    const db = freshDb();
    await db.collection('dispatch-history').createIndex({ urlKey: 1, dispatchedAt: 1 }, { name: 'hand_built' });
    const entry = (await deferredIndexState(db)).find(
      s => s.collection === 'dispatch-history' && sameKeySpec(s.keySpec, { urlKey: 1, dispatchedAt: 1 })
    );
    assert.strictEqual(entry.built, true);
    const { applied } = await applyDeferredIndexes(db, { logger: quiet() });
    assert.ok(!applied.some(a => a.collection === 'dispatch-history' && sameKeySpec(a.keySpec, { urlKey: 1, dispatchedAt: 1 })));
  });

  test('a non-26 listIndexes error reads unknown, not built, and is logged not thrown', async () => {
    const db = {
      collection: () => ({ listIndexes: () => ({ toArray: async () => { throw Object.assign(new Error('network down'), { code: 6 }); } }) })
    };
    const logger = quiet();
    const state = await deferredIndexState(db, { logger });
    assert.ok(state.every(s => s.built === 'unknown'));
    assert.ok(logger.lines.warn.length > 0);
  });

  test('Mongo code 26 reads pending', async () => {
    const db = {
      collection: () => ({ listIndexes: () => ({ toArray: async () => { throw Object.assign(new Error('ns not found'), { code: 26 }); } }) })
    };
    assert.ok((await deferredIndexState(db, { logger: quiet() })).every(s => s.built === false));
  });

  test('a failed build is logged and skipped; the rest still build', async () => {
    const db = freshDb();
    const real = db.collection.bind(db);
    db.collection = name => {
      const c = real(name);
      if (name !== 'proxy-events') return c;
      return { listIndexes: () => c.listIndexes(), createIndex: async () => { throw new Error('boom'); } };
    };
    const logger = quiet();
    const { applied, failed } = await applyDeferredIndexes(db, { logger });
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(applied.length, DEFERRED_SPECS.length - 1);
    assert.ok(logger.lines.warn.some(m => /FAILED proxy-events/.test(m)));
  });

  test('only filters to one spec', async () => {
    const db = freshDb();
    const { applied } = await applyDeferredIndexes(db, { logger: quiet(), only: 'proxy-events:timestamp_1' });
    assert.deepStrictEqual(applied.map(a => a.collection), ['proxy-events']);
  });

  test('the reporter logs one line and never creates an index', async () => {
    const db = freshDb();
    const created = [];
    const spy = { collection: name => { const c = db.collection(name); return { listIndexes: () => c.listIndexes(), createIndex: async (...a) => { created.push(name); return c.createIndex(...a); } }; } };
    const logger = quiet();
    await reportDeferredIndexes(spy, { logger });
    assert.deepStrictEqual(created, []);
    assert.strictEqual(logger.lines.log.length, 1);
    assert.match(logger.lines.log[0], new RegExp(`\\[db-indexes\\] deferred: 0 built, ${DEFERRED_SPECS.length} pending \\(`));
    assert.ok((await deferredIndexState(db)).every(s => s.built === false), 'still nothing built');
  });

  describe('scheduleDeferredIndexBuild: the server builds pending deferred specs after listen (LIN-3865)', () => {
    const DELAY = 60_000;
    afterEach(() => mock.timers.reset());
    // Let the build that the timer started run to completion (it awaits a real MangoDB).
    const settle = () => new Promise(resolve => setImmediate(resolve));

    test('builds nothing before the delay, then builds every pending deferred spec', async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      const db = freshDb();
      const touched = [];
      const spy = { collection: name => { const c = db.collection(name); return { listIndexes: () => { touched.push(name); return c.listIndexes(); }, createIndex: (...a) => { touched.push(name); return c.createIndex(...a); } }; } };
      scheduleDeferredIndexBuild(spy, { logger: quiet(), delayMs: DELAY });
      mock.timers.tick(DELAY - 1);
      await settle();
      assert.deepStrictEqual(touched, [], 'the db is not even read before the delay');
      mock.timers.tick(1);
      for (let i = 0; i < 5000 && !(await deferredIndexState(db, { logger: quiet() })).every(s => s.built === true); i++) await settle();
      assert.ok((await deferredIndexState(db, { logger: quiet() })).every(s => s.built === true), 'all five built after the delay');
    });

    test('returns synchronously: boot does not wait on the build', () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      const handle = scheduleDeferredIndexBuild(freshDb(), { logger: quiet(), delayMs: DELAY });
      assert.strictEqual(typeof handle.cancel, 'function');
      assert.ok(!(handle instanceof Promise));
      handle.cancel();
    });

    test('a spec whose key already exists under another name is not rebuilt', async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      const db = freshDb();
      const spec = DEFERRED_SPECS.find(s => s.collection === 'foreman-status');
      await db.collection('foreman-status').createIndex(spec.keySpec, { name: 'hand_built_name' });
      const created = [];
      const spy = { collection: name => { const c = db.collection(name); return { listIndexes: () => c.listIndexes(), createIndex: async (k, o) => { created.push(name); return c.createIndex(k, o); } }; } };
      scheduleDeferredIndexBuild(spy, { logger: quiet(), delayMs: DELAY });
      mock.timers.tick(DELAY);
      for (let i = 0; i < 5000 && created.length < DEFERRED_SPECS.length - 1; i++) await settle();
      assert.ok(!created.includes('foreman-status'));
      assert.strictEqual(created.length, DEFERRED_SPECS.length - 1);
    });

    test('a failing build, and an unreadable state, are logged and never throw or reject', async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      const logger = quiet();
      const rejections = [];
      const onRejection = e => rejections.push(e);
      process.on('unhandledRejection', onRejection);
      try {
        const failing = { collection: () => ({ listIndexes: () => ({ toArray: async () => [] }), createIndex: async () => { throw new Error('boom'); } }) };
        const broken = { collection: () => { throw new Error('no db'); } };
        assert.doesNotThrow(() => scheduleDeferredIndexBuild(failing, { logger, delayMs: DELAY }));
        assert.doesNotThrow(() => scheduleDeferredIndexBuild(broken, { logger, delayMs: DELAY }));
        mock.timers.tick(DELAY);
        for (let i = 0; i < 20; i++) await settle();
        assert.ok(logger.lines.warn.some(m => /FAILED .*boom/.test(m)), 'build failure logged');
        assert.ok(logger.lines.warn.some(m => /no db/.test(m)), 'unreadable db logged');
        assert.deepStrictEqual(rejections, []);
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    });

    test('cancel() before the delay builds nothing; the timer is one-shot and unref-ed', async () => {
      mock.timers.enable({ apis: ['setTimeout'] });
      const db = freshDb();
      const touched = [];
      const spy = { collection: name => { touched.push(name); return db.collection(name); } };
      const handle = scheduleDeferredIndexBuild(spy, { logger: quiet(), delayMs: DELAY });
      handle.cancel();
      mock.timers.tick(DELAY * 3);
      await settle();
      assert.deepStrictEqual(touched, [], 'a cancelled build never reads or builds');
      assert.ok((await deferredIndexState(db, { logger: quiet() })).every(s => s.built === false));
    });

    test('the timer is unref-ed so it cannot hold the process open', () => {
      const real = globalThis.setTimeout;
      let unrefCalled = false;
      globalThis.setTimeout = (...a) => { const t = real(...a); const u = t.unref.bind(t); t.unref = () => { unrefCalled = true; return u(); }; return t; };
      try {
        scheduleDeferredIndexBuild(freshDb(), { logger: quiet(), delayMs: 5_000 }).cancel();
      } finally {
        globalThis.setTimeout = real;
      }
      assert.ok(unrefCalled);
    });
  });
});
