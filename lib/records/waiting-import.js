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
 * imports again; the report says so by counting it as new. Malformed entries (no cited path first) are reported and
 * never written, so a reviewer can fix the note and re-run.
 *
 * A Waiting entry's wrapped lines are joined before anything reads it: a bullet's attribution often sits on its second
 * line, and a first-line match would miss it (LIN-4494 survey).
 */
import { createHash } from 'node:crypto';

export const WAITING_HEADING = '## Waiting';
const SECURITY_RE = /security review/i;

const short = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/** A repo-relative path in backticks at the start: it has a `/`, or ends in a file extension (the notes' own rule). */
const CITED_RE = /^`([^`]+)`/;
const isCitedPath = (span) => span.includes('/') || /\.[A-Za-z0-9]+$/.test(span);

/**
 * The `## Waiting` section of one note, as entries. A bullet starts an entry; the non-blank lines after it, up to the next
 * bullet or blank line, continue it. Text is joined with single spaces.
 * @param {string} markdown - the whole note
 * @returns {{present: boolean, bullets: number, entries: Array<{text: string, cited: string|null, line: number}>, malformed: Array<{text: string, line: number, why: string}>}}
 */
export function parseWaiting(markdown) {
  const lines = String(markdown ?? '').split('\n');
  const start = lines.findIndex((l) => l.trim() === WAITING_HEADING);
  if (start < 0) return { present: false, bullets: 0, entries: [], malformed: [] };
  const bodyLines = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    bodyLines.push({ text: lines[i], line: i + 1 });
  }
  const raw = [];
  for (const { text, line } of bodyLines) {
    const bullet = /^\s*-\s+(.*)$/.exec(text);
    if (bullet && !/^\s/.test(text)) {
      raw.push({ parts: [bullet[1].trim()], line });
    } else if (text.trim() === '') {
      if (raw.length) raw.push({ blank: true });
    } else if (raw.length && !raw[raw.length - 1].blank) {
      raw[raw.length - 1].parts.push(text.trim());
    }
  }
  const entries = [];
  const malformed = [];
  let bullets = 0;
  for (const item of raw) {
    if (item.blank || !item.parts) continue;
    bullets += 1;
    const text = item.parts.join(' ').replace(/\s+/g, ' ').trim();
    const cited = CITED_RE.exec(text);
    if (!text) {
      malformed.push({ text, line: item.line, why: 'the bullet is empty' });
    } else if (!cited || !isCitedPath(cited[1])) {
      malformed.push({ text, line: item.line, why: 'the entry does not start by citing the file it is about' });
    } else {
      entries.push({ text, cited: cited[1], line: item.line });
    }
  }
  return { present: true, bullets, entries, malformed };
}

/** Whether an entry is a safety entry (the "Security Review" ones, which become tasks). */
export const isSecurityEntry = (text) => SECURITY_RE.test(text);

/** The finding's id for a Waiting entry: a function of its note and its text, so a re-run finds it. */
export const findingIdOf = (note, text) => `finding-${short(`${note}\n${text}`)}`;

/** The security entry's child task id, the same way. */
export const securityTaskIdOf = (note, text) => `task-${short(`security\n${note}\n${text}`)}`;

/** The one parent task every security entry of an import hangs under. */
export const SECURITY_PARENT_ID = `task-${short('security-review-parent')}`;

/**
 * The import plan over notes: each note's name (its slug) and its markdown. Returns the writes in order, the parent
 * first, and the counts the report needs.
 * @param {Array<{note: string, markdown: string}>} notes
 * @param {{ref: string|null}} opts - the git ref (or fixture path) the notes were read from, kept in each record's `how`
 */
export function planImport(notes, { ref = null } = {}) {
  const writes = [];
  const perNote = [];
  let bullets = 0;
  let malformed = 0;
  let securityNotes = new Set();
  let securityEntries = 0;
  for (const { note, markdown } of notes) {
    const parsed = parseWaiting(markdown);
    bullets += parsed.bullets;
    malformed += parsed.malformed.length;
    let securityHere = 0;
    let ordinaryHere = 0;
    for (const entry of parsed.entries) {
      if (isSecurityEntry(entry.text)) {
        securityHere += 1;
        securityEntries += 1;
        securityNotes.add(note);
        writes.push({ kind: 'task', id: securityTaskIdOf(note, entry.text), note, text: entry.text, parent: SECURITY_PARENT_ID, cited: entry.cited, line: entry.line });
      } else {
        ordinaryHere += 1;
        writes.push({ kind: 'finding', id: findingIdOf(note, entry.text), note, text: entry.text, cited: entry.cited, line: entry.line });
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
