#!/usr/bin/env node
/**
 * scripts/lin3014/equivalence.mjs (LIN-3014)
 *
 * LIN-1021-style output-equivalence sample: for a sample of `dispatch-history`
 * rows drawn to cover the named classes (abort-harvest, lineage, >=1 legacy
 * row, >=1 just-healed row), build loops/sessions both ways — the lean,
 * digest-backed path and today's non-lean baseline — and `deepStrictEqual`
 * them after stripping the known exemptions (`scripts/lin3014/lib/exemptions.mjs`).
 *
 * READ-ONLY: reuses the app's own `getLoopsForWorkspace`/`getSessionsForWorkspace`
 * (lib/pipeline-loops.js) and `buildSessionCounts` (lib/sessions-view.js) —
 * never a re-implementation of loop/session construction — so this can only
 * ever measure equivalence against what the app actually does, not a model
 * of it that could drift.
 *
 * Refuses to run except against a `read@linear-viewer` connection or a local
 * loopback replay target (scripts/lin3014/lib/guard.mjs). Does not run
 * against production in beat 2 — see LIN-3014 beat 3.
 *
 * Usage:
 *   LIN3014_MONGO_URI=mongodb://... node scripts/lin3014/equivalence.mjs --url-key linearviewer
 *   node scripts/lin3014/equivalence.mjs --url-key linearviewer --local (local replay mongod, no role check)
 */
import { MongoClient } from 'mongodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { getLoopsForWorkspace, getSessionsForWorkspace, __internal as pipelineInternal } from '../../lib/pipeline-loops.js';
import { buildSessionCounts } from '../../lib/sessions-view.js';
import { assertSafeConnection, isLoopbackHost, loadCredential } from './lib/guard.mjs';
import { classifyRow, comparisonKeyFor, compareLoops, compareSessionCounts, compareSessions, hasNonDecreasingTimestamps, selectSample } from './lib/equivalence-core.mjs';

/** listStatus/listItems are unused for archived rows — agent-status only matters for live loops, which this sample doesn't cover (documented bystander, research beat 2 L-G). */
const EMPTY_AGENT_STATUS_STORE = { listStatus: async () => ({ items: [] }) };

