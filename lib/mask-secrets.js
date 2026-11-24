/**
 * Plain-text secret masking over the `lib/secret-scan.js` rules (LIN-4556, LIN-4508 piece A).
 *
 * The one place a text's secret hits become `[redacted]`. Two callers today:
 *   - `maskSecretsInHtml` (`lib/mask-secrets-in-html.js`, render-time masking of shared task
 *     pages) maps decoded HTML text back to source offsets and then uses `secretRangesIn`
 *     and `spliceMask` from here, so the HTML path and the plain-text path cannot drift
 *     (pinned byte-identical by tests/unit/lin-4556-mask-html-golden.test.js);
 *   - feedback intake (`lib/dispatch-feedback-masking.js`, called from `addFeedback`), which
 *     masks a run's words before they are stored.
 * `maskSecretsInText` is exported by name so a reader can mask rows stored before intake
 * masking existed (LIN-4508 piece E).
 *
 * Rules: every `findSecretMatches` hit is masked; overlapping or touching ranges collapse
 * into one `[redacted]`; no hit returns the SAME string (a clean text is byte-for-byte
 * unchanged); `hits` holds rule ids only, never matched text.
 */

import { findSecretMatches } from './secret-scan.js';

export const MASK = '[redacted]';

/**
 * Every secret hit in `text` as a `[start, end)` range with its rule id, in rule order.
 * Zero-length matches are dropped.
 *
 * @param {string} text
 * @returns {Array<{start: number, end: number, ruleId: string}>}
 */
export function secretRangesIn(text) {
  const out = [];
  for (const m of findSecretMatches(text)) {
    if (m.length === 0) continue;
    out.push({ start: m.index, end: m.index + m.length, ruleId: m.ruleId });
  }
  return out;
}

/**
 * Splice one `MASK` over each merged range of `src`. Ranges may overlap, touch or arrive in
 * any order; they are merged first. No ranges returns `src` itself.
 *
 * @param {string} src
 * @param {Array<[number, number]>} ranges - `[start, end)` offsets into `src`
 * @returns {string}
 */
export function spliceMask(src, ranges) {
  if (ranges.length === 0) return src;
  const sorted = ranges.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let out = '';
  let pos = 0;
  for (const [s, e] of merged) {
    out += src.slice(pos, s) + MASK;
    pos = e;
  }
  out += src.slice(pos);
  return out;
}

/**
 * Mask every secret in a plain text.
 *
 * @param {string} text
 * @returns {{ text: string, hits: string[] }} `text` is the input itself when nothing matched
 */
export function maskSecretsInText(text) {
  if (typeof text !== 'string' || text.length === 0) return { text, hits: [] };
  const found = secretRangesIn(text);
  if (found.length === 0) return { text, hits: [] };
  return {
    text: spliceMask(text, found.map((r) => [r.start, r.end])),
    hits: [...new Set(found.map((r) => r.ruleId))]
  };
}
