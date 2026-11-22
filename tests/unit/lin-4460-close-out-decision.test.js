/**
 * LIN-4460 (piece 1 of LIN-4447): one close-out decision for every surface.
 *
 * `closeOutDecision` (lib/run-closeout-state.js) answers the close-out questions once. The surfaces that
 * ask it are: the task page's box (readRunEvidence → buildRunEvidence), the check route's read chain
 * (readCloseOutChain, actor 'person'), the stop-at guard lane and the ladder guard lane (closeOutNotReady),
 * and the recommendation's read (blindReadStep). The agreement table below runs each surface over the same
 * trails, with the input shape that surface really has, and writes each expected answer in its cell.
 *
 * LIN-4520: every trail is a records trail (the ticket's records, seeded by tests/helpers/records-scenario.js and read
 * by trailForTicket). The comment-shaped rows of the first version are kept as their records events: the expected
 * answers are the same. The real finished-run trails of tests/fixtures/run-ledger-trails.js are kept by name.
 *
 * Run with: node --test tests/unit/lin-4460-close-out-decision.test.js
 */
process.env.NODE_ENV = 'test';

import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeOutDecision, CLOSE_OUT_REASONS, CLOSE_OUT_REASON, CLOSE_OUT_STATUS, CLOSE_OUT_ACTOR,
} from '../../lib/run-closeout-state.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { readCloseOutChain, closeOutNotReady } from '../../lib/close-out-readiness.js';
import { blindReadStep } from '../../lib/recommendation-blind-read.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, ev } from '../helpers/records-scenario.js';
import { trailForTicket } from '../../lib/task-standing.js';

const harness = createMangoTmpdir('lin-4460-close-out-decision-');
before(() => harness.connect());
after(() => harness.close());

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const REVIEWED = 'aaaaaaa1111111';
const MOVED = 'bbbbbbb2222222';

const STARTED = { name: 'In Progress', type: 'started' };
const DONE = { name: 'Done', type: 'completed' };
const CANCELED = { name: 'Canceled', type: 'canceled' };

const prOf = (url) => ({ repo: REPO, number: Number(url.split('/').pop()) });
const statusOf = {
  open: (url, sha = REVIEWED) => ({ readable: true, ...prOf(url), state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] }),
  merged: (url) => ({ readable: true, ...prOf(url), state: 'closed', merged: true, head: { ref: 'f', sha: REVIEWED }, ref: REVIEWED, checks: [] }),
  unreadable: () => ({ readable: false, state: 'unknown', reason: 'private' }),
};

// The surfaces, each called the way it is really called. `shape` is the PR input: 'full' reads every PR
// the surface asks for, 'unreadable' fails every read. `stopAt` is the run's boundary.
function seamFor(readOne, stopAt) {
  return {
    resolveProvider: () => ({ provider: { name: 'local', async fetchIssueComments() { return []; } }, callScope: 'scope' }),
    readPrStatus: async ({ repo, number }) => readOne(`https://github.com/${repo}/pull/${number}`),
    isStopAtRun: async () => stopAt,
  };
}
const WORKSPACE = { urlKey: 'acme' };

// The ticket's events, as the records a stage writes (tests/helpers/records-scenario.js). Every PR is at REVIEWED when
// its event is written.
const evPr = (n, url = PR1) => ev.pr(n, url, REVIEWED);
const evReview = (n, outcome = 'approve', url = PR1) => ev.review(n, url, { outcome, heads: { [url]: REVIEWED } });
const evRead = (n, ...urls) => ev.read(n, urls.length ? urls : PR1);
const evClose = (n) => ev.close(n);
const evAudit = (n, url, head = REVIEWED) => ev.audit(n, url, head);

// Named ticket shapes, one per trail the surfaces are checked over.
const RESTING = [evPr(1), evReview(2)];                                  // approved, unmerged, no read on record
const READ = [evPr(1), evReview(2), evRead(3, PR1)];                     // approved, a read names the PR
const CHANGES = [evPr(1), evReview(2, 'request-changes')];               // request changes

