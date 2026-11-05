/**
 * LIN-4114 witness 16 (the part the unit layer can see): Waiting on you is drawn for the owner only. A member's (or a
 * keyless owner's) Home page carries no section and no ruling text. The leak through /api/home-rows is covered by the
 * rows being empty when run controls are off (lin-4114-home-waiting: the GUARD for no sessions).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../../lib/providers/linear/index.js';
import { renderPage } from '../../lib/render.js';

const WAITING_ROW = {
  decision: { decision_id: 'd-LIN-1', question: 'Which for LIN-1 — a ruling a member must not see?' },
  decisionCase: [],
  anchor: { loopId: null, issueId: 'id-LIN-1', issueIdentifier: 'LIN-1', issueTitle: 'Ruled task', workspaceUrlKey: 'ws', taskDecisionId: 'td-LIN-1' },
  disposition: 'task-bound',
  effect: 'record',
  canReply: true,
};
const homeView = {
  inProgressTrees: [], trees: [], upNext: [], recent: { nodes: [], remaining: 0 },
  waiting: { rows: [WAITING_ROW], ids: ['LIN-1'], contextIds: [] },
};

function homeHtml(featureFlags) {
  return renderPage([], [], [], 'Org', { urlKey: 'ws', workspaces: [], featureFlags, homeView, rulingCount: 1 });
}

describe('LIN-4114 witness 16: Waiting on you is owner only', () => {
  test('the owner (run controls on) gets the section, with the card and its task line', () => {
    const html = homeHtml({ runControls: true });
    assert.match(html, /data-testid="waiting-on-you"/);
    assert.match(html, /data-testid="waiting-task-line"/);
    assert.match(html, /data-testid="session-question-card"/);
    assert.match(html, /Which for LIN-1/);
  });

  test('a member (no run controls) gets no section, no card and no ruling text', () => {
    const html = homeHtml({});
    assert.doesNotMatch(html, /data-testid="waiting-on-you"/);
    assert.doesNotMatch(html, /data-testid="session-question-card"/);
    assert.doesNotMatch(html, /Which for LIN-1/, 'the ruling text does not reach a member');
  });

  test('a keyless owner (run controls explicitly off) gets no section either', () => {
    const html = homeHtml({ runControls: false });
    assert.doesNotMatch(html, /data-testid="waiting-on-you"/);
  });
});

// LIN-4242: an owner with zero rulings gets the section drawn hidden and empty, and the count line's wrapper drawn hidden,
// so a ruling raised after load has both to land in. The live refresh (public/app.js) un-hides them; nothing is removed.
describe('LIN-4242: the owner with zero rulings gets an empty, hidden section and a hidden count-line wrapper', () => {
  const emptyView = {
    inProgressTrees: [], trees: [], upNext: [], recent: { nodes: [], remaining: 0 },
    waiting: { rows: [], ids: [], contextIds: [] },
  };
  const emptyHtml = (runControls) => renderPage([], [], [], 'Org', { urlKey: 'ws', workspaces: [], featureFlags: { runControls }, homeView: emptyView, rulingCount: 0 });

  test('the owner: the section is present, hidden, and has no card; the count-line wrapper is present and hidden', () => {
    // Witness: drop the `waiting-section hidden` class at zero, or the `keepWrapper` argument, and one of these fails.
    const html = emptyHtml(true);
    assert.match(html, /<div class="waiting-section hidden" role="region" aria-label="Waiting on you" data-testid="waiting-on-you"/);
    assert.match(html, /data-testid="waiting-body"/);
    assert.doesNotMatch(html, /session-question-card/);
    assert.match(html, /<span data-testid="in-progress-count" class="hidden"><\/span>/);
  });

  test('a member gets neither the section nor the count-line wrapper', () => {
    const html = emptyHtml(false);
    assert.doesNotMatch(html, /data-testid="waiting-on-you"/);
    assert.doesNotMatch(html, /data-testid="in-progress-count"/);
  });
});
