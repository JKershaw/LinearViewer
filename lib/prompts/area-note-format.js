// What an area note holds, read once in code (LIN-4420; LIN-4495: Lessons only, the Waiting lists are retired).
// docs/areas/README.md owns the format in prose; the area notes guard (tests/unit/area-notes.test.js) reads notes
// through this. The Waiting lists were imported as records and their reader is retired (LIN-4505). It imports
// only area-registry-path.js, which spells the notes directory and the registry's file name (LIN-4470), so a script can
// import it without pulling in the prompt code.
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

/**
 * A note's `##` sections (LIN-4495: the Waiting list is retired, and LIN-4505 imported it as records; nothing reads a
 * Waiting section).
 */
export function parseNote(text) {
  const headings = [];
  for (const line of text.split('\n')) {
    const h = /^## (.*)$/.exec(line);
    if (h) headings.push(h[1].trim());
  }
  return { headings };
}

/** Whether a file name directly inside NOTES_DIR is a note: a `.md` file other than the README. */
export const isNoteFile = (name) => name.endsWith('.md') && !NOT_NOTES.has(name);

