/**
 * The Proxy page's prompt controls and output exactly as the page draws them (LIN-4308, from LIN-4296): cut from
 * `lib/render-proxy.js`'s own output, so the scope select's options and the element ids are production's, not retyped.
 * The full page cannot be parsed whole by the fake DOM (it throws `FakeDomError` on the doctype), so the cut is taken
 * and wrapped in the `data-url-key` element `public/proxy.js` reads the workspace from.
 *
 * Shared by the suites that run `public/proxy.js` on `loadWorld`: lin-2370-browser-copy-prompt-provider-identity,
 * lin-3136-settings-take-predicate and lin-4296-scope-pick. No `test()` here: importing this module runs nothing.
 */
import assert from 'node:assert/strict';
import { renderProxyPage } from '../../lib/render-proxy.js';

export const PROXY_PROMPT_BOX = (() => {
  const page = renderProxyPage('acme', { urlKey: 'acme' });
  const controls = /<div class="proxy-prompt-controls">[\s\S]*?<\/div>/.exec(page)?.[0];
  const output = /<pre[^>]*id="proxy-prompt-output"[^>]*>[\s\S]*?<\/pre>/.exec(page)?.[0];
  assert.ok(controls && output, 'the page draws the prompt controls and the output');
  return `<div data-url-key="acme">${controls}${output}</div>`;
})();
