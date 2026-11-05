/**
 * The one fake DOM for client unit tests (LIN-4252). Client code (`public/prompt-section.js`, `public/question-cards.js`)
 * runs in a vm sandbox against a real node tree: node identity is kept, `innerHTML` and `outerHTML` serialize the way a
 * browser does, `outerHTML =` and `replaceWith` swap real nodes, and focus is per world. Its own tests are
 * `tests/unit/fake-dom.test.js`; a test that would pass on a fake that did nothing does not count there.
 *
 * Usage: `const { document, root, createElement, parse } = createFakeDom();` A world is one document. Each call makes a
 * fresh world, and two worlds never share `document.activeElement`. To run a `public/` script against it, use `loadWorld`
 * in `tests/unit/helpers/client-world.js`: one world, one vm sandbox, the scripts a suite names.
 *
 * Guard and consumers (LIN-4265). `tests/unit/fake-dom-census.test.js` fails on any new hand-written fake DOM under
 * `tests/`, `scripts/eval` or `scripts/code-shape`; its `HAND_WRITTEN_FAKE_DOM_FILES` lists those not yet moved here.
 * The files that use this fake today: `client-world.js`, `fake-dom.test.js` and `lin-4242-waiting-merge.test.js`
 * directly, and `lin-4010-home-opened-task.test.js` and `lin-4246-opened-task-repaint-keep.test.js` through `loadWorld`.
 * A suite moved onto this fake leaves `HAND_WRITTEN_FAKE_DOM_FILES` and joins this list in the same PR.
 *
 * Modelled:
 * - Tree and identity: element, text, comment and fragment nodes in order; `children` (elements only, a real array),
 *   `childNodes`, `parentNode`, `parentElement`, `appendChild`, `insertBefore`, `removeChild`, `remove`, `replaceWith`,
 *   `contains` (inclusive), `isConnected` (reaches the world's document), `textContent` get/set.
 * - `innerHTML` and `outerHTML`, get and set. The serializer is browser-faithful: attributes in source order, a valueless
 *   attribute as `name=""`, text escapes `& < >`, attribute values escape `& "`, void elements have no end tag, script
 *   and style text is raw, `<template>` serializes its content. The typed `value` is not in the markup. `outerHTML =` on
 *   a node with no parent does nothing, as the DOM Parsing spec says. The parser throws on a malformed tag, an
 *   unmatched end tag, an unknown named entity and markup it does not model (`<!doctype …>`).
 * - Attributes: `get/set/has/removeAttribute`, `hidden`, `disabled` and `type` (reflecting; `type` defaults to `text` on an
 *   input and `submit` on a button), `dataset` (kebab-cased, with
 *   `delete`), `classList` (`add`, `remove`, `toggle` with force, `contains`).
 * - Selectors (`querySelector[All]`, `matches`, `closest`): type, `.class`, `#id`, `[attr]`, `[attr="v"]`, compound chains,
 *   descendant and `>` combinators, comma lists, `:not(<compound list>)`, and `:scope`. Anything else throws, naming the
 *   selector: `+`, `~`, `*`, `:has`, `:nth-*`, other pseudo-classes, and attribute operators other than `=`.
 * - Form state: an input's or textarea's `value` (from the `value` attribute or the text until it is set, then independent),
 *   an input's `checked` (from the `checked` attribute until it is set, then independent and not serialized), `selectionStart`, `selectionEnd` and `setSelectionRange`. The caret starts and moves to the end of the value.
 * - Focus: `focus()` and `blur()` on focusable elements. `document.activeElement` is per world. It returns the body when
 *   nothing is focused, and it stops naming a control once that control is removed or replaced (the focus fixup). The
 *   setter is a test shim: `document.activeElement = el` focuses `el`.
 * - Listeners: `addEventListener` and `removeEventListener` record. `listenersOf(type)` exposes the recorded functions, so
 *   a suite's click or key shim can call them. `dispatchEvent` is inert and returns true.
 *
 * Deliberately not modelled: layout, CSS, `:hover`, `:checked` and the other state pseudo-classes, `+` and `~`, event
 * dispatch and bubbling, HTML error recovery (implied end tags such as `<p>` closing `<p>`), foreign content (SVG and
 * MathML), `<script>` execution, `getBoundingClientRect`, `MutationObserver`, `Range` and `Selection`,
 * `getClientRects` (so a Tab-driven focus trap cannot be exercised), `select`, `id` and `className` as properties (use the attributes), and selection direction.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style']);
const RCDATA = new Set(['textarea', 'title']);
const FORM_CONTROLS = new Set(['input', 'textarea', 'select', 'button']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const WS = /[ \t\n\f\r]/;
const ELEMENT_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const ATTR_NAME = /^[a-z_:][a-z0-9_:.-]*$/;
const REF = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** Thrown for anything the fake does not model, or a DOM operation a browser would refuse. */
export class FakeDomError extends Error {
  constructor(message) {
    super(`fake DOM: ${message}`);
    this.name = 'FakeDomError';
  }
}
const fail = (message) => { throw new FakeDomError(message); };

