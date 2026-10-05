/**
 * LIN-3312 (Phase 2 of LIN-2950, S5b) — `renderSessionPage(…, {guest: true})`.
 *
 * Run with: node --test tests/unit/render-session-guest.test.js
 *
 * The guest render is the run page a share-link holder sees. It must emit
 * only testids from the plan's literal 66-id allow-set (the C1 bound), none of
 * the owner-only testids or attributes (asserted by name), exactly one
 * `<script>` (the theme pre-paint), the PR link for every one-PR state and
 * never for no-PR/several-PRs, no cost wording (N2), `noindex` (N5), per-source
 * "as of" stamps that are the PR read's `fetchedAt`, not the capture time, and
 * the same ledger markers as the owner page (F1). A live session passed with
 * `guest:true` renders exactly as its stub, and the page's clock is
 * `capturedAt`, never `Date.now()`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../../lib/render-session.js';
import { renderEvidence } from '../../lib/render-run-evidence.js';
import { buildGuestRunProjection, guestParagraphKey } from '../../lib/guest-run.js';
import { sessionSettleState, enrichLoop } from '../../routes/dashboard.js';
import {
  liveSession, evidenceModel, prRead,
  URL_KEY, CAPTURED_AT, FETCHED_AT_MS, SENTINELS,
} from '../fixtures/guest-run-fixtures.js';

const DEPS = { sessionSettleState, enrichLoop };
const FETCHED_ISO = new Date(FETCHED_AT_MS).toISOString();

/** The plan's literal guest testid allow-set (LIN-2950 rev 2, "The guest data-testid allow-set"). */
const ALLOW_SET = new Set([
  // Page and header (19)
  'session-page', 'session-title', 'session-run-id', 'session-progress', 'session-next',
  'session-active-time', 'session-elapsed', 'session-tiers', 'session-seed', 'session-seed-title',
  'session-tasks', 'session-task', 'session-pr-state', 'session-pr-line', 'session-pr-link',
  'session-guest-asof', 'session-paragraph', 'session-paragraph-text', 'share-stale',
  // Evidence (31)
  'run-evidence', 'run-evidence-asked', 'run-evidence-asked-empty', 'run-evidence-done',
  'run-evidence-done-empty', 'run-evidence-checked', 'run-evidence-checked-review',
  'run-evidence-checked-review-verdict', 'run-evidence-checked-review-ci', 'run-evidence-checked-review-meta',
  'run-evidence-checked-review-empty', 'run-evidence-checked-now', 'run-evidence-checked-now-state',
  'run-evidence-checked-now-sha', 'run-evidence-checked-now-asof', 'run-evidence-checks-link',
  'run-evidence-head-moved', 'run-evidence-not-checked', 'run-evidence-ledger', 'run-evidence-ledger-summary',
  'run-evidence-ledger-none', 'run-evidence-ledger-empty', 'run-evidence-ledger-raw', 'run-evidence-ledger-items',
  'run-evidence-ledger-item', 'run-evidence-ledger-id', 'run-evidence-ledger-discharge',
  'run-evidence-ledger-discharged-by', 'run-evidence-ledger-followup', 'run-evidence-ledger-open-at-merge',
  'run-evidence-ledger-open-no-followup',
  // Steps (16)
  'session-step', 'session-step-summary', 'session-lineage', 'session-run', 'session-run-head',
  'session-run-ident', 'session-run-status', 'session-run-dispatched', 'session-run-completed',
  'session-run-elapsed', 'session-run-runtime', 'session-run-model', 'session-ticket-walk',
  'session-ticket-row', 'session-ticket-ident', 'session-ticket-status',
]);

/** Absent by name (the plan's list; `*` entries are prefixes). */
const ABSENT_TESTIDS = [
  'session-brief', 'session-recap', 'session-back', 'session-run-chat', 'session-cost', 'session-credential',
  'session-run-credential', 'session-run-cost', 'session-run-metrics', 'session-run-artifacts',
  'session-run-resources', 'session-run-parked-flag', 'session-run-waiting-flag', 'session-waiting-clock',
  'session-run-toggle', 'session-run-body', 'session-run-transcript', 'session-ticket-outcome',
  'session-context-empty', 'session-not-found',
];
const ABSENT_TESTID_PREFIXES = [
  'session-inline-reply', 'session-proposal', 'session-question-card', 'session-ctx-', 'session-recap-',
  'run-evidence-closeout',
];
const ABSENT_FRAGMENTS = [
  'data-loop-id', 'data-lineage-id', 'data-dispatched-at', 'data-start', 'data-end', 'data-since',
  'data-url-key', 'data-pr-state-url', 'data-run-live', 'data-feedback', 'role="button"', 'tabindex',
  'aria-expanded', '<button', '<form', '<textarea', '<input', '<script src',
];

