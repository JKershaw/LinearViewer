/**
 * LIN-3361 — pure helpers behind the Flight Companion's task-name links and
 * readout fold: `collectIdentifiers`, `collectIdentifiersFromText`,
 * `splitByKnownIdentifiers`, `chooseFoldAnchor` (public/chat.js).
 *
 * These are the pure cores; the text-node splitting and node moving they feed
 * need a real DOM and are proven in tests/e2e/flight-companion.spec.js.
 *
 * Run with: node --test tests/unit/chat-identifiers.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_JS_SRC = readFileSync(join(__dirname, '../../public/chat.js'), 'utf8');

const sandbox = { window: { isPinnedToBottom: () => true }, console };
vm.createContext(sandbox);
vm.runInContext(CHAT_JS_SRC, sandbox, { filename: 'chat.js' });
const ChatUI = sandbox.window.ChatUI;

const segs = (text, known) => ChatUI.splitByKnownIdentifiers(text, known).map((s) => (s.id ? `[${s.text}]` : s.text)).join('|');

describe('collectIdentifiers', () => {
  test('takes only the structured identifier keys, and only identifier-shaped values', () => {
    const into = new Set();
    ChatUI.collectIdentifiers({
      sessions: [
        { issueIdentifier: 'LIN-3361', title: 'mentions LIN-9999 in prose' },
        { identifier: 'ABC-12', issueId: 'LIN-77' },
        { issueId: '8f1c0e2a-uuid' },
        { model: 'GPT-5', encoding: 'UTF-8', identifier: 'not an id' },
      ],
    }, into);
    assert.deepEqual([...into].sort(), ['ABC-12', 'LIN-3361', 'LIN-77']);
  });

  test('does not invent a pattern finder: identifiers in free-text values are ignored', () => {
    const into = new Set();
    ChatUI.collectIdentifiers({ note: 'see LIN-1 and LIN-2', list: ['LIN-3'] }, into);
    assert.equal(into.size, 0);
  });

  test('accepts an array target and does not duplicate', () => {
    const into = [];
    ChatUI.collectIdentifiers({ identifier: 'LIN-1' }, into);
    ChatUI.collectIdentifiers({ identifier: 'LIN-1' }, into);
    assert.deepEqual(into, ['LIN-1']);
  });
});

describe('collectIdentifiersFromText', () => {
  test('parses a complete JSON result', () => {
    const into = new Set();
    ChatUI.collectIdentifiersFromText('{"decisions":[{"issueIdentifier":"LIN-5"}]}', into);
    assert.deepEqual([...into], ['LIN-5']);
  });

  test('a server-clipped (unparseable) result falls back to a key-anchored scan only', () => {
    const into = new Set();
    ChatUI.collectIdentifiersFromText('{"a":[{"issueIdentifier": "LIN-5","t":"LIN-6 in prose"},{"identifier":"LIN-7"} … [truncated 900 chars]', into);
    assert.deepEqual([...into].sort(), ['LIN-5', 'LIN-7']);
  });

  test('the fallback still applies the identifier-shape filter', () => {
    const into = new Set();
    ChatUI.collectIdentifiersFromText('{"identifier": "not an id", "issueIdentifier": "GPT-5x', into);
    assert.equal(into.size, 0);
  });

  test('empty or non-string input is a no-op', () => {
    const into = new Set();
    ChatUI.collectIdentifiersFromText('', into);
    ChatUI.collectIdentifiersFromText(undefined, into);
    assert.equal(into.size, 0);
  });
});

describe('splitByKnownIdentifiers', () => {
  test('splits on known whole tokens only', () => {
    assert.equal(segs('See LIN-3361 and LIN-3362.', new Set(['LIN-3361'])), 'See |[LIN-3361]| and LIN-3362.');
  });

  test('GPT-5 and UTF-8 never link: they are not in the set', () => {
    assert.equal(segs('GPT-5 and UTF-8 beside LIN-1', new Set(['LIN-1'])), 'GPT-5 and UTF-8 beside |[LIN-1]');
  });

  test('a shorter known id never matches inside a longer one (LIN-33 vs LIN-3361)', () => {
    assert.equal(segs('LIN-3361', new Set(['LIN-33'])), 'LIN-3361');
    assert.equal(segs('LIN-3361 LIN-33', new Set(['LIN-33', 'LIN-3361'])), '[LIN-3361]| |[LIN-33]');
  });

  test('a known id embedded in a longer token is not linked', () => {
    assert.equal(segs('xLIN-33 LIN-33y LIN-33', new Set(['LIN-33'])), 'xLIN-33 LIN-33y |[LIN-33]');
  });

  test('empty set and empty text return the text untouched', () => {
    assert.equal(segs('LIN-1', new Set()), 'LIN-1');
    assert.equal(ChatUI.splitByKnownIdentifiers('', new Set(['LIN-1'])).length, 1);
  });

  test('regex metacharacters in a known string are matched literally', () => {
    assert.equal(segs('a.b a-b', new Set(['a.b'])), '[a.b]| a-b');
  });
});

describe('chooseFoldAnchor', () => {
  const H = ['The big thread', 'What moved, in detail'];
  test('first h1-h6 or hr wins', () => {
    assert.equal(ChatUI.chooseFoldAnchor([{ tag: 'P' }, { tag: 'HR' }, { tag: 'H2' }], H), 1);
    assert.equal(ChatUI.chooseFoldAnchor([{ tag: 'P' }, { tag: 'H3' }], H), 1);
  });

  test('a literal heading beats the bold fallback even when the bold label is earlier', () => {
    assert.equal(ChatUI.chooseFoldAnchor([{ tag: 'P', strongOnly: 'The big thread' }, { tag: 'H2' }], H), 1);
  });

  test('fallback: a bold label equal to a known heading (numbering and colon tolerated)', () => {
    assert.equal(ChatUI.chooseFoldAnchor([{ tag: 'OL' }, { tag: 'P', strongOnly: 'The big thread' }], H), 1);
    assert.equal(ChatUI.chooseFoldAnchor([{ tag: 'P' }, { tag: 'OL', strongOnly: '2. What moved, in detail:' }], H), 1);
  });

  test('a bold label that is not a known heading is not an anchor', () => {
    assert.equal(ChatUI.chooseFoldAnchor([{ tag: 'P', strongOnly: 'Important' }], H), -1);
  });

  test('no anchor at all', () => {
    assert.equal(ChatUI.chooseFoldAnchor([{ tag: 'P' }, { tag: 'UL' }], H), -1);
    assert.equal(ChatUI.chooseFoldAnchor([], H), -1);
  });
});
