/**
 * LIN-4555 (LIN-4546 piece 7, finding-150d1329): the words a person reads in place of an id or a stamp an agent quoted.
 *
 * A question's ask and a note's words are an agent's own, and an agent quotes what it read: a task record id (`task-037eb576`),
 * a person id (`person:acct-…`), an ISO stamp. LIN-4554 read them on the task page (lib/render-task-records.js); this leaf is that
 * reading, moved out of the page renderer so the one reader of open questions and notes (lib/open-questions.js) reads every row
 * with it and every surface (Home, the Questions tab, the run page, the task page, Flight Companion's tool) shows the same words.
 * The record keeps its words as written; only what a person reads changes.
 *
 * Pure: the people and the tickets are handed in by the caller.
 */
import { stageLabel } from './run-view.js';
import { relativeAgo } from './time-words.js';

// A record id is `<kind>-<8 hex>` (lib/records/refs.js fixedIdOf): the one shape every reader recognises, whole (RECORD_ID) or
// quoted in words (RECORD_IN_TEXT). lib/render-task-records.js builds its versioned ref (RECORD_REF) from the same shape.
export const ID_SHAPE = '([a-z][a-z-]*)-[0-9a-f]{8}';
const RECORD_ID = new RegExp(`^${ID_SHAPE}$`);

/** A kind or state word as a person reads it: `plan-review` reads "plan review". */
export const plainWord = (word) => String(word || '').replace(/-/g, ' ');

/**
 * Who an actor is, in words (a record's `by` or `to`). `people` is the workspace's (lib/workspace-people.js, injected by the route);
 * `tickets` maps the task records the page knows to their tickets. Never a raw id: what cannot be named is "someone" (a person)
 * or "another task" / "another record".
 * @param {string|null|undefined} actor
 * @param {{people?: Map<string, string>, tickets?: Map<string, string|null>}} ctx
 */
export function whoWordOf(actor, { people = new Map(), tickets = new Map() } = {}) {
  if (typeof actor !== 'string' || !actor) return 'someone';
  if (actor.startsWith('person:')) return people.get(actor.slice('person:'.length)) || 'someone';
  if (actor === 'project') return 'the project';
  const id = actor.match(RECORD_ID);
  if (id) {
    if (id[1] !== 'task') return `another ${plainWord(id[1])}`;
    if (!tickets.has(actor)) return 'another task';
    return tickets.get(actor) || 'a child task';
  }
  // A stage, Harbour or any other writer word: the product's stage word (`stageLabel`: "Build", "Plan review", "Harbour").
  if (/^[a-z][a-z-]*$/.test(actor)) return stageLabel(actor);
  return 'someone';
}

const ISO_STAMP = /(?:\b(?:at|on) )?\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g;
const PERSON_IN_TEXT = /\bperson:[A-Za-z0-9_.-]*[A-Za-z0-9_]/g;
const RECORD_IN_TEXT = new RegExp(`\\b${ID_SHAPE}\\b`, 'g');

/** Whether `text` quotes a person id, so a caller reads the workspace's people only when the words need them. */
export function quotesPerson(text) {
  return typeof text === 'string' && text.includes('person:');
}

/** The task record ids `text` quotes (`task-<8 hex>`), so a caller can look up their tickets in one read. */
export function quotedTaskIds(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(RECORD_IN_TEXT)].filter((m) => m[1] === 'task').map((m) => m[0]);
}

/**
 * A writer's own words as the line reads them (LIN-4554): a person id quoted in them is the person's name ("someone" when the
 * workspace cannot name them), a task id its ticket ("a task" when unknown), another record id "a <kind>", and a timestamp the
 * relative words ("at <stamp>" reads "2 hours ago"). Nothing else in the words changes. The record keeps its words as written.
 */
export function readableWords(text, { people = new Map(), tickets = new Map(), now = new Date() } = {}) {
  return String(text || '')
    .replace(PERSON_IN_TEXT, (m) => whoWordOf(m, { people }))
    .replace(RECORD_IN_TEXT, (m, kind) => (kind === 'task' ? (tickets.get(m) || 'a task') : `a ${plainWord(kind)}`))
    .replace(ISO_STAMP, (m) => relativeAgo(m.replace(/^(?:at|on) /, ''), now) || m);
}

/** The workspace's people as the name each account shows: account id to name, skipping any without both. */
export function peopleNames(people) {
  return new Map((Array.isArray(people) ? people : []).filter((p) => p && p.accountId && p.name).map((p) => [p.accountId, p.name]));
}
