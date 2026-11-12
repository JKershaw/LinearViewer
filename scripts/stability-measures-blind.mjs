// Measure 1, no new mess: the pre-merge blind read, counted from the ledger (LIN-4439, piece 4 of LIN-4396). Pure, like
// the core: landings, their file lists and each ticket's comment trail come in as data, the row comes out. The reads are
// scripts/stability-measures-tracker.mjs readTrails (comments through createProxyClient on --api).
//
// It replaces LIN-4422's sample of up to 8 ordinary landings, hand-scored from a file of Balance cells, in place:
// measure 1 has one source, the `## Blind read` comments the blind-read stage posts before close-out merges (LIN-4437,
// LIN-4438).
//
// Every first-parent landing of the window is counted once, by the first of these that holds:
//   no ticket                 the landing names no ticket of its own (ownTicket, the core's one rule);
//   not an ordinary landing   LIN-4422's definition, kept here as isOrdinaryLanding: it names its own ticket and touches
//                             a path outside docs/;
//   landed before the gate    merged at or before piece 3's landing (GATE_LANDING, PR #2413). "At": the gate's own
//                             merge was not held by the gate it delivered;
//   no read on record         no well-formed blind read (parseBlindRead) posted on the ticket before the merge names the
//                             landing's PR;
//   read                      the newest such read, with its verdict (better, same or worse).
// The landing's PR is its number (landingPr) matched against landingPrUrls of the trail as it stood at the merge: the
// landing then was the one the gate read. A ticket whose trail could not be read whole (a failed read, or comments the
// proxy flagged truncated) and a landing with no file list are unreadable: the row is partial, never "no read".
//
// The hand-run passes' Balance-to-sign rule (codeBalance) left with the sample: the paper's coder is its one user, and
// it lives beside that coder (docs/papers/harbour/cleaner-than-it-started-scripts/balance-sign.mjs).

import { BLIND_READ_VERDICTS } from '../lib/prompts/blind-read-words.js';
import { landingPrUrls, parseBlindRead, prOf } from '../lib/run-ledger.js';
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

/** Whether a full PR URL is PR `n` (of `repo`, when the repository is known; GitHub's owner and name ignore case). */
const isPr = (url, n, repo) => {
  const pr = prOf(url);
  return pr.number === n && (!repo || pr.repo.toLowerCase() === repo.toLowerCase());
};

const atOrBefore = (a, b) => Date.parse(a) <= Date.parse(b);

/**
 * The first reason a landing is unread that needs no trail, or null when only its ticket's comments can tell.
 * → { reason } | { unreadable } | { ticket } (read the trail).
 */
function triage(landing, files, gate) {
  const ticket = ownTicket(landing.subject, landing.body);
  if (!ticket) return { reason: UNREAD.noTicket };
  if (!files) return { ticket, unreadable: 'no file list' };
  if (!isOrdinaryLanding(landing, files)) return { ticket, reason: UNREAD.notOrdinary };
  if (atOrBefore(landing.date, gate.mergedAt)) return { ticket, reason: UNREAD.beforeGate };
  return { ticket };
}

/**
 * The tickets whose comments measure 1 needs: those of the window's ordinary landings after the gate. The CLI reads
 * only these, so a window before the gate spends no proxy call on measure 1.
 */
export function ticketsToRead({ landings, numstat, gate = GATE_LANDING }) {
  const filesOf = new Map(numstat.map((c) => [c.commit, c.files]));
  const tickets = new Set();
  for (const l of landings) {
    const t = triage(l, filesOf.get(l.commit), gate);
    if (t.ticket && !t.reason && !t.unreadable) tickets.add(t.ticket);
  }
  return [...tickets];
}

/**
 * One landing against its ticket's trail. `trail` is { comments, truncated } or { reason } (a failed read).
 * → { status: 'read', verdict, readAt, commentId, prUrl } | { status: <an UNREAD reason>, why? } | { status: 'unreadable', why }.
 */
export function readLanding({ landing, files, trail, gate = GATE_LANDING, repo = null }) {
  const t = triage(landing, files, gate);
  if (t.unreadable) return { status: 'unreadable', why: t.unreadable };
  if (t.reason) return { status: t.reason };
  if (!trail || trail.reason) return { status: 'unreadable', why: `ticket read failed: ${trail?.reason ?? 'not read'}` };
  if (trail.truncated) return { status: 'unreadable', why: 'the ticket\'s comments came back truncated' };
  const pr = landingPr(landing.subject);
  if (pr == null) return { status: UNREAD.noRead, why: 'the landing names no PR' };
  const before = (trail.comments ?? []).filter((c) => c && Date.parse(c.createdAt ?? '') < Date.parse(landing.date));
  const prUrl = landingPrUrls(before).find((u) => isPr(u, pr, repo)) ?? null;
  if (!prUrl) return { status: UNREAD.noRead, why: `#${pr} is not on the ticket's landing before the merge` };
  const reads = before.map(parseBlindRead).filter((r) => r && r.prs.includes(prUrl));
  if (!reads.length) return { status: UNREAD.noRead, why: `no blind read naming #${pr} before the merge` };
  const latest = reads.reduce((a, b) => (Date.parse(b.at ?? '') >= Date.parse(a.at ?? '') ? b : a));
  return { status: 'read', verdict: latest.verdict, readAt: latest.at, commentId: latest.commentId, prUrl };
}

/**
 * Measure 1's row. `landings` are parseLandingLog() records of the window, `numstat` parseNumstat() records of the
 * same window (files per commit), `trails` a Map ticket → { comments, truncated } | { reason } holding at least
 * ticketsToRead()'s tickets. `repo` (owner/name) narrows a PR number to this repository's URL when it is known.
 */
export function blindRow({ landings, numstat, trails, gate = GATE_LANDING, repo = null, reference = null }) {
  if (!landings.length) return notMeasured('blind', 'no landings in the window', { reference });
  const filesOf = new Map(numstat.map((c) => [c.commit, c.files]));
  const verdicts = Object.fromEntries(BLIND_READ_VERDICTS.map((v) => [v, 0]));
  const unread = Object.fromEntries(Object.values(UNREAD).map((r) => [r, 0]));
  const unreadableWhy = [];
  const perLanding = [];
  let read = 0;
  for (const l of [...landings].reverse()) {
    const ticket = ownTicket(l.subject, l.body);
    const r = readLanding({ landing: l, files: filesOf.get(l.commit), trail: ticket ? trails.get(ticket) : null, gate, repo });
    perLanding.push({ commit: l.commit, ticket, pr: landingPr(l.subject), mergedAt: l.date, ...r });
    if (r.status === 'read') { read++; verdicts[r.verdict]++; } else if (r.status === 'unreadable') unreadableWhy.push(`${l.commit.slice(0, 9)} ${r.why}`);
    else unread[r.status]++;
  }
  if (unreadableWhy.length === landings.length) return notMeasured('blind', `no landing could be read (${unreadableWhy[0]})`, { reference });
  const value = {
    landings: landings.length, read, verdicts, unread,
    gate: { commit: gate.commit, pr: gate.pr, mergedAt: gate.mergedAt }, repo,
    perLanding,
  };
  return row('blind', value, {
    unreadable: unreadableWhy.length,
    reason: unreadableWhy.length ? `${unreadableWhy.length} landing(s) unreadable: ${unreadableWhy.join('; ')}` : null,
    reference,
  });
}
