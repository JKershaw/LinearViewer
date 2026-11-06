/**
 * The server's swipe page, body only, from the real renderer (LIN-4310). A suite that runs public/swipe.js in a client
 * world (`loadWorld({ scripts: [] })`) sets `world.document.body.innerHTML` to this first: swipe.js reads
 * `.swipe-filter-select`, `#swipe-card` and the arrows at load, and they are the server's own markup, not a copy of it.
 * The suite's card data is still its own, passed as `window.__SWIPE_DATA__`, as the page's script would set it.
 *
 * The client world's parser refuses a doctype, so the doctype is removed here.
 */
import { renderSwipePage } from '../../../lib/render-swipe.js';

/**
 * @param {{urlKey?: string|null, featureFlags?: object}} options the page options the server renders with (no workspace
 *   when `urlKey` is empty). The page's own `__SWIPE_DATA__` is not used; the suite supplies its card data.
 */
export function swipePageBody(options = {}) {
  const html = renderSwipePage({ projectTrees: [], inProgressTrees: [], recentActivityTrees: [] }, options).replace(/<!doctype[^>]*>/i, '');
  return html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
}
