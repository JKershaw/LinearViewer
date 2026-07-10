/**
 * Server↔client render parity for "The Ship's Biscuit" newspaper front page
 * (LIN-1198, Theme B).
 *
 * The server first paint (lib/render-ship-biscuit.js renderEditionHtml) and the
 * client post-generate render (public/ship-biscuit.js buildEditionHtml) MUST produce
 * the same DOM, or the page would visibly reflow between first paint and a Generate.
 * Server and client are separate code paths (ESM vs a browser IIFE with no build
 * step), so the markup is duplicated verbatim — this test is what keeps the two
 * honest.
 *
 * The client is a browser IIFE; we run its source in a vm sandbox with a stub DOM
 * (getElementById → null, so the IIFE bails after exposing the pure builder) and pull
 * window.__shipBiscuitBuildEditionHtml back out. Whitespace differs between the
 * template-literal server and the concatenating client, so we compare after collapsing
 * insignificant whitespace — structure, attributes, and order must match exactly.
 *
 * Run with: node --test tests/unit/ship-biscuit-parity.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderEditionHtml } from '../../lib/render-ship-biscuit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = readFileSync(join(__dirname, '../../public/ship-biscuit.js'), 'utf8');

/** Evaluate the client IIFE in a sandbox and return its pure buildEditionHtml. */
function loadClientBuilder() {
  const sandbox = { window: {}, document: { getElementById: () => null } };
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_SRC, sandbox);
  const fn = sandbox.window.__shipBiscuitBuildEditionHtml;
  assert.strictEqual(typeof fn, 'function', 'client must expose __shipBiscuitBuildEditionHtml');
  return fn;
}

/** Collapse insignificant whitespace so the two rendering styles compare structurally. */
const norm = (html) => String(html).replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

function busyEdition(frontPage) {
  return {
    id: 'ed-1',
    window: 'week',
    generatedAt: '2026-07-09T12:00:00.000Z',
    isQuiet: false,
    frontPage,
    index: [
      { id: 'art-1', section: 'The Wire', headline: 'Top story', dek: 'Lead teaser.', weight: 5, sourceRefs: [] },
      { id: 'art-2', section: 'Deep Dive', headline: "Ada's fix & <b>bold</b>", dek: '', weight: 4, sourceRefs: [] },
      { id: 'art-3', section: 'The Column', headline: 'A middling note', dek: 'Some colour.', weight: 3, sourceRefs: [] },
      { id: 'art-4', section: 'Weather', headline: 'Small stub', dek: '', weight: 2, sourceRefs: [] },
      { id: 'art-5', section: 'Weather', headline: 'Tiny stub', dek: 'By the numbers.', weight: 1, sourceRefs: [] }
    ]
  };
}

describe('server↔client render parity (LIN-1198)', () => {
  const buildClient = loadClientBuilder();

  test('WITH standfirst: server and client render identical markup', () => {
    const edition = busyEdition({ headline: 'Autopilot clears the board', standfirst: 'A steady week of small wins.', lede: 'A busy week aboard.' });
    assert.strictEqual(norm(buildClient(edition)), norm(renderEditionHtml(edition)));
  });

  test('WITHOUT standfirst: server and client both omit the node, identically', () => {
    const edition = busyEdition({ headline: 'A terse but real headline', standfirst: '', lede: 'Short and plain.' });
    const server = renderEditionHtml(edition);
    const client = buildClient(edition);
    assert.strictEqual(norm(client), norm(server));
    // and both genuinely drop the standfirst node (not just render it empty)
    assert.doesNotMatch(server, /ship-biscuit-standfirst/);
    assert.doesNotMatch(client, /ship-biscuit-standfirst/);
  });

  test('quiet edition renders identically on both sides', () => {
    const edition = {
      id: 'ed-2', window: 'week', generatedAt: '2026-07-09T12:00:00.000Z', isQuiet: true,
      frontPage: { headline: 'A slow news day aboard', standfirst: '', lede: 'Nothing crossed the wire.' },
      index: []
    };
    assert.strictEqual(norm(buildClient(edition)), norm(renderEditionHtml(edition)));
  });

  test('the escaped headline (apostrophe/ampersand/angle brackets) matches byte-for-byte', () => {
    // Guards the esc ↔ escapeHtml alignment (both must emit &#039; for an apostrophe).
    const edition = busyEdition({ headline: "Ada's & <tag>", standfirst: "O'Brien said \"go\"", lede: 'x' });
    assert.strictEqual(norm(buildClient(edition)), norm(renderEditionHtml(edition)));
  });
});
