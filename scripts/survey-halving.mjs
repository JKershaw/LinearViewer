// LIN-3155: why the weekly count of correct, complete changes halved from June to mid-July — each candidate driver per ISO week and per block, for LinearViewer (Harbour) and simple-dispatcher, printed and written to a git-ignored JSON.
// Usage: node scripts/survey-halving.mjs [--scorecard data/survey/scorecard.json] [--git data/survey-halving/git.json] [--out data/survey-halving/analysis.json]
// Run first: survey-scorecard.mjs's inputs and itself (LIN-3152), node scripts/survey-halving-git.mjs, and
//   node scripts/survey-growth-git.mjs lv . origin/main --json > data/survey-halving/growth-lv.json
//   node scripts/survey-growth-git.mjs sd ../simple-dispatcher origin/main --json > data/survey-halving/growth-sd.json
// Blocks: June is the four full weeks LIN-3152 used (8–29 June); Later is 13 July – 21 September (11 full weeks); the week of
// 6 July is the step and belongs to neither. A change's area is the product area holding most of its production lines, and
// its tier the tier holding most of its commits' trailers. No proxy calls: the tracker list comes from the scorecard's snapshot.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const score = read(arg('--scorecard', 'data/survey/scorecard.json'));
const git = read(arg('--git', 'data/survey-halving/git.json'));
const trackerPath = arg('--tracker', 'data/survey/reliability-tracker.json');
const tracker = existsSync(trackerPath) ? read(trackerPath) : null;
const growth = { lv: read('data/survey-halving/growth-lv.json'), sd: read('data/survey-halving/growth-sd.json') };
const out = arg('--out', 'data/survey-halving/analysis.json');
const githubPath = arg('--github', 'data/survey/reliability-github.json');
const github = existsSync(githubPath) ? read(githubPath) : null;
const stateDir = arg('--state', join(homedir(), 'development', 'simple-dispatcher', 'state'));

const monday = (iso) => { const d = new Date(iso); const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return m.toISOString().slice(0, 10); };
const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round = (x, n = 1) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);

export const JUNE = ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'];
const weeksFrom = (a, b) => { const w = []; for (let d = new Date(a + 'T00:00:00Z'); d <= new Date(b + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7)) w.push(d.toISOString().slice(0, 10)); return w; };
export const LATER = weeksFrom('2026-07-13', '2026-09-21');
const ALL = weeksFrom('2026-06-01', '2026-09-21');
const BLOCKS = { June: JUNE, Later: LATER };

// ---- Per-ticket area and tier, from the commit census ------------------------------------------------------------------
const byTicket = new Map();
for (const r of git.rows) {
  if (!r.ticket) continue;
  const t = byTicket.get(r.ticket) || { area: {}, tiers: {}, commits: 0 };
  for (const [k, v] of Object.entries(r.area)) t.area[k] = (t.area[k] || 0) + v;
  for (const [k, v] of Object.entries(r.tiers)) t.tiers[k] = (t.tiers[k] || 0) + v;
  t.commits++;
  byTicket.set(r.ticket, t);
}
const top = (o, skip = []) => Object.entries(o).filter(([k, v]) => v > 0 && !skip.includes(k)).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
const labels = new Map((tracker?.list || []).map((t) => [t.identifier, t.labels || []]));
export const SIZE = [['none', 0, 0], ['1–49', 1, 49], ['50–299', 50, 299], ['300+', 300, Infinity]];
const sizeOf = (l) => SIZE.find(([, lo, hi]) => l >= lo && l <= hi)[0];

const changes = score.changes.map((c) => {
  const t = byTicket.get(c.id) || { area: {}, tiers: {} };
  const kind = (labels.get(c.id) || []).find((l) => l.startsWith('kind:'))?.slice(5) || 'unlabelled';
  return { ...c, area: c.prodLines ? top(t.area) || 'server' : 'docs/tests only', tier: top(t.tiers, ['none', 'unstated']) || 'unstated', band: sizeOf(c.prodLines), kind };
});

