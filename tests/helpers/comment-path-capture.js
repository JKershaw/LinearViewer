/**
 * LIN-4514 (P1 of LIN-4513): the derive half of the comment-path capture.
 *
 * Verdicts and changes are about to become records (LIN-4513). This file runs the comment path that exists today
 * (lib/run-trail.js and its readers, called as they are, unchanged) over frozen inputs, and writes what it decided.
 * Those outputs are the oracle P5 (LIN-4518) replays on records: "the same decisions as from the comments".
 *
 * Inputs (tests/fixtures/walk-8/comment-path/):
 *   - lin-4469.json, lin-4446.json, lin-4450.json: each ticket's real comments verbatim, each cited PR's head timeline
 *     and merge, the ticket's state over time, and walk 8's step boundaries. A throwaway fetch wrote them (never
 *     committed: the frozen inputs are the product).
 *   - the rows of lin-4438, lin-4458 and lin-4460, from tests/helpers/comment-path-rows.js.
 * Outputs (derived; never edit them by hand, rerun this):
 *   - goldens/lin-<id>.json: the capture at every instant of the ticket;
 *   - rows.json: the capture of every row, with the source test's expected cells beside it.
 *
 * An instant is any moment the comment path's answer can change: every comment's time, every walk-8 step boundary,
 * and every PR head push and merge (the last two because no comment or step falls inside the window where LIN-4469's
 * PR was open at a head no review saw). Each instant lists why it is one. At an instant the trail is the comments
 * posted at or before it, each PR answers its state then, and the ticket has its state then.
 *
 * What is captured at each instant (and for each row):
 *   - trail: readTrail's value (lib/run-trail.js), the review comment named by id;
 *   - decision: closeOutDecision (lib/run-closeout-state.js) in three lanes, each with the input its surface gives it:
 *       stopAtHarbour: the stop-at-PR guard (closeOutNotReady → readCloseOutChain): the landing's statuses, Harbour;
 *       stopAtPerson:  the owner's check (readCloseOutChain, actor person): the same reads, the person;
 *       ladder:        the ladder guard (ladderNotReady): no PR read, no findings read;
 *     each with the open findings to close-out as "none open" (FINDINGS_NONE), the seams' reading, except the ladder's own;
 *   - selector: assembleTrailFacts minus its plan and size facts (records and description facts, not verdicts), and
 *     blindReadStep with the ticket's state (runs unknown at an instant; a row's own runs);
 *   - runEvidence: readRunEvidence's verdict part (`evidence.checked`: review, blind read, now) and the close-out box;
 *   - rows only, `surfaces`: the async surfaces as the source tests call them (route through getRecommendation with
 *     the selector stubbed, the check chain, both guard lanes) and the PR reads each made.
 *
 * Deterministic by construction: no clock (every time comes from the inputs), no network (statuses come from the
 * inputs through injected readers; the selector call is stubbed), sorted-key JSON with a trailing newline, and
 * instants and rows in an order fixed by the inputs. Rerun with:
 *   node tests/helpers/comment-path-capture.js --write
 * The byte-for-byte rerun witness is tests/unit/lin-4514-comment-path-goldens.test.js.
 *
 * P7 (LIN-4520) deletes this file with lib/run-trail.js: it is the comment path's last reader by design.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readTrail } from '../../lib/run-trail.js';
import { closeOutDecision, CLOSE_OUT_ACTOR } from '../../lib/run-closeout-state.js';
import { FINDINGS_NONE, findingsNotRead } from '../../lib/close-out-findings.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';
import { blindReadStep } from '../../lib/recommendation-blind-read.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { readCloseOutChain, closeOutNotReady } from '../../lib/close-out-readiness.js';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { COMMENT_PATH_ROWS } from './comment-path-rows.js';

export const FIXTURE_DIR = new URL('../fixtures/walk-8/comment-path/', import.meta.url);
export const TICKETS = Object.freeze(['lin-4469', 'lin-4446', 'lin-4450']);
const ISSUE = 'LIN-1';
// The ladder guard's own reading (lib/close-out-readiness.js ladderNotReady), word for word.
const LADDER_FINDINGS = 'the ladder guard refuses on the blind read only and reads no findings';
// The trail facts that are not verdict facts: the plan facts are records (LIN-4504) and the size is the description's.
const NOT_VERDICT_FACTS = ['plan', 'size'];

// ─── Stable output ────────────────────────────────────────────────────────────────────────────────────

/** A value with every object's keys sorted, recursively; undefined members dropped (as JSON drops them). */
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    if (value instanceof Map || value instanceof Set) throw new TypeError('comment-path-capture: a Map or Set reached the output');
    return Object.fromEntries(Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => [k, sorted(value[k])]));
  }
  return value;
}

