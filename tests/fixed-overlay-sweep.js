/**
 * LIN-2298's class witness — the shared fixed-overlay geometry sweep.
 *
 * Kept OUT of tests/helpers.js on purpose: that file is the documented SESSION +
 * SELECTOR seam, and a scroll-sweeping geometry probe is neither. Kept out of a
 * spec file too — Playwright registers tests per imported file, so exporting
 * this from a `.spec.js` would re-register that spec's whole suite inside every
 * importer.
 */

//
// Sweeps every 2px scroll offset and returns the offsets at which `selector`'s
// rect intersects ANY VISIBLE `position: fixed` element on the page. This is
// the generalised form of the per-element sweeps LIN-2272/2299/2296 wrote: the
// class result is "content in normal flow cannot be kept clear of a fixed
// overlay by any reserve", so the durable assertion is about fixed overlays as
// a category, not about the one that happened to exist when the test was
// written.
//
// The fixed set is collected ONCE, before scrolling: a `position: fixed`
// element's viewport rect is by definition invariant under scroll, so
// re-collecting per offset would cost a full DOM walk per step and buy nothing.
// Zero-area elements are excluded — `display: none` modals (`.queue-panel`,
// `.token-modal`) and empty containers (`.toast-container`) report all-zero
// rects, and treating those as overlays would make every sweep fail on a
// coincidence of the origin rather than on a real intersection.
//
// `exclude` exists for the feedback PANEL. John's ruling kept the panel as an
// overlay on purpose — it appears only once the user opens it, so it covers
// content by the user's own choice, which is not the defect. A sweep run with
// the panel open must say so explicitly rather than have the helper silently
// special-case it.
//
// Hits carry an identifier for the overlapping element, not just an offset:
// a bare list of scroll positions tells you a sweep failed but not what it hit,
// and the whole point of generalising the assertion is that the culprit is no
// longer known in advance.
export async function sweepFixedOverlaps(page, selector, { exclude = [] } = {}) {
  return page.evaluate(({ selector, exclude }) => {
    const target = document.querySelector(selector)
    if (!target) throw new Error(`sweep target not found: ${selector}`)

    const overlays = Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (el === target || el.contains(target) || target.contains(el)) return false
      if (exclude.some((sel) => el.closest(sel))) return false
      if (getComputedStyle(el).position !== 'fixed') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })

    const label = (el) => el.getAttribute('data-testid') || el.className || el.tagName.toLowerCase()
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    const hits = []
    for (let y = 0; y <= Math.max(maxScroll, 0); y += 2) {
      window.scrollTo(0, y)
      const a = target.getBoundingClientRect()
      for (const el of overlays) {
        const b = el.getBoundingClientRect()
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          hits.push({ y, overlay: label(el) })
          break
        }
      }
    }
    return hits
  }, { selector, exclude })
}

// Render a sweep's hits as an assertion message. Names the overlay as well as
// the offsets, so a failure reads as "what covered this, and where" rather than
// a bare list of numbers.
export function describeHits(hits) {
  if (!hits.length) return 'no overlaps'
  const byOverlay = new Map()
  for (const h of hits) {
    if (!byOverlay.has(h.overlay)) byOverlay.set(h.overlay, [])
    byOverlay.get(h.overlay).push(h.y)
  }
  return Array.from(byOverlay, ([overlay, ys]) =>
    `covered by ${overlay} at ${ys.length} offsets (scrollY ${ys[0]}–${ys[ys.length - 1]})`).join('; ')
}

