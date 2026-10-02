/**
 * Unit tests for lib/session-materializer-precompute.js (LIN-3253, R2 of
 * PR #1722).
 *
 * Run with: node --test tests/unit/session-materializer-precompute.test.js
 *
 * Pins the wiring that was previously inline in server.js and untested: the
 * composed materializer hook must call the run-paragraph precompute for a
 * running session and skip the session summary, call both for a terminal
 * session, and call neither with no server-side key. A source census also pins
 * the server.js assignment, so unwiring the hook (review M9) turns this red.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createMaterializerPrecompute,
  createSessionSummaryPrecompute
} from '../../lib/session-materializer-precompute.js';

const SERVER_SRC = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');

function fakeSummaryStore() {
  const docs = new Map();
  return {
    docs,
    async get(urlKey, id) { return docs.get(`${urlKey}:${id}`) || null; },
    async put(urlKey, id, doc) { docs.set(`${urlKey}:${id}`, doc); }
  };
}

/** Compose the real factories with spies; the summary gate stays real. */
function makeComposed({ terminal = false, apiKey = 'k' } = {}) {
  const paragraph = [];
  const summaryGenerated = [];
  const store = fakeSummaryStore();
  const hook = createMaterializerPrecompute({
    precomputeRunParagraph: async (urlKey, session, opts) => { paragraph.push({ urlKey, opts }); },
    precomputeSessionSummary: createSessionSummaryPrecompute({
      sessionSummaryStore: store,
      isTerminal: () => terminal,
      generateSummary: async (session, opts) => {
        summaryGenerated.push(opts);
        return { summary: 'a summary', model: 'm' };
      },
      hashSessionFn: () => 'hash-1',
      childLoopsFn: () => []
    }),
    resolveApiKey: () => apiKey
  });
  return { hook, paragraph, summaryGenerated, store };
}

describe('createMaterializerPrecompute (the composed server.js hook)', () => {
  test('a running session runs the paragraph precompute and skips the summary', async () => {
    const { hook, paragraph, summaryGenerated, store } = makeComposed({ terminal: false });

    await hook('ws', { sessionId: 'run-1' });

    assert.equal(paragraph.length, 1, 'the paragraph precompute ran once');
    assert.equal(paragraph[0].opts.apiKey, 'k', 'the resolved key is threaded through');
    assert.equal(summaryGenerated.length, 0, 'a running session is not summarised');
    assert.equal(store.docs.size, 0, 'nothing was written to the summary cache');
  });

  test('a terminal session runs both precomputes', async () => {
    const { hook, paragraph, summaryGenerated, store } = makeComposed({ terminal: true });

    await hook('ws', { sessionId: 'run-1' });

    assert.equal(paragraph.length, 1, 'the paragraph precompute ran once');
    assert.equal(summaryGenerated.length, 1, 'the terminal session is summarised once');
    assert.equal(store.docs.size, 1, 'the summary was cached');
  });

  test('no server-side key runs neither precompute', async () => {
    const { hook, paragraph, summaryGenerated } = makeComposed({ apiKey: null });

    await hook('ws', { sessionId: 'run-1' });

    assert.equal(paragraph.length, 0, 'no key → no paragraph call');
    assert.equal(summaryGenerated.length, 0, 'no key → no summary call');
  });

  test('a session with no id runs neither precompute', async () => {
    const { hook, paragraph, summaryGenerated } = makeComposed();

    await hook('ws', {});

    assert.equal(paragraph.length, 0);
    assert.equal(summaryGenerated.length, 0);
  });
});

describe('server.js wiring census (review M9)', () => {
  test('server.js imports the composed factory from lib/session-materializer-precompute.js', () => {
    assert.match(
      SERVER_SRC,
      /import\s*\{[^}]*\bcreateMaterializerPrecompute\b[^}]*\}\s*from\s*['"]\.\/lib\/session-materializer-precompute\.js['"]/
    );
  });

  test('server.js assigns the materializer hook from the composed factory', () => {
    assert.match(
      SERVER_SRC,
      /observationMaterializer\.precomputeSessionSummary\s*=\s*createMaterializerPrecompute\(/,
      'unwiring the hook (M9) must turn this red'
    );
    assert.match(SERVER_SRC, /\bprecomputeRunParagraph\b/, 'the run-paragraph precompute must be threaded into the composition');
  });
});
