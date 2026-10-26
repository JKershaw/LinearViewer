/**
 * LIN-3983 PR 2: the status pill and the segment bar have one server helper each
 * (lib/components/status-pill.js, lib/components/segment-bar.js) and one client
 * replica each (public/common.js: window.renderStatusPill, window.renderSegmentBar).
 * `public/` has no ES modules, so the replica is a copy; this test loads common.js
 * in a vm and compares its output with the server helper over a table of inputs,
 * so the two cannot drift apart unnoticed.
 *
 * Run with: node --test tests/unit/segment-bar-pill-parity.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { renderStatusPill } from '../../lib/components/status-pill.js';
import { renderSegmentBar } from '../../lib/components/segment-bar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

function clientWindow() {
  const sandbox = { console, document: { addEventListener() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_SRC), sandbox, { filename: 'common.js' });
  return sandbox.window;
}

const client = clientWindow();

describe('status pill: the client replica matches lib/components/status-pill.js', () => {
  const PILLS = [
    { dot: true, variant: 'running', label: 'waiting' },
    { dot: true, variant: 'done', label: 'done' },
    { dot: true, variant: 'done', label: 'done', warn: true },
    { dot: true, variant: 'error', label: 'failed' },
    { dot: true, variant: 'queued', label: 'idle' },
    { dot: true, variant: 'running', label: 'a <b>label</b> & "more"' },
    { state: 'done', label: 'done' },
    { state: 'in-progress', char: '◐', label: 'in progress' },
    { state: 'todo', variant: 'tag', className: 'x-hook', attrs: 'data-testid="p"' },
    { dot: true, variant: 'running', label: 'with a warn', warn: true },
  ];
  for (const input of PILLS) {
    test(`${JSON.stringify(input)}`, () => {
      assert.equal(client.renderStatusPill(input), renderStatusPill(input));
    });
  }

  test('the observation pill keeps the markup its hand-written copy had (dot, variant, label, warn)', () => {
    const html = client.renderStatusPill({ dot: true, variant: 'done', label: 'done', warn: true });
    assert.equal(html, '<span class="status-pill status-pill--dot status-pill--done">'
      + '<span class="status-pill__dot" aria-hidden="true"></span>'
      + '<span class="status-pill__label">done</span>'
      + '<span class="status-pill__warn" title="a run errored" aria-label="warning">⚠</span></span>');
  });
});

describe('segment bar: the client replica matches lib/components/segment-bar.js', () => {
  const BARS = [
    { segments: [{ state: 'empty', title: 'no worker runs yet' }], ariaLabel: 'no worker runs yet', className: 'obs-progress' },
    { segments: [{ state: 'done', title: 'LIN-1 · Build — complete' }, { state: 'running', title: 'LIN-2 — running', live: true }, { state: 'queued' }], ariaLabel: '1 of 3 runs finished', className: 'obs-progress' },
    { segments: [{ state: 'error', label: 'x', title: 'a <title> & more' }, { state: 'done', count: 4 }] },
    { segments: [{ state: 'running', live: false }, { live: true }], attrs: 'data-testid="bar"' },
  ];
  for (const [i, input] of BARS.entries()) {
    test(`bar ${i + 1}`, () => {
      assert.equal(client.renderSegmentBar(input), renderSegmentBar(input));
    });
  }

  test('an empty segments list throws on both sides', () => {
    assert.throws(() => client.renderSegmentBar({ segments: [] }), /non-empty/);
    assert.throws(() => renderSegmentBar({ segments: [] }), /non-empty/);
  });
});
