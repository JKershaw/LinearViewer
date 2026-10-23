/**
 * Browser libraries served from node_modules (LIN-3787).
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

/** Absolute file path for a vendor URL. */
export function vendorAssetPath(url, nodeModulesDir = NODE_MODULES) {
  const rel = VENDOR_ASSETS[url];
  if (!rel) throw new Error(`Unknown vendor asset: ${url}`);
  return join(nodeModulesDir, rel);
}

/** @returns {import('express').Router} */
export function createVendorAssetsRouter({ nodeModulesDir = NODE_MODULES } = {}) {
  const router = express.Router();
  for (const url of Object.keys(VENDOR_ASSETS)) {
    const file = vendorAssetPath(url, nodeModulesDir);
    statSync(file); // throws at boot if the package or file is missing
    router.get(url, (req, res, next) => {
      res.sendFile(file, (err) => { if (err) next(err); });
    });
  }
  return router;
}
