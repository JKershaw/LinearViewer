/**
 * The server's task page, body only (LIN-4254 piece 5). A suite that runs `public/task-page.js` (or a card script) on
 * `loadWorld` sets `world.document.body.innerHTML` to this first, so the page's hooks are the ones `renderTaskPage` draws,
 * not a copy of them. Pass the full document the renderer returned; the doctype is removed because the client world's
 * parser refuses one (as `swipe-page.js` does).
 */
export function bodyOf(html) {
  const body = html.replace(/<!doctype[^>]*>/i, '').match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!body) throw new Error('bodyOf: the renderer returned no <body>');
  return body[1];
}
