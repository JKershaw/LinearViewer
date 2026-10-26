/**
 * Test-side fixture (LIN-3983 PR 2): the page's shared client helpers, from public/common.js, for a vm
 * sandbox that runs a page script (public/observation.js) without the page. The page loads common.js
 * before its own script, so the page's `window.renderStatusPill` and `window.renderSegmentBar` exist; a
 * sandbox that skips common.js spreads these in instead. Returns the common.js window, so a test can also
 * reach `escapeHtml` and the rest.
 */
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withHarnessModels } from './harness-models.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMON_SRC = readFileSync(join(__dirname, '../../public/common.js'), 'utf8');

export function loadCommonWindow() {
  const sandbox = { console, document: { addEventListener() {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(COMMON_SRC), sandbox, { filename: 'common.js' });
  return sandbox.window;
}
