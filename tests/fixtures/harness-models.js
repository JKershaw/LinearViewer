/**
 * Test-side fixture (LIN-3855): public/common.js reads the harness list from `window.__HARNESS_MODELS__`,
 * which renderPage embeds on every page in the app. A test that runs common.js in a vm sandbox has no
 * renderPage, so it prepends the same block the page would carry. Source of truth stays
 * lib/model-routing-harnesses.js.
 */
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';

export function withHarnessModels(commonSource) {
  return `window.__HARNESS_MODELS__ = ${JSON.stringify(harnessModelsBlock())};\n${commonSource}`;
}
