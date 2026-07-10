/**
 * Unit tests for lib/render-ship-biscuit.js — the server-side edition renderer and its
 * pure hierarchy helpers (LIN-1198, Theme B).
 *
 * Run with: node --test tests/unit/ship-biscuit-render.test.js
 *
 * Pins the newspaper front-page hierarchy the client renderer (public/ship-biscuit.js)
 * must mirror: a lead story (headline + optional standfirst/dek + lede), weighted
 * section blocks in descending-weight order with a prominence hook, and compact
 * lower-prominence stubs. Also guards the LIN-1185/LIN-818 behaviour these build on:
 * a quiet edition runs no headlines, and the empty state renders when there is no
 * edition.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  renderEditionHtml,
  partitionEditionIndex,
  prominenceForWeight
} from '../../lib/render-ship-biscuit.js';

function stub(overrides = {}) {
  return {
    id: 'art-1',
    section: 'The Wire',
    headline: 'A headline',
    dek: 'A short teaser.',
    weight: 5,
    sourceRefs: [{ id: 'session:s1' }],
    ...overrides
  };
}

function edition(overrides = {}) {
  return {
    id: 'ed-1',
    window: 'week',
    generatedAt: '2026-07-09T12:00:00.000Z',
    isQuiet: false,
    frontPage: { headline: 'Autopilot clears the board', standfirst: 'A steady week of small wins.', lede: 'A busy week aboard.' },
    index: [],
    ...overrides
  };
}

describe('prominenceForWeight', () => {
  test('maps higher weight to a more prominent tier', () => {
    assert.strictEqual(prominenceForWeight(5), 'high');
    assert.strictEqual(prominenceForWeight(4), 'medium');
    assert.strictEqual(prominenceForWeight(3), 'standard');
  });
  test('is tolerant of missing/garbage weight', () => {
    assert.strictEqual(prominenceForWeight(undefined), 'standard');
    assert.strictEqual(prominenceForWeight('nope'), 'standard');
  });
});

describe('partitionEditionIndex', () => {
  test('splits weighted (>2) from stub (<=2) items, preserving order', () => {
    const index = [
      stub({ id: 'art-1', weight: 5 }),
      stub({ id: 'art-2', weight: 3 }),
      stub({ id: 'art-3', weight: 2 }),
      stub({ id: 'art-4', weight: 1 })
    ];
    const { weighted, stubs } = partitionEditionIndex(index);
    assert.deepStrictEqual(weighted.map(s => s.id), ['art-1', 'art-2']);
    assert.deepStrictEqual(stubs.map(s => s.id), ['art-3', 'art-4']);
  });
  test('tolerates a non-array', () => {
    assert.deepStrictEqual(partitionEditionIndex(null), { weighted: [], stubs: [] });
  });
});

describe('renderEditionHtml — lead story (LIN-1198)', () => {
  test('renders the headline as an inert <h2> distinct from lede and masthead', () => {
    const html = renderEditionHtml(edition());
    assert.match(html, /data-testid="ship-biscuit-lead-story"/);
    // headline is an <h2> with its own testid, NOT the stub headline testid, NOT a link
    assert.match(html, /<h2 class="ship-biscuit-lead-headline" data-testid="ship-biscuit-lead-headline">Autopilot clears the board<\/h2>/);
    assert.match(html, /data-testid="ship-biscuit-lede">A busy week aboard\./);
    // the lead headline is inert — no anchor wraps it
    assert.doesNotMatch(html, /<a[^>]*>Autopilot clears the board<\/a>/);
  });

  test('renders the standfirst/dek when present', () => {
    const html = renderEditionHtml(edition());
    assert.match(html, /<p class="ship-biscuit-standfirst" data-testid="ship-biscuit-standfirst">A steady week of small wins\.<\/p>/);
  });

  test('omits the standfirst node entirely when absent (parity: no empty node)', () => {
    const html = renderEditionHtml(edition({ frontPage: { headline: 'Terse', standfirst: '', lede: 'Plain.' } }));
    assert.doesNotMatch(html, /ship-biscuit-standfirst/);
    // headline + lede still render
    assert.match(html, /ship-biscuit-lead-headline">Terse</);
    assert.match(html, /ship-biscuit-lede">Plain\./);
  });

  test('escapes headline and standfirst', () => {
    const html = renderEditionHtml(edition({ frontPage: { headline: '<b>x</b>', standfirst: 'a & b', lede: 'ok' } }));
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(html, /a &amp; b/);
  });
});

describe('renderEditionHtml — weighted sections + stubs (LIN-1198)', () => {
  const busy = edition({
    index: [
      stub({ id: 'art-1', headline: 'Top story', section: 'The Wire', weight: 5 }),
      stub({ id: 'art-2', headline: 'Mid story', section: 'Deep Dive', weight: 4 }),
      stub({ id: 'art-3', headline: 'Column note', section: 'The Column', weight: 3 }),
      stub({ id: 'art-4', headline: 'Small stub', section: 'Weather', weight: 2 }),
      stub({ id: 'art-5', headline: 'Tiny stub', section: 'Weather', weight: 1 })
    ]
  });

  test('renders weighted-section blocks with weight + prominence hooks', () => {
    const html = renderEditionHtml(busy);
    assert.match(html, /data-testid="ship-biscuit-sections"/);
    assert.match(html, /data-testid="ship-biscuit-weighted-section"[^>]*data-weight="5"[^>]*data-prominence="high"/);
    assert.match(html, /data-weight="4"[^>]*data-prominence="medium"/);
    assert.match(html, /data-weight="3"[^>]*data-prominence="standard"/);
    // section hook is exposed for CSS/columns
    assert.match(html, /data-section="Deep Dive"/);
  });

  test('weighted sections render in descending-weight order', () => {
    const html = renderEditionHtml(busy);
    const order = [...html.matchAll(/ship-biscuit-weighted"[^>]*data-weight="(\d)"/g)].map(m => m[1]);
    assert.deepStrictEqual(order, ['5', '4', '3']);
  });

  test('low-weight items render as compact stubs beneath the sections', () => {
    const html = renderEditionHtml(busy);
    assert.match(html, /<ul class="ship-biscuit-stubs" data-testid="ship-biscuit-stubs">/);
    assert.match(html, /ship-biscuit-stub" data-testid="ship-biscuit-stub"[^>]*data-weight="2"/);
    assert.match(html, /data-weight="1"/);
    // the sections wrapper appears before the stubs wrapper in the DOM
    assert.ok(html.indexOf('ship-biscuit-sections') < html.indexOf('ship-biscuit-stubs'));
  });

  test('every article (weighted OR stub) keeps the inert click seam', () => {
    const html = renderEditionHtml(busy);
    // both tiers carry .ship-biscuit-article (inert-note handler) + the headline link
    // (trailing space avoids matching the .ship-biscuit-articles container)
    const articles = html.match(/class="ship-biscuit-article /g) || [];
    assert.strictEqual(articles.length, 5);
    const links = html.match(/class="ship-biscuit-headline" data-testid="ship-biscuit-headline"/g) || [];
    assert.strictEqual(links.length, 5);
  });
});

describe('renderEditionHtml — quiet + empty (behaviour preserved)', () => {
  test('a quiet edition runs an honest note and NO headlines', () => {
    const html = renderEditionHtml(edition({ isQuiet: true, index: [] }));
    assert.match(html, /data-testid="ship-biscuit-quiet"/);
    // no stub headline links on a quiet day
    assert.doesNotMatch(html, /data-testid="ship-biscuit-headline"/);
    // the lead story (headline + lede) still renders
    assert.match(html, /data-testid="ship-biscuit-lead-headline"/);
    assert.match(html, /data-testid="ship-biscuit-lede"/);
  });

  test('an empty index (no quiet flag) also renders the quiet note, no headlines', () => {
    const html = renderEditionHtml(edition({ isQuiet: false, index: [] }));
    assert.match(html, /data-testid="ship-biscuit-quiet"/);
    assert.doesNotMatch(html, /data-testid="ship-biscuit-headline"/);
  });

  test('no edition renders the empty state', () => {
    const html = renderEditionHtml(null);
    assert.match(html, /ship-biscuit-empty/);
    assert.match(html, /no edition yet/);
  });
});
