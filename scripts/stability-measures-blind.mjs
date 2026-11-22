// Measure 1, no new mess: the pre-merge blind read, counted from the verdict records (LIN-4439 counted the `## Blind read`
// comments; LIN-4519, P6 of LIN-4513, reads the blind-read verdicts instead). Pure, like the core: landings, their file
// lists, each ticket's verdict facts and the change records' PR URLs come in as data, the row comes out. The reads are
// scripts/stability-measures.mjs readBlindRow (readVerdictRecords in scripts/stability-measures-tracker.mjs, through the
// workspace proxy).
//
// Every first-parent landing of the window is counted once, by the first of these that holds:
//   no ticket                 the landing names no ticket of its own (ownTicket, the core's one rule);
//   not an ordinary landing   LIN-4422's definition, kept here as isOrdinaryLanding: it names its own ticket and touches
//                             a path outside docs/;
//   landed before the gate    merged at or before piece 3's landing (GATE_LANDING, PR #2413). "At": the gate's own
//                             merge was not held by the gate it delivered;
//   before the verdict        merged before VERDICT_RECORDS_SINCE, the instant the records cover the workspace's verdicts
//   records                   (lib/records/verdict-facts.js). A landing then cannot be read from records, and is never
//                             counted "no read on record" or guessed from a comment;
//   no read on record         no blind-read verdict first written before the merge, with an outcome that is one of
//                             better, same or worse, whose `on` change's ref names the landing's PR;
//   read                      the newest such verdict, with its outcome.
// The landing's PR is its number (landingPr) matched against the change records' refs: the landing then was the change
// the verdict read. The match is narrowed to this repository when its origin is a GitHub remote (`repo`). A ticket whose
// verdict records could not be read is unreadable: the row is partial, never "no read". A landing counted "before the
// verdict records" is not read either, so it is in the row's `unreadable` count, and the row's reason says so.
//
// The hand-run passes' Balance-to-sign rule (codeBalance) left with the sample: the paper's coder is its one user, and
// it lives beside that coder (docs/papers/harbour/cleaner-than-it-started-scripts/balance-sign.mjs).

import { BLIND_READ_KIND, BLIND_READ_VERDICTS } from '../lib/prompts/blind-read-words.js';
import { VERDICT_RECORDS_SINCE, verdictCoverageAt, verdictsInWindow } from '../lib/records/verdict-facts.js';
import { prOf } from '../lib/run-ledger.js';
import { landingPr, notMeasured, ownTicket, row } from './stability-measures-core.mjs';

/** Piece 3's landing (LIN-4438): from this merge, close-out waits on a recorded `## Blind read` naming the PR. */
export const GATE_LANDING = Object.freeze({
  commit: 'eb14b7fff9f1b0e0de623add1b1fc61fd924021a', pr: 2413, ticket: 'LIN-4438', mergedAt: '2026-11-12T21:06:21Z',
});

/** The named reasons a landing is unread, in the order they are tried. */
export const UNREAD = Object.freeze({
  noTicket: 'no ticket',
  notOrdinary: 'not an ordinary landing',
  beforeGate: 'landed before the gate',
  beforeRecords: 'before the verdict records',
  noRead: 'no read on record',
});

/** LIN-4422's ordinary landing: it names its own ticket and touches a path outside docs/. */
export function isOrdinaryLanding(landing, files) {
  return ownTicket(landing.subject, landing.body) != null && files.some((f) => !f.path.startsWith('docs/'));
}

/** A GitHub remote URL (https or ssh) → `owner/name`, or null. */
export function repoSlugOf(remoteUrl) {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(remoteUrl ?? '').trim());
  return m ? m[1] : null;
}

/**
 * The change records' PR URLs by change id: what a verdict's `on` names, read to its PR. Pure.
 * @param {object[]} changes - change records (current versions; `id`, `fields.ref`)
 * @returns {Map<string, string>}
 */
export function changeRefsOf(changes = []) {
  return new Map(changes.filter((c) => typeof c?.id === 'string' && typeof c.fields?.ref === 'string').map((c) => [c.id, c.fields.ref]));
}

/** Whether a full PR URL is PR `n` (of `repo`, when the repository is known; GitHub's owner and name ignore case). */
const isPr = (url, n, repo) => {
  const pr = prOf(url);
  return pr.number === n && (!repo || pr.repo.toLowerCase() === repo.toLowerCase());
};

const atOrBefore = (a, b) => Date.parse(a) <= Date.parse(b);

/**
 * The first reason a landing is unread that needs no verdict facts, or null when only its ticket's records can tell.
 * → { reason } | { unreadable } | { ticket } (read the ticket's verdicts).
 */
function triage(landing, files, gate, since) {
  const ticket = ownTicket(landing.subject, landing.body);
  if (!ticket) return { reason: UNREAD.noTicket };
  if (!files) return { ticket, unreadable: 'no file list' };
  if (!isOrdinaryLanding(landing, files)) return { ticket, reason: UNREAD.notOrdinary };
  if (atOrBefore(landing.date, gate.mergedAt)) return { ticket, reason: UNREAD.beforeGate };
  if (!verdictCoverageAt(landing.date, since).covered) return { ticket, reason: UNREAD.beforeRecords };
  return { ticket };
}

