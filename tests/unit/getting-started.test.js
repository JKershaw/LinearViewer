/**
 * Getting started, through your agent: the homepage prompt, the guide at
 * `/getting-started`, and its routes (lib/getting-started.js,
 * routes/getting-started.js, lib/render-getting-started.js).
 *
 * The guide is prose an agent acts on, so besides the mechanics these tests
 * check the guide's claims that can drift against the source they describe:
 * every Settings area it names exists, every in-page link resolves, every path
 * it names on this server is a route Harbour serves, and the stage names and
 * limits it quotes are the code's own.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentPrompt,
  buildGettingStartedGuide,
  createGuideBuilder,
  renderGuideHtml,
  safeGuideHref,
  prefersMarkdown,
  DEFAULT_ORIGIN,
  GUIDE_SOURCE_PATH,
} from '../../lib/getting-started.js';
import { createGettingStartedRouter } from '../../routes/getting-started.js';
import { LIBRARY_CSP, MARKDOWN_CSP } from '../../routes/library.js';
import { AREAS } from '../../lib/settings-areas.js';
import { renderLandingPage } from '../../lib/render-landing.js';
import { USUAL_STAGES, STAGE_LABELS } from '../../lib/run-view.js';
import { RUNNER_BOOTSTRAP_TTL_SECONDS, RUNNER_WORKING_TTL_SECONDS } from '../../lib/proxy-scopes.js';
import { OTHER_CONSUMER_RECENT_MS } from '../../lib/runner-kit/runner.mjs';
import { FREE_PLAN } from '../../lib/plan-allowance.js';
import { MAGIC_LINK_TTL_MS } from '../../lib/email-auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('the homepage prompt', () => {
  test('points the agent at this server\'s guide and asks it to read the whole thing', () => {
    const prompt = buildAgentPrompt({ origin: 'https://harbour.example' });
    assert.match(prompt, /https:\/\/harbour\.example\/getting-started\b/);
    assert.match(prompt, /curl -s https:\/\/harbour\.example\/getting-started/);
    assert.match(prompt, /not a summary/);
  });

  test('asks the agent to check with the person before it acts', () => {
    const prompt = buildAgentPrompt({ origin: 'https://harbour.example' });
    assert.match(prompt, /Ask me before you create, change or send anything/);
  });

  test('falls back to harbour.cat with no origin, and drops a trailing slash', () => {
    assert.ok(buildAgentPrompt({ origin: null }).includes(`${DEFAULT_ORIGIN}/getting-started`));
    assert.ok(buildAgentPrompt().includes(`${DEFAULT_ORIGIN}/getting-started`));
    assert.ok(buildAgentPrompt({ origin: 'http://localhost:3000/' }).includes('http://localhost:3000/getting-started'));
    assert.ok(!buildAgentPrompt({ origin: 'http://localhost:3000/' }).includes('3000//'));
  });

  test('stays a couple of paragraphs: short enough to paste and read', () => {
    const prompt = buildAgentPrompt({ origin: 'https://harbour.cat' });
    assert.equal(prompt.split('\n\n').length, 2);
    assert.ok(prompt.length < 1200, `prompt is ${prompt.length} chars`);
  });
});

describe('the guide builder', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'getting-started-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('fills every {{BASE_URL}} with the base URL, without a trailing slash', () => {
    const path = join(dir, 'ok.md');
    writeFileSync(path, '# Guide\n\nSee {{BASE_URL}}/llms.txt and {{BASE_URL}}/library.\n');
    const build = createGuideBuilder({ sourcePath: path });
    const out = build({ baseUrl: 'https://h.example/' });
    assert.equal(out, '# Guide\n\nSee https://h.example/llms.txt and https://h.example/library.\n');
  });

  test('an unknown placeholder serves the fallback and is not cached, so a fixed file loads', () => {
    const path = join(dir, 'bad.md');
    writeFileSync(path, '# Guide {{NOPE}}\n');
    const build = createGuideBuilder({ sourcePath: path });
    const originalError = console.error;
    console.error = () => {};
    try {
      const first = build({ baseUrl: 'https://h.example' });
      assert.match(first, /could not be loaded/);
      assert.ok(first.includes('https://h.example/llms.txt'));
    } finally {
      console.error = originalError;
    }
    writeFileSync(path, '# Guide\n');
    assert.equal(build({ baseUrl: 'https://h.example' }), '# Guide\n');
  });

  test('a missing file serves the fallback', () => {
    const build = createGuideBuilder({ sourcePath: join(dir, 'missing.md') });
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.match(build({ baseUrl: 'https://h.example' }), /could not be loaded/);
    } finally {
      console.error = originalError;
    }
  });
});

describe('the guide renders to safe HTML', () => {
  test('raw HTML is escaped to text', () => {
    const html = renderGuideHtml('<script>alert(1)</script>\n\nText <img src=x onerror=alert(1)> here.');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.match(html, /&lt;script&gt;/);
  });

  test('a link keeps its href only for http(s), mailto, an anchor or a root-relative path', () => {
    assert.equal(safeGuideHref('https://harbour.cat/x'), 'https://harbour.cat/x');
    assert.equal(safeGuideHref('mailto:a@b.c'), 'mailto:a@b.c');
    assert.equal(safeGuideHref('#step-1'), '#step-1');
    assert.equal(safeGuideHref('/library'), '/library');
    assert.equal(safeGuideHref('//evil.example'), null);
    assert.equal(safeGuideHref('javascript:alert(1)'), null);
    assert.equal(safeGuideHref('data:text/html,x'), null);
    const html = renderGuideHtml('[bad](javascript:alert(1)) and [good](https://harbour.cat)');
    assert.ok(!html.includes('javascript:'));
    assert.match(html, /<a href="https:\/\/harbour\.cat">good<\/a>/);
  });

  test('images become their alt text; headings get unique GitHub-style ids', () => {
    const html = renderGuideHtml('![a figure](https://x.example/a.png)\n\n## Step one\n\n## Step one\n');
    assert.ok(!html.includes('<img'));
    assert.match(html, /a figure/);
    assert.match(html, /<h2 id="step-one">/);
    assert.match(html, /<h2 id="step-one-1">/);
  });
});

describe('content negotiation', () => {
  const fakeReq = (accept) => {
    const app = express();
    const req = Object.create(app.request);
    req.headers = accept === undefined ? {} : { accept };
    return req;
  };

  test('a browser gets HTML', () => {
    assert.equal(prefersMarkdown(fakeReq('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')), false);
  });

  test('curl, no Accept, or Markdown/plain text asked for first gets Markdown', () => {
    assert.equal(prefersMarkdown(fakeReq('*/*')), true);
    assert.equal(prefersMarkdown(fakeReq(undefined)), true);
    assert.equal(prefersMarkdown(fakeReq('text/markdown, text/html, */*')), true);
    assert.equal(prefersMarkdown(fakeReq('text/plain')), true);
  });
});

