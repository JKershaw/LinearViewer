/**
 * LIN-4463 piece 4: public/observation.js is a native ES module. These witnesses pin what the conversion is for, so that a
 * change back to the bridge, to a restated duration rule, or to the classic `module.exports` seam fails here, not only in
 * a blind read:
 *  - the page imports the formatter and the duration leaf from /lib/ by a relative specifier, and reads no bridge global;
 *  - it loads and prices a scan estimate with `window.CostFormat` absent (the bridge is not needed by this page any more);
 *  - its runtime wording is the shared leaf's, with the one deliberate difference: a non-finite ms reads '' (the copy printed
 *    `NaNh`).
 *
 * Run with: node --test tests/unit/observation-module.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importWorld } from './helpers/import-world.js';
import { formatUsd } from '../../lib/cost-format.js';
import { fmtDuration } from '../../lib/time-words.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(join(ROOT, 'public/observation.js'), 'utf8');
// Comments may name the very things a witness forbids (to explain why); strip them before looking for code.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/[^\n]*/g, '$1');

/** A page world with the window stubs observation.js touches at load, and no CostFormat bridge. */
async function loadPage() {
  const world = await importWorld({
    window: { addEventListener() {}, renderStatusPill: () => '', renderSegmentBar: () => '' },
    globals: { escapeHtml: (s) => (s == null ? '' : String(s)), relativeTime: () => '', console: { warn() {}, error() {}, log() {} } },
    timers: [],
  });
  const page = await world.importPage('observation.js');
  return { world, page };
}

describe('observation.js is a native module (LIN-4463 piece 4)', () => {
  test('it imports the formatter and the duration leaf from /lib/ by relative specifier', () => {
    assert.match(CODE, /^import \{ formatUsd \} from '\.\.\/lib\/cost-format\.js';$/m);
    assert.match(CODE, /^import \{ fmtDuration \} from '\.\.\/lib\/time-words\.js';$/m);
  });

  test('it reads no bridge global and writes no global, and the classic seam is gone', () => {
    assert.doesNotMatch(CODE, /window\.CostFormat/);
    assert.doesNotMatch(CODE, /\bmodule\.exports\b|typeof module\b/);
    assert.doesNotMatch(CODE, /\bwindow\.[A-Za-z_$][\w$]*\s*=[^=]/, 'a module publishes through exports, not window');
  });

  test('its test seams are named exports: the namespace carries the helpers the suites read', async () => {
    const { world, page } = await loadPage();
    try {
      for (const name of ['renderActivityLog', 'diffSessionList', 'fillSessionHead', 'formatDueScanCostEstimate', 'getOpenLoopIds', 'setOpenLoopIds']) {
        assert.equal(typeof page[name], 'function', `${name} is exported as a function`);
      }
    } finally {
      world.restore();
    }
  });

  test('a fresh import is a fresh instance: a second page does not share the first one\'s state', async () => {
    const a = await loadPage();
    const b = await loadPage();
    try {
      a.page.setOpenLoopIds(new Set(['only-a']));
      assert.equal(b.page.getOpenLoopIds(), null, 'the second instance has its own openLoopIds');
      assert.deepEqual([...a.page.getOpenLoopIds()], ['only-a']);
    } finally {
      a.world.restore();
      b.world.restore();
    }
  });
});

describe('the converted page works with no bridge (window.CostFormat absent)', () => {
  test('a scan estimate is priced by the shared formatter, the same words /lib/cost-format.js gives', async () => {
    const { world, page } = await loadPage();
    try {
      assert.equal(world.window.CostFormat, undefined, 'the bridge global is not installed for this page');
      const estimate = { calls: 3, pricedCalls: 3, meanUsd: 0.01, unknown: false };
      const words = formatUsd(0.03, { fine: true });
      assert.ok(words, 'the formatter prices 0.03 (the oracle is not null)');
      assert.equal(page.formatDueScanCostEstimate(estimate, 3), `est. ${words}`);
      assert.equal(page.formatDueScanCostEstimate({ meanUsd: 0.01, unknown: true }, 3), 'est. unknown');
    } finally {
      world.restore();
    }
  });
});

describe('runtime wording is the shared leaf\'s, with one deliberate difference', () => {
  test('for every finite, non-negative ms, the words are fmtDuration\'s (the copy this replaced)', async () => {
    const { world, page } = await loadPage();
    try {
      // fillSessionHead draws the session's runtime through formatRuntime; the chip text is the words under test.
      const probe = (ms) => {
        const li = world.document.createElement('li');
        const head = world.document.createElement('div');
        head.className = 'obs-session-head';
        li.appendChild(head);
        page.fillSessionHead(li, { sessionId: 's', runtime: { ms }, tasksTouched: [], runs: [] });
        return head;
      };
      for (const ms of [0, 999, 60_000, 5 * 60_000 + 7_000, 2 * 3600_000 + 3 * 60_000, 26 * 3600_000]) {
        assert.ok(fmtDuration(ms), `the leaf words ${ms}ms`);
        assert.ok(probe(ms).textContent.includes(fmtDuration(ms)), `the head shows ${fmtDuration(ms)} for ${ms}ms`);
      }
    } finally {
      world.restore();
    }
  });

  test('a non-finite ms reads empty, where the replaced copy printed "NaNh"', async () => {
    const { world, page } = await loadPage();
    try {
      const li = world.document.createElement('li');
      const head = world.document.createElement('div');
      head.className = 'obs-session-head';
      li.appendChild(head);
      page.fillSessionHead(li, { sessionId: 's', runtime: { ms: Number.NaN }, tasksTouched: [], runs: [] });
      assert.doesNotMatch(head.textContent, /NaN/);
    } finally {
      world.restore();
    }
  });
});