function projection(overrides = {}) {
  const session = overrides.session || liveSession();
  return buildGuestRunProjection({
    session,
    runEvidence: evidenceModel(),
    prRead: prRead(),
    paragraph: { paragraph: 'The run shipped the share link.', inputHash: guestParagraphKey(session), final: true },
    urlKey: URL_KEY,
    capturedAt: CAPTURED_AT,
    ...overrides,
  }, DEPS);
}

/** The guest data object a projection renders from (what renderGuestRunPage passes). */
function guestData(p, extra = {}) {
  return {
    session: p.session,
    runEvidence: p.runEvidence,
    runParagraph: p.runParagraph,
    prState: p.prState,
    prRef: p.prRef,
    sessionTerminal: p.settled,
    capturedAt: p.capturedAt,
    ...extra,
  };
}

function render(p = projection(), extra = {}) {
  return renderSessionPage(guestData(p, extra), { guest: true });
}

function testids(html) {
  return [...html.matchAll(/data-testid="([^"]+)"/g)].map(m => m[1]);
}

/** One `<li … data-testid="run-evidence-ledger-item" …>…</li>` per item, keyed by its ledger id. */
function ledgerItems(html) {
  const items = {};
  for (const m of html.matchAll(/<li class="rev-ledger-item"[\s\S]*?<\/li>/g)) {
    const id = /data-testid="run-evidence-ledger-id">([^<]+)</.exec(m[0]);
    items[id ? id[1] : '?'] = m[0];
  }
  return items;
}

describe('guest render: the C1 allow-set', () => {
  test('the allow-set is the plan\'s literal 66', () => {
    assert.equal(ALLOW_SET.size, 66);
  });

  test('every emitted testid is in the allow-set — across settled, running, stale and PR-state fixtures', () => {
    const running = liveSession();
    running.loops[2] = { ...running.loops[2], agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null };
    const unparsed = evidenceModel({ body: '## Review\n\n### What CI Did Not Prove\nsome prose\n\n**Verdict: Approve**' });
    const variants = [
      render(),
      render(projection({ session: running })),
      render(projection(), { stale: true, snapshotAt: CAPTURED_AT }),
      render(projection({ runEvidence: evidenceModel({ pr: 'none' }), prRead: null })),
      render(projection({ runEvidence: evidenceModel({ pr: 'multiple' }), prRead: null })),
      render(projection({ runEvidence: unparsed })),
      render(projection({ runEvidence: null, prRead: null, paragraph: null })),
    ];
    const seen = new Set();
    for (const html of variants) {
      for (const id of testids(html)) {
        assert.ok(ALLOW_SET.has(id), `testid ${id} is outside the guest allow-set`);
        seen.add(id);
      }
    }
    assert.ok(seen.size >= 45, `the fixtures exercise most of the allow-set (saw ${seen.size})`);
  });
});

