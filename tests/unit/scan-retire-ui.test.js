// LIN-2650 WS4 §5: the self-resolved render branch + retire/un-retire
// affordances in public/scan.js.
//
// public/scan.js is a plain browser script (assigns to `window`, not an ES
// module), so — same house pattern as tests/unit/scan-post-signal.test.js
// and tests/unit/brief-recap-autogenerate.test.js — it is evaluated in a vm
// sandbox against a minimal fake DOM `container` and a scripted
// `window.api`. Unlike those two, wireActions() wires SEVERAL distinct
// buttons on the same render (scan/rescan, dismiss, answer, retire,
// unretire), so the fake `container` keys click handlers by selector rather
// than tracking a single "last wired" handler.
//
// scan.js calls the bare global `confirm(...)` (LIN-511's ratified
// destructive-action primitive), not `window.confirm` — the vm sandbox's
// free-variable lookup resolves that against the CONTEXT object itself, so
// `confirm` is stubbed at the top level of the vm context, a sibling of
// `window`, not nested inside it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../../public/scan.js'), 'utf8');

function makeContainer() {
  const handlers = {};
  return {
    innerHTML: '',
    _state: null,
    classList: { add() {} },
    setAttribute(k, v) { if (k === 'data-state') this._state = v; },
    getAttribute(k) { return k === 'data-state' ? this._state : null; },
    // wireActions() selectors are either a single `[data-scan-action="x"]`
    // attribute or a comma-joined pair (scan/rescan). Match whichever named
    // attribute is present in the CURRENT innerHTML, keyed by the exact
    // selector string wireActions used, so a later click() call can address
    // a specific button even when several are wired on the same render.
    querySelector(sel) {
      const parts = sel.split(',').map(s => s.trim());
      const present = parts.find(p => this.innerHTML.includes(p.replace(/^\[|\]$/g, '')));
      if (!present) return null;
      return { addEventListener: (type, fn) => { if (type === 'click') handlers[sel] = fn; } };
    },
    querySelectorAll() { return []; },
    async click(selector) {
      const fn = handlers[selector];
      assert.ok(fn, `no click handler wired for ${selector}`);
      await fn();
    }
  };
}

const RETIRE_SEL = '[data-scan-action="retire"]';
const UNRETIRE_SEL = '[data-scan-action="unretire"]';
const DISMISS_SEL = '[data-scan-action="dismiss"]';
const ANSWER_SEL = '[data-scan-action="answer"]';

// The rendered HTML carries the bare attribute (`data-scan-action="retire"`),
// never the CSS-selector brackets — this strips them so the same SEL
// constant drives both container.click(sel) (a selector) and an innerHTML
// presence check (a literal attribute string).
function attrOf(sel) {
  return sel.replace(/^\[|\]$/g, '');
}

function loadScanSection({ responder, confirmReturns = true } = {}) {
  const calls = [];
  const confirmCalls = [];
  const window = {
    escapeHtml: (s) => (s == null ? '' : String(s)),
    relativeTime: () => 'now',
    async api(url, opts) {
      const method = (opts && opts.method) || 'GET';
      const body = opts && opts.body ? JSON.parse(opts.body) : undefined;
      calls.push({ url, method, body });
      return responder(url, method, body);
    },
  };
  const context = {
    window,
    URLSearchParams,
    confirm: (msg) => { confirmCalls.push(msg); return confirmReturns; },
  };
  vm.runInNewContext(SRC, context);
  return { ScanSection: window.ScanSection, calls, confirmCalls };
}

const OPTS = { urlKey: 'ws', identifier: 'LIN-1' };

function unansweredDecision(overrides = {}) {
  return {
    status: 'fresh',
    id: 'row-1',
    issueId: 'uuid-1',
    decision: { question: 'Which approach?', options: [{ id: 'a', label: 'A' }] },
    scannedAt: '2026-09-10T00:00:00.000Z',
    outcome: null,
    outcomeAt: null,
    outcomeReason: null,
    outcomeBasisHash: null,
    ...overrides
  };
}

function selfResolvedRow(overrides = {}) {
  return unansweredDecision({
    outcome: 'self-resolved',
    outcomeAt: '2026-09-10T01:00:00.000Z',
    outcomeReason: 'Retired automatically: a rescan on 2026-09-10T01:00:00.000Z found no pending decision.',
    outcomeBasisHash: 'basis-xyz',
    ...overrides
  });
}

