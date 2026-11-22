// HISTORIC READERS (LIN-4519, P6 of LIN-4513). The comment readers that measure 1 used until P6: the `## Blind read`
// comment of each landing's ticket, through parseBlindRead and landingPrUrls. The live measure reads blind-read verdict
// records from VERDICT_RECORDS_SINCE (scripts/stability-measures-blind.mjs). This file exists only so that the committed
// readings can be reproduced: scripts/slice-3-pre-landing-readings.mjs (history-2026-11-21.json) and the frozen walk-8
// comment-path readings (tests/helpers/comment-path-capture.js). Nothing live imports it. P7 (LIN-4520) deletes it with the
// comment readers it calls, and the committed readings stay.
//
// What follows is the pre-P6 scripts/stability-measures-blind.mjs, unchanged, with the pre-P6 trail read beside it.

const enc = encodeURIComponent;

import { BLIND_READ_VERDICTS } from '../lib/prompts/blind-read-words.js';
import { prOf } from '../lib/run-ledger.js';
import { landingPrUrls, parseBlindRead } from '../lib/run-trail.js';
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

// ── the pre-P6 trail read (LIN-4439, measure 1) ─────────────────────────────
const issueFailure = (r) => (r.status === 404 ? 'issue not found' : r.reason);

/** One issue read → its comment trail: { comments, truncated } or { reason }. */
const trailOf = (r) => {
  if (!r.ok) return { reason: issueFailure(r) };
  if (!Array.isArray(r.body?.comments)) return { reason: 'issue body has no comment list' };
  return { comments: r.body.comments, truncated: r.body?.truncated?.comments === true };
};

/**
 * The comment trails measure 1 reads (scripts/stability-measures-blind.mjs blindRow): ticket → { comments, truncated }
 * or { reason }. A ticket already in `known` (readTracker's own issue reads) costs no call; the rest are one
 * GET /issues/{id} each, in order. A truncated trail is returned flagged, never as if whole.
 */
export async function readTrails({ client, tickets, known = new Map() }) {
  const trails = new Map();
  for (const id of tickets) {
    if (known.has(id)) { trails.set(id, known.get(id)); continue; }
    trails.set(id, trailOf(await client.get(`/issues/${enc(id)}`)));
  }
  return { trails, stats: client.stats };
}

