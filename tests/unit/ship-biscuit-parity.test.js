/**
 * Server↔client structural-parity test for The Ship's Biscuit front page (LIN-1198,
 * close-out ledger item 1).
 *
 * The newspaper front page is rendered TWICE from the same edition shape: the server
 * paints it on first load via `renderEditionHtml` (lib/render-ship-biscuit.js) and the
 * client re-paints it after a Generate via `renderEdition` (public/ship-biscuit.js).
 * The two are hand-maintained mirrors, and that parity is load-bearing — a future edit
 * to one (the layoutIndex partition, column/stub ordering, or per-element markup) could
 * silently diverge from the other. The existing e2e reload test only proves the *lead
 * headline text* survives; the unit tests pin the server shape alone. This test closes
 * that gap: it renders a battery of shared edition fixtures through BOTH renderers and
 * asserts the emitted markup is structurally identical.
 *
 * public/ship-biscuit.js is a browser IIFE (not an ES module), so — following the
 * established public/observation.js pattern — we evaluate its source in a vm sandbox
 * that supplies fake `document` elements (so the IIFE runs past its element guard and
 * reaches its test-only `module.exports`) and capture `renderEdition`, which writes its
 * HTML into the fake `#ship-biscuit-edition` element's innerHTML.
 *
 * Run with: node --test tests/unit/ship-biscuit-parity.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { renderEditionHtml } from '../../lib/render-ship-biscuit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Load the client renderer out of the browser IIFE ------------------------------
// Fake DOM elements: the IIFE early-returns unless the generate button and edition
// container both resolve, and renderEdition writes into editionEl.innerHTML.
const editionEl = { innerHTML: '', addEventListener() {} };
const elements = {
  'ship-biscuit-generate': { disabled: false, addEventListener() {} },
  'ship-biscuit-window': { value: 'week' },
  'ship-biscuit-feedback': { textContent: '', className: '' },
  'ship-biscuit-edition': editionEl,
};
const sandbox = {
  module: { exports: {} },
  window: { __SHIP_BISCUIT_DATA__: { urlKey: 'k' } },
  document: { getElementById: (id) => elements[id] || null },
  console,
};
vm.runInNewContext(readFileSync(join(__dirname, '../../public/ship-biscuit.js'), 'utf8'), sandbox, {
  filename: 'ship-biscuit.js',
});
const { renderEdition: clientRenderEdition } = sandbox.module.exports;

function clientHtml(edition) {
  editionEl.innerHTML = '';
  clientRenderEdition(edition);
  return editionEl.innerHTML;
}

// Normalize insignificant inter-tag whitespace (the server template literals indent;
// the client concatenates) so the diff targets STRUCTURE, not layout of the source.
// The one tolerated content difference is the numeric form of the apostrophe entity:
// the server's escapeHtml emits `&#039;`, the client's esc emits `&#39;` — both render
// identically; that cosmetic entity form is out of scope for structural parity.
function norm(html) {
  return String(html)
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .replace(/&#0?39;/g, '&#39;')
    .trim();
}

function assertParity(edition, label) {
  const server = norm(renderEditionHtml(edition));
  const client = norm(clientHtml(edition));
  assert.strictEqual(client, server, `server↔client markup diverged for: ${label}`);
}

function stub(id, section, weight, headline) {
  return { id, section, weight, headline: headline || `${id} headline`, dek: `${id} dek` };
}

// --- Shared fixtures ---------------------------------------------------------------
const FIXTURES = {
  'full edition — lead + multi-desk columns + stubs': {
    generatedAt: '2026-07-09T12:00:00.000Z', window: 'week', isQuiet: false,
    frontPage: { headline: 'Autopilot clears the board', standfirst: 'A steady run.', lede: 'The full story of the week.' },
    index: [
      stub('art-1', 'The Wire', 5, 'LIN-1 shipped'),
      stub('art-2', 'The Wire', 4, 'LIN-2 reviewed'),
      stub('art-3', 'Deep Dive', 5, 'A long investigation'),
      stub('art-4', 'The Column', 1, 'A quiet aside'),
      stub('art-5', 'Weather', 2, 'Mild flakiness'),
    ],
  },
  'equal-weight columns across desks — tie-break ordering': {
    generatedAt: '2026-07-08T09:30:00.000Z', window: 'day', isQuiet: false,
    frontPage: { headline: 'Three desks, one weight', standfirst: '', lede: 'Ordering must be deterministic.' },
    index: [
      stub('a', 'The Column', 4),
      stub('b', 'The Wire', 4),
      stub('c', 'Deep Dive', 4),
      stub('d', 'Front Page', 4),
    ],
  },
  'columns only — no sub-floor stubs': {
    generatedAt: '2026-07-07T00:00:00.000Z', window: 'month', isQuiet: false,
    frontPage: { headline: 'All heavy news', standfirst: 'Big week.', lede: '' },
    index: [stub('x', 'The Wire', 5), stub('y', 'Deep Dive', 3)],
  },
  'stubs only — every item below the column floor': {
    generatedAt: '2026-07-06T00:00:00.000Z', window: 'week', isQuiet: false,
    frontPage: { headline: 'Odds and ends', standfirst: '', lede: 'Nothing led.' },
    index: [stub('p', 'Weather', 1), stub('q', 'The Column', 2)],
  },
  'headline-only edition — empty index falls back to the quiet note': {
    generatedAt: '2026-07-05T00:00:00.000Z', window: 'week', isQuiet: false,
    frontPage: { headline: 'Just the headline', standfirst: '', lede: '' }, index: [],
  },
  'quiet edition — lead renders, body is the slow-news-day note': {
    generatedAt: '2026-07-04T00:00:00.000Z', window: 'day', isQuiet: true,
    frontPage: { headline: 'A quiet day aboard', standfirst: 'Nothing crossed the wire.', lede: 'Slow news day.' },
    index: [],
  },
  'HTML-special characters in headline/dek/section — escaping parity': {
    generatedAt: '2026-07-03T00:00:00.000Z', window: 'week', isQuiet: false,
    frontPage: { headline: 'Fix <script> & "quotes" in the pipeline', standfirst: 'A & B <ok>', lede: '3 < 4 & 5 > 2' },
    index: [
      { id: 'esc-1', section: 'The Wire & Co', weight: 5, headline: '<b>bold</b> & risky', dek: '"quoted" <em>dek</em>' },
      { id: 'esc-2', section: "O'Brien's desk", weight: 1, headline: "It's a stub", dek: "don't panic" },
    ],
  },
  'unknown section on a column-tier item — grouping tolerance': {
    generatedAt: '2026-07-02T00:00:00.000Z', window: 'week', isQuiet: false,
    frontPage: { headline: 'Mystery desk', standfirst: '', lede: '' },
    index: [stub('u1', 'Obituaries', 5), stub('u2', 'The Wire', 5)],
  },
  'missing/blank front-page fields — dateline-only lead': {
    generatedAt: '2026-07-01T00:00:00.000Z', window: '', isQuiet: false,
    frontPage: {}, index: [stub('m1', 'The Wire', 4)],
  },
};

describe('Ship\'s Biscuit — server↔client structural parity (LIN-1198 ledger item 1)', () => {
  for (const [label, edition] of Object.entries(FIXTURES)) {
    test(`renderEditionHtml === renderEdition for: ${label}`, () => {
      assertParity(edition, label);
    });
  }

  test('the shared fixtures actually exercise columns, stubs and quiet bodies', () => {
    // Guard against the parity assertions passing vacuously on an all-empty battery:
    // prove the fixtures cover each structural branch of the renderers.
    const rendered = Object.values(FIXTURES).map(renderEditionHtml);
    assert.ok(rendered.some(h => /data-testid="ship-biscuit-columns"/.test(h)), 'no fixture renders columns');
    assert.ok(rendered.some(h => /data-testid="ship-biscuit-stubs"/.test(h)), 'no fixture renders stubs');
    assert.ok(rendered.some(h => /data-testid="ship-biscuit-quiet"/.test(h)), 'no fixture renders the quiet note');
  });
});
