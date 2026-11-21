/**
 * LIN-4514 (P1 of LIN-4513): the comment-path rows of the existing tests, as cases the capture can run.
 *
 * The rows live inside three test files that export nothing, and those tests stay as they are. So their builders
 * are copied here byte for byte, each block naming its source, and every case is turned into plain inputs:
 *   - comments: the trail, as the test builds it;
 *   - statuses: the status the test's reader answers for every PR the trail cites, keyed by PR URL (a test reader is a
 *     function of the URL, so this table is that function written out);
 *   - ticketState: the ticket's state type; allRuns: the runs the test passes (null: runs unknown);
 *   - expected: the cells the source test asserts for the case, in its own words, so a copy that drifts from its
 *     source fails tests/unit/lin-4514-comment-path-goldens.test.js rather than freezing a different row.
 * tests/helpers/comment-path-capture.js runs each case through every lane and writes rows.json.
 *
 * Where a source test reads no PR status (lin-4458's pins and new-rule cases read the trail, the facts and the
 * route), the case says so in `statusNote` and gives every cited PR the lin-4438 table's default answer (open at the
 * reviewed head), so the lanes that do read statuses have one stated input instead of an invented one per case.
 *
 * P5 (LIN-4518) replays these on records; P7 (LIN-4520) deletes this file with lib/run-trail.js.
 */
import { RUN_COMMENT_TRAILS } from '../fixtures/run-ledger-trails.js';
import { SURVEY_HEADINGS } from '../../lib/prompts/survey-words.js';
import { prUrlsIn } from '../../lib/run-ledger.js';

// ─── Builders: tests/unit/lin-4438-blind-read-gate.test.js (lin-4458 and lin-4460 use the same, byte for byte) ──
const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const PR_OLD = PR(40);
const FOREIGN = 'https://github.com/other/repo/pull/7';
const REVIEWED = 'aaaaaaa1111111';
// tests/unit/lin-4460-close-out-decision.test.js
const MOVED = 'bbbbbbb2222222';

const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const summary = (n, url = PR1) => c(n, `Implementation done: ${url}, CI green.`);
const review = (n, verdict = 'Approve', url = PR1) => c(n, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${url}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: ${verdict}**`);
const read = (n, ...urls) => c(n, `## Blind read\nVerdict: same. It gave the gate one owner in lib/run-closeout-state.js and left nothing worse.\n\nRead: ${urls.join(', ')} at \`${REVIEWED.slice(0, 9)}\` against \`000000000\`.\n\n### Inside the area, fix-sized\nNone.`);
const closeOut = (n, body) => c(n, `## Close-out\n\n${body}`);
const LINK_BODY = `PR to merge: ${PR2}`;
const link = (n) => c(n, LINK_BODY);
const audit = (n) => c(n, `## Retrospective audit — LIN-1\n\nThe landing ${PR1} holds; one note entry is wrong. Notes PR: ${PR2}.`);
const research = (n) => c(n, `## Research notes\n\nAn earlier attempt elsewhere is ${FOREIGN}; this ticket starts fresh.`);
// tests/unit/lin-4458-trail-characterization.test.js
const agentNote = (n, url) => c(n, `**Autopilot step record — LIN-1.** Fix pushed: ${url}.`);
const areaRead = (n, url) => c(n, `## Area read: Runs & dispatch @ 4b5001ddf\n\nThe close-out box reads better than it did; an earlier landing was ${url}.`);

const STARTED = 'started';
const DONE = 'completed';
const run = (stage, n, outcome = 'done') => ({ stage, at: T(n), outcome, dispatchedAt: T(n), id: `r${n}` });

// lin-4438's reader answers (`open`, `merged`), keyed by number there and by URL here.
const numberOf = (url) => Number(url.split('/').pop());
const open4438 = (number, sha = REVIEWED) => ({ readable: true, repo: REPO, number, state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] });
const merged4438 = (number) => ({ ...open4438(number), state: 'closed', merged: true });
// lin-4460's reader answers (`statusOf`).
const prOf4460 = (url) => ({ repo: REPO, number: numberOf(url) });
const statusOf = {
  open: (url, sha = REVIEWED) => ({ readable: true, ...prOf4460(url), state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] }),
  merged: (url) => ({ readable: true, ...prOf4460(url), state: 'closed', merged: true, head: { ref: 'f', sha: REVIEWED }, ref: REVIEWED, checks: [] }),
  unreadable: () => ({ readable: false, state: 'unknown', reason: 'private' }),
};
// lin-4458's box and check readers (`openPr`, `mergedPr`, `closedPr`).
const openPr = (number) => ({ readable: true, repo: REPO, number, state: 'open', merged: false, head: { ref: 'f', sha: REVIEWED }, ref: REVIEWED, checks: [] });
const mergedPr = (number) => ({ ...openPr(number), state: 'closed', merged: true, merged_at: T(8) });
const closedPr = (number) => ({ ...openPr(number), state: 'closed', merged: false });

