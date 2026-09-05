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
// `relativeTime` is likewise a browser global (`window.relativeTime`,
// common.js) that observation.js references bare — a faithful-enough stub for
// the seams under test here (LIN-2244): it only needs to be deterministic and
// take a timestamp, never the real "3m ago" formatting.
const relativeTime = (ts) => (ts ? `stub-relative-time(${ts})` : '');
const sandbox = {
  module: { exports: {} },
  window: { addEventListener() {} },
  document: { addEventListener() {} },
  escapeHtml,
  relativeTime,
  console,
};
vm.runInNewContext(src, sandbox, { filename: 'observation.js' });
const { renderActivityLog, renderArtifacts, classifyArtifact, renderObjective } = sandbox.module.exports;
const { renderSummaryLine, excerptDecisionCase, renderWaitingDecisionSummary, DECISION_EXCERPT_CHARS } = sandbox.module.exports;
const { boundDecisionOptions, DECISION_OPTIONS_CHARS } = sandbox.module.exports;
const { laneTicketWalk, ticketProgressText } = sandbox.module.exports;
const { sessionParkedWait } = sandbox.module.exports;

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

// LIN-2244: parked-wait seam, same read-off-runs[] reasoning as ticketWalk.
test.describe('sessionParkedWait / renderSummaryLine parked branch (LIN-2244)', () => {
  test('sessionParkedWait finds the first run carrying a non-null parkedWait', () => {
    const s = { runs: [{ parkedWait: null }, { parkedWait: { since: 't1', latest: 't2' } }] };
    assert.deepEqual(sessionParkedWait(s), { since: 't1', latest: 't2' });
  });

  test('sessionParkedWait returns null when no run is currently parked', () => {
    assert.equal(sessionParkedWait({ runs: [{ parkedWait: null }] }), null);
    assert.equal(sessionParkedWait({ runs: [] }), null);
  });

  test('renderSummaryLine renders the parked line, distinct from "waiting on you" and "working"', () => {
    const s = { stale: false, waiting: false, terminal: false, runs: [{ parkedWait: { since: 't1', latest: 't2' } }] };
    const html = renderSummaryLine(s);
    assert.match(html, /obs-summary-parked/);
    assert.match(html, /parked on a wait since stub-relative-time\(t1\)/);
    assert.ok(!html.includes('obs-summary-waiting'));
    assert.ok(!html.includes('working…'));
  });

  test('renderSummaryLine: "waiting on you" (blocked-on-a-human) wins over parked when both could apply', () => {
    const s = { stale: false, waiting: true, waitingMessage: null, terminal: false, decision: null, runs: [{ parkedWait: { since: 't1', latest: 't2' } }] };
    const html = renderSummaryLine(s);
    assert.match(html, /obs-summary-waiting/);
    assert.ok(!html.includes('obs-summary-parked'));
  });

  test('renderSummaryLine: no parked branch at all when no run is currently parked', () => {
    const s = { stale: false, waiting: false, terminal: false, statusLine: null, runs: [] };
    const html = renderSummaryLine(s);
    assert.ok(!html.includes('obs-summary-parked'));
  });
});

