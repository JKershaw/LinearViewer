/**
 * The real dispatch disclosure for the prompt-section suites (LIN-4267).
 *
 * A suite that presses a control inside the disclosure needs production's own `renderDispatchDisclosure`
 * (public/common.js), not a stand-in: the press must land on a control production draws. Loading common.js needs
 * `window.__HARNESS_MODELS__` (the block the server embeds, lib/model-routing-harnesses.js) and `window.location`.
 *
 * The disclosure's `&mdash;` and `&hellip;` are named entities, and the fake decodes them (`NAMED` in fake-dom.js), so its
 * markup reaches the fake as production emits it. `fake-dom.test.js` pins both decodes.
 */
import { harnessModelsBlock } from '../../../lib/model-routing-harnesses.js';

/**
 * The classic public/ scripts a suite runs for a real disclosure: `classic: DISCLOSURE_SCRIPTS` in promptSectionWorld
 * (prompt-section.js is a module it imports after them, LIN-4463 piece 5).
 */
export const DISCLOSURE_SCRIPTS = ['common.js'];

/** The window stubs common.js needs at load time. Pass them as the world's `window` option. */
export function disclosureWindowStubs() {
  return { __HARNESS_MODELS__: harnessModelsBlock(), location: { pathname: '/workspace/ws/swipe' } };
}
