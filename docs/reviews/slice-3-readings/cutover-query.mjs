// LIN-4517 (slice 3 P4): the read-only cutover query. Prints counts, task ids and ticket ids only; never a comment body,
// a PR URL or the environment.
//
// Which open tasks would be stranded when P5 stops reading verdicts from comments:
//   - comment-only: the task's latest review, plan review or blind read is a comment, and no verdict record of that
//     stage was written at or after it (less RECORD_LAG_MS: a judge writing both posts them minutes apart);
//   - legacy ledger: the latest review's `### What CI Did Not Prove` section carries items as text (legacyLedgerOf,
//     the close-out gate's own test);
//   - ledger read as empty with items: the same section, which isEmptyStatement reads as empty although it lists
//     items (finding-76683071). The gate reads these as "none open" today.
// And how many open tasks have no verdict record at all.
//
// "Open" is the task record's state AND its ticket's: slice 1's manifest import made a task per ticket, and a task is
// not ended when its ticket closes, so a task whose ticket is completed, canceled or no longer listed is not open.
//
// Two steps, because the records live in the database and the comments in the tracker (plan-fbd0aca5: "through the
// proxy and `railway ssh` into `harbour-cat`"):
//   1. `dump`, inside harbour-cat (the route production-read.mjs uses; see README.md): the open task records, every
//      verdict record and every change record's task, as JSON on stdout. Run from /dev/shm with /app/node_modules
//      linked beside it (docs/areas/reports-and-operator-tools.md).
//   2. `query --dump <file>`, locally: the tickets' states and comments through the workspace proxy
//      ($HARBOUR_LOCAL_BASE/api/proxy, read-only GETs), classified with the readers the gate uses today.
//
// The module has no static import of lib/, so the dump runs from /dev/shm where lib/ does not resolve. The comment
// readers are loaded by loadReaders() only when the query classifies. The readers retire in P7 (LIN-4520); this query
// is for P4 and P5's pause, and goes with them.

import { pathToFileURL } from 'node:url';

export const STAGES = Object.freeze(['review', 'plan-review', 'blind-read']);
export const RECORD_LAG_MS = 60 * 60 * 1000;
const TERMINAL_TICKET_STATES = new Set(['completed', 'canceled']);

/** The comment readers today's gate uses, loaded from the repo's lib/ (never from the container). */
export async function loadReaders() {
  const trail = await import('../../../lib/run-trail.js');
  const findings = await import('../../../lib/close-out-findings.js');
  return {
    commentKindOf: trail.commentKindOf,
    latestReviewComment: trail.latestReviewComment,
    readTrail: trail.readTrail,
    extractVerdict: trail.extractVerdict,
    parseBlindRead: trail.parseBlindRead,
    legacyLedgerOf: findings.legacyLedgerOf,
  };
}

const firstAt = (versions) => versions.reduce((min, s) => (!min || s.at < min ? s.at : min), null);

/**
 * Step 1: what the query needs from the records store, as plain data. `store` is a RecordsStore (lib/records-store.js)
 * or anything with its `find` and `versionsOf`.
 * @returns {Promise<{asOf: string, tasks: object[], verdicts: object[], changes: object[]}>}
 */
export async function dumpFromStore({ store, urlKey, asOf = new Date().toISOString() }) {
  const tasks = (await store.find(urlKey, { kind: 'task', state: 'open', asOf }))
    .map((t) => ({ id: t.id, ref: t.fields?.ref ?? null }));
  const verdictSnaps = await store.find(urlKey, { kind: 'verdict', asOf });
  const versions = await store.versionsOf(urlKey, verdictSnaps.map((v) => v.id));
  const verdicts = verdictSnaps.map((v) => ({
    id: v.id,
    by: v.by ?? null,
    state: v.state,
    outcome: v.fields?.outcome ?? null,
    in: v.in ?? null,
    on: [].concat(v.links?.on ?? []),
    via: v.via ?? null,
    at: firstAt(versions.filter((s) => s.id === v.id)) ?? v.at,
  }));
  const changes = (await store.find(urlKey, { kind: 'change', asOf })).map((c) => ({ id: c.id, in: c.in ?? null, state: c.state }));
  return { asOf, tasks, verdicts, changes };
}

/** The stage a verdict record speaks for: its writer. */
function stageOfVerdict(v) {
  return STAGES.includes(v.by) ? v.by : null;
}

/** The tasks a verdict is filed under: its `in`, and the task of each change it rests on. */
function tasksOfVerdict(v, taskOfChange) {
  const out = new Set();
  if (v.in) out.add(v.in);
  for (const ref of v.on) {
    const task = taskOfChange.get(String(ref).split('@')[0]);
    if (task) out.add(task);
  }
  return [...out];
}

