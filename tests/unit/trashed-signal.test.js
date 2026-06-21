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
 *     consumer (proxy reads, proxy writes, the provider context fetcher, and the
 *     CLI). The proxy consumer endpoints make real GraphQL calls with no
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
const providerSource = readFileSync(join(__dirname, '../../lib/providers/linear/index.js'), 'utf8');
const cliSource = readFileSync(join(__dirname, '../../lib/linear-cli.js'), 'utf8');
const instructionsAndDocs = proxySource + readFileSync(join(__dirname, '../../docs/proxy-integration.md'), 'utf8');

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
  // LIN-308 (API_ISSUE_DETAIL_QUERY / RELATIONS_QUERY); the trashed-field guard
  // follows them there. The write/helper queries below stay inline in the route.
  test('provider API_ISSUE_DETAIL_QUERY selects trashed', () => {
    assert.match(extractQuery(providerSource, 'API_ISSUE_DETAIL_QUERY'), /\btrashed\b/);
  });
  test('provider RELATIONS_QUERY selects trashed on the root', () => {
    assert.match(extractQuery(providerSource, 'RELATIONS_QUERY'), /\btrashed\b/);
  });
  test('proxy ISSUE_LABELS_QUERY selects trashed', () => {
    assert.match(extractQuery(proxySource, 'ISSUE_LABELS_QUERY'), /\btrashed\b/);
  });
  test('proxy ISSUE_DESCRIPTION_QUERY selects trashed', () => {
    assert.match(extractQuery(proxySource, 'ISSUE_DESCRIPTION_QUERY'), /\btrashed\b/);
  });
  test('proxy TRASHED_GUARD_QUERY exists for writes that do not otherwise read', () => {
    assert.match(extractQuery(proxySource, 'TRASHED_GUARD_QUERY'), /\btrashed\b/);
  });
  test('provider ISSUE_DETAIL_QUERY selects trashed', () => {
    assert.match(extractQuery(providerSource, 'ISSUE_DETAIL_QUERY'), /\btrashed\b/);
  });
  test('CLI by-ID issue query selects trashed', () => {
    // The CLI query is an inline gql template, not a named const — assert it
    // appears in the fetchIssueContext function body.
    const start = cliSource.indexOf('async function fetchIssueContext');
    const body = cliSource.slice(start, start + 2000);
    assert.match(body, /\btrashed\b/, 'CLI issue query must select trashed');
  });
});

describe('SIGNAL: raw by-ID reads override state / flag the ghost', () => {
  test('/issues/:id handler applies the trashed signal', () => {
    assert.match(proxySource, /applyTrashedSignal\(issue\)/);
  });
  test('/relations/:id handler returns a top-level trashed flag', () => {
    assert.match(proxySource, /trashed:\s*isTrashed\(issueRelations\)/);
  });
  test('CLI issue output runs through applyTrashedSignal', () => {
    assert.match(cliSource, /applyTrashedSignal\(/);
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
    assert.match(proxySource, /async function refuseIfTrashed/);
    const start = proxySource.indexOf('async function refuseIfTrashed');
    const body = proxySource.slice(start, start + 400);
    assert.match(body, /status\(409\)|jsonError\(res, 409/, 'refusal must be a 409');
    assert.match(body, /isTrashed\(data\.issue\)/);
  });

  test('PATCH, comments, and relation-create call refuseIfTrashed before mutating', () => {
    // Count the guard call sites in the write handlers (PATCH + comments +
    // relations = 3 invocations beyond the definition itself).
    const calls = (proxySource.match(/await refuseIfTrashed\(/g) || []).length;
    assert.ok(calls >= 3, `expected >=3 refuseIfTrashed call sites, found ${calls}`);
  });

  test('label and description-edit handlers refuse trashed inline with 409', () => {
    // These already read the issue, so they branch on the in-hand flag rather
    // than paying a second round-trip.
    const inline409 = (proxySource.match(/isTrashed\((?:issueData|data)\.issue\)\) \{\s*\n\s*logEvent\([^\n]*409\)/g) || []).length;
    assert.ok(inline409 >= 3, `expected >=3 inline 409 refusals (2 label + 1 description), found ${inline409}`);
  });
});

describe('docs document the trashed contract', () => {
  test('instructions + integration guide mention the synthetic Trashed state and refusal codes', () => {
    assert.match(instructionsAndDocs, /Trashed/);
    assert.match(instructionsAndDocs, /trashed/);
    assert.match(instructionsAndDocs, /409/, 'must document the write-refusal status');
  });
});
