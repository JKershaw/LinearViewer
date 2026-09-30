#!/usr/bin/env node
/**
 * Post-deploy retention-lifetime operator pass (LIN-3164; phase **C** of the
 * approved LIN-3157 implementation plan v3, §3 "C").
 *
 * NOT a route, NOT autopilot-reachable, NOT auto-executed on boot or anywhere
 * else — this file has no import site in the app. An operator runs it by hand.
 *
 * ORDER: A1 → A2 → B+D → C. C must not run until B+D (LIN-3163) is merged AND
 * deployed; the old instance stamped and evicted, so running earlier was unsafe.
 * B+D is now live (LIN-3163, comment 0ba75575).
 *
 * WHAT IT DOES. After B, no read consults the vestigial expiry stamps, so this
 * pass is hygiene: it removes the stamps that the six evidence stores no longer
 * use (one representation left; it cannot change what is visible) and audits
 * the production indexes so the operator can decide the recommended drops.
 *
 * Usage:
 *   node scripts/retention-lifetime-pass-lin3157.js                       # DRY RUN — reads only, writes nothing
 *   node scripts/retention-lifetime-pass-lin3157.js --execute             # $unset the stamps on the six evidence collections
 *   node scripts/retention-lifetime-pass-lin3157.js --drop-index <collection>:<name>   # drop exactly that one index
 *
 * Same MONGODB_URI / HARBOUR_DATA_DIR convention as server.js.
 *
 * ─── OPERATOR GATING (LIN-3164) ───────────────────────────────────────────
 * - The dry run is mandatory and runs first; its report is posted to LIN-3157.
 * - `--execute` against production requires John's recorded yes: LIN-3164
 *   comment 5d3433ad. A later approval is not retroactive.
 * - `--drop-index` requires its own recorded yes, per named index: LIN-3164
 *   comment 8123aab3 (John delegated the yes to the Flight Companion after it
 *   reads the dry run). Nothing is ever dropped implicitly.
 * - The `email-magic-links` TTL index is NEVER dropped, by anyone.
 *
 * ─── SAFETY INVARIANTS ────────────────────────────────────────────────────
 * - Dry run performs only reads: `countDocuments` for the counts, a
 *   `find({[time]:{$exists:true,$ne:null}}).sort({time:1}).limit(1)` for the
 *   oldest dated row (L9), and `listIndexes`. It never loads a whole collection
 *   into memory (LIN-3164 R5).
 * - `--execute` touches the six evidence collections only — never
 *   `email-magic-links`, `observation-sessions`, or the dispatch queue.
 * - `--drop-index` is resolved and FULLY validated BEFORE any write (LIN-3164
 *   R1/R3): argument shape and allow-list (`parseDropIndexArg`), the name must
 *   exist in this run's `listIndexes`, and the target must be in this run's
 *   allowed drop set. The allowed set is exactly
 *   `indexAudit.dropCandidates ∪ indexAudit.strayTtls`, scoped to the six
 *   evidence collections, minus `_id_`; it never includes `email-magic-links`
 *   or `observation-sessions`. A refused target means NO write of any kind.
 *   Exactly the one named index is dropped and nothing else.
 * - The replacement gate: a vestigial index is listed as a drop candidate only
 *   when the exact key shape of its replacement index is present on the same
 *   collection (order-sensitive). An older/insufficient shape (e.g. A2's
 *   `{urlKey:1,timestamp:-1}` without the `_id`/`_seq` tie-break) is treated as
 *   ABSENT, the candidate is withheld, and the report says so.
 * - Report honesty (LIN-3164 R2): the mode label reflects what actually
 *   happened (`DRY RUN`, `EXECUTE`, `DROP-INDEX`, or both); "nothing was
 *   written" is printed only when nothing was written.
 */

import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { execFileSync } from 'node:child_process';

/**
 * The six evidence collections, with each store's OWN field names (LIN-3164
 * beat-1 grounding): the stamp it used to write (now vestigial, to unset) and
 * the time field the dry run reports the oldest of.
 */
