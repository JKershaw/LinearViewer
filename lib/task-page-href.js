/**
 * The one builder for a link to a task's page (LIN-3331, Subtask D of LIN-3324).
 *
 * The task page lives at `GET /workspace/:urlKey/task/:identifier` (LIN-3329).
 * Every surface that shows a task and links to that page goes through
 * `taskPageHref` so the path is never hand-rolled twice, and the issue's own
 * binding provenance (`?source=&bindingScope=`, as the Edit and Chat links
 * carry it, LIN-1904 / LIN-3240) is attached the SAME way everywhere.
 *
 * `bindingScope` is selection-only provenance, never a credential (B1).
 *
 * Empty inputs are dropped and `''` is returned when the path cannot be built,
 * so a caller omits the link instead of emitting a broken one.
 */

/**
 * The `?source=&bindingScope=` query fragment (no leading delimiter), the pair
 * appended in that order, each only when non-empty and each URL-encoded. Shared
 * with the Edit/Chat links (`lib/render.js`) so their query can never drift from
 * the task page's; `''` when both are absent.
 *
 * @param {string} [source] - resolved provider name
 * @param {string} [bindingScope] - binding selector stamp
 * @returns {string}
 */
export function bindingQuery(source, bindingScope) {
  const parts = [];
  if (source) parts.push(`source=${encodeURIComponent(source)}`);
  if (bindingScope) parts.push(`bindingScope=${encodeURIComponent(bindingScope)}`);
  return parts.join('&');
}

/**
 * An href to a task's page, or `''` when `urlKey` or `identifier` is missing.
 *
 * @param {Object} opts
 * @param {string} opts.urlKey - workspace url key
 * @param {string} opts.identifier - issue identifier to link to
 * @param {string} [opts.source] - resolved provider name (selection provenance)
 * @param {string} [opts.bindingScope] - binding selector stamp
 * @returns {string} href (unescaped; escape at the attribute)
 */
export function taskPageHref({ urlKey, identifier, source, bindingScope } = {}) {
  if (!urlKey || !identifier) return '';
  const path = `/workspace/${encodeURIComponent(urlKey)}/task/${encodeURIComponent(identifier)}`;
  const query = bindingQuery(source, bindingScope);
  return query ? `${path}?${query}` : path;
}
