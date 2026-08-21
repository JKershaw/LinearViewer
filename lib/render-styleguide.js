/**
 * Style-guide page renderer (LIN-457, Phase 0C).
 *
 * A public, static design-reference page that exercises every design token
 * shipped in `:root` (public/style.css) plus the core CLI/terminal primitives
 * (state glyphs, box-drawing). It is the comprehensive visual-regression target
 * for the next phase, so it MUST stay deterministic: no live data, no
 * per-request variation, and no deploy info in the footer.
 *
 * Follows the public legal-page pattern (lib/render-legal.js): a full document
 * via the shared `renderPage()` shell, `is-landing` body class, and the shared
 * page footer. Tokens are rendered live via `var(--token)` so the page mirrors
 * the stylesheet rather than re-encoding it; the literal values are shown only
 * as captions for reference.
 */

import { renderPageFooter } from './components/footer.js';
import { renderPage } from './components/page.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderField } from './components/field.js';
import { renderCard } from './components/card.js';
import { renderStatusPill } from './components/status-pill.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderButton } from './components/button.js';
import { renderIconButton } from './components/icon-button.js';
import { renderIcon, ICON_NAMES } from './components/icon.js';
import { renderTag, renderChip } from './components/tag.js';
import { renderAccentBar } from './components/accent-bar.js';
import { renderSegmentBar } from './components/segment-bar.js';
import { renderDisclosure } from './components/disclosure.js';
import { renderSurface } from './components/surface.js';

// Token-reference blocks render through the canonical `section` component
// (LIN-461) — the /styleguide page is its visual-regression lock. The headings
// keep `titleTag: 'h3'` to match the prior structure; the canonical
// `.section .section-header` rule (more specific than `.legal-content h3`) is
// what now styles them, which is the intended, reviewed convergence shift.
const sgSection = (title, body) =>
  renderSection({ titleTag: 'h3', title, body });

// Color tokens shipped in :root. `kind: 'border'` tokens are demoed as a box
// outline rather than a fill so low-contrast hairlines are visible.
const COLOR_TOKENS = [
  { name: '--bg', value: '#ffffff', kind: 'fill' },
  { name: '--bg-muted', value: '#f8f9fa', kind: 'fill' },
  { name: '--bg-alt', value: 'rgba(0, 0, 0, 0.03)', kind: 'fill' },
  { name: '--fg', value: '#1a1a1a', kind: 'fill' },
  { name: '--fg-dim', value: '#666666', kind: 'fill' },
  { name: '--fg-vdim', value: '#eeeeee', kind: 'fill' },
  { name: '--fg-mid', value: '#bbbbbb', kind: 'fill' },
  { name: '--green', value: '#16a34a', kind: 'fill' },
  { name: '--ok', value: '#2a8f4e', kind: 'fill' },
  { name: '--teal', value: '#0d9488', kind: 'fill' },
  { name: '--teal-soft', value: '#0d948820', kind: 'fill' },
  { name: '--yellow', value: '#d4a600', kind: 'fill' },
  { name: '--blue', value: '#2563eb', kind: 'fill' },
  { name: '--purple', value: '#7c3aed', kind: 'fill' },
  { name: '--red', value: '#cc0000', kind: 'fill' },
  { name: '--red-hover', value: '#990000', kind: 'fill' },
  { name: '--accent', value: '#c33', kind: 'fill' },
  { name: '--border', value: '#ddd', kind: 'border' },
  { name: '--border-strong', value: '#ccc', kind: 'border' },
  { name: '--border-subtle', value: 'rgba(0, 0, 0, 0.08)', kind: 'border' }
];