// ── Nodes ───────────────────────────────────────────────────────────────────

const collectText = (node) => {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType === 8) return '';
  return node._kids.map(collectText).join('');
};
const nextKid = (node) => {
  const kids = node.parentNode._kids;
  return kids[kids.indexOf(node) + 1] || null;
};
const toNode = (item, doc) => {
  if (typeof item === 'string') return new FakeText(doc, item);
  if (item instanceof FakeNode) return item;
  return fail(`cannot insert ${String(item)}; pass a node or a string`);
};

class FakeNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this._kids = [];
    this._listeners = new Map();
  }

  get childNodes() { return [...this._kids]; }
  get children() { return this._kids.filter((k) => k.nodeType === 1); }
  get parentElement() { const p = this.parentNode; return p && p.nodeType === 1 ? p : null; }
  get isConnected() {
    let top = this;
    while (top.parentNode) top = top.parentNode;
    return top === this.ownerDocument && top.nodeType === 9;
  }
  get textContent() { return collectText(this); }
  set textContent(value) {
    const frag = new FakeFragment(this.ownerDocument);
    if (String(value) !== '') frag._insert(new FakeText(this.ownerDocument, String(value)), null);
    this._replaceKids(frag);
  }

  /** Where children go. A `<template>` keeps them in `content`; everything else keeps them on itself. */
  _host() { return this; }

  /** Puts `node` before `ref` (null appends). A fragment gives up its children. A node moves out of its old parent. */
  _insert(node, ref) {
    if (node.nodeType === 11) {
      for (const k of [...node._kids]) this._insert(k, ref);
      return node;
    }
    if (node === this || node.contains(this)) fail('cannot insert a node into itself or a descendant of itself');
    if (ref === node) ref = nextKid(node);
    if (ref && ref.parentNode !== this) fail('insertBefore: the reference node is not a child of this node');
    node._detach();
    node._adopt(this.ownerDocument);
    const at = ref ? this._kids.indexOf(ref) : this._kids.length;
    this._kids.splice(at, 0, node);
    node.parentNode = this;
    return node;
  }

  /** Takes this node out of its parent. A removed subtree cannot keep focus. */
  _detach() {
    const parent = this.parentNode;
    if (!parent) return;
    parent._kids.splice(parent._kids.indexOf(this), 1);
    this.parentNode = null;
    const doc = this.ownerDocument;
    if (doc && doc._focused && this.contains(doc._focused)) doc._focused = null;
  }

  _adopt(doc) {
    this.ownerDocument = doc;
    for (const k of this._kids) k._adopt(doc);
  }

  _replaceKids(frag) {
    for (const k of [...this._kids]) k._detach();
    this._insert(frag, null);
  }

  appendChild(node) { return this._insert(node, null); }
  insertBefore(node, ref) { return this._insert(node, ref || null); }
  removeChild(node) {
    if (!node || node.parentNode !== this) fail('removeChild: the node is not a child of this node');
    node._detach();
    return node;
  }
  remove() { this._detach(); }
  replaceWith(...items) {
    const parent = this.parentNode;
    if (!parent) return;
    const ref = nextKid(this);
    this._detach();
    for (const item of items) parent._insert(toNode(item, this.ownerDocument), ref);
  }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  addEventListener(type, fn) {
    if (typeof fn !== 'function') fail(`addEventListener: only function listeners are modelled, not ${typeof fn}`);
    const list = this._listeners.get(type) || [];
    if (!list.includes(fn)) list.push(fn);
    this._listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type);
    if (list) this._listeners.set(type, list.filter((f) => f !== fn));
  }
  listenersOf(type) { return [...(this._listeners.get(type) || [])]; }
  dispatchEvent() { return true; }

  querySelector(selector) { return selectAll(this, selector, true)[0] || null; }
  querySelectorAll(selector) { return selectAll(this, selector, false); }
}

