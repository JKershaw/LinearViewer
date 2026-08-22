/**
 * LIN-1728 Phase 3 — unit tests for the ambient rulings badge markup
 * (`renderNavBar`, lib/components/navbar.js).
 *
 * Run with: node --test tests/unit/navbar-rulings-badge.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderNavBar } from '../../lib/components/navbar.js';

const WORKSPACES = [{ id: 'w1', name: 'Test WS', urlKey: 'test-ws' }];

describe('renderNavBar — rulings badge (LIN-1728 Phase 3)', () => {
  test('renders hidden, zeroed, workspace-scoped markup when the dispatch flag is on', () => {
    const html = renderNavBar({ workspaces: WORKSPACES, urlKey: 'test-ws', featureFlags: { dispatch: true } });
    assert.match(html, /data-rulings-badge/);
    assert.match(html, /class="rulings-badge hidden"/);
    assert.match(html, /data-url-key="test-ws"/);
    assert.match(html, /<span class="rulings-count">0<\/span> waiting on you/);
  });

  test('is absent when the dispatch flag is off — same gate as the queue badge', () => {
    const html = renderNavBar({ workspaces: WORKSPACES, urlKey: 'test-ws', featureFlags: {} });
    assert.doesNotMatch(html, /data-rulings-badge/);
    assert.doesNotMatch(html, /data-queue-badge/);
  });

  test('is absent with no urlKey even if the flag is on (no workspace to scope the count to)', () => {
    const html = renderNavBar({ workspaces: WORKSPACES, urlKey: null, featureFlags: { dispatch: true } });
    assert.doesNotMatch(html, /data-rulings-badge/);
  });

  test('trails the queue badge in nav-actions source order', () => {
    const html = renderNavBar({ workspaces: WORKSPACES, urlKey: 'test-ws', featureFlags: { dispatch: true } });
    const queueIdx = html.indexOf('data-queue-badge');
    const rulingsIdx = html.indexOf('data-rulings-badge');
    assert.ok(queueIdx !== -1 && rulingsIdx !== -1, 'both badges present');
    assert.ok(queueIdx < rulingsIdx, 'queue badge must render before the rulings badge');
  });

  test('is absent entirely on the unauthenticated landing nav', () => {
    const html = renderNavBar({ isLanding: true, featureFlags: { dispatch: true } });
    assert.doesNotMatch(html, /data-rulings-badge/);
  });
});
