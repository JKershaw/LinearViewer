/**
 * LIN-3340 — public/close-out.js, the task page's merge client.
 *
 * The witness for the 8 Oct failure: a press works with NO session reply box in
 * the DOM, reading the task's tracker UUID and provider kind off the close-out
 * box. Also pins the `source` threading (H1/G1): the prompt GET and the check
 * POST carry `?source=`/`{source}` when the box has one, and nothing when it
 * doesn't.
 *
 * A plain browser script, so the real shipped source runs on `loadWorld` (LIN-4312): the
 * shared fake DOM (`helpers/fake-dom.js`) over a vm sandbox. The close-out box is the
 * server's own renderer output (`renderCloseOutBox`), parsed into the world's document, so
 * no test hand-writes the box's markup.
 *
 * Run with: node --test tests/unit/close-out-client.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';
import { renderCloseOutBox } from '../../lib/render-run-evidence.js';

/** Silences the client's `console.error` in the refusal tests; everything else is the real console. */
const SILENT_CONSOLE = { ...console, error() {} };

/**
 * `public/close-out.js` on loadWorld, with the window stubs the suite names. The script's own `window.CloseOut` is what the
 * suite reads (`world.window.CloseOut`), so nothing is re-implemented here.
 */
function loadCloseOut({ window = {}, globals = {} } = {}) {
  return loadWorld({ scripts: ['close-out.js'], window: { console: SILENT_CONSOLE, ...window }, globals });
}

/** The server's close-out box for `state` (with the task's identity), parsed into the world's document. */
function mountBox(world, state, opts = {}) {
  const host = world.document.createElement('div');
  world.document.body.appendChild(host);
  host.innerHTML = renderCloseOutBox(state, opts);
  return host.querySelector('[data-testid="run-evidence-closeout"]');
}

/** A task page's `<main data-status>` with `inner` markup, parsed into the world's document: the page the Done guard reads. */
function mountPage(world, status, inner = '') {
  const host = world.document.createElement('div');
  world.document.body.appendChild(host);
  host.innerHTML = `<main data-testid="task-page" data-status="${status}">${inner}</main>`;
  return host.querySelector('main');
}

const UUID = '11111111-2222-3333-4444-555555555555';
const PR_URL = 'https://github.com/acme/app/pull/41';

/** A standard stop-at-PR run whose PR is ready: the state the server renders the close-out box from. */
const READY = {
  owner: true,
  urlKey: 'acme',
  issueIdentifier: 'LIN-50',
  stopAt: 'pr',
  variant: 'standard',
  status: 'ready',
  pr: { url: PR_URL, headSha: 'abc1234' },
};

describe('close-out.js: URLs and bodies thread source', () => {
  const { promptUrl, checkUrl, checkBody } = loadCloseOut().window.CloseOut;

  test('promptUrl carries ?source when present, bare otherwise', () => {
    assert.equal(promptUrl('acme', UUID, 'linear'), `/workspace/acme/api/prompt/${UUID}/close-out?source=linear`);
    assert.equal(promptUrl('acme', UUID), `/workspace/acme/api/prompt/${UUID}/close-out`);
    assert.equal(promptUrl('acme', UUID, ''), `/workspace/acme/api/prompt/${UUID}/close-out`);
  });

  test('checkUrl is keyed by the task identifier', () => {
    assert.equal(checkUrl('acme', 'LIN-50'), '/workspace/acme/api/run-evidence/LIN-50/check');
  });

  test('checkBody carries source only when present', () => {
    assert.equal(JSON.stringify(checkBody('linear')), JSON.stringify({ source: 'linear' }));
    assert.equal(JSON.stringify(checkBody('')), '{}');
    assert.equal(JSON.stringify(checkBody(undefined)), '{}');
  });
});

