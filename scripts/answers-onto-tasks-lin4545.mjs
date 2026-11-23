#!/usr/bin/env node
/**
 * LIN-4545 (LIN-4529 P2c): move the answers already given onto their questions' tasks.
 *
 * Before LIN-4545 the person answer route (lib/question-answers.js) wrote its decision with no `in`, so the task's next stage
 * never read the answer under the brief's "what stands". The route now writes `in` the question's task; this one-off repairs
 * the decisions written before it. Every `decision` with an `answers` link and no `in` gets a new version `in` its question's
 * task, through the same repair the route's retry uses (`placeAnswerOnTask`: the checked pipeline's revise, by Harbour, reason
 * ANSWER_ON_TASK_REASON). v1 is never edited. A decision whose question has no task is skipped and counted; no task is guessed.
 *
 * Idempotent: a repaired decision has an `in`, so a second run selects nothing and repairs 0.
 *
 * NOT a route, no import site in the app. An operator runs it by hand, in production through `railway ssh` into harbour-cat
 * (`railway run` cannot reach the database; never print the environment):
 *   node scripts/answers-onto-tasks-lin4545.mjs             # DRY RUN: writes nothing, lists what it would repair
 *   node scripts/answers-onto-tasks-lin4545.mjs --execute   # writes the new versions, then re-selects (expect 0 remaining)
 *
 * Same MONGODB_URI / HARBOUR_DATA_DIR convention as server.js.
 */
import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { pathToFileURL } from 'node:url';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../lib/records-store.js';
import { createRecordWrites } from '../lib/records/writes.js';
import { isTerminalState } from '../lib/providers/state-map.js';
import { placeAnswerOnTask, answeredQuestionOf } from '../lib/question-answers.js';

/**
 * Every answering decision with no task, per workspace, as current versions. A decision is a candidate when any of its versions
 * is a decision; its current version decides. Reads the decisions only, never a workspace's whole history.
 * @returns {Promise<Map<string, object[]>>} urlKey -> current decisions with an `answers` link and no `in`
 */
export async function selectUnplaced(recordsStore) {
  const docs = await recordsStore.records.find({ kind: 'decision' }, { projection: { urlKey: 1, id: 1 } }).toArray();
  const byWorkspace = new Map();
  for (const d of docs) {
    if (!byWorkspace.has(d.urlKey)) byWorkspace.set(d.urlKey, new Set());
    byWorkspace.get(d.urlKey).add(d.id);
  }
  const out = new Map();
  for (const [urlKey, ids] of [...byWorkspace].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const unplaced = [];
    for (const id of [...ids].sort()) {
      const cur = await recordsStore.current(urlKey, id);
      if (cur?.kind === 'decision' && !cur.in && answeredQuestionOf(cur)) unplaced.push(cur);
    }
    if (unplaced.length) out.set(urlKey, unplaced);
  }
  return out;
}

/**
 * Run the backfill. Dry run by default; `execute` writes, then selects again so the report carries what remains (expected 0,
 * bar the skipped decisions whose question has no task, which no run can place).
 * @returns {Promise<{execute: boolean, repaired: object[], wouldRepair: object[], skipped: object[], failed: object[], remaining: number|null, report: string}>}
 */
export async function runAnswersOntoTasks({ recordsStore, writes, execute = false }) {
  const selected = await selectUnplaced(recordsStore);
  const repaired = [];
  const wouldRepair = [];
  const skipped = [];
  const failed = [];
  for (const [urlKey, decisions] of selected) {
    for (const decision of decisions) {
      const questionId = answeredQuestionOf(decision);
      const question = await recordsStore.current(urlKey, questionId);
      const row = { urlKey, id: decision.id, question: questionId, taskId: question?.in ?? null };
      if (!question?.in) { skipped.push({ ...row, why: 'question-has-no-task' }); continue; }
      if (!execute) { wouldRepair.push(row); continue; }
      const out = await placeAnswerOnTask({ recordsStore, writes, urlKey, decision });
      if (out.repaired) repaired.push(row);
      else if (out.problems) failed.push({ ...row, why: out.problems.map((p) => p.message).join('; ') });
      else skipped.push({ ...row, why: out.skipped });
    }
  }
  let remaining = null;
  if (execute) {
    remaining = 0;
    for (const [urlKey, decisions] of await selectUnplaced(recordsStore)) {
      for (const d of decisions) if ((await recordsStore.current(urlKey, answeredQuestionOf(d)))?.in) remaining += 1;
    }
  }
  return { execute, repaired, wouldRepair, skipped, failed, remaining, report: buildReport({ execute, repaired, wouldRepair, skipped, failed, remaining }) };
}

export function buildReport({ execute, repaired, wouldRepair, skipped, failed, remaining }) {
  const L = [`# Answers onto their questions' tasks: ${execute ? 'EXECUTE' : 'DRY RUN'} (LIN-4545)`, ''];
  const list = (rows, extra = () => '') => rows.forEach((r) => L.push(`  ${r.urlKey} ${r.id} answers ${r.question} -> ${r.taskId ?? '(no task)'}${extra(r)}`));
  if (execute) {
    L.push(`Repaired: ${repaired.length}`);
    list(repaired);
  } else {
    L.push(`Would repair: ${wouldRepair.length}`);
    list(wouldRepair);
  }
  L.push(`Skipped (the question has no task, so none is guessed): ${skipped.length}`);
  list(skipped, (r) => ` (${r.why})`);
  if (failed.length) {
    L.push(`Refused by the checked pipeline: ${failed.length}`);
    list(failed, (r) => ` (${r.why})`);
  }
  if (execute) L.push('', `Remaining after the run: ${remaining}${remaining === 0 ? ' (ok)' : ': NOT 0, investigate'}`);
  else L.push('', 'Dry run: nothing was written. Re-run with --execute to write the new versions.');
  return L.join('\n');
}

async function main() {
  const execute = process.argv.includes('--execute');
  const dbClient = process.env.MONGODB_URI ? new MongoClient(process.env.MONGODB_URI) : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  const db = dbClient.db('linear-viewer');
  try {
    const recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    // The revise names only the question's task (a task id, never a ticket), so no tracker read is needed.
    const writes = createRecordWrites({ recordsStore, isTerminalState });
    const { report, failed } = await runAnswersOntoTasks({ recordsStore, writes, execute });
    console.log(report);
    if (failed.length) process.exitCode = 1;
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => { console.error(err?.stack || err); process.exit(1); });
}
