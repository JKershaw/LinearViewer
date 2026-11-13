/**
 * lib/cost-read-calls.js: the Harbour calls read (LIN-4179), split out of lib/cost-read.js (LIN-4457, piece 7).
 *
 * Every Harbour-call cost figure is read here. `readCalls` is the figure: the priced sum over a set of call-log docs,
 * under the figure rule (`totalUsd` only when every call is priced; a null cost is counted as unpriced, never $0).
 * `appCallsOf` and `callsSurfaceOf` are the two shapes its callers publish: the S1 cost route's `appCalls` and the
 * workspace calls surface (Settings › Health, Ship's Biscuit's Weather line).
 *
 * Pure: no store, clock or network. The functions read the docs they are given, and the caller keys them to one
 * workspace (`listInHorizon(urlKey)`, or `listInHorizon(urlKey, { issueIdentifier })` for one issue). The instance-wide
 * boundary is not here: it is the `urlKey` / `instanceWide` guard on the lineage reads in lib/cost-read.js (LIN-4226).
 *
 * Owned by Runs & dispatch by registry pattern (docs/areas/areas.json), kept beside lib/cost-read.js so the cost
 * reads share one home. Its only import (lib/llm-call-log.js) and most of its consumers sit in other areas, so the
 * placement is by file family, not by dependency.
 */

import { callTelemetryOf } from './llm-call-log.js';

/**
 * The Harbour calls figure (plan "Calls", LIN-4179): the priced sum over a set of call-log docs, with the figure
 * rule's coverage. A null call cost is never added as 0: it is counted in `unpricedCalls`. Pure.
 *
 * @param {Array<{feature?: string, model?: string, cost?: number|null}>} docs  call-log docs, in the order the caller reads them
 * @returns {{calls: number, pricedCalls: number, unpricedCalls: number, pricedUsd: number, totalUsd: number|null,
 *   complete: boolean, models: string[], byFeature: Array<{feature: string, calls: number, pricedCalls: number,
 *   unpricedCalls: number, pricedUsd: number}>}}
 *   `totalUsd` is the sum only when every call is priced (a complete $0 is a real $0); `complete` is false for no
 *   calls too, so `calls === 0` is the "no data" case, distinct from a zero.
 */
export function readCalls(docs = []) {
  const features = new Map();
  const models = new Set();
  let calls = 0;
  let pricedCalls = 0;
  let pricedUsd = 0;
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    calls += 1;
    if (doc.model) models.add(doc.model);
    const feature = doc.feature || 'unknown';
    const acc = features.get(feature) || { feature, calls: 0, pricedCalls: 0, unpricedCalls: 0, pricedUsd: 0 };
    acc.calls += 1;
    if (Number.isFinite(doc.cost)) {
      pricedCalls += 1;
      pricedUsd += doc.cost;
      acc.pricedCalls += 1;
      acc.pricedUsd += doc.cost;
    } else {
      acc.unpricedCalls += 1;
    }
    features.set(feature, acc);
  }
  const unpricedCalls = calls - pricedCalls;
  const complete = calls > 0 && unpricedCalls === 0;
  return {
    calls,
    pricedCalls,
    unpricedCalls,
    pricedUsd,
    totalUsd: complete ? pricedUsd : null,
    complete,
    models: [...models].sort(),
    byFeature: [...features.values()].sort((a, b) => b.calls - a.calls),
  };
}

/**
 * The per-issue app calls the S1 cost route publishes as `appCalls` (its wire shape is pinned by the route test):
 * `{calls, costUsd, unpricedCalls, byFeature: [{feature, calls, costUsd}]}`. `costUsd` is the priced sum.
 *
 * @param {Array<Object>} docs  the issue's calls in the window (`listInHorizon` with `issueIdentifier`)
 */
export function appCallsOf(docs = []) {
  const figure = readCalls(docs);
  return {
    calls: figure.calls,
    costUsd: figure.pricedUsd,
    unpricedCalls: figure.unpricedCalls,
    byFeature: figure.byFeature.map(({ feature, calls, pricedUsd }) => ({ feature, calls, costUsd: pricedUsd })),
  };
}

/**
 * The workspace calls surface Settings › Health and Ship's Biscuit's Weather line read (LIN-418, LIN-4179): the
 * figure (`readCalls`) with the call telemetry that is not cost (`callTelemetryOf`). Both callers say the unpriced
 * count next to the sum; neither reads a null cost as $0.
 *
 * @param {Array<Object>} docs  the workspace's calls in the window
 */
export function callsSurfaceOf(docs = []) {
  const figure = readCalls(docs);
  const telemetry = callTelemetryOf(docs);
  return {
    totalCalls: figure.calls,
    totalTokens: telemetry.totalTokens,
    lastCallAt: telemetry.lastCallAt,
    latencyByFeatureModel: telemetry.latencyByFeatureModel,
    pricedUsd: figure.pricedUsd,
    unpricedCalls: figure.unpricedCalls,
    totalUsd: figure.totalUsd,
    complete: figure.complete,
    byFeature: figure.byFeature,
  };
}