class FakeText extends FakeNode {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = data; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class FakeComment extends FakeNode {
  constructor(doc, data) { super(doc); this.nodeType = 8; this.data = data; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value); }
}

class FakeFragment extends FakeNode {
  constructor(doc) { super(doc); this.nodeType = 11; }
}

class FakeElement extends FakeNode {
  constructor(doc, localName) {
    super(doc);
    this.nodeType = 1;
    this.localName = localName;
    this.tagName = localName.toUpperCase();
    this._attrs = new Map();
    this._valueDirty = false;
    this._value = '';
    this._checkedDirty = false;
    this._checked = false;
    this._sel = null;
    this.content = localName === 'template' ? new FakeFragment(doc) : undefined;
  }

  _host() { return this.localName === 'template' ? this.content : this; }
  _adopt(doc) {
    super._adopt(doc);
    if (this.content) this.content._adopt(doc);
  }

  getAttribute(name) {
    const v = this._attrs.get(String(name).toLowerCase());
    return v === undefined ? null : v;
  }
  setAttribute(name, value) {
    const n = String(name).toLowerCase();
    if (!ATTR_NAME.test(n)) fail(`invalid attribute name ${JSON.stringify(name)}`);
    this._attrs.set(n, String(value));
  }
  hasAttribute(name) { return this._attrs.has(String(name).toLowerCase()); }
  removeAttribute(name) { this._attrs.delete(String(name).toLowerCase()); }

  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(on) { if (on) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(on) { if (on) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }

  /** `type` reflects the attribute, with the element's default: `text` for an input, `submit` for a button, else empty. */
  get type() {
    const v = this.getAttribute('type');
    if (this.localName === 'input') return v === null ? 'text' : v.toLowerCase();
    if (this.localName === 'button') return v === null ? 'submit' : v.toLowerCase();
    return v === null ? '' : v;
  }
  set type(v) { this.setAttribute('type', v); }

  /** An input's `checked` starts from the `checked` attribute, then is independent and never serialized (like `value`). */
  get checked() {
    if (this.localName !== 'input') return undefined;
    return this._checkedDirty ? this._checked : this.hasAttribute('checked');
  }
  set checked(on) {
    if (this.localName !== 'input') fail(`checked is not modelled on <${this.localName}>`);
    this._checkedDirty = true;
    this._checked = Boolean(on);
  }

  get dataset() {
    const el = this;
    return new Proxy({}, {
      get: (_t, p) => (typeof p === 'string' ? el.getAttribute(dataAttr(p)) ?? undefined : undefined),
      set: (_t, p, v) => { el.setAttribute(dataAttr(p), String(v)); return true; },
      has: (_t, p) => typeof p === 'string' && el.hasAttribute(dataAttr(p)),
      deleteProperty: (_t, p) => { el.removeAttribute(dataAttr(p)); return true; },
      ownKeys: () => [...el._attrs.keys()].filter((k) => k.startsWith('data-')).map(dataProp),
      getOwnPropertyDescriptor: (_t, p) => (typeof p === 'string' && el.hasAttribute(dataAttr(p))
        ? { value: el.getAttribute(dataAttr(p)), writable: true, enumerable: true, configurable: true }
        : undefined),
    });
  }

  get classList() {
    const el = this;
    const token = (t) => {
      if (!t || WS.test(t) || /[ \t\n\f\r]/.test(t)) fail(`invalid class token ${JSON.stringify(t)}`);
      return t;
    };
    return {
      contains: (t) => tokensOf(el).includes(t),
      add: (...ts) => {
        const cur = tokensOf(el);
        for (const t of ts.map(token)) if (!cur.includes(t)) cur.push(t);
        writeTokens(el, cur);
      },
      remove: (...ts) => {
        const drop = ts.map(token);
        writeTokens(el, tokensOf(el).filter((t) => !drop.includes(t)));
      },
      toggle: (t, force) => {
        token(t);
        const cur = tokensOf(el);
        const has = cur.includes(t);
        const want = force === undefined ? !has : !!force;
        if (want && !has) cur.push(t);
        if (!want && has) cur.splice(cur.indexOf(t), 1);
        writeTokens(el, cur);
        return want;
      },
    };
  }

  get innerHTML() { return serializeKids(this._host()); }
  set innerHTML(html) { this._host()._replaceKids(parseFragment(String(html), this.ownerDocument)); }
  get outerHTML() { return serializeElement(this); }
  set outerHTML(html) {
    const parent = this.parentNode;
    if (!parent) return;
    if (parent.nodeType === 9) fail('outerHTML: the document element cannot be replaced this way');
    const frag = parseFragment(String(html), this.ownerDocument);
    const ref = nextKid(this);
    this._detach();
    parent._insert(frag, ref);
  }

  /** Form controls: `value` is the attribute (or the text, for a textarea) until it is set, then independent. */
  get value() {
    if (!isValueControl(this)) return undefined;
    if (this._valueDirty) return this._value;
    return this.localName === 'textarea' ? collectText(this) : (this.getAttribute('value') ?? '');
  }
  set value(v) {
    if (!isValueControl(this)) fail(`value is not modelled on <${this.localName}>`);
    this._valueDirty = true;
    this._value = String(v);
    this._sel = { start: this._value.length, end: this._value.length };
  }
  get selectionStart() { return this._caret()?.start ?? null; }
  get selectionEnd() { return this._caret()?.end ?? null; }
  setSelectionRange(start, end = start) {
    if (!isValueControl(this)) fail(`setSelectionRange is not modelled on <${this.localName}>`);
    const len = this.value.length;
    const clamp = (x) => Math.min(Math.max(0, Math.trunc(Number(x)) || 0), len);
    this._sel = { start: clamp(start), end: clamp(end) };
  }
  _caret() {
    if (!isValueControl(this)) return null;
    const len = this.value.length;
    if (!this._sel) this._sel = { start: len, end: len };
    return { start: Math.min(this._sel.start, len), end: Math.min(this._sel.end, len) };
  }

  focus() {
    if (!this.isConnected || !isFocusable(this)) return;
    this.ownerDocument._focused = this;
  }
  blur() {
    if (this.ownerDocument._focused === this) this.ownerDocument._focused = null;
  }

  matches(selector) {
    return parseSelectorList(selector).some((c) => matchFrom(this, c, c.length - 1, this));
  }
  closest(selector) {
    for (let e = this; e && e.nodeType === 1; e = e.parentElement) if (e.matches(selector)) return e;
    return null;
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this._focused = null;
    const html = new FakeElement(this, 'html');
    html._insert(new FakeElement(this, 'body'), null);
    this._insert(html, null);
  }

  get documentElement() { return this.children[0] || null; }
  get body() {
    const html = this.documentElement;
    return html ? html.children.find((c) => c.localName === 'body') || null : null;
  }
  get activeElement() {
    const f = this._focused;
    return f && f.isConnected ? f : this.body;
  }
  set activeElement(el) { this._focused = el || null; }

  createElement(name) {
    const n = String(name).toLowerCase();
    if (!ELEMENT_NAME.test(n)) fail(`invalid element name ${JSON.stringify(name)}`);
    return new FakeElement(this, n);
  }
}

// ── Attributes, classes, data ──────────────────────────────────────────────

const dataAttr = (prop) => `data-${String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const dataProp = (attr) => attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const tokensOf = (el) => (el.getAttribute('class') || '').split(/[ \t\n\f\r]+/).filter(Boolean);
function writeTokens(el, tokens) {
  if (tokens.length === 0 && !el.hasAttribute('class')) return; // the DOM update steps: no empty attribute is created
  el.setAttribute('class', tokens.join(' '));
}
const isValueControl = (el) => el.localName === 'input' || el.localName === 'textarea';
function isFocusable(el) {
  if (el.hasAttribute('disabled') && FORM_CONTROLS.has(el.localName)) return false;
  if (el.localName === 'input' && el.getAttribute('type') === 'hidden') return false;
  if (el.hasAttribute('tabindex')) return true;
  return FORM_CONTROLS.has(el.localName) || (el.localName === 'a' && el.hasAttribute('href'));
}

// ── Serialization (browser-faithful, not an echo of the source) ────────────

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');

function serializeNode(node) {
  if (node.nodeType === 1) return serializeElement(node);
  if (node.nodeType === 3) {
    const parent = node.parentNode;
    const raw = parent && parent.nodeType === 1 && RAW_TEXT.has(parent.localName);
    return raw ? node.data : escapeText(node.data);
  }
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  return fail(`cannot serialize node type ${node.nodeType}`);
}
function serializeElement(el) {
  let s = `<${el.localName}`;
  for (const [k, v] of el._attrs) s += ` ${k}="${escapeAttr(v)}"`;
  s += '>';
  if (VOID.has(el.localName)) return s;
  return `${s}${serializeKids(el._host())}</${el.localName}>`;
}
const serializeKids = (host) => host._kids.map(serializeNode).join('');

// ── Parsing ────────────────────────────────────────────────────────────────

/** Decodes the named and numeric references the server emits. An unknown `&name;` throws; a bare `&` is literal text. */
function decode(s) {
  return s.replace(REF, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) fail(`invalid character reference ${whole}`);
      return String.fromCodePoint(cp);
    }
    if (!Object.prototype.hasOwnProperty.call(NAMED, body)) fail(`unknown entity ${whole}`);
    return NAMED[body];
  });
}

/** Reads one start tag at `start` (a `<`). Returns its name, attributes in source order, and where it ends. */
function readStartTag(html, start) {
  const nameRe = /<([a-zA-Z][a-zA-Z0-9-]*)/y;
  nameRe.lastIndex = start;
  const nm = nameRe.exec(html);
  const name = nm[1].toLowerCase();
  let i = start + nm[0].length;
  const attrs = [];
  for (;;) {
    while (i < html.length && WS.test(html[i])) i++;
    if (i >= html.length) fail(`unterminated <${name}> tag`);
    if (html[i] === '>') return { name, attrs, end: i + 1 };
    if (html[i] === '/') {
      if (html[i + 1] === '>') return { name, attrs, end: i + 2 };
      fail(`malformed <${name}> tag: "/" must be followed by ">"`);
    }
    const attrRe = /[^ \t\n\f\r"'>/=]+/y;
    attrRe.lastIndex = i;
    const am = attrRe.exec(html);
    if (!am) fail(`malformed attribute in <${name}> at ${i}`);
    i += am[0].length;
    const attrName = am[0].toLowerCase();
    while (i < html.length && WS.test(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && WS.test(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close < 0) fail(`unterminated attribute value in <${name}>`);
        value = decode(html.slice(i + 1, close));
        i = close + 1;
      } else {
        const unquoted = /[^ \t\n\f\r"'=<>`]+/y;
        unquoted.lastIndex = i;
        const um = unquoted.exec(html);
        if (!um) fail(`malformed attribute value in <${name}> at ${i}`);
        value = decode(um[0]);
        i += um[0].length;
      }
    }
    if (!attrs.some(([k]) => k === attrName)) attrs.push([attrName, value]); // the first of a repeated name wins
  }
}

