/**
 * Harbour Library catalog and safe markdown renderer (LIN-3344, Part A of
 * LIN-3342).
 *
 * The catalog is built once per process from the repository's `docs/` tree and
 * memoised (`loadLibrary(root)`). One entry per document: every markdown file
 * in `docs/papers/harbour/` (papers, at `/library/<slug>`) plus the 14 listed
 * documents from elsewhere in `docs/` (at `/library/doc/<slug>`). Nothing is
 * generated on disk and no build step runs; a new paper appears on the next
 * deploy.
 *
 * Safety is the renderer's job. marked does not sanitise, so this module owns:
 * raw HTML escaped to text, an href scheme allow-list (`http`/`https`/`mailto`,
 * relative, `#`), GitHub-style heading ids so in-page anchors resolve, and link
 * and image rewriting (Library links stay in the Library, other repo files go
 * to GitHub, images to `/library/figures/…`). A CSP on the route is the backstop
 * for anything the renderer fails to neutralise.
 *
 * The docs root is injectable so tests can render a hostile fixture without
 * touching the real tree.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { escapeHtml } from './utils/html.js';
import { LISTED_DOCS, PAPER_METADATA_OVERRIDES, START_HERE } from './library-metadata.js';

/** The default docs root: `<repo>/docs`, resolved from this module's location. */
export const DEFAULT_DOCS_ROOT = fileURLToPath(new URL('../docs', import.meta.url));

/** Every non-Library repository link is rewritten to this blob base. */
export const GITHUB_BASE = 'https://github.com/JKershaw/LinearViewer/blob/main/';

/**
 * The tree (folder) base for the document page's "view source" link, which
 * points at the document's directory rather than the file (LIN-3350). Kept
 * separate from `GITHUB_BASE`: that constant is pinned by in-document link
 * rewriting and its own test.
 */
export const GITHUB_TREE_BASE = 'https://github.com/JKershaw/LinearViewer/tree/main/';

const cache = new Map();

/** One marked instance; renderer methods read the per-parse `activeRender`. */
const marked = new Marked({ gfm: true });
let activeRender = null;

/**
 * GitHub-compatible heading slug (github-slugger's observable behaviour):
 * lower-case, strip punctuation/symbols, spaces to hyphens.
 * @param {string} text
 * @returns {string}
 */
export function githubSlug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * A fresh per-document slugger that de-duplicates collisions like GitHub
 * (`x`, `x-1`, `x-2`).
 */
function createSlugger() {
  const seen = new Map();
  return {
    slug(text) {
      const base = githubSlug(text) || 'section';
      if (!seen.has(base)) {
        seen.set(base, 0);
        return base;
      }
      let n = seen.get(base) + 1;
      let candidate = `${base}-${n}`;
      while (seen.has(candidate)) {
        n += 1;
        candidate = `${base}-${n}`;
      }
      seen.set(base, n);
      seen.set(candidate, 0);
      return candidate;
    },
  };
}

marked.use({
  renderer: {
    heading(token) {
      const inline = this.parser.parseInline(token.tokens);
      const id = activeRender.slugger.slug(stripMarkdown(token.text));
      activeRender.headings.push(id);
      const testid = token.depth === 1 && activeRender.bodyH1Pending
        ? ' data-testid="library-doc-title"'
        : '';
      if (testid) activeRender.bodyH1Pending = false;
      return `<h${token.depth} id="${escapeHtml(id)}"${testid}>${inline}</h${token.depth}>\n`;
    },
    html(token) {
      return escapeHtml(token.text);
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const href = resolveLinkHref(token.href, activeRender);
      if (href == null) return text;
      if (href.startsWith('/library/')) {
        activeRender.linkSlugs.add(href.slice('/library/'.length));
      }
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<a href="${escapeHtml(href)}"${title}>${text}</a>`;
    },
    image(token) {
      const alt = escapeHtml(token.text || '');
      const src = resolveImageSrc(token.href, activeRender);
      if (src == null) return alt;
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img src="${escapeHtml(src)}" alt="${alt}"${title}>`;
    },
  },
});

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Strip tags and decode the entities `escapeHtml` produces (search/slug text). */
export function htmlToText(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reduce a single-line markdown fragment to plain text (summary/snippet). */
function stripMarkdown(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncate at a word boundary with an ellipsis. */
function truncate(text, max) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

function countWords(body) {
  return (body.match(/\S+/g) || []).length;
}

/** Parse single-line `key: value` / `key: [a, b]` front matter; body follows. */
export function parseFrontMatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { frontMatter: {}, body: text };
  }
  const lines = text.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) { end = i; break; }
  }
  if (end === -1) return { frontMatter: {}, body: text };
  const frontMatter = {};
  for (let i = 1; i < end; i++) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean);
    } else {
      value = unquote(value);
    }
    frontMatter[key] = value;
  }
  return { frontMatter, body: lines.slice(end + 1).join('\n') };
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeAuthor(frontMatter) {
  if (Array.isArray(frontMatter.authors)) return frontMatter.authors.join(', ');
  if (typeof frontMatter.authors === 'string' && frontMatter.authors) return frontMatter.authors;
  if (typeof frontMatter.author === 'string' && frontMatter.author) return frontMatter.author;
  return null;
}