describe('close-out.js: boxContext reads only the box', () => {
  test('reads identity and state off the attributes', () => {
    const world = loadCloseOut();
    const box = mountBox(world, READY, { issueId: UUID, source: 'linear' });
    const ctx = world.window.CloseOut.boxContext(box);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx)), { urlKey: 'acme', issueId: UUID, issueIdentifier: 'LIN-50', source: 'linear', stopAt: 'pr', state: 'ready' });
  });
});

describe('close-out.js: the press (the 8 Oct witness)', () => {
  test('presses from the box with no reply box in the DOM', async () => {
    const calls = [];
    const world = loadCloseOut({
      window: {
        api(url, opts) {
          calls.push({ url, opts });
          if (url.includes('/api/prompt/')) return Promise.resolve({ prompt: 'P', promptName: 'close-out', issueTitle: 'T' });
          if (url.includes('/close-out-press')) return Promise.resolve({ success: true });
          return Promise.resolve({});
        },
        dispatchPrompt(arg) { calls.push({ dispatch: arg }); return Promise.resolve({ id: 'd1' }); },
      },
    });
    const box = mountBox(world, READY, { issueId: UUID, source: 'linear' });
    const btn = box.querySelector('[data-action="closeout-press"]');
    await world.window.CloseOut.pressCloseOut(box, btn);

    assert.equal(calls[0].url, `/workspace/acme/api/prompt/${UUID}/close-out?source=linear`, 'the prompt GET carries source');
    assert.equal(calls[1].dispatch.kind, 'close-out');
    assert.equal(calls[1].dispatch.issue.id, UUID, 'the issue UUID came from the box');
    assert.equal(calls[1].dispatch.issue.source, 'linear');
    const press = calls.find(c => c.url && c.url.includes('/close-out-press'));
    assert.ok(press, 'the press is recorded');
    assert.deepEqual(JSON.parse(press.opts.body), { prUrl: PR_URL, headSha: 'abc1234', dispatchId: 'd1' });
    assert.equal(btn.textContent, 'close-out sent ✓');
  });

  test('a source-less box sends no source (unchanged behaviour)', async () => {
    const calls = [];
    const world = loadCloseOut({
      window: {
        api(url, opts) { calls.push({ url, opts }); return Promise.resolve(url.includes('/api/prompt/') ? { prompt: 'P' } : {}); },
        dispatchPrompt() { return Promise.resolve({}); },
      },
    });
    const box = mountBox(world, READY, { issueId: UUID });
    await world.window.CloseOut.pressCloseOut(box, box.querySelector('[data-action="closeout-press"]'));
    assert.equal(calls[0].url, `/workspace/acme/api/prompt/${UUID}/close-out`);
  });
});

describe('close-out.js: a not-ready refusal (LIN-3634)', () => {
  function pressWith(rejection) {
    const world = loadCloseOut({
      window: {
        api() { return Promise.resolve({ prompt: 'P' }); },
        dispatchPrompt() { return Promise.reject(rejection); },
      },
    });
    const box = mountBox(world, READY, { issueId: UUID, source: 'linear' });
    const btn = box.querySelector('[data-action="closeout-press"]');
    return { run: () => world.window.CloseOut.pressCloseOut(box, btn), box, btn };
  }

  test('a 409 CLOSE_OUT_NOT_READY repaints the box from the refusal state and re-enables the button', async () => {
    const err = Object.assign(new Error('The pull request changed since the review approved it'), {
      body: { code: 'CLOSE_OUT_NOT_READY', reason: 'head-moved', state: { status: 'not-ready', reason: 'head-moved' } },
    });
    const { run, box, btn } = pressWith(err);
    await run();
    assert.equal(box.getAttribute('data-state'), 'not-ready');
    assert.equal(box.children.length, 1, 'the box shows one line: the not-ready line');
    assert.equal(box.children[0].getAttribute('data-testid'), 'run-evidence-closeout-setup');
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, '[ close out & merge ]');
  });

  test('any other failure leaves the box as it was', async () => {
    const { run, box } = pressWith(Object.assign(new Error('nope'), { body: { code: 'SOMETHING_ELSE' } }));
    const before = box.outerHTML;
    await run();
    assert.equal(box.getAttribute('data-state'), 'ready');
    assert.equal(box.outerHTML, before);
  });
});