export const EVIDENCE_COLLECTIONS = [
  { collection: 'dispatch-history', stamp: 'historyExpiresAt', time: 'dispatchedAt' },
  { collection: 'prompt-traces', stamp: 'expiresAt', time: 'timestamp' },
  { collection: 'foreman-status', stamp: 'expiresAt', time: 'timestamp' },
  { collection: 'llm-call-log', stamp: 'expiresAt', time: 'timestamp' },
  { collection: 'proxy-events', stamp: 'expiresAt', time: 'timestamp' },
  { collection: 'credential-lifecycle-events', stamp: 'expiresAt', time: 'at' }
];

const EVIDENCE_NAMES = EVIDENCE_COLLECTIONS.map((c) => c.collection);
const EVIDENCE_SET = new Set(EVIDENCE_NAMES);

/**
 * The only collection whose TTL is legitimate (LIN-610's one exception). It is
 * not in the audited set and is never a stray TTL nor a drop target.
 */
export const TTL_ALLOWED_COLLECTION = 'email-magic-links';

/**
 * Audited for stray TTL indexes: the six evidence collections plus
 * `observation-sessions` (a TTL'd derived read-model, C2). `observation-sessions`
 * is audited but its live `{historyExpiresAt}` index is never a drop candidate.
 */
export const AUDITED_COLLECTIONS = [...EVIDENCE_NAMES, 'observation-sessions'];

/**
 * Vestigial index → the exact replacement key shape that must be present before
 * the vestigial one may be recommended for a drop. `dispatch-history` has no
 * timestamp-family replacement (it has no `timestamp` field); its gate is the
 * retained live list index `{urlKey:1,resolvedAt:-1}` (LIN-3164 ruling 2).
 */
export const VESTIGIAL_DROPS = [
  { collection: 'dispatch-history', candidate: { historyExpiresAt: 1 }, replacement: { urlKey: 1, resolvedAt: -1 } },
  { collection: 'prompt-traces', candidate: { urlKey: 1, expiresAt: 1 }, replacement: { urlKey: 1, timestamp: -1, _seq: -1, _id: -1 } },
  { collection: 'foreman-status', candidate: { urlKey: 1, expiresAt: 1 }, replacement: { urlKey: 1, timestamp: -1, _id: -1 } },
  { collection: 'llm-call-log', candidate: { urlKey: 1, expiresAt: 1 }, replacement: { urlKey: 1, timestamp: -1, _id: -1 } },
  { collection: 'llm-call-log', candidate: { urlKey: 1, issueIdentifier: 1, expiresAt: 1 }, replacement: { urlKey: 1, issueIdentifier: 1, timestamp: -1 } },
  { collection: 'proxy-events', candidate: { urlKey: 1, expiresAt: 1 }, replacement: { urlKey: 1, timestamp: -1, _id: -1 } }
];

/**
 * Epoch ms for a timestamp value, or `null` when it cannot be established.
 * Returns `null` (never 0) for an unparseable value so 0 — a real instant —
 * is never silently treated as "oldest".
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
export function epochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Order-sensitive key-shape equality (LIN-3164 ruling 4): "present" means the
 * `key` object matches exactly, field-for-field and in the same order — not
 * name-matching and not a superset. `JSON.stringify` on the key object is the
 * comparison the two engines' auto-names also encode.
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
export function keyShapeEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The replacement gate: may this vestigial index be listed as a drop candidate?
 *
 * @param {Object} args
 * @param {string} args.collection
 * @param {Object} args.candidate - the vestigial index key shape
 * @param {Array<{name: string, key: Object}>} [args.indexes] - the collection's current indexes
 * @returns {{drop: boolean, replacement: Object|null, reason: string}}
 */
