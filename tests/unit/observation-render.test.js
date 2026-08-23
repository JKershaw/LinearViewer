// LIN-866: Observation activity-log / produced-artifact fidelity (design §6.3/§6.4).
//
// public/observation.js is a browser script (not an ES module), so we can't import
// it. It only touches `window`/`document` at load time via two addEventListener
// calls at the end. We evaluate its source in a vm sandbox that supplies a `module`
// object (so its guarded CommonJS test export runs) plus stubbed browser globals,
// then exercise the pure presentation helpers without a DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../public/observation.js'), 'utf8');
// `escapeHtml` is a browser global installed by common.js (`window.escapeHtml`),
// which observation.js references bare. Supply a faithful copy in the sandbox.
const escapeHtml = (str) => {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
};
const sandbox = {
  module: { exports: {} },
  window: { addEventListener() {} },
  document: { addEventListener() {} },
  escapeHtml,
  console,
};
vm.runInNewContext(src, sandbox, { filename: 'observation.js' });
const { renderActivityLog, renderArtifacts, classifyArtifact, renderObjective } = sandbox.module.exports;
const { renderSummaryLine, excerptDecisionCase, renderWaitingDecisionSummary, DECISION_EXCERPT_CHARS } = sandbox.module.exports;
const { laneTicketWalk, ticketProgressText } = sandbox.module.exports;

test.describe('renderActivityLog — §6.3 burst copy', () => {
  test('drops the redundant per-burst total when a breakdown sums it', () => {
    const html = renderActivityLog({ metrics: [{ toolCount: 18, breakdown: { Edit: 13, Bash: 5 }, elapsedSeconds: 142 }] });
    assert.match(html, /Edit×13/);
    assert.match(html, /Bash×5/);
    // The chips already sum to 18 — no separate "18 tools" total chip.
    assert.doesNotMatch(html, /18 tool/);
  });

  test('empty burst reads as a quiet "no tools", never "0 tools"', () => {
    const html = renderActivityLog({ metrics: [{ toolCount: 0, elapsedSeconds: 3 }] });
    assert.match(html, /no tools/);
    assert.doesNotMatch(html, /0 tool/);
    assert.match(html, /obs-act-idle/);
  });

  test('bare count is kept when there is no breakdown to sum it', () => {
    const one = renderActivityLog({ metrics: [{ toolCount: 1 }] });
    assert.match(one, /1 tool<\/span>/);
    const many = renderActivityLog({ metrics: [{ toolCount: 7 }] });
    assert.match(many, /7 tools<\/span>/);
  });

  test('a non-tool metric (no toolCount) still falls back to its raw line', () => {
    const html = renderActivityLog({ metrics: [{ raw: 'thinking' }] });
    assert.match(html, /obs-act-raw/);
    assert.match(html, /thinking/);
    assert.doesNotMatch(html, /no tools/);
  });
});

