#!/usr/bin/env node
/**
 * LIN-4504 (slice 2, P4): the cutover of in-flight plans from ticket text to plan records. BRANCH-ONLY: this script and
 * its tests are deleted in the PR's last commit, after the apply (no reader of plan text may survive on main).
 *
 * It reproduces today's readers exactly, because it is the last of them: it does not copy them. Every old fact is read by
 * the DEPLOYED commit's own code, imported from a worktree of that commit (`--legacy <dir>`, plan-review note 4), so the
 * capture and the import read plan text the way production read it until the cutover.
 *
 * Four steps (the plan's cutover order: pause, capture, dry run, apply, compare):
 *
 *   1. capture (read-only, through the workspace proxy, with the fleet paused): every open ticket's text and the old
 *      readers' facts: assembleTrailFacts(...).plan (where, parent, sessionFit, planReviewDue), the node's
 *      frontierFacts.sessionFit, the latest plan-review verdict, and look-first's "has a plan" (plan.where), plus the
 *      records already in the store (tasks, plans, plan-review findings).
 *        node scripts/records/slice-2-import.mjs capture --base "$HARBOUR_LOCAL_BASE" --legacy <worktree> --out capture.json
 *   2. plan (pure, anywhere): the records the import would write, and the held list, from the capture.
 *        node scripts/records/slice-2-import.mjs plan --capture capture.json --out plan.json
 *   3. apply (inside the production service, where the database is: `railway ssh` into the app service, a tarball in
 *      /dev/shm, reports Lesson LIN-4505): a dry run prints the table and writes nothing; --apply writes through the
 *      checked writer, `by: import`, `via: import` (no summaries, no tickets: lib/records/writes.js), with fixedIdOf ids
 *      so a re-apply makes nothing twice.
 *        node scripts/records/slice-2-import.mjs apply < plan.json
 *        node scripts/records/slice-2-import.mjs apply --apply < plan.json
 *   4. compare (pure): the captured old facts against the new facts folded from records (planFactsFromRecords), each
 *      difference classified against the closed list of explained differences; anything else is UNEXPLAINED and keeps
 *      the fleet paused. Before the apply it compares against the planned records (the dry run); after it, against the
 *      records read back through the proxy.
 *        node scripts/records/slice-2-import.mjs compare --capture capture.json --plan plan.json [--after after.json]
 *
 * What the import writes, per open ticket (the plan's Cutover section):
 *   - a description plan or a comment plan, found by the old order of precedence, becomes a plan record `via: import`
 *     in the ticket's task, addressed by its session-fit line (several sessions → breakdown, one → implementation);
 *   - a plan whose review-due line says yes, with no Approve as the latest verdict, gets an open finding `to:
 *     plan-review` about it; a plan whose latest verdict is Approve gets the same finding already ended (done), naming the
 *     verdict comment;
 *   - a breakdown child's copied slice becomes a child-local plan `to: implementation`, saying it cannot be mapped to a
 *     parent piece;
 *   - held, with no record and no fallback reader: an unreadable plan (no readable session fit), a leaf planned only
 *     through its parent (note A, finding-f8a27c72: a piece to the parent's whole plan would route it to breakdown), a
 *     ticket whose task already holds plan records;
 *   - a ticket with a plan and no task gets its task through the checked writer first (askedOf), as the P1 import did
 *     (plan-review note 5: this importer makes the task rather than hold the plan).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { fixedIdOf } from '../../lib/records/refs.js';
import { planFactsFromRecords } from '../../lib/records/plan-facts.js';

const DB_NAME = 'linear-viewer';
const WRITER = 'import';
const LIST_PAGE = 250;
const PACE_MS = 1100; // the proxy allows 60 requests a minute per token

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The old session-fit answers, mapped to a plan's addressee. */
export const ADDRESSEE_OF_FIT = Object.freeze({ 'needs multiple sessions': 'breakdown', 'fits one session': 'implementation' });

/** The copied slice's mark in a breakdown child: its review-due line says no, covered by the parent's review. */
const COPIED_SLICE = /plan-review due:?\**\s*no\b[^\n]{0,40}covered by/i;