// LIN-785 semantic vocabulary + running-status palette. In light these alias the
// raw tokens above (so they are a visual no-op); S2 primitives consume these names.
const SEMANTIC_TOKENS = [
  { name: '--text', value: 'var(--fg)', kind: 'fill' },
  { name: '--muted', value: 'var(--fg-dim)', kind: 'fill' },
  { name: '--faint', value: 'var(--fg-vdim)', kind: 'fill' },
  { name: '--card', value: 'var(--bg-muted)', kind: 'fill' },
  { name: '--card-h', value: 'var(--bg-alt)', kind: 'fill' },
  { name: '--raised', value: 'var(--bg)', kind: 'fill' },
  { name: '--inset', value: 'var(--bg-alt)', kind: 'fill' },
  { name: '--brand', value: 'var(--teal)', kind: 'fill' },
  { name: '--brand-dim', value: '#0f766e', kind: 'fill' },
  { name: '--green-dim', value: '#15803d', kind: 'fill' },
  { name: '--amber', value: '#FFB224', kind: 'fill' },
  { name: '--amber-dim', value: '#8a5a00', kind: 'fill' },
  { name: '--red-dim', value: '#b91c1c', kind: 'fill' },
  { name: '--slate', value: '#64748b', kind: 'fill' },
  { name: '--slate-dim', value: '#475569', kind: 'fill' },
  { name: '--focus', value: '#0d6efd', kind: 'fill' },
  { name: '--line', value: 'var(--border)', kind: 'border' },
  { name: '--line-soft', value: 'var(--border-subtle)', kind: 'border' }
];

const MOTION_TOKENS = [
  { name: '--motion-fast', value: '120ms' },
  { name: '--motion-base', value: '240ms' },
  { name: '--motion-slow', value: '480ms' },
  { name: '--motion-pulse', value: '1.6s' }
];

const FONT_TOKENS = [
  { name: '--font-structural', sample: 'Structural ├─ └─ 0123' },
  { name: '--font-content', sample: 'Readable content type' },
  { name: '--font-mono', sample: 'Generic monospace 0123' }
];

const FONT_SIZE_TOKENS = [
  { name: '--font-size-sm', value: '0.85em' },
  { name: '--font-size-base', value: '1em' },
  { name: '--font-size-lg', value: '1.25em' }
];

const SPACE_TOKENS = [
  { name: '--space-1', value: '0.25rem' },
  { name: '--space-2', value: '0.5rem' },
  { name: '--space-3', value: '1rem' },
  { name: '--space-4', value: '1.5rem' },
  { name: '--space-5', value: '2rem' }
];

const RADIUS_TOKENS = [
  { name: '--radius-sm', value: '5px' },
  { name: '--radius-md', value: '8px' },
  { name: '--radius-lg', value: '14px' },
  { name: '--radius-full', value: '999px' }
];

const SHADOW_TOKENS = [
  { name: '--shadow-sm', value: '0 1px 2px rgba(0, 0, 0, 0.05)' },
  { name: '--shadow-md', value: '0 2px 8px rgba(0, 0, 0, 0.1)' },
  { name: '--shadow-lg', value: '0 8px 24px rgba(0, 0, 0, 0.12)' },
  { name: '--shadow', value: 'var(--shadow-md)' }  // LIN-785 default elevation alias
];

const Z_TOKENS = [
  { name: '--z-base', value: '1' },
  { name: '--z-sticky', value: '100' },
  { name: '--z-overlay', value: '1000' },
  { name: '--z-modal', value: '2000' }
];

// CLI/terminal state glyphs (public/llms.txt, render.js). Part of the aesthetic
// primitives the baseline must lock in alongside the raw tokens.
const STATE_GLYPHS = [
  { glyph: '✓', token: '--green', label: 'done' },
  { glyph: '◐', token: '--yellow', label: 'in progress' },
  { glyph: '○', token: '--fg-dim', label: 'todo' }
];

function colorSwatch({ name, value, kind }) {
  const chipStyle = kind === 'border'
    ? `border-color: var(${name})`
    : `background: var(${name})`;
  return `<figure class="sg-swatch">
        <div class="sg-chip sg-chip--${kind}" style="${chipStyle}"></div>
        <figcaption><code class="sg-name">${name}</code><span class="sg-value">${value}</span></figcaption>
      </figure>`;
}

// One row per icon in the §10 set, demoed at text size with currentColor.
function iconRow(name) {
  return `<div class="sg-icon-cell">
          ${renderIcon({ name, title: name })}
          <code class="sg-name">${name}</code>
        </div>`;
}

