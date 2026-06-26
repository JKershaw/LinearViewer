/**
 * Shared Page Shell Component
 *
 * Renders the single HTML-document contract for every full page in the app
 * (the `<!DOCTYPE>` … `</html>` wrapper, `<head>` links, body attributes, and
 * the post-content `<script>` block). A template-literal helper in the same
 * style as `renderNavBar`/`renderPageFooter` — NOT a new rendering system.
 *
 * This module is also the single seam for embedding JSON data into a page:
 * `embedJson()` is the one hardener, routed through the `embeddedData` field so
 * every page gets the same `<script>`-breakout-safe escaping (LIN-455 / 0A′).
 */

import { FAVICON_BASE64 } from '../utils/html.js';

/**
 * Safe JSON for embedding inside a `<script>` block.
 *
 * - `<` → `<` blocks `</script>` breakout
 * - U+2028 / U+2029 → escaped so ES5 parsers don't see a line terminator
 *
 * @param {*} value
 * @returns {string}
 */
export function embedJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Render a complete HTML document.
 *
 * `nav`, `scripts`, `bodyClass`, `bodyAttrs`, `headExtra`, `viewport`,
 * `htmlComment`, and `embeddedData` are all optional — the 3 bare
 * `render-pages.js` documents pass none of them.
 *
 * @param {Object} opts
 * @param {string} opts.title - Full, already-escaped `<title>` text.
 * @param {string[]} [opts.stylesheets] - Ordered stylesheet hrefs, emitted
 *   verbatim. NOT auto-prepended with `/style.css` — per-page order differs.
 * @param {string} [opts.bodyClass] - `class` attribute value for `<body>`.
 * @param {string} [opts.bodyAttrs] - Extra raw `<body>` attributes (e.g.
 *   `data-provider-name="Linear"`), already escaped by the caller.
 * @param {string} [opts.headExtra] - Extra `<head>` markup emitted after the
 *   favicon link and before the stylesheets (e.g. `<meta name="robots" …>`).
 * @param {string} [opts.viewport] - `<meta name="viewport">` content.
 * @param {string} [opts.htmlComment] - Comment text emitted between the
 *   `<!DOCTYPE>` and `<html>` lines (e.g. the AI-agents llms.txt pointer).
 * @param {string} [opts.nav] - Navigation-bar HTML (rendered before content).
 * @param {string} [opts.content] - Body content HTML (nav excluded, scripts
 *   excluded). Includes the page footer.
 * @param {string[]} [opts.scripts] - `<script src>` hrefs, emitted after the
 *   embedded-data script.
 * @param {{globalVar: string, value: *}} [opts.embeddedData] - Data embedded as
 *   `window.<globalVar>`, serialized through {@link embedJson}.
 * @returns {string} Complete HTML document.
 */
export function renderPage({
  title,
  stylesheets = [],
  bodyClass,
  bodyAttrs,
  headExtra,
  viewport = 'width=device-width, initial-scale=1.0',
  htmlComment,
  nav,
  content = '',
  scripts = [],
  embeddedData
} = {}) {
  const headLines = [
    '<head>',
    '  <meta charset="UTF-8">',
    `  <meta name="viewport" content="${viewport}">`,
    `  <title>${title}</title>`,
    `  <link rel="icon" type="image/png" href="data:image/png;base64,${FAVICON_BASE64}">`,
    '  <link rel="icon" type="image/png" sizes="32x32" href="/logo/favicon-32x32.png">',
    '  <link rel="icon" type="image/png" sizes="16x16" href="/logo/favicon-16x16.png">',
    '  <link rel="icon" type="image/x-icon" href="/logo/favicon.ico">',
    '  <link rel="apple-touch-icon" sizes="180x180" href="/logo/apple-touch-icon.png">'
  ];
  if (headExtra) headLines.push(`  ${headExtra}`);
  for (const href of stylesheets) {
    headLines.push(`  <link rel="stylesheet" href="${href}">`);
  }
  headLines.push('</head>');

  const bodyAttrStr = `${bodyClass ? ` class="${bodyClass}"` : ''}${bodyAttrs ? ` ${bodyAttrs}` : ''}`;

  // Body segments, each indented by 2 spaces (matching the original template
  // interpolation, which indents only each segment's first line).
  const bodyParts = [];
  if (nav) bodyParts.push(nav);
  if (content) bodyParts.push(content);
  if (embeddedData) {
    bodyParts.push(`<script>window.${embeddedData.globalVar} = ${embedJson(embeddedData.value)};</script>`);
  }
  for (const src of scripts) {
    bodyParts.push(`<script src="${src}"></script>`);
  }
  const bodyInner = bodyParts.map(part => `  ${part}`).join('\n');

  const docComment = htmlComment ? `\n<!-- ${htmlComment} -->` : '';

  return `<!DOCTYPE html>${docComment}
<html lang="en">
${headLines.join('\n')}
<body${bodyAttrStr}>
${bodyInner}
</body>
</html>`;
}