/** The deterministic ids (fixedIdOf, the one derived-id rule): a re-apply finds what it made. */
export const importIdsOf = (ticket) => ({
  plan: fixedIdOf('plan', 'slice-2-import', ticket),
  finding: fixedIdOf('finding', 'slice-2-import', ticket, 'plan-review'),
});

// ---------------------------------------------------------------------------------------------------------------
// The deployed readers (a worktree of the deployed commit), behind one small interface the planner takes.
// ---------------------------------------------------------------------------------------------------------------

/**
 * The old readers from a worktree of the deployed commit. Each returns what production computed until the cutover.
 * @param {string} dir - the worktree root
 */
export async function legacyReadersFrom(dir) {
  const at = (p) => pathToFileURL(resolve(dir, p)).href;
  const facts = await import(at('lib/recommendation-facts.js'));
  const asked = await import(at('lib/asked-of.js'));
  const pointer = await import(at('lib/file-pointer.js'));
  return {
    /** assembleTrailFacts(...).plan for a leaf, with its parent's description for the parent-plan read. */
    trailPlan: (comments, description, parent) => facts.assembleTrailFacts(comments, description, {
      leaf: true, parentPlan: parent?.description ? { identifier: parent.identifier, description: parent.description } : null,
    }).plan,
    /** The node's frontierFacts.sessionFit (null without children). */
    nodeSessionFit: (issue, children) => facts.assembleNodeFacts(issue, children).frontierFacts?.sessionFit ?? null,
    /** The latest plan-review verdict and when. */
    latestVerdict: (comments) => {
      const f = facts.assemblePlanReviewFacts(comments);
      return { verdict: f.latestVerdict, at: f.latestAt };
    },
    /** The plan section of a description as the old readers cut it (outside a legacy block first). */
    planSection: (description) => pointer.extractPlanSection(asked.outsideAsked(description)) ?? pointer.extractPlanSection(description || ''),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. capture
// ---------------------------------------------------------------------------------------------------------------

async function proxyGet(base, path) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${base}/api/proxy${path}`);
    if (res.status === 429) {
      await sleep(((Number(res.headers.get('retry-after')) || 10) + 1) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`);
    return res.json();
  }
  throw new Error(`GET ${path} kept answering 429`);
}

const OPEN = (i) => i && i.identifier && i.trashed !== true && !['completed', 'canceled', 'duplicate'].includes(i.state?.type);

/**
 * The old facts of one ticket, as the deployed readers computed them, from its fetched text.
 * @param {object} legacy - legacyReadersFrom(...)
 * @param {object} t - {identifier, description, comments, children, parent: {identifier, description}|null, state}
 */
export function oldFactsOf(legacy, t) {
  const leaf = !(t.children || []).length;
  const trail = leaf ? legacy.trailPlan(t.comments || [], t.description || '', t.parent) : null;
  return {
    leaf,
    where: trail?.where ?? null,
    parent: trail?.parent ?? null,
    at: trail?.at ?? null,
    sessionFit: trail?.sessionFit ?? null,
    planReviewDue: trail?.planReviewDue ?? null,
    nodeSessionFit: leaf ? null : legacy.nodeSessionFit({ description: t.description || '', state: t.state }, t.children || []),
    latestVerdict: legacy.latestVerdict(t.comments || []),
    // Look-first's "has a plan" is exactly assembleTrailFacts(comments, description, { leaf: true }).plan.where (note 3).
    lookFirstHasPlan: Boolean(legacy.trailPlan(t.comments || [], t.description || '', null)?.where),
  };
}

