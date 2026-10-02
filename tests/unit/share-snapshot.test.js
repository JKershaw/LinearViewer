/**
 * Unit tests for lib/share-snapshot.js (LIN-3243, Session A of LIN-3073).
 *
 * Run with: node --test tests/unit/share-snapshot.test.js
 *
 * Pure transform tests — no I/O. The load-bearing claims are the strict
 * projection allow-list (nothing beyond the five fields, plus opt-in
 * descriptions, ever reaches the snapshot), comments never being selected,
 * the canceled/duplicate hiding rules, and member selection by `parent.id` or
 * label name across provider label shapes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildShareSnapshot } from '../../lib/share-snapshot.js';

const PARENT_ID = 'parent-uuid-1';

function issue(overrides = {}) {
  return {
    id: overrides.id ?? 'issue-uuid',
    identifier: overrides.identifier ?? 'LIN-2',
    title: overrides.title ?? 'A task',
    description: overrides.description ?? 'desc',
    state: overrides.state ?? { name: 'Todo', type: 'unstarted' },
    priority: overrides.priority ?? 2,
    updatedAt: overrides.updatedAt ?? '2026-10-02T00:00:00.000Z',
    parent: 'parent' in overrides ? overrides.parent : { id: PARENT_ID },
    labels: overrides.labels ?? { nodes: [{ name: 'bug' }] },
    // fields that must NEVER reach the snapshot
    assignee: { name: 'SENTINEL-ASSIGNEE' },
    url: 'https://example.test/SENTINEL-URL',
    estimate: 5,
    comments: [{ body: 'SENTINEL-COMMENT' }]
  };
}

describe('share-snapshot', () => {
  test('projects members to a strict allow-list and nothing else', () => {
    const snap = buildShareSnapshot({
      subject: { type: 'collection', kind: 'parent', id: PARENT_ID },
      issues: [issue()]
    });

    assert.deepStrictEqual(Object.keys(snap.items[0]).sort(), ['identifier', 'priority', 'state', 'title', 'updatedAt']);
    assert.deepStrictEqual(snap.items[0].state, { type: 'unstarted' });

    const serialized = JSON.stringify(snap);
    for (const sentinel of ['SENTINEL-ASSIGNEE', 'SENTINEL-URL', 'SENTINEL-COMMENT']) {
      assert.ok(!serialized.includes(sentinel), `${sentinel} must not reach the snapshot`);
    }
    assert.ok(!serialized.includes('estimate'), 'estimate must not reach the snapshot');
  });

  test('comments are never selected', () => {
    const snap = buildShareSnapshot({
      subject: { type: 'collection', kind: 'parent', id: PARENT_ID },
      issues: [issue({ comments: [{ body: 'TOP-SECRET-COMMENT' }] })]
    });
    assert.ok(!JSON.stringify(snap).includes('TOP-SECRET-COMMENT'));
  });

  test('descriptions are opt-in; off omits the key entirely, on includes the raw value', () => {
    const subject = { type: 'collection', kind: 'parent', id: PARENT_ID };
    const list = [issue({ description: 'SENTINEL-DESC' })];

    const off = buildShareSnapshot({ subject, issues: list, includeDescriptions: false });
    assert.strictEqual('description' in off.items[0], false);
    assert.ok(!JSON.stringify(off).includes('SENTINEL-DESC'));

    const on = buildShareSnapshot({ subject, issues: list, includeDescriptions: true });
    assert.strictEqual(on.items[0].description, 'SENTINEL-DESC');
  });

  test('parent share carries the parent description only with the opt-in on', () => {
    const subject = { type: 'collection', kind: 'parent', id: PARENT_ID };
    const list = [issue({ id: PARENT_ID, identifier: 'LIN-1', title: 'The parent', description: 'PARENT-BODY', parent: null })];

    const on = buildShareSnapshot({ subject, issues: list, includeDescriptions: true });
    assert.strictEqual(on.description, 'PARENT-BODY');

    const off = buildShareSnapshot({ subject, issues: list, includeDescriptions: false });
    assert.strictEqual('description' in off, false, 'no parent description key when the opt-in is off');
    assert.ok(!JSON.stringify(off).includes('PARENT-BODY'));
  });

  test('parent description defaults to empty string when the parent is not in the set', () => {
    const snap = buildShareSnapshot({
      subject: { type: 'collection', kind: 'parent', id: PARENT_ID },
      issues: [issue({ id: 'child', parent: { id: PARENT_ID } })],
      includeDescriptions: true
    });
    assert.strictEqual(snap.description, '');
  });

  test('label share never carries a parent description, even with the opt-in on', () => {
    const parent = issue({ id: PARENT_ID, identifier: 'LIN-1', title: 'p', description: 'PARENT-BODY', parent: null, labels: { nodes: [{ name: 'feature' }] } });
    const member = issue({ id: 'm', identifier: 'LIN-2', title: 'm', description: 'CHILD-BODY', parent: null, labels: { nodes: [{ name: 'bug' }] } });

    const snap = buildShareSnapshot({
      subject: { type: 'collection', kind: 'label', id: 'bug' },
      issues: [parent, member],
      includeDescriptions: true
    });

    assert.strictEqual('description' in snap, false, 'label shares have no parent description');
    assert.ok(!JSON.stringify(snap).includes('PARENT-BODY'));
  });

  test('hides canceled and duplicate members but keeps completed', () => {
    const subject = { type: 'collection', kind: 'parent', id: PARENT_ID };
    const snap = buildShareSnapshot({
      subject,
      issues: [
        issue({ identifier: 'LIN-OK', state: { type: 'started' } }),
        issue({ identifier: 'LIN-CANCELED', state: { type: 'canceled' } }),
        issue({ identifier: 'LIN-DUP', state: { type: 'duplicate' } }),
        issue({ identifier: 'LIN-DONE', state: { type: 'completed' } })
      ]
    });

    const ids = snap.items.map(i => i.identifier);
    assert.deepStrictEqual(ids, ['LIN-OK', 'LIN-DONE']);
    assert.strictEqual(snap.items[1].state.type, 'completed');
  });

  test('parent share selects by parent.id and titles from the parent issue', () => {
    const parent = issue({ id: PARENT_ID, identifier: 'LIN-1', title: 'The parent', parent: null });
    const child = issue({ id: 'child-1', identifier: 'LIN-2', title: 'Child', parent: { id: PARENT_ID } });
    const unrelated = issue({ id: 'other', identifier: 'LIN-3', title: 'Other', parent: { id: 'someone-else' } });

    const snap = buildShareSnapshot({
      subject: { type: 'collection', kind: 'parent', id: PARENT_ID },
      issues: [parent, child, unrelated]
    });

    assert.strictEqual(snap.title, 'The parent');
    assert.deepStrictEqual(snap.items.map(i => i.identifier), ['LIN-2']);
  });

  test('label share selects by label name across label shapes', () => {
    const linear = issue({ identifier: 'LIN-L', labels: { nodes: [{ name: 'bug' }] } });
    const flatObjects = issue({ identifier: 'LIN-F', labels: [{ name: 'bug' }] });
    const flatStrings = issue({ identifier: 'LIN-S', labels: ['bug'] });
    const none = issue({ identifier: 'LIN-N', labels: [{ name: 'feature' }] });

    const snap = buildShareSnapshot({
      subject: { type: 'collection', kind: 'label', id: 'bug' },
      issues: [linear, flatObjects, flatStrings, none]
    });

    assert.strictEqual(snap.title, 'bug');
    assert.deepStrictEqual(snap.items.map(i => i.identifier).sort(), ['LIN-F', 'LIN-L', 'LIN-S']);
  });

  test('rejects a malformed subject', () => {
    assert.throws(
      () => buildShareSnapshot({ subject: { type: 'collection', kind: 'nope', id: 'x' }, issues: [] }),
      /subject must be/
    );
  });
});