/**
 * The tickets whose verdict records measure 1 needs: those of the window's ordinary landings at or after the cutover.
 * The CLI reads only these, so a window before the cutover spends no proxy call on measure 1.
 */
export function ticketsToRead({ landings, numstat, gate = GATE_LANDING, since = VERDICT_RECORDS_SINCE }) {
  const filesOf = new Map(numstat.map((c) => [c.commit, c.files]));
  const tickets = new Set();
  for (const l of landings) {
    const t = triage(l, filesOf.get(l.commit), gate, since);
    if (t.ticket && !t.reason && !t.unreadable) tickets.add(t.ticket);
  }
  return [...tickets];
}

/**
 * One landing against its ticket's verdict facts (verdictFactsFromRecords or readVerdictFactsThroughProxy: a view with
 * `measured`, and `verdicts` when measured) and the change refs (changeRefsOf).
 * → { status: 'read', verdict, readAt, verdictId, prUrl } | { status: <an UNREAD reason>, why? } | { status: 'unreadable', why }.
 */
export function readLanding({ landing, files, facts, changeRefs = new Map(), gate = GATE_LANDING, since = VERDICT_RECORDS_SINCE, repo = null }) {
  const t = triage(landing, files, gate, since);
  if (t.unreadable) return { status: 'unreadable', why: t.unreadable };
  if (t.reason) return { status: t.reason };
  if (!facts?.measured) return { status: 'unreadable', why: facts?.reason ?? 'the ticket\'s verdict records were not read' };
  const pr = landingPr(landing.subject);
  if (pr == null) return { status: UNREAD.noRead, why: 'the landing names no PR' };
  const reads = [];
  for (const v of verdictsInWindow(facts.verdicts, { judgement: BLIND_READ_KIND, to: landing.date })) {
    if (!BLIND_READ_VERDICTS.includes(v.outcome)) continue;
    const prUrl = v.on.map((o) => changeRefs.get(o.id)).find((u) => u && isPr(u, pr, repo));
    if (prUrl) reads.push({ v, prUrl });
  }
  if (!reads.length) return { status: UNREAD.noRead, why: `no blind read naming #${pr} before the merge` };
  const latest = reads.reduce((a, b) => (Date.parse(b.v.at) >= Date.parse(a.v.at) ? b : a));
  return { status: 'read', verdict: latest.v.outcome, readAt: latest.v.at, verdictId: latest.v.id, prUrl: latest.prUrl };
}

/**
 * Measure 1's row. `landings` are parseLandingLog() records of the window, `numstat` parseNumstat() records of the
 * same window (files per commit), `facts` a Map ticket → verdict facts holding at least ticketsToRead()'s tickets, and
 * `changeRefs` changeRefsOf() of the change records read with them. `repo` (owner/name) narrows a PR number to this
 * repository's URL when it is known.
 */
export function blindRow({
  landings, numstat, facts = new Map(), changeRefs = new Map(), gate = GATE_LANDING, since = VERDICT_RECORDS_SINCE, repo = null, reference = null,
}) {
  if (!landings.length) return notMeasured('blind', 'no landings in the window', { reference });
  const filesOf = new Map(numstat.map((c) => [c.commit, c.files]));
  const verdicts = Object.fromEntries(BLIND_READ_VERDICTS.map((v) => [v, 0]));
  const unread = Object.fromEntries(Object.values(UNREAD).map((r) => [r, 0]));
  const unreadableWhy = [];
  const perLanding = [];
  let read = 0;
  for (const l of [...landings].reverse()) {
    const ticket = ownTicket(l.subject, l.body);
    const r = readLanding({
      landing: l, files: filesOf.get(l.commit), facts: ticket ? facts.get(ticket) : null, changeRefs, gate, since, repo,
    });
    perLanding.push({ commit: l.commit, ticket, pr: landingPr(l.subject), mergedAt: l.date, ...r });
    if (r.status === 'read') { read++; verdicts[r.verdict]++; } else if (r.status === 'unreadable') unreadableWhy.push(`${l.commit.slice(0, 9)} ${r.why}`);
    else unread[r.status]++;
  }
  const beforeRecords = unread[UNREAD.beforeRecords];
  const counted = landings.length - unreadableWhy.length - beforeRecords;
  if (counted === 0) {
    const reason = unreadableWhy.length
      ? `no landing could be read (${unreadableWhy[0]}${beforeRecords ? `; ${beforeRecords} merged before the verdict records` : ''})`
      : `every landing merged before the verdict records began (${since ?? 'no cutover'})`;
    return notMeasured('blind', reason, { reference });
  }
  const reasons = [];
  if (unreadableWhy.length) reasons.push(`${unreadableWhy.length} landing(s) unreadable: ${unreadableWhy.join('; ')}`);
  if (beforeRecords) reasons.push(`${beforeRecords} landing(s) merged before the verdict records began (${since ?? 'no cutover'}), not read from them`);
  const value = {
    landings: landings.length, read, verdicts, unread,
    gate: { commit: gate.commit, pr: gate.pr, mergedAt: gate.mergedAt }, verdictRecordsSince: since, repo,
    perLanding,
  };
  return row('blind', value, {
    unreadable: unreadableWhy.length + beforeRecords,
    reason: reasons.length ? reasons.join('; ') : null,
    reference,
  });
}
