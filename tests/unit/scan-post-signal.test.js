// LIN-2702: public/scan.js's postScan() now accepts an optional caller-owned
// AbortSignal and forwards it into window.api's request options, so a future
// bulk-scan pool (LIN-2700) can cancel an in-flight scan.
//
// public/scan.js is a plain browser script (assigns to `window`, not an ES
// module), so it is evaluated in a vm sandbox against a stub `window.api` —
// the same house pattern tests/unit/prompt-section-recommend-url.test.js and
// tests/unit/brief-recap-autogenerate.test.js use for their sibling client
// section renderers. Unlike prompt-section.js's raw-fetch __ai__ carve-out,
// scan.js's requests all go through window.api, so the stub is window.api
// itself (brief-recap-autogenerate.test.js's shape), not a top-level fetch.
//
// scan.js contains no document.* usage at all, and its only module-scope
// dependencies are window.escapeHtml/window.relativeTime (per the approved
// plan) — so no fake DOM or click simulation is needed; the test calls
// window.ScanSection.postScan(...) directly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/scan.js'), 'utf8');

// Loads the real public/scan.js into a fresh vm sandbox with a scripted
// window.api that records the full options object each call received (not
// just the method), since the signal-forwarding assertion needs it.
function loadScanSection() {
  const calls = [];
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    relativeTime: () => 'now',
    async api(url, opts) {
      calls.push({ url, opts });
      return {};
    },
  };
  vm.runInNewContext(SRC, { window, URLSearchParams });
  return { ScanSection: window.ScanSection, calls };
}

describe('public/scan.js: postScan optional abort signal (LIN-2702)', () => {
  test('window.ScanSection exposes both init and postScan', () => {
    const { ScanSection } = loadScanSection();
    assert.equal(typeof ScanSection.init, 'function');
    assert.equal(typeof ScanSection.postScan, 'function');
  });

  test('a caller-supplied signal reaches the window.api request options unchanged', async () => {
    const { ScanSection, calls } = loadScanSection();
    const ac = new AbortController();

    await ScanSection.postScan('ws', 'LIN-1', 'local', { signal: ac.signal });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws/api/scan/LIN-1?source=local');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.on401, false);
    assert.equal(calls[0].opts.signal, ac.signal); // strictly the same instance, not a copy
  });

  test('the existing three-argument call still works: no signal, url and options unchanged', async () => {
    const { ScanSection, calls } = loadScanSection();

    await ScanSection.postScan('ws', 'LIN-1', 'local');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/ws/api/scan/LIN-1?source=local');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.on401, false);
    assert.equal(calls[0].opts.signal, undefined); // inert to fetch, no branch needed
  });

  test('the URL is byte-identical across both calls and still comes from scanUrl (no second builder)', async () => {
    const { ScanSection, calls } = loadScanSection();
    const ac = new AbortController();

    await ScanSection.postScan('ws', 'LIN-1', 'local', { signal: ac.signal });
    await ScanSection.postScan('ws', 'LIN-1', 'local');

    assert.equal(calls[0].url, '/workspace/ws/api/scan/LIN-1?source=local');
    assert.equal(calls[1].url, '/workspace/ws/api/scan/LIN-1?source=local');
    assert.equal(calls[0].url, calls[1].url);
  });
});
