/**
 * Unit tests for the share page + share task row (LIN-3243, Session A of LIN-3073).
 *
 * Run with: node --test tests/unit/render-share.test.js
 *
 * Two claims, both about the public page being inert and privacy-bounded:
 *   - `renderTaskRow` composes the EXACT bare status-pill fragment `renderNode`
 *     emits for the same state (glyph, `variant: bare`, `data-status`,
 *     `aria-label`), so a second glyph mapping or pill chrome cannot drift in;
 *   - `renderSharePage` is a no-nav, noindex document whose only script is the
 *     inline theme pre-paint and whose only external reference is `/style.css`,
 *     with identifiers/titles/descriptions escaped and descriptions opt-in.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderPage, renderTaskRow } from '../../lib/render.js';
import { renderPage as renderShellPage } from '../../lib/components/page.js';
import { renderSharePage } from '../../lib/render-share.js';

// The exact bare pill `renderNode` emits for a state, pulled straight out of a
// real landing render so the parity is proven against renderNode itself rather
// than against a re-stated expectation.
function pillFromRenderNode(stateType) {
  const issue = { id: `i-${stateType}`, identifier: 'LIN-1', title: 'A task', state: { type: stateType }, labels: { nodes: [] } };
  const tree = {
    project: { id: 'project-1', name: 'Test Project', content: null, url: null },
    incomplete: [{ issue, children: [], depth: 0 }],
    completed: [],
    completedCount: 0
  };
  const html = renderPage([tree], [], [], 'Test', { isLanding: true });
  const match = html.match(/<span class="status-pill[^"]*status-pill--bare"[^>]*>[\s\S]*?<\/span><\/span>/);
  assert.ok(match, `renderNode emitted a bare pill for ${stateType}`);
  return match[0];
}

describe('renderTaskRow', () => {
  for (const stateType of ['backlog', 'unstarted', 'started', 'completed']) {
    test(`${stateType}: pill fragment is byte-equal to renderNode's`, () => {
      const row = renderTaskRow({ state: stateType, identifier: 'LIN-2', title: 'A task' });
      assert.ok(
        row.includes(pillFromRenderNode(stateType)),
        `renderTaskRow's pill must equal renderNode's for ${stateType}`
      );
    });
  }

  test('backlog renders ◌ (from getStateDisplay), never the pill default ○', () => {
    const row = renderTaskRow({ state: 'backlog', identifier: 'LIN-3', title: 'A backlog task' });
    assert.match(row, /status-pill--backlog status-pill--bare" data-status="backlog" aria-label="Status: Backlog"/);
    assert.match(row, /status-pill__char">◌<\/span>/);
    assert.ok(!row.includes('status-pill__char">○</span>'), 'backlog does not fall back to the pill glyph table');
  });

  test('identifier and title are escaped plain text', () => {
    const row = renderTaskRow({ state: 'started', identifier: '<b>ID</b>', title: '<script>alert(1)</script>' });
    assert.ok(row.includes('&lt;b&gt;ID&lt;/b&gt;'));
    assert.ok(row.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!row.includes('<script>alert(1)</script>'));
    assert.ok(!row.includes('<b>ID</b>'));
  });
});

describe('renderSharePage', () => {
  const snapshot = {
    title: 'My collection',
    items: [
      { identifier: 'LIN-1', title: 'First task', state: { type: 'started' }, priority: 2, updatedAt: '2026-10-02T00:00:00.000Z' },
      { identifier: 'LIN-2', title: 'Second task', state: { type: 'completed' }, priority: 0, updatedAt: '2026-10-02T00:00:00.000Z' }
    ]
  };

  test('is a no-nav document with the noindex meta and only /style.css', () => {
    const html = renderSharePage({ snapshot });
    assert.ok(!html.includes('<nav'), 'no nav is rendered');
    assert.ok(html.includes('<meta name="robots" content="noindex">'), 'noindex meta present');
    assert.ok(html.includes('<link rel="stylesheet" href="/style.css">'), '/style.css is linked');
    assert.strictEqual((html.match(/rel="stylesheet"/g) || []).length, 1, 'exactly one stylesheet');
  });

  test('has exactly one script — the inline theme pre-paint — and no external/script src', () => {
    const html = renderSharePage({ snapshot });
    assert.strictEqual((html.match(/<script/g) || []).length, 1, 'exactly one <script>, the theme pre-paint');
    assert.ok(!html.includes('<script src'), 'no external script may load');
    const theme = renderShellPage({ title: 'bare' }).match(/<script>[\s\S]*?<\/script>/)[0];
    assert.ok(html.includes(theme), 'the sole script is byte-equal to renderPage’s theme pre-paint');
  });

  test('has no outbound links and no external hrefs', () => {
    const html = renderSharePage({ snapshot });
    assert.ok(!html.includes('<a '), 'no anchors at all on the public page');
    assert.ok(!/href="https?:/i.test(html), 'no external href');
  });

  test('renders an escaped title and identifiers/titles', () => {
    const html = renderSharePage({
      snapshot: { title: '<img src=x>', items: [{ identifier: '<b>', title: 'A <title>', state: { type: 'unstarted' } }] }
    });
    assert.ok(html.includes('&lt;img src=x&gt;'));
    assert.ok(!html.includes('<img src=x>'));
    assert.ok(html.includes('&lt;b&gt;'));
    assert.ok(html.includes('A &lt;title&gt;'));
  });

  test('descriptions are opt-in and escaped when on', () => {
    const withDesc = { title: 'T', items: [{ identifier: 'LIN-1', title: 'A', state: { type: 'todo' }, description: '<script>bad()</script>' }] };

    const off = renderSharePage({ snapshot: withDesc, includeDescriptions: false });
    assert.ok(!off.includes('task-description'), 'no description block when off');
    assert.ok(!off.includes('<script>bad()</script>'));
    assert.ok(!off.includes('bad()'));

    const on = renderSharePage({ snapshot: withDesc, includeDescriptions: true });
    assert.ok(on.includes('<p class="task-description">'), 'description block when on');
    assert.ok(on.includes('&lt;script&gt;bad()&lt;/script&gt;'), 'description is escaped');
    assert.ok(!on.includes('<script>bad()</script>'));
  });

  test('renders an empty collection without rows', () => {
    const html = renderSharePage({ snapshot: { title: 'Empty', items: [] } });
    assert.ok(html.includes('No tasks in this collection.'));
    assert.ok(!html.includes('<li class="share-task">'));
    assert.ok(!html.includes('share-list'));
  });

  test('shows the "as of" timestamp only when stale', () => {
    const at = '2026-10-02T00:00:00.000Z';
    const fresh = renderSharePage({ snapshot, snapshotAt: at, stale: false });
    assert.ok(!fresh.includes('share-stale'));
    assert.ok(!fresh.includes('as of'));

    const stale = renderSharePage({ snapshot, snapshotAt: at, stale: true });
    assert.ok(stale.includes('as of 2026-10-02T00:00:00.000Z'));
  });
});
