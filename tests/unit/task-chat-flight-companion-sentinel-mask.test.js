/**
 * LIN-2437 (A.11) — Flight Companion sessions save transcripts through Task
 * Chat's existing saved-chat CRUD endpoint under the sentinel task identifier
 * 'flight-companion' (not a real task id). The sentinel is never rewritten in
 * storage (lib/saved-chat-store.js is untouched); it must instead be masked
 * at render time on every user-visible surface in public/task-chat.js that
 * echoes a saved chat's task identifier, via the ONE shared
 * `maskFlightCompanionSentinel` helper. The four surfaces: the saved-row meta
 * chip, the saved-row title (including its "Chat about …" auto-derived
 * fallback — deriveTitle() in lib/saved-chat-store.js falls back to that when
 * an assistant-only companion transcript has no user turn to title itself
 * from), the active label shown when a saved companion chat is resumed, and
 * the speaker pill on every assistant bubble the resume replay renders
 * (review finding 1 — the loudest of the four, since an assistant-only
 * transcript repeats it once per stored turn).
 *
 * task-chat.js is a browser script (an IIFE, not a module) whose helpers live
 * inside `init`, so these tests run real source slices of it into one
 * `loadWorld` world (LIN-4284): the slices run with `world.run`, and the DOM they
 * touch is real nodes from the shared fake (`tests/unit/helpers/fake-dom.js`).
 * Collaborators that are not DOM (the ChatUI helper, the api call, the toast,
 * appendBubble and friends) stay as doubles that record what they were given.
 *
 * Run with: node --test tests/unit/task-chat-flight-companion-sentinel-mask.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld } from './helpers/client-world.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_CHAT_JS_SRC = readFileSync(join(__dirname, '../../public/task-chat.js'), 'utf8');

function extractMaskFnSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('var FLIGHT_COMPANION_SENTINEL');
  assert.notEqual(start, -1, 'FLIGHT_COMPANION_SENTINEL found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n    function updateSaveVisibility', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

function extractRenderSavedRowsSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('var FLIGHT_COMPANION_SENTINEL');
  assert.notEqual(start, -1, 'FLIGHT_COMPANION_SENTINEL found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n    function loadSavedList', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

// `appendBubble` is declared ABOVE the mask helper in the file, so its slice is
// taken separately and run into the same world after the mask slice — the
// real file relies on hoisting for the same call, which a single contiguous
// slice could not reproduce.
//
// LIN-2445 widened the signature to `(role, text, state)` and added
// `setBubbleState` + `PILL_GLYPHS` between this function and the next one.
// That is deliberate: they are the pill's write path either side of the
// turn, and keeping them in one slice is what lets the tests below drive
// both. LIN-2632 lifted `toolBreadcrumbLabel` (the function that used to
// follow) into the shared window.ChatUI, so the end marker is now the next
// remaining top-level function, `appendToolBreadcrumb`.
function extractAppendBubbleSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('  function appendBubble(role, text, state) {');
  assert.notEqual(start, -1, 'appendBubble found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n    function appendToolBreadcrumb', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

// LIN-2445 — the pill's two write paths, at the unit level. The end-to-end
// witnesses are in tests/e2e/task-chat.spec.js; these pin the mechanism
// directly so a regression names the function rather than a rendered class.
// LIN-2483/LIN-2634 — openSavedChat's empty-field fix: resuming a companion
// sentinel chat must never seed the raw sentinel into idInput.value (which
// isValidIssueId would pass, so send() would post it as an issue id and
// 404). activeTask keeps the sentinel either way, so the label/pill/save
// path (which all read activeTask, not idInput.value) are unaffected.
function extractOpenSavedChatSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('  function openSavedChat(id) {');
  assert.notEqual(start, -1, 'openSavedChat found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n    function deleteSavedChat', start);
  assert.notEqual(end, -1, 'the next top-level function marks the end of the slice');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

// LIN-2483/LIN-2634 — send()'s label-rebuild mask, on the whole-function
// slice + never-settling fetch technique (correction 2): the harness parses
// whole top-level statements between markers, so a partial-body slice up to
// the label assignment (stopping short of the raw fetch call, the original
// plan's technique) cannot parse. The label assignment runs synchronously
// BEFORE the fetch call, so a fetch that never settles is sufficient — no
// downstream SSE/tool-breadcrumb machinery needs to exist in the sandbox.
function extractSendSrc() {
  const start = TASK_CHAT_JS_SRC.indexOf('  function send() {');
  assert.notEqual(start, -1, 'send found in public/task-chat.js');
  const end = TASK_CHAT_JS_SRC.indexOf('\n    sendBtn.addEventListener', start);
  assert.notEqual(end, -1, 'the whole send() function body must be captured before the next top-level statement');
  return TASK_CHAT_JS_SRC.slice(start, end);
}

// ─── Worlds ─────────────────────────────────────────────────────────────────
// Each helper makes one loadWorld world with no public/ scripts (`scripts: []`),
// runs the slices it needs into it, and hands back the world. The DOM the
// slices touch is built from `world.document` (real nodes), so the assertions
// read the tree the client actually wrote.

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A `<li>` shaped the way ChatUI.appendMessage renders a turn: a body span
// (`.task-chat-msg-body`) and the `.chat-msg__who` pill setBubbleState looks up.
function turnLi(doc) {
  const li = doc.createElement('li');
  const body = doc.createElement('span');
  body.className = 'task-chat-msg-body';
  li.appendChild(body);
  return li;
}

// A bubble <li> with a pill in its in-progress state, carrying the
// `.status-pill__char` glyph node setBubbleState rewrites.
function pillLi(doc) {
  const li = doc.createElement('li');
  const pill = doc.createElement('span');
  pill.className = 'status-pill chat-msg__who status-pill--in-progress';
  const char = doc.createElement('span');
  char.className = 'status-pill__char';
  char.textContent = '◐';
  pill.appendChild(char);
  li.appendChild(pill);
  return { li, pill, char };
}

function input(doc, value) {
  const el = doc.createElement('input');
  el.value = value;
  return el;
}

// renderSavedRows only needs the list, the empty note, and escapeHtml.
function savedRowsWorld() {
  const world = loadWorld({ window: { escapeHtml }, scripts: [] });
  const doc = world.document;
  Object.assign(world.sandbox, {
    savedList: doc.createElement('ul'),
    savedEmpty: doc.createElement('div'),
  });
  world.run(extractRenderSavedRowsSrc());
  return world;
}

// appendBubble: the ChatUI stub captures the opts handed to the shared helper,
// which is where the speaker-pill label (`who`) is decided, and returns a turn
// <li> built from the real fake.
function bubbleWorld(activeTask) {
  const captured = [];
  let world;
  world = loadWorld({
    window: {
      ChatUI: {
        appendMessage: (_transcript, opts) => {
          captured.push(opts);
          return turnLi(world.document);
        },
      },
    },
    scripts: [],
  });
  Object.assign(world.sandbox, {
    activeTask,
    transcript: world.document.createElement('ol'),
    setEmptyVisible: () => {},
  });
  world.run(extractMaskFnSrc());
  world.run(extractAppendBubbleSrc());
  return { world, sandbox: world.sandbox, captured };
}

function openSavedChatWorld({ apiResponse, apiRejects = false } = {}) {
  const appendBubbleCalls = [];
  const toasts = [];
  const world = loadWorld({
    window: {
      api: () => (apiRejects ? Promise.reject(new Error('fail')) : Promise.resolve(apiResponse)),
      ChatUI: { renderMarkdownText: () => {} },
      toast: (msg, opts) => { toasts.push({ msg, opts }); },
    },
    scripts: [],
  });
  const doc = world.document;
  Object.assign(world.sandbox, {
    urlKey: 'acme',
    activeTask: '',
    chatHistory: [],
    idInput: input(doc, ''),
    questionInput: doc.createElement('input'),
    transcript: doc.createElement('ol'),
    activeLabel: doc.createElement('span'),
    resetBtn: doc.createElement('button'),
    setEmptyVisible: () => {},
    updateSaveVisibility: () => {},
    appendBubble: (role, text, state) => {
      appendBubbleCalls.push({ role, text, state });
      return doc.createElement('span');
    },
  });
  world.run(extractMaskFnSrc());
  world.run(extractOpenSavedChatSrc());
  return { world, sandbox: world.sandbox, appendBubbleCalls, toasts };
}

function sendWorld({ idValue, activeTask }) {
  const appendBubbleCalls = [];
  // A real, never-settling promise: send()'s .then()/.catch() chain registers
  // callbacks that never run, so nothing downstream of the synchronous label
  // assignment (readSSEStream, tool breadcrumbs, done/error handling) runs here.
  const world = loadWorld({
    scripts: [],
    globals: { fetch: () => new Promise(() => {}) },
  });
  const doc = world.document;
  Object.assign(world.sandbox, {
    streaming: false,
    propose: false,
    idInput: input(doc, idValue),
    questionInput: input(doc, 'a question'),
    activeTask,
    chatHistory: [],
    transcript: doc.createElement('ol'),
    activeLabel: doc.createElement('span'),
    resetBtn: doc.createElement('button'),
    prefillTask: '',
    prefillSource: '',
    urlKey: 'acme',
    appendBubble: (role, text) => {
      appendBubbleCalls.push({ role, text });
      // send() reads `closest('li')` on the bubble, so the stub is a span inside a real <li>.
      const li = doc.createElement('li');
      const span = doc.createElement('span');
      li.appendChild(span);
      return span;
    },
    updateSaveVisibility: () => {},
    setBusy: () => {},
  });
  world.run(extractMaskFnSrc());
  world.run(extractSendSrc());
  return { world, sandbox: world.sandbox, appendBubbleCalls };
}

describe('maskFlightCompanionSentinel (LIN-2437 A.11)', () => {
  test('masks the bare sentinel to a readable label', () => {
    const world = loadWorld({ scripts: [] });
    world.run(extractMaskFnSrc());
    assert.equal(world.sandbox.maskFlightCompanionSentinel('flight-companion'), 'Flight Companion');
  });

  test('masks the sentinel inside the auto-derived title fallback (the assistant-only-transcript leak)', () => {
    const world = loadWorld({ scripts: [] });
    world.run(extractMaskFnSrc());
    assert.equal(
      world.sandbox.maskFlightCompanionSentinel('Chat about flight-companion'),
      'Chat about Flight Companion'
    );
  });

  test('leaves a real task identifier untouched', () => {
    const world = loadWorld({ scripts: [] });
    world.run(extractMaskFnSrc());
    assert.equal(world.sandbox.maskFlightCompanionSentinel('TEST-1'), 'TEST-1');
  });

  test('leaves a user-authored title untouched, even one that never mentions the sentinel', () => {
    const world = loadWorld({ scripts: [] });
    world.run(extractMaskFnSrc());
    assert.equal(world.sandbox.maskFlightCompanionSentinel('Where do you stand?'), 'Where do you stand?');
  });

  test('is a defensive no-op on a non-string', () => {
    const world = loadWorld({ scripts: [] });
    world.run(extractMaskFnSrc());
    assert.equal(world.sandbox.maskFlightCompanionSentinel(undefined), undefined);
    assert.equal(world.sandbox.maskFlightCompanionSentinel(''), '');
  });
});

describe('renderSavedRows (LIN-2437 A.11) — saved-row meta + title surfaces', () => {
  test('a companion save (sentinel taskIdentifier, fallback title) renders both readable, never the raw sentinel', () => {
    const world = savedRowsWorld();
    const { savedList } = world.sandbox;
    world.sandbox.renderSavedRows([
      { id: 'c1', taskIdentifier: 'flight-companion', title: 'Chat about flight-companion', turnCount: 1 }
    ]);

    assert.equal(savedList.children.length, 1);
    const li = savedList.children[0];
    assert.equal(li.querySelector('.task-chat-saved-meta').textContent, 'Flight Companion',
      'the meta chip reads the readable label');
    assert.equal(li.querySelector('.task-chat-saved-title').textContent, 'Chat about Flight Companion',
      'the fallback title reads the readable label');
    assert.ok(!li.outerHTML.includes('flight-companion'), 'the raw sentinel must never reach the rendered row');
  });

  test('an ordinary task-chat save is unaffected', () => {
    const world = savedRowsWorld();
    const { savedList } = world.sandbox;
    world.sandbox.renderSavedRows([
      { id: 'c2', taskIdentifier: 'TEST-1', title: 'Where do you stand?', turnCount: 2 }
    ]);

    const li = savedList.children[0];
    assert.equal(li.querySelector('.task-chat-saved-meta').textContent, 'TEST-1');
    assert.equal(li.querySelector('.task-chat-saved-title').textContent, 'Where do you stand?');
  });
});

describe('appendBubble (LIN-2437 A.11 review finding 1) — assistant bubble speaker pill', () => {
  test('a resumed companion chat renders the readable label on the speaker pill, not the raw sentinel', () => {
    // openSavedChat sets activeTask to the raw sentinel and THEN replays every
    // stored turn through appendBubble — so on an assistant-only companion
    // transcript this pill is the loudest surface, repeated once per bubble.
    const { sandbox, captured } = bubbleWorld('flight-companion');
    sandbox.appendBubble('assistant', 'Standing by.');

    assert.equal(captured.length, 1);
    assert.equal(captured[0].who, 'Flight Companion');
    assert.ok(!String(captured[0].who).includes('flight-companion'), 'the raw sentinel must never reach the speaker pill');
  });

  test('an ordinary task chat still names the task on the pill', () => {
    const { sandbox, captured } = bubbleWorld('TEST-1');
    sandbox.appendBubble('assistant', 'Here is where I stand.');
    assert.equal(captured[0].who, 'TEST-1');
  });

  test("the user's own turn is unaffected, and an empty activeTask still falls back to 'task'", () => {
    const { sandbox, captured } = bubbleWorld('flight-companion');
    sandbox.appendBubble('user', 'hello');
    assert.equal(captured[0].who, 'you');

    const empty = bubbleWorld('');
    empty.sandbox.appendBubble('assistant', 'hi');
    assert.equal(empty.captured[0].who, 'task', 'the || fallback must survive the mask being applied first');
  });
});

describe('openSavedChat (LIN-2483/LIN-2634) — resume never seeds the raw sentinel into idInput', () => {
  test('a companion sentinel chat resumes with idInput EMPTY, while activeTask keeps the sentinel and the label reads the masked name', async () => {
    const { sandbox } = openSavedChatWorld({
      apiResponse: { chat: { taskIdentifier: 'flight-companion', transcript: [{ role: 'assistant', content: 'Standing by.' }] } },
    });
    sandbox.openSavedChat('c1');
    await flush();

    assert.equal(sandbox.idInput.value, '', 'idInput must be left empty, never the raw sentinel');
    assert.equal(sandbox.activeTask, 'flight-companion', 'activeTask must still carry the sentinel — the save path reads this');
    assert.equal(sandbox.activeLabel.textContent, 'talking to Flight Companion');
  });

  test('an ordinary saved task chat still seeds idInput with the real identifier', async () => {
    const { sandbox } = openSavedChatWorld({
      apiResponse: { chat: { taskIdentifier: 'TEST-1', transcript: [{ role: 'user', content: 'hi' }] } },
    });
    sandbox.openSavedChat('c2');
    await flush();

    assert.equal(sandbox.idInput.value, 'TEST-1');
    assert.equal(sandbox.activeTask, 'TEST-1');
    assert.equal(sandbox.activeLabel.textContent, 'talking to TEST-1');
  });
});

describe('send() (LIN-2483/LIN-2634) — the label rebuild never re-exposes the raw sentinel', () => {
  test('re-editing the id field back to the raw sentinel masks the label on the very next send', () => {
    const { sandbox } = sendWorld({ idValue: 'flight-companion', activeTask: '' });
    sandbox.send();

    assert.equal(sandbox.activeLabel.textContent, 'talking to Flight Companion');
    assert.ok(!sandbox.activeLabel.textContent.includes('flight-companion'), 'the raw sentinel must never reach the label');
  });

  test('an ordinary task id leaves the mask a no-op', () => {
    const { sandbox } = sendWorld({ idValue: 'TEST-1', activeTask: '' });
    sandbox.send();

    assert.equal(sandbox.activeLabel.textContent, 'talking to TEST-1');
  });

  test('switching FROM the companion chat to a real task id does not rebuild the label a second time with stale masking', () => {
    // activeTask already equals taskId (both real), so the switching branch
    // — and therefore the label rebuild — does not run at all here; this
    // pins that the mask fix didn't accidentally make the branch run always.
    const { sandbox } = sendWorld({ idValue: 'TEST-1', activeTask: 'TEST-1' });
    sandbox.send();

    assert.equal(sandbox.activeLabel.textContent, '', 'no switch happened, so the label is untouched by this send()');
  });
});

describe('appendBubble / setBubbleState (LIN-2445) — the assistant pill settles', () => {
  test('a live assistant turn still OPENS in-progress', () => {
    const { sandbox, captured } = bubbleWorld('TEST-1');
    sandbox.appendBubble('assistant', '');
    assert.equal(captured[0].whoState, 'in-progress');
  });

  test('an already-complete turn opens SETTLED — the saved-chat replay path', () => {
    // openSavedChat replays stored turns, every one of which finished before it
    // was persisted. There is no completion moment to hook, so the state is
    // passed at append time instead of swapped afterwards.
    const { sandbox, captured } = bubbleWorld('TEST-1');
    sandbox.appendBubble('assistant', 'a stored answer', 'done');
    assert.equal(captured[0].whoState, 'done');
  });

  test("the user's turn takes no status state, with or without an explicit one", () => {
    const { sandbox, captured } = bubbleWorld('TEST-1');
    sandbox.appendBubble('user', 'a question', 'done');
    assert.equal(captured[0].whoState, undefined, 'the user pill stays a neutral tag chip');
  });

  test('setBubbleState swaps in-progress for the terminal state AND its glyph', () => {
    const { world, sandbox } = bubbleWorld('TEST-1');
    const { li, pill, char } = pillLi(world.document);

    sandbox.setBubbleState(li, 'done');

    assert.ok(!pill.classList.contains('status-pill--in-progress'), 'the amber state must not persist');
    assert.ok(pill.classList.contains('status-pill--done'));
    // The glyph moves with the class — a swapped class over a stale ◐ would
    // read as done in CSS while still showing the in-progress character.
    assert.equal(char.textContent, '✓');
  });

  test('setBubbleState reaches the failed state too', () => {
    const { world, sandbox } = bubbleWorld('TEST-1');
    const { li, pill, char } = pillLi(world.document);

    sandbox.setBubbleState(li, 'failed');

    assert.ok(!pill.classList.contains('status-pill--in-progress'));
    assert.ok(pill.classList.contains('status-pill--failed'));
    assert.equal(char.textContent, '✕');
  });

  test('setBubbleState is a defensive no-op on a missing li or a bubble with no pill', () => {
    const { world, sandbox } = bubbleWorld('TEST-1');
    assert.doesNotThrow(() => sandbox.setBubbleState(null, 'done'));
    assert.doesNotThrow(() => sandbox.setBubbleState(world.document.createElement('li'), 'done'));
  });
});

// One microtask-chain flush past window.api()'s .then/.catch — a Node
// setImmediate (macrotask) runs strictly after every pending microtask, so
// this is enough regardless of how many .then hops the resolved chain has.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}
