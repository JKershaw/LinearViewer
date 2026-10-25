/**
 * Codes the next move after each plan-loop stop by rule, from the evidence stop-features.mjs
 * prints (LIN-3932). The rule is applied in this precedence; the first that holds decides:
 *
 *   breakdown      a breakdown session follows the stop, or a carve child (root-task-ratio rule)
 *                  is filed after it
 *   child-filed    a child that is not a carve is filed after the stop (a follow-up, not a breakdown)
 *   cancelled      no build follows and the ticket is Canceled
 *   built          a PR link or an implementation session follows (`built-after-ruling` if a
 *                  Harbour ruling follows too)
 *   stalled        no build and the ticket is still open (Backlog, Todo, In Progress)
 *   closed-unbuilt no build, Done, and no PR link (closed some other way)
 *
 * One move the rule cannot see is hand-coded in HAND below, with its basis: a blocker filed
 * after the stop by a ruling and finished before the build (unwedge-after-ruling).
 *
 * Usage: node code-next-moves.mjs <cache-dir> <census-json> <out-json>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carveChild } from './classify.mjs';

const [cacheDir, censusPath, outPath] = process.argv.slice(2);
const census = JSON.parse(readFileSync(censusPath, 'utf8'));
const byId = new Map();
for (const file of readdirSync(cacheDir).filter(f => /^LIN-\d+\.json$/.test(f))) {
  const rec = JSON.parse(readFileSync(join(cacheDir, file), 'utf8'));
  if (!rec.issue._error) byId.set(rec.issue.identifier, rec);
}
const RULING_MARK = '— Ruling recorded via Harbour';
const PR_LINK_RE = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/;
const after = (t, at) => t && at && t > at;
const OPEN = new Set(['backlog', 'unstarted', 'started', 'triage']);

const codes = [];
for (const row of census.rows.filter(r => r.stop)) {
  const { issue, cost } = byId.get(row.id);
  const at = row.stop.at;
  const sessions = (cost.workerSessions || []).filter(s => after(s.dispatchedAt, at)).map(s => s.kind);
  const childrenAfter = (issue.children || []).filter(c => after(byId.get(c.identifier)?.issue.createdAt, at));
  const carvesAfter = childrenAfter.filter(c => carveChild({ parent: byId.get(c.identifier).issue.parent?.identifier || null, description: byId.get(c.identifier).issue.description }, row.id));
  const rulings = issue.comments.filter(c => after(c.createdAt, at) && (c.body || '').includes(RULING_MARK)).length;
  const pr = issue.comments.filter(c => after(c.createdAt, at) && PR_LINK_RE.test(c.body || '')).length;
  const state = issue.state.type;
  let code;
  if (carvesAfter.length || sessions.includes('breakdown')) code = 'breakdown';
  else if (childrenAfter.length) code = 'child-filed';
  else if (state === 'canceled') code = 'cancelled';
  else if (pr || sessions.includes('implementation')) code = rulings ? 'built-after-ruling' : 'built';
  else if (OPEN.has(state)) code = 'stalled';
  else code = 'closed-unbuilt';
  codes.push({ id: row.id, stopAt: at, era: row.stop.era, kind: row.stop.kind, count: row.stop.count, code, state, rulings, pr, childrenAfter: childrenAfter.length, sessions: sessions.length });
}

// Hand codes: a move the rule cannot see. Each names the comment or ticket it rests on.
const HAND = {
  'LIN-2720': {
    code: 'unwedge-after-ruling',
    basis: 'Plan-loop stop at count 2 (one-cycle, 10 Sep 20:19). Ruling b8244438 "Worth a refactoring in advance" (WIDEN), applied 21:02. LIN-2735 filed 21:01, Done 11 Sep 03:02. Revision 3 planned on the landed seam (06:38), approved 06:54, implemented from PR #230 at 07:13 (simple-dispatcher repo).',
  },
};
for (const c of codes) if (HAND[c.id]) Object.assign(c, { code: HAND[c.id].code, basis: HAND[c.id].basis, ruleCode: c.code });
const out = { rule: 'code-next-moves.mjs', stops: codes.length, codes, hand: HAND };
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
const tally = {};
for (const c of codes) tally[c.code] = (tally[c.code] || 0) + 1;
console.log(JSON.stringify({ stops: codes.length, tally }));
