/**
 * public/frame.js — the frame's browser half (LIN-4342, piece 1: LIN-4562). The markup is lib/components/frame.js.
 *
 * Two behaviours, nothing else:
 *  - the drawer: below 760px the rail is a drawer behind ☰. Opening it moves focus into it; Escape, the scrim, or ☰
 *    again closes it, and focus returns to ☰. Closed, public/frame.css takes it out of the Tab order.
 *  - the workspace menu (switch and add): its button opens and closes it; Escape closes it and returns focus to the
 *    button; a click outside closes it.
 * The counts in the rail and the band are written by public/common.js's updaters (every copy), not here.
 *
 * A module that touches no global (docs/areas/front-end-browser.md: the bridge is at zero): it writes nothing to
 * `window`, and it registers its DOMContentLoaded listener unconditionally, because a module runs while the document
 * is already 'interactive'. `initFrame` is exported as the test seam.
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Wire the frame on `doc`. Returns a small handle for tests: `{ openDrawer, closeDrawer, isDrawerOpen }`, or null when
 * the page has no frame.
 * @param {Document} [doc]
 */
export function initFrame(doc = document) {
  const body = doc.body;
  const rail = doc.getElementById('frame-rail');
  if (!body || !rail) return null;
  const menuButton = doc.querySelector('.frame-band__menu');
  const scrim = doc.querySelector('.frame-scrim');
  const wsToggle = doc.getElementById('frame-workspace-toggle');
  const wsMenu = doc.getElementById('frame-workspace-menu');

  const isDrawerOpen = () => body.classList.contains('frame-drawer-open');

  function openDrawer() {
    body.classList.add('frame-drawer-open');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'true');
    if (scrim) scrim.hidden = false;
    const first = rail.querySelector(FOCUSABLE);
    if (first) first.focus();
  }

  function closeDrawer({ returnFocus = true } = {}) {
    if (!isDrawerOpen()) return;
    body.classList.remove('frame-drawer-open');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
    if (scrim) scrim.hidden = true;
    if (returnFocus && menuButton) menuButton.focus();
  }

  const isMenuOpen = () => !!wsMenu && !wsMenu.hidden;

  function setMenu(open, { returnFocus = false } = {}) {
    if (!wsMenu || !wsToggle) return;
    wsMenu.hidden = !open;
    wsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const first = wsMenu.querySelector(FOCUSABLE);
      if (first) first.focus();
    } else if (returnFocus) {
      wsToggle.focus();
    }
  }

  if (menuButton) {
    menuButton.addEventListener('click', () => (isDrawerOpen() ? closeDrawer() : openDrawer()));
  }
  if (scrim) scrim.addEventListener('click', () => closeDrawer());

  if (wsToggle && wsMenu) {
    wsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenu(!isMenuOpen());
    });
    wsMenu.addEventListener('click', (e) => e.stopPropagation());
    doc.addEventListener('click', () => {
      if (isMenuOpen()) setMenu(false);
    });
  }

  // Escape closes the innermost first: the workspace menu, then the drawer.
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (isMenuOpen()) {
      setMenu(false, { returnFocus: true });
      return;
    }
    if (isDrawerOpen()) closeDrawer();
  });

  return { openDrawer, closeDrawer, isDrawerOpen };
}

document.addEventListener('DOMContentLoaded', () => {
  initFrame(document);
});
