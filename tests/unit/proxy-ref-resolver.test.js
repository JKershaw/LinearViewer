import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSourceNamespace,
  resolveStateRef,
  resolveLabelRef,
  resolveProjectRef,
  resolveTeamRef,
  RefResolutionError,
  STATE_TYPE_ALIASES,
  ACTIVE_SOURCES,
} from '../../lib/proxy-ref-resolver.js';

// A real-looking UUID and a Linear identifier, the two existing input forms that
// must keep working byte-identically.
const UUID = 'a1b2c3d4-1111-2222-3333-444455556666';
const UUID_2 = 'ffffffff-1111-2222-3333-444455556666';

const STATES = [
  { id: UUID, name: 'In Progress', type: 'started' },
  { id: UUID_2, name: 'Done', type: 'completed' },
  { id: 'cccccccc-1111-2222-3333-444455556666', name: 'Backlog', type: 'backlog' },
];

// ---------------------------------------------------------------------------
// Namespace parsing (layer 1)
// ---------------------------------------------------------------------------

test('parseSourceNamespace: a bare ref has no source and is returned untouched', () => {
  assert.deepEqual(parseSourceNamespace('LIN-123'), { source: null, localRef: 'LIN-123' });
  assert.deepEqual(parseSourceNamespace(UUID), { source: null, localRef: UUID });
  assert.deepEqual(parseSourceNamespace('done'), { source: null, localRef: 'done' });
});

test('parseSourceNamespace: linear: prefix is active and stripped', () => {
  assert.deepEqual(parseSourceNamespace('linear:LIN-42'), { source: 'linear', localRef: 'LIN-42' });
  assert.deepEqual(parseSourceNamespace('LINEAR:done'), { source: 'linear', localRef: 'done' });
});

test('parseSourceNamespace: a non-active provider namespace is rejected with 422', () => {
  for (const ref of ['github:#42', 'local:abc123']) {
    assert.throws(() => parseSourceNamespace(ref), (err) => {
      assert.ok(err instanceof RefResolutionError);
      assert.equal(err.status, 422);
      return true;
    });
  }
});

test('parseSourceNamespace: github becomes active once passed in activeSources', () => {
  assert.deepEqual(
    parseSourceNamespace('github:#42', ['linear', 'github']),
    { source: 'github', localRef: '#42' },
  );
});

test('ACTIVE_SOURCES is Linear-only today', () => {
  assert.deepEqual(ACTIVE_SOURCES, ['linear']);
});

// LIN-1885: adding SOURCE_JIRA to KNOWN_SOURCES (registered) without adding it
// to ACTIVE_SOURCES (live) has exactly one observable effect — `jira:` now
// parses as a recognised namespace and is rejected with a clean 422 "not
// active", the SAME treatment `github:`/`local:` already get above, rather
// than being silently swallowed as part of a bare local ref. It does NOT turn
// jira: refs on.
test('parseSourceNamespace: jira: is a KNOWN but not ACTIVE namespace — 422, same as github/local', () => {
  assert.throws(() => parseSourceNamespace('jira:ENG-1'), (err) => {
    assert.ok(err instanceof RefResolutionError);
    assert.equal(err.status, 422);
    assert.match(err.message, /^Provider namespace 'jira:' is not active in this workspace$/);
    return true;
  });
});

test('parseSourceNamespace: jira becomes active once passed in activeSources, same mechanism as github', () => {
  assert.deepEqual(
    parseSourceNamespace('jira:ENG-1', ['linear', 'jira']),
    { source: 'jira', localRef: 'ENG-1' },
  );
});

test('ACTIVE_SOURCES does NOT include jira (this ticket does not activate it)', () => {
  assert.deepEqual(ACTIVE_SOURCES, ['linear']);
  assert.ok(!ACTIVE_SOURCES.includes('jira'));
});

// ---------------------------------------------------------------------------
// State resolution (layer 2)
// ---------------------------------------------------------------------------

test('resolveStateRef: a UUID is passed through untouched (escape hatch, no list lookup needed)', () => {
  // Note: not even present in the list — UUID always wins.
  assert.equal(resolveStateRef([], UUID), UUID);
  assert.equal(resolveStateRef(STATES, UUID_2), UUID_2);
});

test('resolveStateRef: symbolic type aliases resolve to the matching state id', () => {
  assert.equal(resolveStateRef(STATES, 'done'), UUID_2);
  assert.equal(resolveStateRef(STATES, 'completed'), UUID_2);
  assert.equal(resolveStateRef(STATES, 'in-progress'), UUID);
  assert.equal(resolveStateRef(STATES, 'started'), UUID);
  assert.equal(resolveStateRef(STATES, 'backlog'), 'cccccccc-1111-2222-3333-444455556666');
});

test('resolveStateRef: literal state name matches case-insensitively', () => {
  assert.equal(resolveStateRef(STATES, 'In Progress'), UUID);
  assert.equal(resolveStateRef(STATES, 'done'), UUID_2);
  assert.equal(resolveStateRef(STATES, 'BACKLOG'), 'cccccccc-1111-2222-3333-444455556666');
});

