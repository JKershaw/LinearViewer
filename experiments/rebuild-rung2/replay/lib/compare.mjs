// HTML normalisation, embedded-JSON extraction/deep-compare, and the
// structural signature of the first difference.

const RAW_RE = /(<(script|pre|textarea|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;
const DATA_RE = /<script>\s*window\.__ROADMAP_DATA__\s*=\s*([\s\S]*?);?\s*<\/script>/;
export const DATA_PLACEHOLDER = '<script>window.__ROADMAP_DATA__ = /*compared separately*/;</script>';

/**
 * mode 'collapse' (default): every whitespace run outside <pre>/<textarea>/
 *   <script>/<style> content becomes ONE space; whitespace between tags is kept
 *   (as one space), so a space-vs-none difference still counts.
 * mode 'between-tags': only whitespace runs strictly between `>` and `<` are
 *   removed; everything else is byte-exact.
 */
export function normalizeHtml(html, mode = 'collapse') {
  if (mode === 'between-tags') return html.replace(/>\s+</g, '><').trim();
  let out = '';
  let last = 0;
  const collapse = s => s.replace(/\s+/g, ' ');
  for (const m of html.matchAll(RAW_RE)) {
    out += collapse(html.slice(last, m.index)) + collapse(m[1]) + m[3] + m[4];
    last = m.index + m[0].length;
  }
  out += collapse(html.slice(last));
  return out.trim();
}

/** Pull the embedded client payload out; return { html, json, jsonError }. */
export function extractData(html) {
  const m = html.match(DATA_RE);
  if (!m) return { html, json: undefined, present: false };
  let json; let jsonError = null;
  try { json = JSON.parse(m[1]); } catch (e) { jsonError = e.message; }
  return { html: html.slice(0, m.index) + DATA_PLACEHOLDER + html.slice(m.index + m[0].length), json, jsonError, present: true };
}

/** Key-order-insensitive deep diff; returns first differing path or null. */
export function jsonDiff(a, b, path = '$') {
  if (Object.is(a, b)) return null;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) return { path, kind: 'type', old: brief(a), new: brief(b) };
  if (ta === 'array') {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const d = jsonDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    if (a.length !== b.length) return { path: `${path}.length`, kind: 'length', old: a.length, new: b.length };
    return null;
  }
  if (ta === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in a)) return { path: `${path}.${k}`, kind: 'added', old: undefined, new: brief(b[k]) };
      if (!(k in b)) return { path: `${path}.${k}`, kind: 'removed', old: brief(a[k]), new: undefined };
      const d = jsonDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return { path, kind: 'value', old: brief(a), new: brief(b) };
}
function brief(v) { const s = JSON.stringify(v); return s && s.length > 120 ? s.slice(0, 117) + '...' : s; }

// ---------------------------------------------------------------------------
// Structural context of a character offset: open-element path + where in the
// token the offset sits (tag name, which attribute, text, comment, raw script).
// ---------------------------------------------------------------------------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'pre']);
const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

function describeEl(tag, attrs) {
  const cls = (attrs.match(/\bclass\s*=\s*"([^"]*)"/) || [])[1];
  const id = (attrs.match(/\bid\s*=\s*"([^"]*)"/) || [])[1];
  const testid = (attrs.match(/\bdata-testid\s*=\s*"([^"]*)"/) || [])[1];
  let s = tag;
  if (id) s += `#${id}`;
  if (cls) s += cls.trim().split(/\s+/).slice(0, 3).map(c => `.${c}`).join('');
  if (testid && !id) s += `[testid=${testid}]`;
  return s;
}