// The full S2 primitive set (LIN-786), rendered token-only so it resolves to
// whichever .theme-* wraps it. Shared by the standalone "Primitives" section and
// each theme panel so every primitive is demoed in BOTH light and dark.
function primitivesDemo() {
  return `<div class="sg-primitive-grid">
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Run-status pill</span>
          <div class="sg-primitive-row">
            ${renderStatusPill({ state: 'running', label: 'running', dot: true })}
            ${renderStatusPill({ state: 'done', label: 'done', dot: true })}
            ${renderStatusPill({ state: 'error', label: 'error', dot: true })}
            ${renderStatusPill({ state: 'queued', label: 'queued', dot: true })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Button</span>
          <div class="sg-primitive-row">
            ${renderButton({ label: 'default' })}
            ${renderButton({ label: 'primary', variant: 'primary' })}
            ${renderButton({ label: 'ghost', variant: 'ghost' })}
            ${renderButton({ label: 'with icon', icon: renderIcon({ name: 'spark' }) })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Icon button</span>
          <div class="sg-primitive-row">
            ${renderIconButton({ icon: renderIcon({ name: 'check' }), label: 'approve' })}
            ${renderIconButton({ icon: renderIcon({ name: 'branch' }), label: 'branch', variant: 'ghost' })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Tag &amp; Chip</span>
          <div class="sg-primitive-row">
            ${renderTag({ label: 'research', count: 3 })}
            ${renderTag({ label: 'brand', tone: 'brand' })}
            ${renderChip({ label: 'LIN-786' })}
            ${renderChip({ label: 'feat/theme-s2' })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Accent bar</span>
          <div class="sg-primitive-stack">
            ${renderAccentBar({ state: 'running', label: 'running' })}
            ${renderAccentBar({ state: 'done', label: 'done' })}
            ${renderAccentBar({ state: 'error', label: 'error' })}
          </div>
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Segment bar</span>
          ${renderSegmentBar({ ariaLabel: 'worker runs: 2 done, 1 running, 1 queued', segments: [
            { state: 'done', title: 'done' },
            { state: 'done', title: 'done' },
            { state: 'running', title: 'running' },
            { state: 'queued', title: 'queued' }
          ] })}
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Disclosure</span>
          ${renderDisclosure({ summary: 'Activity log (3)', body: '<p>Disclosed body content on this theme’s surface.</p>' })}
        </div>
        <div class="sg-primitive-cell">
          <span class="sg-primitive-tag">Surface / InsetPanel</span>
          <div class="sg-primitive-stack">
            ${renderSurface({ body: '<p>Default surface (<code>--card</code>).</p>' })}
            ${renderSurface({ variant: 'inset', body: '<p>Inset panel (<code>--inset</code> well).</p>' })}
          </div>
        </div>
      </div>`;
}

