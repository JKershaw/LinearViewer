/**
 * The client world (LIN-4246, LIN-4265): one fake DOM document (`fake-dom.js`) and one vm sandbox, with whichever `public/`
 * scripts a suite names run in it, in order. `question-cards.js` must be named in the same vm as `prompt-section.js` when
 * the test depends on the keep: `keepsPlace` is always false without `window.QuestionCards`.
 *
 * This layer is generic. What a suite's `/api/…` calls return is the suite's own, passed in as `window`. The container is a
 * real element in the world's document; `click` and `key` are the only shims over it: `click(dataset)` gives the drawn button
 * with those data attributes to the click listeners, and `key(k)` sends the key to the focused element, as a browser does.
 *
 * Usage: `const world = loadWorld({ window: { api }, scripts: ['question-cards.js', 'prompt-section.js'], timers });`
 * `world.PromptSection`, `world.document`, `world.window`, `world.makeContainer()`. `timers`, when given, collects the client's
 * `setTimeout`s instead of running them (each `{ fn, ms, cancelled, fired }`), so a test fires a poll itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createFakeDom } from './fake-dom.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../public');

/**
 * @param {{window?: object, scripts?: string[], timers?: Array|null, globals?: object}} options
 *   `window` are the stubs the client calls on `window`; `scripts` are file names under `public/`; `globals` are extra sandbox
 *   globals (for example `CustomEvent`, `localStorage`) that a suite needs and the default set does not have.
 */
export function loadWorld({ window: windowStubs = {}, scripts = ['prompt-section.js'], timers = null, globals = {} } = {}) {
  const dom = createFakeDom();
  const { document } = dom;
  const window = { ...windowStubs };
  const sandbox = {
    window, AbortController, URLSearchParams, TextDecoder, TextEncoder, Blob: class {}, URL,
    document,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    setTimeout: (fn, ms) => {
      if (timers) { const t = { fn, ms, cancelled: false, fired: false }; timers.push(t); return t; }
      const t = globalThis.setTimeout(fn, ms); if (t && t.unref) t.unref(); return t;
    },
    clearTimeout: (t) => { if (timers) { if (t) t.cancelled = true; return; } clearTimeout(t); },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
    ...globals,
  };
  vm.createContext(sandbox);
  for (const name of scripts) vm.runInContext(readFileSync(join(PUBLIC_DIR, name), 'utf8'), sandbox, { filename: name });

  const makeContainer = () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.click = async (dataset) => {
      const attrs = Object.entries(dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${v}"]`).join('');
      const btn = container.querySelector(`button${attrs}`);
      if (!btn) throw new Error(`no button ${JSON.stringify(dataset)} is drawn in the container`);
      for (const fn of container.listenersOf('click')) await fn({ target: btn });
      return btn;
    };
    container.key = async (k) => {
      const event = { key: k, target: document.activeElement, preventDefault() {} };
      for (const fn of container.listenersOf('keydown')) await fn(event);
    };
    return container;
  };
  return { PromptSection: window.PromptSection, document, window, sandbox, makeContainer };
}
