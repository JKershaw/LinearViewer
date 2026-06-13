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

// Color tokens shipped in :root. `kind: 'border'` tokens are demoed as a box
// outline rather than a fill so low-contrast hairlines are visible.
const COLOR_TOKENS = [
  { name: '--bg', value: '#ffffff', kind: 'fill' },
  { name: '--bg-muted', value: '#f8f9fa', kind: 'fill' },
  { name: '--bg-alt', value: 'rgba(0, 0, 0, 0.03)', kind: 'fill' },
  { name: '--fg', value: '#1a1a1a', kind: 'fill' },
  { name: '--fg-dim', value: '#666666', kind: 'fill' },
  { name: '--fg-vdim', value: '#eeeeee', kind: 'fill' },
  { name: '--green', value: '#16a085', kind: 'fill' },
  { name: '--ok', value: '#2a8f4e', kind: 'fill' },
  { name: '--yellow', value: '#d4a600', kind: 'fill' },
  { name: '--blue', value: '#2563eb', kind: 'fill' },
  { name: '--purple', value: '#7c3aed', kind: 'fill' },
  { name: '--red', value: '#cc0000', kind: 'fill' },
  { name: '--red-hover', value: '#990000', kind: 'fill' },
  { name: '--accent', value: '#c33', kind: 'fill' },
  { name: '--border', value: '#ddd', kind: 'border' },
  { name: '--border-subtle', value: 'rgba(0, 0, 0, 0.08)', kind: 'border' }
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
  { name: '--radius-sm', value: '3px' },
  { name: '--radius-md', value: '6px' },
  { name: '--radius-lg', value: '12px' }
];

const SHADOW_TOKENS = [
  { name: '--shadow-sm', value: '0 1px 2px rgba(0, 0, 0, 0.05)' },
  { name: '--shadow-md', value: '0 2px 8px rgba(0, 0, 0, 0.1)' },
  { name: '--shadow-lg', value: '0 8px 24px rgba(0, 0, 0, 0.12)' }
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

export function renderStyleguide() {
  // No deployInfo: keep the footer (and thus the page) byte-stable for the
  // visual-regression baseline. isLanding hides workspace/AI chrome.
  const footerHtml = renderPageFooter({ isLanding: true, currentPage: '/styleguide' });

  const colorSwatches = COLOR_TOKENS.map(colorSwatch).join('\n        ');

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

  return renderPage({
    title: 'Style Guide - Linear Projects Viewer',
    stylesheets: ['/style.css', '/styleguide.css'],
    bodyClass: 'is-landing',
    headExtra: '<meta name="robots" content="noindex">',
    content: `<header>
    <h1><a href="/" class="header-link">Linear Projects Viewer</a></h1>
  </header>
  <main class="legal-content styleguide-content">
    <h2>Style Guide</h2>
    <p class="sg-intro">A static reference of every design token shipped in <code>:root</code>, rendered live via <code>var(--token)</code>. This page is the visual-regression baseline; it intentionally carries no live data.</p>

    <section class="legal-section">
      <h3>Color</h3>
      <div class="sg-grid">
        ${colorSwatches}
      </div>
    </section>

    <section class="legal-section">
      <h3>Typography — families</h3>
      <div class="sg-stack">
        ${fontSamples}
      </div>
    </section>

    <section class="legal-section">
      <h3>Typography — scale</h3>
      <div class="sg-stack">
        ${fontSizeSamples}
      </div>
    </section>

    <section class="legal-section">
      <h3>Spacing</h3>
      <div class="sg-stack">
        ${spaceBars}
      </div>
    </section>

    <section class="legal-section">
      <h3>Border radius</h3>
      <div class="sg-grid">
        ${radiusBoxes}
      </div>
    </section>

    <section class="legal-section">
      <h3>Elevation</h3>
      <div class="sg-grid">
        ${shadowBoxes}
      </div>
    </section>

    <section class="legal-section">
      <h3>Z-index</h3>
      <div class="sg-z-stack">
        ${zStack}
      </div>
    </section>

    <section class="legal-section">
      <h3>State glyphs</h3>
      <div class="sg-stack">
        ${glyphs}
      </div>
      <pre class="sg-tree">├─ parent task
│  ├─ subtask
│  └─ subtask
└─ sibling</pre>
    </section>
  </main>
  ${footerHtml}`
  });
}
