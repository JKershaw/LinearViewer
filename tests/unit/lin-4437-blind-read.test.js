/**
 * LIN-4437 (piece 2 of LIN-4396): the `blind-read` stage, sent by hand. Nothing gates on it yet.
 *
 *   - LIN-4520: a read's verdict is a records verdict (`trail.review.blindRead`, lib/task-standing.js), and its PR set is
 *     lib/run-ledger.js checkBlindReadPrs against the records landing. The comment-shape readers (the verdict line, the
 *     verdict word, the reason, the repeated verdict) and the comment landing and kind readers are retired, and their
 *     cases are gone; the records-side cases below replace them;
 *   - witness 1: a read is never landing work and never an answer to a person (no loop, no silenced
 *     person), down to the selector's rendered facts with runs known;
 *   - witness 2: the read is blind: the prompt and its preamble carry no ticket text, no attachment
 *     title and no brief or issue-read hint;
 *   - the prompt is the piloted text (tests/fixtures/blind-read-piloted.txt, frozen from #2407) but for
 *     its fill-ins and the Where-to-stand sentence;
 *   - the proxy holds the PR set of a read, and with a failed records read keeps the no-PR check and skips
 *     only the PR-set check, with a log;
 *   - the run-evidence box shows the records blind read;
 *   - a live blind read holds the live-stage wait; the churn and round-trip readers place it.
 */
process.env.NODE_ENV = 'test';

import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { test, describe, before, after } from 'node:test';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, recordsStoreFor, seedTicketRecords, ev } from '../helpers/records-scenario.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BLIND_READ_CODES } from '../../lib/run-ledger.js';
import { isPersonComment, opensAsBlindRead } from '../../lib/run-trail.js';
import { BLIND_READ_HEADING } from '../../lib/prompts/blind-read-words.js';
import { SURVEY_HEADINGS } from '../../lib/prompts/survey-words.js';
import { assembleTrailFacts, planReviewFactsOf } from '../../lib/recommendation-facts.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { planRound } from '../helpers/plan-review-loop.js';
import { trailForTicket } from '../../lib/task-standing.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { recentRuns, stageRuns } from '../../lib/recent-runs.js';
import { liveWaitOf } from '../../lib/run-live-wait.js';
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

const harness = createMangoTmpdir('lin-4437-blind-read-');
before(() => harness.connect());
after(() => harness.close());

const PR = 'https://github.com/JKershaw/LinearViewer/pull/77';
const PR2 = 'https://github.com/JKershaw/LinearViewer/pull/78';
const OLD = 'https://github.com/JKershaw/LinearViewer/pull/12';
const FOREIGN = 'https://github.com/other/repo/pull/5';
const at = (h) => `2026-11-12T${String(h).padStart(2, '0')}:00:00.000Z`;
const c = (h, body, id = `c${h}`) => ({ id, body, createdAt: at(h) });

const review = (h, verdict = 'Approve', pr = PR) => c(h, `## Review — LIN-1\n\n${pr}\n\n**Verdict:** ${verdict}\n\n### What CI Did Not Prove\n\nNone.`);
const summary = (h, pr = PR) => c(h, `Implementation done: ${pr} at \`abc1234\`.`);
const read1 = (h, prs = [PR], verdict = 'better') => c(h, `${BLIND_READ_HEADING}\nVerdict: ${verdict}. The change gave the parser one owner in \`lib/a.js\`; it left a stale comment in \`lib/b.js\`.\n\nRead: ${prs.join(', ')} at \`abc\` against \`def\`.\n\n### Inside the area, fix-sized\nNone.`);

/** The ticket's records trail for `events` (LIN-4518 step 3): seeded into a fresh store, read the way the gates read it. */
async function trailOf(events) {
  const recordsStore = await recordsStoreFor(harness);
  await seedTicketRecords(recordsStore, 'acme', 'LIN-1', events);
  return trailForTicket({ recordsStore, urlKey: 'acme', ticket: 'LIN-1' });
}

describe('a read is recognised by its opening, and is no person\'s comment (opensAsBlindRead, isPersonComment)', () => {
  test('a well-formed read opens as a blind read and is not a person\'s comment', () => {
    assert.equal(opensAsBlindRead(read1(1)), true);
    assert.equal(isPersonComment(read1(1).body), false);
  });
  test('the heading is matched exactly: a longer heading, or a mention further down, is not a read', () => {
    assert.equal(opensAsBlindRead(c(1, `${BLIND_READ_HEADING} pilot\nVerdict: mixed`)), false);
    assert.equal(opensAsBlindRead(c(1, review(1).body + `\n\nThe ${BLIND_READ_HEADING} comment said same.\nVerdict: mixed`)), false);
    assert.equal(opensAsBlindRead(c(1, `\n\n${BLIND_READ_HEADING}: LIN-1\nVerdict: same. a b c ${PR}`)), true, 'a `:` tail, after blank lines');
  });
});