function parseArgs(argv) {
  const args = { urlKey: 'linearviewer', local: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--url-key') args.urlKey = argv[++i];
    else if (argv[i] === '--local') args.local = true;
    else if (argv[i] === '--uri') args.uri = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = args.uri || process.env.LIN3014_MONGO_URI;
  if (!uri) {
    console.error('set LIN3014_MONGO_URI (never printed) or pass --uri');
    process.exitCode = 1;
    return;
  }
  const host = new URL(uri.replace('mongodb://', 'http://').replace('mongodb+srv://', 'http://')).hostname;
  const isLocalReplayTarget = args.local && isLoopbackHost(host);
  if (args.local && !isLocalReplayTarget) {
    throw new Error(`--local was passed but ${host} is not a loopback host — refusing (guard.mjs)`);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(); // DB is whatever the URI's path selects — callers set it explicitly (LIN-3001)
    const connectionStatus = await db.command({ connectionStatus: 1 });
    assertSafeConnection(connectionStatus, { isLocalReplayTarget });

    const history = db.collection('dispatch-history');
    const since = new Date(Date.now() - 30 * 24 * 3600e3);
    const rows = await history.find({ urlKey: args.urlKey, dispatchedAt: { $gte: since } }).toArray();

    const { sample, coverage, missing } = selectSample(rows);
    console.log(`sample size ${sample.length}/${rows.length}; coverage ${JSON.stringify(coverage)}`);
    if (missing.length) console.log(`MISSING classes (not measured, not estimated): ${missing.join(', ')}`);

    const lineageRisk = rows.filter((r) => !hasNonDecreasingTimestamps(r.feedback));
    console.log(`lineageLastActivityMs risk rows: ${lineageRisk.length}/${rows.length}`);
    for (const row of lineageRisk) {
      console.log(`  risk row _id=${row._id}: feedback.timestamp is not non-decreasing — needs explicit side-by-side check, not an equality assumption`);
    }

    const liveQueue = db.collection('lin3014-empty-live-queue-scratch'); // never populated: the sample is over archived rows only
    const dispatchStore = new DispatchQueueStore({ collection: liveQueue, historyCollection: history });

    const [leanLoops, baselineLoops] = await Promise.all([
      getLoopsForWorkspace(args.urlKey, { dispatchStore, agentStatusStore: EMPTY_AGENT_STATUS_STORE, lean: true }),
      getLoopsForWorkspace(args.urlKey, { dispatchStore, agentStatusStore: EMPTY_AGENT_STATUS_STORE, lean: false })
    ]);
    const leanById = new Map(leanLoops.map((l) => [l.loopId, l]));
    const baselineById = new Map(baselineLoops.map((l) => [l.loopId, l]));

    let failures = 0;
    for (const row of sample) {
      const classes = classifyRow(row);
      const tag = [
        classes.abortSource && 'abort-harvest',
        classes.lineageMember && 'lineage',
        classes.legacyUnhealed && 'legacy',
        classes.healWritten && 'just-healed'
      ].filter(Boolean).join(',') || 'plain';
      // An abort row is never its own loop (it only harvests onto its
      // TARGET's loop via abortTo) — look the TARGET up for it, or the
      // "ROW DROPPED" check below always fires on agreement, not divergence.
      const compareId = comparisonKeyFor(row);
      const lean = leanById.get(compareId);
      const baseline = baselineById.get(compareId);
      if (!lean || !baseline) {
        console.log(`ROW DROPPED _id=${row._id} [${tag}] (compared as ${compareId}): lean=${!!lean} baseline=${!!baseline}`);
        failures++;
        continue;
      }
      const result = compareLoops(lean, baseline);
      console.log(`_id=${row._id} [${tag}] (compared as ${compareId}) deepStrictEqual(lean minus exemptions, baseline minus exemptions): ${result.equal ? 'PASSED' : 'FAILED'}`);
      if (!result.equal) {
        console.log(`  ${result.message}`);
        failures++;
      }
    }

    // Swipe buildSessionCounts equivalence: same row set, no exemptions.
    const countsResult = compareSessionCounts(buildSessionCounts(leanLoops), buildSessionCounts(baselineLoops));
    console.log(`swipe buildSessionCounts equal: ${countsResult.equal}`);
    if (!countsResult.equal) { console.log(`  ${countsResult.message}`); failures++; }

    // Sessions vs the PRE-DIGEST LEAN baseline (beat 3 correction, `299efc16`
    // step 7 point 3 — NOT the non-lean baseline, and not reproducible by
    // just calling getSessionsForWorkspace twice: today's code has no
    // "lean output, non-digest derivation" branch any more (LIN-3011
    // retired it). Reconstruct it: take the NON-LEAN loops, strip
    // feedback/promptText from each (what the pre-digest lean QUERY
    // projection excluded), then re-run the real `_buildSessions` over
    // those stripped loops so `session.telemetry` is genuinely recomputed
    // from empty feedback, not just patched after assembly.
    const leanSessions = await getSessionsForWorkspace(args.urlKey, { dispatchStore, agentStatusStore: EMPTY_AGENT_STATUS_STORE, lean: true });
    const preDigestLeanLoops = baselineLoops.map((loop) => {
      const { promptText, ...rest } = loop;
      return { ...rest, feedback: [] };
    });
    const preDigestLeanSessions = pipelineInternal._buildSessions(preDigestLeanLoops, { issueGraph: null });
    for (const leanSession of leanSessions) {
      const baselineSession = preDigestLeanSessions.find((s) => s.sessionId === leanSession.sessionId);
      if (!baselineSession) {
        console.log(`session ${leanSession.sessionId}: no pre-digest-lean counterpart found — not compared`);
        continue;
      }
      const result = compareSessions(leanSession, baselineSession);
      console.log(`session ${leanSession.sessionId} vs pre-digest-lean baseline: ${result.equal ? 'PASSED' : 'FAILED'}`);
      if (!result.equal) { console.log(`  ${result.message}`); failures++; }
    }

    console.log(failures === 0 ? 'EQUIVALENCE: all comparisons passed' : `EQUIVALENCE: ${failures} comparison(s) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    await client.close();
  }
}

// loadCredential is exported for CLI callers that build LIN3014_MONGO_URI
// from a stored file rather than an env var — kept here (not inlined) so a
// caller can compose the URI without this module ever logging the password.
export { loadCredential };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
