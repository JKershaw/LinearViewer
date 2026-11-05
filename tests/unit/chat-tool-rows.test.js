/**
 * LIN-3361 — `window.ChatUI.appendToolRow` / `foldAfterAnchor` (public/chat.js)
 * over the shared fake DOM (tests/unit/helpers/fake-dom.js) through `loadWorld`:
 * grouping by adjacency, settle/fail, scroll pinning, textContent-only rendering,
 * and the fold guards. Text-node linkifying and real <details> toggling are
 * proven in the e2e spec.
 *
 * The tree is asserted node by node. `children` is a fresh array on every read,
 * so the group's rows and the fold's nodes are checked by identity, one
 * `strictEqual` per position, never by a deep comparison of the node objects.
 * A grouping that puts the right rows in the wrong order, or the wrong node in
 * the group, goes red.
 *
 * Run with: node --test tests/unit/chat-tool-rows.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';

/**
 * A chat.js world with `window.isPinnedToBottom` answering `pinned`, and an
 * empty thread in the document. The fake does not lay out, so the scroll
 * numbers are plain values the client reads and writes: the thread starts at
 * the top and is 500 tall.
 */
function setup({ pinned = true } = {}) {
  const world = loadWorld({ window: { isPinnedToBottom: () => pinned }, scripts: ['chat.js'] });
  const { document } = world;
  const thread = document.createElement('ul');
  document.body.appendChild(thread);
  thread.scrollTop = 0;
  thread.scrollHeight = 500;
  return { ChatUI: world.window.ChatUI, document, thread };
}

const note = (document, text) => {
  const li = document.createElement('li');
  li.className = 'chat-note';
  li.textContent = text;
  return li;
};
const rowSummary = (li) => li.children[0].children[0];
const groupSummary = (g) => g.children[0].children[0];
const groupRows = (g) => g.children[0].children[1].children;

/** The same nodes, in the same order, by identity: one `strictEqual` per position. */
function assertSameNodes(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message}: count`);
  expected.forEach((node, i) => assert.strictEqual(actual[i], node, `${message}: node ${i}`));
}

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
    assertSameNodes(groupRows(group), [a.li, b.li], 'the group holds the two rows in order');
    assert.equal(groupSummary(group).textContent, 'checked 2 things …', 'pending while any member is pending');
    a.settle('{}'); b.settle('{}');
    assert.equal(groupSummary(group).textContent, 'checked 2 things');
    ChatUI.appendToolRow(thread, { label: 'c' });
    assert.equal(thread.children.length, 1);
    assert.equal(groupRows(group).length, 3);
  });

  test('any non-tool li between rows breaks the run (a proposal or note is never a member)', () => {
    const { ChatUI, thread, document } = setup();
    ChatUI.appendToolRow(thread, { label: 'a' });
    const proposal = document.createElement('li'); proposal.className = 'chat-msg fc-proposal-msg';
    thread.appendChild(proposal);
    ChatUI.appendToolRow(thread, { label: 'b' });
    assert.equal(thread.children.length, 3);
    assert.deepEqual(thread.children.map((c) => c.className), ['chat-tool-row', 'chat-msg fc-proposal-msg', 'chat-tool-row']);
    thread.appendChild(note(document, 'cap'));
    ChatUI.appendToolRow(thread, { label: 'c' });
    assert.equal(thread.children.length, 5, 'a note also breaks the run');
  });

  test('before: a row inserted before an anchor groups with the sibling that precedes the anchor', () => {
    const { ChatUI, thread, document } = setup();
    const answer = document.createElement('li'); answer.className = 'chat-msg';
    thread.appendChild(answer);
    const a = ChatUI.appendToolRow(thread, { label: 'a', before: answer });
    const b = ChatUI.appendToolRow(thread, { label: 'b', before: answer });
    assert.equal(thread.children.length, 2);
    assert.equal(thread.children[1], answer, 'the anchor stays last');
    assertSameNodes(groupRows(thread.children[0]), [a.li, b.li], 'the group holds the two rows in order');
  });

  test('a row inserted before a bubble joins the run that ends right there (adjacency is judged at the insertion point)', () => {
    const { ChatUI, thread, document } = setup();
    ChatUI.appendToolRow(thread, { label: 'a' });
    const bubble = document.createElement('li'); bubble.className = 'chat-msg';
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
  const block = (document, tag, text) => { const e = document.createElement(tag); e.textContent = text; return e; };
  const long = 'word '.repeat(80);

  test('moves the anchor and everything after it into a closed fold, keeping the headline', () => {
    const { ChatUI, document } = setup();
    const el = document.createElement('div');
    const head = block(document, 'p', 'All green.');
    const hr = block(document, 'hr', '');
    const body = block(document, 'p', long);
    [head, hr, body].forEach((n) => el.appendChild(n));
    assert.equal(ChatUI.foldAfterAnchor(el, { summary: 'full readout' }), true);
    assert.equal(el.children.length, 2);
    assert.equal(el.children[0], head);
    const fold = el.children[1];
    assert.equal(fold.className, 'chat-fold');
    assert.equal(fold.children[0].textContent, 'full readout');
    assert.equal(fold.children.length, 3, 'the summary, then the moved nodes');
    assertSameNodes(fold.children.slice(1), [hr, body], 'the same nodes moved, not copies');
  });

  test('does nothing: no anchor, nothing before the anchor, or a short tail', () => {
    const { ChatUI, document } = setup();
    const none = document.createElement('div'); none.appendChild(block(document, 'p', long));
    assert.equal(ChatUI.foldAfterAnchor(none, {}), false);
    assert.equal(none.children.length, 1);

    const lead = document.createElement('div'); lead.appendChild(block(document, 'h2', 'Readout')); lead.appendChild(block(document, 'p', long));
    assert.equal(ChatUI.foldAfterAnchor(lead, {}), false, 'an answer that opens with a heading has no headline to keep');

    const short = document.createElement('div'); short.appendChild(block(document, 'p', 'Headline.')); short.appendChild(block(document, 'h2', 'Details')); short.appendChild(block(document, 'p', 'tiny'));
    assert.equal(ChatUI.foldAfterAnchor(short, {}), false);
    assert.equal(short.children.length, 3);
  });

  test('bold-label fallback folds from the first known heading', () => {
    const { ChatUI, document } = setup();
    const el = document.createElement('div');
    el.appendChild(block(document, 'p', 'Headline.'));
    const p = document.createElement('p'); const strong = document.createElement('strong'); strong.textContent = 'The big thread';
    p.appendChild(strong);
    el.appendChild(p);
    el.appendChild(block(document, 'p', long));
    assert.equal(ChatUI.foldAfterAnchor(el, { headings: ['The big thread'] }), true);
    assert.equal(ChatUI.foldAfterAnchor(el, { headings: ['The big thread'] }), false, 'idempotent: nothing left to fold after the details');
  });
});
