// What an area note's Waiting entry is, defined once (LIN-4420). docs/areas/README.md owns the format in prose;
// this is its one reading in code. The area notes guard (tests/unit/area-notes.test.js) checks every entry it finds,
// and the stability measure (scripts/stability-measures.mjs) counts them at two commits, so the two can never count
// a different set. A leaf that imports nothing, beside area-registry-path.js, so a script can import it without
// pulling in the prompt code.

/** The notes directory, repo-relative. */
export const NOTES_DIR = 'docs/areas';

/** Files in NOTES_DIR that are not notes: the format's own README and the registry. */
export const NOT_NOTES = new Set(['README.md', 'areas.json']);

/** A note's `##` sections and its waiting entries (one per top-level `- ` bullet under `## Waiting`, continuation lines joined). */
export function parseNote(text) {
  const headings = [];
  const waiting = [];
  let section = null;
  for (const line of text.split('\n')) {
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); headings.push(section); continue; }
    if (section !== 'Waiting') continue;
    if (line.startsWith('- ')) waiting.push(line.slice(2));
    else if (/^\s+\S/.test(line) && waiting.length) waiting[waiting.length - 1] += ` ${line.trim()}`;
  }
  return { headings, waiting };
}

/** Whether a file name directly inside NOTES_DIR is a note: a `.md` file other than the README. */
export const isNoteFile = (name) => name.endsWith('.md') && !NOT_NOTES.has(name);

/** Waiting entries across a notes directory, given as { fileName: text }; files that are not notes are skipped. */
export const countWaiting = (files) =>
  Object.entries(files).reduce((n, [name, text]) => n + (isNoteFile(name) ? parseNote(text).waiting.length : 0), 0);
