/**
 * Test helper for the per-area Settings pages (LIN-3846).
 *
 * `renderSettingsPage(name, { area })` renders one area. The older renderer tests assert
 * that a control "is on the Settings pages", not where, so `renderAllAreas` renders every
 * area and joins them: those assertions keep their meaning. Where in particular a control
 * lives is pinned by tests/unit/settings-areas-census.test.js (exactly one area each).
 * A test about one area passes `area` and gets that page alone.
 */
import { renderSettingsPage } from '../../lib/render-settings.js';
import { AREAS } from '../../lib/settings-areas.js';

export function renderAllAreas(name, options = {}) {
  if (options.area) return renderSettingsPage(name, options);
  return AREAS.map(a => renderSettingsPage(name, { ...options, area: a.id })).join('\n');
}

export { renderSettingsPage as renderOneArea };
