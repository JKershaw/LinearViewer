/**
 * LIN-3889 (review): the client hooks Dispatch's script reads are attributes the renderer emits.
 * public/dispatch.js reaches the Send Prompt panel through `[data-send-panel]` (it must not read
 * the section's test id or a style class). Witness: removing `data-send-panel` from the Send Prompt
 * section turns the first test red.
 *
 * Run with: node --test tests/unit/dispatch-client-hooks-render.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDispatchPage } from '../../lib/render-dispatch.js';

describe('the hooks public/dispatch.js reads are on the rendered page', () => {
  const html = renderDispatchPage('Acme', { urlKey: 'acme', featureFlags: { runControls: true } });

  test('the Send Prompt section carries data-send-panel once, and holds the prompt textarea', () => {
    assert.equal(html.split('data-send-panel').length - 1, 1, 'one send panel');
    const start = html.indexOf('data-send-panel');
    const section = html.slice(start, html.indexOf('</section>', start));
    assert.match(section, /<textarea\b/, 'the textarea is inside the panel, so textarea.closest() finds it');
  });
});
