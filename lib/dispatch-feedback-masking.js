/**
 * Feedback is masked on arrival, before it is stored (LIN-4556, LIN-4508 piece A).
 *
 * `addFeedback` (lib/dispatch-store.js) is the one store method both feedback routes save
 * through (the dispatch-token route in routes/dispatch.js and the runner route in
 * routes/proxy-runner.js), so it calls `maskFeedbackFields` before it builds the entry. A run's
 * words can quote a token; once streamed mid-turn (LIN-4508 piece B) they would otherwise sit in
 * the permanent feedback record and in `GET /api/proxy/dispatch/:id` as posted.
 *
 * What is masked: `message`, `url`, `urlLabel`, each by `maskSecretsInText` (lib/mask-secrets.js,
 * the lib/secret-scan.js rules). A field with no hit is returned as the same string, so a
 * secret-free post stores byte-identically to before. Markers (`[done]`, `[blocked]`, ...) are
 * not secrets and are never touched, so a secret quoted on a `[done]` line is masked and the
 * line still ends the run; a body that is only a secret becomes `[redacted]`, never refused.
 *
 * The chunk boundary. The runner splits a long text into `(assistant-text i/n)` entries
 * (simple-dispatcher `hook.js` postAssistantTextDelta, chunked by `chunk.js` chunkLines): a chunk
 * is `[<label>\n](assistant-text i/n)\n<body>` (the rollback path posts `[<label> ](recap i/n)\n<body>`
 * from the same chunker; both heads are parsed, see `parseChunkHead`), and the bodies rejoin to the source with "\n",
 * except where one line was longer than the chunk and was hard-split mid-line (rejoin with "").
 * A secret cut at that seam matches in neither chunk alone. So for a continuation chunk (i > 1,
 * kind `assistant-text`) the store hands in the previous chunk's body (`previousChunkBodyOf`) and
 * the joined text is scanned too; only ranges reaching into the NEW body are masked (the stored
 * previous entry is never rewritten: the append stays one atomic write).
 *   - Tail bound: the last `CONTINUATION_TAIL_CHARS` (2000) of the previous body. That is the
 *     feedback message cap (MAX_FEEDBACK_MESSAGE_LENGTH, lib/dispatch-feedback-validation.js), so
 *     it is in practice the whole previous chunk. The longest bounded token rule is a GitHub
 *     fine-grained PAT (93 chars); the rules with a long prefix (a PEM header with Proc-Type /
 *     DEK-Info lines, a `curl ... Bearer` line) fit well inside it too, so no prefix a rule needs
 *     is ever cut off. The scan costs one pass over at most ~4000 chars, and only for
 *     continuation chunks.
 *   - A previous chunk whose stored body already ENDS in `[redacted]` had a secret masked up to
 *     the seam, so the joined text no longer shows the secret's start (a PEM cut after its first
 *     body line is masked whole by the truncated-PEM rule in chunk 1, leaving the rest of the
 *     body and the END line in chunk 2). Then the new body is also scanned behind a synthetic
 *     PEM header, which catches a PEM body continuing in this chunk, and when the seam was a
 *     hard split (a one-line previous chunk), the leading run of token characters (the token's
 *     remainder) is masked.
 *   - Accepted misses: a chunk that arrives before its predecessor is stored, or whose
 *     predecessor is gone, is masked on its own (the fallback is today's per-entry masking); the
 *     part of a split secret that sits in the previous chunk is shorter than any full match and
 *     stays as stored there.
 */

import { MASK, maskSecretsInText, secretRangesIn, spliceMask } from './mask-secrets.js';

/** How much of the previous chunk's body is joined to a continuation chunk (see above). */
export const CONTINUATION_TAIL_CHARS = 2000;

// `[<label>\n](assistant-text i/n)\n` — the label is one line with no "(assistant-text" head of its own.
const CHUNK_HEAD_RE = /^(?:([^\n]*)\n)?\(assistant-text (\d+)\/(\d+)\)\n/;
// The runner's rollback path (SD_ASSISTANT_TEXT_RELAY=0, simple-dispatcher hook.js postTurnText)
// posts the same kind of chunk as `[<label> ](recap i/n)\n<chunk>`: the label on the SAME line,
// followed by one space, chunked by the same chunkLines. A distinct head family: a recap chunk only
// continues a recap chunk.
const RECAP_HEAD_RE = /^(?:([^\n]*) )?\(recap (\d+)\/(\d+)\)\n/;
// A PEM header for the synthetic scan; the BEGIN/END variants in the rules are independent alternations.
const SYNTHETIC_PEM_HEAD = '-----BEGIN PRIVATE KEY-----\n';
const TOKEN_REMAINDER_RE = /^[A-Za-z0-9_\-+=/]+/;

