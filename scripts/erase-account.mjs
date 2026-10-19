#!/usr/bin/env node
/**
 * Operator tool: erase one person's account, by request (LIN-3423).
 *
 * A thin CLI over lib/account-erasure.js. Plan first, then apply the exact plan.
 * Runbook: docs/runbooks/account-erasure.md. The logic, the inventory of what
 * each level does, and every safety rule live in the lib; this file only parses
 * flags, opens the database in `main()` and prints.
 *
 * Usage:
 *   node scripts/erase-account.mjs --email <address> --level standard|full [--map <workspaceId>=<urlKey>]...
 *   ERASE_EMAIL=<address> node scripts/erase-account.mjs --level full      (argv lands in shell history)
 *   node scripts/erase-account.mjs --account-id <id> --level standard
 *   node scripts/erase-account.mjs --find-label <phrase>                    (read-only identity lookup)
 *
 * The default is a DRY RUN. To apply, repeat the command with
 * `--execute --confirm <planId>`; the planId is printed by the dry run and covers
 * the level, the accounts, the counts, the workspace classification and the
 * target database, so a confirm for one database cannot apply to another.
 *
 * Database: MONGODB_URI if set, else the MangoDB data dir HARBOUR_DATA_DIR (or
 * ./data, so check the `target:` line: an empty dir makes a dry run look clean).
 */

import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { resolve } from 'node:path';
import {
  ErasureError,
  planErasure,
  applyErasure,
  findByLabel,
  renderPlan,
  renderReceipt
} from '../lib/account-erasure.js';

const FLAGS_WITH_VALUE = new Set(['--email', '--account-id', '--level', '--map', '--confirm', '--find-label']);
const FLAGS_BOOLEAN = new Set(['--execute']);

/**
 * Parse argv (no node/script preamble). Pure. Refuses rather than guesses: an
 * unknown flag, a flag with no value, two roots, `--execute` without
 * `--confirm`, `--confirm` without `--execute`.
 *
 * @param {string[]} argv
 * @param {Object<string, string>} [env]
 * @returns {{mode: 'plan'|'find-label', email: (string|null), accountId: (string|null), level: (string|null), map: string[], execute: boolean, confirm: (string|null), findLabel: (string|null)}}
 */
export function parseArgs(argv = [], env = {}) {
  const out = { email: null, accountId: null, level: null, map: [], execute: false, confirm: null, findLabel: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (FLAGS_BOOLEAN.has(flag)) { out.execute = true; continue; }
    if (!FLAGS_WITH_VALUE.has(flag)) throw new ErasureError('ARGS_INVALID', { detail: `unknown argument ${flag.startsWith('--') ? flag : '(positional)'}` });
    const value = argv[++i];
    if (value === undefined || value === '' || value.startsWith('--')) throw new ErasureError('ARGS_INVALID', { detail: `${flag} needs a value` });
    if (flag === '--map') out.map.push(value);
    else if (flag === '--email') out.email = value;
    else if (flag === '--account-id') out.accountId = value;
    else if (flag === '--level') out.level = value;
    else if (flag === '--confirm') out.confirm = value;
    else if (flag === '--find-label') out.findLabel = value;
  }

  if (out.findLabel !== null) {
    if (out.email || out.accountId || out.execute || out.confirm || out.level || out.map.length) {
      throw new ErasureError('ARGS_INVALID', { detail: '--find-label is a read-only mode and takes no other flag' });
    }
    return { mode: 'find-label', ...out };
  }

  if (out.email && env.ERASE_EMAIL) throw new ErasureError('ARGS_INVALID', { detail: 'both --email and ERASE_EMAIL are set' });
  if (!out.email && env.ERASE_EMAIL) out.email = env.ERASE_EMAIL;
  if (Boolean(out.email) === Boolean(out.accountId)) {
    throw new ErasureError('ARGS_INVALID', { detail: 'exactly one of --email (or ERASE_EMAIL) and --account-id' });
  }
  if (out.level !== 'standard' && out.level !== 'full') throw new ErasureError('ARGS_INVALID', { detail: '--level standard|full is required' });
  if (out.execute && !out.confirm) throw new ErasureError('ARGS_INVALID', { detail: '--execute needs --confirm <planId> from a dry run' });
  if (out.confirm && !out.execute) throw new ErasureError('ARGS_INVALID', { detail: '--confirm only applies with --execute' });
  return { mode: 'plan', ...out };
}

/**
 * The database the run will touch, for the header and the planId. A Mongo
 * connection string reduces to its hostname: never the credentials, never the
 * database path.
 */
export function describeTarget(env = {}) {
  if (env.MONGODB_URI) {
    try {
      return `mongo ${new URL(env.MONGODB_URI).hostname}`;
    } catch {
      return 'mongo (unparseable URI)';
    }
  }
  return `data dir ${resolve(env.HARBOUR_DATA_DIR || './data')}`;
}

/** What goes to the terminal for a failure: the coded message of an ErasureError, nothing else. */
function describeError(err) {
  if (err instanceof ErasureError) return err.message;
  return `UNEXPECTED_ERROR ${err?.name || 'Error'}${err?.code !== undefined ? ` ${err.code}` : ''}`;
}

/**
 * Drive one run over an injected db. Returns the process exit code.
 *
 * @param {Object} options
 * @param {Object} options.db
 * @param {ReturnType<typeof parseArgs>} options.args
 * @param {string} options.target
 * @param {(line: string) => void} options.out
 * @param {(line: string) => void} options.err
 * @param {Object} [options.apply] - passed to applyErasure (tests: settleMs, onStep)
 */
export async function run({ db, args, target, out, err, apply = {} }) {
  try {
    if (args.mode === 'find-label') {
      const { accountId } = await findByLabel({ db, phrase: args.findLabel });
      out(`account id: ${accountId}`);
      out('Pass it as --account-id. The label token can now be deleted.');
      return 0;
    }
    const root = args.email ? { email: args.email } : { accountId: args.accountId };
    const plan = await planErasure({ db, level: args.level, root, map: args.map, target });
    out(renderPlan(plan, { execute: args.execute }));
    if (!args.execute) {
      out('');
      out(`To apply exactly this plan: repeat the command with --execute --confirm ${plan.planId}`);
      return 0;
    }
    if (args.confirm !== plan.planId) {
      err(`REFUSED: --confirm ${args.confirm} does not match this plan (${plan.planId}). Nothing was changed. Read the dry run again.`);
      return 1;
    }
    const receipt = await applyErasure({ db, plan, ...apply });
    out('');
    out(renderReceipt(receipt));
    return receipt.residual ? 1 : 0;
  } catch (e) {
    err(`REFUSED: ${describeError(e)}`);
    return 1;
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), process.env);
  } catch (e) {
    console.error(`REFUSED: ${describeError(e)}`);
    process.exitCode = 1;
    return;
  }
  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  const db = dbClient.db('linear-viewer');
  try {
    process.exitCode = await run({
      db,
      args,
      target: describeTarget(process.env),
      out: (line) => console.log(line),
      err: (line) => console.error(line)
    });
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

// Only run when invoked directly, never on import: importing opens nothing and writes nothing
// (the same guard as scripts/retention-lifetime-pass-lin3157.js).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`[erase-account] failed: ${describeError(e)}`);
    process.exitCode = 1;
  });
}
