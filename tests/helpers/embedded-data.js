/**
 * Read the data `renderPage({ embeddedData })` embeds (LIN-3420): a
 * `<script type="application/json" data-global="X">` block that a hashed loader
 * assigns to `window.X`. One extraction seam for every test that inspects it.
 */

/**
 * The raw (still `embedJson`-escaped) text of the block for `globalVar`, or
 * null when the page does not embed it.
 */
export function embeddedDataText(html, globalVar) {
  const match = new RegExp(
    `<script type="application/json" data-global="${globalVar}">([\\s\\S]*?)</script>`
  ).exec(html);
  return match ? match[1] : null;
}

/** The parsed value of the block for `globalVar`; throws when it is absent. */
export function extractEmbeddedData(html, globalVar) {
  const text = embeddedDataText(html, globalVar);
  if (text === null) throw new Error(`${globalVar} is not embedded in the page`);
  return JSON.parse(text);
}
