/**
 * LIN-4391 session 1: re-measure run-9 finding 29 (unnamed form controls on Settings and Proxy).
 * For each Settings area (AREAS[].id) and Proxy: list input/select/textarea with no accessible name
 * (no <label for>, no wrapping label, no aria-label/aria-labelledby, no title, no placeholder fallback).
 * Writes remeasure/unnamed-controls.json. Docs-only probe.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const AREAS = ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account'];
const PATHS = [...AREAS.map(a => `/workspace/test-workspace/settings/${a}`), '/workspace/test-workspace/proxy'];
const NAMED_JS = String.raw`(() => {
  const named = el => {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true;
    if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return true;
    if (el.closest('label')) return true;
    return false;
  };
  const bad = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')]
    .filter(el => el.offsetParent !== null && !named(el))
    .map(el => ({ tag: el.tagName.toLowerCase(), type: el.type || '', cls: String(el.className).slice(0, 50), testid: el.dataset.testid || null, placeholder: el.placeholder || null }));
  return { controls: document.querySelectorAll('input,select,textarea').length, unnamed: bad };
})()`;
const b = await chromium.launch({ args: ['--no-sandbox'] });
const out = [];
for (const path of PATHS) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/test/set-session?features=' + encodeURIComponent(JSON.stringify({ dispatch: true, proxy: true, roadmap: true, collective: true, taskChat: true, ship: true, flightCompanion: true, passagePlanner: true, shipBiscuit: true, liveConsole: true, shipJourney: true, feedbackWidget: true })), { waitUntil: 'load' });
  const res = await page.goto(BASE + path, { waitUntil: 'load' });
  const r = await page.evaluate(NAMED_JS);
  out.push({ path, status: res.status(), ...r });
  await ctx.close();
}
await b.close();
mkdirSync(new URL('../remeasure/', import.meta.url), { recursive: true });
writeFileSync(new URL('../remeasure/unnamed-controls.json', import.meta.url), JSON.stringify({ probe: 'unnamed-controls.mjs', rows: out }, null, 1));
for (const r of out) console.log(r.path, r.status, 'controls', r.controls, 'unnamed', r.unnamed.length, JSON.stringify(r.unnamed).slice(0, 220));
