/**
 * LIN-4296 — the Agent prompt's scope picker is a real `<select>` in the fake DOM (tests/unit/helpers/fake-dom.js), so a pick
 * that is not one of the page's options reads '' and takes public/proxy.js's 'read' fallback, as a browser does. The page's
 * own suite (lin-3136-settings-take-predicate) keeps its names and count across the move; this is the case it did not have.
 *
 * The page's controls are cut from lib/render-proxy.js's output (tests/fixtures/proxy-prompt-box.js), so the options are production's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PROXY_PROMPT_BOX } from '../fixtures/proxy-prompt-box.js';
import { loadWorld, clickOn } from './helpers/client-world.js';

const PROXY_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../public/proxy.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

test('a scope pick that is not one of the page\'s options reads "" and mints as read', async () => {
  const requests = [];
  const window = {
    location: { origin: 'https://harbour.test' },
    relativeTime: () => 'just now',
    api: async (url, opts) => {
      if (!url.includes('/api/proxy/tokens')) return {};
      requests.push(JSON.parse(opts.body));
      return { token: 'BOOT', tokens: [], providerDisplayName: null, scope: 'read', grants: [] };
    }
  };
  const world = loadWorld({
    window,
    scripts: [],
    globals: { escapeHtml: (v) => String(v), confirm: () => false, toast: () => {}, navigator: { clipboard: { writeText: async () => {} } } }
  });
  world.document.body.innerHTML = PROXY_PROMPT_BOX;
  const select = world.document.getElementById('proxy-scope-select');
  select.value = 'nonsense';
  assert.equal(select.value, '', 'a value no option carries reads as nothing selected (Chromium)');
  world.run(PROXY_SRC);
  await clickOn(world.document.getElementById('proxy-generate-btn'));
  await flush();
  assert.deepEqual(requests, [{ label: 'agent-prompt', scope: 'read', bootstrap: true }]);
});
