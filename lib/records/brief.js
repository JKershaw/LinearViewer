/**
 * LIN-4493 (layer design §3.5, parts 1–8): the brief for an actor working on a task. Pure: it reads a views
 * index (lib/records/views.js) and returns the parts, the ids it carries, and the text rendering.
 *
 * The brief is small, deterministic and says what exists; the stage looks up the rest (`get`, `find`).
 * Ended records are left out: a record read after it ends is gone from every part (no cache is involved here).
 * Part 8 (the previous stage) reads the latest ended run in this task by another actor.
 *
 * Wiring the brief behind `GET /api/proxy/brief/:id?run=` is a later piece's (integration §3); this module
 * only composes it.
 */
import { KINDS, splitRef } from './check.js';
import { viewOf, isOpen } from './views.js';
import { currentPieceOf } from './plan-facts.js';

const stageOf = (snap) => snap.fields?.stage || snap.by;
const firstLine = (s) => String(s ?? '').split('\n')[0];
const firstParagraph = (s) => String(s ?? '').split(/\n\s*\n/)[0];
const SAYING_FIELDS = ['says', 'asks', 'answer', 'words', 'reasoning', 'account', 'asked', 'done-when', 'ref', 'head', 'stage'];

function saying(snap) {
  const field = SAYING_FIELDS.map((f) => snap.fields?.[f]).find((x) => x !== undefined);
  return firstLine(field);
}

/**
 * LIN-4530: a question's standing answer, shown with its option and the person's own words together. Each is printed
 * as stored; a continuation line is indented under its label, so a multi-line word stays readable without changing it.
 */
function answeredLines(answered) {
  const block = (label, text) => `    ${label}: ${String(text).replace(/\n/g, '\n      ')}`;
  return [
    `  answered by ${answered.by}`,
    ...(answered.answer !== undefined ? [block('option', answered.answer)] : []),
    ...(answered.words !== undefined ? [block('words', answered.words)] : [])
  ];
}

