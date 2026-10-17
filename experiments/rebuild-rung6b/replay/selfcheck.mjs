#!/usr/bin/env node
// Self-checks for the kpi-stats replay (see ../../replay-kit/lib/selfcheck-cli.mjs).
//   node selfcheck.mjs [--n 3000] [--mutant-n 1500] [--seeds 1,2] [--only M1] [--no-test-tier]
import { runSelfcheck } from '../../replay-kit/lib/selfcheck-cli.mjs';
import { cfg } from './replay.mjs';

const mutants = [
  { id: 'M1-leak', name: 'M1 leaks a workspace key into totals (privacy)', expect: 'finding', kind: 'privacy-leak',
    pairs: [['      workspaces: workspaceKeys.size,', '      workspaces: workspaceKeys.size,\n      sampleWorkspace: [...workspaceKeys][0] ?? null,']] },
  { id: 'M2-window', name: 'M2 activity window rolling now-30d instead of midnight-anchored', expect: 'detect', kind: 'return',
    pairs: [['const activityWindowStart = new Date(`${activityDays[0]}T00:00:00.000Z`).getTime();', 'const activityWindowStart = now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS;']] },
  { id: 'M3-hasown', name: 'M3 stepOutcomes uses `in` (prototype keys pollute the buckets)', expect: 'detect', kind: 'return',
    pairs: [["if (status !== 'other' && Object.hasOwn(stepOutcomes, status)) stepOutcomes[status]++;", "if (status !== 'other' && status in stepOutcomes) stepOutcomes[status]++;"]] },
  { id: 'M4-status', name: 'M4 proxy status 100 no longer ok (>= → >)', expect: 'detect', kind: 'return',
    pairs: [["    else if (status >= 100) bucket = 'ok';", "    else if (status > 100) bucket = 'ok';"]] },
  { id: 'M5-since', name: 'M5 dispatch-history aggregation drops the read-horizon $match', expect: 'detect', kind: 'storeCalls',
    pairs: [['        ...(since ? [{ $match: { dispatchedAt: { $gte: since } } }] : []),', '']] },
  { id: 'M6-swallow', name: 'M6 proxy-events aggregation failure swallowed (resolves [])', expect: 'detect', kind: 'outcome',
    pairs: [["      console.error('kpi-stats: proxy-events aggregation failed:', err?.message || err);\n      throw err;", "      console.error('kpi-stats: proxy-events aggregation failed:', err?.message || err);\n      return [];"]] },
  { id: 'M7-mutate', name: 'M7 stamps the agent-status docs the store returned', expect: 'detect', kind: 'store-result-mutation',
    pairs: [['    if (!doc.dispatchId) continue;', '    doc.joined = true;\n    if (!doc.dispatchId) continue;']] },
  { id: 'M8-ties', name: 'M8 top-list ties break reverse-alphabetically', expect: 'detect', kind: 'return',
    pairs: [['    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))\n    .slice(0, limit)', '    .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))\n    .slice(0, limit)']] },
  { id: 'I1-keyorder', name: 'I1 key order only (must be info, not a difference)', expect: 'info', infoKind: 'key-order',
    pairs: [['      users: usersCount,\n      activeSessions,', '      activeSessions,\n      users: usersCount,']] },
];

runSelfcheck(cfg, mutants);