test.describe('boundDecisionOptions — LIN-2195: the option run carries a budget', () => {
  const label = (n, len = 10) => `${String(n).repeat(len)}`;
  // observation.js runs inside a vm sandbox, so arrays it returns are from
  // another realm and `deepStrictEqual` fails on prototype identity alone.
  // Copy into this realm before comparing structurally.
  const here = (arr) => Array.from(arr);

  test('a short run is rendered whole, with no overflow marker', () => {
    const { labels, overflow } = boundDecisionOptions(
      [{ label: 'ship it' }, { label: 'hold' }], DECISION_OPTIONS_CHARS
    );
    assert.deepEqual(here(labels), ['ship it', 'hold']);
    assert.equal(overflow, 0);
  });

  test('the RENDERED run — labels plus the "+N more" suffix — never exceeds the budget', () => {
    // The acceptance property. Three things this deliberately does that the
    // first version of it did not, each of which was hiding a real defect:
    //   - it measures what RENDERS, including the `+N more` suffix the caller
    //     appends. Measuring only `labels.join(' / ')` cannot see the suffix
    //     overrun at all (measured at +12 chars, 15%, before the fix).
    //   - label lengths VARY. The first version built every label with
    //     String(n).repeat(12), so every label was exactly 12 chars and the
    //     count=12 and count=40 cases were byte-identical — one non-trivial
    //     case wearing four hats.
    //   - it includes lengths that straddle the boundary, which is what kills
    //     the `>` vs `>=` mutant.
    const lengths = [1, 2, 3, 7, 11, 12, 19, 26, 37, 38, 39, 40, 41, 79, 80, 81, 200];
    // ASCII, an astral (2-unit) char, a 4-unit flag, and an 11-unit ZWJ family.
    // The budget counts UTF-16 units, so a truncation that counted CODE POINTS
    // instead rendered an astral label at ~2x the budget — and the two halves
    // of that bug (surrogate safety, budget arithmetic) were each covered
    // separately while their intersection was not.
    const alphabets = ['ascii', '👍', '🇬🇧', '👨‍👩‍👧‍👦'];
    for (const count of [1, 2, 3, 5, 12, 40, 400]) {
      for (const len of lengths) {
        for (const alpha of alphabets) {
        const unit = i => (alpha === 'ascii' ? String.fromCharCode(97 + (i % 26)) : alpha);
        const options = Array.from({ length: count }, (_, i) => ({ label: unit(i).repeat(len) }));
        const { labels, overflow } = boundDecisionOptions(options, DECISION_OPTIONS_CHARS);
        const rendered = labels.join(' / ') + (overflow > 0 ? ` +${overflow} more` : '');
        assert.ok(
          rendered.length <= DECISION_OPTIONS_CHARS,
          `count=${count} len=${len} alphabet=${alpha}: rendered ${rendered.length} UTF-16 units, over the ${DECISION_OPTIONS_CHARS} budget — ${JSON.stringify(rendered)}`
        );
        }
      }
    }
  });

  test('the boundary is exact — a run that exactly fills the budget keeps every label', () => {
    // Kills the `>` -> `>=` mutant, which the original suite could not see.
    // Two labels plus ' / ' land exactly on the budget once the (absent)
    // suffix reservation is accounted for.
    const { labels, overflow } = boundDecisionOptions(
      [{ label: 'a'.repeat(30) }, { label: 'b'.repeat(30) }], 63
    );
    assert.equal(labels.length, 2, '30 + 3 + 30 = 63 exactly fills a 63-char budget');
    assert.equal(overflow, 0);
  });

  test('one char more than the budget drops the second label', () => {
    const { labels, overflow } = boundDecisionOptions(
      [{ label: 'a'.repeat(30) }, { label: 'b'.repeat(31) }], 63
    );
    assert.equal(labels.length, 1);
    assert.equal(overflow, 1);
  });

  test('a truncated label stays INSIDE the budget, ellipsis included', () => {
    const { labels } = boundDecisionOptions([{ label: 'x'.repeat(500) }], DECISION_OPTIONS_CHARS);
    assert.ok(
      labels[0].length <= DECISION_OPTIONS_CHARS,
      `truncated to ${labels[0].length}, over the ${DECISION_OPTIONS_CHARS} budget`
    );
    assert.ok(labels[0].endsWith('…'));
  });

  test('truncation never splits a surrogate pair', () => {
    // A lone high surrogate paints as U+FFFD. Emoji in an option label are not
    // exotic, and visible garbage undermines the run's only job.
    const { labels } = boundDecisionOptions([{ label: '👍'.repeat(200) }], DECISION_OPTIONS_CHARS);
    assert.ok(!/[\uD800-\uDBFF]$/.test(labels[0].replace(/…$/, '')), 'no dangling high surrogate');
    assert.ok(!labels[0].includes('\uFFFD'));
  });

  test("the reviewer's measured case — 5 options — is bounded and reports the remainder", () => {
    // LIN-2195 recorded this exact shape at 7 lines on a 360px card.
    const options = [
      { label: 'Rebuild the index from scratch' },
      { label: 'Patch the existing index in place' },
      { label: 'Fall back to the previous snapshot' },
      { label: 'Escalate to the platform team' },
      { label: 'Do nothing for now' }
    ];
    const { labels, overflow } = boundDecisionOptions(options, DECISION_OPTIONS_CHARS);
    assert.ok(labels.length < options.length, 'the run is actually shortened');
    assert.equal(overflow, options.length - labels.length);
    assert.ok(labels.join(' / ').length <= DECISION_OPTIONS_CHARS);
  });

  test('labels are taken WHOLE — never cut mid-word — while any fit', () => {
    // An option cut mid-word reads as a rendering bug, and a half-word cannot
    // say what kind of choice is waiting, which is the run's whole job here.
    const options = [{ label: 'approve the rollout' }, { label: 'reject the rollout' }, { label: 'defer to Monday' }];
    const { labels } = boundDecisionOptions(options, DECISION_OPTIONS_CHARS);
    for (const l of labels) {
      assert.ok(options.some(o => o.label === l), `"${l}" is not a whole original label`);
    }
  });

  test('a single label longer than the whole budget is truncated rather than dropped', () => {
    // The one case where there is nothing to fall back to. Showing a truncated
    // option beats showing none, and beats a card sized by one long option.
    const { labels, overflow } = boundDecisionOptions([{ label: 'x'.repeat(200) }], DECISION_OPTIONS_CHARS);
    assert.equal(labels.length, 1);
    assert.ok(labels[0].endsWith('…'));
    assert.ok(labels[0].length <= DECISION_OPTIONS_CHARS, 'the ellipsis comes out of the budget, not on top of it');
    assert.equal(overflow, 0);
  });

  test('no options, a non-array, and blank labels all yield an empty run', () => {
    for (const input of [[], null, undefined, 'nonsense', [{}], [{ label: '' }], [{ label: {} }], [{ label: true }], [{ label: ['a', 'b'] }]]) {
      const { labels, overflow } = boundDecisionOptions(input, DECISION_OPTIONS_CHARS);
      assert.deepEqual(here(labels), []);
      assert.equal(overflow, 0);
    }
  });

  test('the rendered summary shows the overflow marker and escapes labels', () => {
    const html = renderWaitingDecisionSummary(
      {
        options: [
          { label: '<script>alert(1)</script>' },
          { label: 'a second option that is fairly long' },
          { label: 'a third option that is also long' },
          { label: 'a fourth' }
        ]
      },
      []
    );
    assert.ok(!html.includes('<script>'), 'agent-authored labels must stay escaped');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /\+\d+ more/, 'the remainder is reported rather than silently dropped');
  });

  test('a run that fits shows no "+N more" marker', () => {
    const html = renderWaitingDecisionSummary({ options: [{ label: 'yes' }, { label: 'no' }] }, []);
    assert.ok(!/\+\d+ more/.test(html));
    assert.match(html, /\[yes \/ no\]/);
  });
});