describe('the routes', () => {
  let server;
  let base;
  before(async () => {
    const app = express();
    app.use(createGettingStartedRouter());
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  test('a browser gets the page, under the Library CSP, varying on Accept', async () => {
    const res = await fetch(`${base}/getting-started`, { headers: { accept: 'text/html' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('content-security-policy'), LIBRARY_CSP);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('vary'), /Accept/);
    const html = await res.text();
    assert.match(html, /data-testid="getting-started-page"/);
    assert.match(html, /data-testid="getting-started-prompt"/);
    assert.match(html, /data-testid="getting-started-body"/);
    assert.ok(html.includes(`${base}/getting-started`), 'the prompt and canonical name this server');
    assert.ok(!/<script\b[^>]*\bsrc=/.test(html), 'no external script: the CSP allows none');
  });

  test('an agent\'s fetch gets the Markdown, filled with this server\'s origin', async () => {
    const res = await fetch(`${base}/getting-started`, { headers: { accept: '*/*' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(res.headers.get('content-security-policy'), MARKDOWN_CSP);
    const md = await res.text();
    assert.match(md, /^# /);
    assert.ok(!md.includes('{{'), 'no unfilled placeholder');
    assert.ok(md.includes(`${base}/`), 'links name this server');
  });

  test('/getting-started.md is always Markdown', async () => {
    const res = await fetch(`${base}/getting-started.md`, { headers: { accept: 'text/html' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('a malformed Host header cannot steer the guide\'s links (the Library\'s safeHost rule)', async () => {
    const { port } = server.address();
    const body = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/getting-started.md', headers: { host: 'evil.example?x=' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.end();
    });
    assert.ok(!body.includes('evil.example'), 'the forged host is not echoed');
    assert.ok(body.includes('http://harbour.cat/') || body.includes('https://harbour.cat/'), 'falls back to harbour.cat');
  });
});

describe('the homepage section', () => {
  test('sits first in the showcase, before the loop, with a progressive copy button', () => {
    const html = renderLandingPage({ origin: 'https://harbour.example' });
    assert.match(html, /data-testid="landing-get-started"/);
    assert.ok(html.indexOf('landing-get-started') < html.indexOf('data-testid="landing-loop"'));
    assert.match(html, /data-testid="landing-agent-prompt"/);
    assert.match(html, /data-testid="landing-agent-prompt-copy"[^>]*hidden/);
    assert.match(html, /<script src="\/landing\.js"/);
    assert.match(html, /href="\/getting-started" data-testid="landing-getting-started-link"/);
  });

  test('the prompt names this server, and harbour.cat when there is no origin', () => {
    assert.ok(renderLandingPage({ origin: 'https://harbour.example' }).includes('https://harbour.example/getting-started'));
    assert.ok(renderLandingPage({}).includes('https://harbour.cat/getting-started'));
  });

  test('the HTML comment points an agent at the guide', () => {
    assert.match(renderLandingPage({}), /<!-- AI agents: to set Harbour up for someone, read \/getting-started/);
  });
});

// The guide is prose an agent acts on. Every claim below can be checked against
// the code it describes, so a change there fails here rather than leaving the
// guide quietly wrong.
describe('the guide agrees with the code', () => {
  const guide = buildGettingStartedGuide({ baseUrl: 'https://harbour.cat' });
  const source = readFileSync(GUIDE_SOURCE_PATH, 'utf8');

  test('the guide file exists, opens with a title and uses only {{BASE_URL}}', () => {
    assert.match(source, /^# /);
    const names = [...source.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);
    assert.ok(names.length > 0, 'the guide names this server through {{BASE_URL}}');
    assert.deepEqual([...new Set(names)], ['BASE_URL']);
  });

  test('every Settings area the guide names exists, by path and by label', () => {
    const ids = new Set(AREAS.map((a) => a.id));
    const byPath = [...guide.matchAll(/\/settings\/([a-z-]+)/g)].map((m) => m[1]);
    for (const id of byPath) assert.ok(ids.has(id), `Settings area "${id}" exists`);
    const named = [...guide.matchAll(/Settings › /g)].map((m) => guide.slice(m.index + 'Settings › '.length, m.index + 40));
    assert.ok(named.length > 0, 'the guide names Settings areas');
    for (const rest of named) {
      assert.ok(AREAS.some((a) => rest.startsWith(a.label)), `"Settings › ${rest}…" names a real area`);
    }
    // The guide's "Settings worth knowing" list covers every area, in the sidebar's order.
    const listed = [...guide.matchAll(/^- \*\*Settings › ([^*]+)\*\*/gm)].map((m) => m[1]);
    assert.deepEqual(listed, AREAS.map((a) => a.label));
  });

  test('the stages it names are the task page\'s usual stages, in order', () => {
    const words = USUAL_STAGES.map((kind) => STAGE_LABELS[kind].toLowerCase());
    const sentence = `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
    assert.ok(guide.includes(`stages: ${sentence}.`), `the guide lists: ${sentence}`);
  });

  test('the times and limits it quotes are the code\'s own', () => {
    assert.ok(guide.includes(`Within ${RUNNER_BOOTSTRAP_TTL_SECONDS / 3600} hour,`), 'runner bootstrap lifetime');
    assert.ok(guide.includes(`The credential then lasts ${RUNNER_WORKING_TTL_SECONDS / 3600} hours`), 'runner credential lifetime');
    assert.ok(guide.includes(`in the last ${OTHER_CONSUMER_RECENT_MS / 60_000} minutes`), 'runner vs Simple Dispatcher window');
    assert.ok(guide.includes(`(${FREE_PLAN.runsPerDay} unless the server sets otherwise)`), 'free-tier runs per day');
    assert.ok(guide.includes(`(valid ${MAGIC_LINK_TTL_MS / 60_000} minutes)`), 'email link lifetime');
    assert.ok(guide.includes('It lasts 90 days and is shown once.'), 'Settings key lifetime, as Settings says it');
    assert.match(read('lib/render-settings-workspace.js'), /It lasts 90 days and is shown once\./);
    assert.ok(guide.includes('60 requests a minute'), 'API rate limit');
    assert.match(read('lib/proxy-instructions.js'), /Rate limit: 60 requests per minute\./);
  });

  test('the labels it quotes are the UI\'s own', () => {
    const sources = [
      'lib/render-runner-setup.js',
      'lib/render-settings-workspace.js',
      'lib/render-settings-you.js',
      'lib/feature-defaults.js',
      'lib/render.js',
      'public/prompt-section.js',
      'lib/render-task-page.js',
      'lib/render-dispatch.js',
      'lib/components/halt-controls.js',
    ].map(read).join('\n').replace(/\\u203A/gi, '›');
    for (const label of [
      'create runner prompt',
      'Run on my machine',
      'Set up a runner ›',
      'Read and update',
      'Agents can change models',
      'Add a task key to copied prompts',
      'Let your agent post progress to this task',
      'Write the prompt',
      'Copy prompt',
      'Run to PR',
      'Task page ›',
    ]) {
      assert.ok(guide.includes(label), `the guide quotes "${label}"`);
      assert.ok(sources.includes(label), `"${label}" is still a UI label`);
    }
  });

  test('every in-page link resolves to a heading', () => {
    const html = renderGuideHtml(guide);
    const ids = new Set([...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]));
    const anchors = [...guide.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    for (const anchor of anchors) assert.ok(ids.has(anchor), `#${anchor} resolves`);
  });

  test('every path the guide names on this server is one Harbour serves', () => {
    const server = read('server.js');
    const routes = [
      server,
      read('routes/library.js'),
      read('routes/getting-started.js'),
      read('lib/getting-started.js'),
      read('routes/runner-setup.js'),
      read('routes/settings.js'),
      read('routes/email-auth.js'),
      read('routes/proxy-token-exchange.js'),
      read('routes/proxy.js'),
    ].join('\n');
    const paths = [...guide.matchAll(/https:\/\/harbour\.cat(\/[A-Za-z0-9._/-]*)/g)].map((m) => m[1].replace(/[.)]+$/, ''));
    assert.ok(paths.length > 0);
    const KNOWN = new Map([
      ['/', /app\.get\('\/'/],
      ['/llms.txt', /llms\.txt/],
      ['/library', /'\/library'/],
      ['/templates', /app\.get\('\/templates'/],
      ['/getting-started', /GETTING_STARTED_PATH = '\/getting-started'/],
      ['/getting-started.md', /GETTING_STARTED_MARKDOWN_PATH = '\/getting-started\.md'/],
      ['/api/proxy/token', /\/api\/proxy\/token'/],
      ['/api/proxy/instructions', /\/api\/proxy\/instructions'/],
      ['/swipe', /app\.get\('\/swipe/],
      ['/account', /\/account/],
      ['/auth/email', /\/auth\/email/],
    ]);
    for (const path of new Set(paths)) {
      const pattern = KNOWN.get(path);
      assert.ok(pattern, `the guide names ${path}: add it to KNOWN with the route that serves it`);
      assert.match(routes, pattern, `${path} is served`);
    }
  });

  test('every workspace page the guide names is one Harbour serves', () => {
    const served = [
      read('server.js'),
      read('routes/runner-setup.js'),
      read('routes/settings.js'),
      read('routes/task-page.js'),
    ].join('\n');
    const KNOWN = new Map([
      ['', /app\.get\('\/workspace\/:urlKey\/'/],
      ['settings', /\/workspace\/:urlKey\/settings'/],
      ['runner', /\/workspace\/:urlKey\/runner'/],
      ['dispatch', /\/workspace\/:urlKey\/dispatch'/],
      ['task', /\/workspace\/:urlKey\/task\/:identifier'/],
    ]);
    const pages = [...guide.matchAll(/`\/workspace\/<key>\/([a-z-]*)/g)].map((m) => m[1]);
    assert.ok(pages.length > 0);
    for (const page of new Set(pages)) {
      const pattern = KNOWN.get(page);
      assert.ok(pattern, `the guide names /workspace/<key>/${page}: add it to KNOWN with the route that serves it`);
      assert.match(served, pattern, `/workspace/<key>/${page} is served`);
    }
  });
});
