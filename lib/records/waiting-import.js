/**
 * LIN-4494 (piece 3): the one-off import of the area notes' `## Waiting` entries into records. Pure: it reads note text
 * and returns the plan; the importer script (scripts/records-import.mjs) reads the notes from a git ref and writes the
 * plan through the checked pipeline (lib/records/writes.js).
 *
 * What a Waiting entry becomes (LIN-4494 acceptance):
 * - an ordinary entry: a finding addressed to the project, `via: import`, its note's name kept in `how`;
 * - a "Security Review" entry: a task record, one child of one parent task record for the whole import, not also a
 *   finding. The parent is addressed to the project, so the backlog lists it with its children.
 *
 * Identity (LIN-4494 open question, proposed here): an entry's record id is a hash of its note and its wrapped text, so
 * a re-run finds what it made, even after the record has ended. An entry reworded between two refs has a new id and
 * imports again; the report says so by counting it as new. Malformed entries (no cited file) are reported and never
 * written, so a reviewer can fix the note and re-run.
 *
 * A Waiting entry's wrapped lines are joined before anything reads it (the notes' reader does that): a bullet's
 * attribution often sits on its second line, and a first-line match would miss it (LIN-4494 survey).
 */
import { fixedIdOf } from './refs.js';

/**
 * LIN-4495: the frozen reader of a note's `## Waiting` section, kept only for the one-off import. The notes no longer
 * carry the section (the cutover removed it), so this reads a pre-cutover ref: one entry per top-level `- ` bullet under
 * `## Waiting`, its indented continuation lines joined. It is the importer's own, and the census allowlists it by name.
 * @returns {{headings: string[], waiting: string[]}}
 */
export function parseWaitingSection(text) {
  const headings = [];
  const waiting = [];
  let section = null;
  for (const line of String(text ?? '').split('\n')) {
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); headings.push(section); continue; }
    if (section !== 'Waiting') continue;
    if (line.startsWith('- ')) waiting.push(line.slice(2));
    else if (/^\s+\S/.test(line) && waiting.length) waiting[waiting.length - 1] += ` ${line.trim()}`;
  }
  return { headings, waiting };
}

/**
 * LIN-4495: the Waiting count of one notes directory at a historical commit, for the stability measures' pre-cutover
 * windows (scripts/stability-measures.mjs). `files` is { fileName: text } over the notes; `isNoteFile` is the notes'
 * own predicate (lib/prompts/area-note-format.js), injected because this leaf imports only Platform. A note counts when
 * it carries a `## Waiting` section, even an empty one.
 *   - A commit with no notes at all has 0 Waiting entries: zero is a reading of a commit that can be read (the
 *     stability tool's rule, and the committed reference reads it that way for a window before `docs/areas` existed).
 *   - A commit whose notes carry no `## Waiting` section has no Waiting count to read: it is a reason, never a zero
 *     (a zero would read as a fall). That is the state of every note after the cutover removed the lists.
 * @returns {{count: number} | {reason: string}}
 */
export function countFrozenWaiting(files, { isNoteFile }) {
  let notes = 0;
  let withSection = 0;
  let count = 0;
  for (const [name, text] of Object.entries(files ?? {})) {
    if (!isNoteFile(name)) continue;
    notes += 1;
    const { headings, waiting } = parseWaitingSection(text);
    if (!headings.includes('Waiting')) continue;
    withSection += 1;
    count += waiting.length;
  }
  if (notes && !withSection) return { reason: 'the area notes carry no ## Waiting section at this commit (the lists were retired in LIN-4495)' };
  return { count };
}

const SECURITY_RE = /security review/i;

/**
 * One note's `## Waiting` entries, read by `parseWaitingSection` above (the default; LIN-4495 moved the Waiting half of
 * the notes reader here, its only remaining consumer) and `citedPaths` (the one cited-path predicate, from
 * lib/prompts/area-note-format.js, injected because this leaf imports only Platform; the importer script and its test
 * pass it in). An entry that cites no file is malformed: it is reported with its place in the list and never written.
 * @returns {{present: boolean, bullets: number, entries: Array<{text: string, cited: string, entry: number}>, malformed: Array<{text: string, entry: number, why: string}>}}
 */
