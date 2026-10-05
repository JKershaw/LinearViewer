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
import { renderSharePage, renderGuestRunPage } from '../../lib/render-share.js';
import { renderSessionPage } from '../../lib/render-session.js';
import { buildGuestRunProjection, guestParagraphKey } from '../../lib/guest-run.js';
import { sessionSettleState, enrichLoop } from '../../routes/dashboard.js';
import { liveSession, evidenceModel, prRead, URL_KEY, CAPTURED_AT } from '../fixtures/guest-run-fixtures.js';

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

  test('renders priority as the plain-text label from the shared vocabulary', () => {
    const row = renderTaskRow({ state: 'unstarted', identifier: 'LIN-2', title: 'A task', priority: 2 });
    assert.match(row, /class="task-priority"[^>]*>High<\/span>/);
    assert.ok(!row.includes('<svg'), 'priority is plain text, not an icon');
  });

  test('renders last-updated as a <time datetime> with the date', () => {
    const row = renderTaskRow({ state: 'unstarted', identifier: 'LIN-2', title: 'A task', updatedAt: '2026-10-02T00:00:00.000Z' });
    assert.match(row, /<time class="task-updated" datetime="2026-10-02T00:00:00\.000Z">2026-10-02<\/time>/);
  });

  test('omits priority and last-updated when absent or invalid', () => {
    const row = renderTaskRow({ state: 'unstarted', identifier: 'LIN-2', title: 'A task', priority: null, updatedAt: null });
    assert.ok(!row.includes('task-priority'));
    assert.ok(!row.includes('<time'));
    const bad = renderTaskRow({ state: 'unstarted', identifier: 'LIN-3', title: 'B', updatedAt: 'not-a-date' });
    assert.ok(!bad.includes('<time'), 'an unparseable date renders no <time>');
  });

  test('separates the identifier and title spans with whitespace', () => {
    const row = renderTaskRow({ state: 'started', identifier: 'LIN-2', title: 'A task' });
    assert.match(row, /task-identifier">LIN-2<\/span>\s+<span class="task-title">A task<\/span>/);
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

  test('renders the parent description escaped under the title, only when opted in', () => {
    const snap = { title: 'Parent', description: '<script>bad()</script>', items: [{ identifier: 'LIN-1', title: 'A', state: { type: 'todo' } }] };

    const off = renderSharePage({ snapshot: snap, includeDescriptions: false });
    assert.ok(!off.includes('share-description'), 'no parent description when off');
    assert.ok(!off.includes('bad()'));

    const on = renderSharePage({ snapshot: snap, includeDescriptions: true });
    assert.ok(on.includes('<p class="share-description">'), 'parent description block when on');
    assert.ok(on.includes('&lt;script&gt;bad()&lt;/script&gt;'), 'parent description is escaped');
    assert.ok(!on.includes('<script>bad()</script>'));
  });

  test('passes priority and last-updated through to each row', () => {
    const html = renderSharePage({
      snapshot: {
        title: 'T',
        items: [{ identifier: 'LIN-1', title: 'A', state: { type: 'started' }, priority: 1, updatedAt: '2026-10-02T00:00:00.000Z' }]
      }
    });
    assert.match(html, /class="task-priority"[^>]*>Urgent<\/span>/);
    assert.match(html, /<time class="task-updated" datetime="2026-10-02T00:00:00\.000Z">2026-10-02<\/time>/);
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

// LIN-3312 (Phase 2 of LIN-2950, S6a): a shared RUN renders the run page in
// guest mode from the stored projection — no separate share page.
describe('renderGuestRunPage', () => {
  function storedProjection() {
    const session = liveSession();
    return buildGuestRunProjection({
      session,
      runEvidence: evidenceModel(),
      prRead: prRead(),
      paragraph: { paragraph: 'The run shipped.', inputHash: guestParagraphKey(session), final: true },
      urlKey: URL_KEY,
      capturedAt: CAPTURED_AT
    }, { sessionSettleState, enrichLoop });
  }

  test('is exactly renderSessionPage(…, {guest: true}) over the stored projection', () => {
    const snapshot = storedProjection();
    const html = renderGuestRunPage({ snapshot });
    const direct = renderSessionPage({
      session: snapshot.session,
      runEvidence: snapshot.runEvidence,
      runParagraph: snapshot.runParagraph,
      prState: snapshot.prState,
      prRef: snapshot.prRef,
      sessionTerminal: snapshot.settled,
      capturedAt: snapshot.capturedAt
    }, { guest: true });
    assert.strictEqual(html, direct);
    assert.ok(html.includes('data-testid="session-page"'));
    assert.ok(html.includes('data-testid="session-pr-link"'));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
    assert.strictEqual((html.match(/<script/g) || []).length, 1, 'only the theme pre-paint');
    assert.ok(!html.includes('data-url-key'));
  });

  test('is pure: the same snapshot renders the same document', () => {
    const snapshot = storedProjection();
    assert.strictEqual(renderGuestRunPage({ snapshot }), renderGuestRunPage({ snapshot: structuredClone(snapshot) }));
  });

  test('a settled snapshot reads as settled; an unsettled one says it updates', () => {
    const snapshot = storedProjection();
    assert.strictEqual(snapshot.settled, true);
    assert.ok(!renderGuestRunPage({ snapshot }).includes('updates while the run is in progress'));
    assert.ok(renderGuestRunPage({ snapshot: { ...snapshot, settled: false } }).includes('updates while the run is in progress'));
  });

  test('shows the share-stale "as of" line only when stale (reused from the collection page)', () => {
    const snapshot = storedProjection();
    const at = '2026-10-02T00:00:00.000Z';
    const fresh = renderGuestRunPage({ snapshot, snapshotAt: at, stale: false });
    assert.ok(!fresh.includes('share-stale'));
    const stale = renderGuestRunPage({ snapshot, snapshotAt: at, stale: true });
    assert.ok(stale.includes('<p class="share-stale" data-testid="share-stale">as of 2026-10-02T00:00:00.000Z</p>'));
    const staleNoTime = renderGuestRunPage({ snapshot, stale: true });
    assert.ok(!staleNoTime.includes('share-stale'), 'no time, no line');
  });

  test('a snapshot with no session or capture time throws (the route answers 503)', () => {
    const snapshot = storedProjection();
    assert.throws(() => renderGuestRunPage({ snapshot: { ...snapshot, session: null } }), /needs a session/);
    assert.throws(() => renderGuestRunPage({ snapshot: { ...snapshot, capturedAt: undefined } }), /needs capturedAt/);
    assert.throws(() => renderGuestRunPage({}), /needs a session/);
  });
});
