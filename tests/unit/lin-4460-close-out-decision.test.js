/**
 * LIN-4460 (piece 1 of LIN-4447): one close-out decision for every surface.
 *
 * `closeOutDecision` (lib/run-closeout-state.js) answers the close-out questions once. The surfaces that
 * ask it are: the task page's box (readRunEvidence → buildRunEvidence), the check route's read chain
 * (readCloseOutChain, actor 'person'), the stop-at guard lane and the ladder guard lane (closeOutNotReady),
 * and the recommendation's read (blindReadStep). The agreement table below runs each surface over the same
 * trails, with the input shape that surface really has, and writes each expected answer in its cell.
 *
 * The trails are the synthetic shapes the blind-read gate uses, plus three real finished-run trails from
 * tests/fixtures/run-ledger-trails.js (verbatim tracker comments, LIN-3245, LIN-3247, LIN-3098).
 *
 * Run with: node --test tests/unit/lin-4460-close-out-decision.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeOutDecision, deriveCloseOutState, CLOSE_OUT_REASONS, CLOSE_OUT_REASON, CLOSE_OUT_STATUS, CLOSE_OUT_ACTOR,
} from '../../lib/run-closeout-state.js';
import { readTrail } from '../../lib/run-trail.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { readCloseOutChain, closeOutNotReady } from '../../lib/close-out-readiness.js';
import { blindReadStep } from '../../lib/recommendation-blind-read.js';
import { RUN_COMMENT_TRAILS } from '../fixtures/run-ledger-trails.js';

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const REVIEWED = 'aaaaaaa1111111';
const MOVED = 'bbbbbbb2222222';
const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const summary = (n, url = PR1) => c(n, `Implementation done: ${url}, CI green.`);
const review = (n, verdict = 'Approve', url = PR1) => c(n, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${url}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: ${verdict}**`);
const read = (n, ...urls) => c(n, `## Blind read\nVerdict: same. It gave the gate one owner in lib/run-closeout-state.js and left nothing worse.\n\nRead: ${urls.join(', ')} at \`${REVIEWED.slice(0, 9)}\` against \`000000000\`.\n\n### Inside the area, fix-sized\nNone.`);
const closeOut = (n, body) => c(n, `## Close-out\n\n${body}`);
const link = (n) => c(n, `PR to merge: ${PR2}`);
const audit = (n) => c(n, `## Retrospective audit — LIN-1\n\nThe landing ${PR1} holds; one note entry is wrong. Notes PR: ${PR2}.`);

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
function seamFor(comments, readOne, stopAt) {
  return {
    resolveProvider: () => ({ provider: { name: 'local', async fetchIssueComments() { return comments; } }, callScope: 'scope' }),
    readPrStatus: async ({ repo, number }) => readOne(`https://github.com/${repo}/pull/${number}`),
    isStopAtRun: async () => stopAt,
  };
}
const WORKSPACE = { urlKey: 'acme' };

async function surfaces(comments, { shape = 'full', issue = STARTED, merged = [], movedHead = false } = {}) {
  const readOne = (url) => (shape === 'unreadable' ? statusOf.unreadable()
    : (merged.includes(prOf(url).number) ? statusOf.merged(url) : statusOf.open(url, movedHead ? MOVED : REVIEWED)));
  const box = await readRunEvidence({
    issueIdentifier: 'LIN-1', comments, readPrStatus: async ({ repo, number }) => readOne(`https://github.com/${repo}/pull/${number}`),
    stopAt: 'pr', runnerReady: true, viewerIsOwner: true,
  });
  const check = await readCloseOutChain({
    workspace: WORKSPACE, issueIdentifier: 'LIN-1', seam: seamFor(comments, readOne, 'pr'), stopAt: 'pr',
    runnerReady: true, owner: true, actor: CLOSE_OUT_ACTOR.PERSON, prStatusCache: new Map(),
  });
  const stopAtGuard = await closeOutNotReady({ workspace: WORKSPACE, issueIdentifier: 'LIN-1', seam: seamFor(comments, readOne, 'pr') });
  const ladderGuard = await closeOutNotReady({ workspace: WORKSPACE, issueIdentifier: 'LIN-1', seam: seamFor(comments, readOne, null) });
  const step = blindReadStep({ state: issue }, { comments, allRuns: [] });
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
    comments: [summary(1), review(2)], merged: [41],
    full: { box: ['merged', null], check: ['merged', true], stopAt: null, ladder: 'blind-read-missing', routesRead: true },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: true },
  },
  {
    name: 'approved, open, a read names the PR',
    comments: [summary(1), review(2), read(3, PR1)],
    full: { box: ['ready', null], check: ['ready', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'approved, open, no read on record',
    comments: [summary(1), review(2)],
    full: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: true },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: true },
  },
  {
    name: 'request changes, open, no read',
    comments: [summary(1), review(2, 'Request Changes')],
    full: { box: ['not-ready', null], check: ['not-ready', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'approved, one landing PR merged and one open, no read (partial)',
    comments: [summary(1), review(2), link(3)], merged: [41],
    // Multi-PR: the box reads no PR (LIN-4458), so it reads the gate as not known merged.
    full: { box: ['not-ready', 'blind-read-missing'], check: ['partial', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: false },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: false },
  },
  {
    name: 'approved, open at a moved head, a read names the PR (head-moved)',
    comments: [summary(1), review(2), read(3, PR1)], movedHead: true,
    full: { box: ['not-ready', 'head-moved'], check: ['not-ready', false], stopAt: 'head-moved', ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'empty landing: a review, and a PR named only as #N',
    comments: [c(1, 'Implementation done, CI green.'), review(2, 'Approve', 'the change')],
    full: { box: ['no-pr', null], check: ['no-pr', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['no-pr', null], check: ['no-pr', false], stopAt: null, ladder: null, routesRead: false },
  },
];

const REAL = [
  {
    name: 'LIN-3245: merged, approved, closed out on the trail (real trail)',
    comments: RUN_COMMENT_TRAILS['lin-3245'].comments, merged: [1716], ticket: DONE,
    full: { box: ['merged', null], check: ['merged', true], stopAt: null, ladder: 'blind-read-missing', routesRead: false },
    unreadable: { box: ['not-ready', 'blind-read-missing'], check: ['not-ready', false], stopAt: 'blind-read-missing', ladder: 'blind-read-missing', routesRead: false },
  },
  {
    name: 'LIN-3247: request changes on a open PR (real trail)',
    comments: RUN_COMMENT_TRAILS['lin-3247'].comments,
    full: { box: ['not-ready', null], check: ['not-ready', false], stopAt: null, ladder: null, routesRead: false },
    unreadable: { box: ['unknown', null], check: ['unknown', false], stopAt: null, ladder: null, routesRead: false },
  },
  {
    name: 'LIN-3098: a review that names no PR by full URL (real trail)',
    comments: RUN_COMMENT_TRAILS['lin-3098-pair'].comments,
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
        const merged = row.merged || [];
        const comments = row.comments;
        const got = await surfacesFor(row, shape, comments, merged);
        assertCell(row, shape, got, row[shape]);
      });
    }
  }

  test('surfaces that hold the same facts agree: the box and the stop-at lane refuse the same way on every single-PR row', async () => {
    for (const row of SYNTHETIC.filter(r => !r.name.includes('partial') && !r.name.includes('empty'))) {
      for (const shape of ['full', 'unreadable']) {
        const got = await surfacesFor(row, shape, row.comments, row.merged || []);
        assert.equal(got.box.refuses ?? null, refusedOn(got.stopAtGuard), `${row.name} [${shape}]: box and stop-at lane agree`);
      }
    }
  });
});

async function surfacesFor(row, shape, comments, merged) {
  return surfaces(comments, { shape, merged, issue: row.ticket || STARTED, movedHead: row.movedHead });
}

describe('dropping a fact never moves the passenger fact or the gate the wrong way (LIN-4460, Constraints)', () => {
  for (const row of SYNTHETIC.filter(r => r.name.startsWith('approved'))) {
    test(`${row.name}: an unreadable or missing status never turns followsPerson into 'merged' or clears waitsOn`, () => {
      const trail = readTrail(row.comments);
      const full = closeOutDecision({ trail, prStatuses: new Map(trail.landing.map(u => [u, statusOf.merged(u)])), actor: 'person' });
      const dropped = closeOutDecision({ trail, prStatuses: new Map(trail.landing.map(u => [u, statusOf.unreadable()])), actor: 'person' });
      const unread = closeOutDecision({ trail, prStatuses: new Map(), actor: 'person' });
      for (const later of [dropped, unread]) {
        assert.notEqual(later.followsPerson, 'merged', 'followsPerson never moves from null to merged on a dropped fact');
        if (full.waitsOn === 'blind-read') assert.equal(later.waitsOn, 'blind-read', 'a dropped fact never clears the gate');
      }
    });
  }
});

describe('the decision\'s rules, one per named case', () => {
  const merged = (comments) => closeOutDecision({ trail: readTrail(comments), prStatuses: new Map([[PR1, statusOf.merged(PR1)]]), stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.PERSON });

  test('a person\'s check on a merged, approved, unread landing sets Done, and the stop-at lane stands aside', async () => {
    const comments = [summary(1), review(2)];
    const decision = merged(comments);
    assert.equal(decision.setDone, true);
    assert.equal(decision.followsPerson, 'merged');
    assert.equal(decision.refuses, null, 'the gate stands aside on a merged landing');
    const got = await surfaces(comments, { merged: [41] });
    assert.equal(got.check.setDone, true, 'the check route sets Done');
    assert.equal(got.stopAtGuard, null, 'the stop-at lane admits');
  });

  test('approved, unmerged, unread: both guard lanes refuse blind-read-missing, whether or not the ticket is Done', async () => {
    const comments = [summary(1), review(2)];
    for (const issue of [STARTED, DONE]) {
      const got = await surfaces(comments, { issue });
      assert.equal(refusedOn(got.stopAtGuard), 'blind-read-missing', `stop-at lane, ${issue.type}`);
      assert.equal(refusedOn(got.ladderGuard), 'blind-read-missing', `ladder lane, ${issue.type}`);
      assert.equal(got.check.setDone, false, `no Done from an unmerged landing, ${issue.type}`);
    }
  });

  test('a person\'s check without an approving review sets no Done', () => {
    const decision = closeOutDecision({ trail: readTrail([summary(1), review(2, 'Request Changes')]), prStatuses: new Map([[PR1, statusOf.merged(PR1)]]), actor: CLOSE_OUT_ACTOR.PERSON });
    assert.equal(decision.setDone, false);
  });

  test('head-moved refuses both actors: the person\'s check and Harbour', () => {
    const comments = [summary(1), review(2), read(3, PR1)];
    const statuses = new Map([[PR1, statusOf.open(PR1, MOVED)]]);
    for (const actor of [CLOSE_OUT_ACTOR.PERSON, CLOSE_OUT_ACTOR.HARBOUR]) {
      const decision = closeOutDecision({ trail: readTrail(comments), prStatuses: statuses, stopAt: 'pr', runnerReady: true, actor });
      assert.equal(decision.refuses, 'head-moved', actor);
      assert.equal(decision.setDone, false, actor);
    }
  });

  test('an unreadable PR keeps the blind-read gate in place, but unreadability alone never refuses', () => {
    const unreadBlind = closeOutDecision({ trail: readTrail([summary(1), review(2)]), prStatuses: new Map([[PR1, statusOf.unreadable()]]), stopAt: 'pr', runnerReady: true });
    assert.equal(unreadBlind.refuses, 'blind-read-missing', 'the gate still holds');
    const unreadRead = closeOutDecision({ trail: readTrail([summary(1), review(2), read(3, PR1)]), prStatuses: new Map([[PR1, statusOf.unreadable()]]), stopAt: 'pr', runnerReady: true });
    assert.equal(unreadRead.refuses, null, 'a read on record, the unreadable PR alone refuses nothing');
    assert.equal(unreadRead.status, CLOSE_OUT_STATUS.UNKNOWN);
  });

  test('Harbour never sets Done, even on a merged, approved landing with nothing else open', () => {
    const decision = closeOutDecision({ trail: readTrail([summary(1), review(2), read(3, PR1)]), prStatuses: new Map([[PR1, statusOf.merged(PR1)]]), actor: CLOSE_OUT_ACTOR.HARBOUR });
    assert.equal(decision.setDone, false);
    assert.equal(decision.status, CLOSE_OUT_STATUS.MERGED);
  });

  test('the empty-landing witness: no PR on the landing is no merged evidence, so no merge, no Done and no stand-aside', () => {
    const trail = readTrail([c(1, 'Implementation done, CI green.'), review(2, 'Approve', 'the change')]);
    assert.deepEqual(trail.landing, [], 'the landing is empty');
    const decision = closeOutDecision({ trail, prStatuses: new Map(), actor: CLOSE_OUT_ACTOR.PERSON });
    assert.equal(decision.status, CLOSE_OUT_STATUS.NO_PR);
    assert.equal(decision.setDone, false);
    assert.equal(decision.followsPerson, null, 'an empty landing is not merged');
    assert.equal(decision.refuses, null);
  });

  test('a ticket\'s state never reaches enforcement: Done, Canceled and In Progress answer the same for refuses and setDone', () => {
    const trail = readTrail([summary(1), review(2)]);
    const base = closeOutDecision({ trail, prStatuses: new Map([[PR1, statusOf.open(PR1)]]), stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.PERSON });
    for (const ticketState of ['completed', 'canceled', 'started', null]) {
      const d = closeOutDecision({ trail, prStatuses: new Map([[PR1, statusOf.open(PR1)]]), stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.PERSON, ticketState });
      assert.equal(d.refuses, base.refuses, `refuses, ${ticketState}`);
      assert.equal(d.setDone, base.setDone, `setDone, ${ticketState}`);
      assert.equal(d.waitsOn, base.waitsOn, `waitsOn, ${ticketState}`);
    }
  });

  test('a landing PR cited outside the landing is not read by the decision (LIN-4458: the landing decides)', () => {
    const trail = readTrail([summary(1), review(2), read(3, PR1)]);
    const d = closeOutDecision({ trail, prStatuses: new Map([[PR1, statusOf.merged(PR1)], [PR2, statusOf.open(PR2)]]), actor: CLOSE_OUT_ACTOR.PERSON });
    assert.equal(d.setDone, true, 'an open PR2 outside the landing does not withhold Done');
  });

  test('the reasons come in precedence order, frozen, each with its copy', () => {
    assert.ok(Object.isFrozen(CLOSE_OUT_REASONS));
    assert.deepEqual(CLOSE_OUT_REASONS.map(r => r.reason), [
      'blind-read-missing', 'pr-unreadable', 'pr-not-open', 'multiple-prs', 'head-moved',
      'not-stop-at-run', 'review-not-approve', 'runner-not-set-up',
    ]);
    for (const r of CLOSE_OUT_REASONS) assert.equal(typeof r.message, 'function', r.reason);
    assert.equal(Object.isFrozen(CLOSE_OUT_REASON), true);
  });
});

describe('the recommendation\'s read: the decision\'s advice answer (LIN-4460, row 196 and the audit-after-Done case)', () => {
  const approved = [summary(1), review(2)];
  const doneNoClose = { name: 'Done, no close-out on the landing, no audit notes PR (row 196, first half, flipped)', state: DONE, comments: approved, route: false };
  const doneClosed = { name: 'Done, a close-out after the review (row 196, second half, unchanged)', state: DONE, comments: [summary(1), review(2), closeOut(3, `Merged ${PR1}; set Done.`)], route: false };
  const doneAudit = { name: 'Done, then an audit\'s notes PR and its review: still read (added)', state: DONE, comments: [summary(1), review(2), closeOut(3, `Merged ${PR1}; set Done.`), audit(4), review(5, 'Approve', PR2)], route: true };
  const canceled = { name: 'Canceled', state: CANCELED, comments: approved, route: false };
  const started = { name: 'In Progress, approved, unread', state: STARTED, comments: approved, route: true };

  for (const row of [doneNoClose, doneClosed, doneAudit, canceled, started]) {
    test(`${row.name}: routesRead is ${row.route}`, () => {
      const step = blindReadStep({ state: row.state }, { comments: row.comments, allRuns: [] });
      assert.equal(step !== null, row.route);
    });
  }

  test('Done alone does not stand the enforcement gate aside: an approved, unmerged, unread landing is still refused (both lanes)', async () => {
    const got = await surfaces(approved, { issue: DONE });
    assert.equal(refusedOn(got.stopAtGuard), 'blind-read-missing');
    assert.equal(refusedOn(got.ladderGuard), 'blind-read-missing');
    assert.equal(got.routesRead, false, 'the recommendation stands aside, the enforcement still holds');
  });

  test('lin4447-recommend-path-outside-merge: an outside merge on a ticket still In Progress still routes the read (John\'s accepted limit, 13 Nov)', async () => {
    // The PR is merged outside Harbour. The recommend path reads no PR and the ladder lane reads none (John:
    // "Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up").
    const step = blindReadStep({ state: STARTED }, { comments: approved, allRuns: [] });
    assert.equal(step?.step, 'blind-read', 'the read is routed');
    const ladder = await surfaces(approved, { issue: STARTED, merged: [41] });
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
