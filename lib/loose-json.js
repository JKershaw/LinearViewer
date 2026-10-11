/**
 * Loose-JSON reply recovery (LIN-3114) — the single owner of "how do we get a
 * JSON object out of a model reply that may be fenced or wrapped in prose".
 *
 * Seven parsers (next-run, observer-pass, ship-biscuit-editor, recap,
 * run-summary, session-summary, scan) each used to carry a private copy of
 * fence-strip → brace-slice → JSON.parse. They now call `extractJsonObject`;
 * `run-paragraph` returns prose, not JSON, so it reuses only `stripCodeFence`.
 *
 * Leaf module: no imports, so it can't join an import cycle.
 */

/**
 * Return the body of the FIRST fenced block (``` or ```lang) in `text`,
 * trimmed; if there is no fenced block, return `text` trimmed. First-fence
 * semantics, not a whole-string anchored strip: prose before/after is dropped
 * when a fence is present.
 *
 * Non-string input returns `''`.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripCodeFence(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  return fence ? fence[1].trim() : trimmed;
}

/**
 * Pull a JSON object out of a raw model reply, tolerating a code fence and
 * prose around the object (slices first `{` to LAST `}`). Returns the parsed
 * plain object, or `null` when nothing parseable was found — never throws.
 * Callers own their fallback value; `null` keeps parse failure distinguishable.
 *
 * Only objects are returned: arrays and scalars yield `null`.
 *
 * @param {*} raw
 * @returns {Object|null}
 */
export function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let text = stripCodeFence(raw);

  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    text = text.slice(first, last + 1);
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
