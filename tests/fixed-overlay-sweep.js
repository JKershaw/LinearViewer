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
// There is deliberately NO `exclude` parameter. An earlier version had one, and
// prose describing a panel-open sweep that no caller ever wrote — dead surface
// carrying a live-sounding justification, which is the same defect class this
// ticket is cleaning up. If a caller ever needs to tolerate a specific overlay,
// it filters the returned `hits` itself, where the tolerance is visible in the
// assertion rather than hidden in the helper.
//
// ---- Why the candidate set is returned, and what it does NOT prove ----------
//
// `candidates` reports what the DOM walk actually found. Returning it exists
// because the first version of this helper returned only `hits`, so a caller
// asserting "no overlaps" could not tell an empty result from a broken sweep.
//
// Be precise about its strength, because an earlier version of this comment was
// not. It said `candidates` answers "could this sweep have failed at all?". It
// does NOT. On the footer and Live Console sweeps the only candidate is the
// sticky `.nav-bar`, which is pinned to the TOP of the viewport while those
// targets sit at the bottom of the document — measured, they never share a
// band. So a non-empty candidate list there means the walk ran, not that a
// failure was reachable.
//
// What each mechanism actually buys, stated so nobody has to re-derive it:
//   - `expectSweepNotVacuous` catches the walk finding NOTHING — a genuinely
//     real case: it is what surfaced the half-parsed-document race (an unstyled
//     `.nav-bar` computes `static`, so nothing qualified).
//   - The `readyState` guard below is what actually closed that race.
//   - `tests/e2e/overlay-sweep-control.spec.js` is what proves the machinery
//     can report an overlay at all, at every width the real sweeps use. It is
//     the load-bearing evidence; the call-site sweeps are regression nets whose
//     detection capability that control underwrites.
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
export async function sweepFixedOverlaps(page, selector) {
  return page.evaluate(({ selector }) => {
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

    // `getAttribute('class')`, never `el.className`: on an SVG element the
    // latter is an `SVGAnimatedString`, not a string. This helper's whole
    // selling point is catching overlay shapes nobody has written yet, and a
    // fixed/sticky <svg> would have put a non-cloneable object into the
    // page.evaluate return and broken the sweep instead of reporting it.
    const label = (el) => el.getAttribute('data-testid') || el.getAttribute('class') || el.tagName.toLowerCase()

    const overlays = Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (el === target || el.contains(target) || target.contains(el)) return false
      const pos = getComputedStyle(el).position
      if (pos !== 'fixed' && pos !== 'sticky') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })

    // EVERY overlapping overlay at each offset, not just the first.
    //
    // This loop used to `break` on the first hit. That was a structural blind
    // spot in the one assertion this ticket exists to make: `overlays` is in
    // document order, `.nav-bar` is an early <nav> in <body>, and the
    // Observation acceptance FILTERS the sticky nav out of the hits. So any new
    // overlay covering the card at offsets where the nav also covers it was
    // recorded as "nav", filtered away, and reported as no overlap — a fixed
    // top banner, a sticky sub-header, a sticky `.obs-controls-section`. The
    // test's own comment promised "anything else fails and is named in the
    // failure" while the helper made that impossible. Caught in re-review.
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    const hits = []
    for (let y = 0; y <= Math.max(maxScroll, 0); y += 2) {
      window.scrollTo(0, y)
      const a = target.getBoundingClientRect()
      for (const el of overlays) {
        const b = el.getBoundingClientRect()
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          hits.push({ y, overlay: label(el) })
        }
      }
    }
    return { hits, candidates: overlays.map(label) }
  }, { selector })
}

// Render a sweep's result as an assertion message. Names the overlay as well as
// the offsets, so a failure reads as "what covered this, and where" rather than
// a bare list of numbers — and names the candidate set on success, so a GREEN
// run still shows what the sweep was actually looking at.
export function describeHits(result) {
  const { hits, candidates } = result
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
 * necessary, neither sufficient.
 *
 * This is a NARROWER guarantee than "this sweep could have failed", and it is
 * documented as such at the top of this file: it catches an empty walk (an
 * unstyled or half-parsed document), not an irrelevant-candidate one. The
 * positive-control spec is what underwrites detection capability.
 */
export function expectSweepNotVacuous(expect, result, note = '') {
  expect(
    result.candidates.length,
    `sweep had NO overlay candidates${note ? ` (${note})` : ''} — a green result here would be vacuous`
  ).toBeGreaterThan(0)
}