/**
 * Item lines in a ledger section's text, less a line that itself says "none". An item is a bullet, a numbered line, or
 * a line led by bold text (`**Item — ...**`, the shape a live ledger used on LIN-2634).
 */
export function ledgerItemLines(raw) {
  return String(raw || '').split('\n')
    .map((line) => line.match(/^\s*(?:(?:[-*+]|\d+[.)])\s+|(?=\*\*\S|__\S))(\S.*)$/))
    .filter((m) => m && !/^\(?\s*(?:none|n\/a|nothing)\b/i.test(m[1].replace(/[*_`]/g, '')))
    .map((m) => m[1]);
}

const latestOf = (comments, pred) => comments.filter(pred)
  .reduce((latest, c) => (!latest || Date.parse(c.createdAt || '') >= Date.parse(latest.createdAt || '') ? c : latest), null);

/** The latest comment verdict of each stage on one ticket's comments: `{stage: {at, verdict}}`. */
function commentVerdictsOf(comments, readers) {
  const out = {};
  const review = readers.latestReviewComment(comments);
  if (review) {
    const trail = readers.readTrail(comments);
    out.review = { at: review.createdAt || null, verdict: trail.review?.verdict ?? 'unknown' };
  }
  const plan = latestOf(comments, (c) => readers.commentKindOf(c) === 'plan-review');
  if (plan) out['plan-review'] = { at: plan.createdAt || null, verdict: readers.extractVerdict(plan.body) ?? 'unknown' };
  const blind = latestOf(comments, (c) => readers.parseBlindRead(c) !== null);
  if (blind) out['blind-read'] = { at: blind.createdAt || null, verdict: readers.parseBlindRead(blind).verdict };
  return out;
}

/**
 * Step 2, pure: the cutover reading from a dump and the tickets.
 * @param {Object} args
 * @param {{asOf: string, tasks: object[], verdicts: object[], changes: object[]}} args.dump - dumpFromStore's answer
 * @param {Map<string, {state: string, comments?: object[], truncated?: boolean}>} args.tickets - every listed ticket by
 *   identifier: `state` is the tracker's state type; `comments` is read for open tickets with an open task
 * @param {Object} args.readers - loadReaders()'s answer
 */
export function cutoverReading({ dump, tickets, readers }) {
  const taskOfChange = new Map(dump.changes.map((c) => [c.id, c.in]));
  const recordsByTask = new Map();
  for (const v of dump.verdicts) {
    for (const task of tasksOfVerdict(v, taskOfChange)) {
      if (!recordsByTask.has(task)) recordsByTask.set(task, []);
      recordsByTask.get(task).push(v);
    }
  }

  const window = { openTaskRecords: dump.tasks.length, noTicket: 0, ticketClosed: 0, ticketNotListed: 0, open: 0 };
  const open = [];
  const noTicket = [];
  for (const task of dump.tasks) {
    if (!task.ref) { window.noTicket++; noTicket.push(task); continue; }
    const ticket = tickets.get(task.ref);
    if (!ticket) { window.ticketNotListed++; continue; }
    if (TERMINAL_TICKET_STATES.has(ticket.state)) { window.ticketClosed++; continue; }
    window.open++;
    open.push({ task, ticket });
  }

  const commentOnly = [];
  const legacyLedger = [];
  const ledgerReadEmptyWithItems = [];
  const withVerdictRecord = [];
  const noVerdictRecord = { count: 0, neverJudged: 0, judgedByCommentOnly: 0 };
  const truncated = [];
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));

  for (const { task, ticket } of open) {
    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
    if (ticket.truncated) truncated.push(task.ref);
    const records = recordsByTask.get(task.id) ?? [];
    const fromComments = commentVerdictsOf(comments, readers);
    const stranded = [];
    for (const [stage, seen] of Object.entries(fromComments)) {
      const at = Date.parse(seen.at || '');
      const covered = records.some((v) => stageOfVerdict(v) === stage && Date.parse(v.at) >= at - RECORD_LAG_MS);
      if (!covered) stranded.push({ stage, verdict: seen.verdict, at: seen.at });
    }
    const row = { task: task.id, ticket: task.ref };
    if (stranded.length) {
      commentOnly.push({ ...row, stages: stranded });
      for (const s of stranded) byStage[s.stage]++;
    }
    const review = readers.latestReviewComment(comments) ? readers.readTrail(comments).review : null;
    if (readers.legacyLedgerOf(review)) legacyLedger.push(row);
    else if (review?.ledger?.present && review.ledger.empty && ledgerItemLines(review.ledger.raw).length) ledgerReadEmptyWithItems.push(row);
    if (records.length) withVerdictRecord.push({ ...row, verdicts: records.map((v) => v.id) });
    else {
      noVerdictRecord.count++;
      if (Object.keys(fromComments).length) noVerdictRecord.judgedByCommentOnly++;
      else noVerdictRecord.neverJudged++;
    }
  }

  const stranded = new Map();
  for (const r of [...commentOnly, ...legacyLedger, ...ledgerReadEmptyWithItems]) stranded.set(r.task, r.ticket);
  const byTicket = (a, b) => (a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0);
  return {
    asOf: dump.asOf,
    window,
    needsImportOrReReview: { count: stranded.size, tasks: [...stranded].map(([task, ticket]) => ({ task, ticket })).sort(byTicket) },
    commentOnly: { count: commentOnly.length, byStage, tasks: commentOnly.sort(byTicket) },
    legacyLedger: { count: legacyLedger.length, tasks: legacyLedger.sort(byTicket) },
    ledgerReadEmptyWithItems: { count: ledgerReadEmptyWithItems.length, tasks: ledgerReadEmptyWithItems.sort(byTicket) },
    withVerdictRecord: { count: withVerdictRecord.length, tasks: withVerdictRecord.sort(byTicket) },
    noVerdictRecord,
    noTicketTasks: { count: noTicket.length, withVerdictRecord: noTicket.filter((t) => recordsByTask.has(t.id)).length, tasks: noTicket.map((t) => t.id).sort() },
    truncatedComments: truncated.sort(),
    importMarkedVerdicts: dump.verdicts.filter((v) => v.via === 'import').length,
  };
}

/** GET through the workspace proxy, waiting out a 429 as its Retry-After says. */
async function proxyGet(base, path, fetchImpl) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetchImpl(`${base}${path}`);
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 5;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
    return res.json();
  }
  throw new Error(`GET ${path}: still rate-limited`);
}

/**
 * The tickets the reading needs, through the proxy: every listed ticket's state type, and the comments of each open
 * ticket that has an open task in the dump.
 * @returns {Promise<Map<string, {state: string, comments?: object[], truncated?: boolean}>>}
 */
export async function readTickets({ base, dump, fetchImpl = fetch }) {
  const tickets = new Map();
  let after = null;
  do {
    const page = await proxyGet(base, `/issues?limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`, fetchImpl);
    for (const issue of page.issues || []) tickets.set(issue.identifier, { state: issue.state?.type ?? null });
    after = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  const wanted = [...new Set(dump.tasks.map((t) => t.ref).filter((ref) => ref && tickets.has(ref) && !TERMINAL_TICKET_STATES.has(tickets.get(ref).state)))];
  for (const ref of wanted) {
    const issue = await proxyGet(base, `/issues/${encodeURIComponent(ref)}`, fetchImpl);
    tickets.set(ref, {
      state: issue.trashed ? 'canceled' : (issue.state?.type ?? tickets.get(ref).state),
      comments: (issue.comments || []).map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt })),
      truncated: !!issue.truncated?.comments,
    });
  }
  return tickets;
}

async function main(argv) {
  const [mode, ...rest] = argv;
  if (mode === 'dump') {
    // Inside harbour-cat only: the deployed build and its database. Prints records data, never the environment.
    const { MongoClient } = await import('mongodb');
    const { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } = await import('/app/lib/records-store.js');
    const anchorId = rest[0] || 'plan-fbd0aca5';
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    try {
      const db = client.db('linear-viewer');
      const records = db.collection(RECORDS_COLLECTION);
      // The workspace: the one holding LIN-4517's plan piece (its key is used here and never printed).
      const anchor = await records.findOne({ id: anchorId }, { projection: { urlKey: 1 } });
      if (!anchor) throw new Error('anchor record not found');
      const store = new RecordsStore({ records, refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
      process.stdout.write(JSON.stringify(await dumpFromStore({ store, urlKey: anchor.urlKey })));
    } finally {
      await client.close();
    }
    return;
  }
  if (mode === 'query') {
    const { readFile } = await import('node:fs/promises');
    const file = rest[rest.indexOf('--dump') + 1];
    if (rest.indexOf('--dump') === -1 || !file) throw new Error('usage: cutover-query.mjs query --dump <file>');
    const base = process.env.HARBOUR_LOCAL_BASE ? `${process.env.HARBOUR_LOCAL_BASE}/api/proxy` : null;
    if (!base) throw new Error('HARBOUR_LOCAL_BASE is not set');
    const dump = JSON.parse(await readFile(file, 'utf8'));
    const tickets = await readTickets({ base, dump });
    console.log(JSON.stringify(cutoverReading({ dump, tickets, readers: await loadReaders() }), null, 2));
    return;
  }
  throw new Error('usage: cutover-query.mjs dump [anchor-record-id] | query --dump <file>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => { console.error(err.message); process.exit(1); });
}
