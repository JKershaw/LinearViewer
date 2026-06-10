import { test, expect } from '../fixtures/test-base.js';
import { seedLocalWorkspace, swimLocalSeed, LOCAL_WORKSPACE_URL_KEY } from '../fixtures/local-harness.js';

// LIN-378: the ship surface is fully modeled by the local provider, so this spec
// rides a seeded local workspace (no `test-token` mock). The seed is the swim
// sample fixture converted to local shape — same projects, blocking chains, and
// labels the assertions below were written against.
const SHIP_URL = `/workspace/${LOCAL_WORKSPACE_URL_KEY}/ship`;

test.describe('Ship Page', () => {
  test.beforeEach(async ({ page }) => {
    await seedLocalWorkspace(page, swimLocalSeed);
    await page.goto(SHIP_URL);
    await page.waitForLoadState('networkidle');
  });

  test('renders the ship rectangle at the centre', async ({ page }) => {
    const ship = page.locator('#ship-rect');
    await expect(ship).toBeVisible();
    const box = await ship.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(50);
  });

  test('in-progress items are placed inside the ship', async ({ page }) => {
    const inShip = page.locator('#ship-rect-cards .swim-box');
    await expect(inShip.first()).toBeVisible();
    const count = await inShip.count();
    expect(count).toBeGreaterThan(0);
  });

  test('orbit cards are rendered outside the ship', async ({ page }) => {
    const orbit = page.locator('#ship-orbit .swim-box');
    await expect(orbit.first()).toBeVisible();
    const count = await orbit.count();
    expect(count).toBeGreaterThan(0);
  });

  test('each orbit card carries a data-sector attribute', async ({ page }) => {
    const orbit = page.locator('#ship-orbit .swim-box');
    const sectors = await orbit.evaluateAll(nodes =>
      nodes.map(n => n.getAttribute('data-sector'))
    );
    expect(sectors.length).toBeGreaterThan(0);
    const allowed = new Set(['forward', 'starboard', 'aft', 'port', 'drift']);
    for (const s of sectors) {
      expect(allowed.has(s)).toBeTruthy();
    }
  });

  test('clicking a card opens the popover', async ({ page }) => {
    const card = page.locator('#ship-orbit .swim-box').first();
    await card.click();
    const pop = page.locator('#ship-popover');
    await expect(pop).not.toHaveClass(/hidden/);
    await expect(page.locator('#ship-popover-title')).not.toBeEmpty();
  });

  test('popover close button hides it', async ({ page }) => {
    await page.locator('#ship-orbit .swim-box').first().click();
    const pop = page.locator('#ship-popover');
    await expect(pop).not.toHaveClass(/hidden/);
    await page.locator('#ship-popover-close').click();
    await expect(pop).toHaveClass(/hidden/);
  });

  test('segment labels show project names', async ({ page }) => {
    await expect(page.locator('.ship-sector-guide')).toBeAttached();
    const labels = await page.locator('.ship-sector-label').allTextContents();
    // Swim sample has 4 projects; their non-started cards produce 4 segments.
    // BUGS label would only appear if any bug-labelled item is non-started
    // (DASH-3 is bug-labelled but in-progress, so it goes to the ship).
    expect(labels.sort()).toEqual([
      'API v2',
      'Authentication Overhaul',
      'Dashboard Redesign',
      'Infrastructure'
    ]);
  });

  test('heading chip shows "pick a heading" when none is set', async ({ page }) => {
    const chipText = page.locator('#ship-heading-chip-text');
    await expect(chipText).toHaveText(/pick a heading/i);
    await expect(page.locator('#ship-heading-chip')).toHaveAttribute('data-state', 'empty');
    // No forward segment in the default state.
    const fwd = page.locator('#ship-orbit .swim-box[data-sector="forward"]');
    await expect(fwd).toHaveCount(0);
  });

  test('picker opens on chip click and lists projects + labels', async ({ page }) => {
    const picker = page.locator('#ship-heading-picker');
    await expect(picker).toHaveClass(/hidden/);
    await page.locator('#ship-heading-chip').click();
    await expect(picker).not.toHaveClass(/hidden/);
    const projectOptions = await page.locator('#ship-heading-project option').allTextContents();
    expect(projectOptions.length).toBeGreaterThan(1); // — none — + at least one project
    expect(projectOptions).toContain('Authentication Overhaul');
  });

  test('choosing a project sets the heading and routes its cards forward', async ({ page }) => {
    await page.locator('#ship-heading-chip').click();
    await page.locator('#ship-heading-project').selectOption('Authentication Overhaul');
    // Picker closes on selection.
    await expect(page.locator('#ship-heading-picker')).toHaveClass(/hidden/);
    // Chip shows the heading name.
    await expect(page.locator('#ship-heading-chip-text')).toHaveText('Authentication Overhaul');
    await expect(page.locator('#ship-heading-chip')).toHaveAttribute('data-state', 'set');
    // Forward segment now exists and holds the project's cards.
    const fwd = page.locator('#ship-orbit .swim-box[data-sector="forward"]');
    await expect(fwd.first()).toBeVisible();
    expect(await fwd.count()).toBeGreaterThan(0);
    // The forward segment intentionally has NO segment-horizon label — the
    // heading chip up high owns that role, giving forward its chart-annotation
    // status (rather than reading as just another segment).
    await expect(page.locator('.ship-sector-label[data-segment^="heading:"]'))
      .toHaveCount(0);
    // And the project no longer appears among the port/starboard segments.
    const projectLabels = await page
      .locator('.ship-sector-label[data-segment^="project:"]')
      .allTextContents();
    expect(projectLabels).not.toContain('Authentication Overhaul');
  });

  test('clear heading restores the empty state', async ({ page }) => {
    await page.locator('#ship-heading-chip').click();
    await page.locator('#ship-heading-project').selectOption('Authentication Overhaul');
    await expect(page.locator('#ship-heading-chip-text')).toHaveText('Authentication Overhaul');
    await page.locator('#ship-heading-chip').click();
    await page.locator('#ship-heading-clear').click();
    await expect(page.locator('#ship-heading-chip-text')).toHaveText(/pick a heading/i);
    await expect(page.locator('#ship-orbit .swim-box[data-sector="forward"]')).toHaveCount(0);
  });

  test('layout is deterministic across reloads', async ({ page }) => {
    const positions1 = await page.locator('#ship-orbit .swim-box').evaluateAll(
      nodes => nodes.map(n => ({
        id: n.getAttribute('data-issue-id'),
        left: n.style.left,
        top: n.style.top
      }))
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    const positions2 = await page.locator('#ship-orbit .swim-box').evaluateAll(
      nodes => nodes.map(n => ({
        id: n.getAttribute('data-issue-id'),
        left: n.style.left,
        top: n.style.top
      }))
    );
    expect(positions2).toEqual(positions1);
  });
});
