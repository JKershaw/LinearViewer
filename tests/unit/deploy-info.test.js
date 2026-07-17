import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getDeployInfo } from '../../lib/deploy-info.js';
import { renderPageFooter } from '../../lib/components/footer.js';

const DEPLOY_ENV_KEYS = [
  'DEPLOY_VERSION', 'DEPLOY_CREATED_AT', 'DEPLOY_COMMIT',
  'RAILWAY_GIT_COMMIT_SHA',
  'HEROKU_RELEASE_VERSION', 'HEROKU_RELEASE_CREATED_AT', 'HEROKU_BUILD_COMMIT',
];

describe('getDeployInfo', () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(DEPLOY_ENV_KEYS.map(k => [k, process.env[k]]));
    for (const k of DEPLOY_ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('empty env: all fields null (the || null convention)', () => {
    assert.deepEqual(getDeployInfo(), { version: null, createdAt: null, commit: null });
  });

  test('Railway-shaped env: commit falls back to RAILWAY_GIT_COMMIT_SHA, version/createdAt stay null', () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = 'abc1234def5678';
    assert.deepEqual(getDeployInfo(), { version: null, createdAt: null, commit: 'abc1234def5678' });
  });

  test('neutral-first precedence: DEPLOY_COMMIT wins over RAILWAY_GIT_COMMIT_SHA', () => {
    process.env.DEPLOY_COMMIT = 'neutral-sha';
    process.env.RAILWAY_GIT_COMMIT_SHA = 'railway-sha';
    process.env.DEPLOY_VERSION = 'v1.2.3';
    process.env.DEPLOY_CREATED_AT = '2026-07-17T12:00:00Z';
    assert.deepEqual(getDeployInfo(), {
      version: 'v1.2.3',
      createdAt: '2026-07-17T12:00:00Z',
      commit: 'neutral-sha',
    });
  });

  test('HEROKU_* set alone maps to nothing (anti-regression for the root cause)', () => {
    process.env.HEROKU_RELEASE_VERSION = 'v42';
    process.env.HEROKU_RELEASE_CREATED_AT = '2026-01-01T00:00:00Z';
    process.env.HEROKU_BUILD_COMMIT = 'herokusha';
    assert.deepEqual(getDeployInfo(), { version: null, createdAt: null, commit: null });
  });
});

describe('footer deploy-info gate', () => {
  test('renders the commit anchor when only commit is present (Railway fallback, no version)', () => {
    const html = renderPageFooter({ deployInfo: { version: null, createdAt: null, commit: 'abc1234def5678' } });
    assert.match(html, /class="footer-link"[^>]*>abc1234</);
    assert.match(html, /href="https:\/\/github\.com\/JKershaw\/LinearViewer\/commit\/abc1234def5678"/);
  });

  test('does not push an empty version part when version is absent', () => {
    const html = renderPageFooter({ deployInfo: { version: null, createdAt: null, commit: 'abc1234def5678' } });
    const deployBlock = html.match(/<div class="footer-deploy">([\s\S]*?)<\/div>/)[1];
    assert.ok(!deployBlock.startsWith(' · '), `deploy block should not lead with an empty version separator: ${deployBlock}`);
  });

  test('renders both version and commit when both are present', () => {
    const html = renderPageFooter({ deployInfo: { version: 'v1.2.3', createdAt: null, commit: 'abc1234def5678' } });
    const deployBlock = html.match(/<div class="footer-deploy">([\s\S]*?)<\/div>/)[1];
    assert.match(deployBlock, /v1\.2\.3 · <a[^>]*class="footer-link"[^>]*>abc1234</);
  });

  test('invalid createdAt does not render "deployed undefined NaN"', () => {
    const html = renderPageFooter({ deployInfo: { version: null, createdAt: 'not-a-date', commit: 'abc1234def5678' } });
    assert.doesNotMatch(html, /deployed undefined NaN/);
    assert.doesNotMatch(html, /class="deploy-time"/);
  });

  test('empty deployInfo still falls back to the repo link (deployless branch unchanged)', () => {
    const html = renderPageFooter({ deployInfo: {} });
    assert.doesNotMatch(html, /class="deploy-time"/);
    assert.match(html, /github\.com\/JKershaw\/LinearViewer/);
  });
});