describe('close-out.js: the check', () => {
  test('only a stop-at-PR run at ready/merged/partial checks, and the body carries source', async () => {
    const calls = [];
    const world = loadCloseOut({
      window: {
        api(url, opts) { calls.push({ url, opts }); return Promise.resolve({ state: { status: 'ready' }, done: false }); },
        location: { reload() {} },
      },
    });
    const { runCheck } = world.window.CloseOut;
    await runCheck(mountBox(world, READY, { issueId: UUID, source: 'linear' }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/workspace/acme/api/run-evidence/LIN-50/check');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { source: 'linear' });

    // An ordinary run (no stop-at) never checks.
    await runCheck(mountBox(world, { ...READY, stopAt: null }, { issueId: UUID }));
    assert.equal(calls.length, 1, 'no check for a non-stop-at run');
  });

  test('a done result reloads so the tracker Finished header shows', async () => {
    let reloads = 0;
    const world = loadCloseOut({
      window: {
        api() { return Promise.resolve({ state: { status: 'merged' }, done: true, doneNow: true }); },
        location: { reload() { reloads++; } },
      },
    });
    await world.window.CloseOut.runCheck(mountBox(world, READY));
    assert.equal(reloads, 1);
  });

  /**
   * B1' (review `a1845467`): `done` is true on every later call once a merge is
   * recorded, so reloading on `done` loops on a reopened task (the record says
   * Done, the tracker is back In Progress). Reload only when THIS call wrote
   * Done (`doneNow`). A stale record on a not-done page must make 0 reloads.
   */
  test('a done result from an already-recorded merge (doneNow:false) makes 0 reloads', async () => {
    let reloads = 0;
    const world = loadCloseOut({
      window: {
        api() { return Promise.resolve({ state: { status: 'merged' }, done: true, doneNow: false }); },
        location: { reload() { reloads++; } },
      },
    });
    mountPage(world, 'idle');
    await world.window.CloseOut.runCheck(mountBox(world, { ...READY, status: 'merged' }), world.document);
    assert.equal(reloads, 0, 'a recorded Done must not reload a page the tracker reopened');
  });

  /**
   * B1 (review `388f4246`): the page-already-done guard stays as a second
   * safeguard behind `doneNow`.
   */
  test('a doneNow result on a page already showing done makes 0 reloads', async () => {
    let reloads = 0;
    const world = loadCloseOut({
      window: {
        api() { return Promise.resolve({ state: { status: 'merged' }, done: true, doneNow: true }); },
        location: { reload() { reloads++; } },
      },
    });
    const { runCheck, pageAlreadyDone } = world.window.CloseOut;
    mountPage(world, 'done');
    assert.equal(pageAlreadyDone(world.document), true);
    await runCheck(mountBox(world, { ...READY, status: 'merged' }), world.document);
    assert.equal(reloads, 0, 'no reload loop on the end state the feature exists for');
  });

  test('pageAlreadyDone is false without a main / status / document', () => {
    const noMain = loadCloseOut();
    assert.equal(noMain.window.CloseOut.pageAlreadyDone(noMain.document), false, 'no <main>');

    const notDone = loadCloseOut();
    mountPage(notDone, 'idle');
    assert.equal(notDone.window.CloseOut.pageAlreadyDone(notDone.document), false, 'a main that is not done');

    const done = loadCloseOut();
    mountPage(done, 'done');
    assert.equal(done.window.CloseOut.pageAlreadyDone(done.document), true, 'a main that is done');

    // No document at all: the sandbox's `document` global is removed, as a page without one has none.
    const noDocument = loadCloseOut({ globals: { document: undefined } });
    assert.equal(noDocument.window.CloseOut.pageAlreadyDone(), false, 'no document');
  });

  test('a doneNow result reloads once on a page not yet done (In Progress → Done)', async () => {
    let reloads = 0;
    const world = loadCloseOut({
      window: {
        api() { return Promise.resolve({ state: { status: 'merged' }, done: true, doneNow: true }); },
        location: { reload() { reloads++; } },
      },
    });
    mountPage(world, 'running');
    await world.window.CloseOut.runCheck(mountBox(world, { ...READY, status: 'merged' }), world.document);
    assert.equal(reloads, 1);
  });

  /**
   * LIN-3631: the Done reload must not discard unsent text. A non-empty or
   * focused text field defers it (and says so); a read-only or empty, unfocused
   * one does not.
   */
  describe('the Done reload leaves unsent text alone (LIN-3631)', () => {
    /**
     * A running page holding `fieldsHtml`, then a doneNow check on it. `focus` is the index of the field that has focus;
     * `readOnly` lists the indexes whose `readOnly` is set.
     */
    async function checkWith(fieldsHtml, { focus = -1, readOnly = [] } = {}) {
      let reloads = 0;
      const world = loadCloseOut({
        window: {
          api() { return Promise.resolve({ state: { status: 'merged' }, done: true, doneNow: true }); },
          location: { reload() { reloads++; } },
        },
      });
      mountPage(world, 'running', fieldsHtml);
      const fields = world.document.querySelectorAll('textarea, input');
      // The fake DOM does not model `readOnly`: reading it returns undefined even when the `readonly` attribute is set,
      // and the fake does not map the attribute (a fake gap, recorded in the PR; not widened here). The property the
      // browser derives from the attribute is set directly, so the assertion's branch is the one the page takes.
      for (const i of readOnly) fields[i].readOnly = true;
      if (focus >= 0) fields[focus].focus();
      const box = mountBox(world, { ...READY, status: 'merged' });
      await world.window.CloseOut.runCheck(box, world.document);
      return { reloads, box };
    }

    test('a field holding text defers the reload and shows the note', async () => {
      const { reloads, box } = await checkWith('<textarea>half typed</textarea>');
      assert.equal(reloads, 0);
      const notes = box.querySelectorAll('[data-testid="run-evidence-closeout-reload-note"]');
      assert.equal(notes.length, 1);
      assert.equal(notes[0].textContent, 'Done — reload to update');
    });

    test('an empty but focused field defers the reload', async () => {
      const { reloads } = await checkWith('<input type="text">', { focus: 0 });
      assert.equal(reloads, 0);
    });

    test('read-only and empty unfocused fields do not hold the reload', async () => {
      const { reloads, box } = await checkWith('<input type="text" value="https://x/share" readonly><input type="text">', { readOnly: [0] });
      assert.equal(reloads, 1);
      assert.equal(box.querySelectorAll('[data-testid="run-evidence-closeout-reload-note"]').length, 0);
    });
  });
});

describe('close-out.js: applyCloseOutState repaints a merge neutrally', () => {
  // LIN-3426: a merged PR reads the same for every viewer, so the repaint never
  // claims the viewer merged it.
  test('a ready → merged transition paints the neutral line, never "merged by you"', () => {
    const world = loadCloseOut();
    const box = mountBox(world, READY);
    world.window.CloseOut.applyCloseOutState(box, { status: 'merged', message: 'PR #12 merged' });
    assert.equal(box.getAttribute('data-state'), 'merged');
    assert.equal(box.children.length, 1);
    const line = box.children[0];
    assert.equal(line.getAttribute('data-testid'), 'run-evidence-closeout-neutral');
    assert.equal(line.textContent, 'PR #12 merged');
    assert.doesNotMatch(line.textContent, /merged by you|you merged/i);
    assert.doesNotMatch(line.getAttribute('data-testid'), /merged-by-you/);
  });
});
