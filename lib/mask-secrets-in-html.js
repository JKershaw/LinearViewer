/**
 * Render-time secret masking for served HTML (LIN-3389).
 *
 * `maskSecretsInHtml(html)` runs the `lib/secret-scan.js` rules over the text a
 * browser would show (text nodes, quoted attribute values, comment bodies),
 * after decoding entities, and splices `[redacted]` over every hit in the
 * ORIGINAL string. Runtime text reaches the page through `escapeHtml`, so a
 * raw-HTML scan misses quote-dependent rules; decoding is the point of this
 * module.
 *
 * - `<script>` / `<style>` bodies are not scanned (static; masking our own JS
 *   would break the page).
 * - Each segment is scanned on its own, so a hit can never span markup and
 *   masking cannot damage tag structure.
 * - A hit that starts or ends inside an entity takes the whole entity.
 * - Overlapping or touching ranges collapse into one `[redacted]`.
 * - No hit returns the SAME string, so a clean page is byte-for-byte unchanged.
 * - `hits` holds rule ids only, never matched text.
 */

import { findSecretMatches } from './secret-scan.js';

export const MASK = '[redacted]';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const ENTITY_RE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/y;

/**
 * Decode `src[start, end)` into text, recording for each decoded UTF-16 unit
 * the source span `[from, to)` it came from.
 */
function decodeWithMap(src, start, end) {
  const raw = src.slice(start, end);
  if (!raw.includes('&')) return { text: raw, from: null, to: null, offset: start };
  let text = '';
  const from = [];
  const to = [];
  let i = start;
  while (i < end) {
    if (src[i] === '&') {
      ENTITY_RE.lastIndex = i;
      const m = ENTITY_RE.exec(src);
      if (m && m.index + m[0].length <= end) {
        let decoded = null;
        if (m[3]) decoded = NAMED[m[3]];
        else {
          const cp = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2], 16);
          if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) decoded = String.fromCodePoint(cp);
        }
        if (decoded !== null) {
          const stop = i + m[0].length;
          for (let k = 0; k < decoded.length; k++) { from.push(i); to.push(stop); }
          text += decoded;
          i = stop;
          continue;
        }
      }
    }
    from.push(i);
    to.push(i + 1);
    text += src[i];
    i++;
  }
  return { text, from, to, offset: start };
}

/** Collect the scannable `[start, end)` segments of an HTML string. */
function segmentsOf(html) {
  const segs = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) segs.push([i, textEnd]);
    if (lt === -1) break;
    i = lt;

    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4);
      const bodyEnd = close === -1 ? n : close;
      if (bodyEnd > i + 4) segs.push([i + 4, bodyEnd]);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (!/[a-zA-Z\/!?]/.test(html[i + 1] || '')) {
      // A literal '<' that opens no tag: it is text; the next loop scans onward.
      segs.push([i, i + 1]);
      i += 1;
      continue;
    }

    // A tag: walk to its closing '>', honouring quotes, collecting attribute values.
    const nameMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i, i + 40));
    let j = i + 1;
    while (j < n && html[j] !== '>') {
      const ch = html[j];
      if (ch === '=') {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          const valEnd = close === -1 ? n : close;
          if (valEnd > j + 1) segs.push([j + 1, valEnd]);
          j = close === -1 ? n : close + 1;
        } else {
          const vs = j;
          while (j < n && !/[\s>]/.test(html[j])) j++;
          if (j > vs) segs.push([vs, j]);
        }
        continue;
      }
      j++;
    }
    i = j < n ? j + 1 : n;

    // Skip the body of <script>/<style> (not scanned).
    if (nameMatch && !nameMatch[1]) {
      const tag = nameMatch[2].toLowerCase();
      if (tag === 'script' || tag === 'style') {
        const closeRe = new RegExp(`</${tag}[\\s>/]`, 'i');
        const m = closeRe.exec(html.slice(i));
        i = m ? i + m.index : n;
      }
    }
  }
  return segs;
}

/**
 * @param {string} html
 * @returns {{ html: string, hits: string[] }}
 */
export function maskSecretsInHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return { html, hits: [] };

  const ranges = [];
  const hits = new Set();
  for (const [start, end] of segmentsOf(html)) {
    const { text, from, to, offset } = decodeWithMap(html, start, end);
    if (text.length < 8) continue;
    for (const m of findSecretMatches(text)) {
      if (m.length === 0) continue;
      const last = m.index + m.length - 1;
      ranges.push(from ? [from[m.index], to[last]] : [offset + m.index, offset + m.index + m.length]);
      hits.add(m.ruleId);
    }
  }
  if (ranges.length === 0) return { html, hits: [] };

  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of ranges) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let out = '';
  let pos = 0;
  for (const [s, e] of merged) {
    out += html.slice(pos, s) + MASK;
    pos = e;
  }
  out += html.slice(pos);
  return { html: out, hits: [...hits] };
}
