/**
 * Minimal DOM shim for the Observation client (public/observation.js) under a
 * vm sandbox. Shared by the Observation unit tests that paint ruling rows:
 * `renderRulings` reconciles its list in place (appendChild / insertBefore /
 * removeChild) and asks `contains` and `querySelectorAll` about a row's
 * controls, so the shim models exactly those and nothing else.
 *
 * Extracted from tests/unit/observation-ruling-delivery.test.js (LIN-3983) so
 * the waiting-block tests do not carry a second copy.
 */
class FakeClassList {
  constructor(el) { this.el = el; this._set = new Set(); }
  add(...names) { names.forEach(n => this._set.add(n)); this._sync(); }
  remove(...names) { names.forEach(n => this._set.delete(n)); this._sync(); }
  contains(name) { return this._set.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this._set.has(name) : force;
    if (on) this._set.add(name); else this._set.delete(name);
    this._sync();
    return on;
  }
  _sync() { this.el._className = Array.from(this._set).join(' '); }
}

export class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this._className = '';
    this._textContent = '';
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.disabled = false;
    this.type = undefined;
    this.classList = new FakeClassList(this);
    this.attrs = {};
    this.parentNode = null;
  }
  get className() { return this._className; }
  set className(v) {
    this._className = v;
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v; this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  // LIN-3631: renderRulings reconciles #obs-rulings in place.
  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }
  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx === -1) this.children.push(child); else this.children.splice(idx, 0, child);
    child.parentNode = this;
    return child;
  }
  // LIN-2775 Area 5's flip control swaps its own <li> in place
  // (li.parentNode.replaceChild(fresh, li)) — the one production caller of
  // either method in this whole shim.
  replaceChild(newChild, oldChild) {
    const idx = this.children.indexOf(oldChild);
    if (idx !== -1) this.children[idx] = newChild;
    newChild.parentNode = this;
    oldChild.parentNode = null;
    return oldChild;
  }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  // LIN-3631: renderRulings asks whether the focused element sits inside a
  // row (`li.contains(document.activeElement)`), and the shelve panel focuses
  // its reason box on open.
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  focus() {}
  click() { (this.listeners.click || []).forEach(fn => fn({ type: 'click' })); }
  _matches(el, selector) {
    // rulingRowControls(li) queries a COMMA-separated list of class
    // selectors (real querySelectorAll supports that natively) — split and
    // match any part, each still a bare `.class` selector.
    return selector.split(',').some((part) => {
      const trimmed = part.trim();
      return trimmed.startsWith('.') && el.classList.contains(trimmed.slice(1));
    });
  }
  querySelectorAll(selector) {
    const matches = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (this._matches(child, selector)) matches.push(child);
        walk(child);
      }
    };
    walk(this);
    return matches;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

export { FakeClassList };
