/**
 * The swipe page's world (LIN-4463 piece 5): `public/swipe.js` imported as the native module it is, over the fake DOM, with
 * the server's own swipe markup in the body first (helpers/swipe-page.js), since swipe.js reads its filter, card and arrows
 * at load and draws the first card at once.
 *
 *   const world = await swipeWorld(t, { data: { issues, filters, urlKey } });
 *   world.document.getElementById('swipe-card').innerHTML
 *
 * The page's classic globals are given, not rebuilt by hand in each suite. The ones swipe.js reads while it draws a card
 * come from their server authorities where one exists: `isTerminalState` over `TERMINAL_TYPES` (lib/providers/models.js,
 * the list common.js mirrors), `escapeHtml` (lib/utils/html.js). `renderMarkdown` escapes and `relativeTime` is empty,
 * since no suite here asserts either. `window` stubs a suite passes win. `restore()` runs in t.after.
 */
import { importWorld } from './import-world.js';
import { swipePageBody } from './swipe-page.js';
import { TERMINAL_TYPES } from '../../../lib/providers/models.js';
import { escapeHtml } from '../../../lib/utils/html.js';

export async function swipeWorld(t, { data = {}, window = {}, classic = [] } = {}) {
  const world = importWorld({
    window: {
      __SWIPE_DATA__: data,
      isTerminalState: (stateType) => TERMINAL_TYPES.includes(stateType),
      escapeHtml,
      renderMarkdown: (s) => escapeHtml(s),
      stripCodeBlockWrapper: (s) => s,
      relativeTime: () => '',
      sourceQuery: (source) => (source ? `?source=${encodeURIComponent(source)}` : ''),
      api: async () => ({}),
      ...window,
    },
    globals: { location: { search: '', href: '', pathname: '/' }, history: { replaceState() {} } },
  });
  t.after(() => world.restore());
  world.document.body.innerHTML = swipePageBody({ urlKey: data.urlKey });
  for (const name of classic) world.runClassic(name);
  await world.importPage('swipe.js');
  return world;
}
