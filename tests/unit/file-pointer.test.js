/**
 * Unit tests for the LIN-3200 file-pointer pure core.
 *
 * Covers P1: plan-block extraction (prefix headings, last match wins), the
 * render bound, PR-file dedupe/cap, the arm selector, idempotent prepend, the
 * derived timing constants, and classifyPilotRows' recompute + race-suspect
 * rule (both clauses, boundaries, non-eligible bystanders, symmetric exclusion).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNT_TIMEOUT_MS,
  PLAN_READ_TIMEOUT_MS,
  POINTER_STEP_TIMEOUT_MS,
  HOP_ALLOWANCE_MS,
  SKEW_SLACK_MS,
  RACE_SUSPECT_WINDOW_MS,
  DEFAULT_MAX_ENTRIES,
  FILE_POINTER_MARKER,
  buildFilePointer,
  extractPlanSection,
  extractPlanPaths,
  isRenderablePath,
  isRenderableRepo,
  prependFilePointer,
  selectPilotArm,
  isPilotEligible,
  classifyPilotRows
} from '../../lib/file-pointer.js';

describe('file-pointer — timing constants', () => {
  test('every cap is a positive integer', () => {
    for (const v of [COUNT_TIMEOUT_MS, PLAN_READ_TIMEOUT_MS, POINTER_STEP_TIMEOUT_MS, HOP_ALLOWANCE_MS, SKEW_SLACK_MS]) {
      assert.ok(Number.isInteger(v) && v > 0, `expected positive integer, got ${v}`);
    }
  });

  test('RACE_SUSPECT_WINDOW_MS is DERIVED as the sum, not hard-coded', () => {
    assert.ok(
      RACE_SUSPECT_WINDOW_MS >= COUNT_TIMEOUT_MS + HOP_ALLOWANCE_MS + SKEW_SLACK_MS,
      'raising a timeout without the window must go red'
    );
  });
});

describe('file-pointer — render bound', () => {
  test('accepts repo-relative paths with an extension', () => {
    for (const p of ['lib/foo.js', 'routes/a/b.c.ts', 'package.json', 'docs/x-y_z.md']) {
      assert.equal(isRenderablePath(p), true, p);
    }
  });

  test('rejects injected and non-path input', () => {
    const bad = [
      'lib/foo\n.js',
      'lib/foo\t.js',
      'lib/foo\u0000.js',
      'lib/../etc/passwd.js',
      '../secret.js',
      '/absolute/path.js',
      'https://github.com/x/y.js',
      'a'.repeat(201) + '.js',
      'lib/caf\u00e9.js',
      'noextension',
      '',
      'lib//double.js'
    ];
    for (const p of bad) {
      assert.equal(isRenderablePath(p), false, JSON.stringify(p));
    }
  });

  test('rejects non-string and invalid repo names', () => {
    assert.equal(isRenderablePath(null), false);
    assert.equal(isRenderablePath(42), false);
    assert.equal(isRenderableRepo('LinearViewer'), true);
    assert.equal(isRenderableRepo('evil/repo'), false);
    assert.equal(isRenderableRepo(''), false);
  });
});

describe('file-pointer — plan-block extraction', () => {
  test('matches the heading by prefix and takes the section to the next heading', () => {
    const text = [
      'Intro',
      '## Implementation Plan',
      'Touch lib/foo.js and routes/bar.js:12.',
      '## Next Section',
      'Ignore lib/ignored.js'
    ].join('\n');
    const section = extractPlanSection(text);
    assert.match(section, /lib\/foo\.js/);
    assert.doesNotMatch(section, /ignored/);
  });

  test('suffix headings are matched and the LAST match wins', () => {
    const text = [
      '## Implementation Plan (2026-09-29, revision 2)',
      'old: lib/old.js',
      '## Implementation Plan (T3 build, narrowed)',
      'new: lib/new.js'
    ].join('\n');
    const paths = extractPlanPaths(text);
    assert.deepEqual(paths, ['lib/new.js']);
  });

  test('this ticket-style suffix is matched', () => {
    const paths = extractPlanPaths('## Implementation Plan (LIN-3200 plan pass 4, Strategy C)\nlib/file-pointer.js');
    assert.deepEqual(paths, ['lib/file-pointer.js']);
  });

  test('line references are stripped; URLs and absolute paths excluded; deduped by builder', () => {
    const planBlock = [
      '## Implementation Plan',
      'See `lib/dispatch-store.js:358` and lib/dispatch-store.js:1017-1092.',
      'URL https://example.com/remote.js and absolute /etc/passwd.js.',
      'A bare word without extension.'
    ].join('\n');
    assert.deepEqual(extractPlanPaths(planBlock), ['lib/dispatch-store.js']);
    const built = buildFilePointer({ planBlock });
    assert.deepEqual(built.planPaths, ['lib/dispatch-store.js']);
  });

  test('null/empty input yields no section and no pointer', () => {
    assert.equal(extractPlanSection(null), null);
    assert.equal(extractPlanSection(''), null);
    assert.equal(buildFilePointer({ planBlock: null, prFiles: [] }), null);
    assert.equal(buildFilePointer({}), null);
  });
});

describe('file-pointer — PR files and builder', () => {
  test('dedupes on (repo, path), preserves newest-first order, drops invalid', () => {
    const built = buildFilePointer({
      planBlock: null,
      prFiles: [
        { repo: 'LinearViewer', path: 'lib/a.js' },
        { repo: 'LinearViewer', path: 'lib/a.js' },
        { repo: 'LinearViewer', path: 'lib/new.js' },
        { repo: 'evil/repo', path: 'lib/b.js' },
        { repo: 'LinearViewer', path: '/abs.js' },
        { repo: 'LinearViewer', path: 'lib/c.js' }
      ]
    });
    assert.deepEqual(built.prFiles, [
      { repo: 'LinearViewer', path: 'lib/a.js' },
      { repo: 'LinearViewer', path: 'lib/new.js' },
      { repo: 'LinearViewer', path: 'lib/c.js' }
    ]);
    assert.match(built.text, /^- lib\/a\.js$/m);
  });

  test('caps entries and dedupes across plan + PR sources', () => {
    const built = buildFilePointer({
      planBlock: '## Implementation Plan\nlib/shared.js\nlib/plan1.js\nlib/plan2.js',
      prFiles: [
        { repo: 'LinearViewer', path: 'lib/shared.js' },
        { repo: 'LinearViewer', path: 'lib/pr.js' }
      ],
      maxEntries: 3
    });
    // shared appears once (plan), then plan1, plan2 => cap 3.
    assert.deepEqual(built.planPaths.slice(0, 3), ['lib/shared.js', 'lib/plan1.js', 'lib/plan2.js']);
    const lines = built.text.split('\n').filter(l => l.startsWith('- '));
    assert.deepEqual(lines, ['- lib/shared.js', '- lib/plan1.js', '- lib/plan2.js']);
  });

  test('default cap is applied and the text carries the marker and no tracker name', () => {
    const built = buildFilePointer({
      planBlock: '## Implementation Plan\n' + Array.from({ length: DEFAULT_MAX_ENTRIES + 5 }, (_, i) => `lib/f${i}.js`).join('\n')
    });
    const lines = built.text.split('\n').filter(l => l.startsWith('- '));
    assert.equal(lines.length, DEFAULT_MAX_ENTRIES);
    assert.ok(built.text.startsWith(FILE_POINTER_MARKER));
    assert.doesNotMatch(built.text, /\bLinear\b/);
  });
});

describe('file-pointer — arm selector and prepend', () => {
  test('even → pointer, odd → control, missing → control', () => {
    const table = [[0, 'pointer'], [1, 'control'], [2, 'pointer'], [3, 'control'], [10, 'pointer'], [11, 'control']];
    for (const [ordinal, arm] of table) assert.equal(selectPilotArm({ ordinal }), arm);
    assert.equal(selectPilotArm({}), 'control');
    assert.equal(selectPilotArm({ ordinal: null }), 'control');
    assert.equal(selectPilotArm({ ordinal: 1.5 }), 'control');
  });

  test('prepend puts the pointer at the top and is idempotent on the marker', () => {
    const pointer = buildFilePointer({ planBlock: '## Implementation Plan\nlib/x.js' }).text;
    const once = prependFilePointer('BODY', pointer);
    assert.ok(once.startsWith(FILE_POINTER_MARKER));
    assert.ok(once.endsWith('BODY'));
    const twice = prependFilePointer(once, pointer);
    assert.equal(twice, once);
    assert.equal(prependFilePointer('BODY', null), 'BODY');
    assert.equal(prependFilePointer('BODY', ''), 'BODY');
  });
});

describe('file-pointer — classifyPilotRows', () => {
  const row = (id, offsetMs, extra = {}) => ({
    id,
    kind: 'implementation',
    followUpTo: null,
    abort: false,
    issueIdentifier: 'LIN-3000',
    dispatchedAt: new Date(1_000_000 + offsetMs).toISOString(),
    delivered: false,
    ...extra
  });

  test('clause (i): dispatchedAt boundaries at W', () => {
    const W = RACE_SUSPECT_WINDOW_MS;
    const base = { id: 'x', kind: 'implementation', followUpTo: null, abort: false, issueIdentifier: 'LIN-1' };
    for (const delta of [W - 1, W, W + 1]) {
      const rows = [
        { ...base, id: 'a', dispatchedAt: new Date(0).toISOString() },
        { ...base, id: 'b', dispatchedAt: new Date(delta).toISOString() }
      ];
      const result = classifyPilotRows(rows);
      const a = result.rows.find(r => r.id === 'a');
      assert.equal(a.raceSuspect, delta <= W, `delta ${delta}`);
    }
  });

  test('clause (ii): resolvedAt boundary flags the other row', () => {
    const W = RACE_SUSPECT_WINDOW_MS;
    const base = { kind: 'implementation', followUpTo: null, abort: false, issueIdentifier: 'LIN-1' };
    for (const delta of [W - 1, W, W + 1]) {
      const rows = [
        { ...base, id: 'x', dispatchedAt: new Date(10 * W).toISOString() },
        { ...base, id: 'y', dispatchedAt: new Date(0).toISOString(), resolvedAt: new Date(10 * W - delta).toISOString() }
      ];
      const result = classifyPilotRows(rows);
      const x = result.rows.find(r => r.id === 'x');
      assert.equal(x.raceSuspect, delta <= W, `delta ${delta}`);
    }
  });

  test('a non-eligible bystander (follow-up, abort, no issue, other kind) does not flag', () => {
    const base = { dispatchedAt: new Date(0).toISOString() };
    const rows = [
      { id: 'x', kind: 'implementation', followUpTo: null, abort: false, issueIdentifier: 'LIN-1', ...base },
      { id: 'f', kind: 'implementation', followUpTo: 'p', abort: false, issueIdentifier: 'LIN-1', ...base },
      { id: 'a', kind: 'implementation', followUpTo: null, abort: true, issueIdentifier: 'LIN-1', ...base },
      { id: 'n', kind: 'implementation', followUpTo: null, abort: false, issueIdentifier: null, ...base },
      { id: 'k', kind: 'review', followUpTo: null, abort: false, issueIdentifier: 'LIN-1', ...base }
    ];
    const result = classifyPilotRows(rows);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].raceSuspect, false);
    assert.equal(isPilotEligible(rows[0]), true);
  });

  test('suspects are excluded from the primary comparison in BOTH arms, even when marked', () => {
    // 0 and 1 dispatched together (both suspects), 2 alone (control, non-suspect).
    const rows = [
      row('a', 0, { delivered: true }),
      row('b', 1, { delivered: true }),
      row('c', 10_000)
    ];
    const result = classifyPilotRows(rows);
    assert.equal(result.totals.raceSuspect, 2);
    // b (position 1, control) is a suspect and must NOT count as delivered.
    assert.equal(result.totals.control.assigned, 0);
    assert.equal(result.totals.control.delivered, 0);
    assert.equal(result.totals.control.excluded, 1);
    // c is position 2 => pointer, non-suspect, not delivered.
    assert.equal(result.totals.pointer.assigned, 1);
    assert.equal(result.totals.pointer.delivered, 0);
    assert.equal(result.totals.pointer.assignedEmpty, 1);
  });

  test('parity recompute handles ties on dispatchedAt by _id', () => {
    const rows = [
      row('b', 0),
      row('a', 0),
      row('c', 5000, { resolvedAt: new Date(0).toISOString() })
    ];
    const result = classifyPilotRows(rows);
    assert.deepEqual(result.rows.map(r => r.id), ['a', 'b', 'c']);
    assert.deepEqual(result.rows.map(r => r.arm), ['pointer', 'control', 'pointer']);
  });

  test('delivered/assignedEmpty tally and concerns', () => {
    const rows = [];
    for (let i = 0; i < 20; i++) rows.push(row(`r${i}`, i * 60_000, { delivered: i % 2 === 0 }));
    const result = classifyPilotRows(rows);
    assert.equal(result.totals.eligible, 20);
    assert.equal(result.totals.raceSuspect, 0);
    assert.equal(result.totals.pointer.assigned, 10);
    assert.equal(result.totals.control.assigned, 10);
    assert.equal(result.totals.pointer.assignedEmpty + result.totals.pointer.delivered, 10);
  });
});