export function gateDropCandidate({ collection, candidate, indexes = [] }) {
  const known = VESTIGIAL_DROPS.find((d) => d.collection === collection && keyShapeEquals(d.candidate, candidate));
  if (!known) {
    return { drop: false, replacement: null, reason: 'no-known-replacement: not a declared vestigial index for this collection' };
  }
  const present = (indexes || []).some((idx) => idx && keyShapeEquals(idx.key, known.replacement));
  if (!present) {
    return {
      drop: false,
      replacement: known.replacement,
      reason: `replacement missing: expected exact key shape ${JSON.stringify(known.replacement)} on ${collection}, found only ${JSON.stringify((indexes || []).map((i) => i.key))}`
    };
  }
  return { drop: true, replacement: known.replacement, reason: `replacement present: ${JSON.stringify(known.replacement)}` };
}

/**
 * Pure index audit over the already-read indexes (no I/O). Returns the stray
 * TTLs (outside email-magic-links), the drop candidates (replacement present)
 * and the withheld candidates (replacement missing/wrong shape), each carrying
 * the exact data the report needs.
 *
 * @param {Object<string, Array<{name: string, key: Object, expireAfterSeconds?: number}>>} indexesByCollection
 * @returns {{strayTtls: Array, dropCandidates: Array, withheld: Array}}
 */
export function auditIndexes(indexesByCollection = {}) {
  const strayTtls = [];
  const dropCandidates = [];
  const withheld = [];

  for (const collection of AUDITED_COLLECTIONS) {
    for (const idx of indexesByCollection[collection] || []) {
      if (idx && idx.expireAfterSeconds !== undefined) {
        strayTtls.push({ collection, name: idx.name, keySpec: idx.key, expireAfterSeconds: idx.expireAfterSeconds });
      }
    }
  }

  // Drop candidates are scoped to the six evidence collections only (ruling 3);
  // observation-sessions is audited above but is never a candidate.
  for (const collection of EVIDENCE_NAMES) {
    const indexes = indexesByCollection[collection] || [];
    for (const idx of indexes) {
      if (!idx) continue;
      const isCandidateShape = VESTIGIAL_DROPS.some((d) => d.collection === collection && keyShapeEquals(d.candidate, idx.key));
      if (!isCandidateShape) continue;
      const verdict = gateDropCandidate({ collection, candidate: idx.key, indexes });
      if (verdict.drop) dropCandidates.push({ collection, name: idx.name, keySpec: idx.key });
      else withheld.push({ collection, name: idx.name, keySpec: idx.key, replacement: verdict.replacement, reason: verdict.reason });
    }
  }

  return { strayTtls, dropCandidates, withheld };
}

/**
 * Renders the paste-ready operator report for LIN-3157. Pure.
 *
 * @param {Object} args
 * @param {Array} [args.perCollection]
 * @param {{strayTtls: Array, dropCandidates: Array, withheld: Array}} [args.indexAudit]
 * @param {Date|number} [args.now]
 * @param {string|null} [args.headSha]
 * @param {boolean} [args.execute]
 * @param {string|null} [args.dropIndex]
 * @param {Array} [args.dropped]
 * @returns {string}
 */
