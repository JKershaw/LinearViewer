/**
 * The real dispatch disclosure for the prompt-section suites (LIN-4267).
 *
 * A suite that presses a control inside the disclosure needs production's own `renderDispatchDisclosure`
 * (public/common.js), not a stand-in: the press must land on a control production draws. Loading common.js needs
 * `window.__HARNESS_MODELS__` (the block the server embeds, lib/model-routing-harnesses.js) and `window.location`.
 *
 * The disclosure emits two named entities the fake DOM does not decode, `&mdash;` and `&hellip;`. `browserMarkup`
 * decodes exactly those, as a browser does, before the markup reaches the fake. Any other entity still throws in the
 * fake. The fake itself is not changed.
 */
import { harnessModelsBlock } from '../../../lib/model-routing-harnesses.js';

/** The public/ scripts a suite names for a real disclosure, in load order. */
export const DISCLOSURE_SCRIPTS = ['common.js', 'prompt-section.js'];

/** The window stubs common.js needs at load time. Pass them to `loadWorld`'s `window` option. */
export function disclosureWindowStubs() {
  return { __HARNESS_MODELS__: harnessModelsBlock(), location: { pathname: '/workspace/ws/swipe' } };
}

/** The two entities the real disclosure emits that the fake does not decode, decoded as a browser decodes them. */
export function browserMarkup(html) {
  return html.replace(/&mdash;/g, '—').replace(/&hellip;/g, '…');
}

/**
 * After load: wrap production's disclosure so its markup is decoded before the fake parses it. Call once per world,
 * before the component renders.
 */
export function useRealDisclosure(window) {
  const real = window.renderDispatchDisclosure;
  window.renderDispatchDisclosure = (opts) => browserMarkup(real(opts));
}
