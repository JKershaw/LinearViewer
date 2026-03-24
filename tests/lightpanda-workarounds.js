/**
 * LightPanda Workaround Tests
 *
 * Tests suggested workarounds for the two blockers found in feasibility testing:
 * 1. page.reload() → try page.goto(page.url()) instead
 * 2. click "outside viewport" → try force:true, evaluate click, scrollIntoView
 */
import { chromium } from 'playwright';
import { lightpanda } from '@lightpanda/browser';

const BASE_URL = 'http://localhost:3001';
const results = [];

function log(test, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  console.log(`${icon} ${test}${detail ? ': ' + detail : ''}`);
  results.push({ test, status, detail });
}

async function run() {
  const proc = await lightpanda.serve({ host: '127.0.0.1', port: 9222 });
  console.log('LightPanda started\n');

  const browser = await chromium.connectOverCDP('ws://127.0.0.1:9222');
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL + '/');

  // ── Workaround 1: page.goto(page.url()) instead of page.reload() ──
  console.log('── Reload Workarounds ──');

  try {
    const urlBefore = page.url();
    await page.goto(urlBefore, { timeout: 10000 });
    const h1 = await page.locator('h1').textContent({ timeout: 5000 });
    log('Reload via page.goto(page.url())', h1 ? 'PASS' : 'FAIL', h1);
  } catch (err) {
    log('Reload via page.goto(page.url())', 'FAIL', err.message.split('\n')[0]);
  }

  try {
    await page.evaluate(() => location.reload());
    await page.waitForLoadState('load', { timeout: 10000 });
    const h1 = await page.locator('h1').textContent({ timeout: 5000 });
    log('Reload via evaluate(location.reload())', h1 ? 'PASS' : 'FAIL', h1);
  } catch (err) {
    log('Reload via evaluate(location.reload())', 'FAIL', err.message.split('\n')[0]);
  }

  // ── Workaround 2: Click workarounds ──
  console.log('\n── Click Workarounds ──');

  // Re-load page fresh (using goto workaround)
  await page.goto(BASE_URL + '/');

  // 2a: force: true
  try {
    const header = page.locator('.project-header:has-text("Self-Host")');
    await header.click({ force: true, timeout: 5000 });
    log('Click with force:true', 'PASS');
  } catch (err) {
    log('Click with force:true', 'FAIL', err.message.split('\n')[0]);
  }

  // 2b: evaluate element.click()
  try {
    await page.goto(BASE_URL + '/');
    await page.evaluate(() => {
      const headers = document.querySelectorAll('.project-header');
      for (const h of headers) {
        if (h.textContent.includes('Self-Host')) { h.click(); break; }
      }
    });
    // Check if click actually toggled the state
    const arrow = await page.evaluate(() => {
      const headers = document.querySelectorAll('.project-header');
      for (const h of headers) {
        if (h.textContent.includes('Self-Host')) return h.textContent.trim();
      }
    });
    const expanded = arrow?.includes('▼');
    log('Click via evaluate(el.click())', expanded ? 'PASS' : 'FAIL', `arrow=${arrow}`);
  } catch (err) {
    log('Click via evaluate(el.click())', 'FAIL', err.message.split('\n')[0]);
  }

  // 2c: scrollIntoView + click
  try {
    await page.goto(BASE_URL + '/');
    await page.evaluate(() => {
      const headers = document.querySelectorAll('.project-header');
      for (const h of headers) {
        if (h.textContent.includes('Self-Host')) {
          h.scrollIntoView({ block: 'center' });
          break;
        }
      }
    });
    const header = page.locator('.project-header:has-text("Self-Host")');
    await header.click({ timeout: 5000 });
    log('scrollIntoView() + click', 'PASS');
  } catch (err) {
    log('scrollIntoView() + click', 'FAIL', err.message.split('\n')[0]);
  }

  // 2d: dispatchEvent
  try {
    await page.goto(BASE_URL + '/');
    const clicked = await page.evaluate(() => {
      const headers = document.querySelectorAll('.project-header');
      for (const h of headers) {
        if (h.textContent.includes('Self-Host')) {
          h.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return h.textContent.trim();
        }
      }
    });
    const expanded = clicked?.includes('▼');
    log('Click via dispatchEvent()', expanded ? 'PASS' : 'FAIL', `arrow=${clicked}`);
  } catch (err) {
    log('Click via dispatchEvent()', 'FAIL', err.message.split('\n')[0]);
  }

  // ── Workaround 3: viewport size ──
  console.log('\n── Viewport Workaround ──');
  try {
    // Close old page, create new context with explicit viewport
    await page.close();
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 2000 } });
    const page2 = await ctx2.newPage();
    await page2.goto(BASE_URL + '/');
    const header = page2.locator('.project-header:has-text("Self-Host")');
    await header.click({ timeout: 5000 });
    log('Explicit large viewport + click', 'PASS');
    await page2.close();
  } catch (err) {
    log('Explicit large viewport + click', 'FAIL', err.message.split('\n')[0]);
  }

  // Cleanup
  try { await browser.close(); } catch (e) {}
  proc.stdout?.destroy();
  proc.stderr?.destroy();
  proc.kill();

  // Summary
  console.log('\n═══════════════════════════════════════');
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length} | Pass: ${pass} | Fail: ${fail}`);
  if (fail > 0) {
    console.log('\nFailed:');
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ✗ ${r.test}: ${r.detail}`));
  }
  console.log('═══════════════════════════════════════');
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
