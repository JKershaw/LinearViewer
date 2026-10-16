// A small, tolerant HTML tokenizer + tree builder (no dependency available
// offline), plus the normalised DOM used for the structural comparison.
//
// Both versions' output goes through the same parser, so any parser
// imprecision is symmetric. It models what matters for server-rendered markup:
// void elements, raw-text elements (script/style) and RCDATA (textarea/title),
// entity decoding in text and attribute values, duplicate attributes (first
// wins, like a browser; duplicates are recorded), stray end tags (ignored,
// recorded), and the common implicit closes (li, option, p, dt/dd, tr/td/th).

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param', 'keygen']);
const RAW = new Set(['script', 'style']);
const RCDATA = new Set(['textarea', 'title']);
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const PRESERVE_WS = new Set(['pre', 'textarea', 'script', 'style']);

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', rarr: '→', larr: '←', uarr: '↑', darr: '↓', middot: '·',
  times: '×', copy: '©', reg: '®', bull: '•', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', check: '✓', para: '¶',
  sect: '§', deg: '°', plusmn: '±', trade: '™', ensp: ' ', emsp: ' ', thinsp: ' '
};

export function decodeEntities(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp > 0x10ffff) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : m;
  });
}

/**
 * Tokenise one start tag from `html[pos]` (just after `<tagname`) the way the
 * HTML spec's tokenizer does: quotes only open a value right after `=`; a
 * quote elsewhere is part of an attribute name (a parse error, not a value).
 * Returns { attrs, dups, end (index after '>'), selfClosing }.
 */
function scanTag(html, pos) {
  const n = html.length;
  const attrs = []; const seen = new Set(); const dups = [];
  let i = pos; let selfClosing = false;
  const ws = c => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  const push = (name, raw) => {
    name = name.toLowerCase();
    if (seen.has(name)) { dups.push(name); return; }
    seen.add(name);
    attrs.push([name, raw === undefined ? '' : decodeEntities(raw)]);
  };
  while (i < n) {
    while (i < n && ws(html[i])) i++;
    if (i >= n) break;
    if (html[i] === '>') { i++; return { attrs, dups, end: i, selfClosing }; }
    if (html[i] === '/') { i++; selfClosing = html[i] === '>'; continue; }
    // attribute name (first char may be '=', per spec)
    let j = i + 1;
    while (j < n && !ws(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') j++;
    const name = html.slice(i, j);
    i = j;
    let k = i;
    while (k < n && ws(html[k])) k++;
    if (html[k] !== '=') { push(name, undefined); i = k; continue; }
    k++;
    while (k < n && ws(html[k])) k++;
    let raw;
    if (html[k] === '"' || html[k] === "'") {
      const q = html[k];
      const close = html.indexOf(q, k + 1);
      const e = close < 0 ? n : close;
      raw = html.slice(k + 1, e);
      i = close < 0 ? n : close + 1;
    } else {
      let e = k;
      while (e < n && !ws(html[e]) && html[e] !== '>') e++;
      raw = html.slice(k, e);
      i = e;
    }
    push(name, raw);
  }
  return { attrs, dups, end: n, selfClosing };
}

/** Parse to { type:'root', children, warnings }. */
export function parseHtml(html) {
  const root = { type: 'root', children: [] };
  const warnings = [];
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const closeTo = (tag) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) { stack.length = i; return true; }
    }
    return false;
  };
  const implicitClose = (tag) => {
    const cur = top();
    if (!cur.tag) return;
    if (tag === 'li' && stack.some(e => e.tag === 'li') && cur.tag === 'li') stack.pop();
    else if (tag === 'option' && cur.tag === 'option') stack.pop();
    else if ((tag === 'dt' || tag === 'dd') && (cur.tag === 'dt' || cur.tag === 'dd')) stack.pop();
    else if ((tag === 'td' || tag === 'th') && (cur.tag === 'td' || cur.tag === 'th')) stack.pop();
    else if (tag === 'tr' && cur.tag === 'tr') stack.pop();
    if (P_CLOSERS.has(tag) && top().tag === 'p') { stack.pop(); }
  };
  let i = 0;
  const n = html.length;
  let textStart = 0;
  const flushText = (end) => {
    if (end > textStart) top().children.push({ type: 'text', value: decodeEntities(html.slice(textStart, end)) });
  };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    const c = html[lt + 1];
    if (html.startsWith('<!--', lt)) {
      flushText(lt);
      let end = html.indexOf('-->', lt + 4);
      if (end < 0) { warnings.push('unterminated comment'); end = n; }
      top().children.push({ type: 'comment', value: html.slice(lt + 4, end) });
      i = textStart = Math.min(n, end + 3);
      continue;
    }
    if (c === '!' || c === '?') {
      flushText(lt);
      const end = html.indexOf('>', lt);
      top().children.push({ type: 'doctype', value: html.slice(lt + 2, end < 0 ? n : end).trim().toLowerCase() });
      i = textStart = end < 0 ? n : end + 1;
      continue;
    }
    if (c === '/') {
      const m = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>/.exec(html.slice(lt, lt + 80));
      if (!m) { i = lt + 1; continue; }
      flushText(lt);
      const tag = m[1].toLowerCase();
      if (!closeTo(tag)) warnings.push(`stray </${tag}>`);
      i = textStart = lt + m[0].length;
      continue;
    }
    if (!/[A-Za-z]/.test(c || '')) { i = lt + 1; continue; }
    // start tag, tokenised per the HTML spec (see scanTag)
    flushText(lt);
    const tm = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(lt, lt + 64));
    const tag = tm[1].toLowerCase();
    const { attrs, dups, end: tagEnd, selfClosing } = scanTag(html, lt + tm[0].length);
    if (dups.length) warnings.push(`duplicate attribute(s) ${dups.slice(0, 8).join(',')} on <${tag}>`);
    implicitClose(tag);
    const el = { type: 'el', tag, attrs, children: [] };
    if (dups.length) el.dupAttrs = dups;
    top().children.push(el);
    i = textStart = tagEnd;
    if (VOID.has(tag)) continue;
    if (RAW.has(tag) || RCDATA.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      const end = close < 0 ? n : close;
      const body = html.slice(i, end);
      el.children.push({ type: 'text', value: RCDATA.has(tag) ? decodeEntities(body) : body, raw: true });
      const gt = close < 0 ? n : html.indexOf('>', close);
      i = textStart = gt < 0 ? n : gt + 1;
      if (close < 0) warnings.push(`unterminated <${tag}>`);
      continue;
    }
    void selfClosing; // '/>' on a non-void HTML element is ignored, as in a browser
    stack.push(el);
  }
  flushText(n);
  if (stack.length > 1) warnings.push(`unclosed: ${stack.slice(1).map(e => e.tag).join('>')}`);
  root.warnings = warnings;
  return root;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------
