#!/usr/bin/env node
/**
 * LIN-4501 (P1): the pre-deploy tasks import. BRANCH-ONLY: this script is deleted in the same PR, before merge (no script
 * that reads sealed blocks or stage headings may survive on main while P2 waits).
 *
 * It gives every open ticket its task, with `asked` = lib/asked-of.js askedOf (the sealed words, else the text before
 * the first `## Implementation Plan` heading, else the whole description), before P1 deploys, so no stage's later write
 * to a description can become a task's immutable `asked`. Tickets an existing record already names hold their task
 * through a claim already (the store resolves a named ticket to its task when the record is written), so they show as
 * held. A closed ancestor's task is made and ended as its ticket ended (John's ruling of 20 Nov, lib/records-store.js
 * ensureTask). Every task is made through the checked writer (lib/records/writes.js taskOfTicket), as the dispatch seat
 * and the take fallback make theirs.
 *
 * Two steps, because the tracker and the database are reachable from different places:
 *
 *   1. plan (where the workspace proxy answers): read every open ticket through the proxy, and each one's ancestors, and
 *      write the plan: per ticket its state, parent and `asked`.
 *        node scripts/records/lin-4501-tasks-import.mjs plan --base "$HARBOUR_LOCAL_BASE" --urlkey linearviewer --out plan.json
 *   2. apply (inside the production service, where the database is): read the plan on stdin; a dry run prints the table
 *      and writes nothing; --apply writes the tasks and prints the table again with what was made.
 *        node scripts/records/lin-4501-tasks-import.mjs apply < plan.json
 *        node scripts/records/lin-4501-tasks-import.mjs apply --apply < plan.json
 *
 * Re-running --apply makes nothing new: a ticket with a task is held, and ensureTask's version index makes a concurrent
 * second write the same task. The database is the server's: MONGODB_URI. A connection string is never printed.
 */
import { MongoClient } from 'mongodb';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';

const DB_NAME = 'linear-viewer';
const WRITER = 'import';
const LIST_PAGE = 250;
const PACE_MS = 1100; // the proxy allows 60 requests a minute per token

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Where `asked` came from, for the table: the block, the text before a plan, or the whole description. */
export function askedSourceOf(description, asked) {
  if (!description) return 'empty';
  if (asked === description) return 'whole';
  return /^#{1,3}[ \t]+Implementation Plan\b/im.test(description) && description.startsWith(asked) ? 'before-plan' : 'sealed';
}

// ---------------------------------------------------------------------------------------------------------------
// 1. plan
// ---------------------------------------------------------------------------------------------------------------

async function proxyGet(base, path) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${base}/api/proxy${path}`);
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 10;
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
    return res.json();
  }
  throw new Error(`GET ${path} kept answering 429`);
}

async function plan({ base, urlKey }) {
  const { askedOf } = await import('../../lib/asked-of.js');
  const listed = [];
  let after = null;
  do {
    const page = await proxyGet(base, `/issues?limit=${LIST_PAGE}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    listed.push(...(page.issues || []));
    after = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
    await sleep(PACE_MS);
  } while (after);
  const open = listed.filter((i) => i.identifier && !isTerminalState(i.state?.type) && i.trashed !== true).map((i) => i.identifier).sort(byIdentifier);
  const tickets = {};
  const read = async (ref) => {
    if (tickets[ref] !== undefined) return tickets[ref];
    const issue = await proxyGet(base, `/issues/${encodeURIComponent(ref)}`);
    await sleep(PACE_MS);
    const description = issue.description || '';
    const asked = askedOf(description);
    tickets[ref] = {
      identifier: issue.identifier || ref,
      state: { type: issue.state?.type ?? null, name: issue.state?.name ?? null },
      trashed: issue.trashed === true,
      parent: issue.parent?.identifier || null,
      asked,
      askedSource: askedSourceOf(description, asked),
      descriptionChars: description.length
    };
    return tickets[ref];
  };
  for (const ref of open) {
    let t = await read(ref);
    for (let depth = 0; t?.parent && depth < 10; depth += 1) t = await read(t.parent);
  }
  return { urlKey, generatedAt: new Date().toISOString(), listed: listed.length, open, tickets };
}

