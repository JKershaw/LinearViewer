/**
 * LIN-2298's class witness — the shared overlay geometry sweep.
 *
 * Kept OUT of tests/helpers.js on purpose: that file is the documented SESSION +
 * SELECTOR seam, and a scroll-sweeping geometry probe is neither.
 */

//
// Sweeps every 2px scroll offset and reports the offsets at which `selector`'s
// rect intersects a VISIBLE OUT-OF-FLOW OVERLAY. This is the generalised form
// of the per-element sweeps LIN-2272/2299/2296 wrote: the class result is
// "content in normal flow cannot be kept clear of an overlay by any reserve",
// so the durable assertion is about overlays as a CATEGORY, not about the one
// that happened to exist when the test was written.
//
// ---- Why `sticky` is swept as well as `fixed` -------------------------------
//
// The first version of this helper filtered on `position: fixed` alone, and the
// LIN-2298 review was right to call that both vacuous and an overclaim.
//
// Vacuous, because with the FAB deleted there is no visible fixed element left
// on these pages — `.feedback-popup` is `hidden`, `.queue-panel` /
// `.nav-dropdown-overlay` / `.token-modal` are `display: none`, and
// `.toast-container` is created lazily on first toast. The candidate set was
// EMPTY, so every sweep would have passed identically if this function's body
// were `return []`. That is precisely the LIN-2252 no-op shape this whole
// ticket family exists to have caught, reproduced inside its own guard.
//
// An overclaim, because `.nav-bar` is `position: sticky; top: 0` with a
// `z-index` and a translucent wash (public/style.css) — and LIN-2298 moved the
// feedback trigger INTO it. A sticky header genuinely does overlay scrolled
// content; style.css's own comment records the interception hazard that once
// backed it out. Sweeping only `fixed` meant the prose "nothing floats over
// this column any more" was asserted by a witness structurally incapable of
// seeing the thing that does.
//
// So both are swept, and callers deal with the deliberate one EXPLICITLY rather
// than having the filter hide it. tests/e2e/observation.spec.js — where the nav
// really does pass over the feed — asserts that the sticky nav is the ONLY
// thing covering the card, naming anything else in the failure. That is
// strictly better than an exclusion list: an exclusion would empty the
// candidate set on that page and hand back a green result proving nothing,
// while this way a NEW overlay is caught and the one deliberate overlay is a
// visible, argued decision instead of a silent filter rule.
//
// `exclude` remains available for the feedback PANEL, which John's ruling kept
// as an overlay on purpose — it appears only once the user opens it, so it
// covers content by the user's own choice. A sweep run with the panel open must
// say so explicitly rather than have the helper special-case it.
//
// ---- Why the candidate set is returned --------------------------------------
//
// `candidates` is the answer to "could this sweep have failed at all?". A
// caller asserting `hits` is empty proves nothing unless the machinery had
// something to find; the count makes that assertable at the call site instead
// of assumed. `tests/e2e/overlay-sweep-control.spec.js` is the positive
// control that pins the machinery itself.
//
// The candidate set is collected ONCE, before scrolling. An out-of-flow
// overlay's viewport rect is invariant under scroll, so re-collecting per
// offset would cost a full DOM walk per step. KNOWN LIMIT, stated rather than
// glossed: existence and visibility are NOT scroll-invariant, so an overlay
// that only appears once the page is scrolled — a scroll-revealed back-to-top
// button, the single most likely reintroduction of this exact defect — is
// never in the set. Closing that means re-collecting per offset; it is not
// closed here, and a sweep is not evidence against that shape.
//
// Zero-area elements are excluded: `display: none` modals and empty containers
// report all-zero rects, and treating those as overlays would make every sweep
// fail on a coincidence of the origin rather than on a real intersection.
//
// Hits carry an identifier for the overlapping element, not just an offset — a
// bare list of scroll positions says a sweep failed but not what it hit, and
// the point of generalising the assertion is that the culprit is no longer
// known in advance.
export async function sweepFixedOverlaps(page, selector, { exclude = [] } = {}) {
  return page.evaluate(({ selector, exclude }) => {
    // Fail LOUDLY on a half-parsed document rather than sweeping it.
    //
    // A sweep run mid-navigation walks a partial DOM, finds few or no overlay
    // candidates, and returns a green "no overlaps" that means nothing. That is
    // not hypothetical — it is how the LIN-2298 sweeps behaved when their
    // caller's wait resolved against a pre-reload page (see `enableWidget` in
    // tests/e2e/feedback-widget.spec.js). The vacuity check catches the worst
    // case, but a partially-parsed page can also carry SOME candidates and
    // still be missing the one that matters, which nothing downstream could
    // detect. So the precondition is asserted here, once, for every caller.
    if (document.readyState !== 'complete') {
      throw new Error(`sweep ran against a document in readyState "${document.readyState}" — wait for the page to settle first`)
    }

    const target = document.querySelector(selector)
    if (!target) throw new Error(`sweep target not found: ${selector}`)

    const label = (el) => el.getAttribute('data-testid') || el.className || el.tagName.toLowerCase()

    const overlays = Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (el === target || el.contains(target) || target.contains(el)) return false
      if (exclude.some((sel) => el.closest(sel))) return false
      const pos = getComputedStyle(el).position
      if (pos !== 'fixed' && pos !== 'sticky') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })

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
    return { hits, candidates: overlays.map(label) }
  }, { selector, exclude })
}

// Render a sweep's result as an assertion message. Names the overlay as well as
// the offsets, so a failure reads as "what covered this, and where" rather than
// a bare list of numbers — and names the candidate set on success, so a GREEN
// run still shows what the sweep was actually looking at.
export function describeHits(result) {
  const hits = Array.isArray(result) ? result : result.hits
  const candidates = Array.isArray(result) ? [] : result.candidates
  if (!hits.length) return `no overlaps (swept against: ${candidates.join(', ') || 'NOTHING — vacuous'})`
  const byOverlay = new Map()
  for (const h of hits) {
    if (!byOverlay.has(h.overlay)) byOverlay.set(h.overlay, [])
    byOverlay.get(h.overlay).push(h.y)
  }
  return Array.from(byOverlay, ([overlay, ys]) =>
    `covered by ${overlay} at ${ys.length} offsets (scrollY ${ys[0]}–${ys[ys.length - 1]})`).join('; ')
}

/**
 * Assert a sweep found something to sweep against.
 *
 * The review finding this exists for: three call sites carried comments
 * claiming "preconditions, so the sweep cannot pass by sweeping nothing", and
 * none of their preconditions established that a single overlay candidate
 * existed. They asserted the page scrolled and the target was visible — both
 * necessary, neither sufficient. This is the missing half, and it replaces the
 * `await expect(fab).toBeVisible()` precondition the FAB's deletion removed.
 */
export function expectSweepNotVacuous(expect, result, note = '') {
  expect(
    result.candidates.length,
    `sweep had NO overlay candidates${note ? ` (${note})` : ''} — a green result here would be vacuous`
  ).toBeGreaterThan(0)
}