export function renderStyleguide() {
  // No deployInfo: keep the footer (and thus the page) byte-stable for the
  // visual-regression baseline. isLanding hides workspace/AI chrome.
  const footerHtml = renderPageFooter({ isLanding: true, currentPage: '/styleguide' });

  const colorSwatches = COLOR_TOKENS.map(colorSwatch).join('\n        ');
  const semanticSwatches = SEMANTIC_TOKENS.map(colorSwatch).join('\n        ');

  const motionRows = MOTION_TOKENS.map(({ name, value }) =>
    `<div class="sg-font-row">
          <span class="sg-space-bar" style="transition: width var(${name}) ease; width: 4rem"></span>
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  const fontSamples = FONT_TOKENS.map(({ name, sample }) =>
    `<div class="sg-font-row">
          <p class="sg-font-sample" style="font-family: var(${name})">${sample}</p>
          <code class="sg-name">${name}</code>
        </div>`).join('\n        ');

  const fontSizeSamples = FONT_SIZE_TOKENS.map(({ name, value }) =>
    `<div class="sg-font-row">
          <p class="sg-font-sample" style="font-size: var(${name})">The quick brown fox</p>
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  const spaceBars = SPACE_TOKENS.map(({ name, value }) =>
    `<div class="sg-space-row">
          <div class="sg-space-bar" style="width: var(${name})"></div>
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  // Layout clearance token (LIN-984): the pinned shared-header height reserved
  // as `scroll-margin-top` on interactive controls (so they don't scroll under
  // the sticky nav) and as the offset for page-fixed near-top controls. Shown
  // as a length bar alongside the spacing scale, not part of the scale itself.
  const navClearanceBar =
    `<div class="sg-space-row">
          <div class="sg-space-bar" style="width: var(--nav-sticky-h)"></div>
          <code class="sg-name">--nav-sticky-h</code><span class="sg-value">6rem (7.75rem ≤640px) — sticky header clearance</span>
        </div>`;

  const radiusBoxes = RADIUS_TOKENS.map(({ name, value }) =>
    `<figure class="sg-swatch">
        <div class="sg-box" style="border-radius: var(${name})"></div>
        <figcaption><code class="sg-name">${name}</code><span class="sg-value">${value}</span></figcaption>
      </figure>`).join('\n        ');

  const shadowBoxes = SHADOW_TOKENS.map(({ name, value }) =>
    `<figure class="sg-swatch">
        <div class="sg-box" style="box-shadow: var(${name})"></div>
        <figcaption><code class="sg-name">${name}</code><span class="sg-value">${value}</span></figcaption>
      </figure>`).join('\n        ');

  // Exercise z-index tokens by stacking offset boxes; later tokens sit on top.
  const zStack = Z_TOKENS.map(({ name, value }, i) =>
    `<div class="sg-z-card" style="z-index: var(${name}); left: ${i * 2.5}rem; top: ${i * 1.25}rem">
          <code class="sg-name">${name}</code><span class="sg-value">${value}</span>
        </div>`).join('\n        ');

  const glyphs = STATE_GLYPHS.map(({ glyph, token, label }) =>
    `<div class="sg-glyph-row">
          <span class="sg-glyph" style="color: var(${token})">${glyph}</span>
          <span class="sg-glyph-label">${label}</span>
          <code class="sg-name">${token}</code>
        </div>`).join('\n        ');

  // A representative cross-section of leaf + larger components, rendered once
  // per theme so theme impact is visible at-a-glance. Tokens inside resolve to
  // whichever .theme-* class wraps the panel (or :root for the default panel).
  const themePanel = (themeClass, label) => {
    const swatches = ['--bg-muted', '--green', '--yellow', '--blue', '--red']
      .map(t => `<span style="background: var(${t})"></span>`).join('');
    return `<div class="sg-theme-panel ${themeClass}">
        <p class="sg-theme-label">${label}</p>
        <div class="sg-theme-swatches">${swatches}</div>
        <div class="sg-theme-row">
          ${STATE_GLYPHS.map(({ glyph, token, label: l }) =>
            `<span class="sg-glyph" style="color: var(${token})" title="${l}">${glyph}</span>`).join('')}
        </div>
        <div class="sg-theme-row">
          ${renderStatusPill({ state: 'done', label: 'done' })} ${renderStatusPill({ state: 'in-progress', label: 'in progress' })} ${renderStatusPill({ state: 'todo', label: 'todo' })} ${renderStatusPill({ state: 'failed', label: 'failed' })}
        </div>
        ${renderCard({ accent: 'in-progress', title: 'Sample card', meta: 'in progress', body: '<p>A larger component on this theme’s surface.</p>' })}
        <div class="sg-theme-row">
          <button class="action-btn save">save</button>
          <button class="action-btn connect">connect</button>
          <button class="action-btn disconnect">disconnect</button>
        </div>
        ${primitivesDemo()}
      </div>`;
  };

  return renderPage({
    title: 'Style Guide - Harbour',
    stylesheets: ['/style.css', '/common-actions.css', '/styleguide.css'],
    bodyClass: 'is-landing',
    headExtra: '<meta name="robots" content="noindex">',
    content: `${renderPageHeader({ title: 'Harbour', titleHref: '/' })}
  <main class="legal-content styleguide-content">
    <h2>Style Guide</h2>
    <p class="sg-intro">A static reference of every design token shipped in <code>:root</code>, rendered live via <code>var(--token)</code>. This page is the visual-regression baseline; it intentionally carries no live data.</p>

    ${sgSection('Color', `<div class="sg-grid">
        ${colorSwatches}
      </div>`)}

    ${sgSection('Semantic tokens', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The LIN-785 semantic vocabulary (surfaces, text, lines, brand) plus the running-status palette (<code>--amber</code>/<code>--slate</code> + AA-safe <code>-dim</code> text companions). In light these alias the raw tokens, so adding them is a visual no-op; S2 primitives consume these names.</p>
      <div class="sg-grid">
        ${semanticSwatches}
      </div>`)}

    ${sgSection('Motion', `<p class="sg-intro" style="margin-bottom: var(--space-3)">Tokenized durations (LIN-785 §7) for the <code>pulse</code> / <code>shimmer</code> keyframes; neutralized under <code>prefers-reduced-motion</code>.</p>
      <div class="sg-stack">
        ${motionRows}
      </div>`)}

    ${sgSection('Typography — families', `<div class="sg-stack">
        ${fontSamples}
      </div>`)}

    ${sgSection('Typography — scale', `<div class="sg-stack">
        ${fontSizeSamples}
      </div>`)}

    ${sgSection('Spacing', `<div class="sg-stack">
        ${spaceBars}
        ${navClearanceBar}
      </div>`)}

    ${sgSection('Border radius', `<div class="sg-grid">
        ${radiusBoxes}
      </div>`)}

    ${sgSection('Elevation', `<div class="sg-grid">
        ${shadowBoxes}
      </div>`)}

    ${sgSection('Z-index', `<div class="sg-z-stack">
        ${zStack}
      </div>`)}

    ${sgSection('State glyphs', `<div class="sg-stack">
        ${glyphs}
      </div>
      <pre class="sg-tree">├─ parent task
│  ├─ subtask
│  └─ subtask
└─ sibling</pre>`)}

    ${sgSection('Section component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>section</code> server component (LIN-461). Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderSection({ boxed: true, title: 'Boxed section', body: `<p>The <code>--boxed</code> variant (dispatch / proxy / settings): <code>--space-3</code> padding, <code>--bg-alt</code> fill, <code>--radius-sm</code> corners.</p>` })}
      ${renderSection({ titleVariant: 'ruled', title: 'Ruled header', body: `<p>The <code>--ruled</code> heading modifier (prompts catalog): an underlined section title.</p>` })}`)}

    ${sgSection('Page header component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>pageHeader</code> server component (LIN-462): the page-level <code>&lt;h1&gt;</code> + optional tagline. Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderPageHeader({ title: 'Title only' })}
      ${renderPageHeader({ title: 'Title with subtitle', subtitle: 'The tagline rides under the heading via .page-header__subtitle.' })}`)}

    ${sgSection('Field component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>field</code> server component (LIN-463): a horizontal dim-label + value row (dispatch / proxy / settings). The value slot holds text, a status span, or a control. Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderField({ label: 'value:', value: 'plain text value' })}
      ${renderField({ label: 'repo:', valueHtml: '<code>JKershaw/LinearViewer</code>' })}
      ${renderField({ label: 'scope:', valueHtml: '<select><option>read-only</option><option>read-write</option></select>' })}`)}

    ${sgSection('Card component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>card</code> server component (LIN-468): a slot-based content card (<code>accent</code>, <code>title</code>, <code>meta</code>, <code>labels</code>, <code>body</code>). Variants below are the visual-regression lock for every page migrated onto it.</p>
      ${renderCard({ title: 'Plain card', meta: '128 chars', body: '<p>A <code>title</code> + <code>meta</code> + <code>body</code> card: token hairline, <code>--bg-alt</code> fill, <code>--radius-sm</code> corners.</p>' })}
      ${renderCard({ accent: 'in-progress', title: 'Accented card', meta: 'in progress', body: '<p>The <code>accent</code> slot adds a state-colored left border (<code>in-progress | done | todo | backlog | failed</code>).</p>' })}
      ${renderCard({ accent: 'done', title: 'Labelled card', labels: '<span>research</span><span>plan</span>', body: '<p>The <code>labels</code> slot holds the chip row; chip styling itself is owned by a later task.</p>' })}`)}

    ${sgSection('Status pill component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>statusPill</code> server component (LIN-465): a state→glyph+label chip sharing <code>card</code>'s state vocabulary (<code>in-progress | done | todo | backlog | failed</code>) and Phase-0 color tokens. The client-rendered pills (foreman/ship/swipe) converge on this class in Phase B. Variants below are the visual-regression lock.</p>
      <div class="sg-stack">
        <div>${renderStatusPill({ state: 'done', label: 'done' })} ${renderStatusPill({ state: 'in-progress', label: 'in progress' })} ${renderStatusPill({ state: 'todo', label: 'todo' })} ${renderStatusPill({ state: 'backlog', label: 'backlog' })} ${renderStatusPill({ state: 'failed', label: 'failed' })}</div>
        <div>${renderStatusPill({ state: 'done' })} ${renderStatusPill({ state: 'in-progress' })} ${renderStatusPill({ state: 'todo' })} ${renderStatusPill({ char: '◐', label: 'glyph override' })} ${renderStatusPill({ variant: 'tag', label: 'neutral tag' })}</div>
        <div>${renderStatusPill({ state: 'done', char: '✓', variant: 'bare' })} ${renderStatusPill({ state: 'in-progress', char: '◐', variant: 'bare' })} ${renderStatusPill({ state: 'todo', char: '○', variant: 'bare' })} ${renderStatusPill({ state: 'backlog', char: '◌', variant: 'bare' })} <code>bare</code> variant — box-less inline glyphs for the LIN-782-locked project tree (LIN-850)</div>
      </div>`)}

    ${sgSection('Empty state component', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The canonical <code>emptyState</code> server component (LIN-466): the "nothing here yet" placeholder. The five per-page looks (custom-prompts, roadmap, foreman, swipe, pipeline) genuinely diverge, so the canonical <code>.emptyState</code> class carries only the shared dim foreground and composes with each retained per-page variant class. Convergence onto one look is Phase B; the base look below is the visual-regression lock.</p>
      <div class="sg-stack">
        ${renderEmptyState({ text: 'No items yet. Create one to get started.' })}
        ${renderEmptyState({ tag: 'p', text: '○ queue empty' })}
      </div>`)}

    ${sgSection('Buttons & inputs', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The shared action-button + token-input leaf components (<code>public/common-actions.css</code>), used across dispatch / proxy / settings. Variants below carry the live styles, not a re-encoding.</p>
      <div class="sg-controls">
        <button class="action-btn save">save</button>
        <button class="action-btn connect">connect</button>
        <button class="action-btn disconnect">disconnect</button>
        <button class="action-btn logout">logout</button>
        <input class="token-label-input" type="text" placeholder="token label…" aria-label="token label">
      </div>`)}

    ${sgSection('Primitives', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The Theme S2 primitive set (LIN-786 §9): the theme-owned, page-agnostic building blocks LIN-783 composes. Every primitive reads the semantic token layer only — no page logic, no raw colour. Interactive members inherit the global <code>:focus-visible</code> ring; primary <code>Button</code> and <code>IconButton</code> meet the 40px touch-target floor; run-status and segment cells expose state via label/<code>title</code>, never colour alone. Each is shown again in both themes under <em>Themes</em> below.</p>
      ${primitivesDemo()}`)}

    ${sgSection('Iconography', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The minimal line-icon set (LIN-786 §10): inline <code>&lt;svg&gt;</code> stroked in <code>currentColor</code>, so each icon inherits its text colour and themes for free. Sizing is owned by <code>.icon</code> (1em square).</p>
      <div class="sg-icon-grid">
        ${ICON_NAMES.map(iconRow).join('\n        ')}
      </div>`)}

    ${sgSection('Themes', `<p class="sg-intro" style="margin-bottom: var(--space-3)">The same components rendered under each theme so the impact of different themes is visible at-a-glance. A theme is a pure override of the color tokens via the <code>.theme-*</code> hook (<code>public/style.css</code>); the structural tokens stay shared and the default (light) is <code>:root</code>, so every existing page renders unchanged.</p>
      <div class="sg-theme-grid">
        ${themePanel('', 'light (default — :root)')}
        ${themePanel('theme-dark', 'dark (.theme-dark)')}
      </div>`)}
  </main>
  ${footerHtml}`
  });
}