/** Every PR URL the trail cites, in first-citation order: the URLs a lane may ask a status for. */
function citedUrls(comments) {
  const urls = [];
  for (const cm of comments) for (const u of prUrlsIn(cm.body)) if (!urls.includes(u)) urls.push(u);
  return urls;
}
const statusesBy = (comments, answer) => Object.fromEntries(citedUrls(comments).map((u) => [u, answer(u)]));

// ─── lin-4438: the shared-trail table, rows 1–15 (13–15 are the landing rows) ───────────────────────────────
const ROWS_4438 = [
  { n: 1, name: 'approve, no read', comments: [summary(1), review(2)], route: 'blind-read', gate: 'wait' },
  { n: 2, name: 'approve, then a read naming the PR', comments: [summary(1), review(2), read(3, PR1)], route: 'aside', gate: 'admit', ready: true },
  { n: 3, name: 'a read naming an older PR only', comments: [summary(1), review(2), read(3, PR_OLD)], route: 'blind-read', gate: 'wait' },
  { n: 4, name: 'a read, then a new review', comments: [summary(1), review(2), read(3, PR1), review(4)], route: 'blind-read', gate: 'wait' },
  { n: 5, name: 'request changes', comments: [summary(1), review(2, 'Request Changes')], route: 'aside', gate: 'admit' },
  { n: 6, name: 'two ended attempts, runs known', comments: [summary(1), review(2)], allRuns: [run('review', 2), run('blind-read', 3, 'done'), run('blind-read', 4, 'failed')], route: 'blocked', gate: 'wait' },
  { n: 7, name: 'runs unknown', comments: [summary(1), review(2)], allRuns: null, route: 'blind-read', gate: 'wait' },
  { n: 8, name: 'no PR on the trail', comments: [c(1, 'Implementation done, CI green.'), review(2, 'Approve', 'the change')], route: 'aside', gate: 'admit' },
  { n: 9, name: 'no review', comments: [summary(1)], route: 'aside', gate: 'admit' },
  { n: 10, name: 'approve, then a not-ready close-out citing the PR', comments: [summary(1), review(2), closeOut(3, `Not ready: no blind read yet for ${PR1}. Next: blind-read.`)], route: 'blind-read', gate: 'wait' },
  { n: 11, name: 'approve, then a plain link comment naming a new PR', comments: [summary(1), review(2), link(3)], route: 'aside', gate: 'wait' },
  { n: 12, name: 'approve, a read, then a merging close-out on a Done ticket', state: DONE, comments: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`)], merged: [41], route: 'aside', gate: 'admit' },
  { n: 13, name: 'approve, a not-ready close-out, a fix round re-naming the PR, then a re-review', comments: [summary(1), review(2), closeOut(3, `Not ready: CI red on ${PR1}. Next: implementation.`), summary(4), review(5)], route: 'blind-read', gate: 'wait' },
  { n: 14, name: 'a Done ticket: landing close-out, then an audit notes PR and its own review', state: DONE, comments: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`), audit(5), review(6, 'Approve', PR2)], merged: [41], route: 'blind-read', gate: 'wait', landing: [PR2] },
  { n: 15, name: 'a pre-review comment cites a foreign PR by full URL', comments: [research(1), summary(2), review(3), read(4, PR1)], route: 'blind-read', gate: 'wait', landing: [FOREIGN, PR1] },
];