export function buildRetentionReport({
  perCollection = [],
  indexAudit = { strayTtls: [], dropCandidates: [], withheld: [] },
  now = new Date(),
  headSha = null,
  execute = false,
  dropIndex = null,
  dropped = [],
  unsets = []
} = {}) {
  const lines = [];
  const modeLabel = execute && dropped.length > 0 ? 'EXECUTE + DROP-INDEX'
    : execute ? 'EXECUTE'
      : dropped.length > 0 ? 'DROP-INDEX'
        : 'DRY RUN';
  lines.push(`# Retention-lifetime pass — ${modeLabel} (LIN-3157 C / LIN-3164)`);
  lines.push('');
  lines.push(`Run at: ${new Date(now).toISOString()}`);
  lines.push(`HEAD: ${headSha || '(unknown — not a git checkout)'}`);
  lines.push('');

  lines.push('## Per-collection counts (each store\'s own stamp / time field)');
  lines.push('');
  lines.push('  ' + 'collection'.padEnd(30) + 'total'.padStart(7) + 'stamped'.padStart(9) + 'past'.padStart(7) + '  oldest');
  for (const entry of perCollection) {
    const oldest = entry.oldest != null ? new Date(entry.oldest).toISOString() : '(none)';
    lines.push(
      '  ' + String(entry.collection).padEnd(30) +
      String(entry.total).padStart(7) +
      String(entry.stamped).padStart(9) +
      String(entry.pastStamp).padStart(7) +
      '  ' + oldest +
      `   [stamp=${entry.stamp}, time=${entry.time}]`
    );
  }
  lines.push('');
  lines.push('  stamped = rows still carrying the vestigial stamp; past = rows whose stamp is already past.');
  lines.push('  For credential-lifecycle-events the oldest is on `at`; for dispatch-history on `dispatchedAt`.');
  lines.push('');

  lines.push('## Stray TTL indexes (`expireAfterSeconds` outside email-magic-links)');
  lines.push('');
  lines.push('  The only legitimate TTL is email-magic-links.expiresAt; it is never a stray and is never dropped.');
  if (indexAudit.strayTtls.length === 0) {
    lines.push('  none — no stray TTL index found on the six evidence collections or observation-sessions.');
  } else {
    for (const s of indexAudit.strayTtls) {
      lines.push(`  ${s.collection}:${s.name}  key=${JSON.stringify(s.keySpec)}  expireAfterSeconds=${s.expireAfterSeconds}`);
    }
  }
  lines.push('');

  lines.push('## Drop candidates (exact replacement index present — safe to recommend)');
  lines.push('');
  if (indexAudit.dropCandidates.length === 0) {
    lines.push('  none.');
  } else {
    for (const c of indexAudit.dropCandidates) {
      lines.push(`  ${c.collection}:${c.name}  key=${JSON.stringify(c.keySpec)}`);
      lines.push(`    node scripts/retention-lifetime-pass-lin3157.js --drop-index ${c.collection}:${c.name}`);
      lines.push('    (requires a recorded yes for THIS index — LIN-3164 comment 8123aab3)');
      lines.push('');
    }
  }

  lines.push('## Withheld (replacement missing or wrong shape — do NOT drop)');
  lines.push('');
  if (indexAudit.withheld.length === 0) {
    lines.push('  none.');
  } else {
    for (const w of indexAudit.withheld) {
      lines.push(`  ${w.collection}:${w.name}  key=${JSON.stringify(w.keySpec)}`);
      lines.push(`    reason: ${w.reason}`);
    }
  }
  lines.push('');

  if (execute) {
    lines.push('## Unset');
    for (const u of unsets) {
      lines.push(`  ${u.collection}: unset ${u.modified} of ${u.matched} matched ${u.stamp ? `(${u.stamp})` : ''}`);
    }
    lines.push('');
  }
  if (dropped.length > 0) {
    lines.push('## Dropped indexes');
    for (const d of dropped) lines.push(`  ${d.collection}:${d.name}`);
    lines.push('');
  }

  if (execute && dropped.length > 0) {
    lines.push('Execute + drop-index — stamps unset on the six evidence collections; the named index was dropped. See the sections above.');
  } else if (execute) {
    lines.push('Execute — stamps unset on the six evidence collections. No index was dropped unless named with --drop-index.');
  } else if (dropped.length > 0) {
    lines.push('Drop-index — the named index was dropped. The stamps were NOT unset (no --execute).');
  } else {
    lines.push('Dry run — nothing was written. Re-run with --execute to unset the stamps (after John\'s recorded yes, LIN-3164 comment 5d3433ad).');
  }

  return lines.join('\n');
}

/**
 * Parse and validate a `--drop-index <collection>:<name>` argument. Fails
 * loudly (throws) on anything malformed or outside the allow-list, so a refusal
 * happens before ANY write.
 *
 * @param {string} value
 * @returns {{collection: string, name: string}}
 */
