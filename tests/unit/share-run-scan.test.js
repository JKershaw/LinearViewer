/**
 * LIN-3312 (Phase 2 of LIN-2950, S7a) — `scanGuestHtml`, the fail-closed
 * secret scan over the final guest run page.
 *
 * Run with: node --test tests/unit/share-run-scan.test.js
 *
 * Every planted secret below is ASSEMBLED FROM FRAGMENTS AT RUNTIME: the
 * repo's CI `secret-scan` job scans this file's source, and a literal token
 * shape here would trip it. The fragments never form a matching token in the
 * source text.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scanGuestHtml } from '../../lib/share-run-scan.js';
import { renderGuestRunPage } from '../../lib/render-share.js';
import { buildGuestRunProjection, guestParagraphKey } from '../../lib/guest-run.js';
import { sessionSettleState, enrichLoop } from '../../routes/dashboard.js';
import { liveSession, plantedLoop, evidenceModel, reviewBody, prRead, URL_KEY, CAPTURED_AT } from '../fixtures/guest-run-fixtures.js';

// Runtime-assembled secrets (see the header): a prefix split in two, plus a
// body of the exact length each rule wants, cut from one mixed-case run.
const BODY = 'Qx7Rk2Vm9Lp4Wn8Tz3Yb6Hc1Js5Df0Gu2AeZq8Wx3Ec7Rv2Tb6Yn1Um5Ik9Ol4';
const GITHUB_PAT = ['gh', 'p_'].join('') + BODY.slice(0, 36);
const LINEAR_KEY = ['lin', '_api_'].join('') + BODY.slice(2, 42);
const OPENAI_KEY = ['s', 'k-'].join('') + BODY.slice(5, 41);

function pageWith({ claim, paragraph, issueTitle } = {}) {
  const session = liveSession();
  if (issueTitle) session.loops[1] = plantedLoop({ ...session.loops[1], issueTitle });
  const snapshot = buildGuestRunProjection({
    session,
    runEvidence: evidenceModel(claim ? { body: reviewBody({ claim }) } : {}),
    prRead: prRead(),
    paragraph: paragraph ? { paragraph, inputHash: guestParagraphKey(session), final: true } : null,
    urlKey: URL_KEY,
    capturedAt: CAPTURED_AT
  }, { sessionSettleState, enrichLoop });
  return renderGuestRunPage({ snapshot });
}

describe('scanGuestHtml', () => {
  test('the fragments really are secrets to the scanner (the fixture is live)', () => {
    for (const secret of [GITHUB_PAT, LINEAR_KEY, OPENAI_KEY]) {
      assert.equal(scanGuestHtml(`<p>${secret}</p>`).ok, false, 'planted secret detected');
    }
  });

  test('a clean guest page passes', () => {
    const result = scanGuestHtml(pageWith());
    assert.deepEqual(result, { ok: true, reason: null, findings: [] });
  });

  test('a secret in ledger prose, the paragraph or an issue title fails the page', () => {
    const cases = [
      ['ledger claim', pageWith({ claim: `leaked ${GITHUB_PAT} in a log` })],
      ['run paragraph', pageWith({ paragraph: `The run used ${LINEAR_KEY}.` })],
      ['issue title', pageWith({ issueTitle: `rotate ${OPENAI_KEY}` })],
    ];
    for (const [name, html] of cases) {
      const result = scanGuestHtml(html);
      assert.equal(result.ok, false, name);
      assert.equal(result.reason, 'secret', name);
      assert.ok(result.findings.length >= 1, name);
    }
  });

  test('findings carry the rule and the redacted form, never the secret', () => {
    const result = scanGuestHtml(pageWith({ claim: `leaked ${GITHUB_PAT}` }));
    assert.equal(result.findings[0].ruleId, 'github-pat');
    const json = JSON.stringify(result);
    assert.ok(!json.includes(GITHUB_PAT), 'the raw match is not returned');
    assert.deepEqual(Object.keys(result.findings[0]).sort(), ['column', 'line', 'redacted', 'ruleId', 'ruleName']);
  });

  test('fails closed: a non-string or empty page is not ok', () => {
    for (const html of [undefined, null, '', '   ', 42, {}, Buffer.from('<html>')]) {
      assert.deepEqual(scanGuestHtml(html), { ok: false, reason: 'not-html', findings: [] }, String(html));
    }
  });

  test('fails closed: a scanner error, or a scanner that answers nonsense, is not ok', () => {
    const html = pageWith();
    assert.deepEqual(scanGuestHtml(html, { scan: () => { throw new Error('boom'); } }), { ok: false, reason: 'scan-error', findings: [] });
    assert.deepEqual(scanGuestHtml(html, { scan: () => null }), { ok: false, reason: 'scan-error', findings: [] });
  });

  test('scans as a non-fixture path, so the fixture allowlist can never suppress it', () => {
    let seen;
    scanGuestHtml('<p>x</p>', { scan: (text, opts) => { seen = opts; return []; } });
    assert.deepEqual(seen, { filePath: 'guest-run-page.html', isAllowlisted: false });
  });
});