describe('public/scan.js — self-resolved render branch (LIN-2650 WS4 §5)', () => {
  test('renderFresh: a self-resolved row renders as retired, not the interactive answer UI', async () => {
    const { ScanSection } = loadScanSection({ responder: () => selfResolvedRow() });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);

    assert.match(container.innerHTML, /data-testid="scan-outcome-self-resolved"/);
    assert.match(container.innerHTML, /Retired/);
    assert.match(container.innerHTML, /Retired automatically: a rescan/, 'the outcomeReason is shown');
    assert.match(container.innerHTML, new RegExp(attrOf(UNRETIRE_SEL)));
    assert.doesNotMatch(container.innerHTML, /data-scan-answer-input/, 'not the interactive answer UI');
    assert.doesNotMatch(container.innerHTML, /data-scan-action="dismiss"/);
    assert.doesNotMatch(container.innerHTML, /data-scan-action="retire"/, 'no retire button on an already-retired row');
  });

  test('renderStale: a self-resolved row whose content has since changed still renders as retired ("out of date · retired")', async () => {
    const stale = { ...selfResolvedRow(), status: 'stale', basisChanged: null };
    const { ScanSection } = loadScanSection({ responder: () => stale });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);

    assert.match(container.innerHTML, /scan · out of date · retired/);
    assert.match(container.innerHTML, /data-testid="scan-outcome-self-resolved"/);
    assert.match(container.innerHTML, new RegExp(attrOf(UNRETIRE_SEL)));
  });

  test('an ordinary unanswered decision gains a Retire button alongside answer/dismiss', async () => {
    const { ScanSection } = loadScanSection({ responder: () => unansweredDecision() });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);

    assert.match(container.innerHTML, new RegExp(attrOf(RETIRE_SEL)));
    assert.match(container.innerHTML, new RegExp(attrOf(DISMISS_SEL)));
    assert.match(container.innerHTML, new RegExp(attrOf(ANSWER_SEL)));
  });

  // Regression: dismissed/answered/zero-finding must render exactly as
  // before — self-resolved is a NEW third branch, inserted ahead of the
  // dismissed/answered check, not a replacement for it.
  test('dismissed/answered/zero-finding branches are unaffected', async () => {
    const dismissed = unansweredDecision({ outcome: 'dismissed', outcomeAt: '2026-09-10T00:00:00.000Z' });
    const { ScanSection: S1 } = loadScanSection({ responder: () => dismissed });
    const c1 = makeContainer();
    await S1.init(c1, OPTS);
    assert.match(c1.innerHTML, /data-testid="scan-outcome-dismissed"/);
    assert.doesNotMatch(c1.innerHTML, /scan-outcome-self-resolved/);
    assert.doesNotMatch(c1.innerHTML, new RegExp(attrOf(UNRETIRE_SEL)));

    const zeroFinding = { status: 'fresh', id: 'row-2', issueId: 'uuid-2', decision: null, scannedAt: '2026-09-10T00:00:00.000Z', outcome: null };
    const { ScanSection: S2 } = loadScanSection({ responder: () => zeroFinding });
    const c2 = makeContainer();
    await S2.init(c2, OPTS);
    assert.match(c2.innerHTML, /data-testid="scan-empty"/);
    assert.doesNotMatch(c2.innerHTML, /scan-outcome-self-resolved/);
  });
});

describe('public/scan.js — retire action (LIN-2650 WS4)', () => {
  test('confirm() carries the backstop-not-guarantee disclaimer', async () => {
    const { ScanSection, confirmCalls } = loadScanSection({
      responder: (url, method) => (method === 'POST' ? { retired: true, ...selfResolvedRow() } : unansweredDecision())
    });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);
    await container.click(RETIRE_SEL);

    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0], /backstop, not a guarantee/);
  });

  test('declining the confirm() dialog sends no request and leaves the view unchanged', async () => {
    const { ScanSection, calls } = loadScanSection({
      responder: () => unansweredDecision(),
      confirmReturns: false
    });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);
    const getCallsBefore = calls.length;
    await container.click(RETIRE_SEL);

    assert.equal(calls.length, getCallsBefore, 'no POST fired');
    assert.match(container.innerHTML, new RegExp(attrOf(RETIRE_SEL)), 'still the interactive view');
  });

  test('a successful retire (retired: true) re-renders as self-resolved', async () => {
    const { ScanSection, calls } = loadScanSection({
      responder: (url, method) => (method === 'POST' ? { retired: true, ...selfResolvedRow() } : unansweredDecision())
    });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);
    await container.click(RETIRE_SEL);

    const post = calls.find(c => c.method === 'POST');
    assert.ok(post, 'a POST was sent');
    assert.equal(post.url, '/workspace/ws/api/scan/uuid-1/retire');
    assert.deepEqual(post.body, { id: 'row-1' }, 'only the row id is sent — never a client-supplied verdict');
    assert.match(container.innerHTML, /data-testid="scan-outcome-self-resolved"/);
  });

  test('a non-retiring result (retired: false) restores the prior interactive view, not an error', async () => {
    const { ScanSection } = loadScanSection({
      responder: (url, method) => (method === 'POST' ? { retired: false, reason: 'still pending' } : unansweredDecision())
    });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);
    await container.click(RETIRE_SEL);

    assert.doesNotMatch(container.innerHTML, /scan-error/);
    assert.doesNotMatch(container.innerHTML, /scan-outcome-self-resolved/);
    assert.match(container.innerHTML, new RegExp(attrOf(RETIRE_SEL)), 'back to the interactive view — nothing was touched');
  });
});

describe('public/scan.js — un-retire action (LIN-2650 WS4)', () => {
  test('confirm() carries the disclaimer that un-retiring does not undo the underlying cause', async () => {
    const { ScanSection, confirmCalls } = loadScanSection({
      responder: (url, method) => (method === 'POST' ? { status: 'fresh', ...unansweredDecision() } : selfResolvedRow())
    });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);
    await container.click(UNRETIRE_SEL);

    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0], /does not undo whatever caused it to self-resolve/);
  });

  test('a successful un-retire returns to the interactive answer/dismiss/retire view', async () => {
    const { ScanSection, calls } = loadScanSection({
      responder: (url, method) => (method === 'POST' ? { status: 'fresh', ...unansweredDecision() } : selfResolvedRow())
    });
    const container = makeContainer();
    await ScanSection.init(container, OPTS);
    await container.click(UNRETIRE_SEL);

    const post = calls.find(c => c.method === 'POST');
    assert.ok(post, 'a POST was sent');
    assert.equal(post.url, '/workspace/ws/api/scan/uuid-1/unretire');
    assert.deepEqual(post.body, { id: 'row-1' });
    assert.doesNotMatch(container.innerHTML, /scan-outcome-self-resolved/);
    assert.match(container.innerHTML, new RegExp(attrOf(RETIRE_SEL)));
    assert.match(container.innerHTML, new RegExp(attrOf(DISMISS_SEL)));
  });
});