// ---- Weekly series ------------------------------------------------------------------------------------------------------
const rowsByWeek = new Map(score.rows.map((r) => [r.week, r]));
const growthNet = (g) => { const m = new Map(); let prev = null; for (const r of g.rows) { if (prev) m.set(r.week, { prod: (r.prodLines - r.prodCommentLines) - (prev.prodLines - prev.prodCommentLines), test: r.testLines - prev.testLines, readingKB: r.readingBytes / 1024 }); prev = r; } return m; };
const net = { lv: growthNet(growth.lv), sd: growthNet(growth.sd) };
const trackerNums = tracker ? Object.entries(tracker.details).filter(([, d]) => d.createdAt).map(([id, d]) => [+id.slice(4), d.createdAt]).sort((a, b) => a[0] - b[0]) : [];
// Highest ticket number known to exist by a date: tickets are numbered in filing order, so this bounds how many were filed.
const maxFiledBy = (iso) => { let n = 0; for (const [num, at] of trackerNums) if (at < iso && num > n) n = num; for (const c of score.changes) if (c.lastMerge < iso && +c.id.slice(4) > n) n = +c.id.slice(4); return n; };

const weekly = ALL.map((week) => {
  const s = rowsByWeek.get(week) || {};
  const cs = changes.filter((c) => c.week === week);
  const good = cs.filter((c) => c.good);
  const commits = git.rows.filter((r) => monday(r.date) === week);
  const area = {}; for (const r of commits) for (const [k, v] of Object.entries(r.area)) area[k] = (area[k] || 0) + v;
  const next = new Date(week + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 7);
  const days = new Set(commits.map((r) => r.date.slice(0, 10))).size;
  const hours = new Set(commits.map((r) => r.date.slice(0, 13))).size;
  return {
    week, good: good.length, merged: cs.length, goodShare: cs.length ? good.length / cs.length : null,
    goodLV: good.filter((c) => c.repos.includes('LinearViewer')).length, goodSD: good.filter((c) => c.repos.includes('simple-dispatcher')).length,
    notDone: cs.filter((c) => !c.done).length, escaped: cs.filter((c) => c.escapes > 0).length, namedFix: cs.filter((c) => c.namedFix).length, followedUp: cs.filter((c) => !c.complete).length,
    firstParent: commits.length, named: commits.filter((r) => r.ticket).length,
    prodChurn: sum(commits.map((r) => r.prod)), prodChurnNamed: sum(commits.filter((r) => r.ticket).map((r) => r.prod)), testChurn: sum(commits.map((r) => r.test)), docChurn: sum(commits.map((r) => r.doc)), area,
    netProdLV: net.lv.get(week)?.prod ?? null, netProdSD: net.sd.get(week)?.prod ?? null, netTestLV: net.lv.get(week)?.test ?? null, netTestSD: net.sd.get(week)?.test ?? null,
    readingKB: (net.lv.get(week)?.readingKB || 0) + (net.sd.get(week)?.readingKB || 0),
    medProdLinesGood: median(good.map((c) => c.prodLines)), medTestLinesGood: median(good.map((c) => c.testLines)),
    band: Object.fromEntries(SIZE.map(([b]) => [b, good.filter((c) => c.band === b).length])),
    byArea: good.reduce((m, c) => ((m[c.area] = (m[c.area] || 0) + 1), m), {}),
    byTier: good.reduce((m, c) => ((m[c.tier] = (m[c.tier] || 0) + 1), m), {}),
    byKind: good.reduce((m, c) => ((m[c.kind] = (m[c.kind] || 0) + 1), m), {}),
    activeDays: days, activeHours: hours,
    filed: maxFiledBy(next.toISOString()) - maxFiledBy(week + 'T00:00:00Z'),
    medDispatches: s.medDispatches ?? null, fleetDispatches: s.fleetDispatches ?? null, blocked: s.blockedEntries ?? null, processAdd: s.processAdd ?? null,
  };
});
weekly.forEach((w) => { w.netProd = (w.netProdLV ?? 0) + (w.netProdSD ?? 0); w.netTest = (w.netTestLV ?? 0) + (w.netTestSD ?? 0); });

