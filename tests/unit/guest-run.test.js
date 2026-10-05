/**
 * LIN-3312 (Phase 2 of LIN-2950, S3) — the strict guest run projection.
 *
 * Run with: node --test tests/unit/guest-run.test.js
 *
 * The projection is the privacy boundary between an owner's live run and the
 * anonymous share page. These tests pin: the exact allow-set of stub and
 * projection keys; that no forbidden field survives (by key AND by planted
 * value); the workspace-key scrub; F1 (`closeOut` cut to `{status}`); R4
 * (`settledKey` built from the settle predicate's own loops); R5 (a matched
 * paragraph must be final); R6 + V1 (`lastFinishedAt` from the live session);
 * the paragraph grace; the settling-gate truth table; and the N-G pin (the
 * shared `renderEvidence` reads nothing the projection does not carry).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  guestSession,
  guestRunEvidence,
  guestPrRef,
  guestPrState,
  guestParagraphKey,
  guestSettledKey,
  guestParagraph,
  guestAnchorIssueTitle,
  computeLastFinishedAt,
  guestPrReadDeterminate,
  isGuestRunSettled,
  scrubWorkspaceKey,
  buildGuestRunProjection,
  PARAGRAPH_GRACE_MS,
  GUEST_SESSION_KEYS,
  GUEST_LOOP_KEYS,
  GUEST_TELEMETRY_KEYS,
  GUEST_LEDGER_ITEM_KEYS,
  GUEST_PROJECTION_KEYS,
} from '../../lib/guest-run.js';
import { sessionSettleState, enrichLoop } from '../../routes/dashboard.js';
import { buildRunView } from '../../lib/run-view.js';
import { inputHash } from '../../lib/run-paragraph.js';
import { renderEvidence } from '../../lib/render-run-evidence.js';
import {
  liveSession, plantedLoop, evidenceModel, reviewBody, prRead,
  URL_KEY, SESSION_ID, CAPTURED_AT, FETCHED_AT_MS, FORBIDDEN_KEYS, SENTINELS,
} from '../fixtures/guest-run-fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPS = { sessionSettleState, enrichLoop };

function project(overrides = {}) {
  const session = overrides.session || liveSession();
  const paragraphKey = guestParagraphKey(session);
  return buildGuestRunProjection({
    session,
    runEvidence: evidenceModel(),
    prRead: prRead(),
    paragraph: { paragraph: 'The run shipped the share link.', inputHash: paragraphKey, final: true },
    urlKey: URL_KEY,
    capturedAt: CAPTURED_AT,
    ...overrides,
  }, DEPS);
}

/** Every key at every depth of a value. */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); allKeys(v, out); }
  }
  return out;
}