test.describe('classifyArtifact / renderArtifacts — §6.4 typed rendering', () => {
  test('classifies a GitHub PR url as a pr with a repo #num handle', () => {
    const c = classifyArtifact({ url: 'https://github.com/JKershaw/simple-dispatcher/pull/24' });
    assert.equal(c.pr, true);
    assert.equal(c.handle, 'simple-dispatcher #24');
  });

  test('classifies a GitLab merge request url as a pr', () => {
    const c = classifyArtifact({ url: 'https://gitlab.com/group/repo/-/merge_requests/5' });
    assert.equal(c.pr, true);
    assert.equal(c.handle, 'repo #5');
  });

  test('a non-PR url is a plain link', () => {
    assert.equal(classifyArtifact({ url: 'https://example.com/logs/run-1.txt' }).pr, false);
  });

  test('renders a PR with the branch glyph + mono handle', () => {
    const html = renderArtifacts({ producedArtifacts: [{ url: 'https://github.com/JKershaw/simple-dispatcher/pull/24', label: 'PR #24' }] });
    assert.match(html, /obs-artifact-pr/);
    assert.match(html, /⎇/);
    assert.match(html, /obs-artifact-handle/);
    assert.match(html, /simple-dispatcher #24/);
  });

  test('renders a plain link with the external glyph and its label', () => {
    const html = renderArtifacts({ producedArtifacts: [{ url: 'https://example.com/log.txt', label: 'run log' }] });
    assert.match(html, /↗/);
    assert.match(html, /run log/);
    assert.doesNotMatch(html, /obs-artifact-pr/);
  });

  test('no artifacts → empty string', () => {
    assert.equal(renderArtifacts({ producedArtifacts: [] }), '');
  });
});

test.describe('renderObjective — §4 id-once (LIN-931)', () => {
  test('renders the objective when seedTitle is a real goal', () => {
    const html = renderObjective({ seedTitle: 'Ship the observation page', seedIssue: 'LIN-744' });
    assert.match(html, /obs-objective/);
    assert.match(html, /Ship the observation page/);
    assert.doesNotMatch(html, /LIN-744/);
  });

  test('drops the objective when seedTitle fell back to the seed id', () => {
    // Server-side seedTitle falls back to seedIssue (the identifier) when no
    // title exists anywhere; the objective must NOT reprint the id.
    assert.equal(renderObjective({ seedTitle: 'LIN-744', seedIssue: 'LIN-744' }), '');
  });

  test('id-equality guard is whitespace-tolerant', () => {
    assert.equal(renderObjective({ seedTitle: '  LIN-744 ', seedIssue: 'LIN-744' }), '');
  });

  test('no seedTitle → empty string (unchanged)', () => {
    assert.equal(renderObjective({ seedIssue: 'LIN-744' }), '');
    assert.equal(renderObjective({}), '');
  });

  test('escapes the objective text', () => {
    const html = renderObjective({ seedTitle: '<script>x</script>', seedIssue: 'LIN-1' });
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
  });
});

// LIN-2184 (H5, beat 4): the feed card's waiting line gains a BOUNDED excerpt
// of the case + option labels when a decision is present — never full prose
// (that's the banner's job, beat 3). Beat 2 widened the session-level
// projection so s.decision/s.decisionCase reach this consumer.
test.describe('renderSummaryLine / excerptDecisionCase — waiting card decision excerpt', () => {
  function waitingSession(overrides = {}) {
    return {
      sessionId: `sess-decision-${Math.random().toString(36).slice(2)}`,
      workspaceUrlKey: 'ws-a',
      stale: false,
      terminal: false,
      waiting: true,
      waitingMessage: 'need your decision',
      decision: null,
      decisionCase: [],
      ...overrides
    };
  }

  test('the excerpt is truncated at DECISION_EXCERPT_CHARS and never exceeds it', () => {
    const longCase = ['A'.repeat(DECISION_EXCERPT_CHARS + 50)];
    const excerpt = excerptDecisionCase(longCase, DECISION_EXCERPT_CHARS);
    assert.ok(excerpt.endsWith('…'), 'truncation is visible (ellipsis)');
    const withoutEllipsis = excerpt.slice(0, -1);
    assert.ok(
      withoutEllipsis.length <= DECISION_EXCERPT_CHARS,
      `excerpt body (${withoutEllipsis.length}) must not exceed the budget (${DECISION_EXCERPT_CHARS})`
    );
  });

  test('a short case under the budget renders whole, with no stray ellipsis', () => {
    const excerpt = excerptDecisionCase(['Proceed with the migration?'], DECISION_EXCERPT_CHARS);
    assert.equal(excerpt, 'Proceed with the migration?');
    assert.ok(!excerpt.includes('…'));
  });

  test('the excerpt spans multiple chunks rather than silently dropping everything after the first', () => {
    const excerpt = excerptDecisionCase(['Part one.', 'Part two.', 'Part three.'], DECISION_EXCERPT_CHARS);
    assert.match(excerpt, /Part one\./);
    assert.match(excerpt, /Part two\./);
    assert.match(excerpt, /Part three\./);
  });

  test('option labels render in the decision summary', () => {
    const html = renderWaitingDecisionSummary(
      { decision_id: 'd-1', options: [{ id: 'yes', label: 'Yes, proceed' }, { id: 'no', label: 'No, hold off' }] },
      ['short case']
    );
    assert.match(html, /Yes, proceed/);
    assert.match(html, /No, hold off/);
  });

  test('renderSummaryLine: a waiting session with a decision renders the excerpt + option labels + working reply CTA', () => {
    const s = waitingSession({
      decision: { decision_id: 'd-1', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] },
      decisionCase: ['Considered the schema diff.']
    });
    const html = renderSummaryLine(s);
    assert.match(html, /obs-summary-waiting/);
    assert.match(html, /waiting on you/);
    assert.match(html, /obs-summary-decision-excerpt/);
    assert.match(html, /Considered the schema diff\./);
    assert.match(html, /obs-summary-decision-options/);
    assert.match(html, /Yes/);
    assert.match(html, /No/);
    assert.match(html, /obs-summary-reply/);
    assert.match(html, /reply →/);
  });

  test('renderSummaryLine: a waiting session with NO decision renders exactly as before — no excerpt/options scaffolding', () => {
    const html = renderSummaryLine(waitingSession());
    assert.match(html, /obs-summary-waiting/);
    assert.match(html, /need your decision/);
    assert.ok(!html.includes('obs-summary-decision-excerpt'), 'no stray excerpt markup when there is no decision');
    assert.ok(!html.includes('obs-summary-decision-options'), 'no stray options markup when there is no decision');
    assert.match(html, /obs-summary-reply/, 'the existing reply CTA still renders');
  });

  test('the excerpt and option labels are HTML-escaped', () => {
    const s = waitingSession({
      decision: { decision_id: 'd-1', options: [{ id: 'x', label: '<script>alert(1)</script>' }] },
      decisionCase: ['<img src=x onerror=alert(1)>']
    });
    const html = renderSummaryLine(s);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
    assert.match(html, /&lt;script&gt;/);
  });

  // LIN-2184 (H5, beat 5): the ticket's V1-boundary acceptance test, feed-card
  // half (the banner half lives in render-session.test.js). A completion-path
  // decision on a non-waiting (terminal) session must render on NEITHER
  // surface — this asserts the feed card side. `renderSummaryLine`'s decision
  // summary only runs inside the SAME `if (s.waiting)` branch that already
  // guards the plain "waiting on you" line, so a non-waiting session never
  // reaches that code at all — proving beat 4 did not widen the gate.
  test('LIN-2184 V1 boundary: a completion-path decision on a non-waiting (terminal) session renders NEITHER "waiting on you" NOR any decision markup', () => {
    const s = waitingSession({
      waiting: false,
      terminal: true,
      waitingMessage: null,
      decision: { decision_id: 'd-3', question: 'Ship it?', options: [{ id: 'yes', label: 'Yes' }] },
      decisionCase: ['The migration completed cleanly.']
    });
    const html = renderSummaryLine(s);
    assert.ok(!html.includes('obs-summary-waiting'), 'no "waiting on you" line at all when the session is not waiting');
    assert.ok(!html.includes('obs-summary-decision-excerpt'), 'no excerpt markup');
    assert.ok(!html.includes('obs-summary-decision-options'), 'no options markup');
    assert.ok(!html.includes('The migration completed cleanly.'), 'the case text itself must not leak into the card anywhere');
    assert.ok(!html.includes('Ship it?'), 'the question text itself must not leak into the card anywhere');
  });
});