async function capture({ base, legacyDir }) {
  const legacy = await legacyReadersFrom(legacyDir);
  const listed = [];
  let after = null;
  do {
    const page = await proxyGet(base, `/issues?limit=${LIST_PAGE}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    listed.push(...(page.issues || []));
    after = page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
    await sleep(PACE_MS);
  } while (after);
  const open = listed.filter(OPEN).map((i) => i.identifier).sort(byIdentifier);
  const cache = new Map();
  const read = async (ref) => {
    if (cache.has(ref)) return cache.get(ref);
    const issue = await proxyGet(base, `/issues/${encodeURIComponent(ref)}`);
    await sleep(PACE_MS);
    const t = {
      identifier: issue.identifier || ref,
      state: { type: issue.state?.type ?? null, name: issue.state?.name ?? null },
      description: issue.description || '',
      comments: (issue.comments || []).map((c) => ({ id: c.id, body: c.body || '', createdAt: c.createdAt || null, user: c.user?.name || c.user || null })),
      children: (issue.children || []).map((c) => ({ id: c.id, identifier: c.identifier, state: c.state, inverseRelations: c.inverseRelations || [] })),
      parentRef: issue.parent?.identifier || null,
    };
    cache.set(ref, t);
    return t;
  };
  const tickets = {};
  for (const ref of open) {
    const t = await read(ref);
    const parent = t.parentRef ? await read(t.parentRef) : null;
    const withParent = { ...t, parent: parent ? { identifier: parent.identifier, description: parent.description } : null };
    tickets[ref] = { ...t, old: oldFactsOf(legacy, withParent) };
  }
  const records = {};
  for (const [name, query] of [['tasks', 'kind=task'], ['plans', 'kind=plan'], ['findings', 'kind=finding&to=plan-review']]) {
    records[name] = (await proxyGet(base, `/records?${query}`)).records || [];
    await sleep(PACE_MS);
  }
  // The planner's text inputs are re-read by the same deployed readers, stored beside the facts.
  for (const ref of open) {
    const t = tickets[ref];
    t.planSection = legacy.planSection(t.description);
    t.planComment = t.old.where === 'comment' ? (t.comments.find((c) => c.createdAt === t.old.at) || null) : null;
  }
  return { generatedAt: new Date().toISOString(), base: base.replace(/\/\/[^/]*@/, '//'), listed: listed.length, open, tickets, records };
}

function byIdentifier(a, b) {
  const [ka, na] = a.split('-');
  const [kb, nb] = b.split('-');
  return ka === kb ? Number(na) - Number(nb) : ka.localeCompare(kb);
}

// ---------------------------------------------------------------------------------------------------------------
// 2. plan (pure)
// ---------------------------------------------------------------------------------------------------------------

const firstLine = (text) => (String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '');

/**
 * The import plan for one ticket from its captured text and old facts: `{action, ...}`. Actions: `none` (no plan),
 * `import` (a plan record, maybe a finding), `held` (with its reason: unreadable, parent-only, has-records).
 * @param {object} t - a captured ticket (text, old facts, planSection, planComment)
 * @param {{taskOf: (ticket: string) => object|null, plansIn: (taskId: string) => object[]}} store - the captured records
 */
export function planTicket(t, store) {
  const o = t.old;
  const task = store.taskOf(t.identifier);
  const kept = task ? store.plansIn(task.id).filter((p) => p.state === 'kept') : [];
  // A leaf's own plan is where the old trail reader found it; a node's is its description's plan section (the old node
  // reader read only a session-fit phrase there). A node with the phrase and no section has no plan text to import.
  const ownText = o.leaf ? o.where : (t.planSection != null ? 'description' : null);
  if (!o.leaf && !ownText && o.nodeSessionFit) return { action: 'held', reason: 'unreadable', detail: 'a session-fit phrase with no plan section to import: held for replanning' };
  if (!ownText && !o.parent) return { action: 'none' };
  if (kept.length) return { action: 'held', reason: 'has-records', detail: `its task already holds plan records (${kept.map((p) => p.id).join(', ')})` };
  if (!ownText && o.parent) return { action: 'held', reason: 'parent-only', detail: `planned only through its parent ${o.parent} (note A): held for replanning, not linked to the parent's whole plan` };
  const fit = o.leaf ? o.sessionFit : o.nodeSessionFit;
  const to = ADDRESSEE_OF_FIT[fit];
  if (!to) return { action: 'held', reason: 'unreadable', detail: 'a plan with no readable session-fit line: held for replanning, no default' };
  const text = ownText === 'comment' ? (t.planComment?.body || '') : (t.planSection ?? (t.description || ''));
  if (!text.trim()) return { action: 'held', reason: 'unreadable', detail: 'the plan text could not be cut out of the ticket' };
  const copied = COPIED_SLICE.test(t.description || '') && ownText === 'description';
  const ids = importIdsOf(t.identifier);
  const says = copied
    ? `Imported at the slice-2 cutover from this child's copied slice of its parent's plan; it cannot be mapped to a parent piece.\n\n${text.trim()}`
    : text.trim();
  const approved = o.latestVerdict?.verdict === 'approve';
  const finding = approved
    ? { id: ids.finding, end: { state: 'done', reason: `the latest plan-review verdict (${o.latestVerdict.at || 'undated'}) is Approve` } }
    : (o.leaf ? o.planReviewDue : null) === 'yes' ? { id: ids.finding, end: null } : null;
  return {
    action: 'import',
    copied,
    from: ownText,
    plan: { id: ids.plan, in: t.identifier, to, says },
    finding: finding ? { ...finding, in: t.identifier, to: 'plan-review', about: ids.plan, says: approved ? 'Plan review of the imported plan (reviewed before the cutover).' : 'Plan review owed: the plan said so before the cutover.' } : null,
    needsTask: !task,
  };
}

/**
 * The whole import plan from a capture: one row per open ticket, the records to write, the held list.
 * @param {object} cap - capture()'s output
 */
export function planImport(cap) {
  const tasks = (cap.records?.tasks || []).filter((r) => r.kind === 'task');
  const taskByRef = new Map(tasks.filter((t) => t.fields?.ref).map((t) => [t.fields.ref, t]));
  const plans = cap.records?.plans || [];
  const store = { taskOf: (ref) => taskByRef.get(ref) || null, plansIn: (taskId) => plans.filter((p) => p.in === taskId) };
  const rows = [];
  for (const ref of cap.open) {
    const t = cap.tickets[ref];
    rows.push({ ticket: ref, ...planTicket(t, store) });
  }
  return {
    generatedAt: new Date().toISOString(),
    rows,
    held: rows.filter((r) => r.action === 'held'),
    counts: Object.fromEntries(['import', 'held', 'none'].map((a) => [a, rows.filter((r) => r.action === a).length])),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. apply (inside the production service)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Write (or, without `write`, check) the planned records through the checked writer. Returns one line per row.
 * @param {{writes: object, recordsStore: object, urlKey: string, planned: object, tickets?: object, write?: boolean}} args
 *   `tickets` carries each ticket's description for a task made here (askedOf), as the P1 import did.
 */
export async function applyImport({ writes, recordsStore, urlKey, planned, write = false }) {
  const out = [];
  for (const row of planned.rows) {
    if (row.action !== 'import') { out.push({ ticket: row.ticket, action: row.action, reason: row.reason || null }); continue; }
    const existing = await recordsStore.current(urlKey, row.plan.id);
    if (existing) { out.push({ ticket: row.ticket, action: 'already-imported', plan: row.plan.id }); continue; }
    if (!write) {
      const task = row.needsTask ? await writes.taskOfTicket({}, urlKey, row.ticket, WRITER, { dryRun: true }) : null;
      out.push({ ticket: row.ticket, action: 'would-import', plan: row.plan.id, to: row.plan.to, finding: row.finding ? (row.finding.end ? 'ended' : 'open') : null, task: task?.problem ? `refused: ${task.problem}` : row.needsTask ? 'would make' : 'held' });
      continue;
    }
    if (row.needsTask) {
      const made = await writes.taskOfTicket({}, urlKey, row.ticket, WRITER);
      if (made?.problem) { out.push({ ticket: row.ticket, action: `refused: ${made.problem}` }); continue; }
    }
    const plan = await writes.add({ urlKey, kind: 'plan', input: { in: row.plan.in, to: row.plan.to, says: row.plan.says }, by: WRITER, via: 'import', fixedId: row.plan.id });
    if (plan.problems?.length) { out.push({ ticket: row.ticket, action: 'refused', problems: plan.problems }); continue; }
    let finding = null;
    if (row.finding) {
      const f = await writes.add({ urlKey, kind: 'finding', input: { in: row.finding.in, to: row.finding.to, says: row.finding.says, about: [row.finding.about] }, by: WRITER, via: 'import', fixedId: row.finding.id });
      if (f.problems?.length) finding = `refused: ${JSON.stringify(f.problems)}`;
      else if (row.finding.end) finding = (await writes.end({ urlKey, id: row.finding.id, input: row.finding.end, by: WRITER })).problems ? 'end refused' : 'ended';
      else finding = 'open';
    }
    out.push({ ticket: row.ticket, action: 'imported', plan: row.plan.id, to: row.plan.to, finding });
  }
  return out;
}

async function apply({ write }) {
  const planned = JSON.parse(readFileSync(0, 'utf8'));
  const { MongoClient } = await import('mongodb');
  const { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } = await import('../../lib/records-store.js');
  const { createRecordWrites } = await import('../../lib/records/writes.js');
  const { isTerminalState } = await import('../../lib/providers/state-map.js');
  const { askedOf } = await import('../../lib/asked-of.js');
  const { STAGE_KINDS } = await import('../../lib/prompts/stage-kinds.js');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const recordsStore = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
    const readTicket = async (_ctx, ref) => {
      const t = planned.tickets?.[ref];
      return t ? { identifier: ref, description: t.description, state: t.state, trashed: false, parent: t.parentRef ? { identifier: t.parentRef } : null } : null;
    };
    // The stage kinds are what `to` may name (the records route passes them the same way, routes/proxy-records.js).
    const writes = createRecordWrites({ recordsStore, isTerminalState, readTicket, askedText: askedOf, stageKinds: Object.keys(STAGE_KINDS) });
    const out = await applyImport({ writes, recordsStore, urlKey: planned.urlKey, planned, write });
    console.log(JSON.stringify({ write, rows: out }, null, 2));
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 4. compare (pure)
// ---------------------------------------------------------------------------------------------------------------

/** The closed list of explained differences (the plan's Cutover section). Anything else is unexplained. */
export const EXPLAINED = Object.freeze({
  A: 'review due yes, but Approve is the latest verdict: reads not due',
  B: 'an unreadable plan held: reads no plan',
  C: 'a note-A leaf (planned only through its parent) held: reads no plan',
  D: 'a breakdown plan with no plan-review finding: reads due',
  E: 'the ticket holding plan-72a996db (a throwaway plan record LIN-4503\'s close-out wrote)',
});

const NEW_FIT = { several: 'needs multiple sessions', one: 'fits one session' };

/**
 * The records after the import as current versions: the captured records plus the planned ones (dry run), or the
 * records read back (after the apply).
 */
export function recordsAfter(cap, planned) {
  const tasks = [...(cap.records?.tasks || [])];
  const plans = [...(cap.records?.plans || [])];
  const findings = [...(cap.records?.findings || [])];
  const taskOf = new Map(tasks.filter((t) => t.fields?.ref).map((t) => [t.fields.ref, t]));
  for (const row of planned.rows) {
    if (row.action !== 'import') continue;
    let task = taskOf.get(row.ticket);
    if (!task) {
      task = { id: fixedIdOf('task', 'ticket', row.ticket), kind: 'task', state: 'open', fields: { ref: row.ticket }, links: {} };
      tasks.push(task);
      taskOf.set(row.ticket, task);
    }
    plans.push({ id: row.plan.id, v: 1, kind: 'plan', state: 'kept', in: task.id, to: row.plan.to, via: 'import', links: {} });
    if (row.finding) findings.push({ id: row.finding.id, v: row.finding.end ? 2 : 1, kind: 'finding', state: row.finding.end ? 'done' : 'open', in: task.id, to: 'plan-review', links: { about: [row.plan.id] } });
  }
  return { tasks, plans, findings };
}

/**
 * Compare the captured old facts with the new facts, ticket by ticket. Returns `{rows, differences, unexplained}`:
 * every difference names its fact, old and new values, and its explanation letter, or `null` (unexplained).
 * @param {object} cap - the capture
 * @param {object} planned - the import plan
 * @param {{tasks: object[], plans: object[], findings: object[]}} after - the records after the import
 */
export function compareFacts(cap, planned, after) {
  const facts = planFactsFromRecords(after, cap.open);
  const rowOf = new Map(planned.rows.map((r) => [r.ticket, r]));
  const holdsThrowaway = (ref) => {
    const task = after.tasks.find((t) => t.fields?.ref === ref);
    return Boolean(task && after.plans.some((p) => p.in === task.id && p.id === 'plan-72a996db'));
  };
  const differences = [];
  for (const ref of cap.open) {
    const o = cap.tickets[ref].old;
    const n = facts.get(ref);
    const row = rowOf.get(ref) || {};
    const explain = (fact, oldValue, newValue) => {
      let why = null;
      if (holdsThrowaway(ref)) why = 'E';
      else if (row.action === 'held' && row.reason === 'unreadable') why = 'B';
      else if (row.action === 'held' && row.reason === 'parent-only') why = 'C';
      else if (fact === 'reviewDue' && oldValue === true && newValue === false && o.latestVerdict?.verdict === 'approve') why = 'A';
      else if (fact === 'reviewDue' && oldValue === false && newValue === true && n.reviewOwed?.why === 'breakdown-unreviewed') why = 'D';
      differences.push({ ticket: ref, fact, old: oldValue, new: newValue, explained: why });
    };
    const oldHas = Boolean(o.where || o.parent || (!o.leaf && o.nodeSessionFit));
    if (oldHas !== n.hasPlan) explain('hasPlan', oldHas, n.hasPlan);
    if (Boolean(o.parent) !== n.partOfParent) explain('partOfParent', Boolean(o.parent), n.partOfParent);
    if (o.leaf) {
      if ((o.sessionFit ?? null) !== (NEW_FIT[n.sessionFit] ?? null)) explain('sessionFit', o.sessionFit ?? null, NEW_FIT[n.sessionFit] ?? null);
      if ((o.planReviewDue === 'yes') !== Boolean(n.reviewOwed?.owed)) explain('reviewDue', o.planReviewDue === 'yes', Boolean(n.reviewOwed?.owed));
      if (o.lookFirstHasPlan !== n.hasPlan) explain('lookFirstHasPlan', o.lookFirstHasPlan, n.hasPlan);
    } else if ((o.nodeSessionFit ?? null) !== (NEW_FIT[n.sessionFit] ?? null)) {
      explain('nodeSessionFit', o.nodeSessionFit ?? null, NEW_FIT[n.sessionFit] ?? null);
    }
  }
  return { tickets: cap.open.length, differences, unexplained: differences.filter((d) => !d.explained) };
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const step = process.argv[2];
  if (step === 'capture') {
    const out = await capture({ base: argOf('--base') || process.env.HARBOUR_LOCAL_BASE, legacyDir: argOf('--legacy') });
    writeFileSync(argOf('--out') || 'capture.json', JSON.stringify(out, null, 2));
    console.log(`captured ${out.open.length} open tickets of ${out.listed}`);
  } else if (step === 'plan') {
    const cap = JSON.parse(readFileSync(argOf('--capture'), 'utf8'));
    const planned = { ...planImport(cap), urlKey: argOf('--urlkey') || 'linearviewer', tickets: Object.fromEntries(Object.entries(cap.tickets).map(([k, t]) => [k, { description: t.description, state: t.state, parentRef: t.parentRef }])) };
    writeFileSync(argOf('--out') || 'plan.json', JSON.stringify(planned, null, 2));
    console.log(JSON.stringify(planned.counts));
  } else if (step === 'apply') {
    await apply({ write: process.argv.includes('--apply') });
  } else if (step === 'compare') {
    const cap = JSON.parse(readFileSync(argOf('--capture'), 'utf8'));
    const planned = JSON.parse(readFileSync(argOf('--plan'), 'utf8'));
    const after = argOf('--after') ? JSON.parse(readFileSync(argOf('--after'), 'utf8')) : recordsAfter(cap, planned);
    console.log(JSON.stringify(compareFacts(cap, planned, after), null, 2));
  } else {
    console.error('usage: slice-2-import.mjs capture|plan|apply|compare (see the header)');
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => { console.error(err?.stack || err); process.exit(1); });
}