describe('guestSession: the exact allow-set', () => {
  test('session, loop, telemetry and ticket-walk keys are exactly the allow-list', () => {
    const stub = guestSession(liveSession());
    assert.deepEqual(Object.keys(stub), [...GUEST_SESSION_KEYS]);
    assert.equal(stub.loops.length, 3);
    for (const loop of stub.loops) {
      assert.deepEqual(Object.keys(loop), [...GUEST_LOOP_KEYS]);
      assert.deepEqual(Object.keys(loop.telemetry), [...GUEST_TELEMETRY_KEYS]);
      assert.deepEqual(loop.telemetry.runtime, { ms: 120000 });
      for (const row of loop.telemetry.ticketWalk) assert.deepEqual(Object.keys(row), ['identifier', 'state']);
    }
  });

  test('the allow-list matches the plan literally', () => {
    assert.deepEqual([...GUEST_SESSION_KEYS], ['sessionId', 'seedIssue', 'tasksTouched', 'dispatchedAt', 'completedAt', 'loops']);
    assert.deepEqual([...GUEST_LOOP_KEYS].sort(), [
      'dispatchedAt', 'followUpTo', 'issueIdentifier', 'issueTitle', 'iteration', 'kind', 'lineageId',
      'loopId', 'resolvedAt', 'sessionId', 'telemetry', 'terminalCompletedAt', 'terminalStatus',
    ]);
    assert.deepEqual([...GUEST_LEDGER_ITEM_KEYS], ['id', 'claim', 'scope', 'discharge', 'dischargedBy', 'discharged', 'followUp']);
  });

  test('idempotent: cutting a stub again returns an equal stub', () => {
    const stub = guestSession(liveSession());
    assert.deepEqual(guestSession(stub), stub);
    assert.deepEqual(guestSession(guestSession(stub)), stub);
  });

  test('V1 (i): the stub carries no agentState — lastFinishedAt is never recomputed from it', () => {
    assert.ok(!allKeys(guestSession(liveSession())).has('agentState'));
  });

  test('id types are kept (the paragraph hash and supersede fold compare ids raw)', () => {
    const stub = guestSession({ sessionId: 7, loops: [{ loopId: 42, followUpTo: 41, lineageId: 41 }] });
    assert.equal(stub.sessionId, 7);
    assert.equal(stub.loops[0].loopId, 42);
    assert.equal(stub.loops[0].followUpTo, 41);
  });

  test('Date timestamps become ISO strings; objects in scalar slots become null', () => {
    const stub = guestSession({ dispatchedAt: new Date(CAPTURED_AT), loops: [{ issueTitle: { evil: true }, iteration: '3' }] });
    assert.equal(stub.dispatchedAt, CAPTURED_AT);
    assert.equal(stub.loops[0].issueTitle, null);
    assert.equal(stub.loops[0].iteration, null);
  });

  test('no session → null', () => {
    assert.equal(guestSession(null), null);
    assert.equal(guestSession('x'), null);
  });

  test('the anchor issue title is the anchor loop\'s (else the first loop\'s)', () => {
    assert.equal(guestAnchorIssueTitle(guestSession(liveSession())), 'Ship the share link');
    const anchorless = liveSession({ loops: [plantedLoop({ loopId: 'a', issueTitle: 'First' }), plantedLoop({ loopId: 'b', issueTitle: 'Second' })] });
    assert.equal(guestAnchorIssueTitle(anchorless), 'First');
  });
});

