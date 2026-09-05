/**
 * Unit tests for proxy-tokens.js
 *
 * Run with: node --test tests/unit/proxy-tokens.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';

// =============================================================================
// In-memory collection mock (MangoDB-compatible interface)
// =============================================================================

function createMockCollection() {
  let docs = [];

  return {
    async insertOne(doc) {
      docs.push({ ...doc });
      return { insertedId: doc._id };
    },
    async findOne(query) {
      return docs.find(d => {
        return Object.keys(query).every(k => {
          if (typeof query[k] === 'object' && query[k] !== null) return true; // skip operators
          return d[k] === query[k];
        });
      }) || null;
    },
    async updateOne(query, update) {
      const idx = docs.findIndex(d => {
        return Object.keys(query).every(k => {
          if (typeof query[k] === 'object' && query[k] !== null) return true;
          return d[k] === query[k];
        });
      });
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) {
        Object.assign(docs[idx], update.$set);
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => {
        return Object.keys(query).every(k => d[k] === query[k]);
      });
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(query) {
      const before = docs.length;
      docs = docs.filter(d => {
        return !Object.keys(query).every(k => {
          const val = query[k];
          if (val && typeof val === 'object') {
            // Handle $lt, $ne, $gt operators
            if ('$lt' in val && '$ne' in val) {
              return d[k] !== val.$ne && d[k] !== null && new Date(d[k]) < new Date(val.$lt);
            }
            if ('$lt' in val) {
              return d[k] !== null && new Date(d[k]) < new Date(val.$lt);
            }
            return true;
          }
          return d[k] === val;
        });
      });
      return { deletedCount: before - docs.length };
    },
    find(query) {
      const results = docs.filter(d => {
        return Object.keys(query).every(k => {
          const val = query[k];
          if (val && typeof val === 'object') return true; // skip operators
          return d[k] === val;
        });
      });
      return { toArray: async () => results };
    },
    _docs: () => docs,
    _clear: () => { docs = []; }
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ProxyTokenStore', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new ProxyTokenStore({ collection });
  });

  describe('hash verification', () => {
    test('validates a token using its SHA-256 hash', async () => {
      const result = await store.createToken('workspace-1', { label: 'test' });
      const validated = await store.validateToken(result.token);
      assert.ok(validated, 'Token should validate successfully');
      assert.strictEqual(validated.urlKey, 'workspace-1');
      assert.strictEqual(validated.label, 'test');
    });

    test('rejects a modified token (wrong hash)', async () => {
      const result = await store.createToken('workspace-1', { label: 'test' });
      // Flip a character in the token
      const modified = result.token.slice(0, -1) + (result.token.at(-1) === 'a' ? 'b' : 'a');
      const validated = await store.validateToken(modified);
      assert.strictEqual(validated, null, 'Modified token should not validate');
    });

    test('rejects a completely random token', async () => {
      await store.createToken('workspace-1', { label: 'test' });
      const randomToken = crypto.randomBytes(32).toString('base64url');
      const validated = await store.validateToken(randomToken);
      assert.strictEqual(validated, null, 'Random token should not validate');
    });

    test('rejects empty token', async () => {
      const validated = await store.validateToken('');
      assert.strictEqual(validated, null);
    });

    test('rejects null token', async () => {
      const validated = await store.validateToken(null);
      assert.strictEqual(validated, null);
    });

    test('stored hash matches SHA-256 of the token', async () => {
      const result = await store.createToken('workspace-1');
      const docs = collection._docs();
      const storedHash = docs[0].tokenHash;
      const expectedHash = crypto.createHash('sha256').update(result.token).digest('hex');
      assert.strictEqual(storedHash, expectedHash, 'Stored hash should match SHA-256 of token');
    });

    test('plain token is never stored in the database', async () => {
      const result = await store.createToken('workspace-1');
      const docs = collection._docs();
      const doc = docs[0];
      // The plain token should not appear anywhere in the stored document
      const docString = JSON.stringify(doc);
      assert.ok(!docString.includes(result.token), 'Plain token must not be stored in database');
    });
  });

  describe('single-use tokens', () => {
    test('single-use token is consumed after first validation', async () => {
      const result = await store.createToken('workspace-1', { singleUse: true });

      const first = await store.validateToken(result.token);
      assert.ok(first, 'First validation should succeed');

      const second = await store.validateToken(result.token);
      assert.strictEqual(second, null, 'Second validation should fail (consumed)');
    });

    test('non-single-use token can be validated multiple times', async () => {
      const result = await store.createToken('workspace-1', { singleUse: false });

      const first = await store.validateToken(result.token);
      assert.ok(first, 'First validation should succeed');

      const second = await store.validateToken(result.token);
      assert.ok(second, 'Second validation should also succeed');
    });
  });

  describe('bootstrap tokens (LIN-376)', () => {
    test('bootstrap token is forced single-use even without the flag', async () => {
      const result = await store.createToken('workspace-1', { kind: 'bootstrap' });
      assert.strictEqual(result.kind, 'bootstrap');
      assert.strictEqual(result.singleUse, true);
    });

    test('bootstrap token is rejected by validateToken (never hits data endpoints)', async () => {
      const result = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });
      const validated = await store.validateToken(result.token);
      assert.strictEqual(validated, null, 'A bootstrap must not authenticate a data endpoint');
    });

    test('rejecting a bootstrap at validateToken does not consume it', async () => {
      const result = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });
      // A failed data-endpoint attempt must not burn the bootstrap.
      await store.validateToken(result.token);
      const exchanged = await store.exchangeBootstrapToken(result.token);
      assert.ok(exchanged, 'Bootstrap should still be exchangeable after a rejected validate');
    });

    test('exchange mints a standard, multi-use working token in the same workspace + scope', async () => {
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });
      const working = await store.exchangeBootstrapToken(boot.token);
      assert.ok(working, 'Exchange should succeed');
      assert.strictEqual(working.kind, 'standard');
      assert.strictEqual(working.scope, 'readWrite');
      assert.strictEqual(working.urlKey, 'workspace-1');
      assert.notStrictEqual(working.token, boot.token, 'Working token must be a different secret');

      // The working token authenticates data endpoints, repeatedly.
      const first = await store.validateToken(working.token);
      assert.ok(first && first.scope === 'readWrite');
      const second = await store.validateToken(working.token);
      assert.ok(second, 'Working token is multi-use');
    });

    // LIN-1448 — the inheritance step, made visible.
    //
    // This line (`createdBy: doc.createdBy || null`) is where an ownerless
    // bootstrap becomes an ownerless WORKING token, which is what turned two bad
    // mints into four halted autopilot trees on 2026-07-25 (LIN-1576). The
    // exchange deliberately still SUCCEEDS: while the LIN-1447 compat lane is on,
    // ownerless tokens are a supported population, and refusing here would strand
    // the host runner mid-flight rather than at a mint it can retry. Prevention
    // belongs at the mint (provisionBootstrapToken / the broker-token lane);
    // what belongs here is a breadcrumb, so the propagation is never silent.
    test('LIN-1448: exchanging an OWNERLESS bootstrap still succeeds, but announces the inheritance', async (t) => {
      const warnMock = t.mock.method(console, 'warn', () => {});
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });

      const working = await store.exchangeBootstrapToken(boot.token);

      assert.ok(working, 'the compat population must not be stranded mid-flight');
      assert.equal(warnMock.mock.calls.length, 1);
      const warned = warnMock.mock.calls[0].arguments.join(' ');
      assert.match(warned, /LIN-1448/);
      assert.match(warned, /owner/i);
      assert.match(warned, /workspace-1/, 'names the workspace so the log is actionable');
      assert.ok(!warned.includes(boot.token), 'never logs token bytes');
      assert.ok(!warned.includes(working.token), 'never logs token bytes');
    });

    test('LIN-1448: exchanging an OWNED bootstrap is silent, and the owner is carried across', async (t) => {
      const warnMock = t.mock.method(console, 'warn', () => {});
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite', createdBy: 'account-A' });

      const working = await store.exchangeBootstrapToken(boot.token);

      assert.ok(working);
      const validated = await store.validateToken(working.token);
      assert.equal(validated.createdBy, 'account-A', 'the healthy path is unchanged: the owner is inherited');
      assert.equal(warnMock.mock.calls.length, 0, 'the healthy path stays noise-free');
    });

    test('exchange consumes the bootstrap (second exchange fails)', async () => {
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap' });
      const first = await store.exchangeBootstrapToken(boot.token);
      assert.ok(first, 'First exchange should succeed');
      const second = await store.exchangeBootstrapToken(boot.token);
      assert.strictEqual(second, null, 'Second exchange should fail (consumed)');
    });

    test('exchange rejects a standard (non-bootstrap) token', async () => {
      const standard = await store.createToken('workspace-1', { scope: 'readWrite' });
      const result = await store.exchangeBootstrapToken(standard.token);
      assert.strictEqual(result, null, 'Only bootstrap tokens are exchangeable');
    });

    test('exchange rejects an expired bootstrap', async () => {
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap', ttl: 1 });
      const docs = collection._docs();
      docs[0].expiresAt = new Date(Date.now() - 60 * 1000);
      const result = await store.exchangeBootstrapToken(boot.token);
      assert.strictEqual(result, null, 'Expired bootstrap should not exchange');
    });

    test('exchange honors an explicit working-token ttl', async () => {
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });
      const working = await store.exchangeBootstrapToken(boot.token, { ttl: 60 * 60 });
      const hours = (new Date(working.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000);
      assert.ok(hours > 0.9 && hours < 1.1, `Working TTL should be ~1h, got ${hours.toFixed(2)}`);
    });

    test('invalid kind throws', async () => {
      await assert.rejects(
        () => store.createToken('workspace-1', { kind: 'admin' }),
        /kind must be/
      );
    });

    // LIN-1587 R1 — the exchanged working token inherits the bootstrap's OWN
    // label (e.g. 'dispatch-bootstrap'/'refire-broker'/'collective') instead of
    // being flattened to the literal 'exchanged', so per-site lanes survive
    // the exchange into the Event Log / agent-status snapshot.
    test('LIN-1587: exchange inherits the bootstrap\'s own label when no override is given', async () => {
      const boot = await store.createToken('workspace-1', {
        kind: 'bootstrap',
        scope: 'readWrite',
        label: 'dispatch-bootstrap'
      });
      const working = await store.exchangeBootstrapToken(boot.token);
      assert.strictEqual(working.label, 'dispatch-bootstrap');
    });

    test('LIN-1587: an explicit options.label still overrides the bootstrap\'s own label', async () => {
      const boot = await store.createToken('workspace-1', {
        kind: 'bootstrap',
        scope: 'readWrite',
        label: 'dispatch-bootstrap'
      });
      const working = await store.exchangeBootstrapToken(boot.token, { label: 'custom-override' });
      assert.strictEqual(working.label, 'custom-override');
    });

    test('LIN-1587: a bootstrap with no label at all (e.g. a pre-existing legacy record) falls back to \'exchanged\'', async () => {
      // createToken always defaults an omitted label to 'default', so the only
      // way to exercise a genuinely label-less bootstrap doc is to strip the
      // field directly on the stored record, same as the expired-bootstrap test
      // above manipulates `expiresAt`.
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });
      const docs = collection._docs();
      delete docs[0].label;
      const working = await store.exchangeBootstrapToken(boot.token);
      assert.strictEqual(working.label, 'exchanged');
    });
  });

  // ---------------------------------------------------------------------------
  // LIN-1582 — the STRUCTURAL ownerless-bootstrap refusal.
  //
  // LIN-1448 gated the two dispatched mint sites and called
  // provisionBootstrapToken "the choke point every bootstrap mint passes through".
  // It wasn't: routes/collective.js's prose branch, the session-auth token
  // endpoint, and the test-only /test/create-proxy-token all called createToken
  // with kind:'bootstrap' directly, so with the lane off they could still mint an
  // ownerless bootstrap — and ownerlessness is inherited by the exchanged working
  // token and by anything that worker mints (the LIN-1576 shape). Refusing in the
  // store makes the claim true for every present AND future mint site.
  //
  // The `kind === 'bootstrap'` scope is load-bearing in two directions, and both
  // are pinned below: non-bootstrap minting must stay untouched (LIN-1447), and
  // exchangeBootstrapToken's internal mint is kind:'standard', so an
  // already-issued ownerless bootstrap must stay exchangeable rather than
  // stranding the compat population mid-flight.
  // ---------------------------------------------------------------------------
  describe('LIN-1582 — ownerless bootstrap mints are refused structurally', () => {
    const ENV = 'DISPATCH_OWNERLESS_BROKER_COMPAT';
    const restore = (t) => {
      const before = process.env[ENV];
      t.after(() => {
        if (before === undefined) delete process.env[ENV];
        else process.env[ENV] = before;
      });
    };

    test('compat OFF + bootstrap + no createdBy → refused, and NOTHING is inserted', async (t) => {
      restore(t);
      process.env[ENV] = 'off';

      await assert.rejects(
        () => store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' }),
        (err) => {
          assert.match(err.message, /LIN-1582/);
          assert.match(err.message, /owner/i);
          return true;
        }
      );
      // The refusal must precede the write — a rejected mint that still landed a
      // row would leave a live ownerless credential behind the error.
      assert.equal(collection._docs().length, 0, 'no token document may be written');
    });

    test('compat OFF + bootstrap + createdBy present → mints, unchanged', async (t) => {
      restore(t);
      process.env[ENV] = 'off';

      const result = await store.createToken('workspace-1', {
        kind: 'bootstrap', scope: 'readWrite', createdBy: 'account-A'
      });

      assert.equal(result.kind, 'bootstrap');
      assert.equal(result.singleUse, true, 'still forced single-use');
      assert.equal(collection._docs()[0].createdBy, 'account-A');
    });

    test('compat OFF + kind:standard + no createdBy → mints (non-bootstrap is untouched)', async (t) => {
      restore(t);
      process.env[ENV] = 'off';

      // LIN-1447's constraint: the switch governs bootstrap minting only. An
      // ownerless standard token is a weak credential, but refusing it here would
      // break every ordinary mint path the switch was never scoped to.
      const result = await store.createToken('workspace-1', { scope: 'read' });

      assert.equal(result.kind, 'standard');
      assert.ok(await store.validateToken(result.token), 'the standard token works');
    });

    test('compat ON (default) + bootstrap + no createdBy → still mints (compat preserved)', async (t) => {
      restore(t);
      delete process.env[ENV];

      const result = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });

      assert.equal(result.kind, 'bootstrap');
      assert.equal(collection._docs()[0].createdBy, null, 'the compat population is still mintable');
    });

    test('a typo in the env value leaves the compat lane running (fails safe)', async (t) => {
      restore(t);
      // Accidental strictness costs the host runner its mint path (LIN-1447's
      // original outage); accidental leniency is the status quo. Only a
      // recognised off-value may switch strictness on.
      process.env[ENV] = 'offf';

      const result = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });
      assert.equal(result.kind, 'bootstrap');
    });

    test('compat OFF: an already-issued ownerless bootstrap STILL exchanges', async (t) => {
      restore(t);
      // Mint the ownerless bootstrap while the lane is on — this is the
      // pre-existing population the switch is draining, not a new mint.
      delete process.env[ENV];
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap', scope: 'readWrite' });

      // Now flip strictness on. The exchange mints kind:'standard', so the
      // bootstrap-scoped guard must not catch it: refusing here would strand a
      // live consumer mid-flight rather than at a mint it could retry, which is
      // exactly what LIN-1448 refused to do.
      process.env[ENV] = 'off';
      t.mock.method(console, 'warn', () => {});

      const working = await store.exchangeBootstrapToken(boot.token);

      assert.ok(working, 'the exchange must remain reachable with the lane off');
      assert.equal(working.kind, 'standard');
      assert.equal(working.urlKey, 'workspace-1');
      assert.ok(await store.validateToken(working.token), 'the working token authenticates');
    });

    test('compat OFF: an OWNED bootstrap exchanges and carries its owner across', async (t) => {
      restore(t);
      process.env[ENV] = 'off';

      const boot = await store.createToken('workspace-1', {
        kind: 'bootstrap', scope: 'readWrite', createdBy: 'account-A'
      });
      const working = await store.exchangeBootstrapToken(boot.token);

      const validated = await store.validateToken(working.token);
      assert.equal(validated.createdBy, 'account-A', 'the healthy path is entirely unchanged');
    });
  });

  describe('token expiry', () => {
    test('expired token is rejected', async () => {
      // Create a token with a 1-second TTL, then manually set it to past
      const result = await store.createToken('workspace-1', { ttl: 1 });
      const docs = collection._docs();
      // Set expiry to 1 hour ago
      docs[0].expiresAt = new Date(Date.now() - 60 * 60 * 1000);

      const validated = await store.validateToken(result.token);
      assert.strictEqual(validated, null, 'Expired token should not validate');
    });

    test('token with explicit null TTL does not expire', async () => {
      const result = await store.createToken('workspace-1', { ttl: null });
      const docs = collection._docs();
      assert.strictEqual(docs[0].expiresAt, null, 'Explicit null TTL should yield null expiresAt');

      const validated = await store.validateToken(result.token);
      assert.ok(validated, 'Non-expiring token should validate');
    });

    test('token gets default TTL when none specified', async () => {
      const result = await store.createToken('workspace-1');
      const docs = collection._docs();
      assert.ok(docs[0].expiresAt instanceof Date, 'Default expiresAt should be set');

      const days = (docs[0].expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      assert.ok(days > 80 && days < 95, `Default TTL should be ~90 days, got ${days.toFixed(1)}`);

      const validated = await store.validateToken(result.token);
      assert.ok(validated, 'Token within default TTL should validate');
    });
  });

  describe('describeRejectionCause (LIN-1938 S2 — read-only rejection-cause lookup)', () => {
    test('unrecognized bearer returns null', async () => {
      const descriptor = await store.describeRejectionCause('never-issued-token');
      assert.strictEqual(descriptor, null);
    });

    test('empty/missing token returns null', async () => {
      assert.strictEqual(await store.describeRejectionCause(''), null);
      assert.strictEqual(await store.describeRejectionCause(null), null);
    });

    test('bootstrap-only token resolves to bootstrap_only', async () => {
      const boot = await store.createToken('workspace-1', { kind: 'bootstrap' });
      const descriptor = await store.describeRejectionCause(boot.token);
      assert.strictEqual(descriptor.state, 'bootstrap_only');
      assert.strictEqual(descriptor.urlKey, 'workspace-1');
    });

    test('expired standard token resolves to expired + expiresAt', async () => {
      const result = await store.createToken('workspace-1', { ttl: 1 });
      const docs = collection._docs();
      const expiredAt = new Date(Date.now() - 60 * 60 * 1000);
      docs[0].expiresAt = expiredAt;

      const descriptor = await store.describeRejectionCause(result.token);
      assert.strictEqual(descriptor.state, 'expired');
      assert.strictEqual(descriptor.expiresAt, expiredAt.toISOString());
      assert.strictEqual(descriptor.urlKey, 'workspace-1');
    });

    test('consumed single-use token resolves to consumed', async () => {
      const result = await store.createToken('workspace-1', { singleUse: true });
      await store.validateToken(result.token); // consumes it
      const descriptor = await store.describeRejectionCause(result.token);
      assert.strictEqual(descriptor.state, 'consumed');
    });

    test('a legacy doc with no `kind` field is treated as standard, not misclassified as bootstrap-only', async () => {
      const result = await store.createToken('workspace-1', { ttl: 1 });
      const docs = collection._docs();
      delete docs[0].kind;
      docs[0].expiresAt = new Date(Date.now() - 60 * 60 * 1000);

      const descriptor = await store.describeRejectionCause(result.token);
      assert.strictEqual(descriptor.state, 'expired');
    });

    test('a still-valid token (no rejection reason) resolves to null — nothing to describe', async () => {
      const result = await store.createToken('workspace-1');
      const descriptor = await store.describeRejectionCause(result.token);
      assert.strictEqual(descriptor, null);
    });

    test('never mutates: lastUsedAt/consumed are unchanged after the call', async () => {
      const result = await store.createToken('workspace-1', { singleUse: true, kind: 'bootstrap' });
      const docs = collection._docs();
      const before = { lastUsedAt: docs[0].lastUsedAt, consumed: docs[0].consumed };

      await store.describeRejectionCause(result.token);

      assert.deepStrictEqual(
        { lastUsedAt: docs[0].lastUsedAt, consumed: docs[0].consumed },
        before,
        'describeRejectionCause must not write lastUsedAt/consumed (read-only lookup)'
      );
    });
  });

  describe('scope', () => {
    test('read scope is stored correctly', async () => {
      const result = await store.createToken('workspace-1', { scope: 'read' });
      const validated = await store.validateToken(result.token);
      assert.strictEqual(validated.scope, 'read');
    });

    test('readWrite scope is stored correctly', async () => {
      const result = await store.createToken('workspace-1', { scope: 'readWrite' });
      const validated = await store.validateToken(result.token);
      assert.strictEqual(validated.scope, 'readWrite');
    });

    test('invalid scope throws error', async () => {
      await assert.rejects(
        () => store.createToken('workspace-1', { scope: 'admin' }),
        /scope must be/
      );
    });
  });

  describe('cleanup', () => {
    test('removes expired tokens', async () => {
      await store.createToken('workspace-1', { ttl: 1 });
      const docs = collection._docs();
      // Set expiry to past
      docs[0].expiresAt = new Date(Date.now() - 60 * 1000);

      const removed = await store.cleanup();
      assert.strictEqual(removed, 1);
      assert.strictEqual(collection._docs().length, 0);
    });

    test('removes consumed single-use tokens older than 24h', async () => {
      const result = await store.createToken('workspace-1', { singleUse: true });
      // Consume it
      await store.validateToken(result.token);
      // Set lastUsedAt to 25 hours ago
      const docs = collection._docs();
      docs[0].lastUsedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

      const removed = await store.cleanup();
      assert.strictEqual(removed, 1);
    });

    test('does not remove active tokens', async () => {
      await store.createToken('workspace-1');
      const removed = await store.cleanup();
      assert.strictEqual(removed, 0);
      assert.strictEqual(collection._docs().length, 1);
    });
  });

  // LIN-1586, mirroring tests/unit/dispatch-tokens.test.js (LIN-1448). The
  // operator question is the same on both lists — "which of my tokens are
  // ownerless?" — and it was unanswerable from outside the database for proxy
  // tokens: listTokens returned label/scope/dates and nothing about ownership.
  // An ownerless token is what workspace-token selection reports as
  // `token_ownerless`, the fault Beat 1 is making visible.
  describe('listTokens ownership verdict (LIN-1586)', () => {
    test('reports hasOwner so ownerless tokens are findable on the list', async () => {
      await store.createToken('acme', { label: 'owned', createdBy: 'account-A' });
      await store.createToken('acme', { label: 'legacy-runner' });

      const tokens = await store.listTokens('acme');
      const byLabel = Object.fromEntries(tokens.map(t => [t.label, t]));

      assert.strictEqual(byLabel.owned.hasOwner, true);
      assert.strictEqual(byLabel['legacy-runner'].hasOwner, false, 'an ownerless token is the thing being hunted');
    });

    test('a doc with no createdBy field at all reads as hasOwner:false', async () => {
      // The pre-LIN-1397 row shape: the key is absent, not null.
      await store.createToken('acme', { label: 'seed' });
      const docs = collection._docs();
      delete docs[0].createdBy;

      const [token] = await store.listTokens('acme');
      assert.strictEqual(token.hasOwner, false);
    });

    test('ownership is a verdict — the owning account id never reaches the list', async () => {
      await store.createToken('acme', { label: 'owned', createdBy: 'account-A' });
      const tokens = await store.listTokens('acme');
      const blob = JSON.stringify(tokens);
      assert.ok(!blob.includes('account-A'), `listTokens must not leak the owner id: ${blob}`);
      assert.ok(!blob.includes('createdBy'), `listTokens must not expose the owner field: ${blob}`);
    });

    test('the pre-existing metadata is untouched (additive field only)', async () => {
      await store.createToken('acme', { label: 'owned', scope: 'readWrite', createdBy: 'account-A' });
      const [token] = await store.listTokens('acme');

      assert.deepStrictEqual(Object.keys(token).sort(), [
        'consumed', 'createdAt', 'expiresAt', 'hasOwner', 'kind',
        'label', 'lastUsedAt', 'scope', 'singleUse', 'tokenId'
      ]);
      assert.strictEqual(token.label, 'owned');
      assert.strictEqual(token.scope, 'readWrite');
      assert.strictEqual(token.kind, 'standard');
      assert.strictEqual(token.urlKey, undefined, 'the workspace key stays off this surface');
      assert.strictEqual(token.tokenHash, undefined, 'the hash stays off this surface');
      assert.ok(token.tokenId);
      assert.ok(token.createdAt);
    });
  });

  describe('revocation', () => {
    test('revoked token cannot be validated', async () => {
      const result = await store.createToken('workspace-1');
      await store.revokeToken('workspace-1', result.tokenId);

      const validated = await store.validateToken(result.token);
      assert.strictEqual(validated, null, 'Revoked token should not validate');
    });

    test('revoking requires matching workspace', async () => {
      const result = await store.createToken('workspace-1');
      const revoked = await store.revokeToken('wrong-workspace', result.tokenId);
      assert.strictEqual(revoked, false, 'Should not revoke with wrong workspace');

      // Token should still work
      const validated = await store.validateToken(result.token);
      assert.ok(validated, 'Token should still be valid');
    });
  });
});