/** The first H1 in the body, or null. */
function firstH1(body) {
  const lines = body.split('\n');
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const match = /^#\s+(.+)$/.exec(lines[i]);
    if (match) return stripMarkdown(match[1]);
  }
  return null;
}

/**
 * True when the body renders an H1 of its own, so the document page can adopt
 * that heading as its title instead of rendering a second one.
 *
 * This is deliberately "any depth-1 heading", not only a *leading* one: every
 * document in the corpus has exactly one body H1, but `fleet-complexity-read`
 * opens with an attribution blockquote, so its H1 is not the first block token.
 * A leading-only test would leave that page with the synthesized header H1 and
 * the body H1 — the exact duplication the rule forbids. The first H1 is the one
 * tagged and used; `renderLibraryDoc` inserts the byline directly under it.
 */
function bodyHasH1(body) {
  return marked.lexer(body).some(token => token.type === 'heading' && token.depth === 1);
}

/**
 * True when a whole paragraph is a single emphasis (or strong) span, e.g. an
 * essay's italic subtitle. Used only by the papers-folder excerpt rule below.
 */
function isEmphasisOnlyParagraph(text) {
  const t = String(text).trim();
  const match = /^(\*{1,3}|_{1,3})([\s\S]+?)\1$/.exec(t);
  if (!match) return false;
  // The inner text must not itself contain the marker, or the wrapper is not
  // "wholly" the emphasis and stripping it would change the meaning.
  return !match[2].includes(match[1][0]);
}

/**
 * The first paragraph after the title, the document's index summary.
 *
 * With `skipShort`, an essay subtitle and its "Prepared for …" line are skipped
 * so the summary is the first real prose. This is applied only to documents in
 * the papers folder (LIN-3350): the hand-listed docs' summaries are better as
 * they are, so they keep the plain first-paragraph rule.
 *
 * @param {string} body
 * @param {{skipShort?: boolean}} [opts]
 * @returns {string}
 */
