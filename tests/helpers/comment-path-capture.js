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
import { createHash } from 'node:crypto';
import { readTrail, landingPrUrls, commentKindOf, isPersonComment, reportsLandedWork, isRuling, extractVerdict } from '../../lib/run-trail.js';
import { __internal as followOnInternal } from '../../lib/follow-on-ratio.js';
import { readLanding } from '../../scripts/stability-measures-blind.mjs';
import { notMeasured } from '../../scripts/stability-measures-core.mjs';
import { checkBlindReadShape } from '../../lib/run-ledger.js';
import { liveWaitOf } from '../../lib/run-live-wait.js';
import { closeOutDecision, CLOSE_OUT_ACTOR } from '../../lib/run-closeout-state.js';
import { FINDINGS_NONE, findingsNotRead } from '../../lib/close-out-findings.js';
import { assembleTrailFacts, assemblePlanReviewFacts, reviewLoopStop, reviewLoopConverging } from '../../lib/recommendation-facts.js';
import { blindReadStep } from '../../lib/recommendation-blind-read.js';
import { buildRunEvidence, extractPrUrls, landingPrRefs } from '../../lib/run-evidence.js';
import { readPrStatuses } from '../../lib/close-out-readiness.js';
import { deriveCloseOutState, blindReadMissingState, CLOSE_OUT_REASON } from '../../lib/run-closeout-state.js';
import { prOf } from '../../lib/run-ledger.js';
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

// ─── Repeated text, stored once ─────────────────────────────────────────────────────────────────────
//
// The same review's ledger text repeats at every instant after it, and the same comment trail repeats across rows
// (lin-4460's full and unreadable reads; lin-4458's rows are lin-4438's; a seed's prefixes). Each distinct one is
// stored once in the file's `texts` (a ledger's raw text) or `comments` (an input comment), under the first 12 hex of
// its sha-256, and referenced where it was: `ledger.rawRef` for `ledger.raw`, `inputs.commentRefs` for
// `inputs.comments`. Nothing else changes. Read a file through resolveRefs (or loadDerived), which puts each one back.

const refOf = (value) => createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex').slice(0, 12);

/** The document with repeated texts and trails replaced by references, and the tables beside them. */
export function internRefs(doc) {
  const texts = {};
  const comments = {};
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'ledger' && x && typeof x === 'object' && typeof x.raw === 'string') {
        const ref = refOf(x.raw);
        texts[ref] = x.raw;
        const { raw, ...rest } = x;
        out[k] = { ...walk(rest), rawRef: ref };
      } else if (k === 'inputs' && x && Array.isArray(x.comments)) {
        const refs = x.comments.map((cm) => { const ref = refOf(cm); comments[ref] = cm; return ref; });
        const { comments: _, ...rest } = x;
        out[k] = { ...walk(rest), commentRefs: refs };
      } else {
        out[k] = walk(x);
      }
    }
    return out;
  };
  const body = walk(doc);
  return { ...body, ...(Object.keys(texts).length ? { texts } : {}), ...(Object.keys(comments).length ? { comments } : {}) };
}

/** internRefs undone: every `rawRef` and `commentRefs` put back as what it names; the tables dropped. */
export function resolveRefs(doc) {
  const { texts = {}, comments = {}, ...body } = doc;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'rawRef') {
        if (!Object.hasOwn(texts, x)) throw new Error(`comment-path-capture: no text ${x}`);
        out.raw = texts[x];
      } else if (k === 'commentRefs') {
        out.comments = x.map((ref) => {
          if (!Object.hasOwn(comments, ref)) throw new Error(`comment-path-capture: no comment ${ref}`);
          return comments[ref];
        });
      } else {
        out[k] = walk(x);
      }
    }
    return out;
  };
  return walk(body);
}

