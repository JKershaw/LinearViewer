/**
 * LIN-4494 (piece 3): applies an import to a records store, through the checked pipeline (lib/records/writes.js).
 * Two sources, one shape of result:
 * - the area notes' Waiting plan (lib/records/waiting-import.js planImport);
 * - the parked-ticket manifest (scripts/records/parked-tickets.json): each ticket's task, claimed for its ticket, and a
 *   finding for each open hand-off the manifest names.
 *
 * Dry run by default: `apply: false` reads the store and reports what would be written, and writes nothing. Every
 * record's id is fixed (a function of its source), so a second apply finds what the first made and adds nothing.
 */
import { findingIdOf, securityTaskIdOf, SECURITY_PARENT_ID } from './waiting-import.js';
import { fixedIdOf } from './refs.js';

/** A parked ticket's task id: a function of the ticket, so the manifest's task is made once. */
export const ticketTaskIdOf = (ticket) => fixedIdOf('task', 'ticket', ticket);

/**
 * @param {Object} deps
 * @param {ReturnType<import('./writes.js').createRecordWrites>} deps.writes - the checked pipeline
 * @param {import('../records-store.js').RecordsStore} deps.recordsStore
 * @param {string} deps.urlKey
 * @param {boolean} [deps.apply=false]
 * @returns {Promise<{created: number, existing: number, wouldCreate: number, refused: Array<{id: string, text: string, problems: object[]}>, byKind: object}>}
 */
export async function applyWrites({ writes, recordsStore, urlKey, apply = false, items }) {
  const report = { created: 0, existing: 0, wouldCreate: 0, refused: [] };
  for (const item of items) {
    const [present] = await recordsStore.versionsOf(urlKey, [item.id]);
    if (present) { report.existing += 1; continue; }
    if (!apply) { report.wouldCreate += 1; continue; }
    const result = await writes.add({ urlKey, kind: item.kind, input: item.input, by: 'import', via: 'import', fixedId: item.id });
    if (result.problems) report.refused.push({ id: item.id, text: item.label, problems: result.problems });
    else report.created += 1;
  }
  return report;
}

/** The items the Waiting plan writes, as applyWrites reads them: input built the way the record's kind takes it. */
export function waitingItems(plan, { ref = null } = {}) {
  const how = (note) => `Waiting entry in ${note}, imported from ${ref ?? 'a fixture'}`;
  return plan.writes.map((w) => {
    if (w.parentOf) return { id: SECURITY_PARENT_ID, kind: 'task', label: 'Security Review entries', input: { 'done-when': 'every Security Review entry from the area notes is settled', to: 'project' } };
    if (w.kind === 'task') return { id: securityTaskIdOf(w.note, w.text), kind: 'task', label: w.text, input: { 'done-when': w.text, in: SECURITY_PARENT_ID, to: 'project' } };
    return { id: findingIdOf(w.note, w.text), kind: 'finding', label: w.text, input: { says: w.text, how: how(w.note), to: 'project' } };
  });
}

/**
 * The manifest's items: for each ticket, its task (claimed for the ticket once made) and one finding per open hand-off.
 * `ensureClaim` is called with the ticket and the task id after the task is made (apply only).
 * @param {{tickets: Array<{ticket: string, title?: string, asked?: string, done_when?: string, findings?: Array<{says: string, how?: string, to: string, source?: string}>}>}} manifest
 */
export function manifestItems(manifest) {
  const items = [];
  for (const t of manifest.tickets || []) {
    const taskId = ticketTaskIdOf(t.ticket);
    const taskInput = { ref: t.ticket };
    if (t.asked) taskInput.asked = t.asked;
    if (t.done_when) taskInput['done-when'] = t.done_when;
    items.push({ id: taskId, kind: 'task', label: t.ticket, input: taskInput, ticket: t.ticket });
    for (const f of t.findings || []) {
      const input = { says: f.says, to: f.to, in: taskId };
      if (f.how) input.how = f.how;
      else if (f.source) input.how = `from ${f.source} on ${t.ticket}`;
      items.push({ id: findingIdOf(t.ticket, f.says), kind: 'finding', label: `${t.ticket}: ${f.says}`, input, ticket: t.ticket });
    }
  }
  return items;
}

/**
 * Apply the manifest: the tasks are made through the pipeline, then each ticket is claimed for its task. A ticket already
 * claimed keeps its task (the claim is insert-only), and the report names it.
 */
export async function applyManifest({ writes, recordsStore, urlKey, apply = false, manifest }) {
  const items = manifestItems(manifest);
  const report = await applyWrites({ writes, recordsStore, urlKey, apply, items });
  if (apply) {
    for (const item of items.filter((i) => i.kind === 'task' && i.ticket)) {
      const made = await recordsStore.versionsOf(urlKey, [item.id]);
      if (made.length) await recordsStore.claimTicket(urlKey, item.ticket, item.id);
    }
  }
  return report;
}