function recordText(snap, view) {
  const head = `${snap.id} ${snap.kind} [${snap.state}] v${snap.v} by ${snap.by}${snap.via ? ' via ' + snap.via : ''} at ${snap.at}${snap.in ? ' in ' + snap.in : ''}${snap.to ? ' to ' + snap.to : ''}`;
  const lines = [head, ...Object.entries(snap.fields || {}).map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(' | ') : String(v).replace(/\n/g, '\n    ')}`)];
  const links = Object.entries(snap.links || {}).map(([t, v]) => `${t}=${[].concat(v).join(',')}`);
  if (links.length) lines.push(`  links: ${links.join(' ')}`);
  if (view.flags?.answered) lines.push(...answeredLines(view.flags.answered));
  for (const s of view.flags?.stale || []) lines.push(`  STALE: ${s}`);
  if (view.flags?.['under-ended-task']) lines.push(`  under ended task ${view.flags['under-ended-task']}`);
  return lines.join('\n');
}

/**
 * @param {Object} args
 * @param {string} args.actor - the reader: a stage kind, `leftover`, or `person:<accountId>`
 * @param {string} args.taskId - the task record the brief is for
 * @param {string} [args.asOf] - ISO time; the brief as it stood then
 * @param {ReturnType<import('./views.js').index>} args.idx
 * @returns {{problem: string} | {actor, task, asOf, carries: string[], bytes: number, parts: object, text: string}}
 */
export function buildBrief({ actor, taskId, asOf, idx }) {
  const get = (id) => idx.at(id, asOf);
  const task = get(taskId);
  if (!task || task.kind !== 'task') return { problem: `'${taskId}' is not a task${asOf ? ' as of ' + asOf : ''}` };
  const rs = idx.all(asOf);
  const open = rs.filter(isOpen);
  const shown = new Set([taskId]);
  const view = (snap) => viewOf(snap, idx, asOf);
  const full = (snap) => (shown.add(snap.id), view(snap));

  // 1. The task and the person's words: its ref, done-when, and `asked` of the task and each ancestor.
  const chain = [];
  for (let t = task; t && !chain.includes(t); t = t.in ? get(t.in) : null) chain.push(t);
  const part1 = {
    id: taskId,
    ref: task.fields?.ref,
    'done-when': task.fields?.['done-when'],
    asked: chain.filter((t) => t.fields?.asked !== undefined).map((t) => ({ task: t.id, asked: t.fields.asked }))
  };

  // 2. Its plan: the current version of its piece (following a takeover), or every kept plan in it.
  let plans;
  if (task.links?.piece) {
    const p = currentPieceOf(get(task.links.piece), get);
    plans = p ? [p] : [];
  } else {
    plans = rs.filter((r) => r.kind === 'plan' && r.in === taskId && r.state === 'kept')
      .sort((a, b) => (a.fields?.order ?? 0) - (b.fields?.order ?? 0));
  }
  const part2 = plans.map((p) => (p.to === actor ? full(p) : (shown.add(p.id), { id: p.id, first: firstParagraph(p.fields?.says), piece: true })));

  // 3. Addressed to it, in full: open records in this task to this actor; open records anywhere to this task;
  //    open records in this task to a stage whose run here has ended (left behind); open records under a child
  //    task that has ended.
  const runsHere = rs.filter((r) => r.kind === 'run' && r.in === taskId);
  const leftBehind = (s) => runsHere.some((r) => stageOf(r) === s && r.ended) && !runsHere.some((r) => stageOf(r) === s && !r.ended);
  const endedKids = rs.filter((r) => r.kind === 'task' && r.in === taskId && r.ended).map((r) => r.id);
  const part3 = open.filter((r) => (r.in === taskId && r.to === actor)
    || r.to === taskId
    || (r.in === taskId && r.to && leftBehind(r.to))
    || endedKids.includes(r.in) || endedKids.includes(r.to))
    .map(full);

  // 4. What stands about this task: verdicts and decisions in it, or about or on its piece or change, and the
  //    project-wide decisions and those scoped to an ancestor task.
  const chainIds = new Set(chain.map((t) => t.id));
  const targets = new Set([taskId, task.links?.piece, ...plans.map((p) => p.id),
    ...rs.filter((r) => r.in === taskId && (r.kind === 'change' || r.kind === 'plan')).map((r) => r.id)].filter(Boolean));
  const touches = (r) => [...(r.links?.about || []), ...(r.links?.on || [])].some((x) => targets.has(splitRef(x).id));
  const covers = (r) => r.kind === 'decision' && (r.fields?.scope === KINDS.addressees.project || chainIds.has(r.fields?.scope));
  // LIN-4530: a standing decision that answers a question brings that question with it, so the option and the words are
  // read beside what was asked. A question already shown in part 3 is not shown twice.
  const standing = rs.filter((r) => (r.kind === 'verdict' || r.kind === 'decision') && !r.ended && (r.in === taskId || touches(r) || covers(r)));
  const asked4 = new Map(standing.filter((r) => r.kind === 'decision' && r.links?.answers)
    .map((r) => idx.at(r.links.answers, asOf))
    .filter((q) => q && q.kind === 'question' && !shown.has(q.id))
    .map((q) => [q.id, q]));
  const part4 = [...asked4.values()].map(full).concat(standing.map(full));

  // 5. The project: how many open records are addressed to it, and how many lessons hold, with how to look them up.
  const part5 = {
    'open-to-project': open.filter((r) => r.to === KINDS.addressees.project).length,
    'lessons-holding': rs.filter((r) => r.kind === 'lesson' && r.state === 'holds').length,
    lookup: ['find --to project --state open [--text <words>]', 'find --kind lesson --state holds [--text <words>]']
  };

  // 6. Other open runs in the project, other than the actor's own on this task.
  const part6 = open.filter((r) => r.kind === 'run' && !(r.in === taskId && r.by === actor) && !shown.has(r.id))
    .map((r) => (shown.add(r.id), { id: r.id, task: r.in ?? KINDS.addressees.project, stage: stageOf(r) }));
  open.filter((r) => r.kind === 'run' && r.in === taskId && r.by === actor).forEach((r) => shown.add(r.id));

  // 7. An index of what else is known: every other open record in the task, one line each.
  const part7 = open.filter((r) => r.in === taskId && !shown.has(r.id))
    .map((r) => (shown.add(r.id), { id: r.id, kind: r.kind, to: r.to ?? null, first: saying(r) }));

  // 8. The previous stage: the latest ended run in this task by another actor.
  const prev = rs.filter((r) => r.kind === 'run' && r.in === taskId && r.ended && r.by !== actor)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).pop();
  const part8 = prev ? (shown.add(prev.id), { id: prev.id, stage: stageOf(prev), first: firstLine(prev.fields?.account) }) : null;

  const parts = { task: part1, plan: part2, addressed: part3, stands: part4, project: part5, runs: part6, index: part7, previous: part8 };
  const text = render(actor, asOf, taskId, parts);
  return { actor, task: taskId, asOf: asOf ?? null, carries: [...shown], bytes: Buffer.byteLength(text), parts, text };
}

function render(actor, asOf, taskId, p) {
  const sec = (title, items) => [`## ${title}`, ...(items.length ? items : ['(none)'])].join('\n');
  const recLine = (view) => recordText(view, view);
  return [
    `# Brief for ${actor} on ${taskId}${asOf ? ' as of ' + asOf : ''}`,
    sec("1 The task and the person's words", [
      `${taskId}${p.task.ref ? ' ref ' + p.task.ref : ''}${p.task['done-when'] ? '\ndone when: ' + p.task['done-when'] : ''}`,
      ...p.task.asked.map((a) => `asked (${a.task}):\n${a.asked}`)
    ]),
    sec('2 Its plan', p.plan.map((x) => (x.piece ? `${x.id}: ${x.first} (get ${x.id})` : recLine(x)))),
    sec('3 Addressed to it', p.addressed.map(recLine)),
    sec('4 What stands', p.stands.map(recLine)),
    sec('5 The project', [`${p.project['open-to-project']} open addressed to project; ${p.project['lessons-holding']} lessons hold. Look up: ${p.project.lookup.join('; ')}`]),
    sec('6 Other open runs', p.runs.map((r) => `${r.id} ${r.task} ${r.stage}`)),
    sec('7 Index', p.index.map((r) => `${r.id} ${r.kind} to=${r.to ?? '-'} ${r.first}`)),
    sec('8 The previous stage', p.previous ? [`${p.previous.id} ${p.previous.stage}: ${p.previous.first} (get ${p.previous.id})`] : [])
  ].join('\n\n');
}