/**
 * Parse a chunk head. Returns null for a message that is neither an `(assistant-text i/n)` chunk
 * nor a rollback-path `(recap i/n)` chunk. `family` says which head it was.
 *
 * @param {string} message
 * @returns {{label: string|null, i: number, n: number, bodyStart: number, family: 'assistant-text'|'recap'}|null}
 */
export function parseChunkHead(message) {
  if (typeof message !== 'string') return null;
  for (const [family, re] of [['assistant-text', CHUNK_HEAD_RE], ['recap', RECAP_HEAD_RE]]) {
    const m = re.exec(message);
    if (!m) continue;
    const i = Number(m[2]);
    const n = Number(m[3]);
    if (!(i >= 1 && n >= i)) return null;
    return { label: m[1] ?? null, i, n, bodyStart: m[0].length, family };
  }
  return null;
}

/**
 * Is this post a continuation chunk (needs the previous chunk's body to be masked fully)?
 * Every other post takes no extra read.
 *
 * @param {{message: string, kind?: string}} feedback
 * @returns {boolean}
 */
export function isContinuationChunk({ message, kind }) {
  if (kind !== 'assistant-text') return false;
  const head = parseChunkHead(message);
  return !!head && head.i > 1;
}

/**
 * The body of chunk i-1 of the same text, searched newest first among the row's stored entries:
 * kind `assistant-text`, same head family (`assistant-text` or `recap`), same label, same n,
 * index i-1. Null when it is not there (out of order
 * or gone), which leaves the new chunk masked on its own.
 *
 * @param {Array<{message?: string, kind?: string}>|undefined} feedback - the row's stored entries
 * @param {string} message - the new chunk
 * @returns {string|null}
 */
export function previousChunkBodyOf(feedback, message) {
  const head = parseChunkHead(message);
  if (!head || head.i < 2 || !Array.isArray(feedback)) return null;
  for (let k = feedback.length - 1; k >= 0; k--) {
    const entry = feedback[k];
    if (entry?.kind !== 'assistant-text') continue;
    const prev = parseChunkHead(entry.message);
    if (prev && prev.family === head.family && prev.n === head.n && prev.i === head.i - 1 && prev.label === head.label) {
      return entry.message.slice(prev.bodyStart);
    }
  }
  return null;
}

/** Ranges of `scanText` that reach past `offset`, clipped to it and shifted by `-offset + base`. */
function rangesPast(scanText, offset, base) {
  const out = [];
  for (const r of secretRangesIn(scanText)) {
    if (r.end <= offset) continue;
    out.push([base + Math.max(r.start - offset, 0), base + (r.end - offset)]);
  }
  return out;
}

/**
 * Mask a continuation chunk's message, its own hits plus whatever the seam with the previous
 * chunk reveals in its body.
 */
function maskContinuation(message, previousChunkBody) {
  const head = parseChunkHead(message);
  const ranges = secretRangesIn(message).map((r) => [r.start, r.end]);
  const base = head.bodyStart;
  const body = message.slice(base);
  const tail = previousChunkBody.slice(-CONTINUATION_TAIL_CHARS);
  // A one-line previous chunk may be a hard split mid-line: join with "" as well as "\n".
  const oneLine = !previousChunkBody.includes('\n');
  for (const sep of oneLine ? ['\n', ''] : ['\n']) {
    ranges.push(...rangesPast(tail + sep + body, tail.length + sep.length, base));
  }
  if (previousChunkBody.endsWith(MASK)) {
    ranges.push(...rangesPast(SYNTHETIC_PEM_HEAD + body, SYNTHETIC_PEM_HEAD.length, base));
    const rest = oneLine ? TOKEN_REMAINDER_RE.exec(body) : null;
    if (rest) ranges.push([base, base + rest[0].length]);
  }
  return spliceMask(message, ranges);
}

/**
 * Mask a feedback post's text fields before the entry is built.
 *
 * @param {{message: string, url?: string|null, urlLabel?: string|null}} fields
 * @param {{previousChunkBody?: string|null}} [opts] - set by the store for a continuation chunk
 * @returns {{message: string, url: string|null|undefined, urlLabel: string|null|undefined}}
 *   each field the same value as given when it held no secret
 */
export function maskFeedbackFields({ message, url, urlLabel }, { previousChunkBody = null } = {}) {
  const maskedMessage = typeof previousChunkBody === 'string' && parseChunkHead(message)
    ? maskContinuation(message, previousChunkBody)
    : maskSecretsInText(message).text;
  return {
    message: maskedMessage,
    url: typeof url === 'string' ? maskSecretsInText(url).text : url,
    urlLabel: typeof urlLabel === 'string' ? maskSecretsInText(urlLabel).text : urlLabel
  };
}
