/**
 * Unit tests for lib/render-collective.js
 *
 * Run with: node --test tests/unit/render-collective.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderCollectivePage } from '../../lib/render-collective.js';

function render(data = {}, options = {}) {
  return renderCollectivePage(
    {
      workspaces: [
        { urlKey: 'ws-a', name: 'Project A' },
        { urlKey: 'ws-b', name: 'Project B' },
      ],
      defaultChannel: '#Collective',
      defaultTopic: 'how far could these go?',
      yapConfigured: true,
      ...data,
    },
    { urlKey: 'ws-a', workspaces: [], featureFlags: {}, ...options }
  );
}

describe('renderCollectivePage', () => {
  test('renders a complete HTML document', () => {
    const html = render();
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });

  test('includes the collective stylesheet and script', () => {
    const html = render();
    assert.ok(html.includes('/collective.css'));
    assert.ok(html.includes('/collective.js'));
  });

  test('offers a define-new character form grounded in each connected workspace', () => {
    const html = render();
    // The repo picker binds a new character to a connected workspace/repo.
    assert.ok(html.includes('data-testid="collective-char-repo"'));
    assert.ok(html.includes('value="ws-a"'));
    assert.ok(html.includes('value="ws-b"'));
    assert.ok(html.includes('Project A'));
    assert.ok(html.includes('Project B'));
    // All five persona fields are offered (value included, not just four).
    for (const f of ['role', 'lens', 'objective', 'value', 'disposition']) {
      assert.ok(html.includes(`data-testid="collective-char-${f}"`), `persona field ${f} input present`);
    }
    assert.ok(html.includes('data-testid="collective-char-add"'));
  });

  test('lists saved custom + recent characters as selectable rows', () => {
    const html = render({
      characters: [
        { id: 'c1', name: 'Skeptic', workspaceName: 'Project A', kind: 'custom', role: 'Skeptic' },
        { id: 'r1', name: 'Builder', workspaceName: 'Project B', kind: 'recent', role: 'Builder' },
      ],
    });
    assert.ok(html.includes('class="collective-char-check" value="c1"'));
    assert.ok(html.includes('class="collective-char-check" value="r1"'));
    assert.ok(html.includes('Skeptic'));
    assert.ok(html.includes('Builder'));
    // Both kinds are labelled so the picker distinguishes them.
    assert.ok(/data-kind="custom"/.test(html));
    assert.ok(/data-kind="recent"/.test(html));
  });

  test('embeds saved characters in __COLLECTIVE_DATA__ for the client', () => {
    const html = render({ characters: [{ id: 'c1', name: 'Skeptic', workspaceUrlKey: 'ws-a' }] });
    assert.ok(html.includes('"characters"'));
    assert.ok(html.includes('"id":"c1"'));
  });

  test('shows the no-connected-workspaces empty state instead of a define form', () => {
    const html = render({ workspaces: [] });
    assert.ok(html.includes('No connected workspaces.'));
    assert.ok(!html.includes('data-testid="collective-char-repo"'));
  });

  test('embeds config in __COLLECTIVE_DATA__', () => {
    const html = render();
    assert.ok(html.includes('window.__COLLECTIVE_DATA__'));
    assert.ok(html.includes('"defaultChannel":"#Collective"'));
    assert.ok(html.includes('"yapConfigured":true'));
  });

  test('seeds the channel input and topic textarea', () => {
    const html = render();
    assert.ok(html.includes('id="collective-channel"'));
    assert.ok(html.includes('value="#Collective"'));
    // Topic is a textarea (multi-line), with the default as its content.
    assert.ok(/<textarea id="collective-topic"[^>]*>how far could these go\?<\/textarea>/.test(html));
  });

  test('has a view-prompt control and copyable preview panel', () => {
    const html = render();
    assert.ok(html.includes('id="collective-view-prompt"'));
    assert.ok(html.includes('id="collective-prompt-preview"'));
    assert.ok(html.includes('id="collective-prompt-copy"'));
  });

  test('only offers cli and web targets (not dash)', () => {
    const html = render();
    assert.ok(html.includes('<option value="cli">'));
    assert.ok(html.includes('<option value="web">'));
    assert.ok(!html.includes('<option value="dash">'));
  });

  test('marks the feature experimental', () => {
    const html = render();
    assert.ok(/experimental/i.test(html));
  });

  test('shows a Yap-not-configured warning when not configured', () => {
    const html = render({ yapConfigured: false });
    assert.ok(html.includes('data-yap-unconfigured'));
    assert.ok(html.includes('YAP_BASE_URL'));
  });

  test('hides the warning when Yap is configured', () => {
    const html = render({ yapConfigured: true });
    assert.ok(!html.includes('data-yap-unconfigured'));
  });

  test('has transcript and say controls', () => {
    const html = render();
    assert.ok(html.includes('id="collective-transcript"'));
    assert.ok(html.includes('id="collective-say-input"'));
    assert.ok(html.includes('id="collective-say-btn"'));
  });
});