function firstParagraphAfterTitle(body, { skipShort = false } = {}) {
  const lines = body.split('\n');
  let h1 = -1;
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    if (/^#\s+/.test(lines[i])) { h1 = i; break; }
  }
  let i = h1 >= 0 ? h1 + 1 : 0;

  // Skip blank lines, horizontal rules and sub-headings, then read the next
  // paragraph (a doc often opens `## Status` before any prose).
  const nextParagraph = () => {
    while (i < lines.length) {
      const line = lines[i].trim();
      if (line && !/^-{3,}$/.test(line) && !/^#{1,6}\s/.test(line)) break;
      i++;
    }
    const para = [];
    while (i < lines.length && lines[i].trim()) {
      if (/^#{1,6}\s/.test(lines[i])) break;
      para.push(lines[i].trim().replace(/^>\s?/, ''));
      i++;
    }
    return para;
  };

  let para = nextParagraph();
  while (skipShort && para.length) {
    const raw = para.join(' ');
    const words = (stripMarkdown(raw).match(/\S+/g) || []).length;
    if (isEmphasisOnlyParagraph(raw) || words < 12) {
      para = nextParagraph();
    } else {
      break;
    }
  }
  return stripMarkdown(para.join(' '));
}

// ── Link / image rewriting ───────────────────────────────────────────────────

function toPosix(path) {
  return path.split('\\').join('/');
}

function encodePath(path) {
  return path.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

function hasScheme(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/**
 * Resolve a link href. Same-page anchors and absolute http(s)/mailto pass
 * through; dangerous schemes become null (rendered as plain text); a relative
 * target that is a catalogued document becomes `/library/<slug>`; any other
 * relative target becomes the GitHub blob URL of its naïve resolution, so a
 * broken link 404s exactly as it does on GitHub.
 */
function resolveLinkHref(href, render) {
  if (typeof href !== 'string' || href === '') return href;
  if (href.startsWith('#')) return href;
  if (/^(https?:)?\/\//i.test(href)) return href;
  if (hasScheme(href)) return /^(https?:|mailto:)/i.test(href) ? href : null;

  const hashIdx = href.indexOf('#');
  const frag = hashIdx >= 0 ? href.slice(hashIdx) : '';
  const beforeFrag = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  const qIdx = beforeFrag.indexOf('?');
  const query = qIdx >= 0 ? beforeFrag.slice(qIdx) : '';
  const relPath = qIdx >= 0 ? beforeFrag.slice(0, qIdx) : beforeFrag;

  const resolved = resolve(dirname(render.doc.sourcePath), relPath || '.');
  const target = render.catalog.byAbsPath.get(resolved);
  if (target) return `/library/${target.slug}${frag}`;

  const repoRel = toPosix(relative(render.catalog.repoRoot, resolved));
  return `${GITHUB_BASE}${encodePath(repoRel)}${query}${frag}`;
}

/**
 * Resolve an image src. Absolute http(s) pass; dangerous schemes become null;
 * a relative image inside `figures/` becomes `/library/figures/…`; a relative
 * image that escapes the figures root becomes null.
 */
function resolveImageSrc(src, render) {
  if (typeof src !== 'string' || src === '') return src;
  if (/^(https?:)?\/\//i.test(src)) return src;
  if (hasScheme(src)) return null;
  const resolved = resolve(dirname(render.doc.sourcePath), src);
  const rel = toPosix(relative(render.catalog.figuresRoot, resolved));
  if (!rel || rel.startsWith('..')) return null;
  return `/library/figures/${encodePath(rel)}`;
}

// ── Catalog build ────────────────────────────────────────────────────────────

function walkFigures(root, prefix = '') {
  const out = new Map();
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [k, v] of walkFigures(join(root, entry.name), rel)) out.set(k, v);
    } else if (entry.name.endsWith('.svg')) {
      out.set(rel, join(root, entry.name));
    }
  }
  return out;
}

function readArchiveEditions(docsRoot) {
  const dir = join(docsRoot, 'archive');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => /^\d+\.html$/.test(name))
    .map(name => {
      const n = parseInt(name, 10);
      const html = readFileSync(join(dir, name), 'utf8');
      const match = /<title>([\s\S]*?)<\/title>/i.exec(html);
      return { n, title: match ? htmlToText(match[1]) : `${n}.html` };
    })
    .sort((a, b) => a.n - b.n);
}

function byDateDesc(a, b) {
  const ta = a.date ? Date.parse(a.date) : 0;
  const tb = b.date ? Date.parse(b.date) : 0;
  if (ta !== tb) return tb - ta;
  return a.title.localeCompare(b.title);
}

function buildSnippet(plainText, title, terms) {
  const text = plainText || title || '';
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx >= 0 && (at === -1 || idx < at)) at = idx;
  }
  let snippet;
  if (at === -1) {
    snippet = text.slice(0, 200);
  } else {
    const start = Math.max(0, at - 90);
    const end = Math.min(text.length, at + 160);
    snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  }
  return highlightTerms(snippet, terms);
}