/** Sorted-key JSON, two-space indent, one trailing newline: the goldens' byte form. */
export function stableJson(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

// ─── Time ───────────────────────────────────────────────────────────────────────────────────────────

const ms = (iso) => {
  const n = Date.parse(iso);
  if (!Number.isFinite(n)) throw new TypeError(`comment-path-capture: not a time: ${iso}`);
  return n;
};
const iso = (n) => new Date(n).toISOString();

// ─── The frozen inputs, read at an instant ──────────────────────────────────────────────────────────

export function loadInput(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8'));
}

/**
 * Every instant of a ticket, in time order, each with why it is one. Events before the trail's first comment or
 * step are left out: nothing on the trail can have read them.
 */
export function instantsOf(input) {
  const reasons = new Map();
  const add = (at, why) => {
    const key = ms(at);
    if (!reasons.has(key)) reasons.set(key, []);
    reasons.get(key).push(why);
  };
  for (const cm of input.comments) add(cm.createdAt, `comment ${cm.id}`);
  for (const s of input.steps) add(s.start, `step ${s.n} ${s.stage}`);
  const start = Math.min(...[...reasons.keys()]);
  for (const pr of input.prs) {
    for (const h of pr.heads) if (ms(h.at) >= start) add(h.at, `PR #${pr.number} head ${h.sha.slice(0, 9)} (${h.source.split(':')[0]})`);
    if (pr.mergedAt && ms(pr.mergedAt) >= start) add(pr.mergedAt, `PR #${pr.number} merged`);
  }
  return [...reasons.keys()].sort((a, b) => a - b).map((k) => ({ at: iso(k), because: reasons.get(k) }));
}

/**
 * A PR's status at an instant, in the shape lib/github.js readPrStatus answers: merged once its merge is at or before
 * the instant (at the head it merged), else open at the latest head pushed by then (the first head, if the PR opened
 * before its first push was seen). No check runs are frozen, so `checks` is empty (run evidence reads that as "no
 * checks set up", read: true): CI state is not part of what this captures.
 */
export function prStatusAt(pr, at) {
  const t = ms(at);
  const [repo] = pr.url.replace('https://github.com/', '').split('/pull/');
  const base = { readable: true, repo, number: pr.number, checks: [] };
  if (pr.mergedAt && ms(pr.mergedAt) <= t) {
    return { ...base, state: 'closed', merged: true, merged_at: pr.mergedAt, head: { ref: 'branch', sha: pr.mergedHead }, ref: pr.mergedHead };
  }
  const pushed = pr.heads.filter((h) => ms(h.at) <= t);
  const head = (pushed[pushed.length - 1] || pr.heads[0]).sha;
  return { ...base, state: 'open', merged: false, merged_at: null, head: { ref: 'branch', sha: head }, ref: head };
}

/** The ticket's state type at an instant: the latest state entered at or before it (the first, before any). */
export function ticketStateAt(input, at) {
  const t = ms(at);
  const entered = input.ticketStates.filter((s) => ms(s.at) <= t);
  return (entered[entered.length - 1] || input.ticketStates[0]).type;
}

// ─── One capture ────────────────────────────────────────────────────────────────────────────────────

const UNREAD = Object.freeze({ readable: false, state: 'unknown', reason: 'no status in the case' });
const urlOf = (repo, number) => `https://github.com/${repo}/pull/${number}`;

/** readTrail's value, JSON-safe: the review comment is named by its id (its body is in the inputs). */
function trailValue(trail) {
  const { reviewComment, ...rest } = trail;
  return { ...rest, reviewCommentId: reviewComment ? (reviewComment.id ?? null) : null };
}

function selectorFacts(comments) {
  const facts = assembleTrailFacts(comments, '', { leaf: true, openFindings: FINDINGS_NONE });
  for (const key of NOT_VERDICT_FACTS) delete facts[key];
  return facts;
}

/**
 * The comment path's answers for one trail. `statusOf(url)` is the PR reader: the status a lane gets when it asks.
 * @param {{comments: Object[], statusOf: (url: string) => Object, ticketState: string, allRuns: (Object[]|null)}} c
 */
async function captureCase({ comments, statusOf, ticketState, allRuns }) {
  const trail = readTrail(comments);
  const landingStatuses = new Map(trail.landing.map((u) => [u, statusOf(u)]));
  const lane = (stopAt, actor, prStatuses, openFindings) => closeOutDecision({
    trail: { review: trail.review, landing: trail.landing }, prStatuses, stopAt, runnerReady: true, actor, openFindings,
  });
  const reads = [];
  const evidence = await readRunEvidence({
    openFindings: FINDINGS_NONE, issueIdentifier: ISSUE, comments, stopAt: 'pr', runnerReady: true, viewerIsOwner: true,
    readPrStatus: async ({ repo, number }) => { reads.push(urlOf(repo, number)); return statusOf(urlOf(repo, number)); },
  });
  const step = blindReadStep({ state: { type: ticketState } }, { comments, allRuns });
  return {
    trail: trailValue(trail),
    decision: {
      stopAtHarbour: lane('pr', CLOSE_OUT_ACTOR.HARBOUR, landingStatuses, FINDINGS_NONE),
      stopAtPerson: lane('pr', CLOSE_OUT_ACTOR.PERSON, landingStatuses, FINDINGS_NONE),
      ladder: lane(null, CLOSE_OUT_ACTOR.HARBOUR, null, findingsNotRead(LADDER_FINDINGS)),
    },
    selector: { trailFacts: selectorFacts(comments), blindReadStep: step },
    runEvidence: { checked: evidence.evidence.checked, closeOut: evidence.closeOut, prReads: reads },
  };
}

// ─── The surfaces, as the source tests call them (rows only) ────────────────────────────────────────

const SELECTOR_REPLY = { choices: [{ message: { content: '## Reasoning\n→ **close-out**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } };

async function surfacesOf({ comments, statusOf, ticketState, allRuns }) {
  const reads = { chain: [], stopAtGuard: [], ladderGuard: [] };
  const seam = (stopAt, log) => ({
    resolveProvider: () => ({ provider: { name: 'local', async fetchIssueComments() { return comments; } }, callScope: 'scope' }),
    readPrStatus: async ({ repo, number }) => { log.push(urlOf(repo, number)); return statusOf(urlOf(repo, number)); },
    isStopAtRun: async () => stopAt,
  });
  const workspace = { urlKey: 'acme' };
  const { state: check } = await readCloseOutChain({
    openFindings: FINDINGS_NONE, workspace, issueIdentifier: ISSUE, seam: seam('pr', reads.chain), stopAt: 'pr',
    runnerReady: true, owner: true, actor: CLOSE_OUT_ACTOR.PERSON, prStatusCache: new Map(),
  });
  const stopAtGuard = await closeOutNotReady({ openFindings: FINDINGS_NONE, workspace, issueIdentifier: ISSUE, seam: seam('pr', reads.stopAtGuard) });
  const ladderGuard = await closeOutNotReady({ openFindings: FINDINGS_NONE, workspace, issueIdentifier: ISSUE, seam: seam(null, reads.ladderGuard) });

  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => ({ ok: true, json: async () => SELECTOR_REPLY }));
  let route;
  try {
    const rec = await getRecommendation(
      { identifier: ISSUE, title: 'Gate fixture', description: '', state: { name: ticketState, type: ticketState }, labels: [] },
      { parent: null, siblings: [], project: null, children: [], comments, focusedChild: null, attachments: [], runs: [], allRuns },
      { apiKey: 'stub', model: 'x' },
    );
    route = { codeRoute: rec.codeRoute ?? null, recommendedAction: rec.recommendedAction ?? null };
  } finally {
    setFetchImpl(null);
    setPromptTraceRecorder(null);
  }
  return { route, check, stopAtGuard, ladderGuard, prReads: reads };
}

// ─── Tickets and rows ───────────────────────────────────────────────────────────────────────────────

/** The golden of one ticket: the capture at every instant. */
export async function captureTicket(input) {
  const instants = [];
  for (const { at, because } of instantsOf(input)) {
    const comments = input.comments.filter((cm) => ms(cm.createdAt) <= ms(at));
    const byUrl = new Map(input.prs.map((pr) => [pr.url, pr]));
    const statusOf = (url) => (byUrl.has(url) ? prStatusAt(byUrl.get(url), at) : UNREAD);
    const ticketState = ticketStateAt(input, at);
    const prs = Object.fromEntries(input.prs.map((pr) => [pr.url, prStatusAt(pr, at)]));
    instants.push({
      at,
      because,
      commentIds: comments.map((cm) => cm.id),
      ticketState,
      prs,
      ...(await captureCase({ comments, statusOf, ticketState, allRuns: null })),
    });
  }
  return {
    _about: `LIN-4514 golden for ${input.ticket}: the comment path's answers at every instant, derived from ${input.ticket.toLowerCase()}.json by tests/helpers/comment-path-capture.js (its header says what each part is). Never edit by hand; rerun the helper.`,
    ticket: input.ticket,
    instants,
  };
}

/** rows.json: every comment-path row of lin-4438, lin-4458 and lin-4460, inputs and every lane's output. */
export async function captureRows(rows = COMMENT_PATH_ROWS) {
  const out = [];
  for (const row of rows) {
    const statusOf = (url) => (Object.hasOwn(row.statuses, url) ? row.statuses[url] : UNREAD);
    const input = { comments: row.comments, statusOf, ticketState: row.ticketState, allRuns: row.allRuns };
    out.push({
      id: row.id,
      source: row.source,
      name: row.name,
      inputs: {
        comments: row.comments,
        statuses: row.statuses,
        ...(row.statusNote ? { statusNote: row.statusNote } : {}),
        ticketState: row.ticketState,
        allRuns: row.allRuns,
      },
      expected: row.expected,
      output: { ...(await captureCase(input)), surfaces: await surfacesOf(input) },
    });
  }
  return {
    _about: 'LIN-4514: the comment-path rows of tests/unit/lin-4438-blind-read-gate.test.js (rows 1-15; 13-15 are the landing rows), tests/unit/lin-4458-trail-characterization.test.js (pins, new rule, the box and the owner\'s check) and tests/unit/lin-4460-close-out-decision.test.js (synthetic and real rows, full and unreadable reads), as data: each row\'s inputs, the cells its source test asserts (expected), and every lane\'s full output. Derived by tests/helpers/comment-path-capture.js from tests/helpers/comment-path-rows.js; never edit by hand.',
    rows: out,
  };
}

/** Every output file, as {relative path: bytes}. */
export async function captureAll() {
  const files = {};
  for (const name of TICKETS) files[`goldens/${name}.json`] = stableJson(await captureTicket(loadInput(name)));
  files['rows.json'] = stableJson(await captureRows());
  return files;
}

async function main() {
  process.env.NODE_ENV = 'test';
  const files = await captureAll();
  if (!process.argv.includes('--write')) {
    for (const [path, bytes] of Object.entries(files)) console.log(`${path}: ${bytes.length} bytes (dry run; --write writes)`);
    return;
  }
  mkdirSync(new URL('goldens/', FIXTURE_DIR), { recursive: true });
  for (const [path, bytes] of Object.entries(files)) {
    writeFileSync(new URL(path, FIXTURE_DIR), bytes);
    console.log(`wrote ${path}: ${bytes.length} bytes`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
