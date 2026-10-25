/**
 * Builds the committed census table for unwedge-or-breakdown.md (LIN-3932) from the cache
 * that fetch.py wrote. Read-only: no network.
 *
 * Usage: node census.mjs <cache-dir> <out-json>
 *
 * One compact row per relevant ticket (a ticket with a parent, children, any relation,
 * any plan-review verdict, or any worker session). Every class is derived here from the
 * classifiers in classify.mjs; the table is what analyse.mjs reads.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assemblePlanReviewFacts } from '../../../../lib/recommendation-facts.js';
import { eraOf, replayFirstStop, carveChild, classifyBlocker, breakdownCase } from './classify.mjs';

const [cacheDir, outPath] = process.argv.slice(2);
if (!cacheDir || !outPath) {
  console.error('usage: node census.mjs <cache-dir> <out-json>');
  process.exit(2);
}

const ms = (iso) => Date.parse(iso);
const num = (identifier) => Number(identifier.split('-')[1]);
const RULING_MARK = '— Ruling recorded via Harbour';
const FILED_RE = /\b(filed|opened|created)\b[^\n]{0,80}\bLIN-\d+/i;
const PR_LINK_RE = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/;
const planReviewed = (body) => assemblePlanReviewFacts([{ body, createdAt: '' }]).verdicts > 0;

// 1. Read the cache. Errors (4 tickets "Could not find referenced Issue") are kept, not dropped.
const byId = new Map();
const unresolved = [];
for (const file of readdirSync(cacheDir).filter(f => /^LIN-\d+\.json$/.test(f))) {
  const rec = JSON.parse(readFileSync(join(cacheDir, file), 'utf8'));
  if (rec.issue._error) {
    unresolved.push({ identifier: file.replace('.json', ''), error: rec.issue._error });
    continue;
  }
  byId.set(rec.issue.identifier, { issue: rec.issue, cost: rec.cost || {} });
}

// 2. Per ticket: sessions, dates, verdict replay, breakdown and carve facts.
const facts = new Map();
for (const [identifier, { issue, cost }] of byId) {
  const sessions = (cost.workerSessions || []).map(s => ({ kind: s.kind, at: s.dispatchedAt, model: s.model, costUsd: s.costUsd }));
  const first = (kinds) => {
    const at = sessions.filter(s => kinds.includes(s.kind)).map(s => s.at).sort()[0];
    return at || null;
  };
  const comments = issue.comments.map(c => ({ body: c.body, createdAt: c.createdAt }));
  const verdictFacts = assemblePlanReviewFacts(comments);
  const stop = verdictFacts.verdicts ? replayFirstStop(comments, eraOf) : null;
  const carveChildren = (issue.children || [])
    .map(c => byId.get(c.identifier)?.issue)
    .filter(child => child && carveChild({ parent: child.parent?.identifier || null, description: child.description }, identifier))
    .map(child => child.identifier);
  const windowStart = first(['plan']);
  const windowEnd = first(['implementation', 'breakdown']);
  // Comment-trail fallback, used only where /cost has no session (before LIN-2750 most tickets):
  // a plan is posted (a Plan heading, a plan-review verdict or a plan note); the implementation
  // is under way once a comment says it was implemented and links the PR. Comment times are posting times, so
  // the fallback window is wider than the session window; it is a sensitivity reading.
  const planComment = comments.find(c => /(^|\n)#{1,3}\s*(Implementation )?Plan\b/.test(c.body || '') || planReviewed(c.body) || /plan (posted|revised)/i.test(String(c.body || '').slice(0, 200)));
  const implComment = comments.find(c => /implemented/i.test(String(c.body || '').slice(0, 200)) && PR_LINK_RE.test(c.body || ''));
  facts.set(identifier, {
    issue, cost, sessions, comments, verdictFacts, stop, carveChildren,
    firstPlanAt: windowStart || (planComment?.createdAt ?? null),
    firstImplAt: windowEnd || (implComment?.createdAt ?? null),
    dateSource: windowStart && windowEnd ? 'cost' : (planComment && implComment ? 'comments' : 'none'),
    // Loose reading: the first PR link posted after the plan, whatever the comment says. It can
    // date an implementation from a mention, so it is a bound on the strict reading, not a rival.
    looseImplAt: planComment ? (comments.find(c => PR_LINK_RE.test(c.body || '') && c.createdAt >= planComment.createdAt)?.createdAt ?? null) : null,
  });
}

// 3. Candidate blockers: an inverse `blocks` relation (Y blocks X). Relations carry no timestamp,
// so Y's createdAt, from Y's own record, is the filing date.
const candidates = [];
for (const [identifier, f] of facts) {
  for (const rel of f.issue.inverseRelations || []) {
    if (rel.type !== 'blocks') continue;
    const Y = byId.get(rel.issue.identifier)?.issue;
    const X = {
      identifier,
      parent: f.issue.parent?.identifier || null,
      createdAt: f.issue.createdAt,
      firstPlanAt: f.firstPlanAt,
      firstImplAt: f.firstImplAt,
    };
    const dateSource = f.dateSource;
    const looseX = { ...X, firstImplAt: f.firstImplAt || f.looseImplAt };
    const blocker = Y && {
      identifier: Y.identifier,
      parent: Y.parent?.identifier || null,
      createdAt: Y.createdAt,
      completedAt: Y.completedAt,
      state: Y.state,
    };
    candidates.push({ X: identifier, Y: rel.issue.identifier, class: classifyBlocker(X, blocker), classLoose: f.firstPlanAt && f.dateSource !== 'cost' ? classifyBlocker(looseX, blocker) : classifyBlocker(X, blocker), dateSource, Ycreated: Y?.createdAt || null, Ycompleted: Y?.completedAt || null, Xplan: f.firstPlanAt, Ximpl: f.firstImplAt });
  }
}

// 4. Rows for every relevant ticket.
const rows = [];
for (const [identifier, f] of facts) {
  const { issue, sessions, verdictFacts, stop, carveChildren } = f;
  const relevant = issue.parent || issue.children?.length || issue.relations?.length || issue.inverseRelations?.length || verdictFacts.verdicts || sessions.length;
  if (!relevant) continue;
  const bc = breakdownCase({ identifier, sessions, carveChildren });
  const byKind = {};
  for (const s of sessions) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
  rows.push({
    id: identifier,
    n: num(identifier),
    title: issue.title,
    createdAt: issue.createdAt,
    completedAt: issue.completedAt,
    state: issue.state?.type,
    parent: issue.parent?.identifier || null,
    children: (issue.children || []).map(c => c.identifier),
    carveChildren,
    blockedBy: (issue.inverseRelations || []).filter(r => r.type === 'blocks').map(r => r.issue.identifier),
    blocks: (issue.relations || []).filter(r => r.type === 'blocks').map(r => r.relatedIssue.identifier),
    verdicts: verdictFacts.verdicts,
    byKind: verdictFacts.byKind,
    stop: stop && { at: stop.at, count: stop.count, kind: stop.kind, era: eraOf(stop.at) },
    firstPlanAt: f.firstPlanAt,
    firstImplAt: f.firstImplAt,
    sessionsByKind: byKind,
    sessions: sessions.length,
    pricedUsd: f.cost.pricedUsd ?? null,
    noLineage: f.cost.noLineage ?? null,
    bkB1: bc.b1,
    bkB2: bc.b2,
    filedInWindow: f.comments.filter(c => f.firstPlanAt && f.firstImplAt && c.createdAt >= f.firstPlanAt && c.createdAt < f.firstImplAt && FILED_RE.test(c.body || '')).length,
    rulingsAfterStop: stop ? f.comments.filter(c => c.createdAt > stop.at && (c.body || '').includes(RULING_MARK)).length : 0,
  });
}
rows.sort((a, b) => a.n - b.n);

const table = {
  generatedFrom: cacheDir.split('/').pop(),
  tickets: byId.size,
  unresolved,
  relevantRows: rows.length,
  candidates,
  rows,
};
writeFileSync(outPath, JSON.stringify(table, null, 1) + '\n');
console.log(JSON.stringify({ tickets: byId.size, unresolved: unresolved.length, relevantRows: rows.length, candidates: candidates.length, stops: rows.filter(r => r.stop).length, breakdownB1: rows.filter(r => r.bkB1).length, breakdownB2: rows.filter(r => r.bkB2).length }));