/** Parses `html` and appends the result to `into`. Open elements at the end of the input are closed, as a browser does. */
function parseMarkup(html, into) {
  const doc = into.ownerDocument;
  const open = [into];
  const target = () => open[open.length - 1]._host();
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      if (html.startsWith('<!--', i)) {
        const end = html.indexOf('-->', i + 4);
        if (end < 0) fail('unterminated comment');
        target()._insert(new FakeComment(doc, html.slice(i + 4, end)), null);
        i = end + 3;
        continue;
      }
      if (html[i + 1] === '/') {
        const endRe = /<\/([a-zA-Z][a-zA-Z0-9-]*)[ \t\n\f\r]*>/y;
        endRe.lastIndex = i;
        const em = endRe.exec(html);
        if (!em) fail(`malformed end tag at ${i}`);
        const name = em[1].toLowerCase();
        const top = open[open.length - 1];
        if (open.length === 1 || top.localName !== name) {
          fail(`unexpected end tag </${name}> at ${i}${open.length > 1 ? ` (open: <${top.localName}>)` : ''}`);
        }
        open.pop();
        i += em[0].length;
        continue;
      }
      if (html[i + 1] === '!') fail(`unsupported markup at ${i}: only comments are modelled`);
      if (/[a-zA-Z]/.test(html[i + 1] || '')) {
        const { name, attrs, end } = readStartTag(html, i);
        const el = new FakeElement(doc, name);
        for (const [k, v] of attrs) el._attrs.set(k, v);
        target()._insert(el, null);
        i = end;
        if (VOID.has(name)) continue;
        if (RAW_TEXT.has(name) || RCDATA.has(name)) {
          const closeRe = new RegExp(`</${name}[ \\t\\n\\f\\r]*>`, 'gi');
          closeRe.lastIndex = i;
          const cm = closeRe.exec(html);
          if (!cm) fail(`unterminated <${name}>`);
          const raw = html.slice(i, cm.index);
          if (raw !== '') el._insert(new FakeText(doc, RAW_TEXT.has(name) ? raw : decode(raw)), null);
          i = cm.index + cm[0].length;
          continue;
        }
        open.push(el);
        continue;
      }
    }
    let j = i + 1;
    while (j < html.length && !(html[j] === '<' && /[a-zA-Z/!]/.test(html[j + 1] || ''))) j++;
    const text = decode(html.slice(i, j));
    const host = target();
    const last = host._kids[host._kids.length - 1];
    if (last && last.nodeType === 3) last.data += text;
    else host._insert(new FakeText(doc, text), null);
    i = j;
  }
  return into;
}

