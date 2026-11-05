/**
 * LIN-4252 — the shared fake DOM (`tests/unit/helpers/fake-dom.js`) has a test for each thing it models, so a fake that
 * silently returns the wrong thing fails here before a client suite trusts it. Each test names the behaviour it proves.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDom, FakeDomError } from './helpers/fake-dom.js';
import { loadWorld, clickOn } from './helpers/client-world.js';
import { withHarnessModels } from '../fixtures/harness-models.js';
import { harnessModelsBlock, DEFAULT_HARNESS } from '../../lib/model-routing-harnesses.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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

  test('[attr^="v"] matches a value that starts with v; an empty v matches nothing (CSS: LIN-4279)', () => {
    const w = world();
    w.parse('<p class="k">a</p><p class="kk">b</p><p class="xk">c</p><p class="kx">d</p>');
    const texts = (sel) => w.document.querySelectorAll(sel).map((e) => e.textContent);
    assert.deepEqual(texts('p[class^="k"]'), ['a', 'b', 'd']);
    assert.equal(w.document.querySelectorAll('p[class^=""]').length, 0, 'an empty value matches nothing');
  });

  test('[attr$="v"] matches a value that ends with v (LIN-4279)', () => {
    const w = world();
    w.parse('<p class="k">a</p><p class="kk">b</p><p class="xk">c</p><p class="kx">d</p>');
    assert.deepEqual(w.document.querySelectorAll('p[class$="k"]').map((e) => e.textContent), ['a', 'b', 'c']);
  });

  test('[attr*="v"] matches a value that contains v (LIN-4279)', () => {
    const w = world();
    w.parse('<p class="k">a</p><p class="kk">b</p><p class="xk">c</p><p class="zz">d</p>');
    assert.deepEqual(w.document.querySelectorAll('p[class*="k"]').map((e) => e.textContent), ['a', 'b', 'c']);
  });

  test('~= and |= still throw, and the error names the selector (LIN-4279)', () => {
    const { document } = fixture();
    throwsNaming(() => document.querySelectorAll('[class~=k]'), '[class~=k]');
    throwsNaming(() => document.querySelectorAll('[lang|=en]'), '[lang|=en]');
  });

  test('a selector the engine does not model throws, naming it, and never returns empty', () => {
    const { document } = fixture();
    for (const sel of ['p + span', 'p ~ span', '* ', 'p:has(span)', 'p:nth-child(2)', 'p:hover', 'p::before', '[class~="k"]', '[lang|="en"]']) {
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
    const w = world();
    const { document } = w;
    const b = document.createElement('button');
    b.disabled = true;
    b.hidden = true;
    assert.equal(b.outerHTML, '<button disabled="" hidden=""></button>');
    b.disabled = false;
    assert.equal(b.hasAttribute('disabled'), false);
    // The getter reads a parsed attribute, and a set disabled drops the button out of :not([disabled]).
    w.parse('<button id="p" disabled>a</button><button id="q">b</button>');
    assert.equal(document.querySelector('#p').disabled, true);
    assert.equal(document.querySelector('#q').disabled, false);
    document.querySelector('#q').disabled = true;
    assert.equal(document.querySelectorAll('button:not([disabled])').length, 0);
  });

  test("an input with no type attribute reads type 'text', and setting type reflects to the attribute", () => {
    const w = world();
    const { document } = w;
    w.parse('<input id="a"><input id="b" type="CHECKBOX"><button id="c">x</button><button id="d" type="button">y</button>');
    assert.equal(document.querySelector('#a').type, 'text');
    assert.equal(document.querySelector('#b').type, 'checkbox');
    assert.equal(document.querySelector('#c').type, 'submit');
    assert.equal(document.querySelector('#d').type, 'button');
    assert.equal(document.createElement('div').type, '');
    const b = document.createElement('button');
    b.type = 'button';
    assert.equal(b.outerHTML, '<button type="button"></button>');
    const i = document.createElement('input');
    i.type = 'password';
    assert.equal(i.type, 'password');
    assert.equal(i.getAttribute('type'), 'password');
  });

  test('checked starts from the attribute, then is independent and is not serialized', () => {
    const w = world();
    const { document } = w;
    w.parse('<input id="a" type="checkbox" checked><input id="b" type="checkbox">');
    const a = document.querySelector('#a');
    const b = document.querySelector('#b');
    assert.equal(a.checked, true);
    assert.equal(b.checked, false);
    a.checked = false;
    b.checked = true;
    assert.equal(a.checked, false);
    assert.equal(b.checked, true);
    assert.equal(a.hasAttribute('checked'), true, 'the attribute is the default, not the live state');
    assert.equal(b.hasAttribute('checked'), false);
    assert.equal(b.outerHTML, '<input id="b" type="checkbox">');
    assert.equal(document.createElement('div').checked, undefined);
    assert.throws(() => { document.createElement('div').checked = true; }, /checked is not modelled/);
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

describe('fake DOM: className and id reflect the class and id attributes (LIN-4270)', () => {
  test('assigning className sets the class attribute: classList, querySelector and the serialized markup all follow', () => {
    const { document } = world();
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.className = 'card wide';
    assert.equal(el.classList.contains('card'), true);
    assert.equal(el.classList.contains('wide'), true);
    assert.equal(document.querySelector('.card.wide'), el);
    assert.equal(el.outerHTML, '<div class="card wide"></div>');
  });

  test('classList.add and classList.remove are visible through className and the serialized markup', () => {
    const { document } = world();
    const el = document.createElement('span');
    document.body.appendChild(el);
    el.classList.add('a', 'b');
    assert.equal(el.className, 'a b');
    assert.equal(el.outerHTML, '<span class="a b"></span>');
    el.classList.remove('a');
    assert.equal(el.className, 'b');
    assert.equal(document.querySelector('.b'), el);
    assert.equal(document.querySelector('.a'), null, 'the removed class no longer matches');
  });

  test('className read back returns the class attribute as written, and setAttribute("class") is seen by className', () => {
    const { document } = world();
    const el = document.createElement('p');
    document.body.appendChild(el);
    el.setAttribute('class', 'p  q');
    assert.equal(el.className, 'p  q', 'the raw attribute string, as a browser returns it');
    assert.equal(document.querySelector('.p.q'), el);
    el.className = 'r';
    assert.equal(el.getAttribute('class'), 'r', 'the attribute is what className writes');
    assert.equal(el.hasAttribute('class'), true);
  });

  test('assigning className to an element that has other attributes appends class after them, in serialized order', () => {
    const { parse, document } = world();
    parse('<p data-x="1">t</p>');
    const p = document.querySelector('p');
    p.className = 'k';
    assert.equal(p.outerHTML, '<p data-x="1" class="k">t</p>');
    assert.equal(document.querySelector('p[data-x="1"].k'), p);
  });

  test('className = "" leaves an empty class attribute in the markup, as a browser does', () => {
    const { document } = world();
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.className = 'x';
    el.className = '';
    assert.equal(el.hasAttribute('class'), true, 'the attribute stays, empty');
    assert.equal(el.outerHTML, '<div class=""></div>');
    assert.equal(document.querySelector('.x'), null);
  });

  test('assigning id makes #id queries find the element, and the id attribute is serialized', () => {
    const { parse, document } = world();
    parse('<div></div>');
    const el = document.querySelector('div');
    el.id = 'a';
    assert.equal(document.querySelector('#a'), el);
    assert.equal(el.getAttribute('id'), 'a');
    assert.equal(el.outerHTML, '<div id="a"></div>');
  });

  test('reading id reflects setAttribute("id"), and an element with no id reads it as the empty string', () => {
    const { document } = world();
    const el = document.createElement('section');
    document.body.appendChild(el);
    assert.equal(el.id, '', 'no id attribute reads as the empty string');
    el.setAttribute('id', 'z');
    assert.equal(el.id, 'z', 'the id attribute is the value read back');
    assert.equal(document.querySelector('#z'), el);
  });
});

describe('fake DOM: getElementById (LIN-4279)', () => {
  test('getElementById returns the first connected match in tree order, and null when there is none', () => {
    const { parse, document } = world();
    parse('<div><p id="dup">first</p></div><span id="dup">second</span>');
    assert.equal(document.getElementById('dup'), document.querySelector('p'), 'the first match in tree order');
    assert.equal(document.getElementById('absent'), null);
  });

  test('getElementById finds nothing in a detached subtree, and finds the node once it is connected', () => {
    const { document } = world();
    const el = document.createElement('section');
    el.id = 'loose';
    assert.equal(document.getElementById('loose'), null, 'detached: not found');
    document.body.appendChild(el);
    assert.equal(document.getElementById('loose'), el, 'connected: found');
  });

  test('getElementById does not search a template’s content, which is not in the document', () => {
    const { parse, document } = world();
    parse('<template><i id="t">x</i></template><b id="u">y</b>');
    assert.equal(document.getElementById('u').localName, 'b', 'a connected element outside the template is found');
    assert.equal(document.getElementById('t'), null, 'template content is not in the document');
    assert.equal(document.querySelector('template').content.querySelector('#t').localName, 'i', 'the content does hold it');
  });
});

describe('fake DOM: named entities the server output uses (LIN-4279)', () => {
  test('&middot; decodes to U+00B7 and serializes as the literal character', () => {
    const { parse, document } = world();
    parse('<p>a&middot;b</p>');
    const p = document.querySelector('p');
    assert.equal(p.textContent, 'a·b');
    assert.equal(p.innerHTML, 'a·b');
  });

  test('&mdash; decodes to U+2014', () => {
    const { parse, document } = world();
    parse('<p>a&mdash;b</p>');
    assert.equal(document.querySelector('p').textContent, 'a—b');
  });

  test('&hellip; decodes to U+2026', () => {
    const { parse, document } = world();
    parse('<p>wait&hellip;</p>');
    assert.equal(document.querySelector('p').textContent, 'wait…');
  });

  test('&times; decodes to U+00D7', () => {
    const { parse, document } = world();
    parse('<p>2&times;3</p>');
    assert.equal(document.querySelector('p').textContent, '2×3');
  });
});

describe('fake DOM: createElementNS keeps SVG names as written (LIN-4279)', () => {
  const SVG = 'http://www.w3.org/2000/svg';

  test('an SVG-namespace element has tagName and localName "svg", not upper-cased', () => {
    const { document } = world();
    const svg = document.createElementNS(SVG, 'svg');
    assert.equal(svg.tagName, 'svg');
    assert.equal(svg.localName, 'svg');
    assert.equal(svg.namespaceURI, SVG);
  });

  test('a mixed-case SVG name is pinned as written, in localName and tagName', () => {
    const { document } = world();
    const grad = document.createElementNS(SVG, 'linearGradient');
    assert.equal(grad.localName, 'linearGradient');
    assert.equal(grad.tagName, 'linearGradient');
    document.body.appendChild(grad);
    assert.equal(document.querySelector('linearGradient'), grad, 'a type selector matches the name as written');
    assert.equal(document.querySelector('lineargradient'), null, 'a type selector is case-sensitive off the HTML namespace');
  });

  test('attribute names on a namespaced element keep their case (viewBox); an HTML element still lower-cases them', () => {
    const { document } = world();
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 10 10');
    assert.equal(svg.getAttribute('viewBox'), '0 0 10 10');
    assert.equal(svg.getAttribute('viewbox'), null, 'the name is stored as written');
    assert.equal(svg.outerHTML, '<svg viewBox="0 0 10 10"></svg>');
    const div = document.createElement('div');
    div.setAttribute('viewBox', 'x');
    assert.equal(div.getAttribute('viewbox'), 'x', 'HTML attribute names are lower-cased');
  });
});

describe('fake DOM: replaceChild, replaceChildren, insertAdjacentHTML, append and prepend (LIN-4279)', () => {
  test('replaceChild puts the new node in the old one’s place, returns the old node, and detaches it', () => {
    const { parse, document } = world();
    parse('<ul><li id="a">a</li><li id="b">b</li><li id="c">c</li></ul>');
    const ul = document.querySelector('ul');
    const old = document.querySelector('#b');
    const repl = document.createElement('li');
    repl.id = 'n';
    assert.equal(ul.replaceChild(repl, old), old, 'returns the old node');
    assert.equal(old.parentNode, null, 'the old node is detached');
    assert.equal(ul.innerHTML, '<li id="a">a</li><li id="n"></li><li id="c">c</li>', 'the new node is in the same place');
  });

  test('replaceChild throws FakeDomError when the old node is not a child, and changes nothing', () => {
    const { parse, document } = world();
    parse('<ul><li id="a">a</li></ul><p id="other">x</p>');
    const ul = document.querySelector('ul');
    const stranger = document.querySelector('#other');
    const before = ul.innerHTML;
    throwsNaming(() => ul.replaceChild(document.createElement('li'), stranger), 'not a child');
    assert.equal(ul.innerHTML, before, 'the parent is unchanged');
    assert.equal(stranger.isConnected, true, 'the stranger is untouched');
  });

  test('replaceChildren(...nodes) replaces every child with the given nodes, in order, and detaches the old ones', () => {
    const { parse, document } = world();
    parse('<div><i id="x">x</i><i id="y">y</i></div>');
    const div = document.querySelector('div');
    const old = document.querySelector('#x');
    const p = document.createElement('p');
    const span = document.createElement('span');
    div.replaceChildren(p, span);
    assert.deepEqual(div.children, [p, span]);
    assert.equal(old.parentNode, null, 'the old child is detached');
    assert.equal(div.innerHTML, '<p></p><span></span>');
  });

  test('replaceChildren with a string puts a text node in its place', () => {
    const { parse, document } = world();
    parse('<div><i>x</i></div>');
    const div = document.querySelector('div');
    div.replaceChildren('t', document.createElement('p'));
    assert.equal(div.childNodes[0].nodeType, 3);
    assert.equal(div.innerHTML, 't<p></p>');
  });

  test('replaceChildren() with no arguments empties the element, text nodes included', () => {
    const { parse, document } = world();
    parse('<div><i>a</i>text<b>b</b></div>');
    const div = document.querySelector('div');
    const i = document.querySelector('i');
    div.replaceChildren();
    assert.equal(div.childNodes.length, 0, 'no child nodes remain');
    assert.equal(div.innerHTML, '');
    assert.equal(i.parentNode, null, 'the old child is detached');
  });

  test('insertAdjacentHTML("beforeend", html) appends the parsed nodes after the existing children', () => {
    const { parse, document } = world();
    parse('<ul><li>a</li></ul>');
    const ul = document.querySelector('ul');
    const first = ul.children[0];
    ul.insertAdjacentHTML('beforeend', '<li>b</li><li>c</li>');
    assert.equal(ul.children[0], first, 'the existing child stays first');
    assert.equal(ul.innerHTML, '<li>a</li><li>b</li><li>c</li>');
  });

  test('insertAdjacentHTML takes its position ASCII case-insensitively, as the DOM spec does (BeforeEnd is beforeend)', () => {
    const { parse, document } = world();
    parse('<ul><li>a</li></ul>');
    const ul = document.querySelector('ul');
    ul.insertAdjacentHTML('BeforeEnd', '<li>b</li>');
    assert.equal(ul.innerHTML, '<li>a</li><li>b</li>');
  });

  test('insertAdjacentHTML throws FakeDomError for every position except beforeend, and changes nothing', () => {
    const { parse, document } = world();
    parse('<ul><li>a</li></ul>');
    const ul = document.querySelector('ul');
    const before = ul.innerHTML;
    for (const pos of ['beforebegin', 'afterbegin', 'afterend', 'nonsense', '']) {
      throwsNaming(() => ul.insertAdjacentHTML(pos, '<li>x</li>'), 'only "beforeend" is modelled');
    }
    assert.equal(ul.innerHTML, before, 'no position other than beforeend changed the element');
  });

  test('append(...nodes) adds nodes at the end, and a string becomes a text node', () => {
    const { parse, document } = world();
    parse('<ul><li id="a">a</li></ul>');
    const ul = document.querySelector('ul');
    const li = document.createElement('li');
    ul.append(li, 'tail');
    assert.equal(ul.childNodes[1], li, 'the node is appended');
    assert.equal(ul.childNodes[2].nodeType, 3, 'the string is a text node');
    assert.equal(ul.childNodes[2].data, 'tail');
    assert.equal(ul.innerHTML, '<li id="a">a</li><li></li>tail');
  });

  test('prepend(...nodes) inserts before the first child, in argument order, and a string becomes a text node', () => {
    const { parse, document } = world();
    parse('<ul><li id="a">a</li></ul>');
    const ul = document.querySelector('ul');
    const x = document.createElement('li');
    x.id = 'x';
    ul.prepend(x, 'head');
    assert.equal(ul.childNodes[0], x, 'the node is first');
    assert.equal(ul.childNodes[1].nodeType, 3, 'the string is a text node, second');
    assert.equal(ul.innerHTML, '<li id="x"></li>head<li id="a">a</li>');
  });
});

describe('fake DOM: firstElementChild and lastElementChild (LIN-4279)', () => {
  const fixture = () => {
    const w = world();
    w.parse('<div>text<!--c--><b id="a">a</b>more<i id="z">z</i>tail</div><p>only text</p>');
    return w;
  };

  test('firstElementChild is the first element child, skipping text and comments, and null when there is none', () => {
    const { document } = fixture();
    assert.equal(document.querySelector('div').firstElementChild, document.querySelector('#a'));
    assert.equal(document.querySelector('p').firstElementChild, null, 'a node with only text has no element child');
  });

  test('lastElementChild is the last element child, skipping text, and null when there is none', () => {
    const { document } = fixture();
    assert.equal(document.querySelector('div').lastElementChild, document.querySelector('#z'));
    assert.equal(document.querySelector('p').lastElementChild, null, 'a node with only text has no element child');
  });
});

describe('client world: stubs are copied by descriptor, and loadWorld routes to common.js (LIN-4279)', () => {
  // A spread copy reads every getter; a descriptor copy never does. The getter counts its reads and throws, as a blocked
  // localStorage does (lin-4035: "a storage that throws on read").
  const throwingStorage = (target) => {
    const reads = { count: 0 };
    Object.defineProperty(target, 'localStorage', {
      enumerable: true,
      configurable: true,
      get() { reads.count++; throw new Error('storage throws on read'); },
    });
    return reads;
  };

  test('window stubs are copied by descriptor: a throwing localStorage getter is not invoked at load', () => {
    const stubs = {};
    const reads = throwingStorage(stubs);
    const w = loadWorld({ window: stubs, scripts: [] });
    assert.equal(reads.count, 0, 'the getter was not invoked while copying');
    assert.equal(typeof Object.getOwnPropertyDescriptor(w.window, 'localStorage').get, 'function', 'the accessor is kept');
  });

  test('globals are copied by descriptor too: a throwing localStorage global is not invoked at load', () => {
    const globals = {};
    const reads = throwingStorage(globals);
    const w = loadWorld({ scripts: [], globals });
    assert.equal(reads.count, 0, 'the getter was not invoked while copying');
    assert.equal(typeof Object.getOwnPropertyDescriptor(w.sandbox, 'localStorage').get, 'function', 'the accessor is kept');
  });

  test('loadWorld runs the real common.js when window.__HARNESS_MODELS__ carries the block', () => {
    const w = loadWorld({ window: { __HARNESS_MODELS__: harnessModelsBlock() }, scripts: ['common.js'] });
    assert.equal(vm.runInContext('DEFAULT_HARNESS', w.sandbox), DEFAULT_HARNESS);
  });

  test('loadWorld does not apply withHarnessModels to common.js: without the block, common.js refuses to load', () => {
    assert.throws(() => loadWorld({ scripts: ['common.js'] }), /window\.__HARNESS_MODELS__ is missing/);
  });

  test('scripts: [] with the source run by the caller on world.sandbox, under withHarnessModels, also loads common.js', () => {
    const w = loadWorld({ scripts: [] });
    const src = readFileSync(new URL('../../public/common.js', import.meta.url), 'utf8');
    vm.runInContext(withHarnessModels(src), w.sandbox, { filename: 'common.js' });
    assert.equal(vm.runInContext('DEFAULT_HARNESS', w.sandbox), DEFAULT_HARNESS);
  });

  test('clickOn calls the element’s own click listeners with { type: "click", target } (LIN-4279)', async () => {
    const { document } = world();
    const btn = document.createElement('button');
    const seen = [];
    btn.addEventListener('click', (e) => seen.push(e));
    await clickOn(btn);
    assert.equal(seen.length, 1, 'one listener call');
    assert.equal(seen[0].type, 'click');
    assert.equal(seen[0].target, btn);
  });

  test('clickOn does not bubble to a parent, and dispatchEvent stays inert (LIN-4279)', async () => {
    const { document } = world();
    const parent = document.createElement('div');
    const child = document.createElement('button');
    parent.appendChild(child);
    let parentCalls = 0;
    let childCalls = 0;
    parent.addEventListener('click', () => { parentCalls++; });
    child.addEventListener('click', () => { childCalls++; });
    await clickOn(child);
    assert.equal(childCalls, 1, 'the element’s own listener ran');
    assert.equal(parentCalls, 0, 'no bubbling');
    child.dispatchEvent({ type: 'click', target: child });
    assert.equal(childCalls, 1, 'dispatchEvent does not reach the listeners');
  });
});
