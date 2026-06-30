/**
 * Unit tests for lib/render-pipeline.js
 *
 * Run with: node --test tests/unit/render-pipeline.test.js
 *
 * Covers the renderer's responsibilities:
 * - Shell HTML document structure
 * - Three-zone layout (queue rail, active grid, activity rail)
 * - Asset links and script order
 * - Safe JSON embedding (XSS + U+2028/U+2029)
 * - Round-trip payload integrity
 * - Chrome (navbar + footer) presence
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderPipelinePage } from '../../lib/render-pipeline.js';

// =============================================================================
// Fixtures
// =============================================================================

function makeFixtureSnapshot(overrides = {}) {
  return {
    fetchedAt: '2026-04-11T17:00:00.000Z',
    queue: [{
      identifier: 'LIN-1',
      title: 'Queue task',
      priority: 2,
      state: 'backlog',
      loopCount: 0,
      url: 'https://linear.app/team/issue/LIN-1'
    }],
    active: [{
      identifier: 'LIN-2',
      title: 'Active task',
      priority: 1,
      state: 'in_progress',
      loopCount: 4,
      healthColor: 'amber',
      agentState: 'running',
      currentStage: 'implementation',
      lastActivityAt: '2026-04-11T16:58:00.000Z',
      url: 'https://linear.app/team/issue/LIN-2',
      loops: []
    }],
    recent: [{
      loopId: 'L-1',
      issueIdentifier: 'LIN-3',
      agentState: 'complete',
      stage: 'implementation',
      resolvedAt: '2026-04-11T16:59:00.000Z'
    }],
    ...overrides
  };
}

function extractEmbeddedJson(html) {
  const match = html.match(/window\.__PIPELINE_DATA__ = ({[\s\S]*?});<\/script>/);
  assert.ok(match, 'expected embedded __PIPELINE_DATA__ script');
  return match[1];
}

// =============================================================================
// Tests
// =============================================================================

describe('renderPipelinePage', () => {
  // 1. HTML document structure
  test('produces a full HTML document', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(html.trimStart().startsWith('<!DOCTYPE html>'));
    assert.ok(html.trimEnd().endsWith('</html>'));
  });

  // 2. CSS links
  test('links /style.css and /pipeline.css', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(html.includes('<link rel="stylesheet" href="/style.css">'));
    assert.ok(html.includes('<link rel="stylesheet" href="/pipeline.css">'));
  });

  // 3. Script order: data embed → common.js → pipeline.js
  test('loads common.js and pipeline.js after the data embed, in order', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    const embedIdx = html.indexOf('window.__PIPELINE_DATA__');
    const commonIdx = html.indexOf('/common.js');
    const pipelineIdx = html.indexOf('/pipeline.js');
    assert.ok(embedIdx >= 0, 'data embed present');
    assert.ok(commonIdx > embedIdx, 'common.js is after data embed');
    assert.ok(pipelineIdx > commonIdx, 'pipeline.js is after common.js');
  });

  // 4. Data embed presence and parseability
  test('embeds window.__PIPELINE_DATA__ as parseable JSON', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(html.includes('window.__PIPELINE_DATA__ = '));
    const jsonStr = extractEmbeddedJson(html);
    assert.doesNotThrow(() => JSON.parse(jsonStr));
  });

  // 5. Round-trip payload integrity
  test('round-trips snapshot payload intact', () => {
    const snapshot = makeFixtureSnapshot();
    const html = renderPipelinePage(
      { snapshot },
      { urlKey: 'test-workspace', featureFlags: { dispatch: true, proxy: false } }
    );
    const parsed = JSON.parse(extractEmbeddedJson(html));
    assert.strictEqual(parsed.snapshot.queue[0].identifier, 'LIN-1');
    assert.strictEqual(parsed.snapshot.active[0].identifier, 'LIN-2');
    assert.strictEqual(parsed.snapshot.active[0].healthColor, 'amber');
    assert.strictEqual(parsed.snapshot.active[0].agentState, 'running');
    assert.strictEqual(parsed.snapshot.active[0].priority, 1);
    assert.strictEqual(parsed.snapshot.recent[0].loopId, 'L-1');
    assert.strictEqual(parsed.snapshot.fetchedAt, '2026-04-11T17:00:00.000Z');
    assert.strictEqual(parsed.urlKey, 'test-workspace');
    assert.strictEqual(parsed.featureFlags.dispatch, true);
    assert.strictEqual(parsed.featureFlags.proxy, false);
  });

  // 6. Zone containers present and empty
  test('emits all three zone containers, empty', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(/<ol[^>]*id="pipeline-queue-list"[^>]*><\/ol>/.test(html));
    assert.ok(/<div[^>]*id="pipeline-grid"[^>]*><\/div>/.test(html));
    assert.ok(/<ul[^>]*id="pipeline-activity-list"[^>]*><\/ul>/.test(html));
  });

  // 7. Empty-state elements with `hidden` class
  test('emits all three empty-state elements with hidden class', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(/id="pipeline-queue-empty"[^>]*class="[^"]*hidden[^"]*"|class="[^"]*hidden[^"]*"[^>]*id="pipeline-queue-empty"/.test(html));
    assert.ok(/id="pipeline-grid-empty"[^>]*class="[^"]*hidden[^"]*"|class="[^"]*hidden[^"]*"[^>]*id="pipeline-grid-empty"/.test(html));
    assert.ok(/id="pipeline-activity-empty"[^>]*class="[^"]*hidden[^"]*"|class="[^"]*hidden[^"]*"[^>]*id="pipeline-activity-empty"/.test(html));
  });

  // 8. data-url-key attribute on the main element
  test('emits data-url-key on <main class="pipeline-page">', () => {
    const html = renderPipelinePage(
      { snapshot: makeFixtureSnapshot() },
      { urlKey: 'acme' }
    );
    assert.ok(/<main class="pipeline-page" data-url-key="acme">/.test(html));
  });

  // 9. XSS guard: </script> in task title must not break out
  test('escapes </script> sequences inside embedded JSON', () => {
    const snapshot = makeFixtureSnapshot();
    snapshot.active[0].title = '</script><img src=x onerror=alert(1)>';
    const html = renderPipelinePage({ snapshot });

    // The embed must contain the escaped form of `<` so `</script>` can't close the tag.
    // Only `<` needs escaping: `>` is safe inside a <script> raw-text element.
    assert.ok(html.includes('\\u003c/script>'), 'embed contains escaped </script>');
    assert.ok(!html.includes('</script><img src=x'), 'literal </script> attack sequence absent');

    // And the only literal </script> tags are the genuine ones: the pre-paint
    // theme script in <head> (LIN-785), the data embed, and the three page
    // scripts (common.js, recap.js, pipeline.js).
    const literalCloses = html.match(/<\/script>/g) || [];
    assert.strictEqual(literalCloses.length, 5, 'exactly five literal </script> tags (theme pre-paint, data embed, common.js, recap.js, pipeline.js)');

    // Side-effect test: confirm the escaped payload is valid JSON and does
    // not contain the attacker payload as live script content.
    const parsed = JSON.parse(extractEmbeddedJson(html));
    assert.strictEqual(
      parsed.snapshot.active[0].title,
      '</script><img src=x onerror=alert(1)>'
    );
  });

  // 10. U+2028 / U+2029 guard
  test('escapes U+2028 and U+2029 line terminators', () => {
    const snapshot = makeFixtureSnapshot();
    snapshot.active[0].loops = [{
      loopId: 'L-X',
      promptText: 'line1\u2028line2\u2029line3'
    }];
    const html = renderPipelinePage({ snapshot });

    assert.ok(html.includes('\\u2028'), 'contains escaped U+2028');
    assert.ok(html.includes('\\u2029'), 'contains escaped U+2029');
    // Raw line terminators must not appear inside the embedded expression
    const embedStart = html.indexOf('window.__PIPELINE_DATA__');
    const embedEnd = html.indexOf('</script>', embedStart);
    const embedSlice = html.slice(embedStart, embedEnd);
    assert.ok(!embedSlice.includes('\u2028'), 'no raw U+2028 in embed');
    assert.ok(!embedSlice.includes('\u2029'), 'no raw U+2029 in embed');

    // Round-trip: the parsed value should still contain the original characters
    const parsed = JSON.parse(extractEmbeddedJson(html));
    assert.strictEqual(
      parsed.snapshot.active[0].loops[0].promptText,
      'line1\u2028line2\u2029line3'
    );
  });

  // 11. Fetched-at timestamp in header
  test('renders fetched-at timestamp with data attribute', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(html.includes('id="pipeline-fetched-at"'));
    assert.ok(html.includes('data-fetched-at="2026-04-11T17:00:00.000Z"'));
  });

  // 12. Navbar presence
  test('includes the navbar chrome', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(html.includes('<nav class="nav-bar"'), 'navbar marker present');
  });

  // 13. Footer presence
  test('includes the footer chrome', () => {
    const html = renderPipelinePage({ snapshot: makeFixtureSnapshot() });
    assert.ok(html.includes('<footer class="page-footer">'), 'footer marker present');
  });

  // 14. Empty fixture still produces parseable embed
  test('handles empty snapshot zones without breaking the embed', () => {
    const emptySnapshot = {
      fetchedAt: '2026-04-11T17:00:00.000Z',
      queue: [],
      active: [],
      recent: []
    };
    const html = renderPipelinePage({ snapshot: emptySnapshot });
    const parsed = JSON.parse(extractEmbeddedJson(html));
    assert.deepStrictEqual(parsed.snapshot.queue, []);
    assert.deepStrictEqual(parsed.snapshot.active, []);
    assert.deepStrictEqual(parsed.snapshot.recent, []);
    assert.strictEqual(parsed.snapshot.fetchedAt, '2026-04-11T17:00:00.000Z');
  });
});
