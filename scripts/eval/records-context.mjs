/**
 * LIN-4518 (finding-004175cc): the records context the dense sweep hands each bundle, read through the production readers.
 *
 * A bundle's review, landing and plan-review loop are records, not comments, so the sweep seeds each target's records
 * (scripts/eval/fixtures/recommend-records/<fixture>.json, authored per target; see that folder's `_about`) into a real
 * records store, then reads the context exactly as the entrance does: trailForTicket (lib/task-standing.js, standingOf then
 * trailOfStanding), landingChangesFor (lib/records/landing.js) and the plan-review run (planReviewRunForTicket, folded by
 * loopFactsOf). A target with `unrepresentable` is handed `null` for its trail: "not read", as a records fault is.
 *
 * The store is a temporary MangoDB (the one the records tests use), removed when the sweep closes it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMangoTmpdir } from '../../tests/fixtures/mango-tmpdir.js';
import { recordsStoreFor, seedTicketRecords } from '../../tests/helpers/records-scenario.js';
import { trailForTicket } from '../../lib/task-standing.js';
import { landingChangesFor } from '../../lib/records/landing.js';
import { loopFactsOf } from '../../lib/recommendation-facts.js';

/** The authored records of one fixture file, keyed by target id; {} when the fixture has none. */
function sidecarOf(recordsDir, fileName) {
  const path = join(recordsDir, fileName);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

/**
 * Seed every target's records and attach `recordsContext` to each bundle: { trail, landingChanges, planReviewLoop }, or
 * { trail: null, ... } for an unrepresentable target. Returns the harness to close, and the counts the summary reports.
 * @param {Array<{file: string, targets: Array<{id: string}>, bundles: Object<string, object>}>} workspaces
 * @param {string} recordsDir
 */
export async function attachRecordsContext(workspaces, recordsDir) {
  const harness = createMangoTmpdir('eval-dense-records-');
  await harness.connect();
  const store = await recordsStoreFor(harness);
  const counts = { bundles: 0, seeded: 0, unrepresentable: 0 };
  for (const ws of workspaces) {
    const sidecar = sidecarOf(recordsDir, ws.file);
    // Every bundle, not only the targets: a descent reaches children that are bundles but not targets.
    for (const id of Object.keys(ws.bundles)) {
      const b = ws.bundles[id];
      if (!b) continue;
      counts.bundles += 1;
      // One store partition per bundle: the scenario helper numbers its runs per call (`run-close-out-1`), so two
      // tickets sharing a partition would collide on run ids.
      const urlKey = `eval:${ws.file}:${id}`;
      const entry = sidecar[id];
      if (entry?.unrepresentable) {
        counts.unrepresentable += 1;
        b.recordsContext = { trail: null, landingChanges: null, planReviewLoop: null, unrepresentable: entry.unrepresentable };
        continue;
      }
      const ticket = b.issue?.identifier || t.id;
      if (entry?.events?.length) {
        await seedTicketRecords(store, urlKey, ticket, entry.events);
        counts.seeded += 1;
      }
      b.recordsContext = {
        trail: await trailForTicket({ recordsStore: store, urlKey, ticket }),
        landingChanges: await landingChangesFor({ urlKey, ticket, recordsStore: store }),
        planReviewLoop: loopFactsOf(await store.planReviewRunForTicket(urlKey, ticket), b.comments || []),
      };
    }
  }
  return { harness, counts };
}
