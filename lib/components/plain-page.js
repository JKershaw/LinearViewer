/**
 * Plain page layout (LIN-3950, the first shared move of the UI sweep, LIN-3892).
 *
 * The typed sections the Plain pages share: a section, rows, notes, a form and an empty state. A pure
 * `renderPlainSections() → HTML string` helper over the existing builders, in the same idiom as `renderSection`.
 *
 * LIN-4567 (LIN-4342 piece 6): the Plain pages (Privacy, Terms, Account home) sit in the public frame
 * (`renderPublicFrame`, lib/components/frame.js), which owns the page's one h1, its way back, its footer and its tab
 * title. So the document entries that drew a "Harbour" brand h1 over a `plain-title` h2 (`renderPlainPage`,
 * `renderPlainDocument`) are gone: a page passes `<div class="plain-page plain-column">` with these sections as the
 * frame's content, its sections at h2 under the frame's h1, and links `/settings.css` itself when it has a `rows`
 * section (Account home does).
 *
 * Section kinds (`sections`, each `{ kind, title, … }`). The kind list is the contract: an unknown
 * kind throws.
 *  - `html`    `body` is trusted markup.
 *  - `fields`  `fields: [{ label, value }]`, one `renderField` row each (values are escaped text).
 *  - `rows`    `rowsHtml` is trusted row markup from the settings-row builders, with an optional `note`
 *              and `testid` (on the section). Its heading takes the page's heading tag, not `group()`'s h2
 *              (LIN-3956). The rows list is the one Settings uses (`rowsList`); the page links settings.css.
 *  - `form`    `action`, `method` (default POST), `fields: [{ name, label, value, placeholder, maxlength }]`
 *              and `submitLabel`. Each field is a `renderField` row with a text input (`plainFormHtml`).
 *              The submit is a primary `renderButton`.
 *  - `empty`   `text`, rendered by `renderEmptyState`.
 *
 * The canonical look lives in `public/style.css` (`.plain-page .section`, `.plain-page.plain-column`). Every selector is
 * namespaced `.plain-*` or `.plain-page …`. `/styleguide` shows the sections in its own sample.
 */
import { escapeHtml } from '../utils/html.js';
import { renderSection } from './section.js';
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
    if (!render) throw new Error(`renderPlainSections: unknown section kind "${s.kind}"`);
    return render(s, tag);
  }).join('\n\n    ');
}

/**
 * The Plain column: the sections in `<div class="plain-page plain-column">`, the content a Plain page hands the public
 * frame (LIN-4567). Its sections are h2 under the frame's h1. `attrs` is raw (already escaped) attributes on the div.
 * @param {{sections?: Array<Object>, attrs?: string}} opts
 * @returns {string}
 */
export function renderPlainColumn({ sections = [], attrs } = {}) {
  return `<div class="plain-page plain-column"${attrs ? ` ${attrs}` : ''}>
    ${renderPlainSections(sections, 'h2')}
  </div>`;
}