export function contextAt(html, idx) {
  const stack = [];
  let i = 0;
  const pathStr = () => stack.slice(-6).map(e => e.desc).join(' > ') || '(root)';
  while (i < html.length) {
    if (html[i] === '<') {
      let end; let kind;
      if (html.startsWith('<!--', i)) { end = html.indexOf('-->', i); end = end < 0 ? html.length : end + 3; kind = 'comment'; }
      else if (html.startsWith('<!', i)) { end = html.indexOf('>', i) + 1 || html.length; kind = 'doctype'; }
      else if (html[i + 1] === '/') { end = html.indexOf('>', i) + 1 || html.length; kind = 'close'; }
      else if (/[a-zA-Z]/.test(html[i + 1] || '')) { end = html.indexOf('>', i) + 1 || html.length; kind = 'open'; }
      else { end = i + 1; kind = 'text'; }
      if (kind === 'text') { if (idx < end) return { path: pathStr(), where: '#text' }; i = end; continue; }
      const tagText = html.slice(i, end);
      if (kind === 'open') {
        const tag = (tagText.match(/^<([a-zA-Z0-9-]+)/) || [])[1].toLowerCase();
        const desc = describeEl(tag, tagText);
        if (idx < end) {
          if (idx === i) return { path: pathStr(), where: `^<${desc}>` };
          const off = idx - i;
          if (off <= tag.length + 1) return { path: pathStr(), where: `<${tag}> tag-name` };
          ATTR_RE.lastIndex = tag.length + 1;
          let m; let attr = '(markup)';
          while ((m = ATTR_RE.exec(tagText))) { if (off >= m.index && off <= m.index + m[0].length) { attr = m[1]; break; } }
          return { path: `${pathStr()} > ${desc}`, where: `@${attr}` };
        }
        i = end;
        if (RAW.has(tag) && !tagText.endsWith('/>')) {
          const close = html.toLowerCase().indexOf(`</${tag}`, i);
          const rawEnd = close < 0 ? html.length : close;
          if (idx < rawEnd) {
            const body = html.slice(i, rawEnd);
            const what = tag === 'script' && body.includes('__ROADMAP_DATA__') ? 'roadmap-data' : tag === 'script' && body.includes('theme') ? 'theme-prepaint' : 'raw';
            return { path: `${pathStr()} > ${desc}`, where: `#${tag}-content(${what})` };
          }
          stack.push({ tag, desc });
          i = rawEnd;
          continue;
        }
        if (!VOID.has(tag) && !tagText.endsWith('/>')) stack.push({ tag, desc });
        continue;
      }
      if (idx < end) {
        if (idx === i) return { path: pathStr(), where: kind === 'close' ? `^</${(tagText.match(/^<\/([a-zA-Z0-9-]+)/) || [])[1]}>` : `^${kind}` };
        return { path: pathStr(), where: `#${kind}` };
      }
      if (kind === 'close') {
        const tag = (tagText.match(/^<\/([a-zA-Z0-9-]+)/) || [])[1]?.toLowerCase();
        const at = stack.map(e => e.tag).lastIndexOf(tag);
        if (at >= 0) stack.length = at;
      }
      i = end;
    } else {
      const next = html.indexOf('<', i);
      const end = next < 0 ? html.length : next;
      if (idx < end) return { path: pathStr(), where: '#text' };
      i = end;
    }
  }
  return { path: pathStr(), where: '^EOF' };
}

function excerpt(s, idx, r = 70) {
  const a = Math.max(0, idx - r);
  return (a > 0 ? '…' : '') + s.slice(a, idx) + '⟦' + s.slice(idx, idx + r) + (idx + r < s.length ? '…' : '');
}

/** Compare two normalized HTML strings; null if equal. */
export function htmlDiff(a, b) {
  if (a === b) return null;
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  let sa = a.length; let sb = b.length;
  while (sa > i && sb > i && a.charCodeAt(sa - 1) === b.charCodeAt(sb - 1)) { sa--; sb--; }
  const co = contextAt(a, i);
  const cn = contextAt(b, i);
  const ctxSig = (c) => `${c.path} :: ${c.where}`;
  const signature = ctxSig(co) === ctxSig(cn) ? ctxSig(co) : `${ctxSig(co)}  ⇄  ${ctxSig(cn)}`;
  return {
    offset: i,
    signature,
    coarseSignature: ctxSig(co),
    lastDiffContext: ctxSig(contextAt(a, Math.max(i, sa - 1))),
    changedSpan: { old: sa - i, new: sb - i },
    before: excerpt(a, i),
    after: excerpt(b, i)
  };
}

/** Full comparison of one render pair. */
export function comparePair(oldRes, newRes, normMode) {
  if (oldRes.threw || newRes.threw) {
    const so = oldRes.threw ? `${oldRes.error.name}: ${oldRes.error.message}` : null;
    const sn = newRes.threw ? `${newRes.error.name}: ${newRes.error.message}` : null;
    if (so && sn && so === sn) return { equal: true, bothThrew: so };
    const strip = s => s && s.replace(/\d+/g, 'N').slice(0, 160);
    const signature = so && sn ? `THROW both, differently: old ${strip(so)} | new ${strip(sn)}`
      : so ? `THROW old only: ${strip(so)}` : `THROW new only: ${strip(sn)}`;
    return { equal: false, kind: 'throw', signature, old: so, new: sn };
  }
  const eo = extractData(normalizeHtml(oldRes.html, normMode));
  const en = extractData(normalizeHtml(newRes.html, normMode));
  const h = htmlDiff(eo.html, en.html);
  let j = null;
  if (eo.present !== en.present) j = { path: '$', kind: eo.present ? 'removed' : 'added' };
  else if (eo.present) {
    if (eo.jsonError || en.jsonError) j = eo.jsonError === en.jsonError ? null : { path: '$', kind: 'parse', old: eo.jsonError, new: en.jsonError };
    else j = jsonDiff(eo.json, en.json);
  }
  if (!h && !j) return { equal: true };
  const jsonSig = j ? `__ROADMAP_DATA__ ${j.path.replace(/\[\d+\]/g, '[]')} (${j.kind})` : null;
  return {
    equal: false,
    kind: h && j ? 'html+json' : h ? 'html' : 'json',
    signature: h ? h.signature : jsonSig,
    coarseSignature: h ? h.coarseSignature : jsonSig,
    html: h,
    json: j ? { ...j, signature: jsonSig } : null
  };
}
