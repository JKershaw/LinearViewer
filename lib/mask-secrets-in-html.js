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
 *   masking cannot damage tag structure. One exception (LIN-3796): text
 *   segments separated only by `<br>` tags are scanned as one run joined by
 *   "\n", and a decoded literal `<br>` (markdown source escaped to `&lt;br&gt;`)
 *   is scanned as "\n" too, so a PEM split across lines is still masked. The
 *   hit is spliced back per segment, so the `<br>` tags themselves survive.
 *   This lives here, not in `isPlaceholder`, so other `scanText` consumers
 *   are unaffected.
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

const BR_RE = /<br(?:[\s/][^<>]*)?>/gi;

/**
 * LIN-3796: replace each decoded literal `<br ...>` in `d.text` with one "\n"
 * (mapped to the span of the whole tag), so the `<…>` placeholder filter in
 * `findSecretMatches` no longer swallows a PEM that crosses a line break.
 */
function foldBr(d) {
  if (!d.text.includes('<')) return d;
  BR_RE.lastIndex = 0;
  if (!BR_RE.test(d.text)) return d;
  BR_RE.lastIndex = 0;
  const { text: src, offset } = d;
  const sf = d.from ? (k) => d.from[k] : (k) => offset + k;
  const st = d.to ? (k) => d.to[k] : (k) => offset + k + 1;
  let text = '';
  const from = [];
  const to = [];
  let pos = 0;
  const push = (k) => { from.push(sf(k)); to.push(st(k)); text += src[k]; };
  let m;
  while ((m = BR_RE.exec(src)) !== null) {
    for (; pos < m.index; pos++) push(pos);
    from.push(sf(m.index));
    to.push(st(m.index + m[0].length - 1));
    text += '\n';
    pos = m.index + m[0].length;
  }
  for (; pos < src.length; pos++) push(pos);
  return { text, from, to, offset };
}

/**
 * Collect the scannable `[start, end)` segments of an HTML string. A third
 * element marks what a segment is for run-joining (LIN-3796): `'text'` is
 * joinable, `'br'` is a `<br>` tag between joinable segments, `'break'` is any
 * other markup (ends a run). Unmarked segments (attribute values, comment
 * bodies) are scanned alone and never end or join a run, except that the
 * attribute values of a non-`<br>` tag sit behind its `'break'`.
 */
function segmentsOf(html) {
  const segs = [];
  const solo = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) segs.push([i, textEnd, 'text']);
    if (lt === -1) break;
    i = lt;

    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4);
      const bodyEnd = close === -1 ? n : close;
      segs.push([i, i, 'break']);
      if (bodyEnd > i + 4) segs.push([i + 4, bodyEnd]);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (!/[a-zA-Z\/!?]/.test(html[i + 1] || '')) {
      // A literal '<' that opens no tag: it is text; the next loop scans onward.
      segs.push([i, i + 1, 'text']);
      i += 1;
      continue;
    }

    // A tag: walk to its closing '>', honouring quotes, collecting attribute values.
    const nameMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i, i + 40));
    const isBr = !!nameMatch && !nameMatch[1] && nameMatch[2].toLowerCase() === 'br';
    // Attribute values of a <br> must not sit between the text around it.
    const attrs = isBr ? solo : segs;
    if (!isBr) segs.push([i, i, 'break']);
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
          if (valEnd > j + 1) attrs.push([j + 1, valEnd]);
          j = close === -1 ? n : close + 1;
        } else {
          const vs = j;
          while (j < n && !/[\s>]/.test(html[j])) j++;
          if (j > vs) attrs.push([vs, j]);
        }
        continue;
      }
      j++;
    }
    i = j < n ? j + 1 : n;
    if (isBr) segs.push([i, i, 'br']);

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
  return segs.concat(solo);
}

/**
 * @param {string} html
 * @returns {{ html: string, hits: string[] }}
 */
export function maskSecretsInHtml(html) {
  if (typeof html !== 'string' || html.length === 0) return { html, hits: [] };

  const ranges = [];
  const hits = new Set();
  const scan = ({ text, from, to, offset }) => {
    if (text.length < 8) return;
    for (const m of findSecretMatches(text)) {
      if (m.length === 0) continue;
      const last = m.index + m.length - 1;
      if (!from) {
        ranges.push([offset + m.index, offset + m.index + m.length]);
      } else {
        // Split at join "\n"s (from === -1) so a hit spanning <br>s masks each
        // segment's piece and leaves the tags between them alone.
        let k = m.index;
        while (k <= last) {
          if (from[k] === -1) { k++; continue; }
          let e = k;
          while (e < last && from[e + 1] !== -1) e++;
          ranges.push([from[k], to[e]]);
          k = e + 1;
        }
      }
      hits.add(m.ruleId);
    }
  };

  // A run is the text segments between non-<br> markup, joined by "\n" across <br>s.
  let run = [];
  const flush = () => {
    while (run.length && run[run.length - 1].br) run.pop();
    if (run.length === 1) scan(foldBr(decodeWithMap(html, run[0][0], run[0][1])));
    else if (run.length > 1) {
      let text = '';
      const from = [];
      const to = [];
      for (const r of run) {
        if (r.br) { text += '\n'; from.push(-1); to.push(-1); continue; }
        const d = foldBr(decodeWithMap(html, r[0], r[1]));
        text += d.text;
        for (let k = 0; k < d.text.length; k++) {
          from.push(d.from ? d.from[k] : d.offset + k);
          to.push(d.to ? d.to[k] : d.offset + k + 1);
        }
      }
      scan({ text, from, to, offset: 0 });
    }
    run = [];
  };
  for (const seg of segmentsOf(html)) {
    const kind = seg[2];
    if (kind === 'text') run.push(seg);
    else if (kind === 'br') { if (run.length) run.push({ br: true }); }
    else {
      if (kind === 'break') flush();
      else scan(foldBr(decodeWithMap(html, seg[0], seg[1])));
    }
  }
  flush();
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
