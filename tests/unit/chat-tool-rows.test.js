/**
 * LIN-3361 — `window.ChatUI.appendToolRow` / `foldAfterAnchor` (public/chat.js)
 * against a minimal DOM shim: grouping by adjacency, settle/fail, scroll
 * pinning, textContent-only rendering, and the fold guards. Text-node
 * linkifying and real <details> toggling are proven in the e2e spec.
 *
 * Run with: node --test tests/unit/chat-tool-rows.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_JS_SRC = readFileSync(join(__dirname, '../../public/chat.js'), 'utf8');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 500;
    this._text = '';
    this._classes = new Set();
    const self = this;
    this.classList = {
      add: (...n) => n.forEach((c) => self._classes.add(c)),
      contains: (c) => self._classes.has(c),
    };
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  _detach(child) {
    if (child.parentNode) {
      const at = child.parentNode.children.indexOf(child);
      if (at !== -1) child.parentNode.children.splice(at, 1);
    }
  }
  appendChild(child) { this._detach(child); child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, ref) {
    this._detach(child);
    const at = this.children.indexOf(ref);
    child.parentNode = this;
    if (at === -1) this.children.push(child); else this.children.splice(at, 0, child);
    return child;
  }
}

function setup({ pinned = true } = {}) {
  const sandbox = {
    window: { isPinnedToBottom: () => pinned },
    document: { createElement: (t) => new FakeElement(t) },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(CHAT_JS_SRC, sandbox, { filename: 'chat.js' });
  const thread = new FakeElement('ul');
  return { ChatUI: sandbox.window.ChatUI, thread };
}

const note = (text) => { const li = new FakeElement('li'); li.className = 'chat-note'; li.textContent = text; return li; };
const rowSummary = (li) => li.children[0].children[0];
const groupSummary = (g) => g.children[0].children[0];
const groupRows = (g) => g.children[0].children[1].children;

describe('appendToolRow', () => {
  test('a single row is a bare closed <details> row, not a bubble and not wrapped', () => {
    const { ChatUI, thread } = setup();
    const h = ChatUI.appendToolRow(thread, { label: 'checked the task stack', args: { limit: 3 } });
    assert.equal(thread.children.length, 1);
    assert.equal(thread.children[0], h.li);
    assert.equal(h.li.className, 'chat-tool-row');
    assert.equal(h.li.children[0].tagName, 'DETAILS');
    assert.equal(rowSummary(h.li).textContent, '↳ checked the task stack …');
    assert.equal(h.li.classList.contains('chat-msg'), false, 'never a bubble');
  });

  test('settle fills the result, drops the ellipsis and clips long results', () => {
    const { ChatUI, thread } = setup();
    const h = ChatUI.appendToolRow(thread, { label: 'checked X', args: {} });
    h.settle('x'.repeat(4000));
    assert.equal(rowSummary(h.li).textContent, '↳ checked X');
    const result = h.li.children[0].children[1].children.find((c) => c.className.includes('chat-tool-result'));
    assert.equal(result.hidden, false);
    assert.equal(result.textContent.length, 1501);
    assert.ok(result.textContent.endsWith('…'));
    assert.equal(h.li.dataset.pending, undefined);
  });

  test('a complete JSON result is pretty-printed; markup stays literal text', () => {
    const { ChatUI, thread } = setup();
    const h = ChatUI.appendToolRow(thread, { label: 'l', args: { q: '<img onerror=x>' } });
    h.settle('{"a":"<b>hi</b>"}');
    const pres = h.li.children[0].children[1].children;
    assert.equal(pres[0].textContent, '{\n  "q": "<img onerror=x>"\n}');
    assert.equal(pres[1].textContent, '{\n  "a": "<b>hi</b>"\n}');
  });

  test('two adjacent rows merge into one group "checked 2 things"; a third bumps the count', () => {
    const { ChatUI, thread } = setup();
    const a = ChatUI.appendToolRow(thread, { label: 'a' });
    const b = ChatUI.appendToolRow(thread, { label: 'b' });
    assert.equal(thread.children.length, 1);
    const group = thread.children[0];
    assert.equal(group.className, 'chat-tool-group');
    assert.deepEqual(groupRows(group), [a.li, b.li]);
    assert.equal(groupSummary(group).textContent, 'checked 2 things …', 'pending while any member is pending');
    a.settle('{}'); b.settle('{}');
    assert.equal(groupSummary(group).textContent, 'checked 2 things');
    ChatUI.appendToolRow(thread, { label: 'c' });
    assert.equal(thread.children.length, 1);
    assert.equal(groupRows(group).length, 3);
  });

  test('any non-tool li between rows breaks the run (a proposal or note is never a member)', () => {
    const { ChatUI, thread } = setup();
    ChatUI.appendToolRow(thread, { label: 'a' });
    const proposal = new FakeElement('li'); proposal.className = 'chat-msg fc-proposal-msg';
    thread.appendChild(proposal);
    ChatUI.appendToolRow(thread, { label: 'b' });
    assert.equal(thread.children.length, 3);
    assert.deepEqual(thread.children.map((c) => c.className), ['chat-tool-row', 'chat-msg fc-proposal-msg', 'chat-tool-row']);
    thread.appendChild(note('cap'));
    ChatUI.appendToolRow(thread, { label: 'c' });
    assert.equal(thread.children.length, 5, 'a note also breaks the run');
  });

  test('before: a row inserted before an anchor groups with the sibling that precedes the anchor', () => {
    const { ChatUI, thread } = setup();
    const answer = new FakeElement('li'); answer.className = 'chat-msg';
    thread.appendChild(answer);
    const a = ChatUI.appendToolRow(thread, { label: 'a', before: answer });
    const b = ChatUI.appendToolRow(thread, { label: 'b', before: answer });
    assert.equal(thread.children.length, 2);
    assert.equal(thread.children[1], answer, 'the anchor stays last');
    assert.deepEqual(groupRows(thread.children[0]), [a.li, b.li]);
  });

  test('a row inserted before a bubble joins the run that ends right there (adjacency is judged at the insertion point)', () => {
    const { ChatUI, thread } = setup();
    ChatUI.appendToolRow(thread, { label: 'a' });
    const bubble = new FakeElement('li'); bubble.className = 'chat-msg';
    thread.appendChild(bubble);
    ChatUI.appendToolRow(thread, { label: 'b', before: bubble });
    assert.equal(thread.children.length, 2, 'a and b are adjacent at the insertion point, so they merge; the bubble stays outside');
    assert.equal(thread.children[0].className, 'chat-tool-group');
  });

  test('fail marks the row and the group', () => {
    const { ChatUI, thread } = setup();
    ChatUI.appendToolRow(thread, { label: 'a' }).settle('{}');
    const b = ChatUI.appendToolRow(thread, { label: 'b' });
    b.fail('get_session failed: boom');
    assert.equal(rowSummary(b.li).textContent, '↳ get_session failed: boom');
    assert.equal(b.li.dataset.error, '1');
    assert.equal(thread.children[0].dataset.hasError, '1');
  });

  test('scroll: pinned thread follows growth and settle; an unpinned one does not jump', () => {
    const pinned = setup({ pinned: true });
    const h = pinned.ChatUI.appendToolRow(pinned.thread, { label: 'a' });
    assert.equal(pinned.thread.scrollTop, 500);
    pinned.thread.scrollTop = 0;
    h.settle('{}');
    assert.equal(pinned.thread.scrollTop, 500);

    const loose = setup({ pinned: false });
    const g = loose.ChatUI.appendToolRow(loose.thread, { label: 'a' });
    loose.ChatUI.appendToolRow(loose.thread, { label: 'b' });
    g.settle('{}');
    assert.equal(loose.thread.scrollTop, 0);
  });
});

describe('foldAfterAnchor', () => {
  const block = (tag, text) => { const e = new FakeElement(tag); e.textContent = text; return e; };
  const long = 'word '.repeat(80);

  test('moves the anchor and everything after it into a closed fold, keeping the headline', () => {
    const { ChatUI } = setup();
    const el = new FakeElement('div');
    const head = block('P', 'All green.');
    const hr = block('HR', '');
    const body = block('P', long);
    [head, hr, body].forEach((n) => el.appendChild(n));
    assert.equal(ChatUI.foldAfterAnchor(el, { summary: 'full readout' }), true);
    assert.equal(el.children.length, 2);
    assert.equal(el.children[0], head);
    const fold = el.children[1];
    assert.equal(fold.className, 'chat-fold');
    assert.equal(fold.children[0].textContent, 'full readout');
    assert.deepEqual(fold.children.slice(1), [hr, body], 'the same nodes moved, not copies');
  });

  test('does nothing: no anchor, nothing before the anchor, or a short tail', () => {
    const { ChatUI } = setup();
    const none = new FakeElement('div'); none.appendChild(block('P', long));
    assert.equal(ChatUI.foldAfterAnchor(none, {}), false);
    assert.equal(none.children.length, 1);

    const lead = new FakeElement('div'); lead.appendChild(block('H2', 'Readout')); lead.appendChild(block('P', long));
    assert.equal(ChatUI.foldAfterAnchor(lead, {}), false, 'an answer that opens with a heading has no headline to keep');

    const short = new FakeElement('div'); short.appendChild(block('P', 'Headline.')); short.appendChild(block('H2', 'Details')); short.appendChild(block('P', 'tiny'));
    assert.equal(ChatUI.foldAfterAnchor(short, {}), false);
    assert.equal(short.children.length, 3);
  });

  test('bold-label fallback folds from the first known heading', () => {
    const { ChatUI } = setup();
    const el = new FakeElement('div');
    el.appendChild(block('P', 'Headline.'));
    const p = new FakeElement('P'); const strong = new FakeElement('STRONG'); strong.textContent = 'The big thread';
    p.appendChild(strong);
    el.appendChild(p);
    el.appendChild(block('P', long));
    assert.equal(ChatUI.foldAfterAnchor(el, { headings: ['The big thread'] }), true);
    assert.equal(ChatUI.foldAfterAnchor(el, { headings: ['The big thread'] }), false, 'idempotent: nothing left to fold after the details');
  });
});
