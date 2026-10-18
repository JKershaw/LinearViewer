// Bounded page-number walk over GitHub's `GET /user/installations` envelope
// (`{ total_count, installations }`) — LIN-3626. Both readers of that endpoint
// (the Issues REST client and the App-auth reader the Projects provider uses)
// call this one walker so they cannot drift.
//
// Deliberately NOT `walkRepoPages` (client.js, LIN-2820): that walk keys on
// `repositories` and defaults `total_count` to `out.length` when the envelope
// omits it, which makes its short-page rule dead and would stop after a full
// first page of exactly 100. Here an absent `total_count` is "unknown", so a
// full page fetches the next one.
//
// Caller-facing shape follows the LIN-2820 convention: a bare array, with an
// own `.truncated = true` attached ONLY when the walk stopped with more
// installations known or possible. A complete read stays a plain array.
//
// `fetchPage(page)` returns the parsed envelope and must THROW on failure — a
// failure on page 2 must never surface page 1 as a complete list (LIN-3404
// fails closed on a lookup error).

export const INSTALLATIONS_PER_PAGE = 100
export const DEFAULT_INSTALLATION_CAP = 500

export function installationsPath(page) {
  return page === 1
    ? `/user/installations?per_page=${INSTALLATIONS_PER_PAGE}`
    : `/user/installations?per_page=${INSTALLATIONS_PER_PAGE}&page=${page}`
}

export async function walkInstallationPages(fetchPage, { cap = DEFAULT_INSTALLATION_CAP } = {}) {
  const out = []
  const seen = new Set()
  let totalCount = null
  let more = false
  for (let page = 1; ; page++) {
    const data = await fetchPage(page)
    const batch = data?.installations || []
    const before = out.length
    // Pagination can shift under the walk; dedupe by id, order-preserving.
    for (const inst of batch) {
      const key = inst?.id == null ? null : String(inst.id)
      if (key !== null) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      out.push(inst)
    }
    totalCount = typeof data?.total_count === 'number' ? data.total_count : null
    const fullPage = batch.length >= INSTALLATIONS_PER_PAGE
    const known = totalCount !== null
    const remaining = known ? out.length < totalCount : fullPage
    if (!remaining) { more = false; break }
    if (out.length >= cap) { more = true; break }
    // A full page that added nothing (all duplicates after a mid-walk shift)
    // cannot make progress; stop, but say so rather than claim completeness.
    if (out.length === before) { more = true; break }
    if (!known && !fullPage) { more = false; break }
    more = true
  }
  // A cap that is not a multiple of the page size clips the last page; the rows
  // dropped here were fetched but not returned, so the read is partial even when
  // the envelope said the walk was complete.
  if (out.length > cap) { out.length = cap; more = true }
  if (more) out.truncated = true
  return out
}