export function parseDropIndexArg(value) {
  if (typeof value !== 'string' || !value.includes(':')) {
    throw new Error(`refused: --drop-index must be <collection>:<name>, got ${JSON.stringify(value)}`);
  }
  const sep = value.indexOf(':');
  const collection = value.slice(0, sep).trim();
  const name = value.slice(sep + 1).trim();
  if (!collection || !name) {
    throw new Error(`refused: --drop-index must be <collection>:<name>, got ${JSON.stringify(value)}`);
  }
  if (!EVIDENCE_SET.has(collection)) {
    throw new Error(`refused: ${collection} is not one of the six evidence collections; never drop from email-magic-links, observation-sessions or the dispatch queue`);
  }
  if (name === '_id_') {
    throw new Error('refused: cannot drop the _id index');
  }
  return { collection, name };
}

/**
 * Resolve and fully validate a `--drop-index` target against this run's own
 * reads, BEFORE any write (LIN-3164 R1/R3). The allowed set is exactly this
 * run's `indexAudit.dropCandidates ∪ indexAudit.strayTtls`, scoped to the six
 * evidence collections (`parseDropIndexArg` already refused every other
 * collection and `_id_`). A live replacement index, a withheld candidate, or a
 * typo is refused with a message saying why.
 *
 * @param {{collection: string, name: string}} target
 * @param {Object<string, Array<{name: string, key: Object}>>} indexesByCollection
 * @param {{dropCandidates: Array, strayTtls: Array}} indexAudit
 * @returns {{collection: string, name: string}}
 */
export function resolveDropTarget(target, indexesByCollection, indexAudit) {
  const { collection, name } = target;
  const indexes = indexesByCollection[collection] || [];
  const found = indexes.find((idx) => idx && idx.name === name);
  if (!found) {
    throw new Error(`refused: index ${name} not found on ${collection}`);
  }
  const isCandidate = indexAudit.dropCandidates.some((c) => c.collection === collection && c.name === name);
  const isStray = indexAudit.strayTtls.some((s) => s.collection === collection && s.name === name);
  if (!isCandidate && !isStray) {
    throw new Error(
      `refused: ${collection}:${name} is not in this run's allowed drop set ` +
      '(drop candidates or stray TTLs on the six evidence collections); a live replacement index ' +
      'and a withheld candidate must never be dropped'
    );
  }
  return { collection, name };
}

async function readIndexes(db, collection) {
  const cursor = db.collection(collection).listIndexes();
  return cursor && typeof cursor.toArray === 'function' ? cursor.toArray() : cursor;
}

/**
 * Runs the pass. Exported (rather than only invoked from `main`) so tests can
 * drive it directly against a real MangoDB tmpdir without shelling out.
 *
 * @param {Object} params
 * @param {Object} params.db - a connected MongoDB/MangoDB database handle
 * @param {boolean} [params.execute=false] - false (default) writes nothing
 * @param {string|null} [params.dropIndex] - `<collection>:<name>` to drop, or null
 * @param {Date|number} [params.now] - read ONCE and reused
 * @param {string|null} [params.headSha]
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{report: string, perCollection: Array, indexAudit: Object, unsets: Array, dropped: Array, execute: boolean}>}
 */
