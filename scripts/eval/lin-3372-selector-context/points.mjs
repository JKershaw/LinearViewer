// The 8 Oct decision points named in LIN-3372, reconstructed from comment and dispatch times.
// gold: the stage(s) the FC then dispatched (and the trail shows was right). seen: what the selector said.
const IP = { name: 'In Progress', type: 'started' };
const TODO = { name: 'Todo', type: 'unstarted' };
const BL = { name: 'Backlog', type: 'backlog' };
const DONE = { name: 'Done', type: 'completed' };
const kids3357 = { 'LIN-3359': TODO, 'LIN-3360': BL, 'LIN-3361': BL, 'LIN-3362': BL, 'LIN-3363': BL };
const kids3358 = { 'LIN-3364': TODO, 'LIN-3365': BL, 'LIN-3366': BL, 'LIN-3367': BL, 'LIN-3368': BL };

export const POINTS = [
  { id: 'P1', issue: 'LIN-3357', at: '2026-10-08T18:43:30Z', states: { 'LIN-3357': IP, ...kids3357 }, gold: ['plan-review'], seen: 'plan', note: 'plan written (18:41) with plan-review due: yes; FC ruling 18:43' },
  { id: 'P2', issue: 'LIN-3357', at: '2026-10-08T18:54:40Z', states: { 'LIN-3357': IP, ...kids3357 }, gold: ['plan-review'], seen: 'plan', note: 'revision 1 posted 18:53, plan run done 18:54' },
  { id: 'P3', issue: 'LIN-3357', at: '2026-10-08T19:07:10Z', states: { 'LIN-3357': IP, ...kids3357 }, gold: ['plan-review'], seen: 'plan', note: 'revision 2 posted 19:06' },
  { id: 'P4', issue: 'LIN-3358', at: '2026-10-08T18:52:00Z', states: { 'LIN-3358': IP, ...kids3358 }, gold: ['plan-review'], seen: 'plan', note: 'plan posted 18:51 (FC ruling not yet)' },
  { id: 'P5', issue: 'LIN-3358', at: '2026-10-08T19:05:00Z', states: { 'LIN-3358': IP, ...kids3358 }, gold: ['plan-review'], seen: 'plan', note: 'revision 1 posted 19:04' },
  { id: 'P6', issue: 'LIN-3358', at: '2026-10-08T19:20:10Z', states: { 'LIN-3358': IP, ...kids3358 }, gold: ['plan-review'], seen: 'plan', note: 'revision 2 posted 19:19' },
  { id: 'P7', issue: 'LIN-3358', at: '2026-10-08T19:26:40Z', states: { 'LIN-3358': IP, ...kids3358 }, gold: ['defer'], deferTo: 'LIN-3364', seen: 'implementation|plan', note: 'FC engineering call 19:26: build slice A (LIN-3364)' },
  { id: 'P8', issue: 'LIN-3354', at: '2026-10-08T18:10:40Z', states: { 'LIN-3354': TODO, 'LIN-3355': TODO, 'LIN-3353': IP }, gold: ['implementation'], seen: 'implementation|plan', note: 'child; plan on parent LIN-3353; spike GO 18:06' },
  { id: 'P9', issue: 'LIN-3355', at: '2026-10-08T19:00:20Z', states: { 'LIN-3355': TODO, 'LIN-3354': DONE, 'LIN-3353': IP }, gold: ['implementation'], seen: 'implementation|plan', note: 'child; plan on parent; handoff 18:58' },
  { id: 'P10', issue: 'LIN-3340', at: '2026-10-08T13:37:00Z', states: { 'LIN-3340': IP }, gold: ['implementation'], seen: 'implementation|plan-review', note: 'plan-review Approve 13:36' },
  { id: 'P10b', issue: 'LIN-3340', at: '2026-10-08T13:38:00Z', states: { 'LIN-3340': IP }, gold: ['implementation'], seen: 'implementation|plan-review', note: 'as P10, implementation dispatched 13:37:39 (running)' },
  { id: 'P10c', issue: 'LIN-3340', at: '2026-10-08T15:00:20Z', states: { 'LIN-3340': IP }, gold: ['close-out'], seen: 'implementation|plan-review', note: 'code-review Approve 14:59' },
  { id: 'P11', issue: 'LIN-3356', at: '2026-10-08T18:43:00Z', states: { 'LIN-3356': IP }, gold: ['close-out'], seen: 'implementation|close-out', note: 'review conditional Approve 18:42' },
  { id: 'P12', issue: 'LIN-3356', at: '2026-10-08T20:16:00Z', states: { 'LIN-3356': IP }, gold: ['close-out'], seen: 'retrospective-audit', note: "John's post-deploy verdict 20:15; task In Progress" },
  { id: 'P12b', issue: 'LIN-3356', at: '2026-10-08T20:17:00Z', states: { 'LIN-3356': IP }, gold: ['close-out'], seen: 'retrospective-audit', note: 'as P12, after the 20:16:45 close-out was dispatched (running)' },
  // Descent hops: what the frontier child says once the parent defers (the FC sees the last hop).
  { id: 'H1', issue: 'LIN-3359', at: '2026-10-08T18:43:30Z', states: {}, gold: ['plan-review@parent'], seen: 'plan', hop: true, note: 'hop under P1' },
  { id: 'H3', issue: 'LIN-3359', at: '2026-10-08T19:07:10Z', states: {}, gold: ['plan-review@parent'], seen: 'plan', hop: true, note: 'hop under P3' },
  { id: 'H4', issue: 'LIN-3364', at: '2026-10-08T18:52:00Z', states: {}, gold: ['plan-review@parent'], seen: 'plan', hop: true, note: 'hop under P4' },
  { id: 'H7', issue: 'LIN-3364', at: '2026-10-08T19:26:40Z', states: {}, gold: ['plan', 'implementation'], seen: 'implementation|plan', hop: true, note: 'hop under P7; FC then pinned plan' }
];