// ---- Blocks -------------------------------------------------------------------------------------------------------------
const perWeek = (ws, f) => sum(ws.map(f)) / ws.length;
const blocks = Object.fromEntries(Object.entries(BLOCKS).map(([name, weeks]) => {
  const ws = weekly.filter((w) => weeks.includes(w.week));
  const cs = changes.filter((c) => weeks.includes(c.week)); const good = cs.filter((c) => c.good);
  const share = (f) => (cs.length ? cs.filter(f).length / cs.length : null);
  const cnt = (key, vals) => Object.fromEntries(vals.map((v) => [v, good.filter((c) => c[key] === v).length / ws.length]));
  const goodShareBy = (key) => Object.fromEntries([...new Set(cs.map((c) => c[key]))].map((v) => { const x = cs.filter((c) => c[key] === v); return [v, { merged: x.length, good: x.filter((c) => c.good).length }]; }));
  return [name, {
    weeks: ws.length, good: perWeek(ws, (w) => w.good), merged: perWeek(ws, (w) => w.merged), goodShare: good.length / cs.length,
    goodLV: perWeek(ws, (w) => w.goodLV), goodSD: perWeek(ws, (w) => w.goodSD),
    notDone: share((c) => !c.done), escaped: share((c) => c.escapes > 0), namedFix: share((c) => c.namedFix), incomplete: share((c) => !c.complete),
    firstParent: perWeek(ws, (w) => w.firstParent), namedShare: sum(ws.map((w) => w.named)) / sum(ws.map((w) => w.firstParent)),
    prodChurn: perWeek(ws, (w) => w.prodChurn), prodChurnNamedShare: sum(ws.map((w) => w.prodChurnNamed)) / sum(ws.map((w) => w.prodChurn)), testChurn: perWeek(ws, (w) => w.testChurn),
    areaChurn: Object.fromEntries(['ui', 'server', 'runner', 'process', 'scripts'].map((a) => [a, perWeek(ws, (w) => w.area[a] || 0)])),
    netProd: perWeek(ws, (w) => w.netProd), netProdLV: perWeek(ws, (w) => w.netProdLV), netProdSD: perWeek(ws, (w) => w.netProdSD), netTest: perWeek(ws, (w) => w.netTest),
    netProdPerGood: perWeek(ws, (w) => w.netProd) / perWeek(ws, (w) => w.good),
    prodChurnPerGood: sum(good.map((c) => c.prodLines)) / good.length, medProdLinesGood: median(good.map((c) => c.prodLines)), medTestLinesGood: median(good.map((c) => c.testLines)),
    testPerProd: sum(good.map((c) => c.testLines)) / sum(good.map((c) => c.prodLines)),
    band: cnt('band', SIZE.map(([b]) => b)),
    area: cnt('area', ['ui', 'server', 'runner', 'process', 'scripts', 'docs/tests only']),
    tier: cnt('tier', ['frontier', 'mid', 'cheap', 'unstated']), tierGoodShare: goodShareBy('tier'),
    kind: cnt('kind', [...new Set(changes.map((c) => c.kind))]),
    activeDays: perWeek(ws, (w) => w.activeDays), activeHours: perWeek(ws, (w) => w.activeHours), goodPerActiveHour: sum(ws.map((w) => w.good)) / sum(ws.map((w) => w.activeHours)),
    filed: perWeek(ws, (w) => w.filed),
    readingKBStart: ws[0].readingKB, readingKBEnd: ws.at(-1).readingKB,
  }];
}));
// PR open-to-merge time and mean open PRs (LIN-3149's GitHub snapshot); June runs to the Monday after its last week.
const blockSpan = { June: [JUNE[0], '2026-07-06'], Later: [LATER[0], '2026-09-28'] };
if (github) for (const [name, [a, z]] of Object.entries(blockSpan)) {
  const S = Date.parse(a + 'T00:00:00Z'), E = Date.parse(z + 'T00:00:00Z');
  blocks[name].prs = Object.fromEntries(Object.entries(github.repos).map(([repo, { prs }]) => {
    const merged = prs.filter((p) => p.mergedAt); const inBlock = merged.filter((p) => Date.parse(p.mergedAt) >= S && Date.parse(p.mergedAt) < E);
    let open = 0; for (const p of merged) { const x = Math.max(Date.parse(p.createdAt), S), y = Math.min(Date.parse(p.mergedAt), E); if (y > x) open += y - x; }
    return [repo, { mergedPerWeek: inBlock.length / ((E - S) / 6048e5), medOpenToMergeH: median(inBlock.map((p) => (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / 36e5)), meanOpenPRs: open / (E - S) }];
  }));
}
// Fresh Harbour sessions the runner's own run logs record before 1 July (the logs begin 20 June and are sparse until 2 July).
const HARBOUR_WS = /^(linearviewer|harbour-cat|simple-dispatcher)$/;
const runLogs = existsSync(stateDir) ? readdirSync(stateDir).filter((f) => /^dispatcher\.run-\d{8}-\d{6}\.log$/.test(f)) : [];
const freshBefore = (day) => { let n = 0; for (const f of runLogs.filter((f) => f.slice(15, 23) < day)) { let ws = null; for (const l of readFileSync(join(stateDir, f), 'utf8').split('\n')) { const m = l.match(/^\s+Workspace: (\S+)/); if (m) ws = m[1]; if (/creating session/.test(l) && HARBOUR_WS.test(ws || '')) n++; } } return n; };
const runnerJune = { logs: runLogs.filter((f) => f.slice(15, 23) < '20260701').length, freshHarbourSessions: freshBefore('20260701') };
// Where the lost changes went: June's weekly count minus Later's, by area, tier and kind.
const lost = Object.fromEntries(['area', 'tier', 'kind'].map((k) => [k, Object.fromEntries(Object.keys({ ...blocks.June[k], ...blocks.Later[k] }).map((v) => [v, (blocks.Later[k][v] || 0) - (blocks.June[k][v] || 0)]))]));
const ratio = Object.fromEntries(Object.keys(blocks.June).filter((k) => typeof blocks.June[k] === 'number').map((k) => [k, round(blocks.Later[k] / blocks.June[k], 2)]));

// ---- Print --------------------------------------------------------------------------------------------------------------
console.log(`heads ${JSON.stringify(git.heads)}; scorecard heads ${JSON.stringify(score.heads)}; June = ${JUNE[0]}..${JUNE.at(-1)}, Later = ${LATER[0]}..${LATER.at(-1)}`);
console.log('week        good merged share | fp  named prodChurn testChurn  netProd netTest | medProd | ui   server runner process scripts | bands none/1-49/50-299/300+ | frontier/mid/unstated | days hours filed | medDisp readingKB');
for (const w of weekly) console.log([w.week, String(w.good).padStart(4), String(w.merged).padStart(5), (w.goodShare ?? 0).toFixed(2), '|', w.firstParent, w.named, w.prodChurn, w.testChurn, w.netProd, w.netTest, '|', w.medProdLinesGood, '|',
  ...['ui', 'server', 'runner', 'process', 'scripts'].map((a) => w.area[a] || 0), '|', SIZE.map(([b]) => w.band[b]).join('/'), '|', ['frontier', 'mid', 'unstated'].map((t) => w.byTier[t] || 0).join('/'), '|', w.activeDays, w.activeHours, w.filed, '|', w.medDispatches ?? '–', Math.round(w.readingKB)].join(' '));
const show = (o) => JSON.stringify(o, (k, v) => (typeof v === 'number' ? round(v, 3) : v), 1);
console.log('\nblocks', show(blocks));
console.log('\nLater ÷ June', show(ratio));
console.log('\nLater minus June, correct changes a week', show(lost));
console.log('\nrunner logs before 1 July', show(runnerJune));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ heads: git.heads, scorecardHeads: score.heads, june: JUNE, later: LATER, weekly, blocks, ratio, lost, runnerJune }, null, 1));