// LIN-2243: worker-lane ticket-walk seam. Read off `runs[]`, never the
// session-level field, because session-level telemetry is inert on this lean
// feed (same pre-existing gap as resources/model) — see routes/dashboard.js
// and its dashboard-routes.test.js precedent this ticket follows.
test.describe('laneTicketWalk / ticketProgressText (LIN-2243)', () => {
  test('laneTicketWalk finds the first run carrying a non-empty ticketWalk', () => {
    const s = { runs: [{ ticketWalk: null }, { ticketWalk: [{ identifier: 'LIN-1', state: 'done' }] }] };
    assert.deepEqual(laneTicketWalk(s), [{ identifier: 'LIN-1', state: 'done' }]);
  });

  test('laneTicketWalk returns null for a non-lane session (no run carries one)', () => {
    assert.equal(laneTicketWalk({ runs: [{ ticketWalk: null }] }), null);
    assert.equal(laneTicketWalk({ runs: [] }), null);
  });

  test('ticketProgressText says "so far", never "of M" — the wire has no planned total', () => {
    const walk = [
      { identifier: 'LIN-1', state: 'done' },
      { identifier: 'LIN-2', state: 'blocked' },
    ];
    const text = ticketProgressText(walk);
    assert.match(text, /ticket 2 so far/);
    assert.match(text, /LIN-2 blocked/);
    assert.ok(!/of \d/.test(text), 'must never claim a planned total ("of M")');
  });

  test('ticketProgressText returns empty string for an empty/absent walk', () => {
    assert.equal(ticketProgressText(null), '');
    assert.equal(ticketProgressText([]), '');
  });
});
