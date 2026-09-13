/**
 * Public pages secret scanner (LIN-2573).
 *
 * Fetches public pages on harbour.cat (landing /, /kpis, /archive/:n),
 * extracts all served JavaScript (inline scripts and external script tags),
 * and scans them for exposed secrets. Any hit is treated as a P1 incident.
 */

import { scanText } from './secret-scan.js';

/**
 * Extracts inline and external scripts from HTML content.
 *
 * @param {string} html
 * @param {string} pageUrl
 * @returns {Array<{ type: 'inline'|'external', url?: string, content?: string, pageUrl: string }>}
 */
export function extractScriptsFromHtml(html, pageUrl) {
  if (!html || typeof html !== 'string') return [];
  const scripts = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const inlineBody = (match[2] || '').trim();

    // Check for src attribute
    const srcMatch = /\bsrc=["']([^"']+)["']/i.exec(attrs);
    if (srcMatch) {
      const rawSrc = srcMatch[1].trim();
      if (rawSrc) {
        try {
          const absoluteUrl = new URL(rawSrc, pageUrl).toString();
          scripts.push({
            type: 'external',
            url: absoluteUrl,
            pageUrl
          });
        } catch {
          // If URL parsing fails, ignore invalid URL
        }
      }
    } else if (inlineBody.length > 0) {
      scripts.push({
        type: 'inline',
        content: inlineBody,
        pageUrl
      });
    }
  }

  return scripts;
}

/**
 * Discovers available public pages on the target site.
 *
 * @param {string} baseUrl
 * @param {Object} [options]
 * @param {number} [options.maxArchive=20]
 * @param {typeof fetch} [options.fetchImpl=globalThis.fetch]
 * @param {Array<Object>} [options.errors] - Optional array to collect probe errors
 * @returns {Promise<string[]>}
 */
export async function discoverPublicPages(baseUrl, options = {}) {
  const { maxArchive = 20, fetchImpl = globalThis.fetch, errors = null } = options;
  const pages = ['/', '/kpis'];
  let hit404 = false;

  // Probe numbered archive pages /archive/:n sequentially until 404
  for (let n = 1; n <= maxArchive; n++) {
    const archiveUrl = new URL(`/archive/${n}`, baseUrl).toString();
    try {
      const res = await fetchImpl(archiveUrl, { method: 'GET' });
      if (res.status === 200) {
        pages.push(`/archive/${n}`);
      } else if (res.status === 404) {
        // Consecutive 404 indicates end of numbered archive sequence
        hit404 = true;
        break;
      } else {
        const errMsg = `Unexpected HTTP status ${res.status} probing archive document ${archiveUrl}`;
        if (errors) {
          errors.push({ type: 'archive-probe', url: archiveUrl, status: res.status, message: errMsg });
        }
        break;
      }
    } catch (err) {
      const errMsg = `Fetch failure probing archive document ${archiveUrl}: ${err.message}`;
      if (errors) {
        errors.push({ type: 'archive-probe', url: archiveUrl, error: err.message, message: errMsg });
      }
      break;
    }
  }

  if (!hit404 && pages.length === 2 + maxArchive) {
    console.warn(`[scan-public-pages] Reached maxArchive cap of ${maxArchive} without encountering 404.`);
  }

  return pages;
}

/**
 * Scans the served JavaScript on public pages for secrets.
 *
 * @param {Object} [options]
 * @param {string} [options.baseUrl='https://harbour.cat']
 * @param {number} [options.maxArchive=20]
 * @param {typeof fetch} [options.fetchImpl=globalThis.fetch]
 * @param {string[]} [options.explicitPages] - Optional explicit list of page paths to scan
 * @returns {Promise<{ clean: boolean, findings: Array<Object>, errors: Array<Object>, scannedPages: string[], scannedScripts: string[] }>}
 */
export async function scanPublicPages(options = {}) {
  const {
    baseUrl = 'https://harbour.cat',
    maxArchive = 20,
    fetchImpl = globalThis.fetch,
    explicitPages = null
  } = options;

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const errors = [];
  const pages = explicitPages || await discoverPublicPages(normalizedBase, { maxArchive, fetchImpl, errors });

  const externalScriptsContent = new Map(); // url -> content
  const scriptsToScan = []; // Array<{ name: string, content: string, pageUrl: string, type: string }>
  const scannedScriptNames = new Set();
  const successfullyScannedPages = [];

  for (const pagePath of pages) {
    const pageUrl = new URL(pagePath, normalizedBase).toString();
    let html;
    try {
      const res = await fetchImpl(pageUrl, { method: 'GET' });
      if (!res.ok) {
        errors.push({
          type: 'page-fetch',
          pagePath,
          url: pageUrl,
          status: res.status,
          message: `Failed to fetch page ${pagePath}: HTTP ${res.status}`
        });
        continue;
      }
      html = await res.text();
      successfullyScannedPages.push(pagePath);
    } catch (err) {
      errors.push({
        type: 'page-fetch',
        pagePath,
        url: pageUrl,
        error: err.message,
        message: `Failed to fetch page ${pagePath}: ${err.message}`
      });
      continue;
    }

    const extracted = extractScriptsFromHtml(html, pageUrl);
    let inlineIndex = 0;

    for (const item of extracted) {
      if (item.type === 'inline') {
        inlineIndex++;
        const name = `${pagePath} [inline script #${inlineIndex}]`;
        scannedScriptNames.add(name);
        scriptsToScan.push({
          name,
          content: item.content,
          pageUrl,
          type: 'inline'
        });
      } else if (item.type === 'external') {
        scannedScriptNames.add(item.url);
        if (!externalScriptsContent.has(item.url)) {
          try {
            const res = await fetchImpl(item.url, { method: 'GET' });
            if (res.ok) {
              const jsContent = await res.text();
              externalScriptsContent.set(item.url, jsContent);
              scriptsToScan.push({
                name: item.url,
                content: jsContent,
                pageUrl,
                type: 'external'
              });
            } else {
              errors.push({
                type: 'script-fetch',
                url: item.url,
                pageUrl,
                status: res.status,
                message: `Failed to fetch script ${item.url}: HTTP ${res.status}`
              });
            }
          } catch (err) {
            errors.push({
              type: 'script-fetch',
              url: item.url,
              pageUrl,
              error: err.message,
              message: `Failed to fetch script ${item.url}: ${err.message}`
            });
          }
        }
      }
    }
  }

  // Fail if zero JavaScript assets were analyzed across public pages
  if (scannedScriptNames.size === 0) {
    errors.push({
      type: 'zero-scripts',
      message: 'Zero JavaScript assets were analyzed across public pages.'
    });
  }

  const findings = [];

  for (const script of scriptsToScan) {
    const scriptFindings = scanText(script.content, { filePath: script.name });
    for (const f of scriptFindings) {
      findings.push({
        ...f,
        severity: 'P1',
        pageUrl: script.pageUrl,
        scriptType: script.type,
      });
    }
  }

  const clean = findings.length === 0 && errors.length === 0;

  return {
    clean,
    findings,
    errors,
    scannedPages: successfullyScannedPages,
    scannedScripts: Array.from(scannedScriptNames)
  };
}
