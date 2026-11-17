// What each stage of LIN-4450 could read on the tracker at its start: a lower bound.
// LIN-4450's description is the post-close-out text (the pre-prune one is not readable),
// plus LIN-4450's comments so far, plus LIN-4445's description and comments so far
// (LIN-4450's ask points into the parent). Characters only.
import { readFileSync } from 'node:fs';
const m = (f) => JSON.parse(readFileSync(new URL(`../material/${f}`, import.meta.url)));
const child = m('LIN-4450.json'), parent = m('LIN-4445.json'), cost = m('LIN-4450-cost.json');
const before = (cs, t) => cs.filter((c) => c.createdAt < t);
const len = (cs) => cs.reduce((n, c) => n + c.body.length, 0);
const stages = cost.workerSessions.map((s) => ({ stage: s.kind, at: s.dispatchedAt })).sort((a, b) => a.at.localeCompare(b.at));
const rows = stages.map(({ stage, at }) => {
  const cc = before(child.comments, at), pc = before(parent.comments, at);
  const chars = child.description.length + len(cc) + parent.description.length + len(pc);
  return { stage, at, childComments: cc.length, parentComments: pc.length, chars };
});
console.log(JSON.stringify(rows, null, 1));
