/**
 * Plain page layout (LIN-3950, the first shared move of the UI sweep, LIN-3892).
 *
 * The one standard layout the Plain pages share: a page title and lede, sections, rows, notes, a form
 * and an empty state. A pure `renderPlainPage() → HTML string` helper over the existing builders, in
 * the same idiom as `renderSection` and `renderPageHeader`. It returns the header and
 * `<main class="plain-page">`; the page passes that as `content` to `renderPage`, as Settings passes
 * `renderSettingsShell`. The footer is the page's own.
 *
 * A page with a `rows` section, or a footer or other body after the main, uses `renderPlainDocument`
 * instead: it is the document entry, and it owns the `/settings.css` link, so a caller cannot forget it
 * (LIN-3956). The phone root for rows is `.plain-page` itself, not a `.settings-shell` wrapper.
 *
 * Two header shapes:
 *  - brand (`brand: true`): the "Harbour" brand h1 links home, the title is the one `<h2 class="plain-title">`
 *    and sections are h3. Legal, Account home, Templates, Email and the auth pages use it.
 *  - workspace (the default): the page-header h1 is the title and `lede` its subtitle; sections are h2.
 *
 * Section kinds (`sections`, each `{ kind, title, … }`). The kind list is the contract: an unknown
 * kind throws.
 *  - `html`    `body` is trusted markup.
 *  - `fields`  `fields: [{ label, value }]`, one `renderField` row each (values are escaped text).
 *  - `rows`    `rowsHtml` is trusted row markup from the settings-row builders, with an optional `note`
 *              and `testid` (on the section). It is a Plain section like the others: its heading takes
 *              the page's heading tag, not `group()`'s h2 (LIN-3956). The rows list is the one Settings
 *              uses (`rowsList`), and the document entry links settings.css when a rows section exists.
 *  - `form`    `action`, `method` (default POST), `fields: [{ name, label, value, placeholder, maxlength }]`
 *              and `submitLabel`. Each field is a `renderField` row with a text input (`plainFormHtml`).
 *              The submit is a primary `renderButton`.
 *  - `empty`   `text`, rendered by `renderEmptyState`.
 *
 * The canonical look lives in `public/style.css` (`.plain-title`, `.plain-page .section`). Every
 * selector is namespaced `.plain-*` or `.plain-page …`, so a `git grep` for the old Legal class stays
 * meaningful. The `<main>` is capped at the 40em measure and centred (`.plain-page.plain-column`), so
 * the column sits under the centred header (LIN-3956, open question 6). `/styleguide` builds its own
 * `<main>` and never gets the class.
 *
 * @param {Object} opts
 * @param {string} opts.title - The page title (escaped).
 * @param {string} [opts.lede] - Workspace shape: the header subtitle. Brand shape: a subtitle under the title.
 * @param {boolean} [opts.brand=false] - Brand header shape (see above).
 * @param {Array<Object>} [opts.sections=[]] - Typed sections (see above).
 * @param {string} [opts.className] - Extra class(es) on the `<main>`.
 * @param {string} [opts.attrs] - Extra raw attributes on the `<main>` (already escaped).
 * @returns {string} The header and `<main>` HTML.
 */
import { escapeHtml } from '../utils/html.js';
import { renderPage } from './page.js';
import { renderSection } from './section.js';
import { renderPageHeader } from './page-header.js';
import { renderField } from './field.js';
import { renderButton } from './button.js';
import { renderEmptyState } from './empty-state.js';
import { rowsList } from './settings-group.js';

/**
 * A text-input form: one `renderField` row per field, then a primary submit. The input is the canonical
 * text control (`token-label-input`, decision 15), named by its label (`aria-label`), with the placeholder
 * and maxlength passed through. `className` replaces the form's hook class (`plain-form` by default).
 */
export function plainFormHtml({ action, method = 'POST', fields = [], submitLabel, className = 'plain-form' }) {
  const rows = fields.map((f) => renderField({
    label: f.label,
    valueHtml: `<input name="${escapeHtml(f.name)}" type="text" class="token-label-input" aria-label="${escapeHtml(f.label)}" value="${escapeHtml(f.value ?? '')}"${f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : ''}${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}>`,
  })).join('');
  const submit = renderButton({ label: submitLabel, variant: 'primary', type: 'submit' });
  return `<form action="${escapeHtml(action)}" method="${escapeHtml(method)}" class="${escapeHtml(className)}">${rows}\n      ${submit}\n    </form>`;
}

const SECTION_KINDS = {
  html: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: s.body }),
  fields: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: s.fields.map((f) => renderField(f)).join('') }),
  rows: (s, tag) => renderSection({
    titleTag: tag,
    title: s.title,
    body: rowsList({ rowsHtml: s.rowsHtml, note: s.note }),
    attrs: s.testid ? `data-testid="${escapeHtml(s.testid)}"` : undefined,
  }),
  form: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: plainFormHtml(s) }),
  empty: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: renderEmptyState({ text: s.text }) }),
};

/** The typed sections alone (no header, no `<main>`), for a page that sets its own frame. */
export function renderPlainSections(sections = [], tag = 'h2') {
  return sections.map((s) => {
    const render = SECTION_KINDS[s.kind];
    if (!render) throw new Error(`renderPlainPage: unknown section kind "${s.kind}"`);
    return render(s, tag);
  }).join('\n\n    ');
}

export function renderPlainPage({ title, lede, brand = false, sections = [], className, attrs } = {}) {
  const sectionsHtml = renderPlainSections(sections, brand ? 'h3' : 'h2');

  const header = brand
    ? renderPageHeader({ title: 'Harbour', titleHref: '/' })
    : renderPageHeader({ title, subtitle: lede });
  const titleHtml = brand
    ? `<h2 class="plain-title">${escapeHtml(title)}</h2>${lede ? `\n    <p class="page-header__subtitle">${escapeHtml(lede)}</p>` : ''}\n\n    `
    : '';
  const classes = ['plain-page', 'plain-column', className].filter(Boolean).join(' ');
  const attrStr = attrs ? ` ${attrs}` : '';

  return `${header}
  <main class="${classes}"${attrStr}>
    ${titleHtml}${sectionsHtml}
  </main>`;
}

/**
 * The document entry for a Plain page (LIN-3956). `plain` is the `renderPlainPage` options; `title` is the
 * document `<title>`. It links `/settings.css` after the page stylesheets exactly when a `rows` section is
 * present, so a caller cannot forget it. `after` is trusted markup placed after the `<main>` (a footer).
 *
 * @param {Object} opts
 * @param {string} opts.title - The document title.
 * @param {Object} opts.plain - The `renderPlainPage` options.
 * @param {string[]} [opts.stylesheets=['/style.css']] - Page stylesheets; settings.css follows them.
 * @param {string} [opts.bodyClass] - The body class.
 * @param {string} [opts.after=''] - Trusted markup after the `<main>`.
 * @returns {string} Full HTML document.
 */
export function renderPlainDocument({ title, plain, stylesheets = ['/style.css'], bodyClass, after = '' }) {
  const hasRows = (plain.sections || []).some((s) => s.kind === 'rows');
  return renderPage({
    title,
    stylesheets: [...stylesheets, ...(hasRows ? ['/settings.css'] : [])],
    bodyClass,
    content: renderPlainPage(plain) + after,
  });
}
