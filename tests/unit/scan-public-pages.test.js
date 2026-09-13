/**
 * Unit tests for lib/scan-public-pages.js (LIN-2573).
 *
 * Verifies public page crawling, script extraction, and secret scanning
 * of served public pages (/ , /kpis, /archive/:n).
 *
 * Hermetic: binds to 127.0.0.1 explicitly (LIN-2023), zero external network.
 * Run with: node --test tests/unit/scan-public-pages.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  extractScriptsFromHtml,
  discoverPublicPages,
  scanPublicPages
} from '../../lib/scan-public-pages.js';

describe('extractScriptsFromHtml', () => {
  test('extracts inline script content', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script>console.log("hello world");</script>
        </head>
        <body>
          <h1>Test</h1>
        </body>
      </html>
    `;
    const scripts = extractScriptsFromHtml(html, 'http://127.0.0.1:3000/landing');
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].type, 'inline');
    assert.equal(scripts[0].content, 'console.log("hello world");');
  });

  test('extracts external script with resolved absolute URL', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script src="/common.js"></script>
          <script src="https://cdn.example.com/lib.js"></script>
        </head>
      </html>
    `;
    const scripts = extractScriptsFromHtml(html, 'http://127.0.0.1:3000/kpis');
    assert.equal(scripts.length, 2);
    assert.equal(scripts[0].type, 'external');
    assert.equal(scripts[0].url, 'http://127.0.0.1:3000/common.js');
    assert.equal(scripts[1].type, 'external');
    assert.equal(scripts[1].url, 'https://cdn.example.com/lib.js');
  });

  test('extracts multiple scripts of mixed types', () => {
    const html = `
      <script>var x = 1;</script>
      <script src="/bundle.js"></script>
      <script>var y = 2;</script>
    `;
    const scripts = extractScriptsFromHtml(html, 'http://127.0.0.1:3000/');
    assert.equal(scripts.length, 3);
    assert.equal(scripts[0].type, 'inline');
    assert.equal(scripts[1].type, 'external');
    assert.equal(scripts[2].type, 'inline');
  });
});

describe('discoverPublicPages and scanPublicPages (Hermetic HTTP Server)', () => {
  let server;
  let baseUrl;
  let serverMode = 'clean'; // 'clean' | 'inline-secret' | 'external-secret'

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <script src="/common.js"></script>
            </head>
            <body>Landing Page</body>
          </html>
        `);
      } else if (url.pathname === '/kpis') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        const secretVal = ['lin_api_', '0123456789abcdef0123456789abcdef01234567'].join('');
        const inlineSecret = serverMode === 'inline-secret'
          ? `<script>window.SECRET_CONFIG = { apiKey: "${secretVal}" };</script>`
          : '<script>window.KPI_DATA = { users: 10 };</script>';
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              ${inlineSecret}
              <script src="/common.js"></script>
            </head>
            <body>KPIs Page</body>
          </html>
        `);
      } else if (url.pathname === '/archive/1') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><script>var archiveNum = 1;</script><body>Archive 1</body></html>');
      } else if (url.pathname === '/archive/2') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Archive 2 without scripts</body></html>');
      } else if (url.pathname === '/common.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        if (serverMode === 'external-secret') {
          const secretVal = ['sk-ant-', 'api03-0123456789abcdef0123456789abcdef0123456789abcdef'].join('');
          res.end(`const anthropicToken = "${secretVal}";`);
        } else {
          res.end('console.log("common library initialized");');
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('discoverPublicPages discovers /, /kpis, and probes /archive/1..2 stopping at /archive/3 (404)', async () => {
    const pages = await discoverPublicPages(baseUrl, { maxArchive: 5 });
    assert.deepEqual(pages, ['/', '/kpis', '/archive/1', '/archive/2']);
  });

  test('scanPublicPages returns clean: true on clean site', async () => {
    serverMode = 'clean';
    const result = await scanPublicPages({ baseUrl, maxArchive: 5 });
    assert.equal(result.clean, true);
    assert.equal(result.findings.length, 0);
    assert.ok(result.scannedPages.includes('/'));
    assert.ok(result.scannedPages.includes('/kpis'));
    assert.ok(result.scannedPages.includes('/archive/1'));
    assert.ok(result.scannedPages.includes('/archive/2'));
  });

  test('scanPublicPages flags secret in inline script with P1 severity', async () => {
    serverMode = 'inline-secret';
    const result = await scanPublicPages({ baseUrl, maxArchive: 5 });
    assert.equal(result.clean, false);
    assert.ok(result.findings.length >= 1);
    const finding = result.findings.find(f => f.ruleId === 'linear-api-key');
    assert.ok(finding, 'Expected linear-api-key finding');
    assert.equal(finding.severity, 'P1');
    assert.equal(finding.scriptType, 'inline');
    assert.equal(finding.pageUrl, `${baseUrl}/kpis`);
    assert.equal(finding.redacted, 'lin_...[REDACTED]...4567');
  });

  test('scanPublicPages flags secret in served external JS file with P1 severity', async () => {
    serverMode = 'external-secret';
    const result = await scanPublicPages({ baseUrl, maxArchive: 5 });
    assert.equal(result.clean, false);
    assert.ok(result.findings.length >= 1);
    const finding = result.findings.find(f => f.ruleId === 'anthropic-api-key');
    assert.ok(finding, 'Expected anthropic-api-key finding in external script');
    assert.equal(finding.severity, 'P1');
    assert.equal(finding.scriptType, 'external');
    assert.equal(finding.filePath, `${baseUrl}/common.js`);
    assert.equal(finding.redacted, 'sk-a...[REDACTED]...cdef');
  });
});