describe('guest render: absent by name', () => {
  // A fixture where the OWNER page would emit every owner-only member, so
  // absence in guest is a real suppression, not a missing input.
  function ownerRich() {
    const session = liveSession();
    session.loops[2] = { ...session.loops[2], agentState: 'running', terminalStatus: null, terminalCompletedAt: null };
    return session;
  }

  test('the owner render of the same session does emit the members the guest drops', () => {
    const owner = renderSessionPage({
      session: ownerRich(), urlKey: URL_KEY, canReply: true, credentialByToken: {},
      proposals: [{ id: 'p', stepLoopId: 'w1', prompt: 'x', status: 'proposed' }],
      issueContext: [{ issueIdentifier: 'LIN-900', brief: 'b', recap: null }],
      decisions: [{ decision: { question: 'q?' }, anchor: { loopId: 'w2' }, disposition: 'resumable' }],
      runEvidence: evidenceModel(),
    }, { now: CAPTURED_AT });
    for (const id of ['session-back', 'session-run-chat', 'session-credential', 'session-run-credential', 'session-run-metrics',
      'session-run-artifacts', 'session-run-resources', 'session-run-toggle', 'session-run-transcript', 'session-ticket-outcome',
      'session-brief', 'session-recap', 'session-inline-reply', 'session-proposal', 'session-question-card', 'run-evidence-closeout']) {
      assert.ok(owner.includes(`data-testid="${id}`), `owner fixture emits ${id}`);
    }
    for (const frag of ['data-loop-id', 'data-lineage-id', 'data-dispatched-at', 'data-url-key', 'role="button"', '<script src']) {
      assert.ok(owner.includes(frag), `owner fixture emits ${frag}`);
    }
  });

  test('none of the absent testids, prefixes or attributes appear in guest', () => {
    const html = render(projection({ session: ownerRich() }));
    for (const id of ABSENT_TESTIDS) assert.ok(!html.includes(`data-testid="${id}"`), `${id} present`);
    for (const prefix of ABSENT_TESTID_PREFIXES) assert.ok(!html.includes(`data-testid="${prefix}`), `${prefix}* present`);
    for (const frag of ABSENT_FRAGMENTS) assert.ok(!html.includes(frag), `${frag} present`);
  });

  test('R1: <main class="sess-page"> carries no data-url-key attribute at all', () => {
    const main = /<main[^>]*>/.exec(render())[0];
    assert.equal(main, '<main class="sess-page" data-testid="session-page">');
  });

  test('exactly one <script>, the inline theme pre-paint', () => {
    const html = render();
    const scripts = html.match(/<script/g) || [];
    assert.equal(scripts.length, 1);
    assert.match(html, /<script>\(function\(\)\{try\{var m=\/\(\?:\^\|;\\s\*\)theme=/);
  });

  test('no nav, no footer, only /style.css and /session.css, noindex meta (N5)', () => {
    const html = render();
    assert.ok(!html.includes('<nav'), 'no nav');
    assert.ok(!html.includes('<footer'), 'no footer');
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => m[1]);
    assert.deepEqual(sheets, ['/style.css', '/session.css']);
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
  });

  test('no planted forbidden value reaches the HTML (peakRSS hidden, PROVISIONAL #1)', () => {
    const html = render(projection({ session: ownerRich() }));
    for (const [name, value] of Object.entries(SENTINELS)) assert.ok(!html.includes(value), `${name} leaked`);
    assert.ok(!html.includes('512 MB'), 'no peak RSS');
    assert.ok(!html.includes('heartbeats'), 'no heartbeat chip');
    assert.ok(!html.includes('credential'), 'no credential wording');
    assert.ok(!html.includes(URL_KEY + '/'), 'no workspace path');
  });
});

describe('guest render: what is shown', () => {
  test('runtime, tier, ticket identifier + state, active time, wall clock, seed, tasks, paragraph', () => {
    const html = render();
    assert.match(html, /data-testid="session-run-runtime">⏱ 120s</);
    assert.match(html, /data-testid="session-run-model" data-tier="premium">◇ premium</);
    assert.match(html, /data-testid="session-ticket-ident">LIN-901</);
    assert.match(html, /data-testid="session-ticket-status"><span class="status-pill__dot" aria-hidden="true"><\/span>done</);
    assert.match(html, /data-testid="session-active-time">6m</);
    assert.match(html, /data-testid="session-elapsed">9m</);
    assert.match(html, /data-testid="session-seed">LIN-900<\/span><span class="sess-seed-title" data-testid="session-seed-title">Ship the share link</);
    assert.match(html, /data-testid="session-task">LIN-901</);
    assert.match(html, /data-testid="session-paragraph-text">The run shipped the share link\.</);
    assert.match(html, /<div class="sess-run-head" data-testid="session-run-head">/);
    assert.match(html, /data-testid="session-lineage">/);
  });

  test('a running loop keeps its "in progress" text without the clock attribute', () => {
    const running = liveSession();
    running.loops[2] = { ...running.loops[2], agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null };
    const html = render(projection({ session: running }));
    assert.match(html, /<span data-testid="session-run-elapsed">in progress<\/span>/);
  });

  test('N2: no cost wording in step or run text (the owner page has it)', () => {
    const owner = renderSessionPage({ session: liveSession(), urlKey: URL_KEY }, { now: CAPTURED_AT });
    assert.ok(owner.includes('$'), 'the owner fixture is priced');
    const html = render();
    const steps = [...html.matchAll(/data-testid="session-step-summary">([^<]*)</g)].map(m => m[1]);
    assert.ok(steps.length >= 2);
    for (const text of steps) {
      assert.ok(!text.includes('not reported'), text);
    }
    for (const word of ['$', 'as reported', 'included in the step total', '· not reported', 'cost']) {
      assert.ok(!html.includes(word), `"${word}" present`);
    }
  });

  test('the unsettled page says it updates; the settled one does not', () => {
    assert.match(render(), /data-testid="session-guest-asof">As of 2026-07-04T11:00:00\.000Z</);
    assert.ok(!render().includes('updates while the run is in progress'));
    const running = liveSession();
    running.loops[2] = { ...running.loops[2], agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null };
    assert.match(render(projection({ session: running })), /As of 2026-07-04T11:00:00\.000Z · updates while the run is in progress/);
  });

  test('stale: the share-stale "as of" line uses snapshotAt; absent when fresh', () => {
    const html = render(projection(), { stale: true, snapshotAt: '2026-07-04T10:45:00.000Z' });
    assert.match(html, /<p class="share-stale" data-testid="share-stale">as of 2026-07-04T10:45:00\.000Z<\/p>/);
    assert.ok(!render().includes('share-stale'));
  });
});

describe('guest render: the PR link and its stamps', () => {
  const LINK = '<a class="sess-pr-link" data-testid="session-pr-link" href="https://github.com/o/r/pull/12" target="_blank" rel="noopener noreferrer">PR #12 ↗</a>';
  const cases = [
    ['open', { readable: true, state: 'open', number: 12, checks: [] }, 'fresh'],
    ['merged', { readable: true, state: 'closed', merged: true, number: 12, checks: [] }, 'fresh'],
    ['closed', { readable: true, state: 'closed', merged: false, number: 12, checks: [] }, 'fresh'],
    ['unknown (readable:false)', { readable: false }, 'fresh'],
  ];
  for (const [name, result, via] of cases) {
    test(`${name}: the link is present with the exact href, target and rel`, () => {
      const html = render(projection({ runEvidence: evidenceModel({ prStatus: result }), prRead: prRead({ result, via }) }));
      assert.ok(html.includes(LINK), html.match(/<div class="sess-pr-state"[\s\S]*?<\/div>/)?.[0]);
    });
  }

  test('budget exhausted (nothing read): the link is present, "not reported", no stamp, no checks ↗', () => {
    const p = projection({ runEvidence: evidenceModel({ prStatus: null }), prRead: { result: null, fetchedAt: null, via: 'unavailable' } });
    const html = render(p);
    assert.ok(html.includes(LINK));
    assert.match(html, /data-testid="session-pr-line">PR #12: state not reported\.</);
    assert.ok(!html.includes('sess-pr-asof'), 'nothing read → no stamp');
    assert.ok(!html.includes('run-evidence-checks-link'), 'no checks ↗ link');
    assert.ok(!html.includes('run-evidence-checked-now-asof'));
  });

  test('absent for no PR and for several PRs', () => {
    const none = render(projection({ runEvidence: evidenceModel({ pr: 'none' }), prRead: null }));
    assert.ok(!none.includes('session-pr-link'));
    assert.match(none, /data-testid="session-pr-line">No pull request yet\.</);
    const multiple = render(projection({ runEvidence: evidenceModel({ pr: 'multiple' }), prRead: null }));
    assert.ok(!multiple.includes('session-pr-link'));
    assert.match(multiple, /data-testid="session-pr-line">Pull request state not reported\.</);
  });

  test('an invalid stored ref renders no link', () => {
    const p = projection();
    for (const prRef of [{ repo: 'o/r/x', number: 12 }, { repo: 'o/r', number: '12' }, { repo: 'javascript:alert(1)//x', number: 1 }]) {
      assert.ok(!render({ ...p, prRef }).includes('session-pr-link'), JSON.stringify(prRef));
    }
  });

  test('the PR line and the now row carry the read\'s fetchedAt, not capturedAt', () => {
    const html = render();
    assert.notEqual(FETCHED_ISO, CAPTURED_AT);
    const line = /<div class="sess-pr-state"[\s\S]*?<\/div>/.exec(html)[0];
    assert.ok(line.includes(`<span class="sess-pr-asof">as of ${FETCHED_ISO}</span>`), line);
    assert.ok(!line.includes(CAPTURED_AT));
    assert.ok(html.includes(`<span class="rev-now-asof" data-testid="run-evidence-checked-now-asof">as of ${FETCHED_ISO}</span>`));
  });
});

describe('F1: the ledger markers render as on the owner page', () => {
  test('merged PR: open items show open-at-merge (+ no-follow-up for an inside item with none); discharged shows neither', () => {
    const model = evidenceModel();
    const guestItems = ledgerItems(render());
    const ownerItems = ledgerItems(renderEvidence(model));
    assert.deepEqual(Object.keys(guestItems), ['L1', 'L2', 'L3']);
    for (const id of ['L1', 'L2', 'L3']) assert.equal(guestItems[id], ownerItems[id], `${id} identical to the owner render`);
    assert.ok(guestItems.L1.includes('run-evidence-ledger-open-at-merge'));
    assert.ok(guestItems.L1.includes('run-evidence-ledger-open-no-followup'));
    assert.ok(guestItems.L2.includes('run-evidence-ledger-open-at-merge'));
    assert.ok(!guestItems.L2.includes('run-evidence-ledger-open-no-followup'), 'outside scope with a follow-up');
    assert.ok(!guestItems.L3.includes('open-at-merge'), 'discharged');
    assert.ok(!guestItems.L3.includes('open-no-followup'), 'discharged');
  });

  test('the whole ledger section is byte-identical to the owner render of the same model', () => {
    const section = html => /<details class="rev-ledger"[\s\S]*?<\/details>/.exec(html)[0];
    assert.equal(section(render()), section(renderEvidence(evidenceModel())));
  });

  test('an open PR shows no open-at-merge markers', () => {
    const open = { readable: true, state: 'open', number: 12, checks: [] };
    const html = render(projection({ runEvidence: evidenceModel({ prStatus: open }), prRead: prRead({ result: open }) }));
    assert.ok(!html.includes('open-at-merge'));
  });
});

describe('guest render: one path, one clock', () => {
  test('a live session with guest:true renders identically to its stub', () => {
    const p = projection();
    assert.equal(render(p, { session: liveSession() }), render(p));
  });

  test('the live session is cut before the first read (Date timestamps, odd types)', () => {
    // The stub normalises what the renderer's own gates cannot: a Mongo-shaped
    // live session carries Date objects, which an uncut read would print as
    // `Sat Jul 04 2026 …` while the stub prints ISO.
    const live = liveSession();
    live.loops = live.loops.map(l => ({ ...l, dispatchedAt: new Date(l.dispatchedAt), terminalCompletedAt: new Date(l.terminalCompletedAt) }));
    live.loops[1].issueTitle = { toString: () => 'OBJECT-TITLE' };
    const p = projection();
    const html = render(p, { session: live });
    assert.equal(html, render({ ...p, session: projection({ session: live }).session }));
    assert.ok(html.includes('dispatched 2026-07-04T10:01:00.000Z'), 'ISO, from the cut');
    assert.ok(!/dispatched [A-Z][a-z]{2} [A-Z][a-z]{2} /.test(html), 'never Date#toString');
    assert.ok(!html.includes('OBJECT-TITLE'), 'a non-string title is dropped, not stringified');
  });

  test('owner-only inputs passed to a guest render are ignored', () => {
    const p = projection();
    const noisy = render(p, {
      urlKey: URL_KEY, canReply: true, waiting: true, waitingMessage: 'answer me',
      decisions: [{ decision: { question: 'q?' }, anchor: { loopId: 'w2' } }],
      proposals: [{ id: 'p', prompt: SENTINELS.proposal }], issueContext: [{ issueIdentifier: 'LIN-900', brief: 'b' }],
      credentialByToken: { x: 'dead' }, producer: { loopId: 'w2' }, runView: { bogus: true }, anchorIssueTitle: 'Other title',
    });
    assert.equal(noisy, render(p));
  });

  test('now = capturedAt: an open run\'s wall clock is measured to the capture time, never Date.now()', () => {
    const open = liveSession({ completedAt: null });
    open.loops[2] = { ...open.loops[2], agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null };
    const p = projection({ session: open });
    const realNow = Date.now;
    let html;
    try {
      Date.now = () => { throw new Error('the guest render read Date.now()'); };
      html = render(p);
    } finally {
      Date.now = realNow;
    }
    assert.match(html, /data-testid="session-elapsed">1h</, 'T0 → capturedAt is one hour');
  });

  test('the guest prState is cut to {state, number, checks, asOf}; a Date stamp renders as ISO', () => {
    const p = projection();
    const html = render({ ...p, prState: { ...p.prState, asOf: new Date(FETCHED_AT_MS), url: 'https://evil.example', message: 'x' } });
    assert.equal(html, render(p));
  });

  test('a guest render with no session, or no capture time, throws', () => {
    const p = projection();
    assert.throws(() => renderSessionPage({ ...guestData(p), session: null }, { guest: true }), /needs a session/);
    assert.throws(() => renderSessionPage({ ...guestData(p), capturedAt: null }, { guest: true }), /needs capturedAt/);
  });

  test('without guest:true the page is the owner page (data-url-key, scripts, nav)', () => {
    const html = renderSessionPage({ session: liveSession(), urlKey: URL_KEY }, { now: CAPTURED_AT });
    assert.match(html, /<main class="sess-page" data-url-key="acme" data-testid="session-page">/);
    assert.ok(html.includes('<script src="/session.js"></script>'));
  });
});
