// LIN-3170: date every process change in what-doubled-the-dispatches.md's timeline by its first first-parent commit on origin/main in LinearViewer or simple-dispatcher.
// Usage: node scripts/survey-doubling-git.mjs [--sd ../simple-dispatcher] [--out data/survey-doubling/timeline.json]
// A ticket's commit is the first first-parent commit since 1 June whose subject reads "LIN-n: …", "LIN-n (…" or a merge "…/lin-n-…";
// an unanchored grep picks up earlier mentions. Two rows need a literal pattern, given here. Also prints the mechanism anchors (-S).
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const repos = { LV: resolve('.'), SD: resolve(arg('--sd', '../simple-dispatcher')) };
const out = arg('--out', 'data/survey-doubling/timeline.json');
const git = (repo, args) => execFileSync('git', ['-C', repos[repo], ...args], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const first = (repo, id, literal) => {
  const pat = literal ? ['-F', `--grep=${literal}`] : ['-i', '-E', `--grep=(^|/)${id}([-:]| \\()`];
  const line = git(repo, ['log', 'origin/main', '--first-parent', '--reverse', '--since=2026-06-01', ...pat, '--format=%h %ad %s', '--date=short']).split('\n')[0];
  return line ? { repo, id, sha: line.split(' ')[0], date: line.split(' ')[1], subject: line.split(' ').slice(2).join(' ').slice(0, 90) } : { repo, id, missing: true };
};
// [row, [[repo, ticket, literal?], …]]
const ROWS = [
  ['follow-ups resume the original session', [['SD', 'LIN-486'], ['LV', 'LIN-415'], ['SD', 'LIN-536']]],
  ['warm hold: a follow-up is SIGNALled into a parked session', [['SD', 'LIN-789'], ['SD', 'LIN-546']]],
  ['close-out split from review; review ledger rules', [['LV', 'LIN-550'], ['LV', 'LIN-804'], ['LV', 'LIN-810']]],
  ['stepper autopilot: beats into one held worker', [['LV', 'LIN-791'], ['LV', 'LIN-797'], ['SD', 'LIN-795']]],
  ['wake follow-ups into a subscribed parent', [['LV', 'LIN-826'], ['LV', 'LIN-843'], ['LV', 'LIN-845'], ['SD', 'LIN-827'], ['SD', 'LIN-842']]],
  ['held-and-woken autopilots; subscribe on by default; single-task children as steppers', [['SD', 'LIN-886'], ['LV', 'LIN-881'], ['LV', 'LIN-885']]],
  ['hold on by default; five outcomes; one stall failsafe', [['SD', 'LIN-906'], ['SD', 'LIN-905'], ['SD', 'LIN-907'], ['SD', 'LIN-910']]],
  ['DONE no longer held; window closes on done', [['SD', 'LIN-1219'], ['SD', 'LIN-1100'], ['LV', 'LIN-1206']]],
  ['AWAITING_EXTERNAL: follow-ups to a PENDING-EXTERNAL session land', [['SD', 'LIN-1260']]],
  ['sessions run at the dispatch tier', [['SD', 'LIN-1285'], ['LV', 'LIN-1282'], ['LV', 'LIN-1278']]],
  ['Stop-hook cap 9 to 1000; silent-EXECUTING re-fire', [['SD', 'LIN-1266'], ['SD', 'LIN-1280']]],
  ['oplog starts; feedback carries rootItemId', [['SD', 'LIN-1291'], ['SD', 'LIN-1289']]],
  ['follow-ups inherit the anchor issue id (log artefact)', [['LV', 'LIN-1292']]],
  ['bootstrap header names the kind', [['SD', 'LIN-1361']]],
  ['a wake per stepper beat, not per edge', [['LV', 'LIN-1357'], ['LV', 'LIN-1343']]],
  ['dispatch presets per kind', [['LV', 'LIN-1390']]],
  ['aborted child wakes its parent', [['SD', 'LIN-1471']]],
  ['plan-review leg; duplicate-dispatch guard; SD CI', [['LV', 'LIN-1602'], ['LV', 'LIN-1603'], ['LV', 'LIN-1656'], ['SD', 'LIN-1580']]],
  ['earlier re-fire for stale async waits', [['SD', 'LIN-1713'], ['SD', 'LIN-1697']]],
  ['bootstrap-free launches for implementation, research, plan', [['SD', 'LIN-2127']]],
  ['PENDING-EXTERNAL re-fire loop bounded', [['SD', 'LIN-2229']]],
  ['review mutation check; close-out follow-up filing', [['LV', 'LIN-2274', 'LIN-2274 + LIN-2303'], ['LV', 'LIN-2309']]],
  ['wakes inherit the issue id (log artefact)', [['LV', 'LIN-2121']]],
  ['passage Planner format; warm resume reachable from recommend-and-dispatch; single-anchor legs as steppers', [['LV', 'LIN-1857'], ['LV', 'LIN-2872']]],
  ['legs skipped for approved-plan children; session cap; close-out authoring limits', [['LV', 'LIN-3049'], ['LV', 'LIN-2934'], ['LV', 'LIN-3033'], ['LV', 'LIN-3056'], ['SD', 'LIN-3043']]],
];
const ANCHORS = [['LV', "kind: 'wake'"], ['LV', 'waitForFollowUps'], ['SD', '[follow-up] item'], ['SD', 'hasLiveSubscribedChild'], ['SD', 'NO_BOOTSTRAP_KINDS'], ['LV', 'anchor?.issueIdentifier']];

const rows = ROWS.map(([what, ids]) => { const hits = ids.map(([r, id, lit]) => first(r, id, lit)); const dates = hits.filter((h) => h.date).map((h) => h.date).sort(); return { what, first: dates[0] || null, hits }; });
const anchors = ANCHORS.map(([r, s]) => { const line = git(r, ['log', 'origin/main', '--first-parent', '--reverse', '--since=2026-06-01', `-S${s}`, '--format=%h %ad', '--date=short']).split('\n')[0]; return { repo: r, string: s, first: line || null }; });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), heads: { LV: git('LV', ['rev-parse', '--short=8', 'origin/main']), SD: git('SD', ['rev-parse', '--short=8', 'origin/main']) }, rows, anchors }, null, 1));
for (const r of rows) console.log(`${r.first}  ${r.what}  ${r.hits.map((h) => `${h.repo} ${h.id} ${h.sha || 'MISSING'}`).join('; ')}`);
for (const a of anchors) console.log(`anchor ${a.repo} ${JSON.stringify(a.string)} → ${a.first}`);
