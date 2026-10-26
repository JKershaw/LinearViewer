import { test, expect } from '@playwright/test';

test.describe('Legal Pages', () => {

  test.describe('Privacy Policy', () => {
    test('loads without authentication', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page).toHaveTitle(/Privacy Policy/);
      await expect(page.locator('h2')).toHaveText('Privacy Policy');
    });

    test('contains required sections', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page.locator('h3:has-text("What Harbour stores")')).toBeVisible();
      await expect(page.locator('h3:has-text("Sign-in tokens")')).toBeVisible();
      await expect(page.locator('h3:has-text("Cookies")')).toBeVisible();
      await expect(page.locator('h3:has-text("Who processes it")')).toBeVisible();
      await expect(page.locator('h3:has-text("Who can see it")')).toBeVisible();
      await expect(page.locator('h3:has-text("How long it is kept")')).toBeVisible();
      await expect(page.locator('h3:has-text("Getting your data deleted")')).toBeVisible();
      await expect(page.locator('a[href*="github.com/JKershaw/LinearViewer/issues"]')).toHaveCount(0);
    });

    test('has footer with current page highlighted', async ({ page }) => {
      await page.goto('/privacy');
      const footer = page.locator('.page-footer');
      await expect(footer).toBeVisible();

      // "privacy" should be bold (current page)
      await expect(footer.locator('.footer-current')).toHaveText('privacy');

      // "terms" should be a link
      await expect(footer.locator('a.footer-legal[href="/terms"]')).toBeVisible();
    });

    test('does not show authenticated navigation links', async ({ page }) => {
      await page.goto('/privacy');
      await expect(page.locator('.footer-actions')).not.toBeVisible();
    });
  });

  test.describe('Terms of Service', () => {
    test('loads without authentication', async ({ page }) => {
      await page.goto('/terms');
      await expect(page).toHaveTitle(/Terms of Service/);
      await expect(page.locator('h2')).toHaveText('Terms of Service');
    });

    test('contains required sections', async ({ page }) => {
      await page.goto('/terms');
      await expect(page.locator('h3:has-text("Service Description")')).toBeVisible();
      await expect(page.locator('h3:has-text("No Warranty")')).toBeVisible();
      await expect(page.locator('h3:has-text("Your Responsibilities")')).toBeVisible();
      await expect(page.locator('h3:has-text("Limitation of Liability")')).toBeVisible();
      await expect(page.locator('h3:has-text("Changes to Terms")')).toBeVisible();
      await expect(page.locator('h3:has-text("Contact")')).toBeVisible();
    });

    test('has footer with current page highlighted', async ({ page }) => {
      await page.goto('/terms');
      const footer = page.locator('.page-footer');
      await expect(footer).toBeVisible();

      // "terms" should be bold (current page)
      await expect(footer.locator('.footer-current')).toHaveText('terms');

      // "privacy" should be a link
      await expect(footer.locator('a.footer-legal[href="/privacy"]')).toBeVisible();
    });

    test('does not show authenticated navigation links', async ({ page }) => {
      await page.goto('/terms');
      await expect(page.locator('.footer-actions')).not.toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('can navigate from privacy to terms', async ({ page }) => {
      await page.goto('/privacy');
      await page.locator('a.footer-legal[href="/terms"]').click();
      await expect(page).toHaveTitle(/Terms of Service/);
    });

    test('can navigate from terms to privacy', async ({ page }) => {
      await page.goto('/terms');
      await page.locator('a.footer-legal[href="/privacy"]').click();
      await expect(page).toHaveTitle(/Privacy Policy/);
    });

    test('header links back to home', async ({ page }) => {
      await page.goto('/privacy');
      await page.locator('h1 a').click();
      // Home is the unauthenticated landing — fronted by the Harbour brand hero
      // whose lowercase `harbour` wordmark is the page <h1> (LIN-726).
      await expect(page.locator('[data-testid="landing-hero"]')).toBeVisible();
      await expect(page.locator('h1.landing-wordmark')).toContainText('harbour');
    });
  });

  test.describe('Footer Links on Other Pages', () => {
    test('landing page footer has privacy and terms links', async ({ page }) => {
      await page.goto('/');
      const footer = page.locator('.page-footer');
      await expect(footer.locator('a.footer-legal[href="/privacy"]')).toBeVisible();
      await expect(footer.locator('a.footer-legal[href="/terms"]')).toBeVisible();
    });
  });

  // LIN-3958: the Plain layout's measures, at the two widths the visual replay uses. node --test cannot
  // compute layout, so these read the rendered page.
  test.describe('Layout', () => {
    const WIDTHS = [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ];

    for (const { width, height } of WIDTHS) {
      for (const path of ['/privacy', '/terms']) {
        test(`${path} at ${width}px: the title and heading step up from the prose, and the measure holds`, async ({ page }) => {
          await page.setViewportSize({ width, height });
          await page.goto(path);
          const m = await page.evaluate(() => {
            const px = (el) => parseFloat(getComputedStyle(el).fontSize);
            const title = document.querySelector('main.plain-page .plain-title');
            const heading = document.querySelector('main.plain-page .section .section-header');
            const para = document.querySelector('main.plain-page .section p:not([class])');
            return {
              title: px(title),
              heading: px(heading),
              prose: px(para),
              proseWidth: para.getBoundingClientRect().width,
              measure: px(para) * 40,
            };
          });
          expect(m.heading).toBeGreaterThanOrEqual(1.2 * m.prose);
          expect(m.title).toBeGreaterThan(m.heading);
          expect(m.proseWidth).toBeLessThanOrEqual(m.measure + 0.5);
          if (width === 390) expect(m.prose).toBeGreaterThanOrEqual(15);
        });
      }

      test(`/privacy at ${width}px: list text is the prose face, and at phone width it clears the bullet`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto('/privacy');
        const m = await page.evaluate(() => {
          const li = document.querySelector('main.plain-page .section li');
          const para = document.querySelector('main.plain-page .section p:not([class])');
          const main = document.querySelector('main.plain-page');
          return {
            liFace: getComputedStyle(li).fontFamily,
            paraFace: getComputedStyle(para).fontFamily,
            liFontSize: parseFloat(getComputedStyle(li).fontSize),
            gutter: li.getBoundingClientRect().left - main.getBoundingClientRect().left,
          };
        });
        expect(m.liFace).toContain('Inter');
        expect(m.liFace).toBe(m.paraFace);
        if (width === 390) expect(m.gutter).toBeGreaterThanOrEqual(1.25 * m.liFontSize);
      });
    }

    test('/styleguide at 390px: no zero-width list is visible', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/styleguide');
      const visibleEmpty = await page.evaluate(() => {
        const hidden = (el) => {
          for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).display === 'none') return true;
          return false;
        };
        return [...document.querySelectorAll('main ul')]
          .filter((ul) => ul.getBoundingClientRect().width === 0 && !hidden(ul)).length;
      });
      expect(visibleEmpty).toBe(0);
    });

    // LIN-3958 (review finding 1): the Plain prose rules reach only unclassed prose, so /styleguide's builder
    // samples keep the face and colour of the live pieces. The sans prose it does take is named here too.
    for (const { width, height } of WIDTHS) {
      test(`/styleguide at ${width}px: builder samples keep their own face and colour, and its prose is sans`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto('/styleguide');
        const m = await page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--fg)';
          document.body.appendChild(probe);
          const fg = getComputedStyle(probe).color;
          probe.remove();
          const look = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const cs = getComputedStyle(el);
            return { face: cs.fontFamily, color: cs.color };
          };
          return {
            fg,
            fontSample: look('main p.sg-font-sample[style*="font-size"]'),
            emptyState: look('main p.emptyState'),
            navItem: look('main .settings-nav-list li'),
            intro: look('main p.sg-intro'),
            anatomyLabel: look('main .sg-settings-anatomy dt'),
            // The two "Section component" specimens are nested in a section: components, not Plain headings.
            nested: [...document.querySelectorAll('main section.section > section.section > .section-header')].map((el) => {
              const cs = getComputedStyle(el);
              return { ruled: el.classList.contains('section-header--ruled'), weight: cs.fontWeight, size: parseFloat(cs.fontSize) };
            }),
          };
        });
        expect(m.fontSample).not.toBeNull();
        expect(m.fontSample.face).toContain('JetBrains Mono');
        expect(m.fontSample.color).toBe(m.fg);
        // LIN-4009: an empty-state sentence and a nav label are words, so the content face.
        expect(m.emptyState.face).toContain('Inter');
        expect(m.navItem.face).toContain('Inter');
        expect(m.navItem.color).toBe(m.fg);
        expect(m.intro.face).toContain('Inter');
        expect(m.anatomyLabel.face).toContain('Inter');
        // LIN-3958 (review round 2): the Plain heading step reaches only the page's own section headings, so the
        // nested specimens keep the canonical weight, and the ruled one stays 1.1x the boxed one.
        expect(m.nested).toHaveLength(2);
        for (const h of m.nested) expect(h.weight).toBe('500');
        const boxed = m.nested.find((h) => !h.ruled);
        const ruled = m.nested.find((h) => h.ruled);
        expect(ruled.size / boxed.size).toBeCloseTo(1.1, 2);
      });
    }
  });
});
