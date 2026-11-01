/**
 * Getting started, through your agent.
 *
 * Software usually starts with an install command. Harbour starts with a
 * prompt: the homepage hands a visitor a few sentences to paste into the
 * coding agent they already use, and those sentences send the agent to
 * `/getting-started`, a guide written for the agent rather than the person.
 * The agent reads the guide, looks at what it can see (the repositories it is
 * running in, the tools it has), asks the person the rest, and walks them
 * through setting Harbour up. The person's first use of Harbour is through
 * their agent, which is how they will use it from then on.
 *
 * This module is the pure half:
 *   - `buildAgentPrompt({ origin })`: the homepage prompt, pointing at this
 *     server's own guide (a self-host's prompt points at the self-host);
 *   - `buildGettingStartedGuide({ baseUrl })`: the guide's Markdown, read from
 *     `content/getting-started.md` once per process, `{{BASE_URL}}` filled per
 *     call. A failed read serves a short FALLBACK, uncached, so a later call
 *     retries (the runner prompt's rule, lib/prompts/runner-kickoff.js);
 *   - `renderGuideHtml(markdown)`: the guide as safe HTML for the page;
 *   - `prefersMarkdown(req)`: which form `/getting-started` answers with.
 *
 * The routes are routes/getting-started.js; the page shell is
 * lib/render-getting-started.js.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Marked, Renderer } from 'marked';
import { escapeHtml } from './utils/html.js';
import { githubSlug } from './library.js';

/** The guide's path on every server. */
export const GETTING_STARTED_PATH = '/getting-started';

/** The guide's plain-Markdown form. */
export const GETTING_STARTED_MARKDOWN_PATH = '/getting-started.md';

/** The origin a prompt names when the request has none (the logout render). */
export const DEFAULT_ORIGIN = 'https://harbour.cat';

/** The guide's source, a Markdown file with `{{BASE_URL}}` placeholders. */
export const GUIDE_SOURCE_PATH = fileURLToPath(new URL('../content/getting-started.md', import.meta.url));

const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

function trimOrigin(origin) {
  const value = typeof origin === 'string' && origin.trim() !== '' ? origin.trim() : DEFAULT_ORIGIN;
  return value.replace(/\/+$/, '');
}

/**
 * The prompt the homepage hands a visitor to paste into their agent. Two short
 * paragraphs: what Harbour is and where the guide lives, then how to work with
 * the person. It asks the agent to read the guide whole (a summarising fetch
 * tool would drop most of it) and to ask before it creates or changes
 * anything, so pasting it is safe.
 *
 * @param {{origin?: string|null}} [opts]
 * @returns {string}
 */
export function buildAgentPrompt({ origin } = {}) {
  const base = trimOrigin(origin);
  const guideUrl = `${base}${GETTING_STARTED_PATH}`;
  return [
    `I'd like to set up Harbour (${base}). It reads my backlog, writes a prompt for the next task that is checked against the code as it is now, sends that prompt to a coding agent, and counts the work done only when there is real proof such as CI results and merged pull requests.`,
    '',
    `Please read the setup guide at ${guideUrl}. It is written for you, so read all of it as plain text (for example \`curl -s ${guideUrl}\`), not a summary. Then help me set Harbour up for my situation: look at the repositories and tools you can see from here, ask me about anything you can't work out yourself, and tell me which steps I need to do in my browser. Ask me before you create, change or send anything.`,
  ].join('\n');
}

/** Minimal guide if the source can't be read or filled. Never cached. */
function fallbackGuide(baseUrl) {
  return `# Getting started with Harbour

The full guide could not be loaded just now. Try again in a minute, or read
${baseUrl}/llms.txt for how the site is laid out.
`;
}

/**
 * A guide builder over one source file, with its own cache. Exported for
 * tests; production uses `buildGettingStartedGuide` below.
 *
 * @param {{sourcePath?: string}} [opts]
 * @returns {(params?: {baseUrl?: string}) => string}
 */
export function createGuideBuilder({ sourcePath = GUIDE_SOURCE_PATH } = {}) {
  let cached = null;

  function load() {
    const raw = readFileSync(sourcePath, 'utf-8');
    const unknown = [...raw.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((name) => name !== 'BASE_URL');
    if (unknown.length) throw new Error(`unknown placeholder(s) in ${sourcePath}: ${[...new Set(unknown)].join(', ')}`);
    return raw;
  }

  return function build({ baseUrl } = {}) {
    const base = trimOrigin(baseUrl);
    if (cached === null) {
      try {
        cached = load();
      } catch (err) {
        console.error('Failed to load the getting-started guide:', err.message);
        return fallbackGuide(base);
      }
    }
    return cached.replace(PLACEHOLDER, () => base);
  };
}

/** The guide's Markdown for this server's base URL. */
export const buildGettingStartedGuide = createGuideBuilder();

// ── Safe HTML ────────────────────────────────────────────────────────────────
// marked does not sanitise, so this renderer does, the way lib/library.js
// does for the Library: raw HTML is escaped to text, a link keeps its href only
// for http(s), mailto, a same-page anchor or a root-relative path, images are
// reduced to their alt text, and headings get GitHub-style ids so in-page
// anchors resolve. The route's CSP is the backstop.

let activeSlugs = null;

function slugFor(text) {
  const base = githubSlug(text) || 'section';
  let candidate = base;
  let n = 0;
  while (activeSlugs.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  activeSlugs.add(candidate);
  return candidate;
}

/** The href a guide link may keep, or null to render the link as plain text. */
export function safeGuideHref(href) {
  if (typeof href !== 'string' || href === '') return null;
  if (href.startsWith('#')) return href;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  if (/^(https?:\/\/|mailto:)/i.test(href)) return href;
  return null;
}

const guideMarked = new Marked({ gfm: true });
guideMarked.use({
  renderer: {
    heading(token) {
      const inline = this.parser.parseInline(token.tokens);
      const id = slugFor(token.text.replace(/[`*_]/g, ''));
      return `<h${token.depth} id="${escapeHtml(id)}">${inline}</h${token.depth}>\n`;
    },
    html(token) {
      return escapeHtml(token.text);
    },
    table(token) {
      const inner = Renderer.prototype.table.call(this, token);
      return `<div class="library-doc__table-wrap" role="region" tabindex="0" aria-label="Table">${inner}</div>\n`;
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeGuideHref(token.href);
      if (href == null) return text;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${escapeHtml(href)}"${title}>${text}</a>`;
    },
    image(token) {
      return escapeHtml(token.text || '');
    },
  },
});

/**
 * The guide's Markdown as safe HTML.
 * @param {string} markdown
 * @returns {string}
 */
export function renderGuideHtml(markdown) {
  activeSlugs = new Set();
  try {
    return guideMarked.parse(String(markdown ?? ''));
  } finally {
    activeSlugs = null;
  }
}

/**
 * Whether `/getting-started` should answer with Markdown. A browser asks for
 * `text/html` by name and gets the page; an agent's `curl` (`Accept: *\/*` or
 * none), or a fetcher that asks for Markdown or plain text first, gets the
 * Markdown it can read whole.
 *
 * @param {{accepts: (types: string[]) => (string|false)}} req - an Express request
 * @returns {boolean}
 */
export function prefersMarkdown(req) {
  const best = req.accepts(['text/markdown', 'text/plain', 'text/html']);
  return best === 'text/markdown' || best === 'text/plain';
}
