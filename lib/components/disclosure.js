/**
 * Shared Disclosure Primitive (LIN-786, Theme S2 §9)
 *
 * A token-only collapsible built on native `<details>/<summary>` — pure
 * `renderDisclosure() → HTML string`. Using the native element means keyboard
 * operation, the open/closed toggle, and the focusable summary all come for
 * free; the global S1 `:focus-visible` ring covers the summary with no new focus
 * machinery and no `outline:none`. A token-styled caret marks state.
 *
 * `summary` and `body` are RAW HTML (the caller escapes its own dynamic text,
 * per the `card`/`section` slot convention). `open` renders it expanded.
 * `className`/`attrs` extend the `<details>` element.
 *
 * @param {Object} opts
 * @param {string} opts.summary - Summary row markup (raw).
 * @param {string} opts.body - Disclosed body markup (raw).
 * @param {boolean} [opts.open] - Render expanded.
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 * @returns {string} Disclosure HTML.
 */
export function renderDisclosure({ summary, body, open, className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(summary)) {
    throw new Error('renderDisclosure requires a `summary`.');
  }
  if (!has(body)) {
    throw new Error('renderDisclosure requires a `body`.');
  }
  const classes = ['disclosure'];
  if (className) classes.push(className);
  const openAttr = open ? ' open' : '';
  const attrStr = attrs ? ` ${attrs}` : '';

  return `<details class="${classes.join(' ')}"${openAttr}${attrStr}>`
    + `<summary class="disclosure__summary">`
    + `<span class="disclosure__caret" aria-hidden="true"></span>`
    + `<span class="disclosure__label">${summary}</span>`
    + `</summary>`
    + `<div class="disclosure__body">${body}</div>`
    + `</details>`;
}