describe('the projection: allow-set and forbidden fields', () => {
  test('projection keys are exactly the allow-set (prRef present with one PR)', () => {
    const p = project();
    assert.deepEqual(Object.keys(p).sort(), [...GUEST_PROJECTION_KEYS].sort());
    assert.deepEqual(Object.keys(p.runEvidence), ['evidence', 'ledger', 'closeOut']);
    assert.deepEqual(Object.keys(p.prState), ['state', 'number', 'checks', 'asOf']);
    assert.deepEqual(p.prRef, { repo: 'o/r', number: 12 });
    for (const item of p.runEvidence.ledger.ledger.items) {
      assert.deepEqual(Object.keys(item), [...GUEST_LEDGER_ITEM_KEYS]);
    }
  });

  test('prRef is ABSENT (not null) for no PR and for several PRs', () => {
    for (const pr of ['none', 'multiple']) {
      const p = project({ runEvidence: evidenceModel({ pr }), prRead: null });
      assert.ok(!Object.hasOwn(p, 'prRef'), `${pr}: no prRef key`);
    }
  });

  test('a fixture planted with every forbidden field shows none of them, by key or by value', () => {
    const p = project();
    const keys = allKeys(p);
    for (const key of FORBIDDEN_KEYS) assert.ok(!keys.has(key), `forbidden key ${key} leaked`);
    const json = JSON.stringify(p);
    for (const [name, value] of Object.entries(SENTINELS)) {
      assert.ok(!json.includes(value), `sentinel ${name} leaked`);
    }
    // closeOut fields other than status, the owner's comment id, raw parsed rows
    for (const key of ['owner', 'prs', 'pr', 'stopAt', 'variant', 'message', 'readyCopy', 'setupCopy', 'commentId', 'prUrl', 'prUrls']) {
      assert.ok(!keys.has(key), `${key} leaked`);
    }
    // the "now" row keeps what renderCheckedRow reads (+ its stamp), not the raw check runs
    assert.deepEqual(Object.keys(p.runEvidence.evidence.checked.now), ['state', 'headSha', 'checksUrl', 'headMoved', 'asOf']);
    assert.deepEqual(Object.keys(p.runEvidence.evidence.checked.review), ['verdict', 'verdictText', 'ciLine', 'at', 'sha']);
  });

  test('a parsed item\'s raw is dropped; the ledger keeps raw only when it is shown', () => {
    const p = project();
    assert.equal(p.runEvidence.ledger.ledger.raw, null);
    const unparsed = evidenceModel({ body: '## Review\n\n### What CI Did Not Prove\nsome prose the parser cannot split\n\n**Verdict: Approve**' });
    assert.equal(unparsed.ledger.ledger.unparsed, true);
    const cut = guestRunEvidence(unparsed, URL_KEY, null);
    assert.equal(cut.ledger.ledger.raw, 'some prose the parser cannot split');
  });

  test('capturedAt is stored as ISO; paragraphKey/settledKey are sha256 hex', () => {
    const p = project();
    assert.equal(p.capturedAt, CAPTURED_AT);
    assert.match(p.paragraphKey, /^[0-9a-f]{64}$/);
    assert.match(p.settledKey, /^[0-9a-f]{64}$/);
  });

  test('a projection without a session, deps or capturedAt throws', () => {
    assert.throws(() => buildGuestRunProjection({ capturedAt: CAPTURED_AT }, DEPS), /needs a session/);
    assert.throws(() => buildGuestRunProjection({ session: liveSession(), capturedAt: CAPTURED_AT }, {}), /sessionSettleState/);
    assert.throws(() => buildGuestRunProjection({ session: liveSession() }, DEPS), /capturedAt/);
  });
});