const EMBED_RE = /^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);?\s*$/;

export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function canonAttrValue(name, value) {
  if (name === 'class') return [...new Set(value.split(/\s+/).filter(Boolean))].sort().join(' ');
  if (name === 'style') return value.replace(/\s+/g, ' ').replace(/\s*([:;])\s*/g, '$1').replace(/;$/, '').trim();
  const t = value.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return 'json:' + canonicalJson(JSON.parse(t)); } catch { /* not JSON */ }
  }
  return value;
}

/** The embedded `window.X = <json>` payload of a script, or null. */
export function embeddedPayload(scriptText) {
  const m = EMBED_RE.exec(scriptText);
  if (!m) return null;
  try { return { globalVar: m[1], value: JSON.parse(m[2]), raw: m[2] }; } catch { return null; }
}

/**
 * Normalised tree: whitespace-only text dropped (outside pre/textarea/script/
 * style), text whitespace collapsed+trimmed, attributes decoded/sorted, class
 * tokens sorted, JSON attribute values canonical, embedded window.X JSON
 * canonical, comments trimmed.
 */
export function normalizeTree(node, inPre = false) {
  if (node.type === 'text') {
    if (node.raw || inPre) return { type: 'text', value: node.value };
    const v = node.value.replace(/[ \t\n\r\f]+/g, ' ').trim();
    return v ? { type: 'text', value: v } : null;
  }
  if (node.type === 'comment') return { type: 'comment', value: node.value.trim() };
  if (node.type === 'doctype') return { type: 'doctype', value: node.value };
  const pre = inPre || (node.tag && PRESERVE_WS.has(node.tag));
  const out = { type: node.type, tag: node.tag, children: [] };
  if (node.attrs) out.attrs = node.attrs.map(([k, v]) => [k, canonAttrValue(k, v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (node.dupAttrs) out.dupAttrs = node.dupAttrs;
  let prevText = null;
  for (const ch of node.children) {
    const c = normalizeTree(ch, pre);
    if (!c) continue;
    if (c.type === 'text' && prevText && !pre) { prevText.value += ' ' + c.value; continue; }
    out.children.push(c);
    prevText = c.type === 'text' ? c : null;
  }
  if (node.tag === 'script' && out.children.length === 1) {
    const p = embeddedPayload(out.children[0].value);
    out.children[0] = p ? { type: 'text', value: `window.${p.globalVar}=` + canonicalJson(p.value), embedded: p.globalVar } : { type: 'text', value: out.children[0].value.replace(/\s+/g, ' ').trim() };
  }
  return out;
}

export function serializeNorm(node) {
  if (node.type === 'text') return `"${node.value}"`;
  if (node.type === 'comment') return `<!--${node.value}-->`;
  if (node.type === 'doctype') return `<!${node.value}>`;
  const kids = node.children.map(serializeNorm).join('');
  if (node.type === 'root') return kids;
  const attrs = (node.attrs || []).map(([k, v]) => ` ${k}=${JSON.stringify(v)}`).join('');
  return `<${node.tag}${attrs}>${kids}</${node.tag}>`;
}

export function describeEl(el) {
  if (!el || el.type !== 'el') return el?.type === 'root' ? '(root)' : String(el?.type);
  const a = Object.fromEntries(el.attrs || []);
  let s = el.tag;
  if (a.id) s += `#${a.id}`;
  if (a.class) s += a.class.split(/\s+/).filter(Boolean).slice(0, 3).map(c => `.${c}`).join('');
  if (a['data-testid']) s += `[testid=${a['data-testid'].replace(/^json:/, '')}]`;
  else if (a['data-toggle']) s += `[toggle=${a['data-toggle']}]`;
  else if (a['data-content']) s += `[content=${a['data-content']}]`;
  return s;
}

/** Iterate elements depth-first with their ancestor chain. */
export function* walkElements(node, ancestors = []) {
  for (const ch of node.children || []) {
    if (ch.type !== 'el') continue;
    yield [ch, ancestors];
    yield* walkElements(ch, [...ancestors, ch]);
  }
}