function parseFragment(html, doc) {
  return parseMarkup(html, new FakeFragment(doc));
}

// ── Selectors (a supported subset; anything else throws) ───────────────────

const selectorCache = new Map();
const IDENT = /-?[a-zA-Z_][\w-]*/y;

/** Splits a selector list on commas that are not inside parentheses, brackets or quotes. */
function splitTopLevel(src) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(src.slice(start, i)); start = i + 1; }
  }
  parts.push(src.slice(start));
  return parts;
}

/** A selector list: an array of complex selectors. A complex one is an array of `{ comb, simples }`, left to right. */
function parseSelectorList(selector) {
  const key = String(selector);
  if (selectorCache.has(key)) return selectorCache.get(key);
  const list = splitTopLevel(key).map((p) => parseComplex(p, key));
  selectorCache.set(key, list);
  return list;
}

function parseComplex(part, whole) {
  const text = part.trim();
  const unsupported = (why) => fail(`unsupported selector ${JSON.stringify(whole)}: ${why}`);
  if (text === '') unsupported('empty selector');
  const parts = [];
  let i = 0;
  let comb = null;
  const skipWs = () => { while (i < text.length && WS.test(text[i])) i++; };
  for (;;) {
    const simples = [];
    while (i < text.length && !WS.test(text[i]) && text[i] !== '>') {
      const r = parseSimple(text, i, whole);
      simples.push(r.simple);
      i = r.next;
    }
    if (simples.length === 0) unsupported(`no compound selector at ${i}`);
    parts.push({ comb, simples });
    const before = i;
    skipWs();
    if (i >= text.length) break;
    if (text[i] === '>') {
      comb = '>';
      i++;
      skipWs();
      if (i >= text.length) unsupported('a combinator at the end');
    } else if (i > before) {
      comb = ' ';
    } else {
      unsupported(`${text[i]} is not supported`);
    }
  }
  return parts;
}