export function readWaiting(markdown, { parseNote = parseWaitingSection, citedPaths }) {
  const { headings, waiting } = parseNote(String(markdown ?? ''));
  const entries = [];
  const malformed = [];
  waiting.forEach((raw, i) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    const cited = citedPaths(text)[0];
    if (!text) malformed.push({ text, entry: i + 1, why: 'the bullet is empty' });
    else if (!cited) malformed.push({ text, entry: i + 1, why: 'the entry cites no file it is about' });
    else entries.push({ text, cited, entry: i + 1 });
  });
  return { present: headings.includes('Waiting'), bullets: waiting.length, entries, malformed };
}

/** Whether an entry is a safety entry (the "Security Review" ones, which become tasks). */
export const isSecurityEntry = (text) => SECURITY_RE.test(text);

/** The finding's id for a Waiting entry: a function of its note and its text, so a re-run finds it. */
export const findingIdOf = (note, text) => fixedIdOf('finding', note, text);

/** The security entry's child task id, the same way. */
export const securityTaskIdOf = (note, text) => fixedIdOf('task', 'security', note, text);

/** The one parent task every security entry of an import hangs under. */
export const SECURITY_PARENT_ID = fixedIdOf('task', 'security-review-parent');

/**
 * The import plan over notes: each note's name (its slug) and its markdown. Returns the writes in order, the parent
 * first, and the counts the report needs.
 * @param {Array<{note: string, markdown: string}>} notes
 * @param {{ref: string|null, parseNote: Function, citedPaths: Function}} opts - the git ref (or fixture path) the notes were
 *   read from, kept in each record's `how`; and the area notes' reader (see readWaiting)
 */
export function planImport(notes, { ref = null, parseNote, citedPaths } = {}) {
  if (typeof parseNote !== 'function' || typeof citedPaths !== 'function') {
    throw new TypeError('planImport needs parseNote and citedPaths (lib/prompts/area-note-format.js)');
  }
  const writes = [];
  const perNote = [];
  let bullets = 0;
  let malformed = 0;
  const securityNotes = new Set();
  let securityEntries = 0;
  for (const { note, markdown } of notes) {
    const parsed = readWaiting(markdown, { parseNote, citedPaths });
    bullets += parsed.bullets;
    malformed += parsed.malformed.length;
    let securityHere = 0;
    let ordinaryHere = 0;
    for (const entry of parsed.entries) {
      if (isSecurityEntry(entry.text)) {
        securityHere += 1;
        securityEntries += 1;
        securityNotes.add(note);
        writes.push({ kind: 'task', id: securityTaskIdOf(note, entry.text), note, text: entry.text, parent: SECURITY_PARENT_ID, cited: entry.cited });
      } else {
        ordinaryHere += 1;
        writes.push({ kind: 'finding', id: findingIdOf(note, entry.text), note, text: entry.text, cited: entry.cited });
      }
    }
    perNote.push({ note, present: parsed.present, bullets: parsed.bullets, findings: ordinaryHere, security: securityHere, malformed: parsed.malformed });
  }
  if (securityEntries) writes.unshift({ kind: 'task', id: SECURITY_PARENT_ID, parentOf: true, note: null, text: 'Security Review entries from the area notes\' Waiting lists' });
  return {
    ref,
    perNote,
    totals: {
      notes: notes.length,
      notesWithWaiting: perNote.filter((n) => n.present).length,
      bullets,
      entries: writes.filter((w) => !w.parentOf).length,
      findings: writes.filter((w) => w.kind === 'finding').length,
      security: securityEntries,
      securityNotes: securityNotes.size,
      malformed,
    },
    writes,
  };
}