/** Escape a plain snippet, then wrap term matches in `<mark>` (never on HTML). */
function highlightTerms(text, terms) {
  if (!terms.length) return escapeHtml(text);
  const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escapedTerms.join('|')})`, 'ig');
  let out = '';
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, match.index));
    out += `<mark>${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

function buildCatalog(docsRoot) {
  const papersDir = join(docsRoot, 'papers', 'harbour');
  const figuresRoot = join(papersDir, 'figures');
  const repoRoot = dirname(docsRoot);
  const figures = walkFigures(figuresRoot);

  const entries = [];
  if (existsSync(papersDir)) {
    for (const name of readdirSync(papersDir).filter(f => f.endsWith('.md')).sort()) {
      entries.push({ kind: 'paper', absPath: join(papersDir, name), slug: basename(name, '.md') });
    }
  }
  for (const listed of LISTED_DOCS) {
    entries.push({
      kind: 'listed',
      absPath: join(docsRoot, listed.path),
      slug: `doc/${basename(listed.path, '.md')}`,
      listed,
    });
  }

  const byAbsPath = new Map();
  const bySlug = new Map();
  const docs = [];

  for (const entry of entries) {
    if (!existsSync(entry.absPath)) continue;
    const raw = readFileSync(entry.absPath, 'utf8');
    const { frontMatter, body } = parseFrontMatter(raw);
    const override = entry.listed || PAPER_METADATA_OVERRIDES[basename(entry.absPath)];
    const title = frontMatter.title || firstH1(body) || basename(entry.absPath, '.md');
    // `kind` stays the location-based `'paper'|'listed'` the existing sort and
    // routing rely on; `docKind` is the document's own front-matter kind (the
    // shelf split, LIN-3350). In the papers folder an absent kind means a paper
    // (`docs/papers/standard.md`); listed docs carry no shelf kind.
    const isPaperFile = entry.kind === 'paper';
    const doc = {
      slug: entry.slug,
      kind: entry.kind,
      docKind: isPaperFile ? (typeof frontMatter.kind === 'string' ? frontMatter.kind : 'paper') : null,
      sourcePath: entry.absPath,
      title: typeof title === 'string' ? title : String(title),
      date: frontMatter.date || override?.date || null,
      author: normalizeAuthor(frontMatter) || override?.author || 'John Kershaw and Claude',
      summary: truncate(firstParagraphAfterTitle(body, { skipShort: isPaperFile }), 240),
      readingTime: Math.max(1, Math.round(countWords(body) / 200)),
      figureCount: 0,
      body,
      raw,
      hasBodyH1: bodyHasH1(body),
      html: '',
      headings: [],
      linkSlugs: new Set(),
      plainText: '',
    };
    docs.push(doc);
    byAbsPath.set(doc.sourcePath, doc);
    bySlug.set(doc.slug, doc);
  }

  const catalog = { docsRoot, repoRoot, figuresRoot, figures, docs, byAbsPath, bySlug };

  for (const doc of docs) {
    activeRender = {
      slugger: createSlugger(),
      headings: doc.headings,
      linkSlugs: doc.linkSlugs,
      doc,
      catalog,
      bodyH1Pending: doc.hasBodyH1,
    };
    doc.html = marked.parse(doc.body);
    doc.plainText = htmlToText(doc.html);
    doc.figureCount = (doc.html.match(/<img\b/g) || []).length;
    activeRender = null;
  }

  const backlinks = new Map();
  for (const doc of docs) {
    for (const slug of doc.linkSlugs) {
      if (slug === doc.slug) continue;
      if (!backlinks.has(slug)) backlinks.set(slug, []);
      const list = backlinks.get(slug);
      if (!list.includes(doc)) list.push(doc);
    }
  }
  for (const list of backlinks.values()) list.sort(byDateDesc);

  // The shelves are an allow-list over the documents' own front-matter kind
  // (LIN-3350): essays, then papers (kind `paper` or absent), then the
  // hand-curated Other documents. Anything else in the papers folder — checks,
  // data, pre-registrations — is served but unshelved.
  const essays = docs.filter(d => d.kind === 'paper' && d.docKind === 'essay').sort(byDateDesc);
  const papers = docs.filter(d => d.kind === 'paper' && d.docKind === 'paper').sort(byDateDesc);
  const listed = docs.filter(d => d.kind === 'listed').sort(byDateDesc);

  const startHere = START_HERE.map(item => (
    item.slug ? { ...item, doc: bySlug.get(item.slug) || null } : { ...item }
  ));

  return {
    ...catalog,
    essays,
    papers,
    listed,
    archiveEditions: readArchiveEditions(docsRoot),
    startHere,
    backlinks,
    docForSlug(slug) {
      return bySlug.get(slug) || null;
    },
    backlinksFor(slug) {
      return backlinks.get(slug) || [];
    },
    figureFor(rel) {
      return figures.get(rel) || null;
    },
    search(query) {
      return searchCatalog(docs, query);
    },
  };
}

// Imported lazily to keep the metadata module data-only and avoid a cycle.
function searchCatalog(docs, query) {
  const q = String(query == null ? '' : query).slice(0, 200);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (terms.length === 0) return { query: q, terms: [], results: [] };
  const results = [];
  for (const doc of docs) {
    const hay = `${doc.title}\n${doc.plainText}`.toLowerCase();
    if (!terms.every(term => hay.includes(term))) continue;
    const titleHits = terms.filter(term => doc.title.toLowerCase().includes(term)).length;
    results.push({ doc, titleHits, snippet: buildSnippet(doc.plainText, doc.title, terms) });
  }
  results.sort((a, b) => b.titleHits - a.titleHits || byDateDesc(a.doc, b.doc));
  return { query: q, terms, results };
}

/**
 * Load (and memoise) the Library catalog for a docs root.
 * @param {string} [root] - Injectable docs root (defaults to `<repo>/docs`).
 * @returns {ReturnType<typeof buildCatalog>}
 */
export function loadLibrary(root = DEFAULT_DOCS_ROOT) {
  const key = resolve(root);
  if (!cache.has(key)) cache.set(key, buildCatalog(key));
  return cache.get(key);
}
