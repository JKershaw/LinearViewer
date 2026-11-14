// The area registry's repo-relative path, spelled once (LIN-4376; product-owned since LIN-4383). LIN-4470: the notes
// directory and the registry's file name are spelled here, once, and the path is derived from them; area-note-format.js
// re-exports the first two for the notes' readers.
// The product owns the registry (LIN-4371) and names this path in the area notes pointers'
// shared opening (`AREA_NOTES_WHERE`, lib/prompt-formatters.js; LIN-4346); the code-shape kit
// (scripts/code-shape/code-shape-lib.mjs) and the tests' registry helper read it from here.
// A leaf that imports nothing, so a script can import it without pulling in the prompt code.

/** The notes directory, repo-relative. */
export const NOTES_DIR = 'docs/areas';

/** The area registry's file name in NOTES_DIR. */
export const REGISTRY_FILE = 'areas.json';

export const REGISTRY_PATH = `${NOTES_DIR}/${REGISTRY_FILE}`;
