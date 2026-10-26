/**
 * LIN-3983: the shared tab strip (lib/components/tabs.js). Pins the markup a
 * page's selection code and its specs depend on: one selected tab, the roving
 * tabindex, the testid per key, escaped labels, and loud failures for a bad
 * call rather than a strip with nothing selected.
 *
 * Run with: node --test tests/unit/tabs-component.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderTabs } from '../../lib/components/tabs.js';

const TABS = [
  { key: 'runs', label: 'Runs' },
  { key: 'rulings', label: 'Rulings' },
  { key: 'due', label: 'Scan-due' }
];

describe('renderTabs', () => {
  test('marks exactly the active tab as selected and roves the tabindex to it', () => {
    const html = renderTabs({ tabs: TABS, activeKey: 'rulings', ariaLabel: 'Observation view', testIdPrefix: 'obs-tab' });
    assert.equal((html.match(/is-active/g) || []).length, 1);
    assert.match(html, /class="tabs__tab is-active" role="tab" data-tab="rulings" aria-selected="true" tabindex="0"/);
    assert.match(html, /data-tab="runs" aria-selected="false" tabindex="-1"/);
    assert.match(html, /data-tab="due" aria-selected="false" tabindex="-1"/);
  });

  test('gives every tab a testid built from the prefix and its key', () => {
    const html = renderTabs({ tabs: TABS, activeKey: 'runs', ariaLabel: 'v', testIdPrefix: 'obs-tab' });
    for (const key of ['runs', 'rulings', 'due']) {
      assert.match(html, new RegExp(`data-testid="obs-tab-${key}"`));
    }
  });

  test('the strip is a tablist with its accessible name, and buttons are real buttons', () => {
    const html = renderTabs({ tabs: TABS, activeKey: 'runs', ariaLabel: 'Observation view' });
    assert.match(html, /^<div class="tabs" role="tablist" aria-label="Observation view">/);
    assert.equal((html.match(/<button type="button" class="tabs__tab/g) || []).length, 3);
  });

  test('escapes labels and keys rather than injecting markup', () => {
    const html = renderTabs({ tabs: [{ key: 'a"b', label: '<img src=x>' }], activeKey: 'a"b', ariaLabel: 'x' });
    assert.ok(!html.includes('<img'), 'a label must not inject markup');
    assert.ok(html.includes('&lt;img src=x&gt;'));
    assert.ok(html.includes('data-tab="a&quot;b"'));
  });

  test('throws when there are no tabs', () => {
    assert.throws(() => renderTabs({ tabs: [], activeKey: 'x' }), /non-empty `tabs`/);
  });

  test('throws when the active key is not one of the tabs', () => {
    assert.throws(() => renderTabs({ tabs: TABS, activeKey: 'nope' }), /activeKey "nope" is not one of the tabs/);
  });
});
