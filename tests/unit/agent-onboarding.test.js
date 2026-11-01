/**
 * LIN-4085 — the agent onboarding guide and landing prompt (lib/prompts/agent-onboarding.js).
 *
 * Witnesses, one per claim:
 *   - the real guide builds with no placeholder left and no fallback served;
 *   - an unknown placeholder is refused, not shipped;
 *   - the door list in the guide is the hero's door list, for every flag combination;
 *   - the free-tier sentence follows the flag;
 *   - every link the guide gives resolves to a real route (public routes are requested,
 *     the rest are checked against the file that registers them, a weaker check that the
 *     cold-agent walk on the PR exercises for real);
 *   - the landing prompt has the origin as its only slot and carries no credential.
 *
 * Run with: node --test tests/unit/agent-onboarding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  GUIDE_PATH,
  buildAgentOnboarding,
  createAgentOnboardingBuilder,
  parseAgentOnboardingTemplate,
  renderLandingAgentPrompt,
  LANDING_AGENT_PROMPT_TEMPLATE,
} from '../../lib/prompts/agent-onboarding.js';
import { signInDoors } from '../../lib/components/landing-hero.js';
import { scanText } from '../../lib/secret-scan.js';
import { createGettingStartedRouter } from '../../routes/getting-started.js';
import { createLibraryRouter } from '../../routes/library.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const BASE = 'https://harbour.example';

const FLAG_COMBOS = [];
for (const githubEnabled of [false, true]) {
  for (const jiraEnabled of [false, true]) {
    for (const emailEnabled of [false, true]) FLAG_COMBOS.push({ githubEnabled, jiraEnabled, emailEnabled });
  }
}

const doorsFor = (flags) => signInDoors(flags).map(({ label, href }) => ({ label, href }));

describe('the served guide', () => {
  test('the real guide builds with every placeholder filled and no fallback', () => {
    const guide = buildAgentOnboarding({ baseUrl: BASE, doors: doorsFor(FLAG_COMBOS[7]), freeTierEnabled: true });
    assert.equal(guide.includes('{{'), false, 'no placeholder left');
    assert.equal(guide.includes('could not be loaded'), false, 'the real guide is served, not the fallback');
    assert.match(guide, /^# Harbour: onboarding for coding agents/m);
  });

  test('the served part starts after the design notes divider and omits them', () => {
    const guide = buildAgentOnboarding({ baseUrl: BASE, doors: [], freeTierEnabled: false });
    assert.equal(guide.includes('LIN-4085. The guide a coding agent'), false, 'design notes are not served');
    assert.equal(guide.includes('\n---\n'), false, 'the divider itself is not served');
  });

  test('an unknown placeholder is refused, not shipped as raw braces', () => {
    assert.throws(
      () => parseAgentOnboardingTemplate('design notes\n---\nHello {{NOT_A_THING}}'),
      /unknown placeholder\(s\): NOT_A_THING/,
    );
  });

  test('a missing source serves the fallback, and does not throw', () => {
    const build = createAgentOnboardingBuilder({ guidePath: join(ROOT, 'docs', 'no-such-guide.md') });
    const served = build({ baseUrl: BASE });
    assert.match(served, /could not be loaded/);
    assert.match(served, new RegExp(`${BASE.replace(/\./g, '\\.')}/llms\\.txt`));
  });

  test('the guide names no credential, token or key value', () => {
    const guide = buildAgentOnboarding({ baseUrl: BASE, doors: doorsFor(FLAG_COMBOS[7]), freeTierEnabled: true });
    assert.deepEqual(scanText(guide, { filePath: 'getting-started.md' }), []);
  });

  test('the design-notes source file itself is committed and cut at one divider', () => {
    const raw = read('docs/agent-onboarding.md');
    assert.equal(raw.split('\n').filter((l) => l.trim() === '---').length >= 1, true);
    assert.equal(GUIDE_PATH.endsWith('docs/agent-onboarding.md'), true);
  });
});

describe('the sign-in doors in the guide are the hero doors', () => {
  for (const flags of FLAG_COMBOS) {
    const label = `g=${flags.githubEnabled} j=${flags.jiraEnabled} e=${flags.emailEnabled}`;
    test(`the guide lists exactly the hero's hrefs for ${label}`, () => {
      const guide = buildAgentOnboarding({ baseUrl: BASE, doors: doorsFor(flags), freeTierEnabled: false });
      const listed = [...guide.matchAll(/^- \[[^\]]+\]\((https?:\/\/[^)\s]+)\)$/gm)].map((m) => m[1]);
      const expected = signInDoors(flags).map((d) => (d.href.startsWith('/') ? `${BASE}${d.href}` : d.href));
      assert.deepEqual(listed, expected);
    });
  }

  test('Linear is always listed, and GitHub, Jira and email are listed only when enabled', () => {
    const none = buildAgentOnboarding({ baseUrl: BASE, doors: doorsFor({}), freeTierEnabled: false });
    assert.match(none, /^- \[Log in with Linear\]\(https:\/\/harbour\.example\/auth\/linear\)$/m);
    assert.equal((none.match(/^- \[/gm) || []).length, 1, 'only the Linear door is listed');
  });
});

describe('the free-tier sentence follows its flag', () => {
  test('free tier on and off give different sentences, and neither is left as a placeholder', () => {
    const on = buildAgentOnboarding({ baseUrl: BASE, doors: [], freeTierEnabled: true });
    const off = buildAgentOnboarding({ baseUrl: BASE, doors: [], freeTierEnabled: false });
    assert.match(on, /This deployment has a free tier, so no OpenRouter key is needed to start\./);
    assert.match(off, /This deployment has no free tier/);
    assert.notEqual(on, off);
  });
});

describe('every link the guide gives resolves to a real route', () => {
  // Public routes are requested against the real routers below. Everything else is
  // registered by the file named here, and that file must contain the needle; a weak
  // check, which is why the cold-agent walk is the real witness for these.
  const REGISTERED = {
    '/swipe': { file: 'server.js', needle: "app.get('/swipe/:identifier?'" },
    '/auth/linear': { file: 'routes/auth.js', needle: "router.get('/auth/linear'" },
    '/auth/github': { file: 'routes/github-auth.js', needle: "basePath: '/auth/github'" },
    '/auth/jira/oauth': { file: 'routes/jira-auth.js', needle: "router.get('/auth/jira/oauth'" },
    '/auth/email': { file: 'routes/email-auth.js', needle: "router.get('/auth/email'" },
    '/workspace/<urlKey>/proxy': { file: 'server.js', needle: "app.get('/workspace/:urlKey/proxy'" },
    '/workspace/<urlKey>/runner': { file: 'routes/runner-setup.js', needle: "router.get('/workspace/:urlKey/runner'" },
    '/api/proxy/instructions': { file: 'routes/proxy.js', needle: "router.get('/api/proxy/instructions'" },
  };
  const PUBLIC = ['/getting-started', '/getting-started.md', '/library', '/llms.txt'];

  const linksIn = (guide) => {
    const out = new Set();
    for (const m of guide.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) out.add(m[1]);
    for (const m of guide.matchAll(/(https?:\/\/[^\s)`]+)/g)) out.add(m[1].replace(/[.,:;]+$/, ''));
    return [...out];
  };

  test('each same-origin link is a known route; cross-origin links are none', () => {
    const guide = buildAgentOnboarding({ baseUrl: BASE, doors: doorsFor(FLAG_COMBOS[7]), freeTierEnabled: true });
    const links = linksIn(guide);
    assert.ok(links.length > 0, 'the guide has links');
    const paths = new Set();
    for (const link of links) {
      assert.ok(link === BASE || link.startsWith(`${BASE}/`), `a link leaves the deployment origin: ${link}`);
      const path = new URL(link.replace('<urlKey>', 'k')).pathname;
      paths.add(path.replace('/workspace/k/', '/workspace/<urlKey>/'));
    }
    for (const path of paths) {
      const known = path === '/' || PUBLIC.includes(path) || Object.hasOwn(REGISTERED, path);
      assert.ok(known, `the guide links to ${path}, which no test knows how to resolve`);
    }
  });

  test('the registering file for each non-public link contains its route', () => {
    for (const [path, { file, needle }] of Object.entries(REGISTERED)) {
      assert.ok(read(file).includes(needle), `${path} is registered in ${file} (looked for ${needle})`);
    }
  });

  test('the public links answer 200 from the real routers, with no session', async () => {
    const app = express();
    app.use(createGettingStartedRouter({ flags: () => ({ githubEnabled: false, jiraEnabled: false, emailEnabled: false, freeTierEnabled: false }) }));
    app.use(createLibraryRouter());
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const path of ['/getting-started', '/getting-started.md', '/library']) {
        const res = await fetch(`${base}${path}`);
        assert.equal(res.status, 200, `${path} is served`);
      }
      assert.equal(existsSync(join(ROOT, 'public', 'llms.txt')), true, '/llms.txt is a static file');
    } finally {
      server.close();
    }
  });
});

describe('the landing prompt', () => {
  test('its only slot is the origin, and it points the agent at the guide', () => {
    assert.deepEqual([...LANDING_AGENT_PROMPT_TEMPLATE.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]).sort(), ['BASE_URL', 'BASE_URL', 'BASE_URL']);
    const text = renderLandingAgentPrompt({ baseUrl: `${BASE}/` });
    assert.equal(text.includes('{{'), false);
    assert.ok(text.includes(`${BASE}/getting-started.md`), 'points at the .md guide');
    assert.ok(text.includes('ask me'), 'tells the agent to ask the person first');
    assert.ok(text.includes(`${BASE}/getting-started`), 'says where to fetch the page if the .md is unreachable');
  });

  test('it carries no credential, token or key', () => {
    assert.deepEqual(scanText(renderLandingAgentPrompt({ baseUrl: BASE }), { filePath: 'landing-prompt' }), []);
  });

  test('it refuses to render without an origin', () => {
    assert.throws(() => renderLandingAgentPrompt({ baseUrl: '' }), /requires a baseUrl/);
  });
});
