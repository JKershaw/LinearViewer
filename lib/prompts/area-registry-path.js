// The area registry's repo-relative path, spelled once (LIN-4376; product-owned since LIN-4383).
// The product owns the registry (LIN-4371) and names this path in the area notes pointers'
// shared opening (`AREA_NOTES_WHERE`, lib/prompt-formatters.js; LIN-4346); the code-shape kit
// (scripts/code-shape/code-shape-lib.mjs) and the tests' registry helper read it from here.
// A leaf that imports nothing, so a script can import it without pulling in the prompt code.
export const REGISTRY_PATH = 'docs/areas/areas.json';
