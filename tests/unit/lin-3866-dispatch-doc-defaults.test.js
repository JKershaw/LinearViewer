/**
 * LIN-3866 — docs/dispatch-integration.md (the human twin) must describe the
 * server-side fill that the proxy lanes apply to a blank `model` / `harness` /
 * `effort`, matching the served text in lib/proxy-instructions.js (the truth
 * source agents read).
 *
 * The stale claim: "omit it ... to keep the consumer's current/own default".
 * For POST /api/proxy/dispatch and POST /api/proxy/recommend-and-dispatch,
 * Harbour fills a blank field from the workspace's dispatch defaults before the
 * runner sees it; `harness` also falls through to the anchor's harness on a
 * follow-up and to `claude-code` as the last tier. The session lane
 * (POST /api/dispatch) does not take the final `claude-code` fill.
 *
 * Run with: node --test tests/unit/lin-3866-dispatch-doc-defaults.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(__dirname, '../..', path), 'utf8');

const docSource = read('docs/dispatch-integration.md');
const servedSource = read('lib/proxy-instructions.js');

// A `## ` section from its heading up to the next `## ` heading (or end of file).
function sectionOf(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `expected heading ${heading} in docs/dispatch-integration.md`);
  const next = source.indexOf('\n## ', start + heading.length);
  return source.slice(start, next === -1 ? undefined : next);
}

const modelSection = sectionOf(docSource, '## Execution model (`model`)');
const harnessSection = sectionOf(docSource, '## Harness (`harness`)');
const effortSection = sectionOf(docSource, '## Effort (`effort`)');

// Field-table rows (dispatch item schema and per-endpoint request tables) for the three fields.
const fieldRows = docSource.split('\n').filter(line => /^\|\s*`(model|harness|effort)`\s*\|/.test(line));

// The phrasing this ticket removes. Matches "keep(s) the consumer's current default",
// "keep(s) the consumer's own default", "... own default/precedence chain", and "omitted ⇒ consumer default".
const STALE = /keeps? the consumer's (?:(?:current|own) )?default|omitted ⇒ consumer default/;

describe('LIN-3866 — blank model/harness/effort no longer "keeps the consumer\'s default"', () => {
  test('the model section has no stale consumer-default claim', () => {
    assert.doesNotMatch(modelSection, STALE);
  });

  test('the harness section has no stale consumer-default claim', () => {
    assert.doesNotMatch(harnessSection, STALE);
  });

  test('the effort section has no stale consumer-default claim (blank effort is filled too)', () => {
    assert.doesNotMatch(effortSection, STALE);
  });

  test('no model/harness/effort field-table row restates the stale claim', () => {
    // Three item-schema rows (the dispatch record) and three request-table rows (POST bodies).
    assert.equal(fieldRows.length, 6, `expected 6 model/harness/effort rows, found ${fieldRows.length}`);
    for (const row of fieldRows) assert.doesNotMatch(row, STALE, row);
  });
});

describe('LIN-3866 — the human doc states the proxy-lane fill order the served text states', () => {
  // The served text (lib/proxy-instructions.js) is the truth source. These phrases are the
  // ordered tiers it names; the doc's proxy-lane bullet must carry the same tiers in order.
  test('the served instructions still name the harness tiers in this order', () => {
    const served = 'an explicit value wins, then (on a "followUpTo") the anchor\'s harness, then the workspace\'s dispatch defaults, then "claude-code"';
    assert.ok(servedSource.includes(served), 'served harness wording changed; re-sync the doc bullet below');
  });

  test('the served instructions still name the model tiers in this order', () => {
    const served = 'Omit it (or null) and Harbour fills it from the workspace\'s dispatch defaults; with none configured it stays null and the consumer\'s own default applies';
    assert.ok(servedSource.includes(served), 'served model wording changed; re-sync the doc bullet below');
  });

  test('the harness section has a proxy-lane fill bullet with explicit → anchor → defaults → claude-code', () => {
    const bullet = harnessSection.match(/\*\*Proxy-lane fill \(LIN-3866\)\.\*\*[^\n]*(?:\n(?!- |\n)[^\n]*)*/);
    assert.ok(bullet, 'expected a "**Proxy-lane fill (LIN-3866).**" bullet in the harness section');
    const text = bullet[0];
    const order = ['explicit', 'anchor', 'workspace', 'claude-code'].map(tier => text.indexOf(tier));
    for (const i of order) assert.notEqual(i, -1, `bullet missing a tier: ${text}`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'harness tiers out of order');
    assert.match(text, /session lane/i, 'bullet must say the session lane does not take the claude-code fill');
  });

  test('the model section has a proxy-lane fill bullet with explicit → defaults → null and no anchor tier', () => {
    const bullet = modelSection.match(/\*\*Proxy-lane fill \(LIN-3866\)\.\*\*[^\n]*(?:\n(?!- |\n)[^\n]*)*/);
    assert.ok(bullet, 'expected a "**Proxy-lane fill (LIN-3866).**" bullet in the model section');
    const text = bullet[0];
    const order = ['explicit', 'workspace', 'null'].map(tier => text.indexOf(tier));
    for (const i of order) assert.notEqual(i, -1, `bullet missing a tier: ${text}`);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'model tiers out of order');
    assert.match(text, /no anchor-inheritance tier/, 'bullet must say model has no anchor-inheritance tier');
  });
});