/** The ticket's records trail (the one the gates read), for a given event list. */
async function trailOfEvents(events) {
  const recordsStore = await seededRecordsStore(harness, events, { urlKey: WORKSPACE.urlKey, tickets: ['LIN-1'] });
  return trailForTicket({ recordsStore, urlKey: WORKSPACE.urlKey, ticket: 'LIN-1' });
}

/** The surfaces over one ticket's records (`events`, LIN-4518 step 3): each reads the same store. */
async function surfaces(events, { shape = 'full', issue = STARTED, merged = [], movedHead = false } = {}) {
  const recordsStore = await seededRecordsStore(harness, events, { urlKey: WORKSPACE.urlKey, tickets: ['LIN-1'] });
  const trail = await trailForTicket({ recordsStore, urlKey: WORKSPACE.urlKey, ticket: 'LIN-1' });
  const readOne = (url) => (shape === 'unreadable' ? statusOf.unreadable()
    : (merged.includes(prOf(url).number) ? statusOf.merged(url) : statusOf.open(url, movedHead ? MOVED : REVIEWED)));
  const box = await readRunEvidence({
    openFindings: FINDINGS_NONE,
    issueIdentifier: 'LIN-1', comments: [], urlKey: WORKSPACE.urlKey, recordsStore, readPrStatus: async ({ repo, number }) => readOne(`https://github.com/${repo}/pull/${number}`),
    stopAt: 'pr', runnerReady: true, viewerIsOwner: true,
  });
  const check = await readCloseOutChain({
    openFindings: FINDINGS_NONE, recordsStore,
    workspace: WORKSPACE, issueIdentifier: 'LIN-1', seam: seamFor(readOne, 'pr'), stopAt: 'pr',
    runnerReady: true, owner: true, actor: CLOSE_OUT_ACTOR.PERSON, prStatusCache: new Map(),
  });
  const stopAtGuard = await closeOutNotReady({ openFindings: FINDINGS_NONE, recordsStore, workspace: WORKSPACE, issueIdentifier: 'LIN-1', seam: seamFor(readOne, 'pr') });
  const ladderGuard = await closeOutNotReady({ openFindings: FINDINGS_NONE, recordsStore, workspace: WORKSPACE, issueIdentifier: 'LIN-1', seam: seamFor(readOne, null) });
  const step = blindReadStep({ state: issue }, { trail, allRuns: [] });
  return {
    box: box.closeOut,
    check: check.state,
    stopAtGuard,
    ladderGuard,
    routesRead: step !== null,
  };
}

/** A guard's answer as the reason it refuses on, or null when it admits. */
const refusedOn = (guardAnswer) => (guardAnswer ? guardAnswer.reason : null);

