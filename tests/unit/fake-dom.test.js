/**
 * LIN-4252 — the shared fake DOM (`tests/unit/helpers/fake-dom.js`) has a test for each thing it models, so a fake that
 * silently returns the wrong thing fails here before a client suite trusts it. Each test names the behaviour it proves.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDom, FakeDomError } from './helpers/fake-dom.js';

const world = () => createFakeDom();
const throwsNaming = (fn, text) => assert.throws(fn, (e) => e instanceof FakeDomError && e.message.includes(text), `expected a FakeDomError naming ${text}`);

describe('fake DOM: tree and identity', () => {
  test('the same node is returned for the same element, and a re-query finds it again', () => {
    const { parse, document } = world();
    parse('<ul><li class="row">a</li></ul>');
    const first = document.querySelector('.row');
    assert.equal(document.querySelector('.row'), first, 'the same node on every query');
    assert.equal(first.parentElement.localName, 'ul');
  });

  test('children are elements only, in order, and childNodes includes text', () => {
    const { parse, document } = world();
    parse('<div id="d">x<span>a</span> y<b>c</b></div>');
    const d = document.querySelector('[id="d"]');
    assert.deepEqual(d.children.map((c) => c.localName), ['span', 'b']);
    assert.ok(Array.isArray(d.children), 'children is a real array');
    assert.deepEqual(d.childNodes.map((n) => n.nodeType), [3, 1, 3, 1]);
  });

  test('appendChild, insertBefore and removeChild keep order, and removeChild on a non-child throws', () => {
    const { document } = world();
    const ul = document.createElement('ul');
    const a = document.createElement('li');
    const b = document.createElement('li');
    const c = document.createElement('li');
    ul.appendChild(a);
    ul.appendChild(c);
    ul.insertBefore(b, c);
    assert.deepEqual(ul.children, [a, b, c]);
    ul.removeChild(b);
    assert.deepEqual(ul.children, [a, c]);
    throwsNaming(() => ul.removeChild(b), 'not a child');
  });

  test('contains is inclusive and walks to the ancestor; a node never contains its ancestor', () => {
    const { document } = world();
    const outer = document.createElement('div');
    const inner = document.createElement('span');
    outer.appendChild(inner);
    assert.equal(outer.contains(inner), true);
    assert.equal(outer.contains(outer), true);
    assert.equal(inner.contains(outer), false);
    assert.equal(outer.contains(null), false);
    throwsNaming(() => inner.appendChild(outer), 'itself or a descendant');
  });

  test('isConnected is true only while the node reaches this world’s document', () => {
    const { document } = world();
    const div = document.createElement('div');
    const span = document.createElement('span');
    div.appendChild(span);
    assert.equal(span.isConnected, false, 'detached subtree');
    document.body.appendChild(div);
    assert.equal(span.isConnected, true, 'attached');
    span.remove();
    assert.equal(span.isConnected, false, 'removed');
  });

  test('textContent reads the descendant text and writes one text node; comments are not text', () => {
    const { parse, document } = world();
    parse('<p>a<!--hidden--><b>b</b></p>');
    const p = document.querySelector('p');
    assert.equal(p.textContent, 'ab');
    p.textContent = 'z';
    assert.equal(p.innerHTML, 'z');
  });
});

describe('fake DOM: innerHTML and outerHTML serialize like a browser, not like the source', () => {
  test('two serializations of different markup compare unequal (a repaint that changes a node is visible)', () => {
    const { parse, document } = world();
    parse('<div class="card"><span>one</span></div>');
    const before = document.querySelector('.card').outerHTML;
    document.querySelector('span').textContent = 'two';
    assert.notEqual(document.querySelector('.card').outerHTML, before);
  });

  test('a valueless attribute serializes as name="" (not the bare name the source had)', () => {
    const { parse, document } = world();
    parse('<input hidden data-question-slot>');
    assert.equal(document.querySelector('input').outerHTML, '<input hidden="" data-question-slot="">');
  });

  test('attributes keep their source order; the first of a repeated name wins', () => {
    const { parse, document } = world();
    parse('<a title="t" href="h" title="ignored"></a>');
    assert.equal(document.querySelector('a').outerHTML, '<a title="t" href="h"></a>');
  });

  test('&amp; and &quot; round-trip in an attribute; &#39; in text comes back as an apostrophe', () => {
    const { parse, document } = world();
    parse('<p data-q="a &amp; &quot;b&quot;">it&#039;s &amp; &lt;x&gt;</p>');
    const p = document.querySelector('p');
    assert.equal(p.getAttribute('data-q'), 'a & "b"');
    assert.equal(p.textContent, "it's & <x>");
    assert.equal(p.outerHTML, '<p data-q="a &amp; &quot;b&quot;">it\'s &amp; &lt;x&gt;</p>');
  });

  test('void elements have no end tag; script text is raw; template serializes its content', () => {
    const { parse, document } = world();
    parse('<div><br><img src="x"></div><script>if (a < b) {}</script><template><i>t</i></template>');
    assert.equal(document.querySelector('div').innerHTML, '<br><img src="x">');
    assert.equal(document.querySelector('script').innerHTML, 'if (a < b) {}');
    assert.equal(document.querySelector('template').innerHTML, '<i>t</i>');
    assert.equal(document.querySelector('template').children.length, 0, 'template children live in content');
  });

  test('the typed value is not in the markup, as in a browser', () => {
    const { parse, document } = world();
    parse('<textarea>seed</textarea>');
    const ta = document.querySelector('textarea');
    ta.value = 'typed';
    assert.equal(ta.outerHTML, '<textarea>seed</textarea>');
  });

  test('innerHTML set replaces the children with new nodes; the old children are detached', () => {
    const { parse, document } = world();
    parse('<div><span id="old">x</span></div>');
    const div = document.querySelector('div');
    const old = document.querySelector('#old');
    div.innerHTML = '<span id="new">y</span>';
    assert.equal(old.parentNode, null, 'the old child is detached');
    assert.notEqual(document.querySelector('#new'), old, 'a new node');
    assert.equal(old.isConnected, false);
  });

  test('outerHTML set swaps the node in its parent: new nodes, the old one detached and keeping nothing', () => {
    const { parse, document } = world();
    parse('<section><p id="slot">old</p><i>after</i></section>');
    const slot = document.querySelector('#slot');
    slot.outerHTML = '<p id="slot">new</p>';
    const fresh = document.querySelector('#slot');
    assert.notEqual(fresh, slot, 'a new node replaces the old');
    assert.equal(slot.parentNode, null, 'the old node is detached');
    assert.equal(slot.textContent, 'old', 'the old node keeps its own text');
    assert.equal(document.querySelector('section').innerHTML, '<p id="slot">new</p><i>after</i>', 'in the same place');
  });

  test('outerHTML set on a node with no parent does nothing (the DOM Parsing spec, not a throw)', () => {
    const { document } = world();
    const orphan = document.createElement('p');
    orphan.outerHTML = '<b>x</b>';
    assert.equal(orphan.parentNode, null);
    assert.equal(orphan.outerHTML, '<p></p>');
  });

  test('replaceWith keeps the replacement node’s identity and detaches the old node', () => {
    const { parse, document } = world();
    parse('<main><p id="a">a</p></main>');
    const a = document.querySelector('#a');
    const repl = document.createElement('p');
    a.replaceWith(repl);
    assert.equal(document.querySelector('main').children[0], repl, 'the replacement is the node in the tree');
    assert.equal(a.parentNode, null);
  });
});

describe('fake DOM: the parser refuses what it does not model', () => {
  test('a malformed tag throws', () => {
    const { parse } = world();
    throwsNaming(() => parse('<div class="x'), 'unterminated attribute value');
  });

  test('an unknown named entity throws instead of guessing', () => {
    const { parse } = world();
    throwsNaming(() => parse('<p>&nope;</p>'), 'unknown entity &nope;');
  });

  test('an end tag that does not close the open element throws', () => {
    const { parse } = world();
    throwsNaming(() => parse('<div><span></div>'), 'unexpected end tag </div>');
  });

  test('a doctype or other markup declaration throws; comments parse and serialize', () => {
    const { parse, document } = world();
    throwsNaming(() => parse('<!doctype html>'), 'only comments are modelled');
    parse('<!-- note --><p>k</p>');
    assert.equal(document.body.innerHTML, '<!-- note --><p>k</p>');
  });
});

describe('fake DOM: selectors match what a browser matches, and refuse what they do not', () => {
  const fixture = () => {
    const w = world();
    w.parse('<div class="box one" data-x="a"><p class="k">1</p><span><p class="k">2</p></span><input value="v"></div>');
    return w;
  };

  test('tag, class, [attr] and [attr="v"] match, and compound chains match all parts', () => {
    const { document } = fixture();
    assert.equal(document.querySelectorAll('p').length, 2);
    assert.equal(document.querySelectorAll('.box.one').length, 1);
    assert.equal(document.querySelectorAll('[data-x]').length, 1);
    assert.equal(document.querySelectorAll('div[data-x="a"]').length, 1);
    assert.equal(document.querySelectorAll('div[data-x="b"]').length, 0);
  });

  test('the descendant combinator matches at any depth; the child combinator matches only a direct child', () => {
    const { document } = fixture();
    assert.equal(document.querySelectorAll('.box p').length, 2);
    assert.equal(document.querySelectorAll('.box > p').length, 1);
  });

  test(':scope on a querySelectorAll starts the chain at the receiver, and its descendants only are returned', () => {
    const { document } = fixture();
    const box = document.querySelector('.box');
    assert.equal(box.querySelectorAll(':scope > .k').length, 1);
    assert.equal(box.querySelectorAll(':scope .k').length, 2);
    assert.equal(box.querySelectorAll('.box').length, 0, 'the receiver itself is not a result');
  });

  test(':not(...) excludes the listed compound selectors, and a comma list matches any of its parts', () => {
    const w = world();
    w.parse('<button>a</button><button disabled>b</button><input><a href="h">c</a>');
    const hits = w.document.querySelectorAll('button:not([disabled]), input, a[href]');
    assert.deepEqual(hits.map((e) => e.localName), ['button', 'input', 'a']);
  });

  test('closest includes the element itself and walks up parentElement', () => {
    const { document } = fixture();
    const k = document.querySelector('span p');
    assert.equal(k.closest('p'), k, 'itself');
    assert.equal(k.closest('.box').localName, 'div');
    assert.equal(k.closest('table'), null);
  });

  test('a selector the engine does not model throws, naming it, and never returns empty', () => {
    const { document } = fixture();
    for (const sel of ['p + span', 'p ~ span', '* ', 'p:has(span)', 'p:nth-child(2)', 'p:hover', 'p::before', '[class^="k"]']) {
      throwsNaming(() => document.querySelectorAll(sel), 'unsupported selector');
    }
  });

  test('a :not() that takes a combinator throws', () => {
    const { document } = fixture();
    throwsNaming(() => document.querySelectorAll('div:not(.box p)'), 'compound selectors only');
  });
});

describe('fake DOM: form state', () => {
  test('an input’s value starts from its value attribute and is independent once it is set', () => {
    const { parse, document } = world();
    parse('<input value="seed">');
    const input = document.querySelector('input');
    assert.equal(input.value, 'seed');
    input.value = 'typed';
    input.setAttribute('value', 'later');
    assert.equal(input.value, 'typed', 'the attribute no longer governs once the value is set');
  });

  test('a textarea’s value starts from its text, and the caret starts and moves to the end of the value', () => {
    const { parse, document } = world();
    parse('<textarea>ab</textarea>');
    const ta = document.querySelector('textarea');
    assert.equal(ta.value, 'ab');
    assert.equal(ta.selectionStart, 2);
    ta.value = 'abcd';
    assert.equal(ta.selectionEnd, 4);
  });

  test('setSelectionRange places and clamps the caret', () => {
    const { parse, document } = world();
    parse('<input value="hello">');
    const input = document.querySelector('input');
    input.setSelectionRange(1, 3);
    assert.equal(input.selectionStart, 1);
    assert.equal(input.selectionEnd, 3);
    input.setSelectionRange(0, 99);
    assert.equal(input.selectionEnd, 5, 'clamped to the value length');
  });

  test('value is undefined on a non-control, and setting it there throws', () => {
    const { document } = world();
    const div = document.createElement('div');
    assert.equal(div.value, undefined);
    throwsNaming(() => { div.value = 'x'; }, 'value is not modelled');
  });
});

describe('fake DOM: focus is per world and follows the node', () => {
  test('focus() on a focusable control makes it document.activeElement', () => {
    const { parse, document } = world();
    parse('<input id="i"><button id="b">b</button>');
    const i = document.querySelector('#i');
    i.focus();
    assert.equal(document.activeElement, i);
  });

  test('focus in world A leaves world B’s activeElement alone', () => {
    const a = world();
    const b = world();
    a.parse('<input id="x">');
    b.parse('<input id="y">');
    a.document.querySelector('#x').focus();
    assert.equal(a.document.activeElement, a.document.querySelector('#x'));
    assert.equal(b.document.activeElement, b.document.body, 'world B is untouched');
  });

  test('a focused control that is replaced is no longer activeElement', () => {
    const { parse, document } = world();
    parse('<div><input id="t" value="w"></div>');
    const t = document.querySelector('#t');
    t.focus();
    t.outerHTML = '<input id="t" value="w">';
    assert.notEqual(document.activeElement, t, 'the old control has lost focus');
    assert.equal(document.activeElement, document.body);
  });

  test('a focused control inside a removed subtree loses focus with it', () => {
    const { parse, document } = world();
    parse('<section><input id="t"></section>');
    document.querySelector('#t').focus();
    document.querySelector('section').remove();
    assert.equal(document.activeElement, document.body);
  });

  test('a removed focused control does not regain focus when it is put back (the focus fixup, not just isConnected)', () => {
    const { parse, document } = world();
    parse('<section><input id="t"></section>');
    const t = document.querySelector('#t');
    t.focus();
    t.remove();
    document.body.appendChild(t);
    assert.equal(t.isConnected, true);
    assert.equal(document.activeElement, document.body, 'focus was lost on removal, so putting it back does not restore it');
  });

  test('focus() on a disabled control or a plain div does nothing', () => {
    const { parse, document } = world();
    parse('<button disabled id="d">x</button><div id="p">y</div>');
    document.querySelector('#d').focus();
    document.querySelector('#p').focus();
    assert.equal(document.activeElement, document.body);
  });

  test('document.activeElement can be set directly (the 4242 witness assigns it)', () => {
    const { parse, document } = world();
    parse('<textarea id="t"></textarea>');
    const t = document.querySelector('#t');
    document.activeElement = t;
    assert.equal(document.activeElement, t);
  });
});

describe('fake DOM: attributes, data, classes and listeners', () => {
  test('dataset is kebab-cased both ways, and assignment and delete reach the attribute', () => {
    const { document } = world();
    const el = document.createElement('div');
    el.dataset.answerInFlight = 'true';
    assert.equal(el.getAttribute('data-answer-in-flight'), 'true');
    assert.equal(el.dataset.answerInFlight, 'true');
    assert.deepEqual(Object.keys(el.dataset), ['answerInFlight']);
    delete el.dataset.answerInFlight;
    assert.equal(el.hasAttribute('data-answer-in-flight'), false);
    assert.equal(el.dataset.answerInFlight, undefined);
  });

  test('classList add, remove and toggle with force, and a removal that leaves nothing creates no empty class attribute', () => {
    const { document } = world();
    const el = document.createElement('div');
    el.classList.add('a', 'b');
    el.classList.remove('a');
    assert.equal(el.classList.contains('b'), true);
    assert.equal(el.classList.toggle('c', true), true);
    assert.equal(el.classList.toggle('c', false), false);
    assert.equal(el.getAttribute('class'), 'b');
    const bare = document.createElement('span');
    bare.classList.remove('none');
    assert.equal(bare.hasAttribute('class'), false, 'no class attribute is created by a no-op');
  });

  test('hidden and disabled reflect their attributes', () => {
    const { document } = world();
    const b = document.createElement('button');
    b.disabled = true;
    b.hidden = true;
    assert.equal(b.outerHTML, '<button disabled="" hidden=""></button>');
    b.disabled = false;
    assert.equal(b.hasAttribute('disabled'), false);
  });

  test('listeners are recorded per type, not duplicated, and removable; dispatchEvent is inert', () => {
    const { document } = world();
    const el = document.createElement('div');
    const fn = () => {};
    el.addEventListener('click', fn);
    el.addEventListener('click', fn);
    el.addEventListener('keydown', () => {});
    assert.deepEqual(el.listenersOf('click'), [fn]);
    el.removeEventListener('click', fn);
    assert.deepEqual(el.listenersOf('click'), []);
    assert.equal(el.dispatchEvent({ type: 'click' }), true);
  });
});