export async function runRetentionLifetimePass({
  db,
  execute = false,
  dropIndex = null,
  now = new Date(),
  headSha = null,
  log = () => {}
} = {}) {
  const nowMs = epochMs(now) ?? Date.now();
  const nowDate = new Date(nowMs);

  // Validate the explicit drop target BEFORE any read or write.
  const dropTarget = dropIndex != null ? parseDropIndexArg(dropIndex) : null;

  // ── Dry-run reads: per-collection counts (LIN-3164 R5: no whole reads) ───
  const perCollection = [];
  for (const { collection, stamp, time } of EVIDENCE_COLLECTIONS) {
    const coll = db.collection(collection);
    const total = await coll.countDocuments({});
    const stamped = await coll.countDocuments({ [stamp]: { $exists: true } });
    const pastStamp = await coll.countDocuments({ [stamp]: { $lt: nowDate, $exists: true } });
    // L9: filter to dated rows only. A missing/null field sorts first ascending,
    // so an unfiltered top-1 would report `oldest (none)` for a collection that
    // has real dated rows. Bounded (sort + limit 1), read-only.
    const oldestDocs = await coll.find({ [time]: { $exists: true, $ne: null } }).sort({ [time]: 1 }).limit(1).toArray();
    const oldestMs = oldestDocs.length > 0 ? epochMs(oldestDocs[0][time]) : null;
    perCollection.push({
      collection,
      stamp,
      time,
      total,
      stamped,
      pastStamp,
      oldest: oldestMs == null ? null : new Date(oldestMs)
    });
  }

  // ── Read-only index audit (six + observation-sessions) ──────────────────
  const indexesByCollection = {};
  for (const collection of AUDITED_COLLECTIONS) {
    indexesByCollection[collection] = await readIndexes(db, collection);
  }
  const indexAudit = auditIndexes(indexesByCollection);

  // ── Resolve and FULLY validate the drop target BEFORE any write (R1/R3) ──
  const resolvedDropTarget = dropTarget
    ? resolveDropTarget(dropTarget, indexesByCollection, indexAudit)
    : null;

  // ── --execute: unset the vestigial stamp on the six evidence collections ─
  const unsets = [];
  if (execute) {
    for (const { collection, stamp } of EVIDENCE_COLLECTIONS) {
      const result = await db.collection(collection).updateMany(
        { [stamp]: { $exists: true } },
        { $unset: { [stamp]: 1 } }
      );
      unsets.push({ collection, stamp, matched: result.matchedCount, modified: result.modifiedCount });
      log(`[retention-pass] ${collection}: unset ${result.modifiedCount} ${stamp}`);
    }
  }

  // ── Explicit --drop-index only; exactly one named index ─────────────────
  const dropped = [];
  if (resolvedDropTarget) {
    await db.collection(resolvedDropTarget.collection).dropIndex(resolvedDropTarget.name);
    dropped.push({ collection: resolvedDropTarget.collection, name: resolvedDropTarget.name });
    log(`[retention-pass] dropped ${resolvedDropTarget.collection}:${resolvedDropTarget.name}`);
  }

  const report = buildRetentionReport({
    perCollection,
    indexAudit,
    now: nowDate,
    headSha,
    execute,
    dropIndex: dropTarget ? `${dropTarget.collection}:${dropTarget.name}` : null,
    dropped,
    unsets
  });

  return { report, perCollection, indexAudit, unsets, dropped, execute };
}

/**
 * Best-effort HEAD sha for the report. `execFileSync` with an argv array (never
 * a shell string), so nothing here is interpolatable.
 *
 * @returns {string|null}
 */
export function readHeadSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Parse the CLI flags (LIN-3164 R6). A bare `--drop-index` — no value, or a
 * following flag — is refused loudly rather than silently degrading to a dry
 * run. Pure; exported so the seam is inspectable.
 *
 * @param {string[]} args - the flag list (no node/script preamble)
 * @returns {{execute: boolean, dropIndex: string|null}}
 */
export function parseArgv(args = []) {
  const execute = args.includes('--execute');
  const at = args.indexOf('--drop-index');
  let dropIndex = null;
  if (at !== -1) {
    const value = args[at + 1];
    if (value == null || value === '' || value.startsWith('--')) {
      throw new Error('refused: --drop-index requires a <collection>:<name> value');
    }
    dropIndex = value;
  }
  return { execute, dropIndex };
}

async function main() {
  const { execute, dropIndex } = parseArgv(process.argv.slice(2));

  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  const db = dbClient.db('linear-viewer');

  try {
    const { report } = await runRetentionLifetimePass({
      db,
      execute,
      dropIndex,
      headSha: readHeadSha(),
      log: (msg) => console.error(msg)
    });
    console.log(report);
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

// Only run when invoked directly (`node scripts/retention-lifetime-pass-lin3157.js`),
// never on import — this is what keeps the script test-importable with no side
// effect (in particular, importing can never open a connection or write).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[retention-pass] failed:', err);
    process.exitCode = 1;
  });
}
