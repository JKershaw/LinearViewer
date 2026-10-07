/**
 * The one builder for a link to a task's page (LIN-3331, Subtask D of LIN-3324).
 *
 * The task page lives at `GET /workspace/:urlKey/task/:identifier` (LIN-3329).
 * Every surface that shows a task and links to that page goes through
 * `taskPageHref` so the path is never hand-rolled twice, and the issue's own
 * provider-kind provenance (`?source=<kind>`, as the Edit and Chat links carry
 * it, LIN-1904) is attached the SAME way everywhere.
 *
 * A link carries `?source=<kind>` whenever the row knows its kind; without one it
 * stays a bare path, which resolves to the workspace's active provider (LIN-3332).
 *
 * Empty inputs are dropped and `''` is returned when the path cannot be built,
 * so a caller omits the link instead of emitting a broken one.
 */

/**
 * The `?source=<kind>` query fragment (no leading delimiter), appended only when
 * non-empty and URL-encoded. Shared with the Edit/Chat links (`lib/render.js`)
 * so their query can never drift from the task page's; `''` when absent.
 *
 * @param {string} [source] - resolved provider name
 * @returns {string}
 */
export function sourceQuery(source) {
  return source ? `source=${encodeURIComponent(source)}` : '';
}

/**
 * An href to a task's page, or `''` when `urlKey` or `identifier` is missing.
 *
 * @param {Object} opts
 * @param {string} opts.urlKey - workspace url key
 * @param {string} opts.identifier - issue identifier to link to
 * @param {string} [opts.source] - resolved provider name (selection provenance)
 * @returns {string} href (unescaped; escape at the attribute)
 */
export function taskPageHref({ urlKey, identifier, source } = {}) {
  if (!urlKey || !identifier) return '';
  const path = `/workspace/${encodeURIComponent(urlKey)}/task/${encodeURIComponent(identifier)}`;
  const query = sourceQuery(source);
  return query ? `${path}?${query}` : path;
}
