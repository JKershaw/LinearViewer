/**
 * Shared Section Component (LIN-461, Phase A.1)
 *
 * The first server component of Phase A's library. A pure
 * `renderSection() → HTML string` helper in the same idiom as
 * `renderNavBar`/`renderPageFooter`/`renderPage` — no framework, no build step.
 *
 * It owns the *in-card* section wrapper and its `h2`/`h3` heading. Page-level
 * `h1`/subtitle stay with `pageHeader` (LIN-462) — the two never both claim a
 * heading.
 *
 * The canonical look lives in `public/style.css` on Phase-0 tokens:
 *   .section                  base — margin-bottom only (var(--space-5))
 *   .section--boxed           light-box (padding/bg/radius) — dispatch/proxy/settings
 *   .section-header           in-card heading (1em/500)
 *   .section-header--ruled    underlined heading — prompts
 *
 * `title` and `body` are emitted as raw HTML (callers already build heading
 * markup such as `History <button …>` and escape their own dynamic text); this
 * preserves existing output byte-for-byte. `className`/`attrs` are escape
 * hatches so a page can retain a behavioural/test hook class (e.g.
 * `dispatch-section`, which `dispatch.js` reaches via `.closest()` and several
 * `.X-section .line` descendant rules still scope on) without re-introducing a
 * styling variant.
 *
 * @param {Object} opts
 * @param {string} [opts.title] - Heading HTML. Omit for a header-less section.
 * @param {'h2'|'h3'} [opts.titleTag='h2'] - Heading tag.
 * @param {string} [opts.titleClass='section-header'] - Heading class. Pass ''
 *   to leave the heading unclassed (legal leans on `.legal-content h3`).
 * @param {'ruled'} [opts.titleVariant] - Appends `section-header--<variant>`.
 * @param {string} [opts.body=''] - Section body HTML.
 * @param {boolean} [opts.boxed=false] - Adds `.section--boxed` (light box).
 * @param {string} [opts.className] - Extra class(es) on the wrapper.
 * @param {string} [opts.attrs] - Extra raw wrapper attributes (id, hidden, …),
 *   already escaped by the caller.
 * @returns {string} Section HTML.
 */
export function renderSection({
  title,
  titleTag = 'h2',
  titleClass = 'section-header',
  titleVariant,
  body = '',
  boxed = false,
  className,
  attrs,
} = {}) {
  const classes = ['section'];
  if (boxed) classes.push('section--boxed');
  if (className) classes.push(className);

  const attrStr = attrs ? ` ${attrs}` : '';

  let headingHtml = '';
  if (title != null && title !== '') {
    const headingClasses = [];
    if (titleClass) headingClasses.push(titleClass);
    if (titleVariant) headingClasses.push(`section-header--${titleVariant}`);
    const classAttr = headingClasses.length ? ` class="${headingClasses.join(' ')}"` : '';
    headingHtml = `<${titleTag}${classAttr}>${title}</${titleTag}>\n      `;
  }

  return `<section class="${classes.join(' ')}"${attrStr}>
      ${headingHtml}${body}
    </section>`;
}
