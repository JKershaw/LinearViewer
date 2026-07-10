/**
 * Unit tests for lib/render-ship-biscuit.js — the newspaper front-page renderer
 * (LIN-1198): the lead story (headline + standfirst + lede), the weighted section
 * columns over the DESKS, and the lower-prominence stubs.
 *
 * Run with: node --test tests/unit/render-ship-biscuit.test.js
 *
 * The client mirror (public/ship-biscuit.js renderEdition) is exercised behaviourally
 * by tests/e2e/ship-biscuit.spec.js; these pin the server first-paint shape the client
 * must match, plus the pure layoutIndex partition both paths share.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderEditionHtml, layoutIndex } from '../../lib/render-ship-biscuit.js';

function stub(id, section, weight, headline) {
  return { id, section, weight, headline: headline || `${id} headline`, dek: `${id} dek`, sourceRefs: [] };
}

describe('layoutIndex — weighted section columns + stubs', () => {
  test('splits column-tier (weight >= 3) from low-prominence stubs (weight < 3)', () => {
    const { columns, stubs } = layoutIndex([
      stub('art-1', 'The Wire', 5),
      stub('art-2', 'Deep Dive', 3),
      stub('art-3', 'The Column', 2),
      stub('art-4', 'Weather', 1),
    ]);
    const columnIds = columns.flatMap(c => c.stubs.map(s => s.id));
    assert.deepStrictEqual(columnIds.sort(), ['art-1', 'art-2']);
    assert.deepStrictEqual(stubs.map(s => s.id).sort(), ['art-3', 'art-4']);
  });

  test('groups column-tier items by section and orders columns heaviest-first', () => {
    const { columns } = layoutIndex([
      stub('art-1', 'Deep Dive', 3),
      stub('art-2', 'The Wire', 5),
      stub('art-3', 'The Wire', 4),
    ]);
    assert.deepStrictEqual(columns.map(c => c.section), ['The Wire', 'Deep Dive']);
    // The Wire column (max weight 5) leads; its own stubs are weight-desc.
    assert.deepStrictEqual(columns[0].stubs.map(s => s.id), ['art-2', 'art-3']);
    assert.strictEqual(columns[0].weight, 5);
  });

  test('breaks equal-weight column ties by canonical desk order (deterministic)', () => {
    const { columns } = layoutIndex([
      stub('art-1', 'The Column', 4),
      stub('art-2', 'The Wire', 4),
      stub('art-3', 'Deep Dive', 4),
    ]);
    // DESK_ORDER: Front Page, The Wire, Deep Dive, The Column, Weather.
    assert.deepStrictEqual(columns.map(c => c.section), ['The Wire', 'Deep Dive', 'The Column']);
  });
});

describe('renderEditionHtml — lead story', () => {
  const edition = {
    generatedAt: '2026-07-09T12:00:00.000Z',
    window: 'week',
    isQuiet: false,
    frontPage: { headline: 'Autopilot clears the board', standfirst: 'A steady run.', lede: 'The full story.' },
    index: [stub('art-1', 'The Wire', 5, 'LIN-1 shipped')],
  };

  test('renders the lead headline, standfirst and lede in the lead block', () => {
    const html = renderEditionHtml(edition);
    assert.match(html, /data-testid="ship-biscuit-lead-headline"[^>]*>Autopilot clears the board</);
    assert.match(html, /data-testid="ship-biscuit-standfirst"[^>]*>A steady run\.</);
    assert.match(html, /data-testid="ship-biscuit-lede"[^>]*>The full story\.</);
  });

  test('the lead headline is inert plain text (an h2), not a clickable link', () => {
    const html = renderEditionHtml(edition);
    assert.match(html, /<h2 class="ship-biscuit-lead-headline"/);
    // The lead headline must not be an <a> — only index stubs are clickable-inert links.
    assert.doesNotMatch(html, /<a[^>]*ship-biscuit-lead-headline/);
  });

  test('omits absent lead lines — a headline-only edition still renders (no lede/standfirst)', () => {
    const html = renderEditionHtml({
      generatedAt: edition.generatedAt, window: 'week', isQuiet: false,
      frontPage: { headline: 'Just the headline', standfirst: '', lede: '' }, index: [],
    });
    assert.match(html, /ship-biscuit-lead-headline"[^>]*>Just the headline</);
    assert.doesNotMatch(html, /data-testid="ship-biscuit-standfirst"/);
    assert.doesNotMatch(html, /data-testid="ship-biscuit-lede"/);
  });
});

describe('renderEditionHtml — columns + stubs', () => {
  test('renders weighted section columns and a separate stub list', () => {
    const html = renderEditionHtml({
      generatedAt: '2026-07-09T12:00:00.000Z', window: 'week', isQuiet: false,
      frontPage: { headline: 'H', standfirst: '', lede: '' },
      index: [
        stub('art-1', 'The Wire', 5, 'Lead column story'),
        stub('art-2', 'The Column', 1, 'A quiet stub'),
      ],
    });
    assert.match(html, /data-testid="ship-biscuit-columns"/);
    assert.match(html, /ship-biscuit-column-title">The Wire</);
    assert.match(html, /--ship-biscuit-col-weight:5/);
    assert.match(html, /data-testid="ship-biscuit-stubs"/);
    // The stub keeps its section kicker; the column article does not.
    assert.match(html, /ship-biscuit-stub"[^>]*data-weight="1"/);
    // Index headlines are clickable-inert links with the shared testid.
    assert.match(html, /class="ship-biscuit-headline" data-testid="ship-biscuit-headline"[^>]*>Lead column story</);
  });

  test('a quiet edition shows the honest slow-news-day note and no columns/stubs', () => {
    const html = renderEditionHtml({
      generatedAt: '2026-07-09T12:00:00.000Z', window: 'day', isQuiet: true,
      frontPage: { headline: 'A quiet day aboard', standfirst: 'Nothing crossed the wire.', lede: 'Slow news day.' },
      index: [],
    });
    assert.match(html, /data-testid="ship-biscuit-quiet"/);
    assert.doesNotMatch(html, /data-testid="ship-biscuit-columns"/);
    assert.doesNotMatch(html, /data-testid="ship-biscuit-headline"/);
    // …but the lead headline still renders (quiet ≠ empty lead).
    assert.match(html, /ship-biscuit-lead-headline"[^>]*>A quiet day aboard</);
  });

  test('an empty (non-quiet) index also falls back to the quiet note', () => {
    const html = renderEditionHtml({
      generatedAt: '2026-07-09T12:00:00.000Z', window: 'week', isQuiet: false,
      frontPage: { headline: 'H', standfirst: '', lede: 'L' }, index: [],
    });
    assert.match(html, /data-testid="ship-biscuit-quiet"/);
  });

  test('null edition renders the empty state', () => {
    assert.match(renderEditionHtml(null), /ship-biscuit-empty/);
  });
});
