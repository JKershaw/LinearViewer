/**
 * Harbour Library routes (LIN-3344, Part A of LIN-3342).
 *
 * Public, session-less, read-only surfaces:
 *   GET /library                 — index, or results when `?q=`
 *   GET /library/doc/:slug(.md)  — a listed document (registered before the paper form)
 *   GET /library/:slug(.md)      — a paper or essay
 *   GET /library/figures/*       — the 64 SVGs, script-blocked
 *
 * Canonical URL per document: papers at `/library/<slug>`, listed docs at
 * `/library/doc/<slug>` only (the other form 404s). Slug lookup is a Map, so a
 * traversal like `/library/../server.js` is a 404 by construction.
 *
 * Every response carries `X-Content-Type-Options: nosniff`; HTML pages pin
 * their one inline theme script by hash (`script-src 'sha256-…'`, no
 * `'self'`); `.md` is `text/markdown; charset=utf-8` under a sandbox CSP;
 * figures are `image/svg+xml` under a script-blocking CSP.
 *
 * `docsRoot` is injectable so the security fixture can be rendered without
 * touching the real tree.
 */

import { Router } from 'express';
import { renderErrorPage } from '../lib/render.js';
import { themePrepaintScriptHash } from '../lib/components/page.js';
import { DEFAULT_DOCS_ROOT, loadLibrary } from '../lib/library.js';
import { renderLibraryDoc, renderLibraryIndex } from '../lib/render-library.js';
import { isPublicLibraryPath } from '../lib/guest-task-path.js';

/** The HTML CSP: only the shell's inline theme script may run. */
export const LIBRARY_CSP = `default-src 'none'; script-src '${themePrepaintScriptHash()}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'`;

/** The `.md` CSP: nothing loads, and the response is sandboxed. */
export const MARKDOWN_CSP = "default-src 'none'; sandbox";

/** The figure CSP: an SVG may style itself, but may not run script or load. */
export const FIGURE_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/** The absolute origin for canonical tags, from a validated Host header. */
function baseUrl(req) {
  const host = req.get('host') || 'harbour.cat';
  const safe = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? host : 'harbour.cat';
  return `${req.protocol}://${safe}`;
}

/** XML-escape a value destined for a sitemap `<loc>`/`<lastmod>`. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Every canonical, query-free URL the sitemap lists. The set is derived from
 * the catalog by construction (never hand-written), so it cannot drift from the
 * routes: the two top-level public pages, every paper and listed document at
 * its one canonical path, and every Archive edition. No `?q=` URL can appear —
 * the loop never builds one.
 *
 * @param {ReturnType<import('../lib/library.js').loadLibrary>} catalog
 * @returns {{path: string, lastmod: string|null}[]}
 */
export function sitemapEntries(catalog) {
  const entries = [
    { path: '/', lastmod: null },
    { path: '/library', lastmod: null },
  ];
  for (const doc of [...catalog.papers, ...catalog.listed]) {
    // `lastmod` only when the date is a real `YYYY-MM-DD`; omit rather than invent.
    const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(doc.date || '') ? doc.date : null;
    entries.push({ path: `/library/${doc.slug}`, lastmod });
  }
  for (const edition of catalog.archiveEditions) {
    entries.push({ path: `/archive/${edition.n}`, lastmod: null });
  }
  return entries;
}

/**
 * @param {Object} [deps]
 * @param {string} [deps.docsRoot] - Injectable docs root (defaults to `<repo>/docs`).
 * @returns {import('express').Router}
 */
export function createLibraryRouter({ docsRoot = DEFAULT_DOCS_ROOT } = {}) {
  // Prime the catalog at mount, off the request path (the walk + render is
  // ~150 ms; a first request should not pay it).
  const catalog = loadLibrary(docsRoot);

  const router = Router();

  // Header hygiene scoped to public Library paths only, so mounting the router
  // at `/` cannot touch the rest of the app. Uses the shared case-insensitive
  // predicate so a route Express serves case-insensitively (`/Library/x`) still
  // gets the header; a second, case-sensitive copy here would drift (LIN-3344
  // review F2).
  router.use((req, res, next) => {
    if (isPublicLibraryPath(req.path)) res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  function sendDoc(req, res, slug) {
    const doc = catalog.docForSlug(slug);
    if (!doc) return notFound(res);
    res.set('Content-Security-Policy', LIBRARY_CSP);
    if (req.query.q) res.set('X-Robots-Tag', 'noindex');
    const canonicalUrl = `${baseUrl(req)}/library/${doc.slug}`;
    return res.send(renderLibraryDoc(doc, catalog, { canonicalUrl }));
  }

  function sendMarkdown(res, slug) {
    const doc = catalog.docForSlug(slug);
    if (!doc) return notFound(res);
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Security-Policy', MARKDOWN_CSP);
    return res.send(doc.raw);
  }

  function notFound(res) {
    res.set('Content-Security-Policy', LIBRARY_CSP);
    return res.status(404).send(renderErrorPage('Page not found', 'There is no Library document at that address.'));
  }

  // ── Crawler files (LIN-3345) ───────────────────────────────────────────────
  // Public, session-less, and nosniff'd by the shared predicate above. The
  // sitemap reuses this router's `baseUrl`/catalog; no new auth surface.
  router.get('/sitemap.xml', (req, res) => {
    const base = baseUrl(req);
    const urls = sitemapEntries(catalog).map(({ path, lastmod }) => {
      const loc = `<loc>${escapeXml(`${base}${path}`)}</loc>`;
      return `  <url>${loc}${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</url>`;
    }).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(xml);
  });

  // robots.txt deliberately has no `Disallow: /library?q=`: a crawler blocked
  // from fetching a results page never sees its `X-Robots-Tag: noindex`, so
  // blocking it would weaken A's mechanism. It lists no app paths either — a
  // site-wide crawl policy is outside this ticket.
  router.get('/robots.txt', (req, res) => {
    const base = baseUrl(req);
    const body = `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
    res.set('Content-Type', 'text/plain; charset=utf-8');
    return res.send(body);
  });

  // ── Listed documents first (so `/library/doc/...` cannot fall to `:slug`) ──
  router.get('/library/doc/:slug.md', (req, res) => sendMarkdown(res, `doc/${req.params.slug}`));
  router.get('/library/doc/:slug', (req, res) => sendDoc(req, res, `doc/${req.params.slug}`));

  // ── Papers and essays ──────────────────────────────────────────────────────
  router.get('/library/:slug.md', (req, res) => sendMarkdown(res, req.params.slug));
  router.get('/library/:slug', (req, res) => sendDoc(req, res, req.params.slug));

  // ── Figures ────────────────────────────────────────────────────────────────
  router.get('/library/figures/*', (req, res) => {
    const rel = req.params[0];
    const abs = catalog.figureFor(rel);
    if (!abs) return notFound(res);
    res.set('Content-Security-Policy', FIGURE_CSP);
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('image/svg+xml');
    return res.sendFile(abs);
  });

  // ── Index / search ─────────────────────────────────────────────────────────
  router.get('/library', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.set('Content-Security-Policy', LIBRARY_CSP);
    if (query.trim() !== '') res.set('X-Robots-Tag', 'noindex');
    const canonicalUrl = `${baseUrl(req)}/library`;
    return res.send(renderLibraryIndex(catalog, { query, canonicalUrl }));
  });

  return router;
}