describe('the landing is the records landing, which decides the PR set of a read (LIN-4520; was the comment landing)', () => {
  test('no review: every change on the task is the landing', async () => {
    assert.deepEqual([...(await trailOf([ev.pr(1, OLD, 'h'), ev.pr(2, PR, 'h')])).landing].sort(), [OLD, PR].sort());
  });
  test('the anchor is the latest close-out before the latest review: the merged earlier PR leaves the landing', async () => {
    const trail = await trailOf([ev.pr(1, OLD, 'h'), ev.review(2, OLD), ev.close(3), ev.merged(3, OLD), ev.pr(4, PR, 'h'), ev.review(5, PR)]);
    assert.deepEqual(trail.landing, [PR]);
  });
  test('a close-out after the latest review never resets scope', async () => {
    assert.deepEqual((await trailOf([ev.pr(1, PR, 'h'), ev.review(2, PR), ev.close(3)])).landing, [PR]);
  });
  test('a not-ready close-out before a re-review keeps the PR re-named by the fix round', async () => {
    assert.deepEqual((await trailOf([ev.pr(1, PR, 'h'), ev.review(2, PR), ev.close(3), ev.review(5, PR)])).landing, [PR]);
  });
  test('a blind read and a Survey report never carry the landing (the LIN-4396 note-1 decision)', async () => {
    // A Survey is a run of its stage and writes no change; a read is a verdict on the landing's change.
    assert.deepEqual((await trailOf([ev.run(0, 'survey-task'), ev.pr(1, PR, 'h'), ev.review(2, PR), ev.read(3, PR)])).landing, [PR]);
  });
  test('kept on purpose: a change for a foreign-repository PR before the first review joins the landing (narrowing by repo needs a repo no caller holds)', async () => {
    assert.deepEqual([...(await trailOf([ev.pr(0, FOREIGN, 'h'), ev.pr(1, PR, 'h'), ev.review(2, PR)])).landing].sort(), [FOREIGN, PR].sort());
  });
});

describe('the blind read on record is the one after the latest review (LIN-4520; was latestBlindRead over the comments)', () => {
  test('the newest read after the latest review is the one on record', async () => {
    const trail = await trailOf([ev.pr(1, PR, 'h'), ev.review(2, PR), ev.read(3, PR, { outcome: 'worse' }), ev.read(4, PR, { outcome: 'same' })]);
    assert.equal(trail.review.blindRead.verdict, 'same');
  });
  test('a read before the latest review is not on record for it', async () => {
    const trail = await trailOf([ev.pr(1, PR, 'h'), ev.review(2, PR), ev.read(3, PR), ev.review(5, PR)]);
    assert.equal(trail.review.blindRead, null);
  });
});

describe('no local copies: recommendation-facts imports the moved readers', () => {
  // LIN-4458 moved the openings to lib/run-trail.js; tests/unit/lin-4458-comment-kind-census.test.js
  // holds every file to it. This keeps the original pin on the two files it named.
  test('the close-out opening, firstHeading and firstLineOf are defined only in lib/run-trail.js', () => {
    for (const file of ['lib/recommendation-facts.js', 'lib/run-ledger.js']) {
      for (const name of ['isCloseOut', 'firstHeading', 'firstLineOf']) {
        assert.doesNotMatch(read(file), new RegExp(`(?:function|const)\\s+${name}\\b`), `${file}: ${name} has no local definition`);
      }
    }
    assert.match(read('lib/run-trail.js'), /const firstLineOf\b/);
    assert.match(read('lib/run-trail.js'), /function firstHeading\b/);
  });
});