describe('scrubWorkspaceKey (N3, PROVISIONAL #4)', () => {
  test('URL-shaped keys are rewritten and lose their scheme; a bare key word is kept', () => {
    assert.equal(scrubWorkspaceKey('see https://linear.app/acme/issue/LIN-5/x now', 'acme'), 'see linear.app/…/issue/LIN-5/x now');
    assert.equal(scrubWorkspaceKey('open /workspace/acme/observation/session/s1', 'acme'), 'open /workspace/…/observation/session/s1');
    assert.equal(scrubWorkspaceKey('https://harbour.cat/workspace/acme/x', 'acme'), 'harbour.cat/workspace/…/x');
    assert.equal(scrubWorkspaceKey('linear.app/acme', 'acme'), 'linear.app/…');
    assert.equal(scrubWorkspaceKey('the acme team said so', 'acme'), 'the acme team said so');
  });

  test('case-insensitive, boundary-aware, other workspaces and keyless URLs untouched', () => {
    assert.equal(scrubWorkspaceKey('https://Linear.app/ACME/issue/LIN-1', 'acme'), 'Linear.app/…/issue/LIN-1');
    assert.equal(scrubWorkspaceKey('https://linear.app/acme2/issue/LIN-1', 'acme'), 'https://linear.app/acme2/issue/LIN-1');
    assert.equal(scrubWorkspaceKey('https://github.com/o/r/pull/1', 'acme'), 'https://github.com/o/r/pull/1');
    assert.equal(scrubWorkspaceKey('a.b linear.app/a.b/x', 'a.b'), 'a.b linear.app/…/x', 'the key is matched literally, not as a pattern');
  });

  test('no key, or a non-string, is a no-op', () => {
    assert.equal(scrubWorkspaceKey('https://linear.app/acme/x', ''), 'https://linear.app/acme/x');
    assert.equal(scrubWorkspaceKey(null, 'acme'), null);
  });

  test('planted keys in claim, discharge, follow-up, raw, asked and done are all scrubbed', () => {
    const keyed = 'https://linear.app/acme/issue/LIN-9/f';
    const body = reviewBody({ claim: `see ${keyed} and /workspace/acme/observation`, followUp: keyed });
    const model = evidenceModel({ body, asked: `asked in ${keyed}`, done: 'done at /workspace/acme/x' });
    const unparsed = evidenceModel({ body: `## Review\n\n### What CI Did Not Prove\nprose naming ${keyed}\n\n**Verdict: Approve**` });
    for (const m of [model, unparsed]) {
      const json = JSON.stringify(guestRunEvidence(m, URL_KEY, null));
      assert.ok(!/linear\.app\/acme/i.test(json), json);
      assert.ok(!/\/workspace\/acme/i.test(json), json);
    }
    const item = guestRunEvidence(model, URL_KEY, null).ledger.ledger.items.find(i => i.id === 'L2');
    assert.equal(item.followUp, 'linear.app/…/issue/LIN-9/f');
  });

  test('a changed follow-up renders as text, never as an anchor', () => {
    const keyed = 'https://linear.app/acme/issue/LIN-9';
    const model = evidenceModel({ body: reviewBody({ followUp: keyed }) });
    const ownerHtml = renderEvidence(model);
    assert.match(ownerHtml, /<a data-testid="run-evidence-ledger-followup" href="https:\/\/linear\.app\/acme/);
    const guestHtml = renderEvidence(guestRunEvidence(model, URL_KEY, null));
    assert.ok(!guestHtml.includes('<a data-testid="run-evidence-ledger-followup"'));
    assert.match(guestHtml, /<span class="rev-ledger-followup" data-testid="run-evidence-ledger-followup">linear\.app\/…\/issue\/LIN-9<\/span>/);
  });

  test('an unchanged follow-up URL stays an anchor, exactly as on the owner page', () => {
    const model = evidenceModel();
    const guestHtml = renderEvidence(guestRunEvidence(model, URL_KEY, null));
    assert.match(guestHtml, /<a data-testid="run-evidence-ledger-followup" href="https:\/\/github\.com\/o\/r\/issues\/7"/);
  });
});

describe('F1: closeOut is stored as {status} only', () => {
  test('a full close-out object is cut to its status', () => {
    const model = evidenceModel();
    assert.ok(Object.keys(model.closeOut).length > 5, 'the owner model is the full close-out state');
    model.closeOut.message = SENTINELS.closeOutMessage;
    assert.deepEqual(guestRunEvidence(model, URL_KEY, null).closeOut, { status: 'merged' });
  });

  test('every CLOSE_OUT_STATUS value is kept; anything else is null', () => {
    for (const status of ['no-pr', 'unknown', 'multiple-prs', 'partial', 'merged', 'closed', 'ready', 'not-ready']) {
      assert.deepEqual(guestRunEvidence({ closeOut: { status } }, '').closeOut, { status });
    }
    for (const status of ['bogus', '', null, 7, { s: 1 }]) {
      assert.deepEqual(guestRunEvidence({ closeOut: { status } }, '').closeOut, { status: null });
    }
    assert.deepEqual(guestRunEvidence({}, '').closeOut, { status: null });
  });

  test('the close-out status, header PR state and now-row stamp come from the same read', () => {
    const p = project();
    assert.equal(p.runEvidence.closeOut.status, 'merged');
    assert.equal(p.prState.state, 'merged');
    assert.equal(p.prState.asOf, new Date(FETCHED_AT_MS).toISOString());
    assert.equal(p.runEvidence.evidence.checked.now.asOf, p.prState.asOf);
  });

  test('idempotent: re-cutting a cut (asOf omitted) is a no-op', () => {
    const cut = project().runEvidence;
    assert.deepEqual(guestRunEvidence(cut, ''), cut);
    assert.deepEqual(guestRunEvidence(guestRunEvidence(cut, ''), ''), cut);
  });

  test('no model → null', () => {
    assert.equal(guestRunEvidence(null, URL_KEY), null);
  });
});

describe('N-G pin: renderEvidence reads only what the projection carries', () => {
  test('a source scan of renderEvidence finds no model read outside {evidence, ledger, closeOut.status}', () => {
    const src = readFileSync(join(__dirname, '../../lib/render-run-evidence.js'), 'utf8');
    const start = src.indexOf('export function renderEvidence(');
    assert.ok(start >= 0, 'renderEvidence exists');
    const end = src.indexOf('\n}\n', start);
    const body = src.slice(src.indexOf('\n', start), end);
    const reads = new Set(body.match(/model\.\w+(\.\w+)?/g) || []);
    const allowed = new Set(['model.evidence', 'model.ledger', 'model.closeOut', 'model.closeOut.status']);
    for (const read of reads) assert.ok(allowed.has(read), `renderEvidence reads ${read}, which the guest projection does not carry`);
    assert.deepEqual([...reads].sort(), [...allowed].sort(), 'the query output matches the plan at b35d1d8c');
    // No escape hatch: `model` is never passed whole, indexed or destructured.
    const bare = body.match(/\bmodel\b(?!\.)/g) || [];
    assert.equal(bare.length, 2, 'only the `!model || typeof model` guard names model without a field');
  });

  test('the projection carries exactly those model fields', () => {
    assert.deepEqual(Object.keys(project().runEvidence).sort(), ['closeOut', 'evidence', 'ledger']);
    assert.deepEqual(Object.keys(project().runEvidence.closeOut), ['status']);
  });
});

describe('PR ref and PR state', () => {
  test('a ref is exactly {repo, number}, validated', () => {
    assert.deepEqual(guestPrRef({ repo: 'o/r', number: 12, url: 'x', extra: 1 }), { repo: 'o/r', number: 12 });
    assert.deepEqual(guestPrRef({ repo: 'Org_1/re.po-2', number: 1 }), { repo: 'Org_1/re.po-2', number: 1 });
    for (const repo of ['o/r/x', 'o', '', 'o r/x', 'o/r"', '../r', 'o/..', './r', 'o/<r>', null]) {
      assert.equal(guestPrRef({ repo, number: 1 }), null, `repo ${repo}`);
    }
    for (const number of [1.5, '12', 0, -1, NaN, null, Infinity]) {
      assert.equal(guestPrRef({ repo: 'o/r', number }), null, `number ${number}`);
    }
    assert.equal(guestPrRef(null), null);
  });

  test('prState mirrors the owner route: none / multiple withheld / one read', () => {
    assert.deepEqual(guestPrState({ status: 'none', ref: null }, null), { state: 'none', number: null, checks: null, asOf: null });
    assert.deepEqual(guestPrState({ status: 'multiple', ref: null }, null), { state: 'unknown', number: null, checks: null, asOf: null });
    const ref = { repo: 'o/r', number: 12, url: 'https://github.com/o/r/pull/12' };
    assert.deepEqual(guestPrState({ status: 'one', ref }, prRead({ result: { readable: true, state: 'open', number: 12, checks: [{ status: 'completed', conclusion: 'failure' }] } })),
      { state: 'open', number: 12, checks: 'failing', asOf: new Date(FETCHED_AT_MS).toISOString() });
    assert.deepEqual(guestPrState({ status: 'one', ref }, prRead({ result: { readable: false } })),
      { state: 'unknown', number: 12, checks: null, asOf: new Date(FETCHED_AT_MS).toISOString() });
    // budget exhausted with nothing cached: unavailable → unknown, no stamp
    assert.deepEqual(guestPrState({ status: 'one', ref }, { result: null, fetchedAt: null, via: 'unavailable' }),
      { state: 'unknown', number: 12, checks: null, asOf: null });
  });
});

describe('R4: settledKey is built from the settle predicate\'s own loops', () => {
  const settled = () => liveSession();
  const key = session => buildGuestRunProjection({ session, capturedAt: CAPTURED_AT }, DEPS).settledKey;

  test('the key is sha256 over paragraphKey + sessionSettleState(session).loops sorted by loopId', () => {
    const session = settled();
    const p = buildGuestRunProjection({ session, capturedAt: CAPTURED_AT }, DEPS);
    assert.equal(p.settledKey, guestSettledKey(p.paragraphKey, sessionSettleState(session)));
    const reversed = { ...sessionSettleState(session), loops: [...sessionSettleState(session).loops].reverse() };
    assert.equal(guestSettledKey(p.paragraphKey, reversed), p.settledKey, 'order-independent');
  });

  test('moves when a markerless complete loop is added — while the session stays settled', () => {
    const before = settled();
    const after = settled();
    after.loops.push(plantedLoop({ loopId: 'w3', sessionId: SESSION_ID, agentState: 'complete', terminalStatus: null, terminalCompletedAt: null, resolvedAt: '2026-07-04T10:20:00.000Z', dispatchedAt: '2026-07-04T10:15:00.000Z' }));
    assert.equal(sessionSettleState(before).settled, true);
    assert.equal(sessionSettleState(after).settled, true, 'markerless complete is terminal for the predicate');
    assert.equal(guestParagraphKey(after), guestParagraphKey(before), 'the paragraph key alone would NOT move (gateFacts is marker-only)');
    assert.notEqual(key(after), key(before));
  });

  test('moves when a loop flips terminal', () => {
    const running = settled();
    running.loops.push(plantedLoop({ loopId: 'w3', agentState: 'running', terminalStatus: null, terminalCompletedAt: null }));
    const finished = settled();
    finished.loops.push(plantedLoop({ loopId: 'w3', agentState: 'complete', terminalStatus: null, terminalCompletedAt: null }));
    assert.notEqual(key(running), key(finished));
  });

  test('moves when a marker lands on an already-terminal loop', () => {
    const markerless = settled();
    markerless.loops.push(plantedLoop({ loopId: 'w3', agentState: 'complete', terminalStatus: null, terminalCompletedAt: null }));
    const marked = settled();
    marked.loops.push(plantedLoop({ loopId: 'w3', agentState: 'complete', terminalStatus: 'done', terminalCompletedAt: null }));
    assert.deepEqual(sessionSettleState(markerless).loops, sessionSettleState(marked).loops, 'the terminal verdicts agree');
    assert.notEqual(key(markerless), key(marked), 'the marker moves paragraphKey, so the key');
  });

  test('does not move on an unrelated edit', () => {
    const edited = settled();
    edited.loops[1].feedback.push({ message: 'heartbeat', timestamp: '2026-07-04T10:59:00.000Z' });
    edited.loops[1].telemetry.metrics.push({ toolCount: 9 });
    edited.loops[1].telemetry.runtime = { ms: 999 };
    edited.tasksTouched = ['LIN-999'];
    assert.equal(key(edited), key(settled()));
  });
});

describe('the paragraph (R5) and its key', () => {
  test('paragraphKey from the stub equals the hash the hook writes from the live session', () => {
    const live = liveSession();
    assert.equal(guestParagraphKey(guestSession(live)), inputHash(buildRunView(live)));
  });

  test('carried only when the hash matches AND it is final', () => {
    const k = guestParagraphKey(liveSession());
    assert.equal(guestParagraph({ paragraph: ' Done. ', inputHash: k, final: true }, k), 'Done.');
    assert.equal(guestParagraph({ paragraph: 'Done.', inputHash: k, final: false }, k), null, 'matched but not final');
    assert.equal(guestParagraph({ paragraph: 'Done.', inputHash: k }, k), null, 'final missing');
    assert.equal(guestParagraph({ paragraph: 'Done.', inputHash: 'other', final: true }, k), null, 'stale hash');
    assert.equal(guestParagraph({ paragraph: '  ', inputHash: k, final: true }, k), null, 'empty text');
    assert.equal(guestParagraph(null, k), null);
  });

  test('a matched but non-final paragraph is dropped from the projection and does not settle it early', () => {
    const session = liveSession();
    const k = guestParagraphKey(session);
    const base = { session, runEvidence: evidenceModel(), prRead: prRead({ fetchedAt: Date.parse('2026-07-04T10:09:30.000Z') }), urlKey: URL_KEY };
    // capturedAt inside the grace (last step 10:09, grace to 10:19)
    const early = '2026-07-04T10:12:00.000Z';
    const unfinal = buildGuestRunProjection({ ...base, paragraph: { paragraph: 'p', inputHash: k, final: false }, capturedAt: early }, DEPS);
    assert.equal(unfinal.runParagraph, null);
    assert.equal(unfinal.settled, false);
    const final = buildGuestRunProjection({ ...base, paragraph: { paragraph: 'p', inputHash: k, final: true }, capturedAt: early }, DEPS);
    assert.equal(final.runParagraph, 'p');
    assert.equal(final.settled, true);
  });
});

describe('R6 + V1: lastFinishedAt from the live session', () => {
  test('the max enriched completedAt over the loops', () => {
    assert.equal(computeLastFinishedAt(liveSession(), enrichLoop), '2026-07-04T10:09:00.000Z');
  });

  test('a loop with no completion time falls back to its dispatchedAt — only that loop', () => {
    const session = liveSession();
    session.loops.push(plantedLoop({ loopId: 'r', agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null, dispatchedAt: '2026-07-04T10:30:00.000Z' }));
    assert.equal(computeLastFinishedAt(session, enrichLoop), '2026-07-04T10:30:00.000Z');
    const early = liveSession();
    early.loops.push(plantedLoop({ loopId: 'r', agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null, dispatchedAt: '2026-07-04T10:01:00.000Z' }));
    assert.equal(computeLastFinishedAt(early, enrichLoop), '2026-07-04T10:09:00.000Z', 'a lower bound never wins over a later completion');
  });

  test('V1: a markerless complete loop with only resolvedAt yields resolvedAt, not dispatchedAt', () => {
    const v1 = plantedLoop({ loopId: 'v1', agentState: 'complete', terminalStatus: null, terminalCompletedAt: null, resolvedAt: '2026-07-04T10:40:00.000Z', dispatchedAt: '2026-07-04T10:35:00.000Z' });
    const session = { sessionId: 's', loops: [v1] };
    assert.equal(computeLastFinishedAt(session, enrichLoop), '2026-07-04T10:40:00.000Z');
    // Why option (i): the stub drops agentState, so the same computation over it is wrong.
    assert.equal(computeLastFinishedAt(guestSession(session), enrichLoop), '2026-07-04T10:35:00.000Z');
    // …and the projection stores the live value.
    const p = buildGuestRunProjection({ session, capturedAt: CAPTURED_AT }, DEPS);
    assert.equal(p.lastFinishedAt, '2026-07-04T10:40:00.000Z');
  });

  test('no loop with any time → null; enrichLoop is required', () => {
    assert.equal(computeLastFinishedAt({ loops: [] }, enrichLoop), null);
    assert.throws(() => computeLastFinishedAt(liveSession()), /enrichLoop/);
  });
});

describe('the settling gate', () => {
  const LAST = '2026-07-04T10:09:00.000Z';
  const lastMs = Date.parse(LAST);
  const one = { status: 'one', ref: { repo: 'o/r', number: 12 } };

  test('PR read determinacy (gate b)', () => {
    const cases = [
      ['no PR', { status: 'none' }, null, true],
      ['several PRs', { status: 'multiple' }, null, true],
      ['fresh read after the last step', one, prRead({ fetchedAt: lastMs + 1, via: 'fresh' }), true],
      ['cache entry at the last step', one, prRead({ fetchedAt: lastMs, via: 'cache' }), true],
      ['readable:false, read fresh', one, prRead({ result: { readable: false }, fetchedAt: lastMs + 1, via: 'fresh' }), true],
      ['cache entry older than the last step', one, prRead({ fetchedAt: lastMs - 1, via: 'cache' }), false],
      ['budget-exhausted stale fallback', one, prRead({ fetchedAt: lastMs + 1, via: 'stale' }), false],
      ['unavailable', one, { result: null, fetchedAt: null, via: 'unavailable' }, false],
      ['thrown read (nothing recorded)', one, null, false],
      ['unknown-age cache entry', one, prRead({ fetchedAt: null, via: 'cache' }), false],
    ];
    for (const [name, resolved, read, expected] of cases) {
      assert.equal(guestPrReadDeterminate(resolved, read, LAST), expected, name);
    }
    assert.equal(guestPrReadDeterminate(one, prRead({ fetchedAt: lastMs + 1 }), null), false, 'unknown lastFinishedAt is never a floor');
  });

  test('truth table over (a) session settled, (b) PR determinate, (c) paragraph matched or grace', () => {
    const inGrace = new Date(lastMs + PARAGRAPH_GRACE_MS - 1).toISOString();
    const afterGrace = new Date(lastMs + PARAGRAPH_GRACE_MS).toISOString();
    for (const sessionSettled of [true, false]) {
      for (const prDeterminate of [true, false]) {
        for (const paragraphMatched of [true, false]) {
          for (const now of [inGrace, afterGrace]) {
            const expected = sessionSettled && prDeterminate && (paragraphMatched || now === afterGrace);
            assert.equal(
              isGuestRunSettled({ sessionSettled, prDeterminate, paragraphMatched, lastFinishedAt: LAST, now }),
              expected,
              JSON.stringify({ sessionSettled, prDeterminate, paragraphMatched, now })
            );
          }
        }
      }
    }
  });

  test('the paragraph grace is 10 minutes after the last step', () => {
    assert.equal(PARAGRAPH_GRACE_MS, 10 * 60 * 1000);
    const facts = { sessionSettled: true, prDeterminate: true, paragraphMatched: false, lastFinishedAt: LAST };
    assert.equal(isGuestRunSettled({ ...facts, now: '2026-07-04T10:18:59.999Z' }), false);
    assert.equal(isGuestRunSettled({ ...facts, now: '2026-07-04T10:19:00.000Z' }), true);
  });

  test('an unknown lastFinishedAt never settles', () => {
    assert.equal(isGuestRunSettled({ sessionSettled: true, prDeterminate: true, paragraphMatched: true, lastFinishedAt: null, now: CAPTURED_AT }), false);
  });

  test('end to end: settled only with a settled session and a PR read after the last step', () => {
    assert.equal(project().settled, true);
    assert.equal(project({ prRead: prRead({ fetchedAt: Date.parse('2026-07-04T10:08:00.000Z'), via: 'cache' }) }).settled, false, 'read predates the last step');
    assert.equal(project({ prRead: prRead({ via: 'stale' }) }).settled, false, 'budget-exhausted stale');
    const running = liveSession();
    running.loops[2] = { ...running.loops[2], agentState: 'running', terminalStatus: null, terminalCompletedAt: null, resolvedAt: null };
    assert.equal(project({ session: running }).settled, false, 'a running follow-up keeps it unsettled');
    assert.equal(project({ runEvidence: evidenceModel({ pr: 'none' }), prRead: null }).settled, true, 'no PR is determinate');
  });
});
