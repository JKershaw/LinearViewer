/**
 * The prompt download filename (LIN-316): one `<identifier>-<promptName>.md` rule for the server's download routes and
 * the browser's download buttons. A shared leaf (LIN-4463 piece 5): it imports nothing and names no browser or Node
 * global, and it is served at /lib/prompt-filename.js (SHARED_MODULES, lib/vendor-assets.js), so public/prompt-section.js
 * and public/app.js import these two functions instead of each keeping a copy. lib/prompt-formatters.js re-exports them.
 */

/**
 * Slugify a value into a filesystem-safe token for download filenames.
 * Non-word characters collapse to single dashes; result is lower-cased.
 * @param {string} value - Raw value (identifier, prompt name, etc.)
 * @returns {string} Filesystem-safe slug (empty string if nothing usable)
 */
export function slugifyForFilename(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/**
 * Build a `<identifier>-<promptName>.md` download filename for a prompt.
 * Both parts are slugified; the identifier is dropped when absent so the
 * name still produces a sensible file (e.g. `autopilot.md`).
 * @param {string} identifier - Issue identifier (e.g. LIN-316), may be empty
 * @param {string} promptName - Prompt name/label (e.g. "Retro")
 * @returns {string} A safe filename ending in `.md`
 */
export function buildPromptFilename(identifier, promptName) {
  const id = slugifyForFilename(identifier);
  const name = slugifyForFilename(promptName) || 'prompt';
  const base = id ? `${id}-${name}` : name;
  return `${base}.md`;
}