/** A derived file (goldens/*.json, rows.json), read and resolved. */
export function loadDerived(path) {
  return resolveRefs(JSON.parse(readFileSync(new URL(path, FIXTURE_DIR), 'utf8')));
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

// ─── The comment path's three lanes, as they read the trail before LIN-4518 step 3 ────────────────────
// readRunEvidence, readCloseOutChain and closeOutNotReady read the ticket's records now. These are the same steps over
// readTrail, the comment trail the goldens froze, so the capture still reproduces the comment path. P7 (LIN-4520) deletes them.

/** readRunEvidence's comment-path read: the landing's sole PR is read; a multi-PR landing reads none. */
async function commentRunEvidence({ comments, readPrStatus }) {
  const landing = landingPrUrls(comments);
  let prStatus = null;
  if (landing.length === 1) {
    const { repo, number } = prOf(landing[0]);
    prStatus = await readPrStatus({ repo, number });
  }
  return buildRunEvidence({ issueIdentifier: ISSUE, comments, prUrls: extractPrUrls(comments, []), prStatus, stopAt: 'pr', runnerReady: true, owner: true, openFindings: FINDINGS_NONE });
}

/** readCloseOutChain's comment-path answer: the landing's PRs read through the seam, decided for `actor`. */
async function commentChain({ comments, seam, stopAt, actor }) {
  const trail = readTrail(comments);
  const prs = landingPrRefs(trail.landing);
  const read = await readPrStatuses({ prUrls: prs, callScope: 'scope', workspace: { urlKey: 'acme' }, seam, prStatusCache: new Map(), providerKind: 'local' });
  const prStatuses = new Map(prs.map((pr, i) => [pr.url, read[i]]));
  const state = deriveCloseOutState({ prs, prStatuses, landingPrs: trail.landing, review: trail.review, runnerReady: true, owner: true, stopAt, actor, openFindings: FINDINGS_NONE });
  return { state, prStatuses };
}

/** closeOutNotReady's comment-path refusal for one lane: the stop-at guard (`pr`) or the ladder (`null`). */
async function commentGuard({ comments, seam, stopAt }) {
  if (stopAt !== 'pr') {
    const trail = readTrail(comments);
    const state = deriveCloseOutState({ landingPrs: trail.landing, review: trail.review, actor: CLOSE_OUT_ACTOR.HARBOUR, openFindings: findingsNotRead('the ladder guard refuses on the blind read only and reads no findings') });
    return state.refuses === CLOSE_OUT_REASON.BLIND_READ_MISSING ? blindReadMissingState(state, null) : null;
  }
  const { state } = await commentChain({ comments, seam, stopAt, actor: CLOSE_OUT_ACTOR.HARBOUR });
  if (state.refuses === CLOSE_OUT_REASON.HEAD_MOVED) return state;
  if (state.refuses === CLOSE_OUT_REASON.BLIND_READ_MISSING) return blindReadMissingState(state, state.pr ?? null);
  return null;
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
  const evidence = await commentRunEvidence({
    comments,
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
  const { state: check } = await commentChain({ comments, seam: seam('pr', reads.chain), stopAt: 'pr', actor: CLOSE_OUT_ACTOR.PERSON });
  const stopAtGuard = await commentGuard({ comments, seam: seam('pr', reads.stopAtGuard), stopAt: 'pr' });
  const ladderGuard = await commentGuard({ comments, seam: seam(null, reads.ladderGuard), stopAt: null });

  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => ({ ok: true, json: async () => SELECTOR_REPLY }));
  let route;
  try {
    const rec = await getRecommendation(
      { identifier: ISSUE, title: 'Gate fixture', description: '', state: { name: ticketState, type: ticketState }, labels: [] },
      { parent: null, siblings: [], project: null, children: [], comments, planReviewLoop: assemblePlanReviewFacts(comments), focusedChild: null, attachments: [], runs: [], allRuns },
      { apiKey: 'stub', model: 'x' },
    );
    route = { codeRoute: rec.codeRoute ?? null, recommendedAction: rec.recommendedAction ?? null, ...(rec.liveWait ? { liveWait: rec.liveWait } : {}) };
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

// ─── The five seeds (seeds.json; plan-review notes 1, 2, 3, 7 and 8 on LIN-4513) ───────────────────────

/** What each seed pins beyond the common capture, computed for every case so no seed's reading hides another's. */
function seedExtras(seedCase, issue) {
  const { comments } = seedCase;
  const facts = assemblePlanReviewFacts(comments);
  const extras = {
    // Seed 1 (and 5's personSince): the plan-review loop's facts, its stop and its convergence.
    planReview: { facts, stop: reviewLoopStop(issue, facts), converging: reviewLoopConverging(facts.run) },
    // Seed 2: the live wait, CODE_ROUTES[0].
    liveWait: liveWaitOf(seedCase.allRuns),
    // Seed 5: each comment's authorship as the comment path reads it.
    authorship: comments.map((cm) => ({
      id: cm.id, kind: commentKindOf(cm.body), isPerson: isPersonComment(cm.body), landedWork: reportsLandedWork(cm.body), ruling: isRuling(cm.body),
    })),
  };
  // Seed 3: the write-time blind-read check (routes/proxy-writes.js): the read's body against the landing of the
  // trail as it stood before the read was posted.
  if (seedCase.writeCheck) {
    const readComment = comments.find((cm) => cm.id === seedCase.writeCheck);
    const before = comments.filter((cm) => cm !== readComment);
    extras.writeCheck = { landingBefore: landingPrUrls(before), check: checkBlindReadShape(readComment.body, { landing: landingPrUrls(before) }) };
  }
  return extras;
}

export function loadSeeds() {
  return JSON.parse(readFileSync(new URL('seeds.json', FIXTURE_DIR), 'utf8'));
}

/** goldens/seeds.json: every seed case's inputs, the common capture, the surfaces and the seed's own readings. */
export async function captureSeeds(input = loadSeeds()) {
  const seeds = [];
  for (const seed of input.seeds) {
    const cases = [];
    for (const stored of seed.cases) {
      const sc = { ...stored, comments: stored.commentIds.map((id) => {
        if (!Object.hasOwn(input.comments, id)) throw new Error(`comment-path-capture: seed ${seed.id}/${stored.id} names no comment ${id}`);
        return input.comments[id];
      }) };
      const statusOf = (url) => (Object.hasOwn(sc.statuses, url) ? sc.statuses[url] : UNREAD);
      const caseInput = { comments: sc.comments, statusOf, ticketState: sc.ticketState, allRuns: sc.allRuns };
      cases.push({
        id: sc.id,
        name: sc.name,
        inputs: { comments: sc.comments, statuses: sc.statuses, ticketState: sc.ticketState, allRuns: sc.allRuns, ...(sc.runsNote ? { runsNote: sc.runsNote } : {}), ...(sc.writeCheck ? { writeCheck: sc.writeCheck } : {}) },
        output: {
          ...(await captureCase(caseInput)),
          surfaces: await surfacesOf(caseInput),
          ...seedExtras(sc, { state: { type: sc.ticketState } }),
        },
      });
    }
    seeds.push({ id: seed.id, note: seed.note, cases });
  }
  return {
    _about: 'LIN-4514: the five comment-path seeds (seeds.json), each case\'s inputs and what the comment path decided: the common capture, the surfaces (route, check, both guards, PR reads) and the seed\'s own readings (planReview, liveWait, authorship, writeCheck). Derived by tests/helpers/comment-path-capture.js; never edit by hand.',
    seeds,
  };
}

// ─── The old measure readers over the frozen trails (goldens/readings.json; for P6, LIN-4519) ───────────
//
// Each measure reader is read over each trail as far as the frozen inputs carry it, and says `not measured` with its
// reason where they do not (docs/areas/reports-and-operator-tools.md: never zero). The frozen inputs hold comments and
// landings, not dispatch rows, request records or the workspace's other issues, so:
//   - round trips (lib/plan-review-round-trips.js): its walk settles R0 on pipeline rows, not read here; what it reads
//     from comments is extractVerdict's word (tier A), given for every comment that has one;
//   - churn (lib/pipeline-churn.js) and the effort readout (lib/effort-readout.js): dispatch rows (and request records
//     for cost), not read here; churn's verdict comes from a row's feedback, and the readout's survival from the round
//     trips' tiers, so neither has a comment-only part beyond tier A;
//   - follow-on ratio (lib/follow-on-ratio.js): the ratio needs the window's issues and relations, not read here; its
//     comment reading, the review-ledger diagnostic (C3-24), is given;
//   - stability measure 1 (scripts/stability-measures-blind.mjs readLanding): each walk-8 ticket's own landing
//     (landings.json) against its trail; a seed has no landing.

const NO_ROWS = 'the frozen inputs hold comments and landings, not dispatch rows';

function readingsOf(comments, landings) {
  return {
    roundTrips: {
      walk: notMeasured('roundTrips', `${NO_ROWS}: computeIssueRoundTrips settles R0 on the pipeline rows (GET /dispatch)`),
      tierA: comments.map((cm) => ({ id: cm.id, at: cm.createdAt, verdict: extractVerdict(cm.body) })).filter((v) => v.verdict !== null),
    },
    churn: notMeasured('churn', `${NO_ROWS}: classifyTicket classifies a ticket's dispatch rows, and reads a verdict from a row's feedback`),
    effortReadout: notMeasured('effortReadout', `${NO_ROWS} or request records: computeEffortReadout reads the dispatch history and its cost records`),
    followOnRatio: {
      ratio: notMeasured('followOnRatio', 'the frozen inputs hold one ticket\'s trail, not the window\'s issues and their relations'),
      reviewLedger: followOnInternal.hasReviewLedger({ description: '', comments }),
    },
    stabilityBlind: landings
      ? landings.map((l) => ({ commit: l.commit, mergedAt: l.date, ...readLanding({ landing: l, files: l.files, trail: { comments, truncated: false }, repo: 'JKershaw/LinearViewer' }) }))
      : notMeasured('blind', 'a seed has no landing'),
  };
}

/** goldens/readings.json: the old measure readers over each walk-8 trail and each seed case. */
export function captureReadings() {
  const { landings } = JSON.parse(readFileSync(new URL('landings.json', FIXTURE_DIR), 'utf8'));
  const seeds = loadSeeds();
  return {
    _about: 'LIN-4514: the old measure readers (round trips, churn, effort readout, follow-on ratio, stability measure 1) over the frozen trails, as far as they carry each reader; `not measured` with its reason where they do not. Derived by tests/helpers/comment-path-capture.js; never edit by hand.',
    tickets: TICKETS.map((name) => ({ ticket: loadInput(name).ticket, ...readingsOf(loadInput(name).comments, landings[name]) })),
    seeds: seeds.seeds.map((seed) => ({
      id: seed.id,
      cases: seed.cases.map((sc) => ({ id: sc.id, ...readingsOf(sc.commentIds.map((id) => seeds.comments[id]), null) })),
    })),
  };
}

/** The first difference between two byte strings, as a line, a column and both lines: a readable diff location. */
export function firstDifference(want, got) {
  if (want === got) return null;
  const a = want.split('\n');
  const b = got.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const col = [...(a[i] ?? '')].findIndex((ch, j) => ch !== (b[i] ?? '')[j]);
      return { line: i + 1, column: (col < 0 ? Math.min((a[i] ?? '').length, (b[i] ?? '').length) : col) + 1, committed: a[i] ?? '(end of file)', rerun: b[i] ?? '(end of file)', committedLines: a.length, rerunLines: b.length };
    }
  }
  return { line: null, column: null, committed: '(same lines; bytes differ)', rerun: '', committedLines: a.length, rerunLines: b.length };
}

/** Every output file, as {relative path: bytes}. */
export async function captureAll() {
  const files = {};
  for (const name of TICKETS) files[`goldens/${name}.json`] = stableJson(internRefs(await captureTicket(loadInput(name))));
  files['rows.json'] = stableJson(internRefs(await captureRows()));
  files['goldens/seeds.json'] = stableJson(internRefs(await captureSeeds()));
  files['goldens/readings.json'] = stableJson(captureReadings());
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
