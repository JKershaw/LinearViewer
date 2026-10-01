/**
 * Unit tests for the LIN-3200 file-pointer seam (P3), step 7.6 in
 * createDispatchItem.
 *
 * All reads are injected: the store count, the plan reader and the PR reader.
 * The timing caps are overridden to small values so the cap tests run against
 * real timers quickly; the production constants remain the single source and
 * are pinned in tests/unit/file-pointer.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem, FILE_POINTER_PILOT_ENV, isFilePointerPilotEnabled } from '../../lib/dispatch-factory.js';
import { FILE_POINTER_MARKER } from '../../lib/file-pointer.js';

function captureLogs() {
  const original = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  return {
    lines,
    restore() { console.log = original; },
    parsed() {
      return lines
        .map(l => { try { return JSON.parse(l.slice(l.indexOf('{'))); } catch { return null; } })
        .filter(Boolean);
    }
  };
}

// A store whose count sequence is scripted. `counts` may be an array or a
// function of (callNumber). Captures the addItem argument and the call count.
function pilotStore({ counts = [0, 0], findRecent = null, omitCount = false } = {}) {
  const state = { countCalls: 0, addItemCalls: 0, addItemArg: null };
  const store = {
    async addItem(urlKey, item) {
      state.addItemCalls++;
      state.addItemArg = item;
      return { _id: 'item-1', ...item };
    }
  };
  if (findRecent) store.findRecentFreshDispatch = async () => findRecent;
  if (!omitCount) {
    store.countPilotEligible = async () => {
      state.countCalls++;
      if (typeof counts === 'function') return counts(state.countCalls);
      return counts[Math.min(state.countCalls - 1, counts.length - 1)];
    };
  }
  return { store, state };
}

function baseArgs(store, extra = {}) {
  return {
    store,
    urlKey: 'acme',
    kind: 'implementation',
    prompt: 'BODY',
    fields: { promptName: 'implementation', issueIdentifier: 'LIN-1' },
    ...extra
  };
}

const planReader = (text) => {
  const spy = async () => text;
  spy.calls = 0;
  return spy;
};

function spyReader(value) {
  const fn = async () => { fn.calls++; return value; };
  fn.calls = 0;
  return fn;
}

describe('file-pointer seam — flag and eligibility', () => {
  test('flag resolves from env, default OFF', () => {
    assert.equal(isFilePointerPilotEnabled({}), false);
    assert.equal(isFilePointerPilotEnabled({ [FILE_POINTER_PILOT_ENV]: 'true' }), true);
    assert.equal(isFilePointerPilotEnabled({ [FILE_POINTER_PILOT_ENV]: '1' }), true);
    assert.equal(isFilePointerPilotEnabled({ [FILE_POINTER_PILOT_ENV]: 'no' }), false);
  });

  test('flag OFF ⇒ byte-identical addItem argument and no store capability call', async () => {
    const { store: plainStore, state: plainState } = pilotStore({ omitCount: true });
    await createDispatchItem(baseArgs(plainStore));

    const { store, state } = pilotStore({ counts: [0, 0] });
    await createDispatchItem(baseArgs(store, {
      filePointerEnabled: false,
      readPlanBlock: async () => '## Implementation Plan\nlib/x.js'
    }));

    assert.deepEqual(state.addItemArg, plainState.addItemArg);
    assert.equal(state.countCalls, 0);
    assert.equal(state.addItemArg.prompt, 'BODY');
  });

  test('ineligible kinds never consult the count (reviewer independence)', async () => {
    const kinds = ['review', 'plan-review', 'close-out', 'plan', 'research', 'triage', 'autopilot', 'custom'];
    for (const kind of kinds) {
      const { store, state } = pilotStore({ counts: [0, 0] });
      await createDispatchItem(baseArgs(store, {
        kind,
        filePointerEnabled: true,
        readPlanBlock: async () => '## Implementation Plan\nlib/x.js',
        fields: { promptName: kind, issueIdentifier: 'LIN-1' }
      }));
      assert.equal(state.countCalls, 0, `${kind} must not consume an ordinal`);
      assert.equal(state.addItemArg.prompt, 'BODY');
    }
  });

  test('follow-up and abort are never touched', async () => {
    for (const fields of [{ promptName: 'implementation', issueIdentifier: 'LIN-1', followUpTo: 'p' }, { promptName: 'implementation', issueIdentifier: 'LIN-1', abort: true, abortTo: 'a' }]) {
      const { store, state } = pilotStore({ counts: [0, 0] });
      await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: async () => 'plan', fields }));
      assert.equal(state.countCalls, 0);
    }
  });

  test('store without countPilotEligible ⇒ no-op, no throw', async () => {
    const { store, state } = pilotStore({ omitCount: true });
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: async () => '## Implementation Plan\nlib/x.js' }));
    assert.equal(state.addItemArg.prompt, 'BODY');
  });
});

describe('file-pointer seam — arm decision', () => {
  test('even c0, unchanged c1 ⇒ pointer prepended', async () => {
    const { store, state } = pilotStore({ counts: [0, 0] });
    const plan = spyReader('## Implementation Plan\nlib/plan.js');
    const pr = spyReader([{ repo: 'LinearViewer', path: 'lib/pr.js' }]);
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: plan, fetchPilotPrFiles: pr }));
    assert.ok(state.addItemArg.prompt.startsWith(FILE_POINTER_MARKER));
    assert.match(state.addItemArg.prompt, /- lib\/plan\.js/);
    assert.match(state.addItemArg.prompt, /- lib\/pr\.js/);
    assert.equal(state.countCalls, 2);
  });

  test('odd c0 ⇒ control: byte-identical, no plan/PR read, one count', async () => {
    const { store, state } = pilotStore({ counts: [1] });
    const plan = spyReader('## Implementation Plan\nlib/plan.js');
    const pr = spyReader([{ repo: 'LinearViewer', path: 'lib/pr.js' }]);
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: plan, fetchPilotPrFiles: pr }));
    assert.equal(state.addItemArg.prompt, 'BODY');
    assert.equal(state.countCalls, 1);
    assert.equal(plan.calls, 0);
    assert.equal(pr.calls, 0);
  });

  test('both inputs empty ⇒ byte-identical (still pointer-assigned)', async () => {
    const { store, state } = pilotStore({ counts: [0, 0] });
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: async () => null, fetchPilotPrFiles: async () => [] }));
    assert.equal(state.addItemArg.prompt, 'BODY');
    assert.equal(state.countCalls, 2);
  });
});

describe('file-pointer seam — recount (M4)', () => {
  test('c0 even, recount c0+1 ⇒ flips to control, pointer discarded', async () => {
    const { store, state } = pilotStore({ counts: [0, 1] });
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: async () => '## Implementation Plan\nlib/x.js' }));
    assert.equal(state.addItemArg.prompt, 'BODY');
    assert.equal(state.countCalls, 2);
  });

  test('c0 even, recount c0+2 ⇒ stays pointer, prepended', async () => {
    const { store, state } = pilotStore({ counts: [0, 2] });
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: async () => '## Implementation Plan\nlib/x.js' }));
    assert.ok(state.addItemArg.prompt.startsWith(FILE_POINTER_MARKER));
  });

  test('the recount runs even when the pointer is empty', async () => {
    const { store, state } = pilotStore({ counts: [0, 0] });
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: async () => null, fetchPilotPrFiles: async () => [] }));
    assert.equal(state.countCalls, 2);
  });
});

describe('file-pointer seam — hard caps and fail-open', () => {
  const timeouts = { count: 20, plan: 20, step: 30 };

  test('stalled reads: step completes, prompt untouched, addItem called, no unhandled rejection', async () => {
    const { store, state } = pilotStore({ counts: [0, 0] });
    const logs = captureLogs();
    try {
      await createDispatchItem(baseArgs(store, {
        filePointerEnabled: true,
        filePointerTimeouts: timeouts,
        readPlanBlock: () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 80)),
        fetchPilotPrFiles: () => new Promise(() => {})
      }));
      assert.equal(state.addItemArg.prompt, 'BODY');
      assert.equal(state.addItemCalls, 1);
      await new Promise(r => setTimeout(r, 100));
    } finally {
      logs.restore();
    }
  });

  test('count never resolves ⇒ fail-open at the count cap, logged', async () => {
    const { store, state } = pilotStore({ counts: () => new Promise(() => {}) });
    const logs = captureLogs();
    try {
      await createDispatchItem(baseArgs(store, { filePointerEnabled: true, filePointerTimeouts: timeouts, readPlanBlock: async () => 'plan' }));
      assert.equal(state.addItemArg.prompt, 'BODY');
      const entry = logs.parsed().at(-1);
      assert.equal(entry.failOpen, true);
      assert.equal(entry.reason, 'c0-unavailable');
    } finally {
      logs.restore();
    }
  });

  test('count throws ⇒ fail-open, untouched', async () => {
    const { store, state } = pilotStore({ counts: [0, 0] });
    store.countPilotEligible = async () => { throw new Error('boom'); };
    const logs = captureLogs();
    try {
      await createDispatchItem(baseArgs(store, { filePointerEnabled: true, filePointerTimeouts: timeouts, readPlanBlock: async () => 'plan' }));
      assert.equal(state.addItemArg.prompt, 'BODY');
      assert.equal(logs.parsed().at(-1).failOpen, true);
    } finally {
      logs.restore();
    }
  });

  test('recount never resolves ⇒ fail-open c1-unavailable at the count cap, prompt untouched', async () => {
    // c0 even ⇒ pointer arm; the RECOUNT then never resolves. The bound
    // G ≤ COUNT_TIMEOUT_MS on the pointer arm rests on the recount's cap, so
    // this test goes red (hangs) if that cap is replaced with a bare await.
    const { store, state } = pilotStore({ counts: (n) => (n === 1 ? 0 : new Promise(() => {})) });
    const logs = captureLogs();
    try {
      await createDispatchItem(baseArgs(store, {
        filePointerEnabled: true,
        filePointerTimeouts: timeouts,
        readPlanBlock: async () => '## Implementation Plan\nlib/x.js'
      }));
      assert.equal(state.addItemArg.prompt, 'BODY', 'prompt must be untouched on recount fail-open');
      assert.equal(state.addItemCalls, 1);
      assert.equal(state.countCalls, 2);
      const entry = logs.parsed().at(-1);
      assert.equal(entry.failOpen, true);
      assert.equal(entry.reason, 'c1-unavailable');
    } finally {
      logs.restore();
    }
  });

  test('gap: addItem is reached with only synchronous work after the deciding count', async () => {
    const { store, state } = pilotStore({ counts: [0, 0] });
    let lastCountAt = 0;
    let addItemAt = 0;
    store.countPilotEligible = async () => {
      state.countCalls++;
      await new Promise(r => setTimeout(r, 5));
      lastCountAt = Date.now();
      return 0;
    };
    const capturingAdd = store.addItem;
    store.addItem = async (urlKey, item) => { addItemAt = Date.now(); return capturingAdd(urlKey, item); };
    await createDispatchItem(baseArgs(store, { filePointerEnabled: true, filePointerTimeouts: timeouts, readPlanBlock: async () => '## Implementation Plan\nlib/x.js' }));
    assert.ok(addItemAt - lastCountAt < timeouts.count, `gap ${addItemAt - lastCountAt}ms must be below the count cap`);
    assert.equal(state.countCalls, 2);
  });
});

describe('file-pointer seam — refusals consume no ordinal', () => {
  test('duplicate guard refusal ⇒ no count, no read', async () => {
    const { store, state } = pilotStore({ counts: [0, 0], findRecent: { id: 'x', dispatchedAt: new Date() } });
    const logs = captureLogs();
    try {
      await assert.rejects(
        createDispatchItem(baseArgs(store, { filePointerEnabled: true, readPlanBlock: async () => 'plan' })),
        /created moments ago/
      );
      assert.equal(state.countCalls, 0);
      assert.equal(state.addItemCalls, 0);
    } finally {
      logs.restore();
    }
  });

  test('a finalizePrompt throw (declared-launch refusal) ⇒ no count, no addItem', async () => {
    const { store, state } = pilotStore({ counts: [0, 0] });
    await assert.rejects(
      createDispatchItem(baseArgs(store, {
        filePointerEnabled: true,
        readPlanBlock: async () => 'plan',
        finalizePrompt: async () => { throw new Error('refused'); }
      })),
      /refused/
    );
    assert.equal(state.countCalls, 0);
    assert.equal(state.addItemCalls, 0);
  });
});

describe('file-pointer seam — no row field stamped', () => {
  test('addItem argument keys are identical with the flag on and off', async () => {
    const { store: offStore, state: offState } = pilotStore({ counts: [0, 0] });
    await createDispatchItem(baseArgs(offStore, { filePointerEnabled: false }));
    const { store: onStore, state: onState } = pilotStore({ counts: [0, 0] });
    await createDispatchItem(baseArgs(onStore, { filePointerEnabled: true, readPlanBlock: async () => '## Implementation Plan\nlib/x.js' }));
    assert.deepEqual(Object.keys(onState.addItemArg).sort(), Object.keys(offState.addItemArg).sort());
  });
});
