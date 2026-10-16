/**
 * Trashed-issue signal tests (LIN-401).
 *
 * Linear soft-deletes: a trashed issue still resolves when fetched by ID,
 * carrying its stale pre-deletion state, even though it has vanished from every
 * list/search/child collection. A consumer that reads it by ID reasons from a
 * ghost. These tests pin both halves of the fix:
 *
 *   - behaviour of the shared SIGNAL helper (lib/trashed-signal.js), and
 *   - the source-level wiring across every by-ID surface that feeds an external
 *     consumer (proxy reads, proxy writes, and the provider context fetcher).
 *     The proxy consumer endpoints make real GraphQL calls with no
 *     test-mode mock client, so — as with the LIN-300/LIN-399 guardrails — the
 *     wiring is pinned by reading the source rather than booting the server.
 *
 * Run with: node --test tests/unit/trashed-signal.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyTrashedSignal, isTrashed, TRASHED_STATE } from '../../lib/trashed-signal.js';
import { BASE_DEPS, buildApp, call, makeFakeProvider } from './lib/proxy-fake-deps.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const proxySource = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
// LIN-679 Stage 3a / LIN-2536: group D (the two by-ID read handlers this file
// pins below) moved to routes/proxy-reads.js. `proxySource` still fed the
// group-E write-guard assertions until Stage 3b moved those too (see
// `writesSource` below) — it now carries neither describe block's subject.
const readsSource = readFileSync(join(__dirname, '../../routes/proxy-reads.js'), 'utf8');
const providerSource = readFileSync(join(__dirname, '../../lib/providers/linear/index.js'), 'utf8');
// LIN-2245: the /api/proxy/instructions catalog (where these doc-side
// Trashed/trashed/409 mentions actually live) moved out of routes/proxy.js
// into its own pure builder module — read that too, or this assertion goes
// partly vacuous (satisfied by unrelated code/doc text alone).
const instructionsAndDocs = proxySource
  + readFileSync(join(__dirname, '../../lib/proxy-instructions.js'), 'utf8')
  + readFileSync(join(__dirname, '../../docs/proxy-integration.md'), 'utf8');

// Pull a named gql`...` template literal out of a source file by its const name.
function extractQuery(source, name) {
  const start = source.indexOf(`const ${name} = gql\``);
  assert.ok(start !== -1, `${name} not found`);
  const open = source.indexOf('`', start);
  const close = source.indexOf('`', open + 1);
  assert.ok(close !== -1, `Could not find end of ${name} template literal`);
  return source.slice(open + 1, close);
}

describe('applyTrashedSignal / isTrashed (shared SIGNAL helper)', () => {
  test('overrides a trashed issue\'s state to terminal Trashed/canceled', () => {
    const issue = { identifier: 'LIN-394', state: { name: 'Backlog', type: 'backlog' }, trashed: true };
    const out = applyTrashedSignal(issue);
    assert.equal(out.state.name, 'Trashed');
    assert.equal(out.state.type, 'canceled', 'type must be canceled so every terminal guard handles it');
    assert.equal(out.trashed, true);
  });

  test('reuses canceled (a real terminal type) — not a synthetic state.type', () => {
    // The whole point of the post-review decision: terminal guards (isTerminalState,
    // the recommend descent guard) key off TERMINAL_TYPES, which already includes
    // canceled. A novel type would read as actionable work.
    assert.equal(TRASHED_STATE.type, 'canceled');
    assert.equal(TRASHED_STATE.name, 'Trashed');
  });

  test('leaves a live issue completely unchanged', () => {
    const live = { identifier: 'LIN-1', state: { name: 'In Progress', type: 'started' }, trashed: false };
    const out = applyTrashedSignal(live);
    assert.deepEqual(out.state, { name: 'In Progress', type: 'started' });
    assert.equal(out.trashed, false);
  });

  test('treats a missing trashed field as live (no override)', () => {
    const live = { identifier: 'LIN-2', state: { name: 'Todo', type: 'unstarted' } };
    applyTrashedSignal(live);
    assert.equal(live.state.type, 'unstarted');
  });

  test('keeps Trashed distinct from a deliberate canceled state', () => {
    // A user can deliberately set a state of type canceled; that is NOT a
    // deletion. The name + flag are what keep the two distinguishable, since
    // both share type=canceled.
    const trashed = applyTrashedSignal({ state: { name: 'Backlog', type: 'backlog' }, trashed: true });
    const canceled = { state: { name: 'Canceled', type: 'canceled' }, trashed: false };
    assert.equal(isTrashed(trashed), true);
    assert.equal(isTrashed(canceled), false);
    assert.notEqual(trashed.state.name, canceled.state.name);
  });

  test('isTrashed is robust to null/undefined', () => {
    assert.equal(isTrashed(null), false);
    assert.equal(isTrashed(undefined), false);
    assert.equal(isTrashed({}), false);
  });
});

describe('by-ID queries select the trashed field', () => {
  // The API-surface by-id read + relations queries moved to the provider in
  // LIN-308 (API_ISSUE_DETAIL_QUERY / RELATIONS_QUERY); the write-guard reads
  // followed in LIN-309 (ISSUE_LABELS_QUERY / ISSUE_DESCRIPTION_QUERY /
  // TRASHED_GUARD_QUERY). The trashed-field guard follows them to the provider.
  test('provider API_ISSUE_DETAIL_QUERY selects trashed (via the shared ApiIssueFields fragment)', () => {
    // LIN-589 moved the issue's own fields (including `trashed`) into the shared
    // API_ISSUE_FIELDS fragment so the detail read and the write echoes can't
    // drift. The detail query composes that fragment, so the trashed selection is
    // pinned on the fragment and the composition is pinned on the query.
    assert.match(extractQuery(providerSource, 'API_ISSUE_FIELDS'), /\btrashed\b/);
    assert.match(extractQuery(providerSource, 'API_ISSUE_DETAIL_QUERY'), /\.\.\.ApiIssueFields\b/);
  });
  test('provider RELATIONS_QUERY selects trashed on the root', () => {
    assert.match(extractQuery(providerSource, 'RELATIONS_QUERY'), /\btrashed\b/);
  });
  test('provider ISSUE_LABELS_QUERY selects trashed', () => {
    assert.match(extractQuery(providerSource, 'ISSUE_LABELS_QUERY'), /\btrashed\b/);
  });
  test('provider ISSUE_DESCRIPTION_QUERY selects trashed', () => {
    assert.match(extractQuery(providerSource, 'ISSUE_DESCRIPTION_QUERY'), /\btrashed\b/);
  });
  test('provider TRASHED_GUARD_QUERY exists for writes that do not otherwise read', () => {
    assert.match(extractQuery(providerSource, 'TRASHED_GUARD_QUERY'), /\btrashed\b/);
  });
  test('provider ISSUE_DETAIL_QUERY selects trashed', () => {
    assert.match(extractQuery(providerSource, 'ISSUE_DETAIL_QUERY'), /\btrashed\b/);
  });
});

describe('SIGNAL: raw by-ID reads override state / flag the ghost', () => {
  test('/issues/:id handler applies the trashed signal', () => {
    assert.match(readsSource, /applyTrashedSignal\(issue\)/);
  });
  test('/relations/:id handler returns a top-level trashed flag', () => {
    assert.match(readsSource, /trashed:\s*isTrashed\(issueRelations\)/);
  });
});

describe('REFUSE: context fetcher rejects a trashed target (surfaces 4-6)', () => {
  test('provider fetchIssueContext throws not-found on a trashed issue', () => {
    // The throw must (a) fire on data.issue.trashed and (b) carry "not found"
    // so the proxy recommend/recap/brief error mappers reuse their 404 branch.
    const start = providerSource.indexOf('export async function fetchIssueContext');
    const body = providerSource.slice(start, start + 1200);
    assert.match(body, /data\.issue\.trashed/, 'must check the trashed flag');
    assert.match(body, /throw new Error\(`Issue not found \(trashed\)/, 'must throw a not-found-shaped error');
  });
});

describe('REFUSE: write endpoints reject a trashed target with 409 (surfaces 3, 8)', () => {
  // LIN-3573: these three tests used to read routes/proxy-writes.js as text (a
  // `refuseIfTrashed` function, >=3 call sites, >=3 inline blocks), which locked
  // in the old structure. They now drive every route that refuses a trashed
  // target through the real composer (tests/unit/lib/proxy-fake-deps.js) and
  // assert the behaviour the structure only served: a 409 and ZERO provider
  // writes. The ten URL forms are LIN-3573's class C2.
  const ISSUE = 'LIN-1';
  const LABEL = '11111111-1111-4111-8111-111111111111';
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const WRITES = ['updateIssue', 'createComment', 'uploadFile', 'createRelation', 'updateIssueLabels'];
  let unique = 0;

  // `endpoint` is the logEvent string each form reports on refusal.
  const FORMS = {
    patch: { method: 'patch', path: `/api/proxy/issues/${ISSUE}`, body: () => ({ title: 'new title' }), endpoint: '/api/proxy/issues/:id' },
    comment: { method: 'post', path: `/api/proxy/issues/${ISSUE}/comments`, body: () => ({ body: `c ${++unique}` }), endpoint: '/api/proxy/issues/comments' },
    commentAlias: { method: 'post', path: `/api/proxy/comments/${ISSUE}`, body: () => ({ body: `c ${++unique}` }), endpoint: '/api/proxy/issues/comments' },
    attachComment: { method: 'post', path: `/api/proxy/issues/${ISSUE}/attachments`, body: () => ({ image: PNG, target: 'comment' }), endpoint: '/api/proxy/issues/:id/attachments' },
    relation: { method: 'post', path: `/api/proxy/issues/${ISSUE}/relations`, body: () => ({ type: 'related', relatedIssueId: 'LIN-2' }), endpoint: '/api/proxy/issues/relations' },
    labelAdd: { method: 'post', path: `/api/proxy/issues/${ISSUE}/labels`, body: () => ({ labelId: LABEL }), endpoint: '/api/proxy/issues/labels' },
    labelRemove: { method: 'delete', path: `/api/proxy/issues/${ISSUE}/labels/${LABEL}`, endpoint: '/api/proxy/issues/labels' },
    append: { method: 'post', path: `/api/proxy/issues/${ISSUE}/description/append`, body: () => ({ block: 'more' }), endpoint: '/api/proxy/issues/:id/description/append' },
    replace: { method: 'post', path: `/api/proxy/issues/${ISSUE}/description/replace`, body: () => ({ oldString: 'body', newString: 'text' }), endpoint: '/api/proxy/issues/:id/description/replace' },
    attachDescription: { method: 'post', path: `/api/proxy/issues/${ISSUE}/attachments`, body: () => ({ image: PNG, target: 'description' }), endpoint: '/api/proxy/issues/:id/attachments' },
  };
  const GROUP_GUARD_READ = ['patch', 'comment', 'commentAlias', 'attachComment', 'relation'];
  const GROUP_INLINE = ['labelAdd', 'labelRemove', 'append', 'replace', 'attachDescription'];

  // Every read the write routes make reports the target as trashed; every write
  // is recorded so a refusal can be shown to have written nothing.
  function trashedWorld() {
    const calls = [];
    const events = [];
    const trashed = { id: 'i1', trashed: true, description: 'body', labels: { nodes: [] }, state: { type: 'canceled' }, team: { id: 't1' } };
    const provider = makeFakeProvider();
    provider.issueWriteGuard = async () => trashed;
    provider.issueDescription = async () => trashed;
    provider.issueLabels = async () => trashed;
    for (const name of WRITES) {
      const real = provider[name];
      provider[name] = async (...args) => { calls.push(name); return real(...args); };
    }
    const proxyEventStore = { ...BASE_DEPS().proxyEventStore, recordEvent: async (event) => { events.push(event); } };
    return { app: buildApp({ provider, proxyEventStore }), calls, events };
  }

  async function sendForm(world, form) {
    return call(world.app, form.method, form.path, form.body ? { body: form.body() } : {});
  }

  async function assertRefused(names) {
    for (const name of names) {
      const world = trashedWorld();
      const res = await sendForm(world, FORMS[name]);
      assert.equal(res.status, 409, `${name}: expected 409, got ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual(world.calls, [], `${name}: a trashed target must reach no provider write, saw ${world.calls}`);
    }
  }

  test('a shared refuseIfTrashed guard exists and returns 409', async () => {
    // The shared refusal shape on all ten forms: the 409 envelope, and the audit
    // event carrying the route's own endpoint string.
    for (const [name, form] of Object.entries(FORMS)) {
      const world = trashedWorld();
      const res = await sendForm(world, form);
      assert.equal(res.status, 409, `${name}: expected 409, got ${res.status}`);
      assert.deepEqual(res.body, { error: 'Issue is trashed; refusing to modify a deleted issue' }, `${name}: refusal envelope`);
      const logged = world.events.filter(e => e.status === 409);
      assert.deepEqual(logged.map(e => e.endpoint), [form.endpoint], `${name}: one 409 audit event on the route's endpoint`);
      assert.deepEqual(world.calls, [], `${name}: refusal must precede every provider write`);
    }

    // Control: the four routes that deliberately do NOT guard a trashed target
    // (removing a stray comment from a dead issue is their use case) reach the
    // provider. POST /issues has no target at all.
    const unguarded = [
      ['post', '/api/proxy/issues', { teamId: LABEL, title: 'new' }, 201],
      ['delete', `/api/proxy/issues/${ISSUE}/comments/${LABEL}`, undefined, 200],
      ['patch', `/api/proxy/issues/${ISSUE}/comments/${LABEL}`, { body: 'edited' }, 200],
      ['delete', `/api/proxy/issues/${ISSUE}/relations/${LABEL}`, undefined, 200],
    ];
    for (const [method, path, body, expected] of unguarded) {
      const res = await call(trashedWorld().app, method, path, body ? { body } : {});
      assert.equal(res.status, expected, `${method} ${path} must not refuse a trashed target`);
    }
  });

  test('PATCH, comments, and relation-create call refuseIfTrashed before mutating', async () => {
    // These read the write guard (issueWriteGuard) before they mutate.
    await assertRefused(GROUP_GUARD_READ);
  });

  test('label and description-edit handlers refuse trashed inline with 409', async () => {
    // These read the issue for their own purposes (labels, description), so they
    // branch on the in-hand flag rather than paying a second round-trip.
    await assertRefused(GROUP_INLINE);
  });

  // LIN-679 Stage 3b / LIN-2537: complementary absence pin (the `937555cd` /
  // Stage-3a-R2 template) — a still-green presence pin whose subject has left
  // routes/proxy.js would be a defect, not a pass. Guards against the guard
  // silently reappearing (or a partial move leaving a stray copy) in the
  // donor file.
  test('refuseIfTrashed no longer lives in routes/proxy.js', () => {
    assert.doesNotMatch(proxySource, /async function refuseIfTrashed/);
    assert.doesNotMatch(proxySource, /await refuseIfTrashed\(/);
  });
});

describe('docs document the trashed contract', () => {
  test('instructions + integration guide mention the synthetic Trashed state and refusal codes', () => {
    assert.match(instructionsAndDocs, /Trashed/);
    assert.match(instructionsAndDocs, /trashed/);
    assert.match(instructionsAndDocs, /409/, 'must document the write-refusal status');
  });
});
