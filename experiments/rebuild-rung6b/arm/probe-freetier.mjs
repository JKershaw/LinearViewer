// Targeted canary probe of the free-tier count path (the replay generator only emits numeric counts).
const S = process.argv[2];
const sides = { old: `${S}/rung6b/arm/replay91/pinned/old-1f8010a0/kpi-stats.js`, new: `${S}/rung6b/arm/replay91/pinned/new-91fca7dd/kpi-stats.js`, patched: `${S}/rung6b/arm/replay91/pinned/old-patched/kpi-stats.js` };
const NOW = new Date('2026-06-10T12:00:00.000Z');
const mock = (docs = []) => ({ find: () => ({ toArray: async () => docs }), countDocuments: async () => docs.length });
const names = ['sessions','userPreferences','workspacePreferences','customPrompts','localIssues','dispatchQueue','dispatchHistory','dispatchTokens','proxyTokens','proxyEvents','agentStatus','recapCache','briefCache','reportHistory'];
const counts = ['cnry-count-a1', { t: 'cnry-count-b2' }, ['cnry-count-c3'], '7', true, NaN, Infinity, -Infinity, null, undefined, 4, 0, -2, 1.5];
let cases = 0; const leaks = { old: 0, new: 0, patched: 0 }; const nonNumber = { old: 0, new: 0, patched: 0 };
for (let i = 0; i < counts.length; i++) for (let j = 0; j < counts.length; j++) {
  cases++;
  const docs = [{ urlKey: 'cnry-urlkey-x', date: '2026-06-10', count: counts[i] }, { urlKey: 'cnry-urlkey-y', date: '2026-06-10', count: counts[j] }, { urlKey: 'cnry-urlkey-z', date: '2026-06-09', count: counts[i] }];
  for (const [label, file] of Object.entries(sides)) {
    const { collectKpiStats } = await import(file);
    const c = Object.fromEntries(names.map(n => [n, mock()])); c.freeTier = mock(docs);
    const out = await collectKpiStats(c, { now: NOW, milestoneFunnelDeps: {} });
    const json = JSON.stringify(out);
    if (/cnry-/.test(json)) leaks[label]++;
    if (!out.freeTier.counts.every(x => typeof x === 'number' && Number.isFinite(x))) nonNumber[label]++;
  }
}
console.log(JSON.stringify({ cases, inputsWithCanaryInOutput: leaks, inputsWithNonFiniteOrNonNumberCount: nonNumber }));
