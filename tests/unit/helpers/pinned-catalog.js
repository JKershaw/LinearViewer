/**
 * The pinned OpenRouter catalog snapshot for unit tests (LIN-4358).
 *
 * Harbour reads a model's name, price, tools, reasoning and limits from the live catalog
 * cache. A unit test that prices usage or names a model seeds that cache from the same
 * real slice a test server uses (tests/fixtures/openrouter-models-2026-11-08.json, read
 * from GET https://openrouter.ai/api/v1/models on 8 Nov 2026), so every test prices from
 * one snapshot and none of them makes a live call.
 */
import fs from 'node:fs';
import { _seedCatalogFromBodyForTests, _resetCatalogCacheForTests } from '../../../lib/openrouter-catalog.js';

export const PINNED_CATALOG_BODY = JSON.parse(
  fs.readFileSync(new URL('../../fixtures/openrouter-models-2026-11-08.json', import.meta.url), 'utf8')
);

/** Seed the shared catalog cache with the pinned snapshot. Returns how many models it holds. */
export function seedPinnedCatalog() {
  return _seedCatalogFromBodyForTests(PINNED_CATALOG_BODY);
}

/** Empty the shared catalog cache (a cold catalog). */
export function clearCatalog() {
  _resetCatalogCacheForTests();
}
