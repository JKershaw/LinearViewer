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

function isLibraryPath(path) {
  return path === '/library' || path.startsWith('/library/');
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

  // Header hygiene scoped to Library paths only, so mounting the router at `/`
  // cannot touch the rest of the app.
  router.use((req, res, next) => {
    if (isLibraryPath(req.path)) res.set('X-Content-Type-Options', 'nosniff');
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