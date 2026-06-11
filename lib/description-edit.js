/**
 * Pure, network-free helpers for editing an issue description by *supplying only
 * the new content* — the caller reads the live body, these functions splice, and
 * the result is written back. The original body is never re-emitted by the agent,
 * which makes the LIN-398 corruption class (mid-word splits, escaped-vs-raw seams
 * from LLM reconstruction) structurally impossible.
 *
 * Two operations:
 *   - appendBlock(doc, block)            → add content to the end
 *   - replace(doc, oldString, newString) → surgical edit of a single, normalized,
 *                                           uniquely-matched span (fails loud otherwise)
 *
 * Full-document rewrite is intentionally NOT here — that remains the existing
 * PATCH .../issues/:id { description } escape hatch.
 */

// CommonMark's set of backslash-escapable ASCII punctuation. Linear's GraphQL API
// returns descriptions with markdown punctuation backslash-escaped (e.g. `\#\#`,
// `\*\*`), so a span an agent quotes from the rendered text won't byte-match the
// stored body. We normalise both sides — dropping the escaping backslash — so a
// needle matches whether the agent quotes the escaped bytes or the rendered form.
const ESCAPABLE = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(''));

/**
 * Build a normalised (unescaped) view of `text` alongside a span map back to the
 * original. For each normalised character we record where its source sequence
 * begins and ends in the original string — when a backslash-escape is collapsed,
 * the span covers the backslash too, so a match that starts on an escaped
 * character consumes its leading backslash and never leaves a dangling `\`.
 *
 * @param {string} text
 * @returns {{ normalized: string, starts: number[], ends: number[] }}
 */
function buildNormalized(text) {
  let normalized = '';
  const starts = [];
  const ends = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
      // Escape sequence: keep the punctuation, drop the backslash. The mapped
      // span (starts..ends) includes the backslash so replacement consumes it.
      normalized += text[i + 1];
      starts.push(i);
      ends.push(i + 2);
      i++; // consume the escaped punctuation character
      continue;
    }
    normalized += ch;
    starts.push(i);
    ends.push(i + 1);
  }
  return { normalized, starts, ends };
}

/**
 * Return the normalised (backslash-unescaped) form of `text`. Exposed so callers
 * can surface a `descriptionNormalized` alongside the raw escaped body.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeEscaping(text) {
  return buildNormalized(String(text ?? '')).normalized;
}

/**
 * Append a block to the end of a description. The existing body is preserved
 * byte-for-byte; the block is inserted raw (it is intended markdown) after a
 * blank-line separator. An empty/whitespace existing body yields just the block.
 *
 * @param {string} doc - current description (may be null/empty)
 * @param {string} block - new content to append
 * @returns {string} the merged description
 */
export function appendBlock(doc, block) {
  const existing = String(doc ?? '');
  const addition = String(block ?? '');
  if (existing.trim() === '') return addition;
  return `${existing}\n\n${addition}`;
}

/**
 * An edit error that carries a machine-readable code and the candidate count, so
 * a caller can map it to a loud HTTP response instead of a silent no-op.
 */
export class DescriptionEditError extends Error {
  constructor(code, message, matchCount) {
    super(message);
    this.name = 'DescriptionEditError';
    this.code = code; // 'EMPTY_OLD_STRING' | 'NOT_FOUND' | 'NOT_UNIQUE'
    this.matchCount = matchCount;
  }
}

/**
 * Find every start index of `needle` in `haystack` (non-overlapping).
 */
function allIndicesOf(haystack, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + needle.length;
  }
  return out;
}

/**
 * Replace a single occurrence of `oldString` with `newString`. Matching is done
 * on the normalised (backslash-unescaped) form of both the document and the
 * needle, then mapped back to splice the *original* document — so the agent may
 * quote either the escaped bytes from GET or the rendered text.
 *
 * Fails loud (throws DescriptionEditError) when the needle is empty, not found,
 * or matches more than once. There is no silent no-op and no "replace every
 * occurrence" mode — multiple intended matches mean a full rewrite via PATCH.
 *
 * @param {string} doc - current description
 * @param {string} oldString - span to locate (normalised before matching)
 * @param {string} newString - replacement, inserted raw
 * @returns {string} the merged description
 * @throws {DescriptionEditError}
 */
export function replace(doc, oldString, newString) {
  const original = String(doc ?? '');
  const replacement = String(newString ?? '');
  const { normalized, starts, ends } = buildNormalized(original);
  const needle = normalizeEscaping(oldString);

  if (needle === '') {
    throw new DescriptionEditError('EMPTY_OLD_STRING', 'oldString must not be empty', 0);
  }

  const hits = allIndicesOf(normalized, needle);
  if (hits.length === 0) {
    throw new DescriptionEditError(
      'NOT_FOUND',
      'oldString did not match the current description (after unescaping). Re-read the description and quote an exact, unique span — or use PATCH to rewrite the whole body.',
      0
    );
  }
  if (hits.length > 1) {
    throw new DescriptionEditError(
      'NOT_UNIQUE',
      `oldString matched ${hits.length} places; it must match exactly one. Quote a longer, unique span.`,
      hits.length
    );
  }

  const ni = hits[0];
  const origStart = starts[ni];
  const origEnd = ends[ni + needle.length - 1];
  return original.slice(0, origStart) + replacement + original.slice(origEnd);
}
