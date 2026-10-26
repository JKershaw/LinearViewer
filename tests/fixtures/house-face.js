/**
 * LIN-3968: "has a face" means a house colour, not a browser default. A button with no rule of its own keeps the
 * browser's grey, which is not a house token, so it fails. The colours are resolved through a probe element, so the
 * check follows the active theme (light, or the `.theme-dark` hook on <html>).
 */

/** The semantic colour tokens a button's background or border may use (public/style.css :root, both themes). */
export const HOUSE_COLOUR_TOKENS = [
  '--card', '--card-h', '--raised', '--inset', '--line', '--line-soft', '--border', '--border-strong',
  '--border-subtle', '--brand', '--brand-dim', '--amber', '--slate', '--text', '--muted', '--faint',
  '--bg-alt', '--bg-muted',
];

/**
 * Buttons in `block` outside the run panel (LIN-3962 owns that panel) whose background is not a house colour and
 * whose border is not a house colour either. Returns their outer HTML, so a failure names the button.
 *
 * @param {import('@playwright/test').Locator} block
 * @returns {Promise<string[]>}
 */
export async function facelessButtons(block) {
  return block.evaluate((root, tokens) => {
    const transparent = (c) => c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
    const probe = document.createElement('i');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const house = new Set();
    for (const token of tokens) {
      probe.style.backgroundColor = `var(${token})`;
      const resolved = getComputedStyle(probe).backgroundColor;
      if (!transparent(resolved)) house.add(resolved);
    }
    probe.remove();
    return [...root.querySelectorAll('button')]
      .filter((b) => !b.closest('.opened-task-run'))
      .filter((b) => {
        const cs = getComputedStyle(b);
        const bordered = cs.borderTopStyle !== 'none' && !transparent(cs.borderTopColor);
        return !house.has(cs.backgroundColor) && !(bordered && house.has(cs.borderTopColor));
      })
      .map((b) => b.outerHTML.slice(0, 120));
  }, HOUSE_COLOUR_TOKENS);
}
