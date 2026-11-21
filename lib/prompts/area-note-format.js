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
// `:12` line suffix stays in, so a line number fails the path's existence check. The extensions are this repo's
// (NOTE_EXTENSIONS). LIN-4527: the retirement-line checker that read any extension (ANY_EXTENSION) is gone, so the
// predicate takes no extension list.
const PATH_SPAN = /^[\w.:-]+(?:\/[\w.:-]+)*\/?$/;
/** The extensions the notes guard reads as a path. */
export const NOTE_EXTENSIONS = 'js|mjs|cjs|json|md|css|html|txt|yml|yaml|toml|sh';
const EXTENSION_END = new RegExp(`\\.(?:${NOTE_EXTENSIONS})(?::\\d+)*$`);

/** Whether one backtick span reads as a repo-relative path. */
export function isCitedPath(span) {
  if (!PATH_SPAN.test(span)) return false;
  return span.includes('/') || EXTENSION_END.test(span);
}

/** Every backtick span in `text` that reads as a repo-relative path, in order. */
export function citedPaths(text) {
  return [...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((s) => isCitedPath(s));
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

