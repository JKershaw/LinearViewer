/**
 * Plain page layout (LIN-3950, the first shared move of the UI sweep, LIN-3892).
 *
 * The one standard layout the Plain pages share: a page title and lede, sections, rows, notes, a form
 * and an empty state. A pure `renderPlainPage() → HTML string` helper over the existing builders, in
 * the same idiom as `renderSection` and `renderPageHeader`. It returns the header and
 * `<main class="plain-page">`; the page passes that as `content` to `renderPage`, as Settings passes
 * `renderSettingsShell`. The footer is the page's own.
 *
 * Two header shapes:
 *  - brand (`brand: true`): the "Harbour" brand h1 links home, the title is the one `<h2 class="plain-title">`
 *    and sections are h3. Legal, Templates, Account home, Email and the auth pages use it.
 *  - workspace (the default): the page-header h1 is the title and `lede` its subtitle; sections are h2.
 *
 * Section kinds (`sections`, each `{ kind, title, … }`). The kind list is the contract: an unknown
 * kind throws.
 *  - `html`    `body` is trusted markup.
 *  - `fields`  `fields: [{ label, value }]`, one `renderField` row each (values are escaped text).
 *  - `rows`    `rowsHtml` is trusted row markup from the settings-row builders, with an optional `note`.
 *              It goes through `group()`, which titles the group with an h2 (the builder's own heading),
 *              so a brand page should not use it. Rows are styled by public/settings.css and sized by the
 *              `.settings-shell` phone root, so a page that uses this kind must link settings.css and sit
 *              inside that root. Legal uses none of it; the next Plain move (rows and forms) proves it.
 *  - `form`    `action`, `method` (default POST), `fields: [{ name, label, value }]` and `submitLabel`.
 *              Each field is a `renderField` row with an input. The submit is a primary `renderButton`.
 *  - `empty`   `text`, rendered by `renderEmptyState`.
 *
 * The canonical look lives in `public/style.css` (`.plain-title`, `.plain-page .section`). Every
 * selector is namespaced `.plain-*` or `.plain-page …`, so a `git grep` for the old Legal class stays
 * meaningful.
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
import { renderSection } from './section.js';
import { renderPageHeader } from './page-header.js';
import { renderField } from './field.js';
import { renderButton } from './button.js';
import { renderEmptyState } from './empty-state.js';
import { group } from './settings-group.js';

const SECTION_KINDS = {
  html: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: s.body }),
  fields: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: s.fields.map((f) => renderField(f)).join('') }),
  rows: (s) => group({ title: s.title, rowsHtml: s.rowsHtml, note: s.note }),
  form: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: formHtml(s) }),
  empty: (s, tag) => renderSection({ titleTag: tag, title: s.title, body: renderEmptyState({ text: s.text }) }),
};

function formHtml({ action, method = 'POST', fields = [], submitLabel }) {
  const rows = fields.map((f) => renderField({
    label: f.label,
    valueHtml: `<input name="${escapeHtml(f.name)}" value="${escapeHtml(f.value ?? '')}">`,
  })).join('');
  const submit = renderButton({ label: submitLabel, variant: 'primary', type: 'submit' });
  return `<form action="${escapeHtml(action)}" method="${escapeHtml(method)}" class="plain-form">${rows}\n      ${submit}\n    </form>`;
}

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
  const classes = ['plain-page', className].filter(Boolean).join(' ');
  const attrStr = attrs ? ` ${attrs}` : '';

  return `${header}
  <main class="${classes}"${attrStr}>
    ${titleHtml}${sectionsHtml}
  </main>`;
}
