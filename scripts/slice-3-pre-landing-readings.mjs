#!/usr/bin/env node
/**
 * LIN-4514 (P1 of LIN-4513): the comment readers' last readings over history, before slice 3 retires them.
 *
 * Slice 3 moves verdicts from comments to records. The readers that parse verdicts out of comments go in P7
 * (LIN-4520), and the measures start reading records from a cutover instant in P6 (LIN-4519). Their history is not
 * re-derived later by a parser that is gone (lesson LIN-4505, docs/areas/reports-and-operator-tools.md): it is read
 * once here and committed (docs/reviews/slice-3-readings/).
 *
 * The readings, both over the window from the blind-read gate (GATE_LANDING, LIN-4438's merge) to <head>:
 *   - blind-read results: measure 1 of the Stability Review (scripts/stability-measures-blind.mjs blindRow), the
 *     landings of the window against their tickets' pre-merge `## Blind read`;
 *   - review round trips: lib/plan-review-round-trips.js computePlanReviewRoundTrips, once for plan review
 *     (plan-review -> plan, its own default) and once for code review (review -> implementation, the gate pair the
 *     walk takes), over the tickets of the window's ordinary landings. The issue reads are the script's own
 *     (scripts/plan-review-round-trips.mjs fetchAll): comments, the scoped dispatch list, and plan-review row detail.
 *     Plan facts are not read, so the gate-due series reads not measured, never zero.
 * Reads only. Every proxy call goes through the local workspace proxy; nothing is written anywhere.
 *
 *   node scripts/slice-3-pre-landing-readings.mjs [--head <rev>] [--api <proxy base>] [--out <file>]
 *
 * P7 deletes this script with the readers it calls; the readings it wrote stay.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseLandingLog, parseNumstat, notMeasured } from './stability-measures-core.mjs';
import { createProxyClient, readTrails } from './stability-measures-tracker.mjs';
import { blindRow, ticketsToRead, GATE_LANDING } from './stability-measures-blind.mjs';
import { fetchAll } from './plan-review-round-trips.mjs';
import { computePlanReviewRoundTrips } from '../lib/plan-review-round-trips.js';

const LANDING_FORMAT = '--format=%H%x1f%cI%x1f%s%x1f%b%x1e';
const REPO_SLUG = 'JKershaw/LinearViewer';

const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * The round-trip result, kept to what a reading reports (the walk's per-issue rows stay out). The gate-due series reads
 * plan facts this reading does not take (readPlanFactsThroughProxy is not called), and with none the reader counts every
 * issue past its coverage instant as "measured, not due": a zero from a source that was not read. So it is replaced by
 * `not measured` with that reason (docs/areas/reports-and-operator-tools.md).
 */
function roundTripReading(result) {
  return {
    window: result.window,
    scale: result.scale,
    primary: result.primary,
    roundTrips: result.roundTrips,
    diagnostics: result.diagnostics,
    completeness: result.completeness,
    definition: result.definition,
    gate: notMeasured('gate', 'plan facts were not read by this reading, so the gate-due series is not measured (the reader alone would count those issues as not due)'),
  };
}

async function main() {
  const headRev = arg('--head', 'origin/main');
  const head = git(['rev-parse', headRev]).trim();
  const base = GATE_LANDING.commit;
  const api = arg('--api', process.env.HARBOUR_LOCAL_BASE ? `${process.env.HARBOUR_LOCAL_BASE}/api/proxy` : null);
  if (!api) throw new Error('slice-3-pre-landing-readings: --api <proxy base> (or HARBOUR_LOCAL_BASE) is required');
  const asOf = new Date().toISOString();

  const landings = parseLandingLog(git(['log', '--first-parent', LANDING_FORMAT, `${base}..${head}`]));
  const numstat = parseNumstat(git(['log', '--first-parent', '--diff-merges=first-parent', '--numstat', '--no-renames', '--format=@%H', `${base}..${head}`]));
  const tickets = ticketsToRead({ landings, numstat });

  const client = createProxyClient({ base: api });
  const { trails } = await readTrails({ client, tickets });
  const blind = blindRow({ landings, numstat, trails, repo: REPO_SLUG });

  // The round-trip reader's own issue reads (a placeholder bearer: the local proxy supplies the credential).
  const listRows = tickets.map((id) => ({ id, identifier: id }));
  const { issues, skipped, calls } = await fetchAll(listRows, { base: api, token: 'local-proxy', noCache: true, cache: join(tmpdir(), 'lin-4514-readings-unused-cache') });
  const planReview = computePlanReviewRoundTrips(issues, { asOf, skipped });
  const codeReview = computePlanReviewRoundTrips(issues, { asOf, skipped, gateKind: 'review', rePassKind: 'implementation' });

  const out = {
    _about: 'LIN-4514: the comment readers\' last readings over history (scripts/slice-3-pre-landing-readings.mjs). Never edit by hand.',
    window: { from: { commit: base, mergedAt: GATE_LANDING.mergedAt, why: 'the blind-read gate (LIN-4438, GATE_LANDING)' }, to: { commit: head }, asOf, landings: landings.length, tickets: tickets.length },
    blindReadResults: blind,
    reviewRoundTrips: { planReview: roundTripReading(planReview), codeReview: roundTripReading(codeReview) },
    meta: { proxyCalls: { trails: client.stats.calls, roundTrips: calls }, issuesRead: issues.length, skipped: skipped.length },
  };
  const json = `${JSON.stringify(out, null, 2)}\n`;
  const file = arg('--out');
  if (file) writeFileSync(file, json); else process.stdout.write(json);
}

main().catch((err) => { console.error(err?.message || err); process.exitCode = 1; });