// The synthetic trails. Each row writes its expected answer per shape, per surface.
//   box:   the page's status and refusal (the box reads the landing's sole PR; multi-PR reads none)
//   check: the person's check: status and setDone
//   stop-at lane / ladder lane: the refusal reason, or null (admits)
//   routesRead: whether the recommendation sends a blind read
const SYNTHETIC = [
  {
    name: 'approved, merged, no read on record',
    events: RESTING, merged: [41],
    full: { box: ['merged', null], check: ['merged', true], stopAt: null, ladder: 'blind-read-missing', routesRead: true },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: true },
  },
  {
    name: 'approved, open, a read names the PR',
    events: READ,
    full: { box: ['ready', null], check: ['ready', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'approved, open, no read on record',
    events: RESTING,
    full: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: true },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: true },
  },
  {
    name: 'request changes, open, no read',
    events: CHANGES,
    full: { box: ['not-ready', null], check: ['not-ready', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'approved, one landing PR merged and one open, no read (partial)',
    events: [evPr(1), evReview(2), evPr(3, PR2)], merged: [41],
    // Multi-PR: the box reads no PR (LIN-4458), so it reads the gate as not known merged.
    full: { box: ['not-ready', 'blind-read-missing'], check: ['partial', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: false },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: false },
  },
  {
    name: 'approved, open at a moved head, a read names the PR (head-moved)',
    events: READ, movedHead: true,
    full: { box: ['not-ready', 'head-moved'], check: ['not-ready', false], stopAt: 'head-moved', ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'empty landing: a review, and a PR named only as #N',
    // A verdict rests on a change, so the records of this row hold no PR and no review.
    events: [],
    full: { box: ['no-pr', null], check: ['no-pr', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['no-pr', null], check: ['no-pr', false], stopAt: null, ladder: null, routesRead: false },
  },
];

const REAL = [
  {
    name: 'LIN-3245: merged, approved, closed out on the trail (real trail)',
    merged: [1716], ticket: DONE,
    // The PR's review (approve) and its close-out, which merged it (the trail's own order).
    events: [ev.pr(1, PR(1716), REVIEWED), ev.review(2, PR(1716), { outcome: 'approve', heads: { [PR(1716)]: REVIEWED } }), ev.close(3), ev.merged(3, PR(1716))],
    full: { box: ['merged', null], check: ['merged', true], stopAt: null, ladder: 'blind-read-missing', routesRead: false },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: false },
  },
  {
    name: 'LIN-3247: request changes on a open PR (real trail)',
    events: [ev.pr(1, PR(1723), REVIEWED), ev.review(2, PR(1723), { outcome: 'request-changes', heads: { [PR(1723)]: REVIEWED } })],
    full: { box: ['not-ready', null], check: ['not-ready', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'LIN-3098: a review that names no PR by full URL (real trail)',
    // Its review names no PR by full URL, so the records of the ticket hold no PR to rest a verdict on.
    events: [],
    full: { box: ['no-pr', null], check: ['no-pr', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['no-pr', null], check: ['no-pr', false], stopAt: null, ladder: null, routesRead: false },
  },
];

function assertCell(row, shape, got, want) {
  const where = `${row.name} [${shape}]`;
  assert.deepEqual([got.box.status, got.box.refuses ?? null], want.box, `${where}: box (status, refuses)`);
  assert.deepEqual([got.check.status, got.check.setDone], want.check, `${where}: person's check (status, setDone)`);
  assert.equal(refusedOn(got.stopAtGuard), want.stopAt, `${where}: stop-at guard lane`);
  assert.equal(refusedOn(got.ladderGuard), want.ladder, `${where}: ladder guard lane`);
  assert.equal(got.routesRead, want.routesRead, `${where}: the recommendation's read`);
}

describe('the agreement table: every surface, over the same trails, with the expected answer in each cell (LIN-4460)', () => {
  for (const row of [...SYNTHETIC, ...REAL]) {
    for (const shape of ['full', 'unreadable']) {
      test(`${row.name} — ${shape} reads`, async () => {
        const got = await surfacesFor(row, shape, row.merged || []);
        assertCell(row, shape, got, row[shape]);
      });
    }
  }

  test('surfaces that hold the same facts agree: the box and the stop-at lane refuse the same way on every single-PR row', async () => {
    for (const row of SYNTHETIC.filter(r => !r.name.includes('partial') && !r.name.includes('empty'))) {
      for (const shape of ['full', 'unreadable']) {
        const got = await surfacesFor(row, shape, row.merged || []);
        assert.equal(got.box.refuses ?? null, refusedOn(got.stopAtGuard), `${row.name} [${shape}]: box and stop-at lane agree`);
      }
    }
  });
});

async function surfacesFor(row, shape, merged) {
  return surfaces(row.events, { shape, merged, issue: row.ticket || STARTED, movedHead: row.movedHead });
}

describe('dropping a fact never moves the passenger fact or the gate the wrong way (LIN-4460, Constraints)', () => {
  for (const row of SYNTHETIC.filter(r => r.name.startsWith('approved'))) {
    test(`${row.name}: an unreadable or missing status never turns followsPerson into 'merged' or clears waitsOn`, async () => {
      const trail = await trailOfEvents(row.events);
      const full = closeOutDecision({ openFindings: FINDINGS_NONE, trail, prStatuses: new Map(trail.landing.map(u => [u, statusOf.merged(u)])), actor: 'person' });
      const dropped = closeOutDecision({ openFindings: FINDINGS_NONE, trail, prStatuses: new Map(trail.landing.map(u => [u, statusOf.unreadable()])), actor: 'person' });
      const unread = closeOutDecision({ openFindings: FINDINGS_NONE, trail, prStatuses: new Map(), actor: 'person' });
      // An unreadable status that still carries a merged flag (review F1): the flag is not evidence.
      const unreadableMerged = closeOutDecision({
        openFindings: FINDINGS_NONE,
        trail, actor: 'person',
        prStatuses: new Map(trail.landing.map(u => [u, { readable: false, state: 'closed', merged: true }])),
      });
      for (const later of [dropped, unread, unreadableMerged]) {
        assert.notEqual(later.followsPerson, 'merged', 'followsPerson never moves from null to merged on a dropped fact');
        if (full.waitsOn === 'blind-read') assert.equal(later.waitsOn, 'blind-read', 'a dropped fact never clears the gate');
      }
      assert.equal(unreadableMerged.setDone, false, 'unreadable evidence carrying a merged flag never sets Done');
      if (full.waitsOn === 'blind-read') {
        assert.equal(unreadableMerged.waitsOn, 'blind-read', 'approved and unread: the gate holds on unreadable merged evidence');
      }
    });
  }
});

describe('the decision\'s rules, one per named case', () => {
  const decide = (trail, statuses, extra = {}) => closeOutDecision({ openFindings: FINDINGS_NONE, trail, prStatuses: new Map(statuses), ...extra });

  test('a person\'s check on a merged, approved, unread landing sets Done, and the stop-at lane stands aside', async () => {
    const decision = decide(await trailOfEvents(RESTING), [[PR1, statusOf.merged(PR1)]], { stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.PERSON });
    assert.equal(decision.setDone, true);
    assert.equal(decision.followsPerson, 'merged');
    assert.equal(decision.refuses, null, 'the gate stands aside on a merged landing');
    const got = await surfaces(RESTING, { merged: [41] });
    assert.equal(got.check.setDone, true, 'the check route sets Done');
    assert.equal(got.stopAtGuard, null, 'the stop-at lane admits');
  });

  test('approved, unmerged, unread: both guard lanes refuse blind-read-missing, whether or not the ticket is Done', async () => {
    for (const issue of [STARTED, DONE]) {
      const got = await surfaces(RESTING, { issue });
      assert.equal(refusedOn(got.stopAtGuard), 'blind-read-missing', `stop-at lane, ${issue.type}`);
      assert.equal(refusedOn(got.ladderGuard), 'blind-read-missing', `ladder lane, ${issue.type}`);
      assert.equal(got.check.setDone, false, `no Done from an unmerged landing, ${issue.type}`);
    }
  });

  test('a person\'s check without an approving review sets no Done', async () => {
    const decision = decide(await trailOfEvents(CHANGES), [[PR1, statusOf.merged(PR1)]], { actor: CLOSE_OUT_ACTOR.PERSON });
    assert.equal(decision.setDone, false);
  });

  test('head-moved refuses both actors: the person\'s check and Harbour', async () => {
    const trail = await trailOfEvents(READ);
    const statuses = [[PR1, statusOf.open(PR1, MOVED)]];
    for (const actor of [CLOSE_OUT_ACTOR.PERSON, CLOSE_OUT_ACTOR.HARBOUR]) {
      const decision = decide(trail, statuses, { stopAt: 'pr', runnerReady: true, actor });
      assert.equal(decision.refuses, 'head-moved', actor);
      assert.equal(decision.setDone, false, actor);
    }
  });

  test('an unreadable PR keeps the blind-read gate in place, but unreadability alone never refuses', async () => {
    const unreadBlind = decide(await trailOfEvents(RESTING), [[PR1, statusOf.unreadable()]], { stopAt: 'pr', runnerReady: true });
    assert.equal(unreadBlind.refuses, 'blind-read-missing', 'the gate still holds');
    const unreadRead = decide(await trailOfEvents(READ), [[PR1, statusOf.unreadable()]], { stopAt: 'pr', runnerReady: true });
    assert.equal(unreadRead.refuses, null, 'a read on record, the unreadable PR alone refuses nothing');
    assert.equal(unreadRead.status, CLOSE_OUT_STATUS.UNKNOWN);
  });

  test('Harbour never sets Done, even on a merged, approved landing with nothing else open', async () => {
    const decision = decide(await trailOfEvents(READ), [[PR1, statusOf.merged(PR1)]], { actor: CLOSE_OUT_ACTOR.HARBOUR });
    assert.equal(decision.setDone, false);
    assert.equal(decision.status, CLOSE_OUT_STATUS.MERGED);
  });

  test('the empty-landing witness: no PR on the landing is no merged evidence, so no merge, no Done and no stand-aside', async () => {
    const trail = await trailOfEvents([]);
    assert.deepEqual(trail.landing, [], 'the landing is empty');
    const decision = decide(trail, [], { actor: CLOSE_OUT_ACTOR.PERSON });
    assert.equal(decision.status, CLOSE_OUT_STATUS.NO_PR);
    assert.equal(decision.setDone, false);
    assert.equal(decision.followsPerson, null, 'an empty landing is not merged');
    assert.equal(decision.refuses, null);
  });

  test('a ticket\'s state never reaches enforcement: Done, Canceled and In Progress answer the same for refuses and setDone', async () => {
    const trail = await trailOfEvents(RESTING);
    const statuses = [[PR1, statusOf.open(PR1)]];
    const base = decide(trail, statuses, { stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.PERSON });
    for (const ticketState of ['completed', 'canceled', 'started', null]) {
      const d = decide(trail, statuses, { stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.PERSON, ticketState });
      assert.equal(d.refuses, base.refuses, `refuses, ${ticketState}`);
      assert.equal(d.setDone, base.setDone, `setDone, ${ticketState}`);
      assert.equal(d.waitsOn, base.waitsOn, `waitsOn, ${ticketState}`);
    }
  });

  test('a landing PR cited outside the landing is not read by the decision (LIN-4458: the landing decides)', async () => {
    const trail = await trailOfEvents(READ);
    const d = decide(trail, [[PR1, statusOf.merged(PR1)], [PR2, statusOf.open(PR2)]], { actor: CLOSE_OUT_ACTOR.PERSON });
    assert.equal(d.setDone, true, 'an open PR2 outside the landing does not withhold Done');
  });

  test('the reasons come in precedence order, frozen, each with its copy', () => {
    assert.ok(Object.isFrozen(CLOSE_OUT_REASONS));
    assert.deepEqual(CLOSE_OUT_REASONS.map(r => r.reason), [
      'blind-read-missing', 'pr-unreadable', 'pr-not-open', 'multiple-prs', 'head-moved', 'open-findings',
      'not-stop-at-run', 'review-not-approve', 'runner-not-set-up',
    ]);
    for (const r of CLOSE_OUT_REASONS) assert.equal(typeof r.message, 'function', r.reason);
    assert.equal(Object.isFrozen(CLOSE_OUT_REASON), true);
  });
});

describe('the recommendation\'s read: the decision\'s advice answer (LIN-4460, row 196 and the audit-after-Done case)', () => {
  const AUDITED = [evPr(1), evReview(2), evClose(3), ev.merged(3, PR1), evAudit(4, PR2), evReview(5, 'approve', PR2)];
  const doneNoClose = { name: 'Done, no close-out on the landing, no audit notes PR (row 196, first half, flipped)', state: DONE, events: RESTING, route: false };
  const doneClosed = { name: 'Done, a close-out after the review (row 196, second half, unchanged)', state: DONE, events: [evPr(1), evReview(2), evClose(3), ev.merged(3, PR1)], route: false };
  const doneAudit = { name: 'Done, then an audit\'s notes PR and its review: still read (added)', state: DONE, events: AUDITED, route: true };
  const canceled = { name: 'Canceled', state: CANCELED, events: RESTING, route: false };
  const started = { name: 'In Progress, approved, unread', state: STARTED, events: RESTING, route: true };

  for (const row of [doneNoClose, doneClosed, doneAudit, canceled, started]) {
    test(`${row.name}: routesRead is ${row.route}`, async () => {
      const step = blindReadStep({ state: row.state }, { trail: await trailOfEvents(row.events), allRuns: [] });
      assert.equal(step !== null, row.route);
    });
  }

  test('ticket unknown routes like In Progress, with no passenger loosening (review F2b)', async () => {
    assert.notEqual(blindReadStep({}, { trail: await trailOfEvents(RESTING), allRuns: [] }), null);
  });

  test('Done alone does not stand the enforcement gate aside: an approved, unmerged, unread landing is still refused (both lanes)', async () => {
    const got = await surfaces(RESTING, { issue: DONE });
    assert.equal(refusedOn(got.stopAtGuard), 'blind-read-missing');
    assert.equal(refusedOn(got.ladderGuard), 'blind-read-missing');
    assert.equal(got.routesRead, false, 'the recommendation stands aside, the enforcement still holds');
  });

  test('lin4447-recommend-path-outside-merge: an outside merge on a ticket still In Progress still routes the read (John\'s accepted limit, 13 Nov)', async () => {
    // The PR is merged outside Harbour. The recommend path reads no PR and the ladder lane reads none (John:
    // "Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up").
    const step = blindReadStep({ state: STARTED }, { trail: await trailOfEvents(RESTING), allRuns: [] });
    assert.equal(step?.step, 'blind-read', 'the read is routed');
    const ladder = await surfaces(RESTING, { issue: STARTED, merged: [41] });
    assert.equal(refusedOn(ladder.ladderGuard), 'blind-read-missing', 'the ladder lane still refuses');
    // A stop-at lane that reads the PR does see the merge and stands aside: the limit is the recommend path and ladder only.
    assert.equal(ladder.stopAtGuard, null, 'the stop-at lane, which reads the landing, stands aside');
  });
});

describe('census: the close-out rules live in one module (LIN-4460)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..');
  const OWNER = 'lib/run-closeout-state.js';
  const SCANNED = ['lib', 'routes', 'scripts', 'public'];

  function filesUnder(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...filesUnder(path));
      else if (/\.(js|mjs)$/.test(name)) out.push(path);
    }
    return out;
  }
  // Code only: block comments and whole-line or trailing `//` comments are prose, not a call or an import.
  const codeOf = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*)/.test(line))
    .map(line => line.replace(/\s\/\/.*$/, ''))
    .join('\n');
  const sources = () => SCANNED.flatMap(d => filesUnder(join(root, d)))
    .map(path => ({ rel: relative(root, path).split('\\').join('/'), text: codeOf(readFileSync(path, 'utf8')) }))
    .filter(f => f.rel !== OWNER && !f.rel.includes('.test.'));

  test('no close-out reason is spelled outside the owner (calls and literals, not prose)', () => {
    const reasons = CLOSE_OUT_REASONS.map(r => r.reason).filter(r => r !== 'multiple-prs');
    const hits = [];
    for (const { rel, text } of sources()) {
      for (const reason of reasons) {
        const literal = new RegExp(`['"\`]${reason}['"\`]`);
        if (literal.test(text)) hits.push(`${rel}: '${reason}'`);
      }
    }
    assert.deepEqual(hits, []);
  });

  test('no closeOutWaitsOn call outside the owner; the gate is asked through closeOutDecision', () => {
    const hits = sources().filter(({ text }) => /closeOutWaitsOn\(/.test(text)).map(f => f.rel);
    assert.deepEqual(hits, []);
  });

  test('no byPersonCheck, closeOutSetsDone or REFUSED_REASONS anywhere in the sources', () => {
    const hits = sources().filter(({ text }) => /byPersonCheck|closeOutSetsDone|REFUSED_REASONS/.test(text)).map(f => f.rel);
    assert.deepEqual(hits, []);
  });
});
