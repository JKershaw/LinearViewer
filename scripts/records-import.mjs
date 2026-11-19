#!/usr/bin/env node
/**
 * LIN-4494 (piece 3): the one-off importer. Reads the area notes' `## Waiting` sections from a git ref (or a directory of
 * note copies, for a shallow checkout or a test), and the parked-ticket manifest, and writes them as records through the
 * checked pipeline (lib/records/writes.js).
 *
 *   node scripts/records-import.mjs --urlkey <workspace urlKey> --ref <git ref>           dry run (the default): reports
 *   node scripts/records-import.mjs --urlkey <workspace urlKey> --ref <git ref> --apply   writes
 *   node scripts/records-import.mjs --urlkey <k> --dir <folder of <slug>.md>             the same, from copies
 *   add --no-manifest to import the notes only
 *
 * The ref is an argument, never a default: piece 5 names the production ref (the notes are deleted in piece 4). The
 * database is the server's: MONGODB_URI when set, else the MangoDB data directory (HARBOUR_DATA_DIR or ./data), the same
 * choice server.js makes. Re-running with --apply adds nothing: every record has a fixed id, and an existing one is
 * counted as existing.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../lib/records-store.js';
import { ensureIndexes } from '../lib/db-indexes.js';
import { planImport } from '../lib/records/waiting-import.js';
import { applyWrites, waitingItems, applyManifest } from '../lib/records/import-apply.js';
import { createRecordWrites } from '../lib/records/writes.js';
import { isTerminalState } from '../lib/providers/state-map.js';
import { STAGE_KINDS } from '../lib/prompts/stage-kinds.js';
import { createListWorkspacePeople } from '../lib/workspace-people.js';
import { WorkspaceStore } from '../lib/workspace-store.js';
import { AccountStore } from '../lib/account-store.js';
import { AccountWorkspaceStore } from '../lib/account-workspace-store.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_MANIFEST = join(here, 'records', 'parked-tickets.json');
const DB_NAME = 'linear-viewer';

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

/** The notes from a git ref: every docs/areas/<slug>.md at that ref (README excluded). */
function notesFromRef(ref) {
  const listing = execFileSync('git', ['ls-tree', '--name-only', ref, 'docs/areas/'], { encoding: 'utf8' });
  return listing.split('\n')
    .filter((p) => p.endsWith('.md') && !p.endsWith('/README.md') && basename(p) !== 'README.md')
    .map((p) => ({ note: basename(p, '.md'), markdown: execFileSync('git', ['show', `${ref}:${p}`], { encoding: 'utf8' }) }));
}

/** The notes from a folder of copies named <slug>.md. */
function notesFromDir(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => ({ note: basename(f, '.md'), markdown: readFileSync(join(dir, f), 'utf8') }));
}

function printPlan(plan, report) {
  console.log(`notes: ${plan.totals.notes} (${plan.totals.notesWithWaiting} with a Waiting section)`);
  console.log(`bullets: ${plan.totals.bullets}; entries: ${plan.totals.entries} (findings ${plan.totals.findings}; security ${plan.totals.security} across ${plan.totals.securityNotes} notes); malformed: ${plan.totals.malformed}`);
  for (const n of plan.perNote) {
    console.log(`  ${n.note}: ${n.bullets} bullets, ${n.findings} findings, ${n.security} security${n.malformed.length ? `, MALFORMED ${n.malformed.length}` : ''}`);
    for (const m of n.malformed) console.log(`    malformed (line ${m.line}): ${m.why}: ${m.text.slice(0, 120)}`);
  }
  console.log(`records: ${report.created} created, ${report.existing} already there, ${report.wouldCreate} to create, ${report.refused.length} refused`);
  for (const r of report.refused) console.log(`  refused ${r.id}: ${r.problems.map((p) => p.message).join('; ')}`);
}

async function main() {
  const urlKey = argValue('--urlkey');
  const ref = argValue('--ref');
  const dir = argValue('--dir');
  const apply = process.argv.includes('--apply');
  if (!urlKey || (!ref && !dir) || (ref && dir)) {
    console.error('usage: records-import.mjs --urlkey <urlKey> (--ref <git ref> | --dir <folder>) [--apply] [--manifest <file> | --no-manifest]');
    process.exitCode = 2;
    return;
  }
  const notes = ref ? notesFromRef(ref) : notesFromDir(resolve(dir));
  const plan = planImport(notes, { ref: ref ?? resolve(dir) });

  const backend = process.env.MONGODB_URI ? 'mongodb' : 'mangodb';
  const dbClient = backend === 'mongodb' ? new MongoClient(process.env.MONGODB_URI) : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  try {
    const db = dbClient.db(DB_NAME);
    await ensureIndexes(db);
    const recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    const listPeople = createListWorkspacePeople({
      workspaceStore: new WorkspaceStore({ collection: db.collection('workspaces') }),
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    });
    const writes = createRecordWrites({ recordsStore, isTerminalState, stageKinds: Object.keys(STAGE_KINDS), listPeople });

    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: workspace ${urlKey}; notes from ${ref ? `git ref ${ref}` : dir}`);
    const notesReport = await applyWrites({ writes, recordsStore, urlKey, apply, items: waitingItems(plan, { ref }) });
    console.log('\nWaiting entries');
    printPlan(plan, notesReport);

    if (!process.argv.includes('--no-manifest')) {
      const manifestPath = argValue('--manifest') || DEFAULT_MANIFEST;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const manifestReport = await applyManifest({ writes, recordsStore, urlKey, apply, manifest });
      console.log(`\nParked-ticket manifest (${manifestPath})`);
      console.log(`records: ${manifestReport.created} created, ${manifestReport.existing} already there, ${manifestReport.wouldCreate} to create, ${manifestReport.refused.length} refused`);
      for (const r of manifestReport.refused) console.log(`  refused ${r.id}: ${r.problems.map((p) => p.message).join('; ')}`);
    }
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // The error's class and message only: a connection string is never printed.
    console.error(`[records-import] failed: ${err?.name ?? 'error'}: ${String(err?.message ?? '').slice(0, 300)}`);
    process.exitCode = 1;
  });
}
