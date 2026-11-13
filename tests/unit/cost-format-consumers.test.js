/**
 * LIN-4446: the browser consumers of window.CostFormat load without the global, and format the same strings once the
 * module shim has installed it. Each consumer reads the global only from a handler or a callback that runs after
 * DOMContentLoaded (the shim is a module and runs after the classic scripts parse), so loading must not touch it.
 *
 * flight-companion.js is driven here through its own exported formatCost, in the shared fake DOM with the document
 * still loading, so its startup waits for DOMContentLoaded exactly as in the browser. observation.js and prompt-section.js
 * are covered by tests/unit/observation-scan-due.test.js and tests/unit/lin-3833-run-control.test.js, which now install
 * the formatter after their page script has loaded.
 *
 * Run with: node --test tests/unit/cost-format-consumers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWorld, fireDOMContentLoaded } from './helpers/client-world.js';
import { loadCostFormat } from '../fixtures/browser-cost-format.js';

const FLIGHT_SRC = readFileSync(new URL('../../public/flight-companion.js', import.meta.url), 'utf8');

/** The ids the script looks up at load, as the page's markup has them. */
const FLIGHT_PAGE = `
<div class="flight-companion-page">
  <div id="flight-companion-thread"></div>
  <div id="flight-companion-chat-empty"></div>
  <div id="flight-companion-checkin"></div>
  <textarea id="flight-companion-question"></textarea>
  <button id="flight-companion-send" type="button"></button>
  <button id="flight-companion-start" type="button"></button>
  <button id="flight-companion-reorient" type="button"></button>
  <div id="flight-companion-strip-next"></div>
  <div id="flight-companion-strip-tab-total"></div>
  <select id="flight-companion-model"></select>
  <input id="flight-companion-model-search">
  <div id="flight-companion-model-list"></div>
  <div id="flight-companion-tools-warning"></div>
  <div id="flight-companion-model-price"></div>
  <pre id="flight-companion-prompt"></pre>
  <button id="flight-companion-copy" type="button"></button>
  <div id="flight-companion-copy-feedback"></div>
</div>`;

/** Loads the page script with the document still loading, so its startup waits for DOMContentLoaded. */
function loadFlightCompanion() {
  const world = loadWorld({
    window: { addEventListener() {}, removeEventListener() {}, location: { href: '', pathname: '/' } },
    scripts: [],
    globals: { module: { exports: {} }, setInterval: () => 0, clearInterval() {} },
  });
  world.document.body.innerHTML = FLIGHT_PAGE;
  // The composer is sized at load (resizeComposer), which writes its style; the fake element has none to start with.
  world.document.getElementById('flight-companion-question').style = {};
  world.document.readyState = 'loading';
  world.run(FLIGHT_SRC);
  return world;
}

describe('flight-companion.js: loads without window.CostFormat, formats the same strings once it is installed', () => {
  test('loading with the document still loading does not read the formatter', () => {
    assert.doesNotThrow(() => loadFlightCompanion());
  });

  test('after the shim installs the formatter, and DOMContentLoaded fires, formatCost gives the browser copy\'s words', async () => {
    const world = loadFlightCompanion();
    loadCostFormat(world.sandbox);
    await fireDOMContentLoaded(world.document);
    const m = world.sandbox.module.exports;
    assert.equal(typeof m.formatCost, 'function');
    // The browser copy's fine mode, character for character: four decimals under $1, a dash for an unknown cost.
    assert.equal(m.formatCost(0.0421), '$0.0421');
    assert.equal(m.formatCost(0), '$0.0000');
    assert.equal(m.formatCost(0.00004), '<$0.0001');
    assert.equal(m.formatCost(null), '—');
    assert.equal(m.formatCost(undefined), '—');
    assert.equal(m.formatCost(Number.NaN), '—');
  });
});
