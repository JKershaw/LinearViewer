/**
 * What happened after each plan-loop stop, as facts read from the cache (LIN-3932). The next
 * move is hand-coded from these facts in unwedge-or-breakdown-data/next-moves.json; this script
 * prints the evidence the coding rests on, so a reader can check each code.
 *
 * Usage: node stop-features.mjs <cache-dir> <census-json>
 * Output: one line per stop on stdout, oldest first.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [cacheDir, censusPath] = process.argv.slice(2);
const census = JSON.parse(readFileSync(censusPath, 'utf8'));
const byId = new Map();
for (const file of readdirSync(cacheDir).filter(f => /^LIN-\d+\.json$/.test(f))) {
  const rec = JSON.parse(readFileSync(join(cacheDir, file), 'utf8'));
  if (!rec.issue._error) byId.set(rec.issue.identifier, rec);
}
const RULING_MARK = '— Ruling recorded via Harbour';
const PR_LINK_RE = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/;
const after = (t, at) => t && at && t > at;

for (const row of census.rows.filter(r => r.stop).sort((a, b) => a.stop.at.localeCompare(b.stop.at))) {
  const { issue, cost } = byId.get(row.id);
  const at = row.stop.at;
  // /cost lists sessions newest first; sort ascending so the list reads in time order.
  const sessionsAfter = (cost.workerSessions || [])
    .filter(s => after(s.dispatchedAt, at))
    .sort((a, b) => a.dispatchedAt.localeCompare(b.dispatchedAt))
    .map(s => s.kind);
  const childrenAfter = (issue.children || []).filter(c => after(byId.get(c.identifier)?.issue.createdAt, at)).map(c => c.identifier);
  const blockersAfter = census.candidates.filter(c => c.X === row.id && after(c.Ycreated, at)).map(c => `${c.Y}:${c.class}`);
  const rulingsAfter = issue.comments.filter(c => after(c.createdAt, at) && (c.body || '').includes(RULING_MARK)).length;
  const prAfter = issue.comments.filter(c => after(c.createdAt, at) && PR_LINK_RE.test(c.body || '')).length;
  const verdictsAfter = issue.comments.filter(c => after(c.createdAt, at) && /verdict/i.test((c.body || '').slice(0, 120))).length;
  const sessionKinds = sessionsAfter.slice(0, 5).join(',') || '-';
  console.log([
    row.id, at.slice(0, 16), row.stop.era, row.stop.kind, `n=${row.stop.count}`,
    `state=${issue.state.type}`,
    `sessionsAfter=[${sessionKinds}]`,
    `children+=${childrenAfter.length}`,
    `blockers+=[${blockersAfter.join(' ')}]`,
    `rulings+=${rulingsAfter}`,
    `pr+=${prAfter}`,
    `verdicts+=${verdictsAfter}`,
  ].join(' | '));
}
