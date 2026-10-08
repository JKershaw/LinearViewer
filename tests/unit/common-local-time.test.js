/**
 * LIN-3360 — unit tests for `window.formatLocalTime` / `window.initLocalTimes`
 * (public/common.js), the shared local-time helper. vm-sandboxed like
 * common-render-markdown.test.js; `timeZone`/`nowMs` make the output
 * deterministic.
 *
 * Run with: node --test tests/unit/common-local-time.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

function makeSandbox() {
  const sandbox = { console, document: { addEventListener() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(COMMON_SRC, sandbox, { filename: 'common.js' });
  return sandbox;
}

const TZ = 'Asia/Tokyo'; // UTC+9, no DST
const NOW = Date.parse('2026-10-08T12:00:00Z'); // 21:00 on 8 Oct in Tokyo

describe('window.formatLocalTime', () => {
  const { window } = makeSandbox();

  test('same local day renders HH:MM only', () => {
    const out = window.formatLocalTime('2026-10-08T01:05:00Z', { nowMs: NOW, timeZone: TZ });
    assert.match(out, /^10:05$/);
  });

  test('another local day renders "D Mon, HH:MM"', () => {
    const out = window.formatLocalTime('2026-10-06T01:05:00Z', { nowMs: NOW, timeZone: TZ });
    assert.match(out, /^6 Oct, 10:05$/);
  });

  test('the day is judged in the target timezone, not UTC', () => {
    // 20:00Z on the 7th is 05:00 on the 8th in Tokyo — same local day as NOW.
    const out = window.formatLocalTime('2026-10-07T20:00:00Z', { nowMs: NOW, timeZone: TZ });
    assert.match(out, /^05:00$/);
  });

  test('missing or invalid input returns null', () => {
    for (const v of [undefined, null, '', 'not a date']) {
      assert.equal(window.formatLocalTime(v, { nowMs: NOW, timeZone: TZ }), null);
    }
  });
});

describe('window.initLocalTimes', () => {
  function el(attrs, text) {
    const e = { text, attrs: { ...attrs }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } };
    Object.defineProperty(e, 'textContent', { get() { return this.text; }, set(v) { this.text = v; } });
    return e;
  }

  test('rewrites only the matched elements, keeps server text in title, leaves unparseable ones alone', () => {
    const { window } = makeSandbox();
    const good = el({ datetime: '2026-10-08T01:05:00Z' }, '2026-10-08T01:05:00Z');
    const bad = el({ datetime: 'garbage' }, 'garbage');
    let selector;
    const root = { querySelectorAll(sel) { selector = sel; return [good, bad]; } };
    window.initLocalTimes(root);
    assert.equal(selector, 'time[datetime][data-local-time]');
    assert.notEqual(good.text, '2026-10-08T01:05:00Z');
    assert.equal(good.attrs.title, '2026-10-08T01:05:00Z');
    assert.equal(bad.text, 'garbage');
    assert.equal(bad.attrs.title, undefined);
  });
});