test('resolveStateRef: an unmatched ref fails loud with 422', () => {
  assert.throws(() => resolveStateRef(STATES, 'nonsense'), (err) => {
    assert.ok(err instanceof RefResolutionError);
    assert.equal(err.status, 422);
    return true;
  });
});

test('resolveStateRef: two states of the same type → ambiguous 422 listing candidates', () => {
  const twoStarted = [
    { id: 'aaaa1111-1111-2222-3333-444455556666', name: 'In Progress', type: 'started' },
    { id: 'bbbb2222-1111-2222-3333-444455556666', name: 'In Review', type: 'started' },
  ];
  assert.throws(() => resolveStateRef(twoStarted, 'started'), (err) => {
    assert.ok(err instanceof RefResolutionError);
    assert.equal(err.status, 422);
    assert.equal(err.candidates.length, 2);
    assert.deepEqual(err.candidates.map(c => c.name).sort(), ['In Progress', 'In Review']);
    return true;
  });
});

test('STATE_TYPE_ALIASES covers the spelled-out variants from the ticket', () => {
  assert.equal(STATE_TYPE_ALIASES['cancelled'], 'canceled');
  assert.equal(STATE_TYPE_ALIASES['canceled'], 'canceled');
  assert.equal(STATE_TYPE_ALIASES['todo'], 'unstarted');
  assert.equal(STATE_TYPE_ALIASES['duplicate'], 'duplicate');
});

// ---------------------------------------------------------------------------
// Label / project / team resolution
// ---------------------------------------------------------------------------

const LABELS = [
  { id: UUID, name: 'bug' },
  { id: UUID_2, name: 'Feature' },
];

test('resolveLabelRef: UUID passthrough + case-insensitive name', () => {
  assert.equal(resolveLabelRef(LABELS, UUID), UUID);
  assert.equal(resolveLabelRef(LABELS, 'BUG'), UUID);
  assert.equal(resolveLabelRef(LABELS, 'feature'), UUID_2);
});

test('resolveLabelRef: ambiguous name (case-only duplicates) → 422 with candidates', () => {
  const dupes = [
    { id: 'aaaa1111-1111-2222-3333-444455556666', name: 'bug' },
    { id: 'bbbb2222-1111-2222-3333-444455556666', name: 'BUG' },
  ];
  assert.throws(() => resolveLabelRef(dupes, 'bug'), (err) => {
    assert.equal(err.status, 422);
    assert.equal(err.candidates.length, 2);
    return true;
  });
});

test('resolveLabelRef: unknown label → 422', () => {
  assert.throws(() => resolveLabelRef(LABELS, 'missing'), RefResolutionError);
});

test('resolveProjectRef: UUID passthrough + case-insensitive name', () => {
  const projects = [{ id: UUID, name: 'Providers & API Unification' }];
  assert.equal(resolveProjectRef(projects, UUID), UUID);
  assert.equal(resolveProjectRef(projects, 'providers & api unification'), UUID);
  assert.throws(() => resolveProjectRef(projects, 'Other'), RefResolutionError);
});

// LIN-1972: real Local composite ids (`${urlKey}-proj-1`) and GitHub milestone
// ids (number-strings) are non-UUID by construction — resolveProjectRef must
// match them by exact raw id, short-circuiting before any name sweep.
test('resolveProjectRef: exact non-UUID id match (Local composite id)', () => {
  const projects = [
    { id: 'acme-proj-1', name: 'Product' },
    { id: 'acme-proj-2', name: 'Marketing' },
  ];
  assert.equal(resolveProjectRef(projects, 'acme-proj-1'), 'acme-proj-1');
});

test('resolveProjectRef: exact non-UUID id match (GitHub milestone-number id)', () => {
  const projects = [
    { id: '7', name: 'v2.0' },
    { id: '12', name: 'v2.1' },
  ];
  assert.equal(resolveProjectRef(projects, '7'), '7');
});

test('resolveProjectRef: id/name ambiguity — id match wins, no false NOT_UNIQUE', () => {
  // Project A's id equals project B's name: a merged id+name filter would
  // throw NOT_UNIQUE here; the id match must short-circuit before that sweep.
  const projectA = { id: 'Product', name: 'Alpha' };
  const projectB = { id: 'proj-2', name: 'Product' };
  assert.equal(resolveProjectRef([projectA, projectB], 'Product'), 'Product');
});

test('resolveTeamRef: UUID passthrough + key + name, all case-insensitive', () => {
  const teams = [{ id: UUID, name: 'Linear Team', key: 'LIN' }];
  assert.equal(resolveTeamRef(teams, UUID), UUID);
  assert.equal(resolveTeamRef(teams, 'lin'), UUID);
  assert.equal(resolveTeamRef(teams, 'LIN'), UUID);
  assert.equal(resolveTeamRef(teams, 'linear team'), UUID);
  assert.throws(() => resolveTeamRef(teams, 'ENG'), RefResolutionError);
});