function byIdentifier(a, b) {
  const [ka, na] = a.split('-');
  const [kb, nb] = b.split('-');
  return ka === kb ? Number(na) - Number(nb) : ka.localeCompare(kb);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. apply
// ---------------------------------------------------------------------------------------------------------------

/**
 * The plan's tracker view, for the checked writer: a ticket's identifier, its `asked` as the description (the writer is
 * given the identity as askedText, since the plan already holds askedOf's answer), its state and its parent.
 */
export function planTracker(planned) {
  return async (_ctx, ref) => {
    const t = planned.tickets[ref];
    if (!t) return null;
    return { identifier: t.identifier, description: t.asked, state: t.state, trashed: t.trashed, parent: t.parent ? { identifier: t.parent } : null };
  };
}

/**
 * Plan (or, with `write`, make) the task of every open ticket in the plan. Returns one row per open ticket.
 * @param {{recordsStore: object, planned: object, write?: boolean}} args
 */
export async function importTasks({ recordsStore, planned, write = false }) {
  const writes = createRecordWrites({ recordsStore, isTerminalState, readTicket: planTracker(planned), askedText: (d) => d });
  const rows = [];
  for (const ref of planned.open) {
    const t = planned.tickets[ref];
    const held = await recordsStore.taskForTicket(planned.urlKey, ref);
    let action;
    let id = held;
    if (held) {
      action = 'held';
    } else {
      const made = await writes.taskOfTicket({}, planned.urlKey, ref, WRITER, { dryRun: !write });
      if (made?.problem) action = `refused: ${made.problem}`;
      else { action = write ? 'made' : 'make'; id = write ? made.id : null; }
    }
    rows.push({ ticket: ref, state: t?.state?.name ?? '?', parent: t?.parent ?? '', action, source: t?.askedSource ?? '?', asked: t?.asked ?? '', id });
  }
  return rows;
}

const firstLine = (text) => (String(text).split('\n').map((s) => s.trim()).find(Boolean) || '').replace(/\|/g, '\\|');
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** The rows as a Markdown table (the PR carries the dry run's). */
export function tableOf(rows) {
  const lines = ['| ticket | state | parent | action | asked from | asked chars | asked, first line |', '|---|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.ticket} | ${r.state} | ${r.parent || '—'} | ${r.action}${r.id && r.action === 'made' ? ` (${r.id})` : ''} | ${r.source} | ${r.asked.length} | ${clip(firstLine(r.asked), 70)} |`);
  const count = (pred) => rows.filter(pred).length;
  lines.push('', `open tickets: ${rows.length}; held: ${count((r) => r.action === 'held')}; ${rows.some((r) => r.action === 'made') ? 'made' : 'to make'}: ${count((r) => r.action === 'make' || r.action === 'made')}; refused: ${count((r) => r.action.startsWith('refused'))}; asked cut before a plan: ${count((r) => r.source === 'before-plan' && r.action !== 'held')}`);
  return lines.join('\n');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'plan') {
    const base = argOf('--base');
    const urlKey = argOf('--urlkey');
    const out = argOf('--out');
    if (!base || !urlKey || !out) throw new Error('usage: plan --base <proxy base> --urlkey <urlKey> --out <file>');
    const planned = await plan({ base, urlKey });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, `${JSON.stringify(planned, null, 2)}\n`);
    console.log(`listed ${planned.listed} tickets; ${planned.open.length} open; ${Object.keys(planned.tickets).length} read (open and their ancestors) -> ${out}`);
    return;
  }
  if (mode === 'apply') {
    const write = process.argv.includes('--apply');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set: run this inside the service');
    const planned = await readStdin();
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    try {
      const db = client.db(DB_NAME);
      const recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
      const rows = await importTasks({ recordsStore, planned, write });
      console.log(`${write ? 'APPLY' : 'DRY RUN'} ${planned.urlKey}, plan of ${planned.generatedAt}, at ${new Date().toISOString()}\n`);
      console.log(tableOf(rows));
    } finally {
      await client.close();
    }
    return;
  }
  throw new Error('usage: lin-4501-tasks-import.mjs plan|apply …');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // The error's class and message only: a connection string is never printed.
    console.error(`${err?.name || 'Error'}: ${err?.message || err}`);
    process.exit(1);
  });
}
