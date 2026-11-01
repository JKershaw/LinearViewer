/**
 * LIN-4085 — GET /getting-started and GET /getting-started.md (routes/getting-started.js),
 * and the two exact auth exemptions that make them public (lib/guest-task-path.js).
 *
 * Witnesses:
 *   - both forms are served with no session, with the headers that matter for each;
 *   - the body carries the request's validated origin, and a malformed Host falls back;
 *   - lookalike paths are not served here and are not exempt from auth;
 *   - the guard is widened by exactly these two paths.
 *
 * Run with: node --test tests/unit/getting-started-route.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import { createGettingStartedRouter, renderGuideHtml } from '../../routes/getting-started.js';
import { isAuthExemptPath } from '../../lib/guest-task-path.js';
import { LIBRARY_CSP, MARKDOWN_CSP } from '../../routes/library.js';

const NO_DOORS = { githubEnabled: false, jiraEnabled: false, emailEnabled: false, freeTierEnabled: false };
const ALL_DOORS = { githubEnabled: true, jiraEnabled: true, emailEnabled: true, freeTierEnabled: true };

/** Serve just the guide router on 127.0.0.1, with the given flags. */
async function serve(flags) {
  const app = express();
  app.use(createGettingStartedRouter({ flags: () => flags }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** A raw GET with a chosen Host header (fetch will not let us set Host). */
function getWithHost(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /getting-started.md', () => {
  test('serves the guide as sandboxed markdown, with no session, nosniff and no-store', async () => {
    const { server, base } = await serve(ALL_DOORS);
    try {
      const res = await fetch(`${base}/getting-started.md`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
      assert.equal(res.headers.get('content-security-policy'), MARKDOWN_CSP);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const body = await res.text();
      assert.match(body, /^# Harbour: onboarding for coding agents/m);
      assert.equal(body.includes('{{'), false, 'every placeholder filled');
    } finally {
      server.close();
    }
  });

  test('its links use the origin of the request, and its doors follow the flags', async () => {
    const { server, base } = await serve(NO_DOORS);
    try {
      const body = await (await fetch(`${base}/getting-started.md`)).text();
      assert.ok(body.includes(`${base}/auth/linear`), 'the Linear door is on this origin');
      assert.equal(body.includes('/auth/github'), false, 'GitHub is off, so it is not offered');
      assert.equal(body.includes('This deployment has no free tier'), true);
    } finally {
      server.close();
    }
  });
});

describe('GET /getting-started (HTML)', () => {
  test('serves the guide as HTML under the Library CSP', async () => {
    const { server, base } = await serve(ALL_DOORS);
    try {
      const res = await fetch(`${base}/getting-started`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /^text\/html/);
      assert.equal(res.headers.get('content-security-policy'), LIBRARY_CSP);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const html = await res.text();
      assert.ok(html.includes('data-testid="getting-started"'));
      assert.ok(html.includes('<h1'), 'the guide title renders as a heading');
      assert.equal(html.includes('{{'), false);
      assert.equal(html.includes('<script>alert'), false);
    } finally {
      server.close();
    }
  });

  test('the HTML renderer drops an unsafe link target and keeps the link text', () => {
    // Direct call with hostile input: the real guide has none, so a route-level check could never fail.
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example/x']) {
      const html = renderGuideHtml(`[click me](${href})`);
      assert.equal(/href=/i.test(html), false, `${href} must not become an href`);
      assert.ok(html.includes('click me'), 'the link text survives');
    }
    assert.ok(renderGuideHtml('[ok](https://harbour.cat/x)').includes('href="https://harbour.cat/x"'), 'a safe link still renders');
  });

  test('the HTML renderer escapes raw HTML instead of passing it through', () => {
    const html = renderGuideHtml('<script>alert(1)</script>\n\ntext <img src=x onerror=alert(1)>');
    assert.ok(html.includes('&lt;script&gt;'), 'script tag is escaped');
    assert.equal(html.includes('<script>'), false);
    assert.equal(html.includes('<img'), false);
  });
});

describe('origin handling', () => {
  test('a malformed Host header falls back to harbour.cat, and its text never reaches the body', async () => {
    const { server } = await serve(NO_DOORS);
    try {
      const { port } = server.address();
      const res = await getWithHost(port, '/getting-started.md', 'evil.example/<script>alert(1)</script>');
      assert.equal(res.status, 200);
      assert.equal(res.body.includes('evil.example'), false, 'the attacker host is not in the body');
      assert.equal(res.body.includes('<script>'), false);
      assert.ok(res.body.includes('http://harbour.cat/auth/linear'), 'the canonical fallback origin is used');
    } finally {
      server.close();
    }
  });
});

describe('lookalikes are not served here', () => {
  test('near-miss paths 404 from this router', async () => {
    const { server, base } = await serve(NO_DOORS);
    try {
      for (const path of ['/getting-started.md.bak', '/getting-startedfoo', '/api/getting-started', '/getting-started/x']) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.status, 404, `${path} is not the guide`);
      }
    } finally {
      server.close();
    }
  });
});

describe('the two exact auth exemptions', () => {
  test('exactly these forms are exempt, in any case and with one trailing slash', () => {
    for (const path of ['/getting-started', '/getting-started/', '/Getting-Started', '/getting-started.md', '/GETTING-STARTED.MD/']) {
      assert.equal(isAuthExemptPath(path), true, `${path} is exempt`);
    }
  });

  test('lookalikes and authenticated routes are not exempt', () => {
    for (const path of [
      '/getting-started.md.bak',
      '/getting-startedfoo',
      '/getting-started.md/x',
      '/getting-started//',
      '/api/getting-started',
      '/workspace/x/proxy',
      '/swipe',
    ]) {
      assert.equal(isAuthExemptPath(path), false, `${path} is not exempt`);
    }
  });
});
