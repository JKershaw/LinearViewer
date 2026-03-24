/**
 * LightPanda Feasibility Test
 *
 * Tests whether LightPanda can handle the browser features our E2E tests rely on:
 * 1. Basic page loading and DOM querying
 * 2. CSS selectors and visibility checks
 * 3. Click events and DOM mutations
 * 4. localStorage API
 * 5. Cookie/session support (via fetch)
 * 6. page.evaluate() for JS execution
 */
import { chromium } from 'playwright';
import { lightpanda } from '@lightpanda/browser';

const BASE_URL = 'http://localhost:3001';

const lpdopts = {
  host: '127.0.0.1',
  port: 9222,
};

const results = [];

function log(test, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  const line = `${icon} ${test}${detail ? ': ' + detail : ''}`;
  console.log(line);
  results.push({ test, status, detail });
}

async function runTests() {
  console.log('Starting LightPanda browser...');
  let proc;
  let browser;

  try {
    proc = await lightpanda.serve(lpdopts);
    console.log('LightPanda started on ws://127.0.0.1:9222\n');

    browser = await chromium.connectOverCDP('ws://127.0.0.1:9222');
    console.log('Playwright connected via CDP\n');
    log('CDP Connection', 'PASS');
  } catch (err) {
    log('CDP Connection', 'FAIL', err.message);
    if (proc) { proc.stdout?.destroy(); proc.stderr?.destroy(); proc.kill(); }
    printSummary();
    return;
  }

  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();

  // Test 1: Basic page load
  try {
    await page.goto(BASE_URL + '/', { timeout: 10000 });
    const title = await page.title();
    log('Page Load', 'PASS', `title="${title}"`);
  } catch (err) {
    log('Page Load', 'FAIL', err.message);
  }

  // Test 2: DOM querying with CSS selectors
  try {
    const h1 = await page.locator('h1').textContent();
    log('DOM Query (h1)', h1 ? 'PASS' : 'FAIL', h1 || 'no h1 found');
  } catch (err) {
    log('DOM Query (h1)', 'FAIL', err.message);
  }

  // Test 3: Complex CSS selectors (our tests rely on these heavily)
  try {
    const projectHeaders = await page.locator('.project-header').count();
    log('Complex CSS Selectors (.project-header)', projectHeaders > 0 ? 'PASS' : 'FAIL', `found ${projectHeaders}`);
  } catch (err) {
    log('Complex CSS Selectors', 'FAIL', err.message);
  }

  // Test 4: :has-text() pseudo-selector (Playwright-specific)
  try {
    const login = await page.locator('.project-header:has-text("Login")').count();
    log(':has-text() selector', login > 0 ? 'PASS' : 'FAIL', `found ${login}`);
  } catch (err) {
    log(':has-text() selector', 'FAIL', err.message);
  }

  // Test 5: Visibility checks
  try {
    const visible = await page.locator('h1').isVisible();
    log('Visibility Check', visible ? 'PASS' : 'FAIL', `h1 visible=${visible}`);
  } catch (err) {
    log('Visibility Check', 'FAIL', err.message);
  }

  // Test 6: Click interaction
  try {
    const header = page.locator('.project-header:has-text("Self-Host")');
    await header.click({ timeout: 5000 });
    log('Click Interaction', 'PASS');
  } catch (err) {
    log('Click Interaction', 'FAIL', err.message);
  }

  // Test 7: page.evaluate() - JavaScript execution
  try {
    const result = await page.evaluate(() => {
      return { docReady: document.readyState, hasBody: !!document.body };
    });
    log('page.evaluate()', result.hasBody ? 'PASS' : 'FAIL', JSON.stringify(result));
  } catch (err) {
    log('page.evaluate()', 'FAIL', err.message);
  }

  // Test 8: localStorage API
  try {
    await page.evaluate(() => {
      localStorage.setItem('test-key', JSON.stringify({ works: true }));
    });
    const stored = await page.evaluate(() => {
      return localStorage.getItem('test-key');
    });
    const parsed = JSON.parse(stored);
    log('localStorage', parsed?.works ? 'PASS' : 'FAIL', stored);
  } catch (err) {
    log('localStorage', 'FAIL', err.message);
  }

  // Test 9: Network requests via page.request / fetch
  try {
    const response = await page.evaluate(async () => {
      const res = await fetch('/');
      return { status: res.status, ok: res.ok };
    });
    log('fetch() API', response.ok ? 'PASS' : 'FAIL', JSON.stringify(response));
  } catch (err) {
    log('fetch() API', 'FAIL', err.message);
  }

  // Test 10: Page reload
  try {
    await page.reload({ timeout: 10000 });
    log('Page Reload', 'PASS');
  } catch (err) {
    log('Page Reload', 'FAIL', err.message);
  }

  // Test 11: data-* attribute selectors
  try {
    const collapsed = await page.locator('.project[data-default-collapsed="true"]').count();
    log('data-* Attribute Selectors', collapsed > 0 ? 'PASS' : 'FAIL', `found ${collapsed} collapsed projects`);
  } catch (err) {
    log('data-* Attribute Selectors', 'FAIL', err.message);
  }

  // Test 12: waitForLoadState
  try {
    await page.goto(BASE_URL + '/');
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    log('waitForLoadState(networkidle)', 'PASS');
  } catch (err) {
    log('waitForLoadState(networkidle)', 'FAIL', err.message);
  }

  // Test 13: getComputedStyle (used in interactions.spec.js)
  try {
    const paddingLeft = await page.evaluate(() => {
      const el = document.querySelector('.line');
      return el ? getComputedStyle(el).paddingLeft : null;
    });
    log('getComputedStyle()', paddingLeft ? 'PASS' : 'FAIL', `paddingLeft=${paddingLeft}`);
  } catch (err) {
    log('getComputedStyle()', 'FAIL', err.message);
  }

  // Test 14: .toHaveClass equivalent (className check)
  try {
    const classes = await page.evaluate(() => {
      const el = document.querySelector('.project-header');
      return el?.className;
    });
    log('className access', classes ? 'PASS' : 'FAIL', classes);
  } catch (err) {
    log('className access', 'FAIL', err.message);
  }

  // Cleanup
  try {
    await page.close();
    await browser.close();
  } catch (e) { /* ignore */ }

  if (proc) {
    proc.stdout?.destroy();
    proc.stderr?.destroy();
    proc.kill();
  }

  printSummary();
}

function printSummary() {
  console.log('\n═══════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════');
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length} | Pass: ${pass} | Fail: ${fail}`);
  console.log('═══════════════════════════════════════');

  if (fail > 0) {
    console.log('\nFailed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ ${r.test}: ${r.detail}`);
    });
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