describe('witness 1: a read is never landing work, never an answer to a person', () => {
  const person = c(3, 'Please keep the old flag; we still read it in the export.');
  const comments = [summary(1), review(2), person, read1(4)];
  const events = [ev.pr(1, PR, 'abc1234'), ev.review(2, PR), ev.read(4, PR)];
  const rows = [
    { id: 'r-review', kind: 'review', status: 'taken', dispatchedAt: at(1), feedback: [{ message: '[done] reviewed', timestamp: at(2) }] },
    { id: 'r-read', kind: 'blind-read', status: 'taken', dispatchedAt: at(3), feedback: [{ message: '[done] posted the read', timestamp: at(4) }] }
  ];

  test('workAfterReview is false and the latest person\'s comment is not acted on', async () => {
    const trail = await trailOf(events);
    const f = assembleTrailFacts(comments, '', { trail });
    assert.equal(f.workAfterReview, false);
    assert.equal(f.latestPerson.at, at(3));
    assert.equal(f.latestPerson.actedAfter, false);
  });

  test('the plan-review landed fact is unchanged by a read', () => {
    const run = planReviewRunOf({ verdicts: [planRound(at(0), 'approve').verdict], findings: [] });
    assert.deepEqual(planReviewFactsOf(run, [person, read1(4)]), planReviewFactsOf(run, [person]));
  });

  test('the selector\'s rendered facts, with runs known, show no blind-read line and no run after the person', async () => {
    const trail = await trailOf(events);
    const runs = recentRuns(rows);
    assert.deepEqual(runs.map(r => r.stage), ['review'], 'selectorSlice leaves the read out');
    assert.equal(stageRuns(rows).length, 2, 'allRuns keeps it');
    const { facts } = buildSelectorArgs({ identifier: 'LIN-1', title: 'T', description: '', state: {}, labels: [] }, { comments, runs, trail });
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
    attachments: [{ id: 'att:1', title: 'TOKEN_ATTACH_7731', kind: 'file' }],
    landingChanges: [{ id: 'change-pr77', ref: PR, head: 'abc1234' }],
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
      // The verdict record (LIN-4518 step 2) names the ticket as its `in`, the place a record goes, not a text to read.
      assert.match(line, /the comment below on LIN-9|one comment on LIN-9|LIN-9 is where it goes|linked on LIN-9|"in": "LIN-9"/, line);
    }
  });
  test('the skip is the blind read\'s alone: another stage still renders the attachments', () => {
    assert.match(generatePrompt('survey-task', issue, context).prompt, /## Attachments/);
  });
});

const WHERE_EACH_FIND_GOES = "**Where each find goes.** A find inside the change's own area that one sitting on this branch could fix, without changing the change's design (a few lines in one or two files, and no new decision), is a finding `to` `close-out` on this ticket. A find that needs a decision, a new design or several areas, or any find outside the change's area, is a finding `to` `project`, with `says` naming its file and area. You only record; someone else acts on each find.";

