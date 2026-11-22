#!/usr/bin/env node
/**
 * LIN-4519 (P6 of LIN-4513): the review round trips over the cutover window, read from verdict records.
 *
 * The full-workspace read (scripts/plan-review-round-trips.mjs --verdicts records) crawls every issue and was cut off at
 * 1,325 of 4,467 (finding-b3b544a9). The reading the slice needs is narrower: the tickets of the ordinary landings from the
 * cutover (VERDICT_RECORDS_SINCE, lib/records/verdict-facts.js) to the head, read through the workspace proxy, and run
 * through computePlanReviewRoundTrips once for plan review (plan-review -> plan) and once for code review (review ->
 * implementation). Their verdicts come from records, `on` the version each judge read.
 *
 * Plan facts are not read, so the gate-due series is reported not measured, never zero: the reader alone would count the
 * issues outside the window as not due (the reason the Slice 3 readings in docs/reviews/slice-3-readings/README.md give).
 *
 * Reads only. Every proxy call goes through the workspace proxy; nothing is written anywhere.
 *
 *   node scripts/lin-4519-window-readings.mjs [--head <rev>] [--api <proxy base>] [--out <file>]
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseLandingLog, parseNumstat, notMeasured } from './stability-measures-core.mjs';
import { ticketsToRead, GATE_LANDING } from './stability-measures-blind.mjs';
import { fetchAll, getJson } from './plan-review-round-trips.mjs';
import { readVerdictFactsThroughProxy } from './verdict-facts-proxy.mjs';
import { computePlanReviewRoundTrips } from '../lib/plan-review-round-trips.js';
import { VERDICT_RECORDS_SINCE } from '../lib/records/verdict-facts.js';

const LANDING_FORMAT = '--format=%H%x1f%cI%x1f%s%x1f%b%x1e';
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** The round-trip result kept to what a reading reports; the gate series is not measured (see the header). */
function roundTripReading(result) {
  return {
    window: result.window,
    scale: result.scale,
    primary: result.primary,
    roundTrips: result.roundTrips,
    diagnostics: result.diagnostics,
    completeness: result.completeness,
    definition: result.definition,
    gate: notMeasured('gate', 'plan facts were not read by this reading, so the gate-due series is not measured (the reader alone would count the issues outside the window as not due)'),
  };
}

async function main() {
  const headRev = arg('--head', 'origin/main');
  const head = git(['rev-parse', headRev]).trim();
  const base = GATE_LANDING.commit;
  const api = arg('--api', process.env.HARBOUR_LOCAL_BASE ? `${process.env.HARBOUR_LOCAL_BASE}/api/proxy` : null);
  if (!api) throw new Error('lin-4519-window-readings: --api <proxy base> (or HARBOUR_LOCAL_BASE) is required');
  const asOf = new Date().toISOString();

  // The window: first-parent landings from the blind-read gate to the head; the tickets are those the cutover covers.
  const landings = parseLandingLog(git(['log', '--first-parent', LANDING_FORMAT, `${base}..${head}`]));
  const numstat = parseNumstat(git(['log', '--first-parent', '--diff-merges=first-parent', '--numstat', '--no-renames', '--format=@%H', `${base}..${head}`]));
  const tickets = ticketsToRead({ landings, numstat, since: VERDICT_RECORDS_SINCE });
  const inWindow = landings.filter((l) => Date.parse(l.date) >= Date.parse(VERDICT_RECORDS_SINCE));

  // Only the window's tickets are read: the issue reads are the round-trip reader's own (fetchAll), with a placeholder
  // bearer (the local proxy supplies the credential). Verdicts come from records.
  const listRows = tickets.map((id) => ({ id, identifier: id }));
  const { issues, skipped, calls } = await fetchAll(listRows, { base: api, token: 'local-proxy', noCache: true, cache: join(tmpdir(), 'lin-4519-window-readings-unused-cache') });
  const { facts: verdictFacts, reads } = await readVerdictFactsThroughProxy({ base: api, token: 'local-proxy', getJson, tickets });
  const planReview = computePlanReviewRoundTrips(issues, { asOf, skipped, verdictFacts, verdictSource: 'records' });
  const codeReview = computePlanReviewRoundTrips(issues, { asOf, skipped, verdictFacts, verdictSource: 'records', gateKind: 'review', rePassKind: 'implementation' });

  const out = {
    _about: 'LIN-4519: review round trips over the cutover window, read from verdict records (scripts/lin-4519-window-readings.mjs). Never edit by hand.',
    window: {
      cutover: VERDICT_RECORDS_SINCE,
      from: { commit: base, mergedAt: GATE_LANDING.mergedAt, why: 'the blind-read gate (LIN-4438, GATE_LANDING); the tickets read are those the cutover covers' },
      to: { commit: head }, asOf,
      landings: landings.length, landingsAtOrAfterCutover: inWindow.length, tickets: tickets.length,
    },
    reviewRoundTrips: { planReview: roundTripReading(planReview), codeReview: roundTripReading(codeReview) },
    meta: { proxyCalls: { roundTrips: calls, verdictRecordReads: reads }, issuesRead: issues.length, skipped: skipped.length },
  };
  const json = `${JSON.stringify(out, null, 2)}\n`;
  const file = arg('--out');
  if (file) writeFileSync(file, json); else process.stdout.write(json);
}

main().catch((err) => { console.error(err?.message || err); process.exitCode = 1; });
