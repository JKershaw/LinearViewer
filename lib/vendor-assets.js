/**
 * Browser libraries served from node_modules (LIN-3787), and shared browser modules served from lib/ (LIN-4446, LIN-4471).
 *
 * DOMPurify, marked and Chart.js used to be minified copies committed under
 * public/, which `npm audit` and LIN-620 cannot see (LIN-3786 finding
 * vendored-dompurify-drift). They are now exact-pinned/declared dependencies
 * in package.json and served here at the SAME URLs, so the script tags, the
 * load order (LIN-2670: purify before marked) and CSP `script-src 'self'`
 * are unchanged and no renderer is edited.
 *
 * Paths are built under node_modules rather than via `require.resolve`:
 * none of the three packages exports these files. Each file is `statSync`ed
 * at module load, so a missing or renamed asset fails the boot instead of
 * 404ing in the browser.
 *
 * SHARED_MODULES (LIN-4446) is the second, separate allow-list: pure leaf files under lib/ that a
 * browser module imports natively, so the server and the browser run the same bytes. The namespace is
 * /lib/ (LIN-4471): a page module at /x.js imports '../lib/x.js', which the browser resolves to /lib/x.js and
 * Node resolves to lib/x.js. That needs public/ served at the URL root (server.js's `express.static('public')`
 * mount, pinned in tests/unit/vendor-assets.test.js) and public/ kept flat, with no nested .js
 * (tests/unit/front-end-import-layout.test.js). Each entry is one file, never a directory, so lib/ is
 * not published: a lib file not on the list is a 404. A shared module must stay a leaf: it
 * imports nothing and names no browser or Node global (window, document, process, require);
 * tests/unit/shared-modules.test.js enforces that.
 *
 * server.js mounts the router immediately before `express.static('public')`
 * so these responses keep the same `Cache-Control: public, max-age=0`, ETag
 * and Last-Modified as the old static files, and `defaultCacheControl()`
 * (LIN-3692) still skips them.
 */
import express from 'express';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE_MODULES = join(ROOT, 'node_modules');

/** URL path -> file under node_modules. The single source of truth. */
export const VENDOR_ASSETS = Object.freeze({
  '/purify.min.js': 'dompurify/dist/purify.min.js',
  '/marked.min.js': 'marked/lib/marked.umd.js',
  '/chart.umd.min.js': 'chart.js/dist/chart.umd.min.js',
});

/** URL path -> file under the repo root (LIN-4446, re-keyed to /lib/ by LIN-4471). A leaf module the browser imports; one file per entry. */
export const SHARED_MODULES = Object.freeze({
  '/lib/cost-format.js': 'lib/cost-format.js',
  '/lib/time-words.js': 'lib/time-words.js',
});

/** Absolute file path for a vendor URL. */
export function vendorAssetPath(url, nodeModulesDir = NODE_MODULES) {
  const rel = VENDOR_ASSETS[url];
  if (!rel) throw new Error(`Unknown vendor asset: ${url}`);
  return join(nodeModulesDir, rel);
}

/** Absolute file path for a shared-module URL (LIN-4446). */
export function sharedModulePath(url, rootDir = ROOT) {
  const rel = SHARED_MODULES[url];
  if (!rel) throw new Error(`Unknown shared module: ${url}`);
  return join(rootDir, rel);
}

/**
 * @param {{nodeModulesDir?: string, rootDir?: string}} [options]  `rootDir` is the repo root that
 *   SHARED_MODULES resolve against; tests point it at an empty directory to prove a missing file fails the boot.
 * @returns {import('express').Router}
 */
export function createVendorAssetsRouter({ nodeModulesDir = NODE_MODULES, rootDir = ROOT } = {}) {
  const router = express.Router();
  const served = [
    ...Object.keys(VENDOR_ASSETS).map((url) => [url, vendorAssetPath(url, nodeModulesDir)]),
    ...Object.keys(SHARED_MODULES).map((url) => [url, sharedModulePath(url, rootDir)]),
  ];
  for (const [url, file] of served) {
    if (!statSync(file).isFile()) throw new Error(`Not a file: ${file}`); // throws at boot if missing
    router.get(url, (req, res, next) => {
      res.sendFile(file, (err) => { if (err) next(err); });
    });
  }
  return router;
}