function parseSimple(text, i, whole) {
  const unsupported = (why) => fail(`unsupported selector ${JSON.stringify(whole)}: ${why}`);
  const c = text[i];
  if (c === '.' || c === '#') {
    IDENT.lastIndex = i + 1;
    const m = IDENT.exec(text);
    if (!m) unsupported(`no name after "${c}"`);
    return { simple: { kind: c === '.' ? 'class' : 'id', name: m[0] }, next: i + 1 + m[0].length };
  }
  if (c === '[') {
    const attr = /\[\s*([a-zA-Z_][\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*)?\]/y;
    attr.lastIndex = i;
    const m = attr.exec(text);
    if (!m) unsupported('only [attr] and [attr="value"] are modelled');
    const value = m[2] ?? m[3] ?? m[4];
    return { simple: { kind: 'attr', name: m[1].toLowerCase(), value }, next: i + m[0].length };
  }
  if (c === ':') {
    if (text.startsWith(':scope', i) && !/[\w-]/.test(text[i + 6] || '')) {
      return { simple: { kind: 'scope' }, next: i + 6 };
    }
    if (text.startsWith(':not(', i)) {
      let depth = 0;
      let close = -1;
      for (let k = i + 4; k < text.length; k++) {
        if (text[k] === '(') depth++;
        else if (text[k] === ')' && --depth === 0) { close = k; break; }
      }
      if (close < 0) unsupported('unclosed :not(');
      const inner = parseSelectorList(text.slice(i + 5, close));
      if (inner.some((complex) => complex.length !== 1)) unsupported(':not() takes compound selectors only');
      return { simple: { kind: 'not', list: inner }, next: close + 1 };
    }
    const pseudo = /^:{1,2}[\w-]*/.exec(text.slice(i))[0];
    return unsupported(`pseudo-class or element ${pseudo} is not modelled`);
  }
  if (/[a-zA-Z]/.test(c)) {
    const m = /[a-zA-Z][\w-]*/y;
    m.lastIndex = i;
    const tag = m.exec(text)[0].toLowerCase();
    return { simple: { kind: 'tag', name: tag }, next: i + tag.length };
  }
  return unsupported(`"${c}" is not modelled`);
}

function matchSimple(el, s, scope) {
  switch (s.kind) {
    case 'tag': return el.localName === s.name;
    case 'class': return el.classList.contains(s.name);
    case 'id': return el.getAttribute('id') === s.name;
    case 'attr': {
      const v = el.getAttribute(s.name);
      if (v === null) return false;
      return s.value === undefined || v === s.value;
    }
    case 'scope': return el === scope;
    case 'not': return !s.list.some((c) => matchFrom(el, c, 0, scope));
    default: return fail(`unknown simple selector ${s.kind}`);
  }
}

/** Matches element `el` against complex selector `parts`, right to left, with the subject at index `i`. */
function matchFrom(el, parts, i, scope) {
  const { simples, comb } = parts[i];
  if (!simples.every((s) => matchSimple(el, s, scope))) return false;
  if (i === 0) return true;
  if (comb === '>') {
    const p = el.parentElement;
    return p !== null && matchFrom(p, parts, i - 1, scope);
  }
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (matchFrom(p, parts, i - 1, scope)) return true;
  }
  return false;
}

/** Descendants of `root` that match, in document order. `:scope` is `root` (or the document element for a document). */
function selectAll(root, selector, firstOnly) {
  const list = parseSelectorList(selector);
  const scope = root.nodeType === 1 ? root : (root.nodeType === 9 ? root.documentElement : null);
  const out = [];
  const walk = (node) => {
    for (const k of node._kids) {
      if (k.nodeType === 1 && list.some((c) => matchFrom(k, c, c.length - 1, scope))) {
        out.push(k);
        if (firstOnly) return true;
      }
      if (walk(k)) return true;
    }
    return false;
  };
  walk(root);
  return out;
}

// ── The world ──────────────────────────────────────────────────────────────

/**
 * A fresh world: one document with `html > body`, and the functions to build markup in it. `root` is the document, the
 * top of the tree that `isConnected` reaches. `parse(html, into)` appends the parsed nodes to `into` (the body by default)
 * and returns `into`.
 */
export function createFakeDom() {
  const document = new FakeDocument();
  return {
    document,
    root: document,
    createElement: (name) => document.createElement(name),
    parse: (html, into = document.body) => {
      if (!into) fail('parse: the document has no body');
      return parseMarkup(String(html), into);
    },
  };
}
