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

const __dirname = dirname(fileURLToPath(import.meta.url));
const proxySource = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
// LIN-679 Stage 3a / LIN-2536: group D (the two by-ID read handlers this file
// pins below) moved to routes/proxy-reads.js. `proxySource` still fed the
// group-E write-guard assertions until Stage 3b moved those too (see
// `writesSource` below) — it now carries neither describe block's subject.
const readsSource = readFileSync(join(__dirname, '../../routes/proxy-reads.js'), 'utf8');
// LIN-679 Stage 3b / LIN-2537: group E (refuseIfTrashed + its call sites, the
// write-endpoint 409 guard this file's REFUSE block pins) moved to
// routes/proxy-writes.js — re-point those assertions here, mirroring the
// Stage 3a readsSource split above.
const writesSource = readFileSync(join(__dirname, '../../routes/proxy-writes.js'), 'utf8');
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
  test('a shared refuseIfTrashed guard exists and returns 409', () => {
    assert.match(writesSource, /async function refuseIfTrashed/);
    const start = writesSource.indexOf('async function refuseIfTrashed');
    // 600, not 400: LIN-1559 prepended the missing-read backstop line ahead of
    // the guard read, pushing the 409 refusal past a 400-char window. The
    // assertions below are what this test protects; the window is just how far it
    // reads to find them.
    const body = writesSource.slice(start, start + 600);
    assert.match(body, /status\(409\)|jsonError\(res, 409/, 'refusal must be a 409');
    assert.match(body, /isTrashed\(issue\)/);
  });

  test('PATCH, comments, and relation-create call refuseIfTrashed before mutating', () => {
    // Count the guard call sites in the write handlers (PATCH + comments +
    // relations = 3 invocations beyond the definition itself).
    const calls = (writesSource.match(/await refuseIfTrashed\(/g) || []).length;
    assert.ok(calls >= 3, `expected >=3 refuseIfTrashed call sites, found ${calls}`);
  });

  test('label and description-edit handlers refuse trashed inline with 409', () => {
    // These already read the issue, so they branch on the in-hand flag rather
    // than paying a second round-trip.
    const inline409 = (writesSource.match(/isTrashed\(issue\)\) \{\s*\n\s*logEvent\([^\n]*409\)/g) || []).length;
    assert.ok(inline409 >= 3, `expected >=3 inline 409 refusals (2 label + 1 description), found ${inline409}`);
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