const cases4438 = ROWS_4438.map((row) => ({
  id: `lin-4438/row-${row.n}`,
  source: 'tests/unit/lin-4438-blind-read-gate.test.js ROWS',
  name: row.name,
  comments: row.comments,
  statuses: statusesBy(row.comments, (u) => ((row.merged || []).includes(numberOf(u)) ? merged4438(numberOf(u)) : open4438(numberOf(u)))),
  ticketState: row.state || STARTED,
  allRuns: Object.hasOwn(row, 'allRuns') ? row.allRuns : [],
  expected: {
    route: row.route,
    gate: row.gate,
    ...(row.ready ? { ready: true } : {}),
    ...(row.landing ? { landing: row.landing } : {}),
  },
}));

// ─── lin-4458: the pins and the new rule (tests/unit/lin-4458-trail-characterization.test.js) ──────────────────
const ROWS_4458 = {
  3: [summary(1), review(2), read(3, PR_OLD)],
  11: [summary(1), review(2), link(3)],
  13: [summary(1), review(2), closeOut(3, `Not ready: CI red on ${PR1}. Next: implementation.`), summary(4), review(5)],
  14: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`), audit(5), review(6, 'Approve', PR2)],
  15: [research(1), summary(2), review(3), read(4, PR1)],
};
const A = PR1;
const B = PR2;
const CITED_NOT_LANDED = [
  summary(1, B),
  review(2, 'Request Changes', B),
  closeOut(3, `Not ready: ${B} was closed unmerged. Next: implementation.`),
  summary(4, A),
  review(5, 'Approve', A),
  read(6, A),
  c(7, `${SURVEY_HEADINGS['survey-task']}: LIN-1 @ abc123def\n\nAn earlier attempt is ${B}; it was closed.`),
];
const TRAIL_AC = [summary(1, `${A} and ${PR(43)}`), review(2, 'Approve', A), read(3, A, PR(43))];

const NO_STATUS_READ = 'the source test reads no PR status; every cited PR answers open at the reviewed head (the lin-4438 default)';
const defaultStatuses = (comments) => statusesBy(comments, (u) => open4438(numberOf(u)));
const pin = (id, name, comments, expected, { ticketState = STARTED, statuses = null, statusNote = NO_STATUS_READ } = {}) => ({
  id: `lin-4458/${id}`,
  source: 'tests/unit/lin-4458-trail-characterization.test.js',
  name,
  comments,
  statuses: statuses || defaultStatuses(comments),
  ...(statuses ? {} : { statusNote }),
  ticketState,
  allRuns: [],
  expected,
});

const cases4458 = [
  pin('pin-row-3', 'row 3: a read naming an older PR is not work after review; the landing is the reviewed PR; the route sends blind-read', ROWS_4458[3],
    { landing: [PR1], workAfterReview: false, waitsOn: 'blind-read', step: 'blind-read' }),
  pin('pin-row-11', 'row 11: a plain link comment naming a new PR is work after review and joins the landing', ROWS_4458[11],
    { landing: [PR1, PR2], workAfterReview: true, waitsOn: 'blind-read', step: null }),
  pin('pin-row-13', 'row 13: a fix round that re-cites PR1 after a not-ready close-out keeps PR1 in the landing, so the gate holds', ROWS_4458[13],
    { landing: [PR1], waitsOn: 'blind-read', step: 'blind-read', ladderGuard: 'blind-read-missing' }),
  pin('pin-row-15', 'row 15: a foreign PR cited before the first review stays in a first landing (a stated limit)', ROWS_4458[15],
    { landing: [FOREIGN, PR1] }),
  pin('pin-row-14-route', 'row 14 keeps its route and gate: a Done ticket whose notes PR has no read routes blind-read and the gate waits', ROWS_4458[14],
    { step: 'blind-read', waitsOn: 'blind-read', ladderGuard: 'blind-read-missing' }, { ticketState: DONE }),
  pin('pin-agent-note-recites', 'an agent note after review that re-cites the reviewed PR is not work after review', [summary(1), review(2), agentNote(3, PR1)],
    { workAfterReview: false, step: 'blind-read' }),
  pin('new-row-14-flips', 'row 14 flips: the audit re-cites the merged landing PR, so the notes PR\'s landing is the notes PR alone', ROWS_4458[14],
    { landing: [PR2], landingHasNotesPr: true }, { ticketState: DONE }),
  pin('new-agent-note-new-pr', 'an agent note after review that cites a new PR is work after review', [summary(1), review(2), agentNote(3, PR2)],
    { workAfterReview: true, step: null }),
  pin('new-area-read', 'an area read carries no landing and is not work after review, even when it names a PR', [summary(1), review(2), areaRead(3, PR_OLD)],
    { landing: [PR1], workAfterReview: false, step: 'blind-read' }),
  pin('new-closeout-on-trail', 'readTrail: a not-ready close-out after the review is on the trail', [summary(1), review(2), closeOut(3, `Not ready: no blind read yet for ${PR1}.`)],
    { closeOutOnTrail: true }),
  pin('new-no-closeout', 'readTrail: no close-out, none on the trail', [summary(1), review(2)],
    { closeOutOnTrail: false }),
  pin('box-cited-not-landed', 'the box: a landing of [A] cited beside B reads A in the box (one read, the landing\'s sole PR)', CITED_NOT_LANDED,
    { landing: [A], boxStatus: 'ready', boxPrs: [A], boxReads: [41] },
    { statuses: { [B]: closedPr(42), [A]: openPr(41) } }),
  pin('check-merged-landing', 'the owner\'s Done check: a merged, approved, read landing [A] sets Done; B closed unmerged outside the landing does not block it', CITED_NOT_LANDED,
    { checkStatus: 'merged', checkSetDone: true, checkPr: A },
    { statuses: { [B]: closedPr(42), [A]: mergedPr(41) } }),
  pin('check-landing-ac-partial', 'the owner\'s Done check: a landing of [A, C] with C closed unmerged still sets no Done', TRAIL_AC,
    { landing: [A, PR(43)], checkStatus: 'partial', checkSetDone: false },
    { statuses: { [A]: mergedPr(41), [PR(43)]: closedPr(43) } }),
  pin('check-unmerged-landing', 'pin: an unmerged landing [A] never sets Done, whatever B reads', CITED_NOT_LANDED,
    { checkSetDone: false },
    { statuses: { [B]: mergedPr(42), [A]: openPr(41) } }),
];

// ─── lin-4460: the agreement table's synthetic and real rows (tests/unit/lin-4460-close-out-decision.test.js) ───
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

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const cases4460 = [...SYNTHETIC.map((r) => ['synthetic', r]), ...REAL.map((r) => ['real', r])].flatMap(([group, row]) => ['full', 'unreadable'].map((shape) => ({
  id: `lin-4460/${group}/${slug(row.name)}/${shape}`,
  source: `tests/unit/lin-4460-close-out-decision.test.js ${group === 'real' ? 'REAL' : 'SYNTHETIC'}`,
  name: `${row.name} — ${shape} reads`,
  comments: row.comments,
  statuses: statusesBy(row.comments, (u) => (shape === 'unreadable' ? statusOf.unreadable()
    : ((row.merged || []).includes(numberOf(u)) ? statusOf.merged(u) : statusOf.open(u, row.movedHead ? MOVED : REVIEWED)))),
  ticketState: row.ticket || STARTED,
  allRuns: [],
  expected: { cell: row[shape] },
})));

/** Every comment-path row, in source order: lin-4438, then lin-4458, then lin-4460. */
export const COMMENT_PATH_ROWS = Object.freeze([...cases4438, ...cases4458, ...cases4460]);
