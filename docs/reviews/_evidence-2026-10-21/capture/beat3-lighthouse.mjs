/**
 * LIN-3750 beat 3 — Lighthouse on ~6 authenticated surfaces (09-26 §7.8).
 *
 * Authentication: the session cookie of a Playwright context that went through the approved seam
 * is passed with `--extra-headers` (validated in beat 1 on /workspace/test-workspace/settings,
 * validation/lighthouse-settings-contrast.json). Lighthouse 12.8.2 (same as beat 1), default
 * mobile emulation, light theme, categories accessibility + best-practices + performance.
 * Intercepted renderers are not Lighthouse-reachable (covered by the M4 census instead).
 *
 *   BASE_URL=http://localhost:3197 node beat3-lighthouse.mjs [target ...]
 */
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launch, newCtx, establish, upsertManifest, BASE, OUT, D1400, ws } from './beat3-lib.mjs';
import { STATES, clearAll } from './beat3-task.mjs';

const run = promisify(execFile);
const want = process.argv.slice(2);
const LH = '12.8.2';

const TARGETS = [
  { key: 'task-page', id: 'ws-task-page', state: 'pr-ready-owner', async prep(admin, browser) { await clearAll(admin); const b = await STATES['pr-ready-owner'].seed(admin, browser); return { session: { local: b }, path: STATES['pr-ready-owner'].path }; } },
  { key: 'kpis', id: 'ws-kpis', state: 'populated-rate', async prep(admin) {
      const LOCAL = 'local-workspace';
      const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
      await admin.request.get(`${BASE}/test/clear-kpi-rollup?urlKey=${LOCAL}`);
      await admin.request.post(`${BASE}/test/set-local-session`, { data: { urlKey: LOCAL, append: true, features: { dispatch: true } } });
      for (let i = 1; i <= 3; i++) await admin.request.post(`${BASE}/workspace/${LOCAL}/api/dispatch`, { data: { prompt: 'p', promptName: 'implementation', kind: 'implementation', issueIdentifier: `LOCAL-${i}`, target: 'cli' } });
      for (const [n, d] of [[40, 2], [38, 3], [34, 5], [20, 4], [12, 6], [5, 3]]) await admin.request.get(`${BASE}/test/seed-kpi-rollup?urlKey=${LOCAL}&day=${day(n)}&done=${d}`);
      return { session: { local: { urlKey: LOCAL, features: { dispatch: true } } }, path: `/workspace/${LOCAL}/kpis` };
  } },
  { key: 'runner', id: 'ws-runner', state: 'default', async prep() { return { session: 'app', path: ws('/runner') }; } },
  { key: 'tree', id: 'ws-tree', state: 'empty', async prep() { return { session: 'app', path: ws('/') }; } },
  { key: 'settings', id: 'ws-settings', state: 'empty', async prep() { return { session: 'app', path: ws('/settings') }; } },
  { key: 'proxy', id: 'ws-proxy', state: 'empty', async prep() { return { session: 'app', path: ws('/proxy') }; } },
];

const chromePath = chromium.executablePath();
const browser = await launch();
const admin = await newCtx(browser, 'light', D1400);
await mkdir(OUT, { recursive: true });
const rows = [];
for (const t of TARGETS) {
  if (want.length && !want.includes(t.key)) continue;
  const row = { key: `lighthouse|${t.id}|${t.state}`, registryId: t.id, state: t.state, kind: 'lighthouse', lighthouseVersion: LH };
  try {
    const prep = await t.prep(admin, browser);
    const ctx = await newCtx(browser, 'light', D1400);
    await establish(ctx, prep.session);
    const cookie = (await ctx.cookies(BASE)).map(c => `${c.name}=${c.value}`).join('; ');
    await ctx.close();
    const file = `lighthouse-${t.key}.json`;
    const out = path.join(OUT, file);
    await run('npx', ['-y', `lighthouse@${LH}`, `${BASE}${prep.path}`, '--output=json', `--output-path=${out}`, '--quiet',
      '--only-categories=accessibility,best-practices,performance', `--extra-headers=${JSON.stringify({ Cookie: cookie })}`,
      '--skip-audits=full-page-screenshot,screenshot-thumbnails,final-screenshot',
      `--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage`], { env: { ...process.env, CHROME_PATH: chromePath }, timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
    const j = JSON.parse(await readFile(out, 'utf8'));
    const failing = Object.values(j.audits).filter(a => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'manual' && j.categories.accessibility.auditRefs.concat(j.categories['best-practices'].auditRefs).some(r => r.id === a.id)).map(a => ({ id: a.id, score: a.score, title: a.title, items: (a.details && a.details.items ? a.details.items.length : 0) }));
    // keep the file reviewable: drop the bulky trace-derived performance detail blobs
    for (const a of Object.values(j.audits)) if (a.details && a.details.type === 'debugdata') delete a.details;
    await writeFile(out, JSON.stringify(j));
    Object.assign(row, { ok: true, requestedUrl: j.requestedUrl, finalUrl: j.finalDisplayedUrl, runtimeError: j.runtimeError || null, files: { json: `authenticated/${file}` },
      scores: Object.fromEntries(Object.entries(j.categories).map(([k, v]) => [k, v.score])), failingAudits: failing,
      emulation: { formFactor: j.configSettings.formFactor, throttlingMethod: j.configSettings.throttlingMethod } });
    console.log(`OK   ${t.key} final=${row.finalUrl.replace(BASE, '')} scores=${JSON.stringify(row.scores)} failing=${failing.map(f => f.id).join(',') || '-'}`);
  } catch (e) { row.ok = false; row.reason = String(e.message || e).split('\n')[0]; console.log(`FAIL ${t.key}: ${row.reason}`); }
  rows.push(row);
}
await upsertManifest(rows);
await admin.close(); await browser.close();
