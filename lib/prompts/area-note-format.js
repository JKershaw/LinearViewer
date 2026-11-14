// What an area note's Waiting entry is, defined once (LIN-4420). docs/areas/README.md owns the format in prose;
// this is its one reading in code. The area notes guard (tests/unit/area-notes.test.js) checks every entry it finds,
// and the stability measure (scripts/stability-measures.mjs) counts them at two commits, so the two can never count
// a different set. It imports only area-registry-path.js, which spells the notes directory and the registry's file name
// (LIN-4470), so a script can import it without pulling in the prompt code.
import { NOTES_DIR, REGISTRY_FILE } from './area-registry-path.js';

export { NOTES_DIR, REGISTRY_FILE };

/** Files in NOTES_DIR that are not notes: the format's own README and the registry. */
export const NOT_NOTES = new Set(['README.md', REGISTRY_FILE]);

// A repo-relative path, as a backtick span in a note or a retirement line (LIN-4470, the one predicate). The span holds
// path characters only, and either a `/` or a file extension; `/dispatch`, `^lib/` and `provider.name` are not paths. A
// `:12` line suffix stays in, so a line number fails the path's existence check. Which extensions count is the caller's:
// the notes guard reads this repo's files (NOTE_EXTENSIONS), and the retirement-line checker reads any extension of one to
// six characters (ANY_EXTENSION), because its paths may name another repository's files.
const PATH_SPAN = /^[\w.:-]+(?:\/[\w.:-]+)*\/?$/;
/** The extensions the notes guard reads as a path. */
export const NOTE_EXTENSIONS = 'js|mjs|cjs|json|md|css|html|txt|yml|yaml|toml|sh';
/** Any extension of one to six characters. */
export const ANY_EXTENSION = '[A-Za-z0-9]{1,6}';

/** Whether one backtick span reads as a repo-relative path under the given extension alternation. */
export function isCitedPath(span, extensions = NOTE_EXTENSIONS) {
  if (!PATH_SPAN.test(span)) return false;
  return span.includes('/') || new RegExp(`\\.(?:${extensions})(?::\\d+)*$`).test(span);
}

/** Every backtick span in `text` that reads as a repo-relative path, in order. */
export function citedPaths(text, extensions = NOTE_EXTENSIONS) {
  return [...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((s) => isCitedPath(s, extensions));
}

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
