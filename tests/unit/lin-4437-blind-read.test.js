/**
 * LIN-4437 (piece 2 of LIN-4396): the `blind-read` stage, sent by hand. Nothing gates on it yet.
 *
 *   - the readers' one home (lib/run-ledger.js): the comment shape, `landingPrUrls`, `latestBlindRead`,
 *     and `isCloseOut` with `firstHeading`/`firstLineOf` moved there (no local copies left);
 *   - witness 1: a read is never landing work and never an answer to a person (no loop, no silenced
 *     person), down to the selector's rendered facts with runs known;
 *   - witness 2: the read is blind: the prompt and its preamble carry no ticket text, no attachment
 *     title and no brief or issue-read hint;
 *   - the prompt is the piloted text (tests/fixtures/blind-read-piloted.txt, frozen from #2407) but for
 *     its fill-ins and the Where-to-stand sentence;
 *   - the proxy holds the comment's shape, and with a failed trail read keeps the shape check and skips
 *     only the PR-set check, with a log;
 *   - the ledger model carries `blindRead`, and the run-evidence fragment shows it;
 *   - a live blind read holds the live-stage wait; the churn and round-trip readers place it.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  landingPrUrls, latestBlindRead, parseBlindRead, checkBlindRead, isBlindRead, BLIND_READ_CODES,
  readRunLedger, latestReviewComment, isCloseOut
} from '../../lib/run-ledger.js';
import { BLIND_READ_HEADING } from '../../lib/prompts/blind-read-words.js';
import { SURVEY_HEADINGS } from '../../lib/prompts/survey-words.js';
import { assembleTrailFacts, assemblePlanReviewFacts, isPersonComment } from '../../lib/recommendation-facts.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { recentRuns, stageRuns } from '../../lib/recent-runs.js';
import { liveWaitOf } from '../../lib/recommendation-live-wait.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';
import { buildRunEvidence } from '../../lib/run-evidence.js';
import { renderRunEvidence } from '../../lib/render-run-evidence.js';
import { LEFTOVER_RULE, CONSEQUENCE_TEST } from '../../lib/prompts/leftover-words.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { classifyTicket } from '../../lib/pipeline-churn.js';
import { computeIssueRoundTrips } from '../../lib/plan-review-round-trips.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');

const PR = 'https://github.com/JKershaw/LinearViewer/pull/77';
const PR2 = 'https://github.com/JKershaw/LinearViewer/pull/78';
const OLD = 'https://github.com/JKershaw/LinearViewer/pull/12';
const FOREIGN = 'https://github.com/other/repo/pull/5';
const at = (h) => `2026-11-12T${String(h).padStart(2, '0')}:00:00.000Z`;
const c = (h, body, id = `c${h}`) => ({ id, body, createdAt: at(h) });

const review = (h, verdict = 'Approve', pr = PR) => c(h, `## Review — LIN-1\n\n${pr}\n\n**Verdict:** ${verdict}\n\n### What CI Did Not Prove\n\nNone.`);
const summary = (h, pr = PR) => c(h, `Implementation done: ${pr} at \`abc1234\`.`);
const closeOut = (h, text = 'not ready', pr = PR) => c(h, `## Close-out — ${text}\n\n${pr}`);
const read1 = (h, prs = [PR], verdict = 'better') => c(h, `${BLIND_READ_HEADING}\nVerdict: ${verdict}. The change gave the parser one owner in \`lib/a.js\`; it left a stale comment in \`lib/b.js\`.\n\nRead: ${prs.join(', ')} at \`abc\` against \`def\`.\n\n### Inside the area, fix-sized\nNone.`);

describe('the comment shape (checkBlindRead, parseBlindRead)', () => {
  const ok = read1(1).body;
  test('a well-formed read passes, with its verdict, reason and PRs', () => {
    const r = checkBlindRead(ok, { landing: [PR] });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, 'better');
    assert.deepEqual(r.prs, [PR]);
    assert.match(r.reason, /one owner/);
  });
  test('"mixed" is refused: there is no fourth word', () => {
    assert.equal(checkBlindRead(ok.replace('Verdict: better', 'Verdict: mixed')).code, BLIND_READ_CODES.verdictWord);
  });
  test('a verdict with no reason is refused', () => {
    assert.equal(checkBlindRead(`${BLIND_READ_HEADING}\nVerdict: same.\n\nRead: ${PR}`).code, BLIND_READ_CODES.reasonMissing);
  });
  test('two verdict lines, or none, are refused', () => {
    assert.equal(checkBlindRead(`${ok}\nVerdict: worse. A second line that also has reasons.`).code, BLIND_READ_CODES.verdictRepeated);
    assert.equal(checkBlindRead(`${BLIND_READ_HEADING}\n\nRead: ${PR}`).code, BLIND_READ_CODES.verdictMissing);
  });
  test('a read naming no PR, or PRs other than the landing, is refused', () => {
    assert.equal(checkBlindRead(ok.replace(PR, '#77')).code, BLIND_READ_CODES.prsMissing);
    const r = checkBlindRead(ok, { landing: [PR, PR2] });
    assert.equal(r.code, BLIND_READ_CODES.prsMismatch);
    assert.deepEqual(r.expected, [PR, PR2]);
    assert.equal(checkBlindRead(read1(1, [PR, OLD]).body, { landing: [PR] }).code, BLIND_READ_CODES.prsMismatch, 'an extra URL');
  });
  test('the heading is matched exactly: a longer heading, or a mention further down, is not a read', () => {
    assert.equal(isBlindRead(`${BLIND_READ_HEADING} pilot\nVerdict: mixed`), false);
    assert.deepEqual(checkBlindRead(`${BLIND_READ_HEADING} pilot\nVerdict: mixed`), { ok: true, applies: false });
    assert.deepEqual(checkBlindRead(review(1).body + `\n\nThe ${BLIND_READ_HEADING} comment said same.\nVerdict: mixed`), { ok: true, applies: false });
    assert.equal(isBlindRead(`\n\n${BLIND_READ_HEADING}: LIN-1\nVerdict: same. a b c ${PR}`), true, 'a `:` tail, after blank lines');
  });
  test('a read is neither a review nor a close-out nor a person\'s comment', () => {
    assert.equal(latestReviewComment([read1(1)]), null);
    assert.equal(isCloseOut(read1(1).body), false);
    assert.equal(isPersonComment(read1(1).body), false);
  });
  test('parseBlindRead gives the model, or null for a malformed read', () => {
    assert.deepEqual(parseBlindRead(read1(3)), { verdict: 'better', reason: parseBlindRead(read1(3)).reason, prs: [PR], at: at(3), commentId: 'c3' });
    assert.equal(parseBlindRead(c(3, `${BLIND_READ_HEADING}\nVerdict: mixed. a b c ${PR}`)), null);
  });
});

describe('landingPrUrls: the one owner of "which landing is current"', () => {
  test('no review: every full PR URL on the trail', () => {
    assert.deepEqual(landingPrUrls([summary(1, OLD), summary(2, PR)]), [OLD, PR]);
  });
  test('the anchor is the latest close-out before the latest review', () => {
    const trail = [summary(1, OLD), review(2, 'Approve', OLD), closeOut(3, 'merged', OLD), summary(4, PR), review(5)];
    assert.deepEqual(landingPrUrls(trail), [PR]);
  });
  test('a close-out after the latest review never resets scope', () => {
    const trail = [summary(1), review(2), closeOut(3, 'not ready')];
    assert.deepEqual(landingPrUrls(trail), [PR]);
  });
  test('a not-ready close-out before a re-review keeps the PR re-named by the fix round', () => {
    const trail = [summary(1), review(2), closeOut(3, 'not ready'), summary(4), review(5)];
    assert.deepEqual(landingPrUrls(trail), [PR]);
  });
  test('a review whose title mentions close-out is not an anchor', () => {
    const conditional = c(2, `## Review — Approve, conditional on close-out\n\n${OLD}\n\n**Verdict:** Approve (conditional)`);
    assert.deepEqual(landingPrUrls([summary(1, OLD), conditional, summary(3), review(4)]), [OLD, PR]);
  });
  test('a blind read and a Survey report never carry the landing (the LIN-4396 note-1 decision)', () => {
    const survey = c(0, `${SURVEY_HEADINGS['survey-place']}: LIN-1 @ abc\n\nSee ${OLD} for the precedent.`);
    assert.deepEqual(landingPrUrls([survey, summary(1), review(2), read1(3, [OLD])]), [PR]);
  });
  test('kept on purpose: a foreign-repository URL before the first review joins the landing (narrowing by repo needs a repo no caller holds)', () => {
    assert.deepEqual(landingPrUrls([c(0, `Like ${FOREIGN}.`), summary(1), review(2)]), [FOREIGN, PR]);
  });
});

describe('latestBlindRead: over the whole trail', () => {
  test('the newest well-formed read after the latest review', () => {
    const trail = [summary(1), review(2), read1(3, [PR], 'worse'), read1(4, [PR], 'same'), c(5, `${BLIND_READ_HEADING}\nVerdict: mixed. x y z ${PR}`)];
    assert.equal(latestBlindRead(trail, latestReviewComment(trail)).verdict, 'same');
  });
  test('a read before the latest review is not on record for it', () => {
    const trail = [summary(1), review(2), read1(3), summary(4), review(5)];
    assert.equal(latestBlindRead(trail, latestReviewComment(trail)), null);
  });
  test('with no review, the latest read anywhere', () => {
    assert.equal(latestBlindRead([summary(1), read1(2)]).verdict, 'better');
  });
});

describe('no local copies: recommendation-facts imports the moved readers', () => {
  test('isCloseOut, firstHeading and firstLineOf are defined only in lib/run-ledger.js', () => {
    const facts = read('lib/recommendation-facts.js');
    for (const name of ['isCloseOut', 'firstHeading', 'firstLineOf']) {
      assert.doesNotMatch(facts, new RegExp(`(?:function|const)\\s+${name}\\b`), `${name} has no local definition`);
      assert.match(read('lib/run-ledger.js'), new RegExp(`export (?:function|const) ${name}\\b`));
    }
  });
});

describe('witness 1: a read is never landing work, never an answer to a person', () => {
  const person = c(3, 'Please keep the old flag; we still read it in the export.');
  const trail = [summary(1), review(2), person, read1(4)];
  const rows = [
    { id: 'r-review', kind: 'review', status: 'taken', dispatchedAt: at(1), feedback: [{ message: '[done] reviewed', timestamp: at(2) }] },
    { id: 'r-read', kind: 'blind-read', status: 'taken', dispatchedAt: at(3), feedback: [{ message: '[done] posted the read', timestamp: at(4) }] }
  ];

  test('workAfterReview is false and the latest person\'s comment is not acted on', () => {
    const f = assembleTrailFacts(trail, '');
    assert.equal(f.workAfterReview, false);
    assert.equal(f.latestPerson.at, at(3));
    assert.equal(f.latestPerson.actedAfter, false);
  });

  test('the plan-review landed fact is unchanged by a read', () => {
    const verdict = c(0, '### Plan Review Verdict\n\n**Verdict:** Approve.');
    assert.deepEqual(assemblePlanReviewFacts([verdict, person, read1(4)]), assemblePlanReviewFacts([verdict, person]));
  });

  test('the selector\'s rendered facts, with runs known, show no blind-read line and no run after the person', () => {
    const runs = recentRuns(rows);
    assert.deepEqual(runs.map(r => r.stage), ['review'], 'selectorSlice leaves the read out');
    assert.equal(stageRuns(rows).length, 2, 'allRuns keeps it');
    const { facts } = buildSelectorArgs({ identifier: 'LIN-1', title: 'T', description: '', state: {}, labels: [] }, { comments: trail, runs });
    assert.doesNotMatch(facts, /blind-read/);
    assert.match(facts, /Work reported after it \(a later comment links a PR\): no/);
    const runLines = facts.split('\n').filter(l => /^\s+- \w/.test(l) && /Recent runs/.test(facts));
    assert.ok(runLines.every(l => !l.includes(' 03:') && !l.includes(' 04:')), 'no run dated after the person\'s comment');
  });

  test('the selector slice keeps the newest five stage runs after the read is dropped', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, kind: 'plan', status: 'taken', dispatchedAt: at(i), feedback: [{ message: '[done]', timestamp: at(i) }] }));
    const runs = recentRuns([...many, { id: 'b', kind: 'blind-read', status: 'taken', dispatchedAt: at(7), feedback: [{ message: '[done]', timestamp: at(8) }] }]);
    assert.equal(runs.length, 5);
    assert.ok(runs.every(r => r.stage === 'plan'));
  });
});

describe('witness 2: the read is blind', () => {
  const issue = {
    id: 'LIN-9', identifier: 'LIN-9', title: 'TOKEN_TITLE_7731', description: '## As asked\n\nTOKEN_DESC_7731\n\n### Leftovers\nTOKEN_LEFT_7731',
    url: 'x', state: { name: 'In Progress', type: 'started' }, labels: [], createdAt: at(0)
  };
  const context = {
    parent: { identifier: 'LIN-8', title: 'TOKEN_PARENT_7731', description: 'TOKEN_PDESC_7731' },
    siblings: [], children: [], project: { name: 'TOKEN_PROJECT_7731' },
    comments: [c(1, `TOKEN_COMMENT_7731 Implementation: ${PR}`), c(2, '### Leftovers\nTOKEN_LEFTOVERS_7731\nRetires: none')],
    attachments: [{ id: 'att:1', title: 'TOKEN_ATTACH_7731', kind: 'file' }]
  };
  const prompt = generatePrompt('blind-read', issue, context).prompt;
  const preamble = buildProxyContextPreamble({ baseUrl: 'https://h', token: 'T', issueIdentifier: 'LIN-9', writes: 'blind-comment' });

  test('no ticket text, comment, leftover, parent, project or attachment title reaches the prompt or preamble', () => {
    for (const text of [prompt, preamble]) assert.doesNotMatch(text, /TOKEN_\w+_7731/);
  });
  test('no brief or issue-read hint, and the scope line asks for no ticket read', () => {
    for (const text of [prompt, preamble]) {
      assert.ok(!text.includes('/brief/') && !text.includes('/issues/'), 'no /brief/ or /issues/ hint');
    }
    assert.doesNotMatch(prompt, /## Attachments/);
    const scope = /## Scope and Authority\n\n([\s\S]*?)\n\n## /.exec(prompt)[1];
    assert.doesNotMatch(scope, /ticket/i);
  });
  test('the ticket appears only as where the comment goes', () => {
    for (const line of prompt.split('\n').filter(l => l.includes('LIN-9'))) {
      assert.match(line, /one comment on LIN-9|LIN-9 is where it goes|linked on LIN-9/, line);
    }
  });
  test('the skip is the blind read\'s alone: another stage still renders the attachments', () => {
    assert.match(generatePrompt('survey-task', issue, context).prompt, /## Attachments/);
  });
});

describe('the prompt is the piloted text', () => {
  test('the render equals the frozen pilot but for its fill-ins, the Where-to-stand sentence and the Goal frame', () => {
    const pilot = read('tests/fixtures/blind-read-piloted.txt');
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { comments: [summary(1)] }).prompt;
    const body = prompt.slice(prompt.indexOf('## Process\n\n') + '## Process\n\n'.length);
    const [repo, lead, ...rest] = pilot.trimEnd().split('\n\n');
    const expected = [repo.replace('JKershaw/LinearViewer (Harbour)', 'JKershaw/LinearViewer'), ...rest].join('\n\n')
      .replace('{DESTINATION}', 'Your only output is one comment on LIN-9: the comment below. LIN-9 is where it goes, not something to read.')
      .replaceAll('{PRS}', PR);
    const where = body.split('\n\n').find(p => p.startsWith('**Where to stand.**'));
    assert.equal(body.split('\n\n').filter(p => p !== where).join('\n\n'), expected);
    assert.ok(prompt.includes(`## Goal\n${lead}\n`), 'the lead is the pilot\'s second paragraph');
    assert.match(where, /git fetch origin pull\/<number>\/head/);
  });
  test('the class lines and the unmapped-path sentence are the leaf constants\' own words', () => {
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { comments: [summary(1)] }).prompt;
    for (const s of LEFTOVER_RULE.split(/(?<=\.)\s+/).slice(1, 4)) assert.ok(prompt.includes(`- ${s}\n`), s);
    assert.ok(prompt.includes(CONSEQUENCE_TEST.split(/(?<=\.)\s+/).find(s => s.startsWith('An unmapped path'))));
  });
  test('with no PR on the landing the prompt says so and the run ends [skipped]', () => {
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { comments: [c(1, 'no links here')] }).prompt;
    assert.match(prompt, /\*\*Nothing to read\.\*\*/);
    assert.match(prompt, /`\[skipped\]`/);
    assert.doesNotMatch(prompt, /Repository:/);
  });
  test('the landing\'s repository names the Repository line; the pilot file is a pointer now', () => {
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { comments: [summary(1, FOREIGN), summary(2)] }).prompt;
    assert.match(prompt, /^Repository: other\/repo, JKershaw\/LinearViewer\. /m);
    assert.doesNotMatch(read('docs/plans/survey/blind-read-prompt.md'), /^```$/m, 'no second live copy of the prompt');
  });
});

describe('the ledger carries the read', () => {
  const trail = [summary(1), review(2), read1(3, [PR], 'same')];
  test('readRunLedger and assembleTrailFacts attach blindRead', () => {
    assert.equal(readRunLedger(trail).blindRead.verdict, 'same');
    assert.equal(assembleTrailFacts(trail, '').review.blindRead.verdict, 'same');
    assert.equal(readRunLedger([summary(1), review(2)]).blindRead, null);
  });
  test('buildRunEvidence carries it, and the fragment shows the verdict and reason, or none on record', () => {
    const model = buildRunEvidence({ comments: trail, issueIdentifier: 'LIN-1' });
    assert.equal(model.ledger.blindRead.verdict, 'same');
    assert.equal(model.evidence.checked.blindRead.verdict, 'same');
    const html = renderRunEvidence(model);
    assert.match(html, /data-testid="run-evidence-checked-blind-read-verdict">same</);
    assert.match(html, /one owner/);
    assert.match(renderRunEvidence(buildRunEvidence({ comments: [summary(1), review(2)], issueIdentifier: 'LIN-1' })), /no blind read on record/);
  });
  test('a precomputed ledger brings its own read', () => {
    const ledger = { ...readRunLedger(trail) };
    assert.equal(buildRunEvidence({ comments: [], ledger, issueIdentifier: 'LIN-1' }).evidence.checked.blindRead.verdict, 'same');
  });
});

describe('the run readers place a blind read', () => {
  test('a live blind read holds the live-stage wait', () => {
    const wait = liveWaitOf(stageRuns([{ id: 'b1', kind: 'blind-read', status: 'pending', dispatchedAt: at(1) }]));
    assert.equal(wait.wait.kind, 'blind-read');
  });
  test('a blind read sent by hand between a Request Changes review and the fix round does not flip the review\'s verdict', () => {
    // No verdict comment, so the walk reads the verdict from the next pipeline row (tier C). On the walk,
    // the read would be that row and read as an Approve; off it, the fix round is, a Request Changes.
    const issue = {
      id: 'i', identifier: 'LIN-1', description: '', comments: [],
      rows: [
        { id: 'rv', kind: 'review', status: 'taken', dispatchedAt: at(1), completedAt: at(2) },
        { id: 'br', kind: 'blind-read', status: 'taken', dispatchedAt: at(3), completedAt: at(4) },
        { id: 'im', kind: 'implementation', status: 'taken', dispatchedAt: at(5), completedAt: at(6) }
      ]
    };
    const out = computeIssueRoundTrips(issue, { asOf: at(9), gateKind: 'review', rePassKind: 'implementation' });
    assert.equal(out.R0.nextRow.kind, 'implementation');
    assert.equal(out.R0.verdict, 'request changes');
  });
  test('churn: one blind read per review is the stage path, a second is a repeat; a Survey is a first pass', () => {
    const row = (id, kind, h) => ({ id, kind, status: 'taken', dispatchedAt: at(h), feedback: [{ message: '[done]', timestamp: at(h).replace(':00:00', ':30:00') }] });
    const { entries } = classifyTicket({ identifier: 'LIN-1', rows: [row('s', 'survey-task', 0), row('r', 'review', 1), row('b1', 'blind-read', 2), row('b2', 'blind-read', 3), row('r2', 'review', 4), row('b3', 'blind-read', 5)] });
    const cause = Object.fromEntries(entries.map(e => [e.id, e.cause]));
    assert.deepEqual([cause.s, cause.b1, cause.b2, cause.b3], ['first-pass-stage', 'stage-path', 'repeat-stage', 'stage-path']);
  });
});

// ── The proxy holds the comment's shape (routes/proxy-writes.js refusedByBlindRead) ──────────────
const URL_KEY = 'acme-4437';
const ISSUE_ID = '44374437-4437-4437-4437-443744374437';
class FakeProvider extends ProviderInterface {
  constructor(trail) {
    super();
    this.name = 'fake';
    this.calls = { createComment: 0, fetchIssueComments: 0 };
    this.createComment = async (token, issueId, body) => { this.calls.createComment++; return { id: `n-${this.calls.createComment}`, body, createdAt: at(9), user: { name: 'Agent' } }; };
    this.updateComment = async (token, id, body) => ({ id, body });
    this.issueWriteGuard = async () => ({ id: ISSUE_ID, team: { id: 't' } });
    this.fetchIssueComments = async () => {
      this.calls.fetchIssueComments++;
      if (trail instanceof Error) throw trail;
      return trail;
    };
  }
}
function buildApp(provider) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {}, recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} }, taskSnapshotStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(), workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }, provider,
  }));
  return app;
}
async function post(provider, body, method = 'POST', path = `${ISSUE_ID}/comments`) {
  const server = buildApp(provider).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/issues/${path}`, {
      method, headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: JSON.stringify({ body })
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}
let uniq = 0;
const readBody = (verdict = 'better', prs = [PR]) => `${read1(1, prs, verdict).body}\n\n(${++uniq})`;
const TRAIL = [summary(1), review(2)];

describe('the proxy holds the blind read\'s shape', () => {
  test('refuses "mixed" with 422, before any trail read, and posts nothing', async () => {
    const p = new FakeProvider(TRAIL);
    const res = await post(p, readBody('mixed'));
    assert.equal(res.status, 422);
    assert.equal(res.body.code, BLIND_READ_CODES.verdictWord);
    assert.match(res.body.error, /there is no fourth/);
    assert.deepEqual(p.calls, { createComment: 0, fetchIssueComments: 0 });
  });
  test('refuses a verdict with no reason', async () => {
    const res = await post(new FakeProvider(TRAIL), `${BLIND_READ_HEADING}\nVerdict: better.\n\nRead: ${PR} (${++uniq})`);
    assert.equal(res.body.code, BLIND_READ_CODES.reasonMissing);
  });
  test('refuses a read whose PR URLs differ from landingPrUrls, naming both sets', async () => {
    const p = new FakeProvider(TRAIL);
    const res = await post(p, readBody('same', [PR, OLD]));
    assert.equal(res.status, 422);
    assert.equal(res.body.code, BLIND_READ_CODES.prsMismatch);
    assert.deepEqual(res.body.expected, [PR]);
    assert.equal(p.calls.createComment, 0);
  });
  test('posts a read naming exactly the landing', async () => {
    const p = new FakeProvider(TRAIL);
    const res = await post(p, readBody('worse'));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(p.calls.fetchIssueComments, 1);
  });
  test('passes a review verdict that mentions the heading mid-comment, and never reads the trail for it', async () => {
    const p = new FakeProvider(TRAIL);
    const res = await post(p, `${review(5).body}\n\n${BLIND_READ_HEADING}\nVerdict: mixed (${++uniq})`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(p.calls.fetchIssueComments, 0);
  });
  test('never validates a `## Blind read pilot` tally as a read', async () => {
    const res = await post(new FakeProvider(TRAIL), `${BLIND_READ_HEADING} pilot\n\n- #2404 · same. Verdict: mixed (${++uniq})`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
  test('with a failed trail read, keeps the shape check and skips only the set check, with a log', async () => {
    const warned = [];
    const original = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    try {
      const failing = new FakeProvider(new Error('Comments for X could not be read whole'));
      const passed = await post(failing, readBody('same', [PR, OLD]));
      assert.equal(passed.status, 201, 'the set check is skipped');
      assert.ok(warned.some(w => /\[blind-read\].*PR-set check skipped/.test(w)), 'and logged');
      const refused = await post(new FakeProvider(new Error('down')), readBody('mixed'));
      assert.equal(refused.body.code, BLIND_READ_CODES.verdictWord, 'the shape check still holds');
    } finally {
      console.warn = original;
    }
  });
  test('PATCH is held to the same shape', async () => {
    const res = await post(new FakeProvider(TRAIL), readBody('mixed'), 'PATCH', `${ISSUE_ID}/comments/0c0c0c0c-0c0c-0c0c-0c0c-0c0c0c0c0c0c`);
    assert.equal(res.body.code, BLIND_READ_CODES.verdictWord);
  });
});