describe('the prompt is the piloted text', () => {
  test('the render keeps every paragraph of the frozen pilot but the ones LIN-4495 changed (the finds are records now)', () => {
    const pilot = read('tests/fixtures/blind-read-piloted.txt');
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { landingChanges: [{ id: 'change-pr77', ref: PR, head: 'abc1234' }] }).prompt;
    const body = prompt.slice(prompt.indexOf('## Process\n\n') + '## Process\n\n'.length);
    const [repo, lead, ...rest] = pilot.trimEnd().split('\n\n');
    assert.ok(prompt.includes(`## Goal\n${lead}\n`), 'the lead is the pilot\'s second paragraph');
    // LIN-4495: these paragraphs are the cutover's: the Areas sentence (its finds), the three-class sort, the rules line
    // (no class sections in the comment) and the class headings. Each is checked by its own rendered words below.
    // LIN-4520: the read-only line names the comment and the verdict record, the verdict paragraph names the record, and the
    // comment is its heading and Read line only (the verdict line is gone).
    const CHANGED = ['**Where to stand.**', '**Areas.**', '**Sort each find', 'You only sort', 'Rules for the comment:', '### ', '**This is read-only.**', '**The verdict**', '## Blind read'];
    const fill = (t) => t.replace('{DESTINATION}', 'Your outputs are one comment on LIN-9, the comment below, and the finds you record as findings (the hand-off protocol says how). LIN-9 is where the comment goes, not something to read.').replaceAll('{PRS}', PR);
    for (const p of rest.filter(q => !CHANGED.some(c => q.startsWith(c)))) {
      assert.ok(body.includes(fill(p)), `unchanged pilot paragraph: ${p.slice(0, 60)}`);
    }
    assert.ok(body.includes(WHERE_EACH_FIND_GOES), 'the routing paragraph is the rendered one');
    assert.ok(body.includes('Rules for the comment: its first line is exactly `## Blind read`'), 'the rules line keeps its opening');
    assert.doesNotMatch(body, /### Inside the area|### Outside the area/, 'no class sections in the comment');
    assert.match(prompt, /## Goal/);
    assert.match(body.split('\n\n').find(q => q.startsWith('**Where to stand.**')), /git fetch origin pull\/<number>\/head/);
  });
  test('where each find goes is the records routing (LIN-4495), and the unmapped-path find is worded by the consequence test', () => {
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { landingChanges: [{ id: 'change-pr77', ref: PR, head: 'abc1234' }] }).prompt;
    assert.ok(prompt.includes('An unmapped path\'s find is a find outside the change\'s area'));
    assert.ok(CONSEQUENCE_TEST.includes('Word an outside find'), 'the consequence test words the outside find');
    assert.ok(LEFTOVER_RULE.includes('a finding'), 'the leftover rule routes a find to a finding');
  });
  test('with no PR on the landing the prompt says so and the run ends [skipped]', () => {
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { landingChanges: [] }).prompt;
    assert.match(prompt, /\*\*Nothing to read\.\*\*/);
    assert.match(prompt, /`\[skipped\]`/);
    assert.doesNotMatch(prompt, /Repository:/);
  });
  test('the landing\'s repository names the Repository line; the pilot file is a pointer now', () => {
    const prompt = generatePrompt('blind-read', { identifier: 'LIN-9', state: {}, labels: [] }, { landingChanges: [{ id: 'change-foreign', ref: FOREIGN, head: null }, { id: 'change-pr77', ref: PR, head: null }] }).prompt;
    assert.match(prompt, /^Repository: other\/repo, JKershaw\/LinearViewer\. /m);
    assert.doesNotMatch(read('docs/plans/survey/blind-read-prompt.md'), /^```$/m, 'no second live copy of the prompt');
  });
});

describe('the records carry the read (LIN-4520: the box and the route read the review\'s blind read)', () => {
  const withRead = [ev.pr(1, PR), ev.review(2, PR), ev.read(3, PR, { outcome: 'same' })];
  test('the records review carries its blind read; no review, or no read after it, carries none', async () => {
    assert.equal((await trailOf(withRead)).review.blindRead.verdict, 'same');
    assert.equal((await trailOf([ev.pr(1, PR), ev.review(2, PR)])).review.blindRead, null);
  });
  test('buildRunEvidence carries it, and the fragment shows the verdict, or none on record', async () => {
    const model = buildRunEvidence({ openFindings: FINDINGS_NONE, trail: await trailOf(withRead), issueIdentifier: 'LIN-1' });
    assert.equal(model.ledger.blindRead.verdict, 'same');
    assert.equal(model.evidence.checked.blindRead.verdict, 'same');
    const html = renderRunEvidence(model);
    assert.match(html, /data-testid="run-evidence-checked-blind-read-verdict">same</);
    const none = renderRunEvidence(buildRunEvidence({ openFindings: FINDINGS_NONE, trail: await trailOf([ev.pr(1, PR), ev.review(2, PR)]), issueIdentifier: 'LIN-1' }));
    assert.match(none, /no blind read on record/);
  });
});

describe('the run readers place a blind read', () => {
  test('a live blind read holds the live-stage wait', () => {
    const wait = liveWaitOf(stageRuns([{ id: 'b1', kind: 'blind-read', status: 'pending', dispatchedAt: at(1) }]));
    assert.equal(wait.wait.kind, 'blind-read');
  });
  test('a blind read sent by hand between a Request Changes review and the fix round does not flip the review\'s verdict', () => {
    // The review's verdict is the records verdict (judgement review, outcome request-changes), not the next pipeline row,
    // so the read between the review and the fix round does not turn it into an approval.
    const issue = {
      id: 'i', identifier: 'LIN-1', description: '', comments: [],
      verdictFacts: { measured: true, verdicts: [{ id: 'v-rc', judgement: 'review', outcome: 'request-changes', at: at(2), state: 'stands', in: 'task', on: [] }] },
      rows: [
        { id: 'rv', kind: 'review', status: 'taken', dispatchedAt: at(1), completedAt: at(2) },
        { id: 'br', kind: 'blind-read', status: 'taken', dispatchedAt: at(3), completedAt: at(4) },
        { id: 'im', kind: 'implementation', status: 'taken', dispatchedAt: at(5), completedAt: at(6) }
      ]
    };
    const out = computeIssueRoundTrips(issue, { asOf: at(9), gateKind: 'review', rePassKind: 'implementation', verdictRecordsSince: '2026-11-01T00:00:00.000Z' });
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

// ── The proxy holds a read's PR set (routes/proxy-writes.js refusedByBlindRead, checkBlindReadPrs) ──────────────
const URL_KEY = 'acme-4437';
const ISSUE_ID = '44374437-4437-4437-4437-443744374437';
class FakeProvider extends ProviderInterface {
  constructor() {
    super();
    this.name = 'fake';
    this.calls = { createComment: 0, fetchIssueComments: 0 };
    this.createComment = async (token, issueId, body) => { this.calls.createComment++; return { id: `n-${this.calls.createComment}`, body, createdAt: at(9), user: { name: 'Agent' } }; };
    this.updateComment = async (token, id, body) => ({ id, body });
    this.issueWriteGuard = async () => ({ id: ISSUE_ID, team: { id: 't' } });
    this.fetchIssueComments = async () => {
      this.calls.fetchIssueComments++;
      return [summary(1), review(2)];
    };
  }
}
function buildApp(provider, recordsStore = null) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    recordsStore,
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {}, recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} }, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(), workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }, provider,
  }));
  return app;
}
// The ticket's records (LIN-4518 step 3): the landing is PR 77, a review on it. `records` overrides the store.
const LANDING = [ev.pr(1, PR, 'abc1234'), ev.review(2, PR)];
async function post(provider, body, method = 'POST', path = `${ISSUE_ID}/comments`, records = null) {
  const recordsStore = records ?? await seededRecordsStore(harness, LANDING, { urlKey: URL_KEY, tickets: [ISSUE_ID] });
  const server = buildApp(provider, recordsStore).listen(0, '127.0.0.1');
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
const NO_PR_READ = (n) => `${BLIND_READ_HEADING}\n\nI read the change and it is fine. No link given (${n}).`;

describe('the proxy holds a read\'s PR set', () => {
  test('refuses a read that names no PR by full URL with 422, before any trail read, and posts nothing', async () => {
    const p = new FakeProvider();
    const res = await post(p, NO_PR_READ(++uniq));
    assert.equal(res.status, 422);
    assert.equal(res.body.code, BLIND_READ_CODES.prsMissing);
    assert.deepEqual(p.calls, { createComment: 0, fetchIssueComments: 0 });
  });
  test('refuses a read whose PR URLs differ from the records landing, naming both sets', async () => {
    const p = new FakeProvider();
    const res = await post(p, readBody('same', [PR, OLD]));
    assert.equal(res.status, 422);
    assert.equal(res.body.code, BLIND_READ_CODES.prsMismatch);
    assert.deepEqual(res.body.expected, [PR]);
    assert.equal(p.calls.createComment, 0);
  });
  test('posts a read naming exactly the landing, and reads no comment for the set check', async () => {
    const p = new FakeProvider();
    const res = await post(p, readBody('worse'));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // The landing is read from the records (LIN-4518 step 3): no comment read for the set check.
    assert.equal(p.calls.fetchIssueComments, 0);
  });
  test('passes a review verdict that mentions the heading mid-comment, and never reads the trail for it', async () => {
    const p = new FakeProvider();
    const res = await post(p, `${review(5).body}\n\n${BLIND_READ_HEADING}\nVerdict: mixed (${++uniq})`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(p.calls.fetchIssueComments, 0);
  });
  test('never validates a `## Blind read pilot` tally as a read', async () => {
    const res = await post(new FakeProvider(), `${BLIND_READ_HEADING} pilot\n\n- #2404 · same. Verdict: mixed (${++uniq})`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
  test('with a failed records read, skips only the PR-set check, with a log; the no-PR check still holds', async () => {
    const warned = [];
    const original = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    try {
      const failingStore = { async taskForTicket() { throw new Error('the store is down'); } };
      const passed = await post(new FakeProvider(), readBody('same', [PR, OLD]), 'POST', `${ISSUE_ID}/comments`, failingStore);
      assert.equal(passed.status, 201, 'the set check is skipped');
      assert.ok(warned.some(w => /\[blind-read\].*PR-set check skipped/.test(w)), 'and logged');
      const refused = await post(new FakeProvider(), NO_PR_READ(++uniq), 'POST', `${ISSUE_ID}/comments`, failingStore);
      assert.equal(refused.body.code, BLIND_READ_CODES.prsMissing, 'the no-PR check holds without the records');
    } finally {
      console.warn = original;
    }
  });
  test('PATCH is held to the same PR-set check', async () => {
    const res = await post(new FakeProvider(), NO_PR_READ(++uniq), 'PATCH', `${ISSUE_ID}/comments/0c0c0c0c-0c0c-0c0c-0c0c-0c0c0c0c0c0c`);
    assert.equal(res.body.code, BLIND_READ_CODES.prsMissing);
  });
});
