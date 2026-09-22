/**
 * Unit tests for `readSSEStream` in public/common.js (LIN-2980).
 *
 * public/common.js is a plain browser script (assigns to `window`, not an ES
 * module) and is not import-safe as a whole, so this file sources the REAL
 * shipped implementation the same way tests/unit/flight-companion-client.test.js:51-64
 * does: slice it out by its pinned start/end markers and run it in a fresh
 * `vm` context, rebinding `window.readSSEStream` to a bare `var` so it can be
 * called directly. This is the real function, not a copy or reimplementation
 * — a drift between this slice and the shipped source cannot hide from the
 * suite.
 *
 * New file rather than adding to flight-companion-client.test.js: these
 * tests exercise `readSSEStream` on its own (no flight-companion.js DOM/
 * fetch/timer scaffolding needed), and LIN-2980 is about the shared reader
 * itself, not any one caller — a dedicated file keeps the witness readable
 * and independent of any single caller's sandbox.
 *
 * Run with: node --test tests/unit/common-read-sse-stream.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_JS_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

function sliceReadSSEStreamSource() {
  const startMarker = 'window.readSSEStream = async function readSSEStream(';
  const startIdx = COMMON_JS_SRC.indexOf(startMarker);
  assert.ok(startIdx !== -1, 'readSSEStream marker not found in public/common.js — has it moved/been renamed?');
  const endMarker = '\n};';
  const endIdx = COMMON_JS_SRC.indexOf(endMarker, startIdx);
  assert.ok(endIdx !== -1, 'closing `};` for readSSEStream not found');
  const slice = COMMON_JS_SRC.slice(startIdx, endIdx + endMarker.length);
  return slice.replace('window.readSSEStream', 'var readSSEStream');
}
const READ_SSE_STREAM_SRC = sliceReadSSEStreamSource();

// Fresh vm context per call — readSSEStream has no state outside its own
// closure, so nothing needs to persist between tests.
function loadReadSSEStream() {
  const sandbox = { TextDecoder, console };
  vm.createContext(sandbox);
  vm.runInContext(READ_SSE_STREAM_SRC, sandbox, { filename: 'common.js (readSSEStream slice)' });
  return sandbox.readSSEStream;
}

function sseFrame(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Mirrors tests/unit/flight-companion-client.test.js's sseResponse: a fake
// Response whose body.getReader() yields the given raw SSE text as a single
// chunk, then signals done.
function fakeResponse(rawText) {
  const bytes = new TextEncoder().encode(rawText);
  let sent = false;
  return {
    body: {
      getReader() {
        return {
          read() {
            if (sent) return Promise.resolve({ done: true, value: undefined });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
        };
      },
    },
  };
}

function sseResponse(frames) {
  return fakeResponse(frames.join(''));
}

describe('readSSEStream handler-exception behavior (LIN-2980)', () => {
  // Research beat 2 (LIN-2980 comment, 2026-09-22T06:46:17Z): Case A —
  // valid JSON, handler throws on the first call only — observes 2 onEvent
  // calls at HEAD (object, then the raw string retry). Predicted: FAILS.
  test('A — a handler that throws is not invoked twice for the same frame', async () => {
    const readSSEStream = loadReadSSEStream();
    const calls = [];
    let firstCall = true;
    const onEvent = (type, data) => {
      calls.push({ type, data });
      if (firstCall) {
        firstCall = false;
        throw new Error('boom on first call');
      }
    };
    await readSSEStream(sseResponse([sseFrame('message', { ok: true })]), onEvent);
    assert.equal(calls.length, 1, `onEvent should be called exactly once per frame; was called ${calls.length} times: ${JSON.stringify(calls)}`);
  });

  // Research beat 2: Case A2 — valid JSON, handler throws on every call —
  // rejects at HEAD, but with the SECOND error; the first (the one that
  // actually describes the real failure) is discarded by the bare `catch`.
  // Predicted: FAILS.
  test('A2 — the first thrown error surfaces, not a later replacement', async () => {
    const readSSEStream = loadReadSSEStream();
    const firstError = new Error('first error');
    const secondError = new Error('second error');
    let callCount = 0;
    const onEvent = () => {
      callCount += 1;
      throw callCount === 1 ? firstError : secondError;
    };
    await assert.rejects(
      readSSEStream(sseResponse([sseFrame('message', { ok: true })]), onEvent),
      (err) => {
        assert.equal(err, firstError, `rejection should carry the FIRST error; got: ${err && err.message}`);
        return true;
      }
    );
  });

  // Research beat 2: Case B — non-JSON payload, handler never throws —
  // already resolves with the raw string at HEAD. This is a regression
  // guard against over-fixing (e.g. deleting the fallback entirely), not a
  // witness to the defect. Predicted: PASSES at HEAD.
  test('B — a non-JSON payload still falls back to the raw string', async () => {
    const readSSEStream = loadReadSSEStream();
    const calls = [];
    const onEvent = (type, data) => calls.push({ type, data });
    // Hand-built raw frame: sseFrame() always JSON.stringifies its payload,
    // so a genuinely non-JSON `data:` line has to be written out directly.
    const raw = 'event: message\ndata: not-json-at-all\n\n';
    await readSSEStream(fakeResponse(raw), onEvent);
    assert.deepEqual(calls, [{ type: 'message', data: 'not-json-at-all' }]);
  });

  // Research beat 2 (Case D) + the settled ruling in the ticket brief: the
  // handler exception must PROPAGATE, stopping the read loop rather than
  // retrying-and-continuing. So the correct end state is frame "a" dispatched
  // once, "b"/"c" never dispatched, and the promise rejects with the
  // thrown error. At HEAD, per beat 2's measured table, the reader instead
  // resolves normally having dispatched "a" TWICE and "b"/"c" once each (4
  // total calls) — the double-dispatch is silent and the stream looks
  // completely normal. Predicted: FAILS on every count (dispatch map is
  // wrong; the promise does not reject at all).
  test('D — a handler throw stops the stream: later frames are not dispatched', async () => {
    const readSSEStream = loadReadSSEStream();
    const dispatches = [];
    const thrown = new Error('boom on frame a');
    let firstCall = true;
    const onEvent = (type) => {
      dispatches.push(type);
      if (firstCall) {
        firstCall = false;
        throw thrown;
      }
    };
    const frames = [
      sseFrame('a', { n: 1 }),
      sseFrame('b', { n: 2 }),
      sseFrame('c', { n: 3 }),
    ];
    await assert.rejects(
      readSSEStream(sseResponse(frames), onEvent),
      (err) => {
        assert.equal(err, thrown, `rejection should carry the throw from frame "a"; got: ${err && err.message}`);
        return true;
      }
    );
    const countByType = dispatches.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
    assert.deepEqual(
      countByType,
      { a: 1 },
      `expected only frame "a" dispatched (once) and the stream to stop; got: ${JSON.stringify(countByType)}`
    );
  });
});
